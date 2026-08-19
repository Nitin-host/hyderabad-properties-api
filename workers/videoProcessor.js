require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const Property = require("../models/Property");
const { deleteFile, deletePropertyMedia } = require("../services/r2Service");
const { startPeerWatch } = require("../services/serviceConnect");
const { processVideoJob } = require("./videoWorker");

const POLL_MS = Number(process.env.VIDEO_WORKER_POLL_MS) || 4000;
const PORT = Number(process.env.PORT || process.env.VIDEO_WORKER_PORT || 5100);
const SECRET = process.env.VIDEO_WORKER_SECRET || "";
const API_URL = process.env.API_URL || "";

let lastJob = null;
let workChain = Promise.resolve();
let pendingCount = 0;
let apiPeer = {
  name: "api",
  url: API_URL,
  connected: false,
};

function log(message) {
  console.log(`[video-worker] ${message}`);
}

function warn(message) {
  console.warn(`[video-worker] ${message}`);
}

function error(message) {
  console.error(`[video-worker] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBusy() {
  return pendingCount > 0;
}

function enqueueExclusive(fn) {
  pendingCount += 1;
  const run = workChain.then(fn, fn);
  workChain = run.then(
    () => undefined,
    () => undefined
  );
  return run.finally(() => {
    pendingCount = Math.max(0, pendingCount - 1);
  });
}

function auth(req, res, next) {
  if (!SECRET) return next();
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== SECRET) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
}

function videoResult(property) {
  const video = property?.videos?.[0] || null;
  if (!video) return null;
  return {
    propertyId: String(property._id),
    status: video.videoStatus,
    originalName: video.originalName || null,
    masterKey: video.masterKey || null,
    thumbnailKey: video.thumbnailKey || null,
    qualityKeys: video.qualityKeys || null,
    errorMessage: video.errorMessage || null,
  };
}

async function recoverStuckJobs() {
  const reset = await Property.updateMany(
    {
      videos: {
        $elemMatch: {
          videoStatus: "processing",
          sourceKey: { $exists: true, $nin: [null, ""] },
        },
      },
    },
    { $set: { "videos.$[v].videoStatus": "queued" } },
    {
      arrayFilters: [
        { "v.videoStatus": "processing", "v.sourceKey": { $gt: "" } },
      ],
    }
  );

  const lost = await Property.updateMany(
    {
      videos: {
        $elemMatch: {
          videoStatus: "processing",
          $or: [
            { sourceKey: { $exists: false } },
            { sourceKey: null },
            { sourceKey: "" },
          ],
        },
      },
    },
    {
      $set: {
        "videos.$[v].videoStatus": "error",
        "videos.$[v].errorMessage":
          "Worker restarted before encode finished",
      },
    },
    { arrayFilters: [{ "v.videoStatus": "processing" }] }
  );

  if (reset.modifiedCount || lost.modifiedCount) {
    log(
      `Recovered stuck jobs: requeued=${reset.modifiedCount || 0}, failed=${lost.modifiedCount || 0}`
    );
  }
}

async function claimNextJob(propertyId) {
  const filter = {
    isDeleted: false,
    videos: {
      $elemMatch: {
        videoStatus: propertyId
          ? { $in: ["queued", "error", "failed"] }
          : "queued",
        sourceKey: { $exists: true, $nin: [null, ""] },
      },
    },
  };
  if (propertyId) filter._id = propertyId;

  return Property.findOneAndUpdate(
    filter,
    { $set: { "videos.$.videoStatus": "processing" } },
    { new: true }
  );
}

async function markResult(propertyId, result) {
  if (result.success) {
    await Property.findOneAndUpdate(
      { _id: propertyId, "videos.videoStatus": { $in: ["queued", "processing"] } },
      {
        $set: {
          "videos.$.videoStatus": "completed",
          "videos.$.masterKey": result.masterKey,
          "videos.$.thumbnailKey": result.thumbKey,
          "videos.$.qualityKeys": result.qualityKeys,
          "videos.$.sourceKey": "",
          "videos.$.errorMessage": "",
        },
      }
    );
    if (result.sourceKey) {
      try {
        await deleteFile(result.sourceKey);
      } catch (err) {
        warn(`Failed to delete source video: ${err.message}`);
      }
    }
    return;
  }

  await Property.findOneAndUpdate(
    { _id: propertyId, "videos.videoStatus": { $in: ["queued", "processing"] } },
    {
      $set: {
        "videos.$.videoStatus": "error",
        "videos.$.errorMessage": result.error || "Video processing failed",
      },
    }
  );
}

async function runClaimedJob(property) {
  const video =
    (property.videos || []).find((v) => v.videoStatus === "processing") ||
    property.videos[0];
  const propertyId = property._id.toString();

  lastJob = {
    propertyId,
    originalName: video.originalName || video.sourceKey,
    startedAt: new Date().toISOString(),
    status: "processing",
  };

  log(`▶️ Job ${propertyId}: ${lastJob.originalName}`);
  let result;
  try {
    result = await processVideoJob({
      sourceKey: video.sourceKey,
      originalName: video.originalName || "video.mp4",
      propertyId,
    });
  } catch (err) {
    result = { success: false, error: err.message };
  }

  if (result.success) {
    const stillThere = await Property.findById(propertyId)
      .select("isDeleted")
      .lean();
    if (!stillThere || stillThere.isDeleted) {
      await deletePropertyMedia(propertyId).catch((err) =>
        warn(`Failed to purge media after deleted encode: ${err.message}`)
      );
      lastJob = {
        ...lastJob,
        finishedAt: new Date().toISOString(),
        status: "skipped",
        error: "Property was deleted",
      };
      return lastJob;
    }
  }

  await markResult(propertyId, result);

  lastJob = {
    ...lastJob,
    finishedAt: new Date().toISOString(),
    status: result.success ? "completed" : "error",
    error: result.error || null,
    masterKey: result.masterKey || null,
    thumbnailKey: result.thumbKey || null,
    qualityKeys: result.qualityKeys || null,
  };

  log(
    result.success
      ? `✅ Uploaded HLS back for ${propertyId}`
      : `❌ Failed ${propertyId}: ${result.error}`
  );
  return lastJob;
}

async function pollLoop() {
  while (true) {
    try {
      if (!isBusy()) {
        const property = await claimNextJob();
        if (property) {
          enqueueExclusive(() => runClaimedJob(property));
          continue;
        }
      }
    } catch (err) {
      error(`Worker loop error: ${err.message}`);
    }
    await sleep(POLL_MS);
  }
}

async function start() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required for the video worker");
  }

  const conn = await mongoose.connect(process.env.MONGO_URI);
  log(`CONNECTED  MongoDB  ${conn.connection.host}`);
  await recoverStuckJobs();

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      success: true,
      service: "video-worker",
      busy: isBusy(),
      lastJob,
      qualities: ["480p", "720p", "1080p"],
      api: {
        url: apiPeer.url || null,
        connected: Boolean(apiPeer.connected),
        connectedAt: apiPeer.connectedAt || null,
        lastError: apiPeer.lastError || null,
      },
    });
  });

  app.get("/jobs/:propertyId", auth, async (req, res) => {
    const property = await Property.findById(req.params.propertyId).select(
      "videos"
    );
    if (!property) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }
    res.json({ success: true, data: videoResult(property) });
  });

  app.post("/jobs/:propertyId", auth, async (req, res) => {
    const property = await claimNextJob(req.params.propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "No queued source video found for this property",
      });
    }

    enqueueExclusive(() => runClaimedJob(property));
    res.status(202).json({
      success: true,
      message: "Job queued. 480p, 720p and 1080p will be uploaded when done.",
      data: { propertyId: req.params.propertyId, status: "processing" },
    });
  });

  const LISTEN_HOST = process.env.RAILWAY_ENVIRONMENT ? "::" : "0.0.0.0";
  app.listen(PORT, LISTEN_HOST, () => {
    log(`listening on :${PORT}`);
    apiPeer = startPeerWatch({
      from: "video-worker",
      name: "api",
      url: API_URL,
      healthPath: "/api/health",
      onChange: (status) => {
        apiPeer = status;
      },
    });
  });

  log(`polling Mongo every ${POLL_MS}ms`);
  pollLoop();
}

start().catch((err) => {
  error(`failed to start: ${err.message}`);
  process.exit(1);
});
