const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const generateVideoThumbnail = async (videoBuffer, originalVideoName) => {
  const tempDir = path.join(__dirname, "uploads", "temp");
  fs.mkdirSync(tempDir, { recursive: true });

  const tempVideoPath = path.join(
    tempDir,
    `${Date.now()}-${originalVideoName}`
  );
  const baseName = path.parse(originalVideoName).name;
  const tempThumbnailPath = path.join(tempDir, `${baseName}-thumbnail.png`);

  fs.writeFileSync(tempVideoPath, videoBuffer);

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(tempVideoPath, (err, metadata) => {
      if (err) {
        fs.unlinkSync(tempVideoPath);
        return reject(err);
      }

      const duration = metadata.format.duration || 1;
      const captureTime = Math.min(3, duration);

      ffmpeg(tempVideoPath)
        .screenshots({
          timestamps: [captureTime],
          filename: path.basename(tempThumbnailPath),
          folder: tempDir,
          size: "320x240",
        })
        .on("end", () => {
          try {
            const thumbBuffer = fs.readFileSync(tempThumbnailPath);

            // ✅ Cleanup temp video & temp thumbnail
            fs.unlinkSync(tempVideoPath);
            fs.unlinkSync(tempThumbnailPath);

            resolve(thumbBuffer); // return buffer to upload to R2
          } catch (readErr) {
            if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
            if (fs.existsSync(tempThumbnailPath))
              fs.unlinkSync(tempThumbnailPath);
            reject(readErr);
          }
        })
        .on("error", (ffmpegErr) => {
          if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
          if (fs.existsSync(tempThumbnailPath))
            fs.unlinkSync(tempThumbnailPath);
          reject(ffmpegErr);
        });
    });
  });
};

module.exports = { generateVideoThumbnail };
