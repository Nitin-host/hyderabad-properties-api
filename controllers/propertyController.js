const Property = require("../models/Property");
const {
  generateVideoThumbnail,
} = require("../services/generateVideoThumbnail");
const User = require("../models/User");
const {
  uploadStream,
  getPresignedUrl,
  deleteFile,
  deleteVideoSet,
} = require("../services/r2Service");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { convertToMp4 } = require("../services/VideoConvertor");
const { Worker } = require("worker_threads");
const { enqueueVideoUpload } = require("../queue/videoQueue");

// Detect environment
const isRailway = !!process.env.RAILWAY_ENVIRONMENT;

// ✅ Use /tmp on Railway, local folder elsewhere
const uploadTempFolder = process.env.TEMP_UPLOAD_PATH
  ? process.env.TEMP_UPLOAD_PATH
  : isRailway
  ? path.join("/tmp", "tempUploads")
  : path.join(__dirname, "../tempUploads");

// Ensure folder exists
if (!fs.existsSync(uploadTempFolder)) {
  fs.mkdirSync(uploadTempFolder, { recursive: true });
  console.log("📁 Created upload temp folder:", uploadTempFolder);
}

// --- Multer disk storage ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadTempFolder),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "images" && file.mimetype.startsWith("image/"))
      cb(null, true);
    else if (file.fieldname === "videos" && file.mimetype.startsWith("video/"))
      cb(null, true);
    else if (file.fieldname === "replaceMapFiles")
      cb(null, true);
    else cb(new Error("Invalid file type"), false);
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

// --- Upload single file to R2 and remove local file ---
async function uploadFileToR2(filePath, r2Key, mimetype) {
  try {
    const stream = fs.createReadStream(filePath);
    await uploadStream(stream, r2Key, mimetype);
  } catch (err) {
    console.error(`Failed to upload file ${filePath} to R2:`, err);
    throw err; // rethrow so caller knows upload failed
  }
}

// Synchronous safe delete helper for local files
const safeDeleteSync = (filePath) => {
  if (!filePath) return;
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log("✅ Deleted temp file:", filePath);
    } catch (err) {
      console.error("❌ Safe delete failed:", err);
    }
  } else {
    console.log("⚠️ Skip delete — file not found:", filePath);
  }
};

// --- Helpers for robust upload with tracking ---
/**
 * Upload an image file and track uploaded keys & local temp
 * Returns an object { key } (R2 key)
 */
async function processImageUpload({
  file,
  propertyId,
  r2UploadedKeys,
  localTempFiles,
}) {
  const key = `properties/${propertyId}/images/${Date.now()}-${
    file.originalname
  }`;
  // track local file for cleanup
  localTempFiles.push(file.path);
  await uploadFileToR2(file.path, key, file.mimetype);
  r2UploadedKeys.push(key);
  return { key };
}

/**
 * Upload a video (convert if needed), generate thumbnail, and track uploaded keys & local temp
 * Returns { key: videoKey, thumbnailKey }
 */
async function processVideoUpload({
  file,
  propertyId,
  r2UploadedKeys,
  localTempFiles,
}) {
  // track original local path for cleanup
  localTempFiles.push(file.path);

  let videoPath = file.path;
  let finalName = file.originalname;

  // convert to mp4 if needed
 if (file.mimetype !== 'video/mp4') {
    const { outputPath, finalName: convertedName } = await convertToMp4(file.path, file.originalname, { deleteOriginal:false });
    localTempFiles.push(outputPath);
    videoPath = outputPath;
    finalName = convertedName;
  }

  const thumbPath = await generateVideoThumbnail(videoPath);
   localTempFiles.push(thumbPath);
 
   const timestamp = Date.now();
   const baseName = path.parse(finalName).name;
   const videoKey = `properties/${propertyId}/videos/${timestamp}-${finalName}`;
   const thumbFileName = `${timestamp}-${baseName}.png`;
   const thumbKey = `properties/${propertyId}/videos/thumbnails/${thumbFileName}`;
  // upload thumbnail first (so if video upload fails we can delete thumbnail)
  await uploadFileToR2(thumbPath, thumbKey, "image/png");
  r2UploadedKeys.push(thumbKey);

  // upload video
  await uploadFileToR2(videoPath, videoKey, "video/mp4");
  r2UploadedKeys.push(videoKey);

  return { key: videoKey, thumbnailKey: thumbKey };
}

