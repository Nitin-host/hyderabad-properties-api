// -----------------------------------------------------
// workers/videoWorker.js
// Complete HLS transcoding worker with ffmpeg + ffprobe support
// -----------------------------------------------------

const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ✅ Use npm-installed ffmpeg & ffprobe binaries
const ffprobePath = require("@ffprobe-installer/ffprobe").path;

const {
  uploadStream,
  uploadBuffer,
  deleteFile,
} = require("../services/r2Service");
const {
  generateVideoThumbnail,
} = require("../services/generateVideoThumbnail");
const { convertToMp4 } = require("../services/VideoConvertor");
const {
  runFfmpeg,
  ensureDir,
  safeDeleteSync,
} = require("../services/FfmpegHelper");

// --- Utility: sanitize filenames for R2 keys ---
function sanitizeKey(key) {
  return key ? key.replace(/[&<>"'`\\?%{}|^~[\] ]/g, "_") : "";
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
      console.warn("⚠️ Failed to remove folder:", folderPath, err.message);
    }
  }
}

// --- Main Worker Execution ---
(async () => {
  const { tempPath: rawTempPath, originalName, propertyId } = workerData;
  const tempPath = path.isAbsolute(rawTempPath)
    ? rawTempPath
    : path.join(__dirname, "../", rawTempPath);

  console.log(
    `🎥 Worker started for property: ${propertyId}, file: ${originalName}`
  );
  console.log("Resolved tempPath:", tempPath);

  let finalVideoPath = tempPath;
  let thumbnailPath = null;
  const hlsOutputDir = path.join(__dirname, `../uploads/hls-${propertyId}`);
  const uploadedKeys = [];
  let uploadCompleted = false;

  try {
    if (!fs.existsSync(tempPath)) {
      throw new Error(`Temp file not found: ${tempPath}`);
    }

    // 1️⃣ Convert to MP4 if needed
    const ext = path.extname(originalName).toLowerCase();
    if (ext !== ".mp4") {
      console.log("🔄 Converting non-MP4 video to MP4...");
      const { outputPath, finalName } = await convertToMp4(
        tempPath,
        originalName,
        {
          deleteOriginal: false,
        }
      );
      finalVideoPath = outputPath;
      console.log("✅ Converted to MP4:", finalName);
    } else {
      console.log("🎞️ Video already in MP4 format — skipping conversion.");
    }

    // 2️⃣ Determine dynamic HLS segment duration
    let hlsSegmentDuration = 4; // default
    try {
      const durationStr = execSync(
        `"${ffprobePath}" -v error -show_entries format=duration -of csv=p=0 "${finalVideoPath}"`,
        { encoding: "utf-8" }
      );
      const duration = parseFloat(durationStr.trim());
      if (duration > 600) hlsSegmentDuration = 12;
      else if (duration > 300) hlsSegmentDuration = 10;
      else if (duration > 60) hlsSegmentDuration = 8;
      else hlsSegmentDuration = 4;

      console.log(
        `⏱️ Video duration: ${duration.toFixed(
          1
        )}s — using ${hlsSegmentDuration}s HLS segments.`
      );
    } catch (err) {
      console.warn("⚠️ Could not determine video duration:", err.message);
    }

    // 3️⃣ Generate HLS segments (WITH AUDIO)
    await ensureDir(hlsOutputDir);
    console.log("🎬 Generating multi-quality HLS with audio...");

    const args = [
      "-i",
      finalVideoPath,
      "-filter_complex",
      "[0:v]split=3[v1][v2][v3];" +
        "[v1]scale=-2:480[v1out];" +
        "[v2]scale=-2:720[v2out];" +
        "[v3]scale=-2:1080[v3out]",

      // 480p
      "-map",
      "[v1out]",
      "-map",
      "0:a?",
      "-c:v",
      "h264",
      "-b:v",
      "800k",
      "-maxrate",
      "856k",
      "-bufsize",
      "1200k",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-preset",
      "fast",
      "-g",
      "48",
      "-sc_threshold",
      "0",
      "-f",
      "hls",
      "-hls_time",
      `${hlsSegmentDuration}`,
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      path.join(hlsOutputDir, "480p_%03d.ts"),
      path.join(hlsOutputDir, "480p.m3u8"),

      // 720p
      "-map",
      "[v2out]",
      "-map",
      "0:a?",
      "-c:v",
      "h264",
      "-b:v",
      "1400k",
      "-maxrate",
      "1498k",
      "-bufsize",
      "2100k",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-preset",
      "fast",
      "-g",
      "48",
      "-sc_threshold",
      "0",
      "-f",
      "hls",
      "-hls_time",
      `${hlsSegmentDuration}`,
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      path.join(hlsOutputDir, "720p_%03d.ts"),
      path.join(hlsOutputDir, "720p.m3u8"),

      // 1080p
      "-map",
      "[v3out]",
      "-map",
      "0:a?",
      "-c:v",
      "h264",
      "-b:v",
      "2800k",
      "-maxrate",
      "2996k",
      "-bufsize",
      "4200k",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-preset",
      "fast",
      "-g",
      "48",
      "-sc_threshold",
      "0",
      "-f",
      "hls",
      "-hls_time",
      `${hlsSegmentDuration}`,
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      path.join(hlsOutputDir, "1080p_%03d.ts"),
      path.join(hlsOutputDir, "1080p.m3u8"),
    ];

    await runFfmpeg(args, { cwd: hlsOutputDir, timeoutMs: 15 * 60 * 1000 });
    console.log("✅ HLS generation completed (with audio).");

    // 4️⃣ Create master playlist
    const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080
1080p.m3u8
`;
    const masterPath = path.join(hlsOutputDir, "master.m3u8");
    fs.writeFileSync(masterPath, masterPlaylist);

    // 5️⃣ Generate thumbnail
    console.log("🖼️ Generating thumbnail...");
    thumbnailPath = await generateVideoThumbnail(finalVideoPath);
    console.log("✅ Thumbnail created:", thumbnailPath);

    // 6️⃣ Upload to R2
    console.log("☁️ Uploading HLS and thumbnail to R2...");
    const files = fs.readdirSync(hlsOutputDir);

    for (const file of files) {
      const filePath = path.join(hlsOutputDir, file);

      // ✅ Ensure file exists before uploading
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ Skip upload — file not found: ${filePath}`);
        continue;
      }

      const mimeType = file.endsWith(".m3u8")
        ? "application/x-mpegURL"
        : "video/MP2T";

      const key = sanitizeKey(`properties/${propertyId}/videos/${file}`);
      await uploadStream(fs.createReadStream(filePath), key, mimeType);
      uploadedKeys.push(key);
    }

    if (fs.existsSync(thumbnailPath)) {
      const thumbKey = sanitizeKey(
        `properties/${propertyId}/videos/thumbnails/${path.basename(
          thumbnailPath
        )}`
      );
      const thumbBuffer = fs.readFileSync(thumbnailPath);
      await uploadBuffer(thumbBuffer, thumbKey, "image/jpeg");
      uploadedKeys.push(thumbKey);
    } else {
      console.warn("⚠️ Thumbnail file missing, skipping upload.");
    }

    uploadCompleted = true;
    console.log("✅ Upload complete. Proceeding to cleanup...");

    // 🕒 Add slight delay before cleanup to ensure upload streams close
    await new Promise((resolve) => setTimeout(resolve, 800));
  } catch (err) {
    console.error("❌ Worker failed:", err.message);

    // Rollback uploaded files
    for (const key of uploadedKeys) {
      try {
        await deleteFile(key);
      } catch (e) {
        console.warn(`⚠️ Failed to delete ${key}:`, e.message);
      }
    }

    parentPort.postMessage({ success: false, error: err.message });
  } finally {
    try {
      console.log(
        uploadCompleted
          ? "🧹 Upload successful — deleting local temp files..."
          : "🧹 Upload failed — cleaning up partial files..."
      );
      deleteFolderRecursive(hlsOutputDir);
      safeDeleteSync(thumbnailPath);
      safeDeleteSync(tempPath);
      if (finalVideoPath !== tempPath) safeDeleteSync(finalVideoPath);
      console.log("✅ Local cleanup complete.");
    } catch (cleanupErr) {
      console.warn("⚠️ Cleanup warning:", cleanupErr.message);
    }

    if (uploadCompleted) {
      parentPort.postMessage({
        success: true,
        masterKey: `properties/${propertyId}/videos/master.m3u8`,
        thumbKey: `properties/${propertyId}/videos/thumbnails/${path.basename(
          thumbnailPath
        )}`,
        qualityKeys: {
          "480p": `properties/${propertyId}/videos/480p.m3u8`,
          "720p": `properties/${propertyId}/videos/720p.m3u8`,
          "1080p": `properties/${propertyId}/videos/1080p.m3u8`,
        },
      });
    }
  }
})();