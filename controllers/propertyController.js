const Property = require('../models/Property');
const {generateVideoThumbnail} = require('../services/generateVideoThumbnail');
const User = require('../models/User');
const {
  uploadBuffer,
  getPresignedUrl,
  deleteFile,
} = require("../services/r2Service");
const multer = require("multer");
const { convertToMp4 } = require('../services/VideoConvertor');
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max size (adjust as needed)
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "images") {
      if (file.mimetype.startsWith("image/")) cb(null, true);
      else cb(new Error("Only image files allowed for images"), false);
    } else if (file.fieldname === "videos") {
      if (file.mimetype.startsWith("video/")) cb(null, true);
      else cb(new Error("Only video files allowed for videos"), false);
    } else if (file.fieldname === "replaceMapFiles") {
      cb(null, true);
    } else {
      cb(new Error("Invalid file field"), false);
    }
  },
});

// Utility to remove empty string fields recursively
function removeEmptyStrings(obj) {
  Object.keys(obj).forEach((key) => {
    if (obj[key] === "") {
      delete obj[key]; // remove field if empty string
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      removeEmptyStrings(obj[key]); // handle nested objects too
    }
  });
  return obj;
}


/**
 * @desc    Get all properties with pagination and filtering
 * @route   GET /api/properties
 * @access  Public
 */
const getProperties = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const skip = (page - 1) * limit;

    // Base filter for non-deleted properties
    const filter = { isDeleted: { $ne: true } };

    // Apply query filters dynamically
    const queryFields = ["propertyType", "bedrooms", "furnished"];
    queryFields.forEach((field) => {
      if (req.query[field]) filter[field] = req.query[field];
    });

    if (req.query.location) {
      filter.location = { $regex: req.query.location, $options: "i" };
    }

    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice) filter.price.$gte = parseInt(req.query.minPrice);
      if (req.query.maxPrice) filter.price.$lte = parseInt(req.query.maxPrice);
    }

    if (req.query.minSize || req.query.maxSize) {
      filter.size = {};
      if (req.query.minSize) filter.size.$gte = parseInt(req.query.minSize);
      if (req.query.maxSize) filter.size.$lte = parseInt(req.query.maxSize);
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, "i");
      filter.$or = [{ title: searchRegex }, { description: searchRegex }];
    }

    // Total count for pagination
    const total = await Property.countDocuments(filter);

    // Fetch super admin once
    const superAdmin = await User.findOne({ role: "super_admin" }).select(
      "_id name email phone role"
    );

    // Fetch properties with createdBy and updatedBy populated
    const properties = await Property.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate("createdBy", "name email phone")
      .populate("updatedBy", "name email phone")
      .lean();

    // Map images/videos to include presigned URLs
    const propertiesWithUrls = await Promise.all(
      properties.map(async (prop) => {
        const images = await Promise.all(
          (prop.images || [])
            .filter((img) => img.key)
            .map(async (img) => ({
              ...img,
              presignUrl: await getPresignedUrl(img.key),
            }))
        );

        const videos = await Promise.all(
          (prop.videos || [])
            .filter((vid) => vid.key)
            .map(async (vid) => ({
              ...vid,
              presignUrl: await getPresignedUrl(vid.key),
              thumbnail: vid.thumbnailKey
                ? await getPresignedUrl(vid.thumbnailKey)
                : null,
            }))
        );

        return {
          ...prop,
          agent: superAdmin || null,
          images,
          videos,
        };
      })
    );

    res.status(200).json({
      success: true,
      count: propertiesWithUrls.length,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
      data: propertiesWithUrls,
    });
  } catch (error) {
    console.error("Get properties error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch properties",
      error: error.message,
    });
  }
};


/**
 * @desc    Get single property
 * @route   GET /api/properties/:id
 * @access  Public
 */