// --- Safe JSON parsing helpers (as in your original file) ---
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
  console.warn(
    `[WARN] Unexpected type for ${fieldName}:`,
    typeof bodyField,
    bodyField
  );
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
  console.warn(
    `[WARN] Unexpected type for ${fieldName}:`,
    typeof bodyField,
    bodyField
  );
  return {};
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

      // Find users matching search in name (createdBy or updatedBy)
      const matchedUsers = await User.find({
        name: searchRegex,
      })
        .select("_id")
        .lean();

      const matchedUserIds = matchedUsers.map((user) => user._id);

      filter.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { bedrooms: searchRegex },
        { createdBy: { $in: matchedUserIds } }, // match createdBy user IDs
        { updatedBy: { $in: matchedUserIds } }, // match updatedBy user IDs
      ];
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
          agent: superAdmin ? superAdmin._id : null,
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

    // Fetch super admin (for global contact)
    const superAdmin = await User.findOne({ role: "super_admin" });

    // 🖼️ Generate presigned + proxy URLs for all images
    const images = await Promise.all(
      (property.images || []).map(async (img) => {
        const presigned = img.key ? await getPresignedUrl(img.key) : null;
        const proxy = img.key ? `/api/r2proxy/${img.key}` : null;
        return {
          ...img.toObject(),
          presignUrl: presigned,
          proxyUrl: proxy,
        };
      })
    );

    // 🎥 Generate presigned + proxy URLs for videos
    const videos = await Promise.all(
      (property.videos || []).map(async (vid) => {
        const result = {
          ...vid.toObject(),
          presignUrl: vid.masterKey
            ? await getPresignedUrl(vid.masterKey)
            : null,
          masterProxyUrl: vid.masterKey
            ? `/api/r2proxy/${vid.masterKey}`
            : null,
          thumbnail: vid.thumbnailKey
            ? await getPresignedUrl(vid.thumbnailKey)
            : null,
          thumbnailProxyUrl: vid.thumbnailKey
            ? `/api/r2proxy/${vid.thumbnailKey}`
            : null,
          qualityUrls: {},
          qualityProxyUrls: {},
        };

        // Generate presigned + proxy URLs for each quality level
        if (vid.qualityKeys) {
          for (const [quality, key] of Object.entries(vid.qualityKeys)) {
            if (key) {
              result.qualityUrls[quality] = await getPresignedUrl(key);
              result.qualityProxyUrls[quality] = `/api/r2proxy/${key}`;
            }
          }
        }

        return result;
      })
    );

    // ✅ Final response
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
          : {},
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
      updatedBy: req.user._id, // set updatedBy initially
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

/**
 * @desc    Update property metadata and optionally upload/replace/remove media.
 * @route   PUT /api/properties/:id
 * @access  Private
 *
 * Important flow (transaction-like):
 * 1) Parse incoming JSON fields & files
 * 2) Upload all NEW/REPLACEMENT files to R2 first while tracking uploaded keys & local temps
 * 3) If uploads succeed, then delete old/removed keys from R2 (including thumbnailKey)
 * 4) Commit DB changes and save property
 * 5) Cleanup all local temp files. If any step fails before commit, rollback uploaded keys and cleanup local files, do not save.
 */
