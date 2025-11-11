// -----------------------------------------------------
// ffmpegHelper.js (cross-platform + Railway safe)
// -----------------------------------------------------
const { spawn } = require("child_process");
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");

// 🧩 Use ffmpeg-static to avoid chmod permission issues
const FFMPEG_PATH = require("ffmpeg-static");
const { path: FFPROBE_PATH } = require("@ffprobe-installer/ffprobe");

// ✅ Log helper (enable with DEBUG_FFMPEG=true)
const DEBUG = process.env.DEBUG_FFMPEG === "true";
function log(...args) {
  if (DEBUG) console.log("[ffmpeg-helper]", ...args);
}

// ✅ Run ffmpeg safely with timeout + logs
function runFfmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs || 5 * 60 * 1000;

    const child = spawn(FFMPEG_PATH, ["-loglevel", "error", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts.cwd || process.cwd(),
    });

    let stderr = "";
    let stdout = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        log("ffmpeg timeout, killing process");
        if (!child.killed) child.kill("SIGKILL");
        finished = true;
        reject(new Error("ffmpeg timed out"));
      }
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      if (DEBUG) process.stdout.write(d);
      stdout += d.toString();
    });

    child.stderr.on("data", (d) => {
      if (DEBUG) process.stderr.write(d);
      stderr += d.toString();
    });

    child.on("error", (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(
        new Error(
          `ffmpeg exited code=${code} signal=${signal} stderr=${stderr.slice(
            0,
            2000
          )}`
        )
      );
    });
  });
}

// ✅ Ensure directory exists
async function ensureDir(dir) {
  await fsPromises.mkdir(dir, { recursive: true });
}

// ✅ Safe delete file if exists
function safeDeleteSync(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      if (DEBUG) console.log("Deleted:", filePath);
    } catch (err) {
      if (DEBUG) console.warn("Delete failed:", err.message);
    }
  }
}

module.exports = {
  runFfmpeg,
  FFMPEG_PATH,
  FFPROBE_PATH,
  ensureDir,
  safeDeleteSync,
  fsPromises,
};