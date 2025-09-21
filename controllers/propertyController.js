const Property = require('../models/Property');
const User = require('../models/User');
const cloudinaryService = require('../services/cloudinaryService');
const videoCompressionService = require('../services/videoCompressionService');
const { SocialMediaService } = require('../services/socialMediaService');
const UploadStatusService = require('../services/uploadStatusService');
const SocialMediaValidationService = require('../services/socialMediaValidationService');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Initialize social media service
const socialMediaService = new SocialMediaService();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
    fieldSize: 10 * 1024 * 1024, // 10MB field size limit
    fields: 20, // Maximum number of non-file fields
    files: 20, // Maximum number of file fields
    parts: 50 // Maximum number of parts (fields + files)
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'images') {
      // Accept images
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed for images field'), false);
      }
    } else if (file.fieldname === 'videos' || file.fieldname === 'video') {
      // Accept videos
      if (file.mimetype.startsWith('video/')) {
        cb(null, true);
      } else {
        cb(new Error('Only video files are allowed for videos field'), false);
      }
    } else {
      cb(new Error('Invalid field name'), false);
    }
  }
});

/**
 * @desc    Get all properties
 * @route   GET /api/properties
 * @access  Public
 */
const getProperties = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = { isDeleted: false };
    
    // Search functionality
    if (req.query.search) {
      filter.$text = { $search: req.query.search };
    }

    // Filter by property type
    if (req.query.propertyType) {
      filter.propertyType = req.query.propertyType;
    }

    // Filter by status
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Filter by price range
    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice) filter.price.$gte = parseInt(req.query.minPrice);
      if (req.query.maxPrice) filter.price.$lte = parseInt(req.query.maxPrice);
    }

    // Filter by size range
    if (req.query.minSize || req.query.maxSize) {
      filter.size = {};
      if (req.query.minSize) filter.size.$gte = parseInt(req.query.minSize);
      if (req.query.maxSize) filter.size.$lte = parseInt(req.query.maxSize);
    }

    // Filter by city
    if (req.query.city) {
      filter['address.city'] = new RegExp(req.query.city, 'i');
    }

    // Filter by bedrooms
    if (req.query.bedrooms) {
      filter.bedrooms = req.query.bedrooms;
    }

    // Filter by furnished status
    if (req.query.furnished) {
      filter.furnished = req.query.furnished;
    }

    // Filter by featured
    if (req.query.featured === 'true') {
      filter.featured = true;
    }

    // Sort options
    let sortOption = { createdAt: -1 }; // Default: newest first
    if (req.query.sortBy) {
      switch (req.query.sortBy) {
        case 'price_asc':
          sortOption = { price: 1 };
          break;
        case 'price_desc':
          sortOption = { price: -1 };
          break;
        case 'size_asc':
          sortOption = { size: 1 };
          break;
        case 'size_desc':
          sortOption = { size: -1 };
          break;
        case 'newest':
          sortOption = { createdAt: -1 };
          break;
        case 'oldest':
          sortOption = { createdAt: 1 };
          break;
      }
    }

    const properties = await Property.find(filter)
      .populate('agent', 'name email phone')
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Property.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      success: true,
      count: properties.length,
      total,
      totalPages,
      currentPage: page,
      data: properties
    });
  } catch (error) {
    console.error('Get properties error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch properties',
      error: error.message
    });
  }
};

/**
 * @desc    Get single property
 * @route   GET /api/properties/:id
 * @access  Public
 */
const getProperty = async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      isDeleted: false
    }).populate('agent', 'name email phone');

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    res.status(200).json({
      success: true,
      data: property
    });
  } catch (error) {
    console.error('Get property error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch property',
      error: error.message
    });
  }
};

/**
 * @desc    Create new property
 * @route   POST /api/properties
 * @access  Private
 */
const createProperty = async (req, res) => {
  try {
    // Add owner to property data
    const propertyData = {
      ...req.body,
      agent: req.user.id
    };

    // Set broker charge based on listedBy field
    if (propertyData.listedBy === 'Owner') {
      propertyData.brokerCharge = 0;
    } else if (propertyData.listedBy === 'Agent') {
      // Set default broker charge for Agent if not provided
      if (!propertyData.brokerCharge) {
        propertyData.brokerCharge = 1000; // Default broker charge amount
      }
    }

    // Parse arrays if they come as strings
    if (typeof propertyData.amenities === 'string') {
      propertyData.amenities = JSON.parse(propertyData.amenities);
    }

    const property = await Property.create(propertyData);

    // Populate owner information
    await property.populate('agent', 'name email phone');

    res.status(201).json({
      success: true,
      message: 'Property created successfully',
      data: property
    });
  } catch (error) {
    console.error('Create property error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create property',
      error: error.message
    });
  }
};

