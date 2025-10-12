const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

/**
 * Generate a video thumbnail and return its path.
 * @param {string} videoPath - Path to the video file
 * @param {string} outputDir - Directory to temporarily save thumbnail
 * @returns {Promise<string>} - Path of the generated thumbnail
 */
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || "uploads/video-thumbnails";
const generateVideoThumbnail = async (
  videoPath,
  outputDir = THUMBNAIL_DIR
) => {
  if (!fs.existsSync(videoPath)) {
    throw new Error("Video file does not exist");
  }

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = path.parse(videoPath).name;
  const thumbnailPath = path.join(
    outputDir,
    `${Date.now()}-${baseName}-thumbnail.png`
  );

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ["3%"],
        filename: path.basename(thumbnailPath),
        folder: outputDir,
        size: "320x240",
      })
      .on("end", () => {
        if (!fs.existsSync(thumbnailPath)) {
          return reject(new Error("Thumbnail generation failed"));
        }
        resolve(thumbnailPath);
      })
      .on("error", (err) => reject(err));
  });
};

module.exports = { generateVideoThumbnail };