const getProperty = async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    // Try to fetch super_admin
    const superAdmin = await User.findOne({ role: "super_admin" });

    const images = await Promise.all(
      (property.images || [])
        .filter((img) => img.key)
        .map(async (img) => ({
          ...img.toObject(),
          presignUrl: img.key ? await getPresignedUrl(img.key) : null,
        }))
    );

    const videos = await Promise.all(
      (property.videos || [])
        .filter((vid) => vid.key)
        .map(async (vid) => ({
          ...vid.toObject(),
          presignUrl: vid.key ? await getPresignedUrl(vid.key) : null,
          thumbnail: vid.thumbnailKey
            ? await getPresignedUrl(vid.thumbnailKey)
            : null,
        }))
    );

    res.status(200).json({
      success: true,
      data: {
        ...property.toObject(),
        agent: superAdmin
          ? {
              _id: superAdmin._id,
              name: superAdmin.name,
              email: superAdmin.email,
              phone: superAdmin.phone,
              role: superAdmin.role,
            }
          : {}, // send empty object if no super admin
        images,
        videos,
      },
    });
  } catch (error) {
    console.error("Get property error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch property",
      error: error.message,
    });
  }
};

/**
 * @desc    Create new property
 * @route   POST /api/properties
 * @access  Private
 */
const createProperty = async (req, res) => {
  try {
    // Fetch super_admin
    const superAdmin = await User.findOne({ role: "super_admin" });
    if (!superAdmin) {
      return res.status(500).json({
        success: false,
        message: "Super admin user not found",
      });
    }
    // Remove empty string fields from req.body
    req.body = removeEmptyStrings(req.body);

    const propertyData = {
      ...req.body,
      agent: superAdmin._id, // always super_admin
      createdBy: req.user._id, // track who created
    };

    // Safely parse amenities if sent as string
    if (typeof propertyData.amenities === "string") {
      propertyData.amenities = JSON.parse(propertyData.amenities);
    }

    const property = await Property.create(propertyData);
    await property.populate("agent", "name email phone");

    res.status(201).json({
      success: true,
      message: "Property created successfully",
      data: property,
    });
  } catch (error) {
    console.error("Create property error:", error);
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: messages,
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to create property",
      error: error.message,
    });
  }
};

// --- Parse JSON safely with debug logs ---
function safeParseArray(bodyField, fieldName) {
  if (!bodyField) return [];
  if (typeof bodyField === "string") {
    try {
      const parsed = JSON.parse(bodyField);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error(`[ERROR] Invalid JSON in ${fieldName}:`, bodyField, err);
      return [];
    }
  }
  if (Array.isArray(bodyField)) {
    return bodyField;
  }
  console.warn(`[WARN] Unexpected type for ${fieldName}:`, typeof bodyField, bodyField);
  return [];
}

