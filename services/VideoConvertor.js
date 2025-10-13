const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg"); // use npm ffmpeg binary
const ffmpegPath = ffmpegInstaller.path;

/**
 * Convert any video file to MP4 and save temporarily in a folder.
 * RAM-optimized using child_process.spawn()
 * @param {string} filePath - Original video path
 * @param {string} originalName - Original file name
 * @param {string} outputDir - Folder to save converted video
 * @returns {Promise<string>} - Path to converted MP4
 */
const CONVERTED_VIDEOS_DIR =
  process.env.CONVERTED_VIDEOS_DIR || "uploads/converted-videos";
const convertToMp4 = (
  filePath,
  originalName,
  outputDir = CONVERTED_VIDEOS_DIR
) => {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(filePath))
        return reject(new Error("File does not exist"));

      // Ensure output directory exists
      fs.mkdirSync(outputDir, { recursive: true });

      const outputFilePath = path.join(
        outputDir,
        `${Date.now()}-${originalName.replace(/\.[^/.]+$/, "")}.mp4`
      );

      console.log(
        "RAM before convertToMp4:",
        formatBytes(process.memoryUsage().rss)
      );

      // Spawn ffmpeg process (memory-efficient)
      const ffmpeg = spawn(
        ffmpegPath,
        [
          "-y",
          "-i",
          filePath,
          "-vcodec",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "28",
          "-movflags",
          "faststart",
          outputFilePath,
        ],
        { stdio: ["ignore", "inherit", "inherit"] }
      );

      ffmpeg.on("error", reject);
      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);
          return reject(new Error(`FFmpeg exited with code ${code}`));
        }

        console.log(
          "RAM after convertToMp4:",
          formatBytes(process.memoryUsage().rss)
        );

        resolve(outputFilePath);
      });
    } catch (err) {
      reject(err);
    }
  });
};

// Helper to format memory
function formatBytes(bytes) {
  const sizes = ["Bytes", "KB", "MB", "GB"];
  if (bytes === 0) return "0 Bytes";
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

module.exports = { convertToMp4 };