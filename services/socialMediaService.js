const { google } = require('googleapis');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

// YouTube Service
class YouTubeService {
  constructor() {
    this.youtube = null;
    this.oauth2Client = null;
    this.initialized = false;
  }

  /**
   * Initialize YouTube API client
   */
  async initialize() {
    try {
      if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
        throw new Error('YouTube API credentials not configured');
      }

      this.oauth2Client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        process.env.YOUTUBE_REDIRECT_URI
      );

      this.youtube = google.youtube({
        version: 'v3',
        auth: this.oauth2Client
      });

      this.initialized = true;
      console.log('YouTube service initialized successfully');
    } catch (error) {
      console.error('YouTube initialization error:', error);
      throw error;
    }
  }

  /**
   * Upload video to YouTube
   * @param {string} videoPath - Path to video file
   * @param {Object} metadata - Video metadata
   * @param {string} accessToken - YouTube access token
   * @param {string} channelId - YouTube Channel ID (required)
   * @returns {Promise<Object>} Upload result
   */
  async uploadVideo(videoPath, metadata, accessToken, channelId) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Validate required parameters
      if (!channelId) {
        throw new Error('YouTube Channel ID is required for video uploads');
      }

      if (!accessToken) {
        throw new Error('YouTube access token is required');
      }

      // Set access token
      this.oauth2Client.setCredentials({ access_token: accessToken });

      // Verify channel access
      try {
        await this.youtube.channels.list({
          part: ['snippet'],
          id: [channelId]
        });
      } catch (error) {
        throw new Error(`Invalid or inaccessible YouTube channel: ${channelId}`);
      }

      const { title, description, tags = [], privacy = 'private' } = metadata;

      const requestBody = {
        snippet: {
          title: title || 'Property Video',
          description: description || '',
          tags: Array.isArray(tags) ? tags : [],
          categoryId: '28', // Science & Technology category
          channelId: channelId // Explicitly set channel ID
        },
        status: {
          privacyStatus: privacy,
          selfDeclaredMadeForKids: false
        }
      };

      // Handle both local file paths and URLs (like Cloudinary URLs)
      let mediaStream;
      const isUrl = videoPath.startsWith('http://') || videoPath.startsWith('https://');
      
      if (isUrl) {
        // Download video from URL and create stream
        console.log(`Downloading video from URL: ${videoPath}`);
        const response = await axios({
          method: 'GET',
          url: videoPath,
          responseType: 'stream'
        });
        mediaStream = response.data;
      } else {
        // Use local file stream
        mediaStream = fs.createReadStream(videoPath);
      }

      const media = {
        body: mediaStream
      };

      console.log(`Uploading video to YouTube channel: ${channelId}...`);
      const response = await this.youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody,
        media
      });

      const videoId = response.data.id;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      console.log(`YouTube upload successful: ${videoUrl}`);

      return {
        success: true,
        platform: 'youtube',
        videoId,
        url: videoUrl,
        title: response.data.snippet.title,
        channelId: response.data.snippet.channelId,
        uploadedAt: new Date()
      };
    } catch (error) {
      console.error('YouTube upload error:', error);
      
      // Enhanced error handling with specific error types
      let errorMessage = 'YouTube upload failed';
      
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        switch (status) {
          case 401:
            errorMessage = 'YouTube authentication failed. Please check your access token.';
            break;
          case 403:
            if (data?.error?.message?.includes('quotaExceeded')) {
              errorMessage = 'YouTube API quota exceeded. Please try again later.';
            } else if (data?.error?.message?.includes('channelNotFound')) {
              errorMessage = 'YouTube channel not found. Please check your channel ID.';
            } else {
              errorMessage = 'YouTube access forbidden. Please check your permissions.';
            }
            break;
          case 400:
            errorMessage = `YouTube bad request: ${data?.error?.message || 'Invalid request parameters'}`;
            break;
          case 429:
            errorMessage = 'YouTube rate limit exceeded. Please try again later.';
            break;
          case 500:
          case 502:
          case 503:
            errorMessage = 'YouTube server error. Please try again later.';
            break;
          default:
            errorMessage = `YouTube upload failed: ${data?.error?.message || error.message}`;
        }
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = 'YouTube API connection failed. Please check your internet connection.';
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = 'YouTube upload timed out. Please try again.';
      } else {
        errorMessage = `YouTube upload failed: ${error.message}`;
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Get video status from YouTube
   * @param {string} videoId - YouTube video ID
   * @param {string} accessToken - YouTube access token
   * @returns {Promise<Object>} Video status
   */
  async getVideoStatus(videoId, accessToken) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      this.oauth2Client.setCredentials({ access_token: accessToken });

      const response = await this.youtube.videos.list({
        part: ['status', 'processingDetails'],
        id: [videoId]
      });

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error('Video not found');
      }

      const video = response.data.items[0];
      return {
        success: true,
        status: video.status.uploadStatus,
        privacyStatus: video.status.privacyStatus,
        processingStatus: video.processingDetails?.processingStatus
      };
    } catch (error) {
      console.error('YouTube status check error:', error);
      throw new Error(`Failed to get YouTube video status: ${error.message}`);
    }
  }
}

