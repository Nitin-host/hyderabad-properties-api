const fs = require('fs');
const path = require('path');

/**
 * Service for validating social media platform configurations and data
 */
class SocialMediaValidationService {
  /**
   * Validate YouTube configuration and data
   * @param {Object} data - YouTube upload data
   * @returns {Object} Validation result
   */
  static validateYouTube(data) {
    const errors = [];
    const warnings = [];

    // Check required environment variables
    if (!process.env.YOUTUBE_CLIENT_ID) {
      errors.push('YOUTUBE_CLIENT_ID environment variable is required');
    }
    if (!process.env.YOUTUBE_CLIENT_SECRET) {
      errors.push('YOUTUBE_CLIENT_SECRET environment variable is required');
    }
    if (!process.env.YOUTUBE_ACCESS_TOKEN) {
      errors.push('YOUTUBE_ACCESS_TOKEN environment variable is required');
    }

    // Check required data parameters
    if (!data.accessToken && !process.env.YOUTUBE_ACCESS_TOKEN) {
      errors.push('YouTube access token is required');
    }
    if (!data.channelId) {
      errors.push('YouTube channel ID is required');
    }

    // Check video URL
    if (!data.videoUrl) {
      errors.push('Video URL is required for YouTube upload');
    } else if (!this.isValidUrl(data.videoUrl)) {
      errors.push('Invalid video URL format');
    }

    // Check metadata
    if (!data.metadata) {
      warnings.push('No metadata provided for YouTube upload');
    } else {
      if (!data.metadata.title || data.metadata.title.length === 0) {
        warnings.push('Video title is recommended for YouTube uploads');
      }
      if (data.metadata.title && data.metadata.title.length > 100) {
        warnings.push('YouTube video title should be under 100 characters');
      }
      if (data.metadata.description && data.metadata.description.length > 5000) {
        warnings.push('YouTube video description should be under 5000 characters');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate Facebook configuration and data
   * @param {Object} data - Facebook upload data
   * @returns {Object} Validation result
   */
  static validateFacebook(data) {
    const errors = [];
    const warnings = [];

    // Check required environment variables
    if (!process.env.META_APP_ID) {
      errors.push('META_APP_ID environment variable is required');
    }
    if (!process.env.META_APP_SECRET) {
      errors.push('META_APP_SECRET environment variable is required');
    }
    if (!process.env.META_ACCESS_TOKEN) {
      errors.push('META_ACCESS_TOKEN environment variable is required');
    }
    if (!process.env.META_PAGE_ID) {
      errors.push('META_PAGE_ID environment variable is required');
    }

    // Check required data parameters
    if (!data.accessToken && !process.env.META_ACCESS_TOKEN) {
      errors.push('Facebook access token is required');
    }
    if (!data.pageId && !process.env.META_PAGE_ID) {
      errors.push('Facebook page ID is required');
    }

    // Check video URL
    if (!data.videoUrl) {
      errors.push('Video URL is required for Facebook upload');
    } else if (!this.isValidUrl(data.videoUrl)) {
      errors.push('Invalid video URL format');
    }

    // Check metadata
    if (!data.metadata) {
      warnings.push('No metadata provided for Facebook upload');
    } else {
      if (data.metadata.description && data.metadata.description.length > 63206) {
        warnings.push('Facebook video description should be under 63206 characters');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate Instagram configuration and data
   * @param {Object} data - Instagram upload data
   * @returns {Object} Validation result
   */
  static validateInstagram(data) {
    const errors = [];
    const warnings = [];

    // Check required environment variables
    if (!process.env.META_APP_ID) {
      errors.push('META_APP_ID environment variable is required');
    }
    if (!process.env.META_APP_SECRET) {
      errors.push('META_APP_SECRET environment variable is required');
    }
    if (!process.env.META_ACCESS_TOKEN) {
      errors.push('META_ACCESS_TOKEN environment variable is required');
    }
    if (!process.env.INSTAGRAM_BUSINESS_ID) {
      errors.push('INSTAGRAM_BUSINESS_ID environment variable is required');
    }

    // Check required data parameters
    if (!data.accessToken && !process.env.META_ACCESS_TOKEN) {
      errors.push('Instagram access token is required');
    }
    if (!data.businessAccountId && !process.env.INSTAGRAM_BUSINESS_ID) {
      errors.push('Instagram business account ID is required');
    }

    // Check video URL
    if (!data.videoUrl) {
      errors.push('Video URL is required for Instagram upload');
    } else if (!this.isValidUrl(data.videoUrl)) {
      errors.push('Invalid video URL format');
    } else if (!this.isPubliclyAccessible(data.videoUrl)) {
      errors.push('Video URL must be publicly accessible for Instagram upload');
    }

    // Check metadata
    if (!data.metadata) {
      warnings.push('No metadata provided for Instagram upload');
    } else {
      if (data.metadata.caption && data.metadata.caption.length > 2200) {
        warnings.push('Instagram video caption should be under 2200 characters');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate all selected platforms
   * @param {Array} platforms - Selected platforms
   * @param {Object} data - Upload data
   * @returns {Object} Validation results for all platforms
   */
  static validateAllPlatforms(platforms, data) {
    const results = {};
    const allErrors = [];
    const allWarnings = [];

    platforms.forEach(platform => {
      let validation;
      
      switch (platform) {
        case 'youtube':
          validation = this.validateYouTube({
            ...data,
            accessToken: data.tokens?.youtube?.accessToken || data.tokens?.youtube,
            channelId: data.tokens?.youtube?.channelId
          });
          break;
        case 'facebook':
          validation = this.validateFacebook({
            ...data,
            accessToken: data.tokens?.facebook,
            pageId: process.env.META_PAGE_ID
          });
          break;
        case 'instagram':
          validation = this.validateInstagram({
            ...data,
            accessToken: data.tokens?.instagram,
            businessAccountId: process.env.INSTAGRAM_BUSINESS_ID
          });
          break;
        default:
          validation = {
            isValid: false,
            errors: [`Unknown platform: ${platform}`],
            warnings: []
          };
      }

      results[platform] = validation;
      allErrors.push(...validation.errors.map(error => `${platform}: ${error}`));
      allWarnings.push(...validation.warnings.map(warning => `${platform}: ${warning}`));
    });

    return {
      isValid: Object.values(results).every(result => result.isValid),
      platforms: results,
      errors: allErrors,
      warnings: allWarnings
    };
  }

  /**
   * Check if URL is valid
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid
   */
  static isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if URL is publicly accessible (basic check)
   * @param {string} url - URL to check
   * @returns {boolean} True if likely publicly accessible
   */
  static isPubliclyAccessible(url) {
    // Basic check - should start with http/https and not be localhost
    const urlObj = new URL(url);
    return (
      (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') &&
      !urlObj.hostname.includes('localhost') &&
      !urlObj.hostname.includes('127.0.0.1') &&
      !urlObj.hostname.includes('0.0.0.0')
    );
  }

  /**
   * Get configuration status for all platforms
   * @returns {Object} Configuration status
   */
  static getConfigurationStatus() {
    return {
      youtube: {
        configured: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_ACCESS_TOKEN),
        missing: [
          !process.env.YOUTUBE_CLIENT_ID && 'YOUTUBE_CLIENT_ID',
          !process.env.YOUTUBE_CLIENT_SECRET && 'YOUTUBE_CLIENT_SECRET',
          !process.env.YOUTUBE_ACCESS_TOKEN && 'YOUTUBE_ACCESS_TOKEN'
        ].filter(Boolean)
      },
      facebook: {
        configured: !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID),
        missing: [
          !process.env.META_APP_ID && 'META_APP_ID',
          !process.env.META_APP_SECRET && 'META_APP_SECRET',
          !process.env.META_ACCESS_TOKEN && 'META_ACCESS_TOKEN',
          !process.env.META_PAGE_ID && 'META_PAGE_ID'
        ].filter(Boolean)
      },
      instagram: {
        configured: !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_ACCESS_TOKEN && process.env.INSTAGRAM_BUSINESS_ID),
        missing: [
          !process.env.META_APP_ID && 'META_APP_ID',
          !process.env.META_APP_SECRET && 'META_APP_SECRET',
          !process.env.META_ACCESS_TOKEN && 'META_ACCESS_TOKEN',
          !process.env.INSTAGRAM_BUSINESS_ID && 'INSTAGRAM_BUSINESS_ID'
        ].filter(Boolean)
      }
    };
  }
}

module.exports = SocialMediaValidationService;