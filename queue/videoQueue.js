const { default: PQueue } = require("p-queue");
const dotenv = require("dotenv");
dotenv.config();

// Convert env var to number safely
const concurrency = Number(process.env.VIDEO_UPLOAD_CONCURRENCY);

// Only process N uploads at a time
const videoQueue = new PQueue({ concurrency });

function enqueueVideoUpload(taskFn) {
  return videoQueue.add(taskFn);
}

module.exports = { enqueueVideoUpload };
