const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffmpegPath = ffmpegInstaller.path;

const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || "uploads/video-thumbnails";

const generateVideoThumbnail = (videoPath, outputDir = THUMBNAIL_DIR) => {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(videoPath))
        return reject(new Error("Video file does not exist"));

      console.log(
        "RAM before generateVideoThumbnail:",
        formatBytes(process.memoryUsage().rss)
      );

      fs.mkdirSync(outputDir, { recursive: true });

      const baseName = path.parse(videoPath).name;
      const thumbnailPath = path.join(
        outputDir,
        `${Date.now()}-${baseName}-thumbnail.jpg` // ✅ Use JPG for lightweight thumbnail
      );

      // ✅ FAST SEEK before -i (prevents keyframe warnings)
      // ✅ JPG instead of PNG (smaller & faster)
      // ✅ Skip audio and unnecessary decoding
      // ✅ Clean logs for production
      const ffmpeg = spawn(
        ffmpegPath,
        [
          "-y",
          "-loglevel",
          "error", // ✅ Hide logs except real errors
          "-ss",
          "00:00:03", // ✅ Fast seek (no missing keyframe warnings)
          "-skip_frame",
          "nokey", // ✅ Skip non-keyframes to speed up
          "-i",
          videoPath,
          "-an", // ✅ Disable audio processing completely
          "-vframes",
          "1",
          "-vf",
          "scale='if(gt(iw,1280),1280,iw)':-1", // ✅ Smart scaling (no upscale)
          "-vsync",
          "2",
          "-q:v",
          "3", // ✅ Good quality thumbnail (1 = best, 31 = worst)
          thumbnailPath,
        ],
        { stdio: ["ignore", "inherit", "inherit"] }
      );

      ffmpeg.on("error", reject);
      ffmpeg.on("close", (code) => {
        if (code !== 0)
          return reject(new Error(`FFmpeg exited with code ${code}`));
        if (!fs.existsSync(thumbnailPath))
          return reject(new Error("Thumbnail generation failed"));

        console.log(
          "RAM after generateVideoThumbnail:",
          formatBytes(process.memoryUsage().rss)
        );

        resolve(thumbnailPath);
      });
    } catch (err) {
      reject(err);
    }
  });
};

// Helper to format memory usage
function formatBytes(bytes) {
  const sizes = ["Bytes", "KB", "MB", "GB"];
  if (bytes === 0) return "0 Bytes";
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

module.exports = { generateVideoThumbnail };