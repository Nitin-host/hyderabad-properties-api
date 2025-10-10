const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const os = require("os");
const path = require("path");

const convertToMp4 = (buffer, originalName) => {
  return new Promise((resolve, reject) => {
    const tempInput = path.join(os.tmpdir(), `${Date.now()}-${originalName}`);
    const tempOutput = path.join(os.tmpdir(), `${Date.now()}-converted.mp4`);

    fs.writeFileSync(tempInput, buffer); // write uploaded buffer to temp file

    ffmpeg(tempInput)
      .output(tempOutput)
      .format("mp4")
      .on("end", () => {
        const convertedBuffer = fs.readFileSync(tempOutput); // read converted file
        fs.unlinkSync(tempInput); // cleanup input temp file
        fs.unlinkSync(tempOutput); // cleanup output temp file
        resolve(convertedBuffer);
      })
      .on("error", (err) => {
        fs.unlinkSync(tempInput);
        reject(err);
      })
      .run();
  });
};

module.exports = { convertToMp4 };
