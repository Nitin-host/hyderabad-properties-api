// -----------------------------------------------------
// generateVideoThumbnail.js

const { runFfmpeg: runFfmpeg2, ensureDir: ensureDir2 } = require('./FfmpegHelper');
const path2 = require('path');

async function generateVideoThumbnail(videoPath, options={}) {
  const outputDir = options.outputDir || process.env.THUMBNAIL_DIR || 'uploads/video-thumbnails';
  const timestamp = options.timestamp || '00:00:01';
  const deleteOriginal = options.deleteOriginal === true;
  await ensureDir2(outputDir);

  const baseName = path2.parse(videoPath).name.replace(/[^a-zA-Z0-9-_\.]/g,'_');
  const thumbnailPath = path2.join(outputDir, `${Date.now()}-${baseName}.jpg`);

  await runFfmpeg2(['-y','-loglevel','error','-ss',timestamp,'-skip_frame','nokey','-i',videoPath,'-an','-vframes','1','-vf',"scale='if(gt(iw,1280),1280,iw)':-1",'-vsync','2','-q:v','3',thumbnailPath], { timeoutMs:2*60*1000 });

  if (deleteOriginal) safeDeleteSync(videoPath);
  return thumbnailPath;
}

module.exports = { generateVideoThumbnail };