/**
 * @desc    Update property
 * @route   PUT /api/properties/:id
 * @access  Private
 */
const updateProperty = async (req, res) => {
  try {
    let property = await Property.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Access control is handled by route middleware (admin/super_admin only)

    // Parse arrays if they come as strings
    const updateData = { ...req.body };
    if (typeof updateData.amenities === 'string') {
      updateData.amenities = JSON.parse(updateData.amenities);
    }
    
    // Update broker charge based on listedBy field if it's being updated
    if (updateData.listedBy) {
      if (updateData.listedBy === 'Owner') {
        updateData.brokerCharge = 0;
      } else if (updateData.listedBy === 'Agent' && !updateData.brokerCharge) {
        updateData.brokerCharge = 1000; // Default broker charge amount
      }
    }

    property = await Property.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true
      }
    ).populate('agent', 'name email phone');

    res.status(200).json({
      success: true,
      message: 'Property updated successfully',
      data: property
    });
  } catch (error) {
    console.error('Update property error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update property',
      error: error.message
    });
  }
};

/**
 * @desc    Delete property
 * @route   DELETE /api/properties/:id
 * @access  Private
 */
const deleteProperty = async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Access control is handled by route middleware (admin/super_admin only)

    // Soft delete
    property.isDeleted = true;
    await property.save();

    res.status(200).json({
      success: true,
      message: 'Property deleted successfully'
    });
  } catch (error) {
    console.error('Delete property error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete property',
      error: error.message
    });
  }
};

/**
 * @desc    Upload property images
 * @route   POST /api/properties/:id/images
 * @access  Private
 */
const uploadImages = async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Access control is handled by route middleware (admin/super_admin only)

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images provided'
      });
    }

    // Check if Cloudinary is configured
    if (!cloudinaryService.isConfigured()) {
      return res.status(500).json({
        success: false,
        message: 'Cloudinary is not configured. Please check environment variables.'
      });
    }

    const uploadResults = [];
    const failedUploads = [];

    // Upload images to Cloudinary
    for (const file of req.files) {
      try {
        const result = await cloudinaryService.uploadImage(
          file.path,
          `properties/${property._id}/images`
        );

        const imageData = {
          cloudinaryUrl: result.url,
          publicId: result.publicId,
          caption: req.body.caption || '',
          isMain: false
        };

        property.images.push(imageData);
        uploadResults.push({
          success: true,
          url: result.url,
          publicId: result.publicId
        });
      } catch (error) {
        console.error(`Failed to upload image ${file.filename}:`, error);
        failedUploads.push({
          filename: file.filename,
          error: error.message
        });
        
        // Clean up local file
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    // Set first image as main if no main image exists
    if (property.images.length > 0 && !property.images.some(img => img.isMain)) {
      property.images[0].isMain = true;
    }

    await property.save();

    res.status(200).json({
      success: true,
      message: `${uploadResults.length} images uploaded successfully`,
      data: {
        uploaded: uploadResults,
        failed: failedUploads,
        totalImages: property.images.length
      }
    });
  } catch (error) {
    console.error('Upload images error:', error);
    
    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to upload images',
      error: error.message
    });
  }
};

/**
 * @desc    Upload property video with social media publishing
 * @route   POST /api/properties/:id/videos
 * @access  Private
 */
