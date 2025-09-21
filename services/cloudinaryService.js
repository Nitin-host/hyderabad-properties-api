const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload image to Cloudinary
 * @param {string} filePath - Local file path
 * @param {string} folder - Cloudinary folder name
 * @param {Object} options - Additional upload options
 * @returns {Promise<Object>} Upload result
 */
const uploadImage = async (filePath, folder = 'properties/images', options = {}) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: 'image',
      quality: 'auto:good',
      fetch_format: 'auto',
      ...options
    });

    // Clean up local file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return {
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes
    };
  } catch (error) {
    console.error('Cloudinary image upload error:', error);
    
    // Clean up local file on error
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    throw new Error(`Image upload failed: ${error.message}`);
  }
};

/**
 * Upload video to Cloudinary
 * @param {string} filePath - Local file path
 * @param {string} folder - Cloudinary folder name
 * @param {Object} options - Additional upload options
 * @returns {Promise<Object>} Upload result
 */
const uploadVideo = async (
  filePath,
  folder = "properties/videos",
  options = {}
) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: "video", // upload raw video only
      ...options,
    });

    // Clean up local file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Generate a playback URL in mp4 format with auto quality (on-demand)
    const videoUrl = cloudinary.url(result.public_id, {
      resource_type: "video",
      format: "mp4",
      quality: "auto:good",
    });

    return {
      success: true,
      url: videoUrl, // use the transformed delivery URL
      publicId: result.public_id,
      duration: result.duration,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    };
  } catch (error) {
    console.error("Cloudinary video upload error:", error);

    // Clean up local file on error
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    throw new Error(`Video upload failed: ${error.message}`);
  }
};


/**
 * Delete file from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @param {string} resourceType - 'image' or 'video'
 * @returns {Promise<Object>} Deletion result
 */
const deleteFile = async (publicId, resourceType = 'image') => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });

    return {
      success: result.result === 'ok',
      result: result.result
    };
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error(`File deletion failed: ${error.message}`);
  }
};

/**
 * Get file info from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @param {string} resourceType - 'image' or 'video'
 * @returns {Promise<Object>} File info
 */
const getFileInfo = async (publicId, resourceType = 'image') => {
  try {
    const result = await cloudinary.api.resource(publicId, {
      resource_type: resourceType
    });

    return {
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes,
      createdAt: result.created_at,
      ...(resourceType === 'video' && { duration: result.duration }),
      ...(result.width && { width: result.width }),
      ...(result.height && { height: result.height })
    };
  } catch (error) {
    console.error('Cloudinary get file info error:', error);
    throw new Error(`Failed to get file info: ${error.message}`);
  }
};

/**
 * Generate transformation URL
 * @param {string} publicId - Cloudinary public ID
 * @param {Object} transformations - Transformation options
 * @param {string} resourceType - 'image' or 'video'
 * @returns {string} Transformed URL
 */
const getTransformedUrl = (publicId, transformations = {}, resourceType = 'image') => {
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    ...transformations
  });
};

/**
 * Upload multiple images
 * @param {Array} filePaths - Array of file paths
 * @param {string} folder - Cloudinary folder name
 * @returns {Promise<Array>} Array of upload results
 */
const uploadMultipleImages = async (filePaths, folder = 'properties/images') => {
  try {
    const uploadPromises = filePaths.map(filePath => 
      uploadImage(filePath, folder)
    );
    
    const results = await Promise.allSettled(uploadPromises);
    
    return results.map((result, index) => ({
      index,
      success: result.status === 'fulfilled',
      data: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason.message : null
    }));
  } catch (error) {
    console.error('Multiple image upload error:', error);
    throw new Error(`Multiple image upload failed: ${error.message}`);
  }
};

/**
 * Check if Cloudinary is configured
 * @returns {boolean} Configuration status
 */
const isConfigured = () => {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && 
           process.env.CLOUDINARY_API_KEY && 
           process.env.CLOUDINARY_API_SECRET);
};

module.exports = {
  uploadImage,
  uploadVideo,
  deleteFile,
  getFileInfo,
  getTransformedUrl,
  uploadMultipleImages,
  isConfigured,
  cloudinary
};