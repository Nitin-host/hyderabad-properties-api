const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffmpegPath = ffmpegInstaller.path;

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
      fs.mkdirSync(outputDir, { recursive: true });

      const cleanName = originalName.replace(/\.[^/.]+$/, ""); // remove extension
      const outputFilePath = path.join(
        outputDir,
        `${Date.now()}-${cleanName}.mp4`
      );

      console.log(
        "RAM before convertToMp4:",
        formatBytes(process.memoryUsage().rss)
      );

      // ✅ First attempt: Stream copy (no quality loss)
      const ffmpeg = spawn(
        ffmpegPath,
        [
          "-y",
          "-v",
          "error", // hide warnings
          "-i",
          filePath,
          "-map",
          "0:v", // map video stream
          "-map",
          "0:a?", // map audio stream if exists
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          outputFilePath,
        ],
        { stdio: ["ignore", "inherit", "inherit"] }
      );

      ffmpeg.on("close", (code) => {
        if (
          code === 0 &&
          fs.existsSync(outputFilePath) &&
          fs.statSync(outputFilePath).size > 200 * 1024
        ) {
          console.log("✅ Stream copy successful. FASTSTART enabled.");
          console.log(
            "RAM after convertToMp4:",
            formatBytes(process.memoryUsage().rss)
          );
          return resolve(outputFilePath);
        }

        console.warn(
          "⚠ Stream copy failed or file too small — re-encoding with H.264..."
        );

        if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);

        // 🚀 Fallback: Re-encode with visually lossless quality
        const reencode = spawn(
          ffmpegPath,
          [
            "-y",
            "-v",
            "error",
            "-i",
            filePath,
            "-map",
            "0:v",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-crf",
            "18", // visually lossless
            "-preset",
            "fast", // balance CPU vs speed
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            outputFilePath,
          ],
          { stdio: ["ignore", "inherit", "inherit"] }
        );

        reencode.on("close", (rc) => {
          if (rc === 0 && fs.existsSync(outputFilePath)) {
            console.log(
              "✅ Re-encode successful with faststart. File ready for web streaming."
            );
            console.log(
              "RAM after re-encode:",
              formatBytes(process.memoryUsage().rss)
            );
            return resolve(outputFilePath);
          } else {
            if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);
            return reject(new Error(`FFmpeg re-encode exited with code ${rc}`));
          }
        });
      });
    } catch (err) {
      reject(err);
    }
  });
};

// Helper function to format RAM usage
function formatBytes(bytes) {
  const sizes = ["Bytes", "KB", "MB", "GB"];
  if (bytes === 0) return "0 Bytes";
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

module.exports = { convertToMp4 };