const updateProperty = async (req, res) => {
  const r2UploadedKeys = [];
  const localTempFiles = [];
  const pendingImageUpdates = [];
  const keysToDeleteAfterCommit = [];

  try {
    const propertyId = req.params.id;
    const property = await Property.findById(propertyId);
    if (!property)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    // ✅ Always attach super admin
    const superAdmin = await User.findOne({ role: "super_admin" });
    if (!superAdmin)
      return res
        .status(500)
        .json({ success: false, message: "Super admin not found" });

    req.body = removeEmptyStrings(req.body);
    const replaceMap = safeParseObject(req.body.replaceMap, "replaceMap");
    const removedImages = safeParseArray(
      req.body.removedImages,
      "removedImages"
    );
    const removedVideos = safeParseArray(
      req.body.removedVideos,
      "removedVideos"
    );

    const uploadedImages = req.files?.images || [];
    const uploadedVideos = req.files?.videos || [];

    // ✅ Limit checks
    if (
      (property.images?.length || 0) -
        removedImages.length +
        uploadedImages.length >
      20
    ) {
      uploadedImages.forEach((f) => safeDeleteSync(f.path));
      return res.status(400).json({
        success: false,
        message: "Only 20 images are allowed.",
      });
    }

    // ✅ Count how many videos are being replaced
    const replaceVideoCount = Object.entries(replaceMap || {}).filter(
      ([oldKey, newFileName]) =>
        uploadedVideos.some((f) => f.originalname === newFileName)
    ).length;

    // ✅ Adjusted video limit check
    const effectiveVideos =
      (property.videos?.masterKey || 0) -
      removedVideos.length -
      replaceVideoCount +
      uploadedVideos.length;

    if (effectiveVideos > 1) {
      uploadedVideos.forEach((f) => safeDeleteSync(f.path));
      return res.status(400).json({
        success: false,
        message:
          "Only one video allowed per property. Remove existing one first.",
      });
    }

    // --- Handle image replacements ---
    for (const [oldKey, newFileName] of Object.entries(replaceMap || {})) {
      const uploadedFile = uploadedImages.find(
        (f) => f.originalname === newFileName
      );
      if (!uploadedFile) continue;

      const result = await processImageUpload({
        file: uploadedFile,
        propertyId,
        r2UploadedKeys,
        localTempFiles,
      });
      pendingImageUpdates.push(result);
      keysToDeleteAfterCommit.push(oldKey);
    }

    // --- Handle new images ---
    for (const file of uploadedImages) {
      const result = await processImageUpload({
        file,
        propertyId,
        r2UploadedKeys,
        localTempFiles,
      });
      pendingImageUpdates.push(result);
    }

    // --- Handle image deletions ---
    if (removedImages.length > 0) {
      for (const key of removedImages) {
        try {
          await deleteFile(key);
        } catch (err) {
          console.error(`Failed to delete image ${key}:`, err.message);
        }
      }
      property.images = property.images.filter(
        (img) => !removedImages.includes(img.key)
      );
    }

    // --- Handle video deletions ---
    if (removedVideos.length > 0) {
      console.log(`🗑 Removing full video set for property ${propertyId}`);
      try {
        await deleteVideoSet(propertyId);
        property.videos = [];
      } catch (err) {
        console.error("Failed to delete video set:", err);
      }
    }

    // --- Handle video replacements ---
    for (const [oldKey, newFileName] of Object.entries(replaceMap || {})) {
      const uploadedFile = uploadedVideos.find(
        (f) => f.originalname === newFileName
      );
      if (!uploadedFile) continue;

      console.log(`🎥 Replacing video with ${uploadedFile.originalname}`);

      await deleteVideoSet(propertyId);
      property.videos = [{ videoStatus: "queued" }];
      await Property.findByIdAndUpdate(propertyId, { videos: property.videos });

      // Queue new video upload
      enqueueVideoUpload(() => {
        return runVideoWorker(
          uploadedFile.path,
          uploadedFile.originalname,
          propertyId
        );
      });

      // safeDeleteSync(uploadedFile.path);
    }

    // --- Handle new video uploads (queue-based) ---
    for (const file of uploadedVideos) {
      console.log(`🎬 Queuing new video upload: ${file.originalname}`);

      property.videos = [{ videoStatus: "queued" }];
      await Property.findByIdAndUpdate(propertyId, { videos: property.videos });

      enqueueVideoUpload(() => {
        return runVideoWorker(file.path, file.originalname, propertyId);
      });

      // safeDeleteSync(file.path);
    }

    // --- Handle replaced image deletions ---
    for (const key of keysToDeleteAfterCommit) {
      try {
        await deleteFile(key);
      } catch (err) {
        console.error(`Failed to delete replaced key ${key}:`, err);
      }
    }

    // --- Commit image updates (videos handled async) ---
    const updatedImages = [
      ...(property.images || []),
      ...pendingImageUpdates.map((img) => ({ key: img.key })),
    ];

    // --- Build update payload ---
    const ignoredKeys = [
      "removedImages",
      "removedVideos",
      "replaceMap",
      "images",
      "videos",
      "agent",
      "createdBy",
      "updatedBy",
    ];

    const updateFields = Object.keys(req.body).reduce((acc, key) => {
      if (!ignoredKeys.includes(key)) acc[key] = req.body[key];
      return acc;
    }, {});

    // ✅ Use findByIdAndUpdate to avoid VersionError
    const updatedProperty = await Property.findByIdAndUpdate(
      propertyId,
      {
        $set: {
          ...updateFields,
          agent: superAdmin._id,
          updatedBy: req.user?._id || property.updatedBy,
          images: updatedImages,
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    // ✅ Respond early — videos will finish later
    res.status(202).json({
      success: true,
      message:
        "Property updated successfully. Videos (if any) are processing in background.",
      status: "queued",
      data: updatedProperty,
    });

    // --- Local cleanup ---
    for (const p of localTempFiles) safeDeleteSync(p);
  } catch (error) {
    console.error("❌ Update Property Error:", error);

    // Rollback uploaded keys if needed
    try {
      if (r2UploadedKeys.length > 0) {
        await Promise.all(
          r2UploadedKeys.map(async (k) => {
            try {
              await deleteFile(k);
            } catch (err) {
              console.error(`Rollback delete failed for ${k}:`, err.message);
            }
          })
        );
      }
      for (const p of localTempFiles) safeDeleteSync(p);
    } catch (cleanupErr) {
      console.error("Rollback cleanup error:", cleanupErr);
    }

    res.status(500).json({
      success: false,
      message: error.message || "Update failed and rollback executed",
    });
  }
};

// --- Worker spawn helper ---
function runVideoWorker(tempPath, originalName, propertyId) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.resolve(__dirname, "../workers/videoWorker.js"),
      {
        workerData: { tempPath, originalName, propertyId },
      }
    );

    worker.on("message", async (result) => {
      if (result.success) {
        console.log("✅ HLS Upload Completed:", propertyId);
        await Property.findOneAndUpdate(
          { _id: propertyId, "videos.videoStatus": "queued" },
          {
            $set: {
              "videos.$.videoStatus": "completed",
              "videos.$.masterKey": result.masterKey,
              "videos.$.thumbnailKey": result.thumbKey,
              "videos.$.qualityKeys": result.qualityKeys,
            },
          }
        );
      } else {
        console.error("❌ Worker failed:", result.error);
        await Property.findOneAndUpdate(
          { _id: propertyId, "videos.videoStatus": "queued" },
          {
            $set: {
              "videos.$.videoStatus": "error",
              errorMessage: result.error,
            },
          }
        );
      }
      resolve();
    });

    worker.on("error", async (err) => {
      console.error("🚨 Worker crashed:", err.message);
      await Property.findOneAndUpdate(
        { _id: propertyId, "videos.videoStatus": "queued" },
        {
          $set: {
            "videos.$.videoStatus": "failed",
            errorMessage: err.message,
          },
        }
      );
      resolve();
    });

    worker.on("exit", (code) => {
      if (code !== 0) console.error(`⚠️ Worker exited with code ${code}`);
    });
  });
}