const uploadVideo = async (req, res) => {
  console.log('Received upload video request');
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Access control is handled by route middleware (admin/super_admin only)

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No video file provided'
      });
    }

    // Check if Cloudinary is configured
    if (!cloudinaryService.isConfigured()) {
      return res.status(500).json({
        success: false,
        message: 'Cloudinary is not configured. Please check environment variables.'
      });
    }

    const {
      caption = "",
      description = "",
      hashtags = [],
      platforms = [""], // Default to YouTube
      channelId = "@RakeshB-jx2cm", // YouTube channel ID
    } = req.body;

    // Parse platforms if it's a string
    const selectedPlatforms = typeof platforms === 'string' ? 
      JSON.parse(platforms) : platforms;

    // Parse hashtags if it's a string
    const videoHashtags = typeof hashtags === 'string' ? 
      JSON.parse(hashtags) : hashtags;

    // Validate YouTube channel ID if YouTube is selected
    if (selectedPlatforms.includes('youtube') && !channelId) {
      return res.status(400).json({
        success: false,
        message: 'YouTube channel ID is required for YouTube uploads'
      });
    }

    let processedVideoPath = req.file.path;
    console.log('Starting video upload process...', processedVideoPath);
    try {
      // Process video (compress if needed)
      console.log('Processing video for upload...');
      const processResult = await videoCompressionService.processVideoForUpload(
        req.file.path,
        100 // 100MB limit
      );
      
      processedVideoPath = processResult.finalPath;
      console.log('Video processed:', processedVideoPath);
      console.log(`Video processing completed. Final size: ${processResult.finalSize.toFixed(2)}MB`);

      // Upload to Cloudinary
      console.log('Uploading video to Cloudinary...');
      const cloudinaryResult = await cloudinaryService.uploadVideo(
        processedVideoPath,
        `properties/${property._id}/videos`
      );

      // Create video data
      const videoData = {
        path: req.file.path, // Original file path
        cloudinaryUrl: cloudinaryResult.url,
        publicId: cloudinaryResult.publicId,
        caption,
        description,
        hashtags: videoHashtags,
        socialMediaStatus: {}
      };

      // Add video to property
      property.videos.push(videoData);
      await property.save();

      const videoIndex = property.videos.length - 1;

      // Initialize upload status for selected platforms
      await UploadStatusService.initializeUploadStatus(
        property._id,
        videoIndex,
        selectedPlatforms
      );

      // Start social media uploads asynchronously
      if (selectedPlatforms.length > 0) {
        setImmediate(async () => {
          try {
            console.log('Starting social media uploads...');
            
            // Prepare metadata for social media
            const socialMetadata = {
              title: caption || property.title,
              description: description || property.description,
              hashtags: videoHashtags
            };

            // Get access tokens (in production, these would come from user authentication)
            const tokens = {
              youtube: {
                accessToken: process.env.YOUTUBE_ACCESS_TOKEN,
                channelId: channelId
              },
              facebook: process.env.META_ACCESS_TOKEN,
              instagram: process.env.META_ACCESS_TOKEN
            };

            // Validate social media configuration and data
            const validationResult = SocialMediaValidationService.validateAllPlatforms(
              selectedPlatforms,
              {
                videoUrl: cloudinaryResult.url,
                metadata: socialMetadata,
                tokens: tokens
              }
            );

            // Log validation warnings
            if (validationResult.warnings.length > 0) {
              console.warn('Social media validation warnings:', validationResult.warnings);
            }

            // Check if validation failed
            if (!validationResult.isValid) {
              console.error('Social media validation failed:', validationResult.errors);
              
              // Update failed statuses for platforms with validation errors
              const failedStatus = {};
              selectedPlatforms.forEach(platform => {
                const platformValidation = validationResult.platforms[platform];
                if (!platformValidation.isValid) {
                  failedStatus[platform] = {
                    status: 'failed',
                    error: `Validation failed: ${platformValidation.errors.join(', ')}`,
                    uploadedAt: new Date()
                  };
                }
              });
              
              await UploadStatusService.updateMultiplePlatformStatuses(
                property._id,
                videoIndex,
                failedStatus
              );
              return;
            }
            
            // Update status to uploading for valid platforms
            const uploadingStatus = {};
            selectedPlatforms.forEach(platform => {
              if (validationResult.platforms[platform].isValid) {
                uploadingStatus[platform] = { status: 'uploading' };
              }
            });
            
            await UploadStatusService.updateMultiplePlatformStatuses(
              property._id,
              videoIndex,
              uploadingStatus
            );

            // Upload to social media platforms
            const uploadResults = await socialMediaService.uploadToMultiplePlatforms(
              cloudinaryResult.url,
              socialMetadata,
              selectedPlatforms,
              tokens
            );

            // Update upload statuses
            await UploadStatusService.updateMultiplePlatformStatuses(
              property._id,
              videoIndex,
              uploadResults
            );

            console.log('Social media uploads completed:', uploadResults);
          } catch (socialError) {
            console.error('Social media upload error:', socialError);
            
            // Update failed statuses
            const failedStatus = {};
            selectedPlatforms.forEach(platform => {
              failedStatus[platform] = {
                status: 'failed',
                error: socialError.message
              };
            });
            
            await UploadStatusService.updateMultiplePlatformStatuses(
              property._id,
              videoIndex,
              failedStatus
            );
          }
        });
      }

      res.status(200).json({
        success: true,
        message: 'Video uploaded successfully. Social media publishing in progress.',
        data: {
          videoIndex,
          cloudinaryUrl: cloudinaryResult.url,
          publicId: cloudinaryResult.publicId,
          processedSize: processResult.finalSize,
          compressed: processResult.compressed,
          selectedPlatforms,
          socialMediaStatus: 'uploading'
        }
      });
    } catch (uploadError) {
      console.error('Video upload error:', uploadError);
      
      // Clean up files
      if (fs.existsSync(processedVideoPath)) {
        fs.unlinkSync(processedVideoPath);
      }
      if (req.file.path !== processedVideoPath && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      throw uploadError;
    }
  } catch (error) {
    console.error('Upload video error:', error);
    
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to upload video',
      error: error.message
    });
  }
};

