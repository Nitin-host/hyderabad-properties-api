const Property = require("../models/Property");
const {
  generateVideoThumbnail,
} = require("../services/generateVideoThumbnail");
const User = require("../models/User");
const {
  uploadStream,
  getPresignedUrl,
  deleteFile,
} = require("../services/r2Service");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { convertToMp4 } = require("../services/VideoConvertor");

// --- Temp folder setup ---
// const uploadTempFolder = path.join(__dirname, "../tempUploads");
const uploadTempFolder = process.env.TEMP_UPLOAD_PATH || path.join(__dirname, "../tempUploads");
if (!fs.existsSync(uploadTempFolder)) fs.mkdirSync(uploadTempFolder);

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
    else if (file.fieldname === "replaceMapFiles") cb(null, true);
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
 // if (file.mimetype !== 'video/mp4') {
 //    const { outputPath, finalName: convertedName } = await convertToMp4(file.path, file.originalname, { deleteOriginal:false });
 //    localTempFiles.push(outputPath);
 //    videoPath = outputPath;
 //    finalName = convertedName;
 //  }

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
  // Tracking arrays for rollback / cleanup
  const r2UploadedKeys = []; // R2 keys uploaded in this operation (for rollback)
  const localTempFiles = []; // local temp file paths to delete at the end
  const pendingImageUpdates = []; // image objects to add to property if commit
  const pendingVideoUpdates = []; // video objects to add to property if commit
  const keysToDeleteAfterCommit = []; // old R2 keys to delete (removed or replaced), deleted after new uploads succeed
  const thumbnailsToDeleteAfterCommit = []; // thumbnail keys to delete after commit

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

    // Always set agent to super_admin in memory; commit after success
    property.agent = superAdmin._id;

    // Set updatedBy
    if (req.user && req.user._id) {
      property.updatedBy = req.user._id;
    }

    // Parse JSON fields safely
    const replaceMap = safeParseObject(req.body.replaceMap, "replaceMap"); // { oldKey: newFileName }
    const removedImages = safeParseArray(
      req.body.removedImages,
      "removedImages"
    ); // array of keys
    const removedVideos = safeParseArray(
      req.body.removedVideos,
      "removedVideos"
    ); // array of keys

    // Keep copies of original arrays so we only modify on commit
    const originalImages = Array.isArray(property.images)
      ? [...property.images]
      : [];
    const originalVideos = Array.isArray(property.videos)
      ? [...property.videos]
      : [];

    // --- 1) PREPARE: find uploaded files from multer (they are in req.files.images / req.files.videos)
    const uploadedImages = req.files?.images || [];
    const uploadedVideos = req.files?.videos || [];

    // ✅ MEDIA LIMIT VALIDATION
    const existingImagesCount = property.images?.length || 0;
    const existingVideosCount = property.videos?.length || 0;

    const uploadedImagesCount = req.files?.images?.length || 0;
    const uploadedVideosCount = req.files?.videos?.length || 0;

    const effectiveExistingImages = existingImagesCount - removedImages.length;
    const effectiveExistingVideos = existingVideosCount - removedVideos.length;

    const replaceCount = Object.keys(replaceMap || {}).length;

    const totalImagesAfterUpload =
      effectiveExistingImages + uploadedImagesCount - replaceCount;
    const totalVideosAfterUpload =
      effectiveExistingVideos + uploadedVideosCount - replaceCount;

    // ✅ IMAGE LIMIT CHECK
    if (totalImagesAfterUpload > 20) {
      // Cleanup temp uploaded image files from multer if any
      if (req.files?.images) {
        req.files.images.forEach((file) => {
          try {
            safeDeleteSync(file.path);
          } catch (err) {}
        });
      }
      return res.status(400).json({
        success: false,
        message: `Only ${10} images are allowed in total. You can upload ${
          10 - effectiveExistingImages
        } more image(s).`,
      });
    }

    // ✅ VIDEO LIMIT CHECK (Max 1 total)
    if (totalVideosAfterUpload > 1) {
      // Cleanup temp uploaded video files from multer if any
      if (req.files?.videos) {
        req.files.videos.forEach((file) => {
          try {
            safeDeleteSync(file.path);
          } catch (err) {}
        });
      }
      return res.status(400).json({
        success: false,
        message: `Only 1 video is allowed. Remove the existing video first before uploading a new one.`,
      });
    }

    // 1A) Handle REPLACEMENTS: for each oldKey -> newFileName, find file in uploaded arrays and upload it
    // We will not delete oldKey yet. We will upload new file to newKey and record oldKey for deletion after commits.
    for (const [oldKey, newFileName] of Object.entries(replaceMap || {})) {
      // find file in uploaded images or videos
      const uploadedFile =
        uploadedImages.find(
          (f) =>
            f.originalname === newFileName && !localTempFiles.includes(f.path)
        ) ||
        uploadedVideos.find(
          (f) =>
            f.originalname === newFileName && !localTempFiles.includes(f.path)
        );

      if (!uploadedFile) {
        //remove the files we already uploaded
        try{
          safeDeleteSync(uploadedFile.path);
        }catch(err){}
        // If replacement mapping references a file that wasn't uploaded, that's an error.
        throw new Error(
          `Replacement file "${newFileName}" for "${oldKey}" not found in uploaded files.`
        );
        
      }

      // Decide image or video by mimetype
      if (uploadedFile.mimetype.startsWith("image/")) {
        // image replacement
        const result = await processImageUpload({
          file: uploadedFile,
          propertyId,
          r2UploadedKeys,
          localTempFiles,
        });
        pendingImageUpdates.push(result); // { key }
        // Record old key for deletion after commit (and remove the old from originalImages at commit time)
        keysToDeleteAfterCommit.push(oldKey);
      } else {
        // video replacement: upload new video + thumbnail
        const result = await processVideoUpload({
          file: uploadedFile,
          propertyId,
          r2UploadedKeys,
          localTempFiles,
        });
        pendingVideoUpdates.push(result); // { key, thumbnailKey }
        // find the original video entry to get its thumbnailKey to delete after commit
        const oldVideo = originalVideos.find((v) => v.key === oldKey);
        if (oldVideo?.thumbnailKey)
          thumbnailsToDeleteAfterCommit.push(oldVideo.thumbnailKey);
        keysToDeleteAfterCommit.push(oldKey);
      }
    }

    // 1B) Handle NEW uploads (images & videos) - any files not used for replacements
    // determine which uploaded files are used in replaceMap (we marked localTempFiles with file paths, but better to track used files)
    const usedUploadedPaths = new Set(localTempFiles); // processImageUpload/processVideoUpload added file.path to localTempFiles
    // For images:
    for (const file of uploadedImages) {
      if (usedUploadedPaths.has(file.path)) continue; // already processed as replacement
      const result = await processImageUpload({
        file,
        propertyId,
        r2UploadedKeys,
        localTempFiles,
      });
      pendingImageUpdates.push(result);
    }

    // For videos:
    for (const file of uploadedVideos) {
      if (usedUploadedPaths.has(file.path)) continue; // already processed as replacement
      const result = await processVideoUpload({
        file,
        propertyId,
        r2UploadedKeys,
        localTempFiles,
      });
      pendingVideoUpdates.push(result);
    }

    // If we've reached here, all new uploads succeeded. Now we can safely delete old keys requested to be removed or replaced.
    // --- 2) Perform deletions of removedImages & removedVideos and old replacement keys (including thumbnails) ---
    // Note: Deletions are attempted; if any deletion fails we log it but continue (because we already have new files uploaded and can still commit).
    // If you want stricter behavior (abort on deletion failure), throw to rollback instead.

    // Collect removals from user request
    // removedImages: keys to remove from property.images
    for (const key of removedImages) {
      try {
        await deleteFile(key);
        // remove from originalImages
        const idx = originalImages.findIndex((i) => i.key === key);
        if (idx !== -1) originalImages.splice(idx, 1);
      } catch (err) {
        console.error(
          `Failed to delete removed image key ${key} from R2:`,
          err
        );
        // continue
      }
    }

    // removedVideos: keys to remove from property.videos (delete thumbnail if exists)
    for (const key of removedVideos) {
      try {
        const vid = originalVideos.find((v) => v.key === key);
        if (vid?.thumbnailKey) {
          try {
            await deleteFile(vid.thumbnailKey);
          } catch (err) {
            console.error(
              `Failed to delete thumbnail ${vid.thumbnailKey} for removed video ${key}:`,
              err
            );
          }
        }
        await deleteFile(key);
        // remove from originalVideos
        const idx = originalVideos.findIndex((v) => v.key === key);
        if (idx !== -1) originalVideos.splice(idx, 1);
      } catch (err) {
        console.error(
          `Failed to delete removed video key ${key} from R2:`,
          err
        );
        // continue
      }
    }

    // Old replacement keys (we recorded earlier) - delete them
    for (const key of keysToDeleteAfterCommit) {
      try {
        // Find if this key corresponds to a video in original videos -> then delete its thumbnail too (we queued thumbnails separately earlier)
        const vid = originalVideos.find((v) => v.key === key);
        if (vid?.thumbnailKey) {
          try {
            await deleteFile(vid.thumbnailKey);
          } catch (err) {
            console.error(
              `Failed to delete thumbnail ${vid.thumbnailKey} for replaced video ${key}:`,
              err
            );
          }
        }

        await deleteFile(key);
        // remove from originalImages/originalVideos
        let idx = originalImages.findIndex((i) => i.key === key);
        if (idx !== -1) originalImages.splice(idx, 1);
        idx = originalVideos.findIndex((v) => v.key === key);
        if (idx !== -1) originalVideos.splice(idx, 1);
      } catch (err) {
        console.error(
          `Failed to delete replacement old key ${key} from R2:`,
          err
        );
        // continue - already uploaded new files; leaving orphaned old files is not great but we don't want to rollback uploaded new content.
      }
    }

    // Also process thumbnailsToDeleteAfterCommit (some may be duplicates; safe)
    for (const thumbKey of thumbnailsToDeleteAfterCommit) {
      try {
        await deleteFile(thumbKey);
      } catch (err) {
        console.error(`Failed to delete thumbnailKey ${thumbKey}:`, err);
      }
    }

    // --- 3) Commit to property object in memory (only now) ---
    // Remove any images/videos whose keys were removed by client or replaced (we already spliced originals)
    property.images = originalImages;
    property.videos = originalVideos;

    // Append newly uploaded images & videos
    // pendingImageUpdates items are { key }
    pendingImageUpdates.forEach((img) =>
      property.images.push({ key: img.key })
    );
    // pendingVideoUpdates items are { key, thumbnailKey }
    pendingVideoUpdates.forEach((vid) =>
      property.videos.push({ key: vid.key, thumbnailKey: vid.thumbnailKey })
    );

    // 4) Update other fields (except agent)
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
    Object.keys(req.body).forEach((key) => {
      if (!ignoredKeys.includes(key)) property[key] = req.body[key];
    });

    // Save property
    await property.save();

    // 5) Cleanup local temp files now that everything succeeded
    for (const p of localTempFiles) {
      try {
        safeDeleteSync(p);
      } catch (err) {
        console.error(
          "Failed to delete local temp file during cleanup:",
          p,
          err
        );
      }
    }

    res.json({ success: true, data: property });
  } catch (error) {
    console.error("Update Property Error (will rollback):", error);

    // Rollback: delete any new R2 keys uploaded during this operation
    try {
      if (r2UploadedKeys.length > 0) {
        await Promise.all(
          r2UploadedKeys.map(async (k) => {
            try {
              await deleteFile(k);
            } catch (err) {
              console.error(
                `Rollback: failed to delete uploaded R2 key ${k}:`,
                err
              );
            }
          })
        );
      }
    } catch (err) {
      console.error("Rollback R2 deletion error:", err);
    }

    // Cleanup local temp files
    try {
      for (const p of localTempFiles) {
        try {
          safeDeleteSync(p);
        } catch (err) {
          console.error("Rollback: failed to delete local temp file:", p, err);
        }
      }
    } catch (err) {
      console.error("Rollback local cleanup error:", err);
    }

    return res
      .status(500)
      .json({
        success: false,
        message: error.message || "Update failed and rollback executed",
      });
  }
};

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
        message: "You can upload a maximum of 10 images per request.",
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
    const property = await Property.findOne({
      _id: req.params.id,
      isDeleted: false,
    });
    if (!property)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    const videos = req.files?.videos || [];

    if (videos.length > 1) {
      // Cleanup temp
      videos.forEach((file) => {
        try {
          safeDeleteSync(file.path);
        } catch {}
      });

      return res.status(400).json({
        success: false,
        message: "You can upload only 1 video per request.",
      });
    }

    if (videos.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "No videos provided" });

    if (!property.videos) property.videos = [];

    // Tracking for rollback within this endpoint
    const r2UploadedKeys = [];
    const localTempFiles = [];

    try {
      for (const file of videos) {
        // Use processVideoUpload helper which handles conversion and thumbnail generation and tracks local files
        const result = await processVideoUpload({
          file,
          propertyId: property._id,
          r2UploadedKeys,
          localTempFiles,
        });

        // Add to property in memory
        property.videos.push({
          key: result.key,
          thumbnailKey: result.thumbnailKey,
        });

        // cleanup local temp files for this video - we will still track localTempFiles for rollback safety
        // but safeDeleteSync will remove immediately where possible
        // (processVideoUpload already pushed file paths to localTempFiles)
      }

      await property.save();

      // After successful save, cleanup local temp files
      for (const p of localTempFiles) safeDeleteSync(p);

      res.status(200).json({
        success: true,
        message: "Videos uploaded successfully",
        data: property.videos,
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
    console.error("Upload videos error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload videos",
      error: error.message,
    });
  }
};

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
