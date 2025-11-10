// -----------------------------------------------------
// convertToMp4.js
// Safe, cross-platform FFmpeg video conversion utility
// -----------------------------------------------------

const path = require("path");
const fs = require("fs");
const os = require("os");
const { runFfmpeg, ensureDir, safeDeleteSync } = require("./FfmpegHelper");

const isRailway = !!process.env.RAILWAY_ENVIRONMENT;

// --- Clean up unsafe characters for filenames
function safeFilename(name) {
  return name.replace(/[^a-zA-Z0-9-_\.]/g, "_");
}

// --- Main conversion function
async function convertToMp4(filePath, originalName, options = {}) {
  // ✅ Cross-platform writable output directory
  const outputDir = path.resolve(
    options.outputDir ||
      process.env.CONVERTED_VIDEOS_DIR ||
      (isRailway
        ? path.join("/tmp", "converted-videos")
        : path.join(__dirname, "../uploads/converted-videos"))
  );

  await ensureDirSafe(outputDir);

  const deleteOriginal = options.deleteOriginal === true;
  const baseName = path.basename(originalName, path.extname(originalName));
  const cleanName = safeFilename(baseName);
  const outputFilePath = path.join(outputDir, `${Date.now()}-${cleanName}.mp4`);

  const safeInput = filePath.replace(/\\/g, "/");
  const safeOutput = outputFilePath.replace(/\\/g, "/");

  try {
    // Try fast remux first
    await runFfmpeg(
      [
        "-y",
        "-v",
        "error",
        "-i",
        safeInput,
        "-map",
        "0:v",
        "-map",
        "0:a?",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        safeOutput,
      ],
      { timeoutMs: 3 * 60 * 1000 }
    );

    if (deleteOriginal) safeDeleteSync(filePath);
    return { outputPath: outputFilePath, finalName: `${cleanName}.mp4` };
  } catch (err) {
    console.warn("⚠️ Fast copy failed, re-encoding instead:", err.message);
  }

  // Fallback: full re-encode
  await runFfmpeg(
    [
      "-y",
      "-v",
      "error",
      "-i",
      safeInput,
      "-map",
      "0:v",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "medium",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      safeOutput,
    ],
    { timeoutMs: 10 * 60 * 1000 }
  );

  if (deleteOriginal) safeDeleteSync(filePath);
  return { outputPath: outputFilePath, finalName: `${cleanName}.mp4` };
}

// --- Ensure output directory exists safely
async function ensureDirSafe(dirPath) {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
}

module.exports = { convertToMp4 };