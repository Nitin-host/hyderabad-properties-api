const { default: PQueue } = require("p-queue");
const dotenv = require("dotenv");
dotenv.config();

// Convert env var to number safely
const parsed = Number(process.env.VIDEO_UPLOAD_CONCURRENCY);
const concurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

const videoQueue = new PQueue({ concurrency });

function enqueueVideoUpload(taskFn) {
  return videoQueue.add(taskFn);
}

module.exports = { enqueueVideoUpload };