/**
 * Upload images for existing property
 * @route   POST /api/properties/:id/images
 * @access  Private
 */
const uploadPropertyImages = async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      isDeleted: false,
    });
    if (!property)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    const files = req.files;
    if (!files || files.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "No images provided" });

    if (!property.images) property.images = [];

    // Tracking for rollback within this endpoint
    const r2UploadedKeys = [];
    const localTempFiles = [];

    if (req.files?.length > 20) {
      // Cleanup temp local files
      req.files.forEach((file) => {
        try {
          safeDeleteSync(file.path);
        } catch {}
      });

      return res.status(400).json({
        success: false,
        message: "You can upload a maximum of 20 images per request.",
      });
    }

    try {
      for (const file of files) {
        const imageKey = `properties/${property._id}/images/${Date.now()}-${
          file.originalname
        }`;
        localTempFiles.push(file.path);
        await uploadFileToR2(file.path, imageKey, file.mimetype);
        r2UploadedKeys.push(imageKey);

        // Update property image list in memory (safe to do here)
        property.images.push({ key: imageKey });

        // Delete local temp file immediately (we'll still track it to ensure cleanup on error)
        safeDeleteSync(file.path);
      }

      await property.save();

      res.status(200).json({
        success: true,
        message: `${files.length} images uploaded successfully`,
        data: property.images,
      });
    } catch (err) {
      // rollback any uploaded keys
      await Promise.all(
        r2UploadedKeys.map(async (k) => {
          try {
            await deleteFile(k);
          } catch (err2) {
            console.error("Rollback failed to delete key:", k, err2);
          }
        })
      );
      // cleanup local files
      for (const p of localTempFiles) safeDeleteSync(p);

      throw err;
    }
  } catch (error) {
    console.error("Upload images error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload images",
      error: error.message,
    });
  }
};

