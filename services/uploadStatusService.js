const Property = require('../models/Property');

/**
 * Upload Status Service
 * Manages upload status tracking for social media platforms
 */
class UploadStatusService {
  /**
   * Initialize upload status for a video
   * @param {string} propertyId - Property ID
   * @param {string} videoIndex - Video index in the property's videos array
   * @param {Array} platforms - Selected platforms for upload
   * @returns {Promise<Object>} Initial status object
   */
  static async initializeUploadStatus(propertyId, videoIndex, platforms) {
    try {
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new Error('Property not found');
      }

      if (!property.videos[videoIndex]) {
        throw new Error('Video not found');
      }

      // Initialize status for selected platforms
      const socialMediaStatus = {};
      
      if (platforms.includes('youtube')) {
        socialMediaStatus.youtube = {
          status: 'pending',
          uploadedAt: null,
          platformUrl: null,
          platformId: null,
          error: null
        };
      }

      if (platforms.includes('facebook')) {
        socialMediaStatus.facebook = {
          status: 'pending',
          uploadedAt: null,
          platformUrl: null,
          platformId: null,
          error: null
        };
      }

      if (platforms.includes('instagram')) {
        socialMediaStatus.instagram = {
          status: 'pending',
          uploadedAt: null,
          platformUrl: null,
          platformId: null,
          error: null
        };
      }

      // Update the video's social media status
      property.videos[videoIndex].socialMediaStatus = socialMediaStatus;
      await property.save();

      console.log(`Upload status initialized for property ${propertyId}, video ${videoIndex}`);
      return socialMediaStatus;
    } catch (error) {
      console.error('Initialize upload status error:', error);
      throw new Error(`Failed to initialize upload status: ${error.message}`);
    }
  }

  /**
   * Update upload status for a specific platform
   * @param {string} propertyId - Property ID
   * @param {string} videoIndex - Video index in the property's videos array
   * @param {string} platform - Platform name (youtube, facebook, instagram)
   * @param {Object} statusUpdate - Status update object
   * @returns {Promise<Object>} Updated status
   */
  static async updatePlatformStatus(propertyId, videoIndex, platform, statusUpdate) {
    try {
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new Error('Property not found');
      }

      if (!property.videos[videoIndex]) {
        throw new Error('Video not found');
      }

      const validPlatforms = ['youtube', 'facebook', 'instagram'];
      if (!validPlatforms.includes(platform)) {
        throw new Error(`Invalid platform: ${platform}`);
      }

      // Ensure socialMediaStatus exists
      if (!property.videos[videoIndex].socialMediaStatus) {
        property.videos[videoIndex].socialMediaStatus = {};
      }

      // Ensure platform status exists
      if (!property.videos[videoIndex].socialMediaStatus[platform]) {
        property.videos[videoIndex].socialMediaStatus[platform] = {
          status: 'pending',
          uploadedAt: null,
          platformUrl: null,
          platformId: null,
          error: null
        };
      }

      // Update platform status
      const currentStatus = property.videos[videoIndex].socialMediaStatus[platform];
      
      if (statusUpdate.status) {
        currentStatus.status = statusUpdate.status;
      }
      
      if (statusUpdate.platformUrl) {
        currentStatus.platformUrl = statusUpdate.platformUrl;
      }
      
      if (statusUpdate.platformId) {
        currentStatus.platformId = statusUpdate.platformId;
      }
      
      if (statusUpdate.error) {
        currentStatus.error = statusUpdate.error;
      }
      
      if (statusUpdate.status === 'completed' || statusUpdate.status === 'failed') {
        currentStatus.uploadedAt = new Date();
      }

      // Mark the document as modified
      property.markModified('videos');
      await property.save();

      console.log(`Upload status updated for property ${propertyId}, video ${videoIndex}, platform ${platform}: ${statusUpdate.status}`);
      return currentStatus;
    } catch (error) {
      console.error('Update platform status error:', error);
      throw new Error(`Failed to update platform status: ${error.message}`);
    }
  }

  /**
   * Update multiple platform statuses
   * @param {string} propertyId - Property ID
   * @param {string} videoIndex - Video index in the property's videos array
   * @param {Object} statusUpdates - Object with platform status updates
   * @returns {Promise<Object>} Updated statuses
   */
  static async updateMultiplePlatformStatuses(propertyId, videoIndex, statusUpdates) {
    try {
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new Error('Property not found');
      }

      if (!property.videos[videoIndex]) {
        throw new Error('Video not found');
      }

      // Ensure socialMediaStatus exists
      if (!property.videos[videoIndex].socialMediaStatus) {
        property.videos[videoIndex].socialMediaStatus = {};
      }

      const updatedStatuses = {};

      // Update each platform status
      for (const [platform, statusUpdate] of Object.entries(statusUpdates)) {
        if (!['youtube', 'facebook', 'instagram'].includes(platform)) {
          console.warn(`Invalid platform skipped: ${platform}`);
          continue;
        }

        // Ensure platform status exists
        if (!property.videos[videoIndex].socialMediaStatus[platform]) {
          property.videos[videoIndex].socialMediaStatus[platform] = {
            status: 'pending',
            uploadedAt: null,
            platformUrl: null,
            platformId: null,
            error: null
          };
        }

        const currentStatus = property.videos[videoIndex].socialMediaStatus[platform];
        
        // Update status fields
        if (statusUpdate.status) {
          currentStatus.status = statusUpdate.status;
        }
        
        if (statusUpdate.platformUrl) {
          currentStatus.platformUrl = statusUpdate.platformUrl;
        }
        
        if (statusUpdate.platformId) {
          currentStatus.platformId = statusUpdate.platformId;
        }
        
        if (statusUpdate.error) {
          currentStatus.error = statusUpdate.error;
        }
        
        if (statusUpdate.status === 'completed' || statusUpdate.status === 'failed') {
          currentStatus.uploadedAt = new Date();
        }

        updatedStatuses[platform] = { ...currentStatus };
      }

      // Mark the document as modified and save
      property.markModified('videos');
      await property.save();

      console.log(`Multiple platform statuses updated for property ${propertyId}, video ${videoIndex}`);
      return updatedStatuses;
    } catch (error) {
      console.error('Update multiple platform statuses error:', error);
      throw new Error(`Failed to update multiple platform statuses: ${error.message}`);
    }
  }

  /**
   * Get upload status for a video
   * @param {string} propertyId - Property ID
   * @param {string} videoIndex - Video index in the property's videos array
   * @returns {Promise<Object>} Upload status
   */
  static async getUploadStatus(propertyId, videoIndex) {
    try {
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new Error('Property not found');
      }

      if (!property.videos[videoIndex]) {
        throw new Error('Video not found');
      }

      const video = property.videos[videoIndex];
      return {
        success: true,
        socialMediaStatus: video.socialMediaStatus || {},
        videoInfo: {
          caption: video.caption,
          description: video.description,
          hashtags: video.hashtags,
          cloudinaryUrl: video.cloudinaryUrl
        }
      };
    } catch (error) {
      console.error('Get upload status error:', error);
      throw new Error(`Failed to get upload status: ${error.message}`);
    }
  }

  /**
   * Get all upload statuses for a property
   * @param {string} propertyId - Property ID
   * @returns {Promise<Array>} Array of upload statuses
   */
  static async getAllUploadStatuses(propertyId) {
    try {
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new Error('Property not found');
      }

      const statuses = property.videos.map((video, index) => ({
        videoIndex: index,
        caption: video.caption,
        description: video.description,
        hashtags: video.hashtags,
        cloudinaryUrl: video.cloudinaryUrl,
        socialMediaStatus: video.socialMediaStatus || {}
      }));

      return {
        success: true,
        propertyId,
        videoStatuses: statuses
      };
    } catch (error) {
      console.error('Get all upload statuses error:', error);
      throw new Error(`Failed to get all upload statuses: ${error.message}`);
    }
  }

  /**
   * Get upload statistics for a property
   * @param {string} propertyId - Property ID
   * @returns {Promise<Object>} Upload statistics
   */
  static async getUploadStatistics(propertyId) {
    try {
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new Error('Property not found');
      }

      const stats = {
        totalVideos: property.videos.length,
        platforms: {
          youtube: { pending: 0, uploading: 0, completed: 0, failed: 0 },
          facebook: { pending: 0, uploading: 0, completed: 0, failed: 0 },
          instagram: { pending: 0, uploading: 0, completed: 0, failed: 0 }
        },
        overall: { pending: 0, uploading: 0, completed: 0, failed: 0 }
      };

      property.videos.forEach(video => {
        if (video.socialMediaStatus) {
          ['youtube', 'facebook', 'instagram'].forEach(platform => {
            if (video.socialMediaStatus[platform]) {
              const status = video.socialMediaStatus[platform].status;
              if (stats.platforms[platform][status] !== undefined) {
                stats.platforms[platform][status]++;
                stats.overall[status]++;
              }
            }
          });
        }
      });

      return {
        success: true,
        propertyId,
        statistics: stats
      };
    } catch (error) {
      console.error('Get upload statistics error:', error);
      throw new Error(`Failed to get upload statistics: ${error.message}`);
    }
  }

  /**
   * Clean up failed uploads (reset status to pending)
   * @param {string} propertyId - Property ID
   * @param {string} videoIndex - Video index (optional, if not provided, cleans all videos)
   * @returns {Promise<Object>} Cleanup result
   */
  static async cleanupFailedUploads(propertyId, videoIndex = null) {
    try {
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new Error('Property not found');
      }

      let cleanedCount = 0;
      const videosToProcess = videoIndex !== null ? [videoIndex] : 
        Array.from({ length: property.videos.length }, (_, i) => i);

      videosToProcess.forEach(index => {
        if (property.videos[index] && property.videos[index].socialMediaStatus) {
          ['youtube', 'facebook', 'instagram'].forEach(platform => {
            if (property.videos[index].socialMediaStatus[platform] && 
                property.videos[index].socialMediaStatus[platform].status === 'failed') {
              property.videos[index].socialMediaStatus[platform].status = 'pending';
              property.videos[index].socialMediaStatus[platform].error = null;
              property.videos[index].socialMediaStatus[platform].uploadedAt = null;
              cleanedCount++;
            }
          });
        }
      });

      if (cleanedCount > 0) {
        property.markModified('videos');
        await property.save();
      }

      console.log(`Cleaned up ${cleanedCount} failed uploads for property ${propertyId}`);
      return {
        success: true,
        cleanedCount,
        message: `Reset ${cleanedCount} failed uploads to pending status`
      };
    } catch (error) {
      console.error('Cleanup failed uploads error:', error);
      throw new Error(`Failed to cleanup failed uploads: ${error.message}`);
    }
  }
}

module.exports = UploadStatusService;