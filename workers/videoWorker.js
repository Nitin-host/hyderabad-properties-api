// -----------------------------------------------------
// workers/videoWorker.js (improved quality for 1080p)
// -----------------------------------------------------
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

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
  FFPROBE_PATH,
} = require("../services/FfmpegHelper");

// --- Determine writable temp directory ---
const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
const TEMP_BASE = isRailway ? "/tmp" : os.tmpdir();

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
    : path.join(TEMP_BASE, "tempUploads", rawTempPath);

  const hlsOutputDir = path.join(TEMP_BASE, `hls-${propertyId}`);

  console.log(
    `🎥 Worker started for property: ${propertyId}, file: ${originalName}`
  );
  console.log("Resolved tempPath:", tempPath);

  let finalVideoPath = tempPath;
  let thumbnailPath = null;
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
        { deleteOriginal: false }
      );
      finalVideoPath = outputPath;
      console.log("✅ Converted to MP4:", finalName);
    } else {
      console.log("🎞️ Video already in MP4 format — skipping conversion.");
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
      console.log(
        `⏱️ Duration: ${duration.toFixed(1)}s — ${hlsSegmentDuration}s segments`
      );
    } catch (err) {
      console.warn("⚠️ Could not determine video duration:", err.message);
    }

    // 3️⃣ Generate HLS segments with improved encoding quality
    await ensureDir(hlsOutputDir);
    console.log("🎬 Generating HLS (enhanced quality)...");

    const args = [
      "-i",
      finalVideoPath,
      "-filter_complex",
      "[0:v]split=3[v1][v2][v3];" +
        "[v1]scale=-2:480[v1out];" +
        "[v2]scale=-2:720:flags=lanczos[v2out];" +
        "[v3]scale=-2:1080:flags=lanczos,unsharp=5:5:1.0:5:5:0.0[v3out]",

      // 480p (baseline)
      "-map",
      "[v1out]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-tune",
      "film",
      "-b:v",
      "1500k",
      "-maxrate",
      "1800k",
      "-bufsize",
      "3000k",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-f",
      "hls",
      "-hls_time",
      `${hlsSegmentDuration}`,
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      path.join(hlsOutputDir, "480p_%03d.ts"),
      path.join(hlsOutputDir, "480p.m3u8"),

      // 720p (medium)
      "-map",
      "[v2out]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-tune",
      "film",
      "-b:v",
      "3500k",
      "-maxrate",
      "4000k",
      "-bufsize",
      "6000k",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-f",
      "hls",
      "-hls_time",
      `${hlsSegmentDuration}`,
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      path.join(hlsOutputDir, "720p_%03d.ts"),
      path.join(hlsOutputDir, "720p.m3u8"),

      // 1080p (high quality)
      "-map",
      "[v3out]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-tune",
      "film",
      "-b:v",
      "8000k",
      "-maxrate",
      "8500k",
      "-bufsize",
      "12000k",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-pix_fmt",
      "yuv420p",
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

    await runFfmpeg(args, { cwd: hlsOutputDir, timeoutMs: 20 * 60 * 1000 });
    console.log("✅ HLS generation complete.");

    // 4️⃣ Create master playlist
    const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080
1080p.m3u8
`;
    fs.writeFileSync(path.join(hlsOutputDir, "master.m3u8"), masterPlaylist);

    // 5️⃣ Thumbnail + upload
    console.log("🖼️ Generating thumbnail...");
    thumbnailPath = await generateVideoThumbnail(finalVideoPath);
    console.log("✅ Thumbnail created:", thumbnailPath);

    console.log("☁️ Uploading to R2...");
    const files = fs.readdirSync(hlsOutputDir);
    for (const file of files) {
      const filePath = path.join(hlsOutputDir, file);
      if (!fs.existsSync(filePath)) continue;
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
      await uploadBuffer(
        fs.readFileSync(thumbnailPath),
        thumbKey,
        "image/jpeg"
      );
      uploadedKeys.push(thumbKey);
    }

    uploadCompleted = true;
    console.log("✅ Upload complete.");
  } catch (err) {
    console.error("❌ Worker failed:", err.message);
    for (const key of uploadedKeys) {
      try {
        await deleteFile(key);
      } catch {}
    }
    parentPort.postMessage({ success: false, error: err.message });
  } finally {
    console.log("🧹 Cleaning up temp files...");
    deleteFolderRecursive(hlsOutputDir);
    safeDeleteSync(thumbnailPath);
    safeDeleteSync(tempPath);
    if (finalVideoPath !== tempPath) safeDeleteSync(finalVideoPath);
    console.log("✅ Cleanup complete.");

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