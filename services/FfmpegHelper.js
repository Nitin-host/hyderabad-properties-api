// ffmpegHelper.js
// A small utility to run ffmpeg safely with optional debug logs.
// Usage: const { runFfmpeg } = require('./ffmpegHelper');

const { spawn } = require('child_process');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

const FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path;
const DEBUG = process.env.DEBUG_FFMPEG === 'true';

function log(...args) {
  if (DEBUG) console.log('[ffmpeg-helper]', ...args);
}

function runFfmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs || 5 * 60 * 1000;
    const child = spawn(FFMPEG_PATH, args, { stdio: ['ignore','pipe','pipe'], cwd: opts.cwd || process.cwd() });
    let stderr = '';
    let stdout = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        log('ffmpeg timeout, killing process');
        if (!child.killed) child.kill('SIGKILL');
        finished = true;
        reject(new Error('ffmpeg timed out'));
      }
    }, timeoutMs);

    child.stdout.on('data', (d) => { if (DEBUG) process.stdout.write(d); stdout += d.toString(); });
    child.stderr.on('data', (d) => { if (DEBUG) process.stderr.write(d); stderr += d.toString(); });

    child.on('error', (err) => { if (!finished) { finished = true; clearTimeout(timer); reject(err); } });
    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`ffmpeg exited code=${code} signal=${signal} stderr=${stderr.slice(0,2000)}`));
    });
  });
}

async function ensureDir(dir) { await fsPromises.mkdir(dir, { recursive: true }); }
function safeDeleteSync(filePath) { if (filePath && fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); if (DEBUG) console.log('Deleted:', filePath); } catch {} } }

module.exports = { runFfmpeg, FFMPEG_PATH, ensureDir, safeDeleteSync, fsPromises };