// Facebook Service
class FacebookService {
  constructor() {
    this.baseUrl = 'https://graph.facebook.com/v23.0';
    this.uploadUrl = 'https://rupload.facebook.com';
  }

  /**
   * Upload video to Facebook Page
   * @param {string} videoPath - Path to video file
   * @param {Object} metadata - Video metadata
   * @param {string} accessToken - Facebook Page access token
   * @param {string} pageId - Facebook Page ID
   * @returns {Promise<Object>} Upload result
   */
  async uploadVideo(videoPath, metadata, accessToken, pageId) {
    try {
      const { title, description } = metadata;
      
      // Check if videoPath is a URL or local file
      const isUrl = videoPath.startsWith('http://') || videoPath.startsWith('https://');
      
      if (isUrl) {
        const formData = new FormData();
        formData.append('file_url', videoPath);
        formData.append('title', title || 'Property Video');
        formData.append('description', description || 'Take a virtual tour of this stunning property.');
        
        const response = await axios.post(
          `${this.baseUrl}/${pageId}/videos`,
          formData,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              ...formData.getHeaders()
            }
          }
        );
        
        const videoId = response.data.id;
        const videoUrl = `https://www.facebook.com/watch/?v=${videoId}`;
        
        return {
          success: true,
          videoId,
          videoUrl,
          platform: 'facebook'
        };
      }
      
      // For local files, use the new resumable upload API
      const fileStats = fs.statSync(videoPath);
      const fileSize = fileStats.size;
      const fileName = path.basename(videoPath);
      
      // Step 1: Start upload session with FormData
      const initFormData = new FormData();
      initFormData.append('file_name', fileName);
      initFormData.append('file_length', fileSize.toString());
      initFormData.append('file_type', 'video/mp4');
      
