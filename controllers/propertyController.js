const Property = require("../models/Property");
const {
  generateVideoThumbnail,
} = require("../services/generateVideoThumbnail");
const User = require("../models/User");
const {
  uploadStream,
  deleteFile,
  deleteVideoSet,
  deletePropertyMedia,
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
} = require("../services/r2Service");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { convertToMp4 } = require("../services/VideoConvertor");
const { Worker } = require("worker_threads");
const { enqueueVideoUpload } = require("../queue/videoQueue");
const {
  getCachedSuperAdmin,
  mapImages,
  mapVideos,
} = require("../services/mediaUrls");

const LIST_SELECT =
  "title price location landmarks bedrooms bathrooms size sizeUnit parking amenities status images slug furnished propertyType createdAt";

const VIDEO_PART_SIZE = 8 * 1024 * 1024;

function shouldProcessVideoInApi() {
  return process.env.VIDEO_PROCESS_IN_API === "true";
}

async function purgePropertyMedia(propertyId) {
  try {
    await deletePropertyMedia(propertyId);
  } catch (err) {
    console.error(`Failed to purge R2 media for ${propertyId}:`, err.message);
  }
}

async function purgePropertyVideos(propertyId, options = {}) {
  try {
    await deleteVideoSet(propertyId, options);
  } catch (err) {
    console.error(`Failed to purge videos for ${propertyId}:`, err.message);
  }
}