/**
 * Upload videos for existing property
 * @route   POST /api/properties/:id/videos
 * @access  Private
 */
const uploadPropertyVideos = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const file = req.files?.videos?.[0];
    if (!file)
      return res
        .status(400)
        .json({ success: false, message: "No video file uploaded" });

    const property = await Property.findById(propertyId);
    if (!property)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    if (property.videos.length >= 1) {
      safeDeleteSync(file.path);
      return res.status(400).json({
        success: false,
        message:
          "Only one video allowed per property. Remove existing video first.",
      });
    }

    // Step 1️⃣ Add video as queued
    property.videos.push({ videoStatus: "queued" });
    await property.save();

    // Step 2️⃣ Respond early
    res.status(202).json({
      success: true,
      message: "Video upload started. Processing in background.",
      status: "queued",
    });

    // Step 3️⃣ Worker for processing
    const tempPath = file.path;
    const originalName = file.originalname;

    enqueueVideoUpload(() => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(
          path.resolve(__dirname, "../workers/videoWorker.js"),
          {
            workerData: { tempPath, originalName, propertyId },
          }
        );

        worker.on("message", async (result) => {
          if (result.success) {
            console.log("✅ HLS Upload Completed:", propertyId);
            console.log('result:', result);
            await Property.findOneAndUpdate(
              { _id: propertyId, "videos.videoStatus": "queued" },
              {
                $set: {
                  "videos.$.videoStatus": "completed",
                  "videos.$.masterKey": result.masterKey,
                  "videos.$.thumbnailKey": result.thumbKey,
                  "videos.$.qualityKeys": result.qualityKeys,
                },
              }
            );
          } else {
            console.error("❌ Worker Failed:", result.error);
            await Property.findOneAndUpdate(
              { _id: propertyId, "videos.videoStatus": "queued" },
              {
                $set: {
                  "videos.$.videoStatus": "error",
                  errorMessage: result.error,
                },
              }
            );
          }
          resolve();
        });

        worker.on("error", async (err) => {
          console.error("🚨 Worker Crashed:", err.message);
          await Property.findOneAndUpdate(
            { _id: propertyId, "videos.videoStatus": "queued" },
            {
              $set: {
                "videos.$.videoStatus": "failed",
                errorMessage: err.message,
              },
            }
          );
          resolve();
        });

        worker.on("exit", (code) => {
          if (code !== 0) console.error(`⚠️ Worker exited with code ${code}`);
        });
      });
    });
  } catch (err) {
    console.error("Upload Property Video Error:", err);
    if (req.files)
      Object.values(req.files)
        .flat()
        .forEach((file) => safeDeleteSync(file.path));

    res.status(500).json({
      success: false,
      message: err.message || "Video upload failed",
    });
  }
};

/**
 * get the properties data whom created admin for super_admin can view all 
 */