      const initResponse = await axios.post(
        `${this.baseUrl}/${pageId}/uploads`,
        initFormData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            ...initFormData.getHeaders()
          }
        }
      );

      const uploadSessionId = initResponse.data.id;

      // Step 2: Upload video file
      const uploadResponse = await axios.post(
        `${this.baseUrl}/${uploadSessionId}`,
        fs.createReadStream(videoPath),
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'file_offset': '0',
            'Content-Type': 'application/octet-stream'
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );

      const fileHandle = uploadResponse.data.h;

      // Step 3: Publish video using file handle
      const publishResponse = await axios.post(
        `${this.baseUrl}/${pageId}/videos`,
        {
          file_handle: fileHandle,
          title: title || 'Property Video',
          description: description || ''
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const videoId = publishResponse.data.id;
      const videoUrl = `https://www.facebook.com/watch/?v=${videoId}`;

      console.log(`Facebook upload successful: ${videoUrl}`);

      return {
        success: true,
        platform: 'facebook',
        videoId: videoId,
        url: videoUrl,
        uploadedAt: new Date()
      };
  } catch (error) {
      console.error('Facebook upload error:', error);
      
      // Enhanced error handling with specific error types
      let errorMessage = 'Facebook upload failed';
      
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        switch (status) {
          case 401:
            errorMessage = 'Facebook authentication failed. Please check your access token.';
            break;
          case 403:
            errorMessage = 'Facebook access forbidden. Please check your page permissions.';
            break;
          case 400:
            if (data?.error?.code === 100) {
              errorMessage = 'Facebook permission error: No permission to publish the video. Please check page roles and permissions.';
            } else if (data?.error?.message?.includes('Invalid parameter')) {
              errorMessage = `Facebook invalid parameter: ${data.error.message}`;
            } else {
              errorMessage = `Facebook bad request: ${data?.error?.message || 'Invalid request parameters'}`;
            }
            break;
          case 429:
            errorMessage = 'Facebook rate limit exceeded. Please try again later.';
            break;
          case 500:
          case 502:
          case 503:
            errorMessage = 'Facebook server error. Please try again later.';
            break;
          default:
            errorMessage = `Facebook upload failed: ${data?.error?.message || error.message}`;
        }
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = 'Facebook API connection failed. Please check your internet connection.';
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = 'Facebook upload timed out. Please try again.';
      } else {
        errorMessage = `Facebook upload failed: ${error.message}`;
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Get video status from Facebook
   * @param {string} videoId - Facebook video ID
   * @param {string} accessToken - Facebook access token
   * @returns {Promise<Object>} Video status
   */
  async getVideoStatus(videoId, accessToken) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${videoId}`,
        {
          params: {
            fields: 'status,created_time,permalink_url',
            access_token: accessToken
          }
        }
      );

      return {
        success: true,
        status: response.data.status?.video_status || 'unknown',
        createdTime: response.data.created_time,
        url: response.data.permalink_url
      };
    } catch (error) {
      console.error('Facebook status check error:', error);
      throw new Error(`Failed to get Facebook video status: ${error.message}`);
    }
  }
}

// Instagram Service
class InstagramService {
  constructor() {
    this.baseUrl = 'https://graph.facebook.com/v23.0';
  }

  /**
   * Upload video to Instagram Business Account
   * @param {string} videoPath - Path to video file
   * @param {Object} metadata - Video metadata
   * @param {string} accessToken - Instagram access token
   * @param {string} businessAccountId - Instagram Business Account ID
   * @returns {Promise<Object>} Upload result
   */
  async uploadVideo(videoPath, metadata, accessToken, businessAccountId) {
    try {
      const { title, description, hashtags = [] } = metadata;
      
      // Prepare caption with hashtags (Instagram has a 2200 character limit)
      let caption = description || title || 'Property Video';
      if (hashtags.length > 0) {
        const hashtagString = hashtags.map(tag => 
          tag.startsWith('#') ? tag : `#${tag}`
        ).join(' ');
        caption += `\n\n${hashtagString}`;
      }
      
      // Truncate caption if too long
      if (caption.length > 2200) {
        caption = caption.substring(0, 2197) + '...';
      }

      // Ensure videoPath is a valid URL
      if (!videoPath.startsWith('http://') && !videoPath.startsWith('https://')) {
        throw new Error('Instagram requires a publicly accessible video URL');
      }

      // Step 1: Create media container with FormData
      const formData = new FormData();
      formData.append('media_type', 'VIDEO');
      formData.append('video_url', videoPath);
      formData.append('caption', caption);
      
      const containerResponse = await axios.post(
        `${this.baseUrl}/${businessAccountId}/media`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            ...formData.getHeaders()
          }
        }
      );

      const containerId = containerResponse.data.id;

      // Wait for video processing (Instagram requires this)
      await this.waitForVideoProcessing(containerId, accessToken);

      // Step 2: Publish the media with FormData
      const publishFormData = new FormData();
      publishFormData.append('creation_id', containerId);
      
      const publishResponse = await axios.post(
        `${this.baseUrl}/${businessAccountId}/media_publish`,
        publishFormData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            ...publishFormData.getHeaders()
          }
        }
      );

      const mediaId = publishResponse.data.id;
      const mediaUrl = `https://www.instagram.com/p/${mediaId}`;

      console.log(`Instagram upload successful: ${mediaUrl}`);

      return {
        success: true,
        platform: 'instagram',
        mediaId,
        url: mediaUrl,
        uploadedAt: new Date()
      };
  } catch (error) {
      console.error('Instagram upload error:', error);
      
      // Enhanced error handling with specific error types
      let errorMessage = 'Instagram upload failed';
      
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        switch (status) {
          case 401:
            errorMessage = 'Instagram authentication failed. Please check your access token.';
            break;
          case 403:
            errorMessage = 'Instagram access forbidden. Please check your business account permissions.';
            break;
          case 400:
            if (data?.error?.message?.includes('Invalid parameter')) {
              errorMessage = `Instagram invalid parameter: ${data.error.message}`;
            } else if (data?.error?.message?.includes('media_url')) {
              errorMessage = 'Instagram media URL error: Video must be publicly accessible.';
            } else {
              errorMessage = `Instagram bad request: ${data?.error?.message || 'Invalid request parameters'}`;
            }
            break;
          case 429:
            errorMessage = 'Instagram rate limit exceeded. Please try again later.';
            break;
          case 500:
          case 502:
          case 503:
            errorMessage = 'Instagram server error. Please try again later.';
            break;
          default:
            errorMessage = `Instagram upload failed: ${data?.error?.message || error.message}`;
        }
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = 'Instagram API connection failed. Please check your internet connection.';
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = 'Instagram upload timed out. Please try again.';
      } else if (error.message?.includes('processing timeout')) {
        errorMessage = 'Instagram video processing timed out. Please try with a smaller video file.';
      } else {
        errorMessage = `Instagram upload failed: ${error.message}`;
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Wait for video processing to complete
   * @param {string} containerId - Instagram container ID
   * @param {string} accessToken - Instagram access token
   * @returns {Promise<void>}
   */
  async waitForVideoProcessing(containerId, accessToken, maxAttempts = 30) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await axios.get(
          `${this.baseUrl}/${containerId}`,
          {
            params: {
              fields: 'status_code'
            },
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );

        const statusCode = response.data.status_code;
        
        if (statusCode === 'FINISHED') {
          console.log('Instagram video processing completed');
          return;
        } else if (statusCode === 'ERROR') {
          throw new Error('Instagram video processing failed');
        }
        
        // Wait 2 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        if (attempt === maxAttempts - 1) {
          throw new Error(`Instagram video processing timeout: ${error.message}`);
        }
      }
    }
    
    throw new Error('Instagram video processing timeout');
  }

  /**
   * Get media status from Instagram
   * @param {string} mediaId - Instagram media ID
   * @param {string} accessToken - Instagram access token
   * @returns {Promise<Object>} Media status
   */
  async getMediaStatus(mediaId, accessToken) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${mediaId}`,
        {
          params: {
            fields: 'id,media_type,media_url,permalink,timestamp'
          },
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      return {
        success: true,
        mediaType: response.data.media_type,
        url: response.data.permalink,
        timestamp: response.data.timestamp
      };
    } catch (error) {
      console.error('Instagram status check error:', error);
      throw new Error(`Failed to get Instagram media status: ${error.message}`);
    }
  }
}

// Main Social Media Service
class SocialMediaService {
  constructor() {
    this.youtube = new YouTubeService();
    this.facebook = new FacebookService();
    this.instagram = new InstagramService();
  }

  /**
   * Upload video to selected platforms
   * @param {string} videoUrl - Cloudinary video URL
   * @param {Object} metadata - Video metadata
   * @param {Array} platforms - Selected platforms
   * @param {Object} tokens - Platform access tokens
   * @returns {Promise<Object>} Upload results
   */
  async uploadToMultiplePlatforms(videoUrl, metadata, platforms, tokens) {
    const results = {
      youtube: { status: 'pending' },
      facebook: { status: 'pending' },
      instagram: { status: 'pending' }
    };

    const uploadPromises = [];

    // YouTube upload
    if (platforms.includes('youtube') && tokens.youtube) {
      const youtubeToken = typeof tokens.youtube === 'string' ? tokens.youtube : tokens.youtube.accessToken;
      const channelId = typeof tokens.youtube === 'object' ? tokens.youtube.channelId : null;
      
      uploadPromises.push(
        this.youtube.uploadVideo(videoUrl, metadata, youtubeToken, channelId)
          .then(result => {
            results.youtube = {
              status: 'completed',
              ...result,
              uploadedAt: new Date()
            };
          })
          .catch(error => {
            results.youtube = {
              status: 'failed',
              error: error.message,
              uploadedAt: new Date()
            };
          })
      );
    }

    // Facebook upload
    if (platforms.includes('facebook') && tokens.facebook && process.env.META_PAGE_ID) {
      uploadPromises.push(
        this.facebook.uploadVideo(videoUrl, metadata, tokens.facebook, process.env.META_PAGE_ID)
          .then(result => {
            results.facebook = {
              status: 'completed',
              ...result,
              uploadedAt: new Date()
            };
          })
          .catch(error => {
            results.facebook = {
              status: 'failed',
              error: error.message,
              uploadedAt: new Date()
            };
          })
      );
    }

    // Instagram upload
    if (platforms.includes('instagram') && tokens.instagram && process.env.INSTAGRAM_BUSINESS_ID) {
      uploadPromises.push(
        this.instagram.uploadVideo(videoUrl, metadata, tokens.instagram, process.env.INSTAGRAM_BUSINESS_ID)
          .then(result => {
            results.instagram = {
              status: 'completed',
              ...result,
              uploadedAt: new Date()
            };
          })
          .catch(error => {
            results.instagram = {
              status: 'failed',
              error: error.message,
              uploadedAt: new Date()
            };
          })
      );
    }

    // Wait for all uploads to complete
    await Promise.allSettled(uploadPromises);

    return results;
  }

  /**
   * Check if social media services are configured
   * @returns {Object} Configuration status
   */
  isConfigured() {
    return {
      youtube: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
      facebook: !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_PAGE_ID),
      instagram: !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.INSTAGRAM_BUSINESS_ID)
    };
  }
}

module.exports = {
  SocialMediaService,
  YouTubeService,
  FacebookService,
  InstagramService
};