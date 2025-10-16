// -----------------------------------------------------
// convertToMp4.js

const { runFfmpeg, ensureDir, safeDeleteSync } = require('./FfmpegHelper');
const path = require('path');

function safeFilename(name) { return name.replace(/[^a-zA-Z0-9-_\.]/g,'_'); }

async function convertToMp4(filePath, originalName, options = {}) {
  const outputDir = options.outputDir || process.env.CONVERTED_VIDEOS_DIR || 'uploads/converted-videos';
  const deleteOriginal = options.deleteOriginal === true;
  await ensureDir(outputDir);

  const cleanName = safeFilename(originalName.replace(/\.[^/.]+$/,''));
  const outputFilePath = path.join(outputDir, `${Date.now()}-${cleanName}.mp4`);

  try {
    await runFfmpeg(['-y','-v','error','-i',filePath,'-map','0:v','-map','0:a?','-c:v','copy','-c:a','aac','-b:a','128k','-movflags','+faststart', outputFilePath], { timeoutMs: 3*60*1000 });
    if (deleteOriginal) safeDeleteSync(filePath);
    return { outputPath: outputFilePath, finalName: `${cleanName}.mp4` };
  } catch {}

  await runFfmpeg(['-y','-v','error','-i',filePath,'-map','0:v','-map','0:a?','-c:v','libx264','-crf','18','-preset','fast','-c:a','aac','-b:a','128k','-movflags','+faststart',outputFilePath], { timeoutMs: 10*60*1000 });
  if (deleteOriginal) safeDeleteSync(filePath);
  return { outputPath: outputFilePath, finalName: `${cleanName}.mp4` };
}

module.exports = { convertToMp4 };