function safeParseObject(bodyField, fieldName) {
  if (!bodyField) return {};
  if (typeof bodyField === "string") {
    try {
      const parsed = JSON.parse(bodyField);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch (err) {
      console.error(`[ERROR] Invalid JSON in ${fieldName}:`, bodyField, err);
      return {};
    }
  }
  if (typeof bodyField === "object") {
    return bodyField;
  }
  console.warn(`[WARN] Unexpected type for ${fieldName}:`, typeof bodyField, bodyField);
  return {};
}

/**
 * @desc    Update property metadata and optionally upload/replace/remove media.
 * @route   PUT /api/properties/:id
 * @access  Private
 */
const updateProperty = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const property = await Property.findById(propertyId);
    if (!property)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    // Fetch super_admin
    const superAdmin = await User.findOne({ role: "super_admin" });
    if (!superAdmin) {
      return res.status(500).json({
        success: false,
        message: "Super admin user not found",
      });
    }
    // Remove empty string fields from req.body
    req.body = removeEmptyStrings(req.body);

    // Always set agent to super_admin
    property.agent = superAdmin._id;

     property.updatedBy = req.user?._id; // track who updated

    // Parse JSON fields safely
    const replaceMap = safeParseObject(req.body.replaceMap, "replaceMap");
    const removedImages = safeParseArray(
      req.body.removedImages,
      "removedImages"
    );
    const removedVideos = safeParseArray(
      req.body.removedVideos,
      "removedVideos"
    );

    // 1️⃣ Remove old images/videos
    await handleRemovals(property, removedImages, removedVideos);

    // 2️⃣ Handle replacements
    const usedFiles = await handleReplacements(
      property,
      replaceMap,
      req.files.images || [],
      req.files.videos || []
    );

    // 3️⃣ Handle new uploads
    await handleNewUploads(
      property,
      req.files.images || [],
      req.files.videos || [],
      usedFiles
    );

    // 4️⃣ Update other fields (except agent)
    const ignoredKeys = [
      "removedImages",
      "removedVideos",
      "replaceMap",
      "images",
      "videos",
      "agent",
    ];
    Object.keys(req.body).forEach((key) => {
      if (!ignoredKeys.includes(key)) property[key] = req.body[key];
    });

    await property.save();

    res.json({ success: true, data: property });
  } catch (error) {
    console.error("Update Property Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Remove old files
const handleRemovals = async (property, removedImages, removedVideos) => {
  for (const key of removedImages) {
    await deleteFile(key);
    property.images = property.images.filter((img) => img.key !== key);
  }
 for (const key of removedVideos) {
   const vid = property.videos.find((v) => v.key === key);
   if (vid?.thumbnailKey) await deleteFile(vid.thumbnailKey); // delete thumbnail
   await deleteFile(key); // delete video
   property.videos = property.videos.filter((v) => v.key !== key);
 }
};

// Handle replacements
const handleReplacements = async (
  property,
  replaceMap,
  uploadedImages,
  uploadedVideos
) => {
  const usedFiles = new Set();

  for (const [oldKey, newFileName] of Object.entries(replaceMap)) {
    // Delete old file
    await deleteFile(oldKey);

    // Remove from property arrays
    property.images = property.images.filter((img) => img.key !== oldKey);
    property.videos = property.videos.filter((vid) => vid.key !== oldKey);

    // Find the new file object
    const newFile =
      uploadedImages.find((f) => f.originalname === newFileName && !usedFiles.has(f)) ||
      uploadedVideos.find((f) => f.originalname === newFileName && !usedFiles.has(f));

    if (newFile) {
      usedFiles.add(newFile);

      const isImage = newFile.mimetype.startsWith("image/");
      const folder = isImage ? "images" : "videos";
      const newKey = `properties/${property._id}/${folder}/${Date.now()}-${newFile.originalname}`;

      if (isImage) {
        // For images: just upload
        await uploadBuffer(newFile.buffer, newKey, newFile.mimetype);
        property.images.push({ key: newKey });
      } else {
        // For videos: generate/upload thumbnail FIRST
        const thumbBuffer = await generateVideoThumbnail(newFile.buffer, newFile.originalname);
        const baseName = newFile.originalname.replace(/\.[^/.]+$/, "");
        const thumbKey = `properties/${property._id}/videos/thumbnails/${Date.now()}-${baseName}-thumbnail.png`;
        await uploadBuffer(thumbBuffer, thumbKey, "image/png");

        // Only if thumbnail is ok, upload video
        await uploadBuffer(newFile.buffer, newKey, newFile.mimetype);

        property.videos.push({ key: newKey, thumbnailKey: thumbKey });
      }
    }
  }

  return usedFiles;
};

/**
 * Handle new uploads for property images and videos
 * @param {*} property 
 * @param {*} uploadedImages 
 * @param {*} uploadedVideos 
 * @param {*} usedFiles 
 */
const handleNewUploads = async (property, uploadedImages, uploadedVideos, usedFiles) => {
  // Images
  const newImages = uploadedImages.filter((f) => !usedFiles.has(f));
  for (const file of newImages) {
    const key = `properties/${property._id}/images/${Date.now()}-${file.originalname}`;
    await uploadBuffer(file.buffer, key, file.mimetype);
    property.images.push({ key });
  }

  // Videos
  const newVideos = uploadedVideos.filter((f) => !usedFiles.has(f));
  for (const file of newVideos) {
    let videoBuffer = file.buffer;
    let videoName = file.originalname;
    // Convert to mp4 if not already
    if (file.mimetype !== "video/mp4") {
      videoBuffer = await convertToMp4(videoBuffer, videoName);
      videoName = videoName.replace(/\.[^/.]+$/, ".mp4");
    }

    const baseName = videoName.replace(/\.[^/.]+$/, "");
    const thumbKey = `properties/${property._id}/videos/thumbnails/${Date.now()}-${baseName}-thumbnail.png`;

    // Generate/upload thumbnail FIRST
    const thumbBuffer = await generateVideoThumbnail(videoBuffer, videoName);
    await uploadBuffer(thumbBuffer, thumbKey, "image/png");

    // If thumbnail succeeded, upload video
    const key = `properties/${property._id}/videos/${Date.now()}-${videoName}`;
    await uploadBuffer(videoBuffer, key, "video/mp4");

    property.videos.push({ key, thumbnailKey: thumbKey });
  }
};

/**
 * @desc    Upload images for existing property
 * @route   POST /api/properties/:id/images
 * @access  Private
 */
const uploadPropertyImages = async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      isDeleted: false,
    });
    if (!property) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    // ✅ Just take all files (multer already gives you array of files if multiple uploaded)
    const files = req.files;
    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No images provided" });
    }

    const propertyId = property._id.toString();
    if (!property.images) property.images = [];

    // ✅ Loop over all images
    for (const file of files) {
      const imageKey = `properties/${propertyId}/images/${Date.now()}-${
        file.originalname
      }`;
      await uploadBuffer(file.buffer, imageKey, file.mimetype);
      property.images.push({
        key: imageKey,
      });
    }

    await property.save();
    res.status(200).json({
      success: true,
      message: `${files.length} images uploaded successfully`,
      data: property.images,
    });
  } catch (error) {
    console.error("Upload images error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to upload images",
        error: error.message,
      });
  }
};

