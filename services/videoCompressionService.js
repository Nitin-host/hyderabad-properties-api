const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Get video file size in MB
 * @param {string} filePath - Path to video file
 * @returns {number} File size in MB
 */
const getFileSizeMB = (filePath) => {
  const stats = fs.statSync(filePath);
  return stats.size / (1024 * 1024); // Convert bytes to MB
};

/**
 * Get video metadata
 * @param {string} filePath - Path to video file
 * @returns {Promise<Object>} Video metadata
 */
const getVideoMetadata = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to get video metadata: ${err.message}`));
        return;
      }

      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');

      resolve({
        duration: metadata.format.duration,
        size: metadata.format.size,
        bitrate: metadata.format.bit_rate,
        video: videoStream ? {
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height,
          fps: eval(videoStream.r_frame_rate),
          bitrate: videoStream.bit_rate
        } : null,
        audio: audioStream ? {
          codec: audioStream.codec_name,
          bitrate: audioStream.bit_rate,
          sampleRate: audioStream.sample_rate
        } : null
      });
    });
  });
};

/**
 * Compress video file
 * @param {string} inputPath - Input video file path
 * @param {string} outputPath - Output video file path
 * @param {Object} options - Compression options
 * @returns {Promise<Object>} Compression result
 */
const compressVideo = (inputPath, outputPath, options = {}) => {
  return new Promise(async (resolve, reject) => {
    try {
      const metadata = await getVideoMetadata(inputPath);
      const originalSizeMB = getFileSizeMB(inputPath);

      // Default compression settings
      const defaultOptions = {
        videoBitrate: '1000k', // 1 Mbps
        audioBitrate: '128k',
        videoCodec: 'libx264',
        audioCodec: 'aac',
        preset: 'medium', // balance between speed and compression
        crf: 23, // Constant Rate Factor (18-28, lower = better quality)
        maxWidth: 1920,
        maxHeight: 1080
      };

      const settings = { ...defaultOptions, ...options };

      // Calculate target resolution while maintaining aspect ratio
      let targetWidth = metadata.video.width;
      let targetHeight = metadata.video.height;

      if (targetWidth > settings.maxWidth || targetHeight > settings.maxHeight) {
        const aspectRatio = targetWidth / targetHeight;
        if (targetWidth > targetHeight) {
          targetWidth = settings.maxWidth;
          targetHeight = Math.round(settings.maxWidth / aspectRatio);
        } else {
          targetHeight = settings.maxHeight;
          targetWidth = Math.round(settings.maxHeight * aspectRatio);
        }
      }

      // Ensure dimensions are even (required for some codecs)
      targetWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1;
      targetHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1;

      console.log(`Compressing video: ${originalSizeMB.toFixed(2)}MB`);
      console.log(`Original resolution: ${metadata.video.width}x${metadata.video.height}`);
      console.log(`Target resolution: ${targetWidth}x${targetHeight}`);

      const command = ffmpeg(inputPath)
        .videoCodec(settings.videoCodec)
        .audioCodec(settings.audioCodec)
        .videoBitrate(settings.videoBitrate)
        .audioBitrate(settings.audioBitrate)
        .size(`${targetWidth}x${targetHeight}`)
        .outputOptions([
          `-preset ${settings.preset}`,
          `-crf ${settings.crf}`,
          '-movflags +faststart', // Optimize for web streaming
          '-pix_fmt yuv420p' // Ensure compatibility
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`Compression progress: ${Math.round(progress.percent || 0)}%`);
        })
        .on('end', () => {
          const compressedSizeMB = getFileSizeMB(outputPath);
          const compressionRatio = ((originalSizeMB - compressedSizeMB) / originalSizeMB * 100).toFixed(2);
          
          console.log(`Compression completed!`);
          console.log(`Original size: ${originalSizeMB.toFixed(2)}MB`);
          console.log(`Compressed size: ${compressedSizeMB.toFixed(2)}MB`);
          console.log(`Compression ratio: ${compressionRatio}%`);

          resolve({
            success: true,
            originalSize: originalSizeMB,
            compressedSize: compressedSizeMB,
            compressionRatio: parseFloat(compressionRatio),
            originalPath: inputPath,
            compressedPath: outputPath,
            metadata: {
              duration: metadata.duration,
              originalResolution: `${metadata.video.width}x${metadata.video.height}`,
              compressedResolution: `${targetWidth}x${targetHeight}`
            }
          });
        })
        .on('error', (err) => {
          console.error('Compression error:', err);
          reject(new Error(`Video compression failed: ${err.message}`));
        });

      command.run();
    } catch (error) {
      reject(new Error(`Compression setup failed: ${error.message}`));
    }
  });
};

/**
 * Process video for upload (compress if needed)
 * @param {string} inputPath - Input video file path
 * @param {number} maxSizeMB - Maximum file size in MB (default: 100)
 * @returns {Promise<Object>} Processing result
 */
const processVideoForUpload = async (inputPath, maxSizeMB = 100) => {
  try {
    const originalSizeMB = getFileSizeMB(inputPath);
    
    console.log(`Processing video: ${path.basename(inputPath)}`);
    console.log(`Original size: ${originalSizeMB.toFixed(2)}MB`);
    console.log(`Max allowed size: ${maxSizeMB}MB`);

    // If file is within size limit, return original
    if (originalSizeMB <= maxSizeMB) {
      console.log('Video is within size limit, no compression needed');
      return {
        success: true,
        compressed: false,
        finalPath: inputPath,
        originalSize: originalSizeMB,
        finalSize: originalSizeMB
      };
    }

    // Compress the video
    const outputPath = inputPath.replace(/\.(\w+)$/, '_compressed.$1');
    
    // Calculate compression settings based on target size
    const targetSizeMB = maxSizeMB * 0.9; // Target 90% of max size for safety
    const compressionFactor = targetSizeMB / originalSizeMB;
    
    let videoBitrate = '1000k';
    if (compressionFactor < 0.3) {
      videoBitrate = '500k'; // Aggressive compression
    } else if (compressionFactor < 0.6) {
      videoBitrate = '750k'; // Moderate compression
    }

    const compressionOptions = {
      videoBitrate,
      audioBitrate: '96k', // Lower audio bitrate for smaller files
      crf: compressionFactor < 0.3 ? 28 : 25, // Higher CRF for more compression
      preset: 'fast' // Faster compression
    };

    const result = await compressVideo(inputPath, outputPath, compressionOptions);
    
    // Clean up original file
    if (fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
    }

    return {
      success: true,
      compressed: true,
      finalPath: outputPath,
      originalSize: result.originalSize,
      finalSize: result.compressedSize,
      compressionRatio: result.compressionRatio,
      metadata: result.metadata
    };
  } catch (error) {
    console.error('Video processing error:', error);
    
    // Clean up files on error
    const outputPath = inputPath.replace(/\.(\w+)$/, '_compressed.$1');
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    
    throw new Error(`Video processing failed: ${error.message}`);
  }
};

/**
 * Create video thumbnail
 * @param {string} videoPath - Path to video file
 * @param {string} outputPath - Path for thumbnail output
 * @param {Object} options - Thumbnail options
 * @returns {Promise<string>} Thumbnail path
 */
const createThumbnail = (videoPath, outputPath, options = {}) => {
  return new Promise((resolve, reject) => {
    const defaultOptions = {
      timemarks: ['50%'], // Take screenshot at 50% of video
      size: '320x240',
      filename: path.basename(outputPath)
    };

    const settings = { ...defaultOptions, ...options };

    ffmpeg(videoPath)
      .screenshots({
        ...settings,
        folder: path.dirname(outputPath)
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        reject(new Error(`Thumbnail creation failed: ${err.message}`));
      });
  });
};

module.exports = {
  getFileSizeMB,
  getVideoMetadata,
  compressVideo,
  processVideoForUpload,
  createThumbnail
};