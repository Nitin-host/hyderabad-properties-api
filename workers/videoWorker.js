// -----------------------------------------------------
// workers/videoWorker.js (improved quality for 1080p)
// -----------------------------------------------------
const { parentPort, workerData, isMainThread } = require("worker_threads");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const {
  uploadStream,
  uploadBuffer,
  deleteFile,
  downloadObjectToFile,
} = require("../services/r2Service");
const {
  generateVideoThumbnail,
} = require("../services/generateVideoThumbnail");
const { convertToMp4 } = require("../services/VideoConvertor");
const {
  runFfmpeg,
  ensureDir,
  safeDeleteSync,
  FFPROBE_PATH,
} = require("../services/FfmpegHelper");

// --- Determine writable temp directory ---
const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
const TEMP_BASE = isRailway ? "/tmp" : os.tmpdir();

function log(...args) {
  console.log("[video-worker]", ...args);
}

function warn(...args) {
  console.warn("[video-worker]", ...args);
}

function error(...args) {
  console.error("[video-worker]", ...args);
}

// --- Utility: sanitize filenames for R2 keys ---
function sanitizeKey(key) {
  return key ? key.replace(/[&<>"'`\\?%{}|^~[\] ]/g, "_") : "";
}

async function encodeHlsVariant({
  input,
  outputDir,
  height,
  name,
  videoBitrate,
  maxrate,
  bufsize,
  audioBitrate,
  preset,
  extraVf = "",
  segmentDuration,
  hasAudio = true,
}) {
  const vf = extraVf
    ? `scale=-2:${height},${extraVf}`
    : `scale=-2:${height}`;

  const args = [
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
  ];
  if (hasAudio) {
    args.push("-map", "0:a?");
  }
  args.push(
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-b:v",
    videoBitrate,
    "-maxrate",
    maxrate,
    "-bufsize",
    bufsize,
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "1",
    "-x264-params",
    "sliced-threads=0:rc-lookahead=10:sync-lookahead=0:ref=1:bframes=0:mbtree=0"
  );
  if (hasAudio) {
    args.push("-c:a", "aac", "-b:a", audioBitrate, "-ac", "2");
  } else {
    args.push("-an");
  }
  args.push(
    "-f",
    "hls",
    "-hls_time",
    `${segmentDuration}`,
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    path.join(outputDir, `${name}_%03d.ts`),
    path.join(outputDir, `${name}.m3u8`)
  );

  await runFfmpeg(args, { cwd: outputDir, timeoutMs: 40 * 60 * 1000 });
}

// --- Utility: recursively delete directory safely ---
function deleteFolderRecursive(folderPath) {
  if (fs.existsSync(folderPath)) {
    for (const file of fs.readdirSync(folderPath)) {
      const curPath = path.join(folderPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        safeDeleteSync(curPath);
      }
    }
    try {
      fs.rmdirSync(folderPath);
    } catch (err) {
      warn("⚠️ Failed to remove folder:", folderPath, err.message);
    }
  }
}

// --- Main encode job (worker thread or standalone processor) ---
async function processVideoJob(job = {}) {
  const originalName = job.originalName || "video.mp4";
  const sourceKey = job.sourceKey;
  const propertyId = job.propertyId;
  const rawTempPath = job.tempPath;

  let tempPath = rawTempPath
    ? path.isAbsolute(rawTempPath)
      ? rawTempPath
      : path.join(TEMP_BASE, "tempUploads", rawTempPath)
    : path.join(
        TEMP_BASE,
        `src-${propertyId}-${Date.now()}${path.extname(originalName) || ".mp4"}`
      );

  const hlsOutputDir = path.join(TEMP_BASE, `hls-${propertyId}`);
  deleteFolderRecursive(hlsOutputDir);

  log(
    `🎥 Worker started for property: ${propertyId}, file: ${originalName}`
  );
  if (sourceKey) log("Source R2 key:", sourceKey);
  else log("Resolved tempPath:", tempPath);

  let finalVideoPath = tempPath;
  let thumbnailPath = null;
  const uploadedKeys = [];
  let uploadCompleted = false;

  try {
    if (sourceKey) {
      log("⬇️ Downloading source video from R2...");
      await downloadObjectToFile(sourceKey, tempPath);
      log("✅ Source downloaded:", tempPath);
    }

    if (!fs.existsSync(tempPath)) {
      throw new Error(`Temp file not found: ${tempPath}`);
    }

    // 1️⃣ Convert to MP4 if needed
    const ext = path.extname(originalName).toLowerCase();
    if (ext !== ".mp4") {
      log("🔄 Converting non-MP4 video to MP4...");
      const { outputPath, finalName } = await convertToMp4(
        tempPath,
        originalName,
        { deleteOriginal: false }
      );
      finalVideoPath = outputPath;
      log("✅ Converted to MP4:", finalName);
    } else {
      log("🎞️ Video already in MP4 format — skipping conversion.");
    }

    // 2️⃣ Determine dynamic HLS segment duration
    let hlsSegmentDuration = 4;
    try {
      const durationStr = execSync(
        `"${FFPROBE_PATH}" -v error -show_entries format=duration -of csv=p=0 "${finalVideoPath}"`,
        { encoding: "utf-8" }
      );
      const duration = parseFloat(durationStr.trim());
      if (duration > 600) hlsSegmentDuration = 12;
      else if (duration > 300) hlsSegmentDuration = 10;
      else if (duration > 60) hlsSegmentDuration = 8;
      log(
        `⏱️ Duration: ${duration.toFixed(1)}s — ${hlsSegmentDuration}s segments`
      );
    } catch (err) {
      warn("⚠️ Could not determine video duration:", err.message);
    }

    let hasAudio = true;
    try {
      const audioStr = execSync(
        `"${FFPROBE_PATH}" -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "${finalVideoPath}"`,
        { encoding: "utf-8" }
      );
      hasAudio = audioStr.trim().length > 0;
    } catch {
      hasAudio = false;
    }

    await ensureDir(hlsOutputDir);
    log("🎬 Generating HLS variants sequentially (480p → 720p → 1080p)...");

    await encodeHlsVariant({
      input: finalVideoPath,
      outputDir: hlsOutputDir,
      height: 480,
      name: "480p",
      videoBitrate: "1500k",
      maxrate: "1800k",
      bufsize: "2000k",
      audioBitrate: "128k",
      preset: "veryfast",
      segmentDuration: hlsSegmentDuration,
      hasAudio,
    });
    log("✅ 480p ready");

    await encodeHlsVariant({
      input: finalVideoPath,
      outputDir: hlsOutputDir,
      height: 720,
      name: "720p",
      videoBitrate: "3500k",
      maxrate: "4000k",
      bufsize: "4000k",
      audioBitrate: "160k",
      preset: "veryfast",
      segmentDuration: hlsSegmentDuration,
      hasAudio,
    });
    log("✅ 720p ready");

    const Property = require("../models/Property");
    const live = await Property.findById(propertyId).select("isDeleted").lean();
    if (!live || live.isDeleted) {
      return {
        success: false,
        error: "Property was deleted before encode finished",
      };
    }

    await encodeHlsVariant({
      input: finalVideoPath,
      outputDir: hlsOutputDir,
      height: 1080,
      name: "1080p",
      videoBitrate: "5000k",
      maxrate: "5500k",
      bufsize: "6000k",
      audioBitrate: "192k",
      preset: "veryfast",
      segmentDuration: hlsSegmentDuration,
      hasAudio,
    });
    log("✅ 1080p ready");

    // 4️⃣ Create master playlist
    const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8
`;
    fs.writeFileSync(path.join(hlsOutputDir, "master.m3u8"), masterPlaylist);

    // 5️⃣ Thumbnail + upload
    log("🖼️ Generating thumbnail...");
    thumbnailPath = await generateVideoThumbnail(finalVideoPath);
    log("✅ Thumbnail created:", thumbnailPath);

    log("☁️ Uploading to R2...");
    const files = fs.readdirSync(hlsOutputDir);
    const uploadLimit = 4;
    let uploadIndex = 0;

    async function uploadNext() {
      while (uploadIndex < files.length) {
        const file = files[uploadIndex++];
        const filePath = path.join(hlsOutputDir, file);
        if (!fs.existsSync(filePath)) continue;
        const mimeType = file.endsWith(".m3u8")
          ? "application/x-mpegURL"
          : "video/MP2T";
        const key = sanitizeKey(`properties/${propertyId}/videos/${file}`);
        await uploadStream(fs.createReadStream(filePath), key, mimeType);
        uploadedKeys.push(key);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(uploadLimit, files.length) }, () =>
        uploadNext()
      )
    );

    if (fs.existsSync(thumbnailPath)) {
      const thumbKey = sanitizeKey(
        `properties/${propertyId}/videos/thumbnails/${path.basename(
          thumbnailPath
        )}`
      );
      await uploadBuffer(
        fs.readFileSync(thumbnailPath),
        thumbKey,
        "image/jpeg"
      );
      uploadedKeys.push(thumbKey);
    }

    uploadCompleted = true;
    log("✅ Upload complete.");
  } catch (err) {
    error("❌ Worker failed:", err.message);
    for (const key of uploadedKeys) {
      try {
        await deleteFile(key);
      } catch {}
    }
    return { success: false, error: err.message };
  } finally {
    log("🧹 Cleaning up temp files...");
    deleteFolderRecursive(hlsOutputDir);
    safeDeleteSync(thumbnailPath);
    safeDeleteSync(tempPath);
    if (finalVideoPath !== tempPath) safeDeleteSync(finalVideoPath);
    log("✅ Cleanup complete.");
  }

  return {
    success: true,
    sourceKey: sourceKey || null,
    masterKey: `properties/${propertyId}/videos/master.m3u8`,
    thumbKey: `properties/${propertyId}/videos/thumbnails/${path.basename(
      thumbnailPath
    )}`,
    qualityKeys: {
      "480p": `properties/${propertyId}/videos/480p.m3u8`,
      "720p": `properties/${propertyId}/videos/720p.m3u8`,
      "1080p": `properties/${propertyId}/videos/1080p.m3u8`,
    },
  };
}

if (!isMainThread && parentPort) {
  processVideoJob(workerData)
    .then((result) => parentPort.postMessage(result))
    .catch((err) =>
      parentPort.postMessage({ success: false, error: err.message })
    );
}

module.exports = { processVideoJob };