/**
 * @desc    Upload videos for existing property
 * @route   POST /api/properties/:id/videos
 * @access  Private
 */
const uploadPropertyVideos = async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      isDeleted: false,
    });
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    if (!req.files || !req.files.videos || req.files.videos.length === 0) {
      return res.status(400).json({ success: false, message: "No videos provided" });
    }

    const propertyId = property._id.toString();
    if (!property.videos) property.videos = [];

    for (const file of req.files.videos) {
       let videoBuffer = file.buffer;
       let videoName = file.originalname;

       // Convert to mp4 if not already
       if (file.mimetype !== "video/mp4") {
         videoBuffer = await convertToMp4(file.buffer, file.originalname);
         videoName = file.originalname.replace(/\.[^/.]+$/, ".mp4");
       }

      // Generate thumbnail
      const thumbBuffer = await generateVideoThumbnail(
        videoBuffer,
        videoName
      );
      const baseName = videoName.replace(/\.[^/.]+$/, "");
      const thumbKey = `properties/${
        property._id
      }/videos/thumbnails/${Date.now()}-${baseName}-thumbnail.png`;
      await uploadBuffer(thumbBuffer, thumbKey, "image/png");

      // Directly upload the video
      const videoKey = `properties/${propertyId}/videos/${Date.now()}-${
        videoName
      }`;
      await uploadBuffer(videoBuffer, videoKey, "video/mp4");


      // Save both video and thumbnail keys in property
      property.videos.push({
        key: videoKey,
        thumbnailKey: thumbKey,
      });
    }

    await property.save();
    res.status(200).json({ success: true, message: "Videos uploaded successfully", data: property.videos });
  } catch (error) {
    console.error("Upload videos error:", error);
    res.status(500).json({ success: false, message: "Failed to upload videos", error: error.message });
  }
};

/**
 * @desc    Delete property
 * @route   DELETE /api/properties/:id
 * @access  Private
 */
const deleteProperty = async (req, res) => {
  try {
   const property = await Property.findByIdAndUpdate(
     req.params.id,
     { isDeleted: true },
     { new: true, runValidators: true } // returns the updated doc
   );

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Access control is handled by route middleware (admin/super_admin only)

    // Soft delete
    property.isDeleted = true;
    await property.save();

    res.status(200).json({
      success: true,
      message: 'Property deleted successfully'
    });
  } catch (error) {
    console.error('Delete property error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete property',
      error: error.message
    });
  }
};

module.exports = {
  getProperties,
  getProperty,
  createProperty,
  updateProperty,
  deleteProperty,
  uploadPropertyImages,
  uploadPropertyVideos,
  upload,
};