/**
 * @desc    Get video upload status
 * @route   GET /api/properties/:id/videos/:videoIndex/status
 * @access  Private
 */
const getVideoUploadStatus = async (req, res) => {
  try {
    const { id: propertyId, videoIndex } = req.params;
    
    const property = await Property.findOne({
      _id: propertyId,
      isDeleted: false
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Access control is handled by route middleware (admin/super_admin only)

    const status = await UploadStatusService.getUploadStatus(propertyId, parseInt(videoIndex));
    
    res.status(200).json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Get video upload status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get video upload status',
      error: error.message
    });
  }
};

/**
 * @desc    Get all video upload statuses for a property
 * @route   GET /api/properties/:id/videos/status
 * @access  Private
 */
const getAllVideoUploadStatuses = async (req, res) => {
  try {
    const { id: propertyId } = req.params;
    
    const property = await Property.findOne({
      _id: propertyId,
      isDeleted: false
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Access control is handled by route middleware (admin/super_admin only)

    const statuses = await UploadStatusService.getAllUploadStatuses(propertyId);
    
    res.status(200).json({
      success: true,
      data: statuses
    });
  } catch (error) {
    console.error('Get all video upload statuses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get video upload statuses',
      error: error.message
    });
  }
};

/**
 * @desc    Get upload statistics for a property
 * @route   GET /api/properties/:id/upload-stats
 * @access  Private
 */
const getUploadStatistics = async (req, res) => {
  try {
    const { id: propertyId } = req.params;
    
    const property = await Property.findOne({
      _id: propertyId,
      isDeleted: false
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Access control is handled by route middleware (admin/super_admin only)

    const statistics = await UploadStatusService.getUploadStatistics(propertyId);
    
    res.status(200).json({
      success: true,
      data: statistics
    });
  } catch (error) {
    console.error('Get upload statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get upload statistics',
      error: error.message
    });
  }
};

// Reupload video to social media platforms
const reuploadVideo = async (req, res) => {
  try {
    const { id: propertyId, videoIndex } = req.params;
    const { platforms = [], channelId = '@RakeshB-jx2cm' } = req.body;

    // Validate property exists
    const property = await Property.findOne({
      _id: propertyId,
      isDeleted: false
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Validate video exists
    const videoIdx = parseInt(videoIndex);
    if (isNaN(videoIdx) || !property.videos[videoIdx]) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    const video = property.videos[videoIdx];

    // Validate platforms
    const validPlatforms = ['youtube', 'facebook', 'instagram'];
    const selectedPlatforms = platforms.filter(platform => validPlatforms.includes(platform));

    if (selectedPlatforms.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please specify valid platforms: youtube, facebook, instagram'
      });
    }

    // Validate YouTube channel ID if YouTube is selected
    if (selectedPlatforms.includes('youtube') && !channelId) {
      return res.status(400).json({
        success: false,
        message: 'YouTube channel ID is required for YouTube uploads'
      });
    }

    // Check if video has Cloudinary URL
    if (!video.cloudinaryUrl) {
      return res.status(400).json({
        success: false,
        message: 'Video must be uploaded to Cloudinary first'
      });
    }

    // Initialize upload status for new platforms or reset failed ones
    const currentStatus = video.socialMediaStatus || {};
    const platformsToUpload = [];

    selectedPlatforms.forEach(platform => {
      const status = currentStatus[platform]?.status;
      if (!status || status === 'failed' || status === 'pending') {
        platformsToUpload.push(platform);
      }
    });

    if (platformsToUpload.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'All selected platforms already have successful uploads. Use force=true to reupload.',
        data: {
          currentStatuses: selectedPlatforms.reduce((acc, platform) => {
            acc[platform] = currentStatus[platform];
            return acc;
          }, {})
        }
      });
    }

    // Force reupload if specified
    if (req.body.force === true) {
      platformsToUpload.push(...selectedPlatforms.filter(p => !platformsToUpload.includes(p)));
    }

    // Initialize/reset upload status for selected platforms
    await UploadStatusService.initializeUploadStatus(
      propertyId,
      videoIdx,
      platformsToUpload
    );

    // Start social media uploads asynchronously
    setImmediate(async () => {
      try {
        console.log(`Starting reupload for property ${propertyId}, video ${videoIdx}...`);
        
        // Prepare metadata for social media
        const socialMetadata = {
          title: video.caption || property.title,
          description: video.description || property.description,
          hashtags: video.hashtags || []
        };

        // Get access tokens
        const tokens = {
          youtube: {
            accessToken: process.env.YOUTUBE_ACCESS_TOKEN,
            channelId: channelId
          },
          facebook: process.env.META_ACCESS_TOKEN,
          instagram: process.env.META_ACCESS_TOKEN
        };

        // Validate social media configuration and data
        const validationResult = SocialMediaValidationService.validateAllPlatforms(
          platformsToUpload,
          {
            videoUrl: video.cloudinaryUrl,
            metadata: socialMetadata,
            tokens: tokens
          }
        );

        // Log validation warnings
        if (validationResult.warnings.length > 0) {
          console.warn('Social media validation warnings:', validationResult.warnings);
        }

        // Check if validation failed
        if (!validationResult.isValid) {
          console.error('Social media validation failed:', validationResult.errors);
          
          // Update failed statuses for platforms with validation errors
          const failedStatus = {};
          platformsToUpload.forEach(platform => {
            const platformValidation = validationResult.platforms[platform];
            if (!platformValidation.isValid) {
              failedStatus[platform] = {
                status: 'failed',
                error: `Validation failed: ${platformValidation.errors.join(', ')}`,
                uploadedAt: new Date()
              };
            }
          });
          
          await UploadStatusService.updateMultiplePlatformStatuses(
            propertyId,
            videoIdx,
            failedStatus
          );
          return;
        }
        
        // Update status to uploading for valid platforms
        const uploadingStatus = {};
        platformsToUpload.forEach(platform => {
          if (validationResult.platforms[platform].isValid) {
            uploadingStatus[platform] = { status: 'uploading' };
          }
        });
        
        await UploadStatusService.updateMultiplePlatformStatuses(
          propertyId,
          videoIdx,
          uploadingStatus
        );

        // Upload to social media platforms
        const uploadResults = await socialMediaService.uploadToMultiplePlatforms(
          video.cloudinaryUrl,
          socialMetadata,
          platformsToUpload,
          tokens
        );

        // Update upload statuses
        await UploadStatusService.updateMultiplePlatformStatuses(
          propertyId,
          videoIdx,
          uploadResults
        );

        console.log('Social media reupload completed:', uploadResults);
      } catch (socialError) {
        console.error('Social media reupload error:', socialError);
        
        // Update failed statuses
        const failedStatus = {};
        platformsToUpload.forEach(platform => {
          failedStatus[platform] = {
            status: 'failed',
            error: socialError.message
          };
        });
        
        await UploadStatusService.updateMultiplePlatformStatuses(
          propertyId,
          videoIdx,
          failedStatus
        );
      }
    });

    res.status(200).json({
      success: true,
      message: 'Video reupload initiated successfully',
      data: {
        propertyId,
        videoIndex: videoIdx,
        cloudinaryUrl: video.cloudinaryUrl,
        platformsToUpload,
        socialMediaStatus: 'uploading'
      }
    });
  } catch (error) {
    console.error('Reupload video error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reupload video',
      error: error.message
    });
  }
};

module.exports = {
  getProperties,
  getProperty,
  createProperty,
  updateProperty,
  deleteProperty,
  uploadImages,
  uploadVideo,
  reuploadVideo,
  getVideoUploadStatus,
  getAllVideoUploadStatuses,
  getUploadStatistics,
  upload
};