const getAdminProperties = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const skip = (page - 1) * limit;

    const filter = { isDeleted: { $ne: true } };

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, "i");

      // Find users matching search in name (createdBy or updatedBy)
      const matchedUsers = await User.find({
        name: searchRegex,
      })
        .select("_id")
        .lean();

      const matchedUserIds = matchedUsers.map((user) => user._id);

      filter.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { bedrooms: searchRegex },
        { createdBy: { $in: matchedUserIds } }, // match createdBy user IDs
        { updatedBy: { $in: matchedUserIds } }, // match updatedBy user IDs
      ];
    }

    // Show only own properties if role is admin
    if (req.user.role === "admin") {
      filter.createdBy = req.user._id;
    }

    const total = await Property.countDocuments(filter);
    const properties = await Property.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate("createdBy", "name email phone")
      .populate("updatedBy", "name email phone")
      .lean();

    // 🔹 Keep image logic same
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

        // 🔹 Updated video logic (same structure as getProperty)
        const videos = await Promise.all(
          (prop.videos || []).map(async (vid) => {
            const result = {
              ...vid,
              masterProxyUrl: vid.masterKey
                ? `/api/r2proxy/${vid.masterKey}`
                : null,
              thumbnail: vid.thumbnailKey
                ? await getPresignedUrl(vid.thumbnailKey)
                : null,
              qualityUrls: {},
              qualityProxyUrls: {},
            };

            if (vid.qualityKeys) {
              for (const [quality, key] of Object.entries(vid.qualityKeys)) {
                if (key) {
                  result.qualityUrls[quality] = await getPresignedUrl(key);
                  result.qualityProxyUrls[quality] = `/api/r2proxy/${key}`;
                }
              }
            }

            return result;
          })
        );

        return {
          ...prop,
          images,
          videos,
        };
      })
    );

    res.status(200).json({
      success: true,
      count: properties.length,
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
    console.error("Get admin properties error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch properties",
      error: error.message,
    });
  }
};


// ✅ GET /api/properties/:id/status
const checkVideoStatus = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const property = await Property.findById(propertyId)
      .populate("createdBy", "name email phone")
      .populate("updatedBy", "name email phone")
      .lean();

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    // 🔹 Rebuild videos with proxy + presigned URLs (same as getAdminProperties)
    const videos = await Promise.all(
      (property.videos || []).map(async (vid) => {
        const result = {
          ...vid,
          masterProxyUrl: vid.masterKey
            ? `/api/r2proxy/${vid.masterKey}`
            : null,
          thumbnail: vid.thumbnailKey
            ? await getPresignedUrl(vid.thumbnailKey)
            : null,
          qualityUrls: {},
          qualityProxyUrls: {},
        };

        if (vid.qualityKeys) {
          for (const [quality, key] of Object.entries(vid.qualityKeys)) {
            if (key) {
              result.qualityUrls[quality] = await getPresignedUrl(key);
              result.qualityProxyUrls[quality] = `/api/r2proxy/${key}`;
            }
          }
        }

        return result;
      })
    );

    res.status(200).json({
      success: true,
      data: {
        _id: property._id,
        title: property.title,
        location: property.location,
        createdBy: property.createdBy,
        updatedBy: property.updatedBy,
        videoCount: videos.length,
        videos,
      },
    });
  } catch (error) {
    console.error("Check video status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check video status",
      error: error.message,
    });
  }
};



/**
 * Get the Properties data of deleted properties by admin, for super_admin can view all
 */