async function queueLocalVideoAsSource(file, propertyId) {
  const safeName = sanitizeFileName(file.originalname);
  const key = `properties/${propertyId}/source/${Date.now()}-${safeName}`;
  await uploadFileToR2(file.path, key, file.mimetype || "video/mp4");
  safeDeleteSync(file.path);
  await Property.findByIdAndUpdate(propertyId, {
    videos: [
      {
        videoStatus: "queued",
        sourceKey: key,
        originalName: file.originalname,
      },
    ],
  });
  return key;
}

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeFileName(name = "video.mp4") {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_") || "video.mp4";
}

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
  limits: { fileSize: 80 * 1024 * 1024, files: 21 },
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

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
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
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { isDeleted: false };

    const queryFields = ["propertyType", "bedrooms", "furnished"];
    queryFields.forEach((field) => {
      if (req.query[field]) filter[field] = req.query[field];
    });

    if (req.query.location) {
      filter.location = { $regex: escapeRegex(req.query.location), $options: "i" };
    }

    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice) filter.price.$gte = parseInt(req.query.minPrice, 10);
      if (req.query.maxPrice) filter.price.$lte = parseInt(req.query.maxPrice, 10);
    }

    if (req.query.minSize || req.query.maxSize) {
      filter.size = {};
      if (req.query.minSize) filter.size.$gte = parseInt(req.query.minSize, 10);
      if (req.query.maxSize) filter.size.$lte = parseInt(req.query.maxSize, 10);
    }

    if (req.query.ids) {
      const ids = String(req.query.ids)
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^[a-fA-F0-9]{24}$/.test(id));
      if (ids.length) {
        filter._id = { $in: ids };
      }
    }

    if (req.query.search) {
      const q = String(req.query.search).trim();
      if (q.length >= 3) {
        filter.$text = { $search: q };
      } else if (q) {
        filter.title = new RegExp(escapeRegex(q), "i");
      }
    }

    const [total, properties, superAdmin] = await Promise.all([
      Property.countDocuments(filter),
      Property.find(filter)
        .select(LIST_SELECT)
        .slice("images", 1)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      getCachedSuperAdmin(),
    ]);

    const propertiesWithUrls = await Promise.all(
      properties.map(async (prop) => {
        const images = await mapImages(prop.images, { limit: 1 });
        return {
          ...prop,
          agent: superAdmin ? superAdmin._id : null,
          images,
          videos: [],
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
    const [property, superAdmin] = await Promise.all([
      Property.findOne({
        _id: req.params.id,
        isDeleted: false,
      }),
      getCachedSuperAdmin(),
    ]);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    const [images, videos] = await Promise.all([
      mapImages(property.images, { includeProxy: true }),
      mapVideos(property.videos, { full: true, playableOnly: true }),
    ]);

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
 *  @desc Get the property by slug
 */
const getPropertyBySlug = async (req, res) => {
   try {
     const [property, superAdmin] = await Promise.all([
       Property.findOne({
         slug: req.params.slug,
         isDeleted: false,
       }),
       getCachedSuperAdmin(),
     ]);
     if (!property) {
       return res.status(404).json({ message: "Property not found" });
     }

     const [images, videos] = await Promise.all([
       mapImages(property.images, { includeProxy: true }),
       mapVideos(property.videos, { full: true, playableOnly: true }),
     ]);

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
   } catch (err) {
     res.status(500).json({ error: err.message });
   }
}

/**
 * @desc    Create new property
 * @route   POST /api/properties
 * @access  Private
 */
const createProperty = async (req, res) => {
  try {
    // Fetch super_admin
    const superAdmin = await getCachedSuperAdmin();
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
    const superAdmin = await getCachedSuperAdmin();
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
    const imageReplacements = new Map();
    const replaceKeyToNewKey = {};

    for (const [oldKey, newFileName] of Object.entries(replaceMap || {})) {
      const uploadedFile = uploadedImages.find(
        (f) =>
          f.originalname === newFileName &&
          ![...imageReplacements.values()].includes(f)
      );
      if (!uploadedFile) continue;
      imageReplacements.set(oldKey, uploadedFile);
      keysToDeleteAfterCommit.push(oldKey);
    }

    const nextImageCount =
      (property.images?.length || 0) -
      removedImages.length -
      imageReplacements.size +
      uploadedImages.length;

    if (nextImageCount > 20) {
      uploadedImages.forEach((f) => safeDeleteSync(f.path));
      return res.status(400).json({
        success: false,
        message: "Only 20 images are allowed.",
      });
    }

    const currentVideoCount = (property.videos || []).filter(
      (v) =>
        v.masterKey ||
        ["uploading", "queued", "processing"].includes(v.videoStatus)
    ).length;
    const nextVideoCount =
      currentVideoCount -
      (removedVideos.length > 0 ? currentVideoCount : 0) +
      uploadedVideos.length;

    if (nextVideoCount > 1) {
      uploadedVideos.forEach((f) => safeDeleteSync(f.path));
      return res.status(400).json({
        success: false,
        message:
          "Only one video allowed per property. Remove existing one first.",
      });
    }

    for (const [oldKey, uploadedFile] of imageReplacements) {
      const result = await processImageUpload({
        file: uploadedFile,
        propertyId,
        r2UploadedKeys,
        localTempFiles,
      });
      replaceKeyToNewKey[oldKey] = result.key;
    }

    for (const file of uploadedImages) {
      if ([...imageReplacements.values()].includes(file)) continue;
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
    }

    property.images = (property.images || [])
      .filter((img) => img?.key && !removedImages.includes(img.key))
      .map((img) =>
        replaceKeyToNewKey[img.key] ? { key: replaceKeyToNewKey[img.key] } : img
      );

    // --- Handle video deletions ---
    if (removedVideos.length > 0) {
      console.log(`🗑 Removing full video set for property ${propertyId}`);
      await purgePropertyVideos(propertyId);
      property.videos = [];
    }

    const processedVideoFiles = new Set();

    // --- Handle video replacements ---
    for (const [oldKey, newFileName] of Object.entries(replaceMap || {})) {
      const uploadedFile = uploadedVideos.find(
        (f) =>
          f.originalname === newFileName && !processedVideoFiles.has(f)
      );
      if (!uploadedFile) continue;
      processedVideoFiles.add(uploadedFile);

      console.log(`🎥 Replacing video with ${uploadedFile.originalname}`);

      await purgePropertyVideos(propertyId);
      property.videos = [{ videoStatus: "queued" }];
      await Property.findByIdAndUpdate(propertyId, { videos: property.videos });

      if (shouldProcessVideoInApi()) {
        enqueueVideoUpload(() => {
          return runVideoWorker(
            uploadedFile.path,
            uploadedFile.originalname,
            propertyId
          );
        });
      } else {
        await queueLocalVideoAsSource(uploadedFile, propertyId);
      }
    }

    // --- Handle new video uploads (queue-based) ---
    for (const file of uploadedVideos) {
      if (processedVideoFiles.has(file)) continue;
      console.log(`🎬 Queuing new video upload: ${file.originalname}`);

      property.videos = [{ videoStatus: "queued" }];
      await Property.findByIdAndUpdate(propertyId, { videos: property.videos });

      if (shouldProcessVideoInApi()) {
        enqueueVideoUpload(() => {
          return runVideoWorker(file.path, file.originalname, propertyId);
        });
      } else {
        await queueLocalVideoAsSource(file, propertyId);
      }

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
    const updateSet = {
      ...updateFields,
      agent: superAdmin._id,
      updatedBy: req.user?._id || property.updatedBy,
      images: updatedImages,
      updatedAt: new Date(),
    };
    if (removedVideos.length > 0) {
      updateSet.videos = [];
    }

    const updatedProperty = await Property.findByIdAndUpdate(
      propertyId,
      { $set: updateSet },
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
function runVideoWorker(tempPathOrOpts, originalName, propertyId) {
  const opts =
    typeof tempPathOrOpts === "object" && tempPathOrOpts !== null
      ? tempPathOrOpts
      : { tempPath: tempPathOrOpts, originalName, propertyId };
  const id = opts.propertyId;

  return new Promise((resolve) => {
    const worker = new Worker(
      path.resolve(__dirname, "../workers/videoWorker.js"),
      {
        workerData: opts,
      }
    );

    worker.on("message", async (result) => {
      if (result.success) {
        console.log("✅ HLS Upload Completed:", id);
        await Property.findOneAndUpdate(
          { _id: id, "videos.videoStatus": { $in: ["queued", "processing"] } },
          {
            $set: {
              "videos.$.videoStatus": "completed",
              "videos.$.masterKey": result.masterKey,
              "videos.$.thumbnailKey": result.thumbKey,
              "videos.$.qualityKeys": result.qualityKeys,
              "videos.$.sourceKey": "",
            },
          }
        );
        if (result.sourceKey || opts.sourceKey) {
          try {
            await deleteFile(result.sourceKey || opts.sourceKey);
          } catch (err) {
            console.warn("Failed to delete source video:", err.message);
          }
        }
      } else {
        console.error("❌ Worker failed:", result.error);
        await Property.findOneAndUpdate(
          { _id: id, "videos.videoStatus": { $in: ["queued", "processing"] } },
          {
            $set: {
              "videos.$.videoStatus": "error",
              "videos.$.errorMessage": result.error,
            },
          }
        );
      }
      resolve();
    });

    worker.on("error", async (err) => {
      console.error("🚨 Worker crashed:", err.message);
      await Property.findOneAndUpdate(
        { _id: id, "videos.videoStatus": { $in: ["queued", "processing"] } },
        {
          $set: {
            "videos.$.videoStatus": "failed",
            "videos.$.errorMessage": err.message,
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

    if (shouldProcessVideoInApi()) {
      property.videos = [{ videoStatus: "queued" }];
      await property.save();
      enqueueVideoUpload(() =>
        runVideoWorker(file.path, file.originalname, propertyId)
      );
    } else {
      await queueLocalVideoAsSource(file, propertyId);
    }

    res.status(202).json({
      success: true,
      message: "Video upload started. Processing in background.",
      status: "queued",
    });
  } catch (err) {
    console.error("Upload Property Video Error:", err);
    if (req.files)
      Object.values(req.files)
        .flat()
        .forEach((file) => safeDeleteSync(file.path));

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: err.message || "Video upload failed",
      });
    }
  }
};

/**
 * get the properties data whom created admin for super_admin can view all 
 */
const getAdminProperties = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { isDeleted: false };

    if (req.query.search) {
      const searchRegex = new RegExp(escapeRegex(req.query.search), "i");

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
        { createdBy: { $in: matchedUserIds } },
        { updatedBy: { $in: matchedUserIds } },
      ];
    }

    if (req.user.role === "admin") {
      filter.createdBy = req.user._id;
    }

    const [total, properties] = await Promise.all([
      Property.countDocuments(filter),
      Property.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate("createdBy", "name email phone")
        .populate("updatedBy", "name email phone")
        .lean(),
    ]);

    const propertiesWithUrls = await Promise.all(
      properties.map(async (prop) => {
        const [images, videos] = await Promise.all([
          mapImages(prop.images),
          mapVideos(prop.videos, { full: true }),
        ]);

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

    const videos = await mapVideos(property.videos, { full: true });

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
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);

      const filter = { isDeleted: true };
      if (req.user.role !== "super_admin") {
        filter.$or = [{ createdBy: req.user._id }, { deletedBy: req.user._id }];
      }

      if (req.query.search) {
        const searchRegex = new RegExp(escapeRegex(req.query.search), "i");

        const matchedUsers = await User.find({
          name: searchRegex,
        })
          .select("_id")
          .lean();

        const matchedUserIds = matchedUsers.map((u) => u._id);

        const searchClause = {
          $or: [
            { title: searchRegex },
            { description: searchRegex },
            { bedrooms: searchRegex },
            { deletedBy: { $in: matchedUserIds } },
          ],
        };

        if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, searchClause];
          delete filter.$or;
        } else {
          Object.assign(filter, searchClause);
        }
      }

      const [total, properties] = await Promise.all([
        Property.countDocuments(filter),
        Property.find(filter)
          .skip((page - 1) * limit)
          .limit(limit)
          .populate("agent", "name email phone role")
          .sort({ createdAt: -1 })
          .populate("deletedBy", "name email phone role")
          .populate("updatedBy", "name email phone role")
          .populate("createdBy", "name email phone role")
          .lean(),
      ]);

      const propertiesWithPresignedUrls = await Promise.all(
        properties.map(async (property) => {
          const [images, videos] = await Promise.all([
            mapImages(property.images, { limit: 1 }),
            mapVideos(property.videos, { full: false }),
          ]);

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

    await purgePropertyMedia(property._id.toString());

    property.isDeleted = true;
    property.deletedBy = req.user?._id || null;
    property.deletedAt = new Date();
    property.updatedBy = req.user?._id || property.updatedBy;
    property.images = [];
    property.videos = [];

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

    await purgePropertyMedia(propertyId);
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

const initiateChunkedVideoUpload = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const { fileName, contentType } = req.body || {};

    if (!fileName) {
      return res.status(400).json({
        success: false,
        message: "fileName is required",
      });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    const hasInFlight = (property.videos || []).some((v) =>
      ["uploading", "queued", "processing"].includes(v.videoStatus)
    );
    if (hasInFlight) {
      return res.status(400).json({
        success: false,
        message:
          "A video is already uploading or processing. Wait or remove it first.",
      });
    }

    if ((property.videos || []).some((v) => v.masterKey)) {
      await purgePropertyVideos(propertyId);
    }

    const safeName = sanitizeFileName(fileName);
    const key = `properties/${propertyId}/source/${Date.now()}-${safeName}`;
    const { uploadId } = await createMultipartUpload(
      key,
      contentType || "video/mp4"
    );

    try {
      await Property.findByIdAndUpdate(propertyId, {
        videos: [{ videoStatus: "uploading" }],
      });
    } catch (err) {
      await abortMultipartUpload({ uploadId, key }).catch(() => {});
      throw err;
    }

    res.status(200).json({
      success: true,
      data: {
        uploadId,
        key,
        partSize: VIDEO_PART_SIZE,
      },
    });
  } catch (error) {
    console.error("Initiate chunked video error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to start video upload",
    });
  }
};

const uploadVideoChunk = async (req, res) => {
  try {
    const file = req.file;
    const uploadId = req.body?.uploadId;
    const key = req.body?.key;
    const partNumber = parseInt(req.body?.partNumber, 10);

    if (
      !file?.buffer ||
      !uploadId ||
      !key ||
      !Number.isInteger(partNumber) ||
      partNumber < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "chunk, uploadId, key and partNumber are required",
      });
    }

    const result = await uploadPart({
      key,
      uploadId,
      partNumber,
      body: file.buffer,
    });

    res.status(200).json({
      success: true,
      data: {
        partNumber: result.partNumber,
        etag: result.etag,
      },
    });
  } catch (error) {
    console.error("Upload video chunk error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to upload video chunk",
    });
  }
};

const completeChunkedVideoUpload = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const { uploadId, key, fileName, parts } = req.body || {};

    if (!uploadId || !key || !Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({
        success: false,
        message: "uploadId, key and parts are required",
      });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    await completeMultipartUpload({ uploadId, key, parts });

    try {
      await deleteVideoSet(propertyId, { exceptKeys: [key] });
    } catch (err) {
      console.error("Failed to clear previous video set:", err.message);
    }

    await Property.findByIdAndUpdate(propertyId, {
      videos: [
        {
          videoStatus: "queued",
          sourceKey: key,
          originalName: fileName || path.basename(key),
        },
      ],
    });

    res.status(202).json({
      success: true,
      message: "Video upload started. Processing in background.",
      status: "queued",
    });

    if (shouldProcessVideoInApi()) {
      enqueueVideoUpload(() =>
        runVideoWorker({
          sourceKey: key,
          originalName: fileName || path.basename(key),
          propertyId,
        })
      );
    }
  } catch (error) {
    console.error("Complete chunked video error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to complete video upload",
    });
  }
};

const abortChunkedVideoUpload = async (req, res) => {
  try {
    const { uploadId, key } = req.body || {};
    if (!uploadId || !key) {
      return res.status(400).json({
        success: false,
        message: "uploadId and key are required",
      });
    }
    await abortMultipartUpload({ uploadId, key });
    const property = await Property.findById(req.params.id);
    if (property?.videos?.[0]?.videoStatus === "uploading") {
      await Property.findByIdAndUpdate(req.params.id, { videos: [] });
    }
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Abort chunked video error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to abort video upload",
    });
  }
};

function getDateRangeOfISOWeek(week, year) {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const ISOWeekStart = new Date(simple);
  if (simple.getDay() <= 4) {
    ISOWeekStart.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    ISOWeekStart.setDate(simple.getDate() + 8 - simple.getDay());
  }
  const ISOWeekEnd = new Date(ISOWeekStart);
  ISOWeekEnd.setDate(ISOWeekStart.getDate() + 6);
  return { start: ISOWeekStart, end: ISOWeekEnd };
}

async function medianPrice(match) {
  const count = await Property.countDocuments(match);
  if (!count) return 0;
  const skip = Math.floor((count - 1) / 2);
  const take = count % 2 === 0 ? 2 : 1;
  const docs = await Property.find(match)
    .sort({ price: 1 })
    .skip(skip)
    .limit(take)
    .select("price")
    .lean();
  if (!docs.length) return 0;
  if (docs.length === 2) {
    return Math.round((Number(docs[0].price) + Number(docs[1].price)) / 2);
  }
  return Math.round(Number(docs[0].price) || 0);
}

const getAdminStats = async (req, res) => {
  try {
    const range = req.query.range || "month";
    const isSuper = req.user.role === "super_admin";
    const scope = isSuper ? {} : { createdBy: req.user._id };
    const activeMatch = { ...scope, isDeleted: false };
    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(now.getDate() - 90);
    const STUCK_VIDEO = [
      "failed",
      "error",
      "queued",
      "processing",
      "uploading",
    ];
    const STATUS_ORDER = [
      "For Rent",
      "For Sale",
      "Available",
      "Under Contract",
      "Rented",
      "Sold",
      "Occupied",
    ];

    const [
      overviewAgg,
      statusAgg,
      typeAgg,
      locationAgg,
      bedroomAgg,
      stuckVideos,
      noPhotoCount,
      medianRent,
    ] = await Promise.all([
      Property.aggregate([
        { $match: scope },
        {
          $group: {
            _id: null,
            totalProperties: { $sum: 1 },
            activeProperties: {
              $sum: { $cond: [{ $eq: ["$isDeleted", false] }, 1, 0] },
            },
            deletedProperties: {
              $sum: { $cond: [{ $eq: ["$isDeleted", true] }, 1, 0] },
            },
            forRent: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$isDeleted", false] },
                      { $eq: ["$status", "For Rent"] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            forSale: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$isDeleted", false] },
                      { $eq: ["$status", "For Sale"] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      Property.aggregate([
        { $match: activeMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Property.aggregate([
        { $match: activeMatch },
        { $group: { _id: "$propertyType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Property.aggregate([
        { $match: activeMatch },
        {
          $group: {
            _id: {
              $let: {
                vars: {
                  loc: { $trim: { input: { $ifNull: ["$location", ""] } } },
                },
                in: {
                  $cond: [{ $eq: ["$$loc", ""] }, "Unknown", "$$loc"],
                },
              },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      Property.aggregate([
        { $match: activeMatch },
        {
          $group: {
            _id: { $ifNull: ["$bedrooms", 0] },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Property.countDocuments({
        ...activeMatch,
        "videos.videoStatus": { $in: STUCK_VIDEO },
      }),
      Property.countDocuments({
        ...activeMatch,
        $or: [{ images: { $exists: false } }, { images: { $size: 0 } }],
      }),
      medianPrice({ ...activeMatch, status: "For Rent" }),
    ]);

    const overview = overviewAgg[0] || {
      totalProperties: 0,
      activeProperties: 0,
      deletedProperties: 0,
      forRent: 0,
      forSale: 0,
    };
    const activeCount = overview.activeProperties || 0;
    const pct = (count) =>
      activeCount ? Number(((count / activeCount) * 100).toFixed(1)) : 0;

    const statusMap = new Map(
      statusAgg.map((s) => [s._id || "Unknown", s.count])
    );
    const statusDistribution = [
      ...STATUS_ORDER.filter((status) => statusMap.has(status)).map(
        (status) => ({
          status,
          count: statusMap.get(status),
          percentage: pct(statusMap.get(status)),
        })
      ),
      ...[...statusMap.keys()]
        .filter((status) => !STATUS_ORDER.includes(status))
        .map((status) => ({
          status,
          count: statusMap.get(status),
          percentage: pct(statusMap.get(status)),
        })),
    ];

    const propertyTypeDistribution = typeAgg.map((p) => ({
      type: p._id || "Unknown",
      count: p.count,
      percentage: pct(p.count),
    }));

    const locationDistribution = locationAgg.map((l) => ({
      location: l._id,
      count: l.count,
    }));

    const bedroomDistribution = bedroomAgg.map((b) => ({
      bedrooms: b._id === 0 ? "Studio" : `${b._id} BHK`,
      count: b.count,
    }));

    let match = { ...scope };
    if (range === "week") {
      const last12Weeks = new Date();
      last12Weeks.setDate(now.getDate() - 7 * 12);
      match.createdAt = { $gte: last12Weeks };
    } else if (range === "month") {
      const last12Months = new Date();
      last12Months.setMonth(now.getMonth() - 12);
      match.createdAt = { $gte: last12Months };
    } else {
      const last5Years = new Date();
      last5Years.setFullYear(now.getFullYear() - 5);
      match.createdAt = { $gte: last5Years };
    }

    let groupId;
    if (range === "week") {
      groupId = {
        year: { $year: "$createdAt" },
        week: { $isoWeek: "$createdAt" },
      };
    } else if (range === "month") {
      groupId = {
        year: { $year: "$createdAt" },
        month: { $month: "$createdAt" },
      };
    } else {
      groupId = { year: { $year: "$createdAt" } };
    }

    const creationRaw = await Property.aggregate([
      { $match: match },
      { $group: { _id: groupId, count: { $sum: 1 } } },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.week": 1 } },
    ]);

    const creationStats = creationRaw.map((item) => {
      if (item._id.week) {
        const { start, end } = getDateRangeOfISOWeek(
          item._id.week,
          item._id.year
        );
        const label = `${start.toLocaleString("en-US", {
          month: "short",
        })} ${start.getDate()} – ${end.toLocaleString("en-US", {
          month: "short",
        })} ${end.getDate()}, ${item._id.year}`;
        return { label, count: item.count };
      }
      if (item._id.month) {
        const monthName = new Date(
          item._id.year,
          item._id.month - 1,
          1
        ).toLocaleString("en-US", { month: "short" });
        return { label: `${monthName} ${item._id.year}`, count: item.count };
      }
      return { label: `${item._id.year}`, count: item.count };
    });

    const [noPhotoDocs, badVideoDocs, oldListingDocs] = await Promise.all([
      Property.find({
        ...activeMatch,
        $or: [{ images: { $exists: false } }, { images: { $size: 0 } }],
      })
        .select("title location slug createdAt")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      Property.find({
        ...activeMatch,
        "videos.videoStatus": { $in: STUCK_VIDEO },
      })
        .select("title location slug videos.videoStatus")
        .limit(10)
        .lean(),
      Property.find({
        ...activeMatch,
        status: { $in: ["For Rent", "For Sale", "Available"] },
        createdAt: { $lt: ninetyDaysAgo },
      })
        .select("title location slug status createdAt")
        .sort({ createdAt: 1 })
        .limit(10)
        .lean(),
    ]);

    const attentionMap = new Map();
    const addAttention = (doc, reason) => {
      const id = String(doc._id);
      const existing = attentionMap.get(id);
      if (existing) {
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        return;
      }
      attentionMap.set(id, {
        _id: id,
        title: doc.title,
        location: doc.location || "",
        slug: doc.slug,
        reasons: [reason],
      });
    };

    noPhotoDocs.forEach((doc) => addAttention(doc, "No photos"));
    badVideoDocs.forEach((doc) => {
      const vs = doc.videos?.[0]?.videoStatus;
      const label =
        vs === "failed" || vs === "error"
          ? "Video failed"
          : vs
            ? `Video ${vs}`
            : "Video stuck";
      addAttention(doc, label);
    });
    oldListingDocs.forEach((doc) => {
      const days = Math.max(
        90,
        Math.floor((now - new Date(doc.createdAt)) / 86400000)
      );
      addAttention(doc, `Listed ${days}+ days`);
    });
    const attention = [...attentionMap.values()].slice(0, 15);

    let adminPerformance = [];
    let wishlistTop = [];
    if (isSuper) {
      [adminPerformance, wishlistTop] = await Promise.all([
        Property.aggregate([
          {
            $group: {
              _id: "$createdBy",
              created: { $sum: 1 },
              active: {
                $sum: { $cond: [{ $eq: ["$isDeleted", false] }, 1, 0] },
              },
              forRent: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$isDeleted", false] },
                        { $eq: ["$status", "For Rent"] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              forSale: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$isDeleted", false] },
                        { $eq: ["$status", "For Sale"] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "_id",
              as: "user",
            },
          },
          { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              name: { $ifNull: ["$user.name", "Unknown"] },
              email: { $ifNull: ["$user.email", ""] },
              created: 1,
              active: 1,
              forRent: 1,
              forSale: 1,
            },
          },
          { $sort: { active: -1 } },
        ]),
        User.aggregate([
          { $unwind: "$wishlist" },
          { $group: { _id: "$wishlist", saves: { $sum: 1 } } },
          { $sort: { saves: -1 } },
          { $limit: 8 },
          {
            $lookup: {
              from: "properties",
              localField: "_id",
              foreignField: "_id",
              as: "property",
            },
          },
          { $unwind: "$property" },
          { $match: { "property.isDeleted": false } },
          {
            $project: {
              title: "$property.title",
              location: "$property.location",
              slug: "$property.slug",
              saves: 1,
            },
          },
        ]),
      ]);
    }

    res.status(200).json({
      success: true,
      data: {
        role: req.user.role,
        overview: {
          ...overview,
          medianRent,
          stuckVideos,
          listingsWithoutPhotos: noPhotoCount,
        },
        propertyTypeDistribution,
        statusDistribution,
        locationDistribution,
        bedroomDistribution,
        creationStats,
        attention,
        adminPerformance,
        wishlistTop,
      },
    });
  } catch (error) {
    console.error("Failed to get stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get stats",
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
  chunkUpload,
  getPropertyBySlug,
  initiateChunkedVideoUpload,
  uploadVideoChunk,
  completeChunkedVideoUpload,
  abortChunkedVideoUpload,
  getAdminStats,
};