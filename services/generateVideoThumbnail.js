const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffmpegPath = ffmpegInstaller.path;

/**
 * Generate a video thumbnail and return its path.
 * RAM-optimized using child_process.spawn()
 * @param {string} videoPath - Path to the video file
 * @param {string} outputDir - Directory to temporarily save thumbnail
 * @returns {Promise<string>} - Path of the generated thumbnail
 */
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

      // Ensure output directory exists
      fs.mkdirSync(outputDir, { recursive: true });

      const baseName = path.parse(videoPath).name;
      const thumbnailPath = path.join(
        outputDir,
        `${Date.now()}-${baseName}-thumbnail.png`
      );

      // Spawn ffmpeg to extract thumbnail
      const ffmpeg = spawn(
        ffmpegPath,
        [
          "-y",
          "-i",
          videoPath,
          "-ss",
          "00:00:03",
          "-vframes",
          "1",
          "-q:v",
          "2",
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