const getDeletedProperties = async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);

      const filter = { isDeleted: true };
      if (req.user.role !== "super_admin") {
        filter.$or = [{ createdBy: req.user._id }, { deletedBy: req.user._id }];
      }
      const total = await Property.countDocuments(filter);

      if (req.query.search) {
        const searchRegex = new RegExp(req.query.search, "i");

        // Find users matching search
        const matchedUsers = await User.find({
          name: searchRegex,
        })
          .select("_id")
          .lean();

        const matchedUserIds = matchedUsers.map((u) => u._id);

        filter.$and = [
          filter.$or ? filter : {}, // keep ownership filter
          {
            $or: [
              { title: searchRegex },
              { description: searchRegex },
              { bedrooms: searchRegex },
              { deletedBy: { $in: matchedUserIds } },
            ],
          },
        ];
      }

      // Fetch deleted properties
      const properties = await Property.find(filter)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("agent", "name email phone role")
        .sort({ createdAt: -1 })
        .populate("deletedBy", "name email phone role")
        .populate("updatedBy", "name email phone role")
        .populate("createdBy", "name email phone role")
        .lean();

      // Add presigned URLs to images and videos for each property
      const propertiesWithPresignedUrls = await Promise.all(
        properties.map(async (property) => {
          const images = await Promise.all(
            (property.images || []).map(async (img) => ({
              ...img,
              presignUrl: img.key ? await getPresignedUrl(img.key) : null,
            }))
          );

          const videos = await Promise.all(
            (property.videos || []).map(async (vid) => ({
              ...vid,
              presignUrl: vid.key ? await getPresignedUrl(vid.key) : null,
              thumbnail: vid.thumbnailKey
                ? await getPresignedUrl(vid.thumbnailKey)
                : null,
            }))
          );

          return {
            ...property,
            images,
            videos,
          };
        })
      );

      res.status(200).json({
        success: true,
        count: propertiesWithPresignedUrls.length,
        data: propertiesWithPresignedUrls,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Get deleted properties error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch deleted properties",
        error: error.message,
      });
    }
}

/**
 * @desc    Delete property (soft delete)
 * @route   DELETE /api/properties/:id
 * @access  Private
 */
const deleteProperty = async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    // ✅ Soft Delete & Track Who Deleted
    property.isDeleted = true;
    property.deletedBy = req.user?._id || null; // Stores the admin who deleted
    property.deletedAt = new Date(); // Save timestamp for audit
    property.updatedBy = req.user?._id || property.updatedBy; // Optional: keep consistent audit trail

    await property.save();

    res.status(200).json({
      success: true,
      message: "Property deleted successfully",
    });
  } catch (error) {
    console.error("Delete property error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete property",
      error: error.message,
    });
  }
};

/**
  * @desc    Permanently delete property (hard delete)
 * @route   DELETE /api/properties/admin/:id/permanent
 */
const permanentDelete = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const property = await Property.findById(propertyId);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    // 🖼️ Delete all images from R2
    if (property.images?.length > 0) {
      for (const image of property.images) {
        if (image.key) {
          try {
            await deleteFile(image.key);
            console.log(`🗑️ Deleted image: ${image.key}`);
          } catch (error) {
            console.error(
              `⚠️ Failed to delete image ${image.key}:`,
              error.message
            );
          }
        }
      }
    }

    // 🎬 Delete all videos (each entry may contain masterKey + thumbnail)
    if (property.videos?.length > 0) {
      for (const video of property.videos) {
        try {
          // Derive the propertyId from the key if available
          let targetPropertyId = propertyId;
          if (video.masterKey) {
            const match = video.masterKey.match(/properties\/([^/]+)\//);
            if (match && match[1]) {
              targetPropertyId = match[1];
            }
          }

          // Delete all .m3u8, .ts, and thumbnails under /videos/
          await deleteVideoSet(targetPropertyId);
          console.log(
            `✅ Deleted all video files for property ${targetPropertyId}`
          );

          // If you want to be extra safe, delete the thumbnailKey separately (optional)
          if (video.thumbnailKey) {
            await deleteFile(video.thumbnailKey);
            console.log(`🗑️ Deleted thumbnail: ${video.thumbnailKey}`);
          }
        } catch (error) {
          console.error(
            `❌ Failed to delete video set for property ${propertyId}:`,
            error.message
          );
        }
      }
    }

    // 🧹 Delete property from database
    await Property.findByIdAndDelete(propertyId);

    res.status(200).json({
      success: true,
      message: "Property permanently deleted successfully",
    });
  } catch (error) {
    console.error("❌ Permanent delete property error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to permanently delete property",
      error: error.message,
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
  getAdminProperties,
  getDeletedProperties,
  permanentDelete,
  safeDeleteSync,
  checkVideoStatus,
  upload,
};