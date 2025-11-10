// -----------------------------------------------------
// generateVideoThumbnail.js
// Safe, cross-platform thumbnail generator
// -----------------------------------------------------

const path = require("path");
const os = require("os");
const fs = require("fs");
const {
  runFfmpeg: runFfmpeg2,
  ensureDir: ensureDir2,
  safeDeleteSync,
} = require("./FfmpegHelper");

// Detect Railway environment
const isRailway = !!process.env.RAILWAY_ENVIRONMENT;

async function generateVideoThumbnail(videoPath, options = {}) {
  // ✅ Decide where to save thumbnails
  const outputDir = path.resolve(
    options.outputDir ||
      process.env.THUMBNAIL_DIR ||
      (isRailway
        ? path.join("/tmp", "video-thumbnails")
        : path.join(__dirname, "../uploads/video-thumbnails"))
  );

  const timestamp = options.timestamp || "00:00:00";
  const deleteOriginal = options.deleteOriginal === true;

  await ensureDir2(outputDir);

  const baseName = path.parse(videoPath).name.replace(/[^a-zA-Z0-9-_\.]/g, "_");

  const thumbnailPath = path.join(outputDir, `${Date.now()}-${baseName}.jpg`);

  // Normalize paths (esp. on Windows)
  const safeInput = videoPath.replace(/\\/g, "/");
  const safeOutput = thumbnailPath.replace(/\\/g, "/");

  await runFfmpeg2(
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      safeInput,
      "-ss",
      timestamp,
      "-frames:v",
      "1",
      "-an",
      "-vf",
      "scale='if(gt(iw,1280),1280,iw)':-1",
      "-q:v",
      "1",
      safeOutput,
    ],
    { timeoutMs: 2 * 60 * 1000 }
  );

  if (deleteOriginal) safeDeleteSync(videoPath);

  return thumbnailPath;
}

module.exports = { generateVideoThumbnail };