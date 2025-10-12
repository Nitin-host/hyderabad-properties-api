const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");

/**
 * Convert any video file to MP4 and save temporarily in a folder.
 * @param {string} filePath - Original video path
 * @param {string} originalName - Original file name
 * @param {string} outputDir - Folder to save converted video
 * @returns {Promise<string>} - Path to converted MP4
 */
const convertToMp4 = (
  filePath,
  originalName,
  outputDir = "uploads/converted-videos"
) => {
  return new Promise((resolve, reject) => {
    // Ensure output directory exists
    fs.mkdirSync(outputDir, { recursive: true });

    const outputFilePath = path.join(
      outputDir,
      `${Date.now()}-${originalName.replace(/\.[^/.]+$/, "")}.mp4`
    );

    ffmpeg(filePath)
      .output(outputFilePath)
      .format("mp4")
      .on("end", () => {
        resolve(outputFilePath); // ✅ Return converted file path
      })
      .on("error", (err) => {
        if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);
        reject(err);
      })
      .run();
  });
};

module.exports = { convertToMp4 };