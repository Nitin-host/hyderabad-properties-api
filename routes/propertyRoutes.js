const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/propertyController');
const {
  validateCreateProperty,
  validateUpdateProperty,
  validatePropertyId,
  validateVideoIndex,
  validatePropertyQuery,
  validateVideoUpload
} = require('../middleware/propertyValidation');
const { protect, authorize } = require('../middleware/auth');

// Multer error handling middleware
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum file size is 500MB.',
          error: err.message
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many files. Maximum 10 images or 1 video allowed.',
          error: err.message
        });
      case 'LIMIT_FIELD_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many fields in the form.',
          error: err.message
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: 'Unexpected file field. Use "images" for image uploads or "video" for video uploads.',
          error: err.message
        });
      default:
        return res.status(400).json({
          success: false,
          message: 'File upload error.',
          error: err.message
        });
    }
  }
  
  // Handle busboy errors (like "Unexpected end of form")
  if (err.message && err.message.includes('Unexpected end of form')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid form data. Please ensure you are sending a proper multipart/form-data request with files.',
      error: 'Unexpected end of form',
      troubleshooting: {
        postman: 'In Postman, use form-data and select "File" type for image uploads',
        curl: 'Use -F flag with @ symbol: curl -F "images=@/path/to/image.jpg"',
        javascript: 'Use FormData: formData.append("images", file)'
      }
    });
  }
  
  next(err);
};

const multer = require('multer');

// Public routes
/**
 * @desc    Get all properties with filtering, sorting, and pagination
 * @route   GET /api/properties
 * @access  Public
 */
router.get('/', validatePropertyQuery, getProperties);

/**
 * @desc    Get single property by ID
 * @route   GET /api/properties/:id
 * @access  Public
 */
router.get('/:id', validatePropertyId, getProperty);

// Protected routes (require authentication)
/**
 * @desc    Create new property
 * @route   POST /api/properties
 * @access  Private (admin, super_admin only)
 */
router.post('/', protect, authorize('admin', 'super_admin'), validateCreateProperty, createProperty);

/**
 * @desc    Update property
 * @route   PUT /api/properties/:id
 * @access  Private (admin, super_admin only)
 */
router.put('/:id', protect, authorize('admin', 'super_admin'), validatePropertyId, validateUpdateProperty, updateProperty);

/**
 * @desc    Delete property (soft delete)
 * @route   DELETE /api/properties/:id
 * @access  Private (admin, super_admin only)
 */
router.delete('/:id', protect, authorize('admin', 'super_admin'), validatePropertyId, deleteProperty);

// Media upload routes
/**
 * @desc    Upload property images
 * @route   POST /api/properties/:id/images
 * @access  Private (admin, super_admin only)
 */
router.post(
  '/:id/images',
  protect,
  authorize('admin', 'super_admin'),
  validatePropertyId,
  upload.array('images', 10), // Allow up to 10 images
  handleMulterError,
  uploadImages
);

/**
 * @desc    Upload property video with social media publishing
 * @route   POST /api/properties/:id/videos
 * @access  Private (admin, super_admin only)
 */
router.post(
  '/:id/videos',
  protect,
  authorize('admin', 'super_admin'),
  validatePropertyId,
  upload.single('video'), // Single video upload
  handleMulterError,
  validateVideoUpload,
  uploadVideo
);

/**
 * @desc    Reupload video to social media platforms
 * @route   POST /api/properties/:id/videos/:videoIndex/reupload
 * @access  Private (admin, super_admin only)
 */
router.post(
  '/:id/videos/:videoIndex/reupload',
  protect,
  authorize('admin', 'super_admin'),
  validatePropertyId,
  validateVideoIndex,
  reuploadVideo
);

// Video status tracking routes
/**
 * @desc    Get video upload status for specific video
 * @route   GET /api/properties/:id/videos/:videoIndex/status
 * @access  Private (admin, super_admin only)
 */
router.get(
  '/:id/videos/:videoIndex/status',
  protect,
  authorize('admin', 'super_admin'),
  validatePropertyId,
  validateVideoIndex,
  getVideoUploadStatus
);

/**
 * @desc    Get all video upload statuses for a property
 * @route   GET /api/properties/:id/videos/status
 * @access  Private (admin, super_admin only)
 */
router.get(
  '/:id/videos/status',
  protect,
  authorize('admin', 'super_admin'),
  validatePropertyId,
  getAllVideoUploadStatuses
);

/**
 * @desc    Get upload statistics for a property
 * @route   GET /api/properties/:id/upload-stats
 * @access  Private (admin, super_admin only)
 */
router.get(
  '/:id/upload-stats',
  protect,
  authorize('admin', 'super_admin'),
  validatePropertyId,
  getUploadStatistics
);

// Admin-only routes
/**
 * @desc    Get all properties including deleted ones (admin view)
 * @route   GET /api/properties/admin/all
 * @access  Private (admin, super_admin only)
 */
router.get(
  '/admin/all',
  protect,
  authorize('admin', 'super_admin'),
  async (req, res) => {
    try {
      const Property = require('../models/Property');
      
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // Build filter object (include deleted properties for admin)
      const filter = {};
      
      if (req.query.isDeleted !== undefined) {
        filter.isDeleted = req.query.isDeleted === 'true';
      }

      if (req.query.status) {
        filter.status = req.query.status;
      }

      if (req.query.propertyType) {
        filter.propertyType = req.query.propertyType;
      }

      const properties = await Property.find(filter)
        .populate('agent', 'name email phone role')
        .sort({ createdAt: -1 })
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
      console.error('Admin get all properties error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch properties',
        error: error.message
      });
    }
  }
);

/**
 * @desc    Permanently delete property (hard delete)
 * @route   DELETE /api/properties/admin/:id/permanent
 * @access  Private (super_admin only)
 */
router.delete(
  '/admin/:id/permanent',
  protect,
  authorize('super_admin'),
  validatePropertyId,
  async (req, res) => {
    try {
      const Property = require('../models/Property');
      const cloudinaryService = require('../services/cloudinaryService');
      
      const property = await Property.findById(req.params.id);

      if (!property) {
        return res.status(404).json({
          success: false,
          message: 'Property not found'
        });
      }

      // Delete images from Cloudinary
      if (property.images && property.images.length > 0) {
        for (const image of property.images) {
          if (image.publicId) {
            try {
              await cloudinaryService.deleteFile(image.publicId);
            } catch (error) {
              console.error(`Failed to delete image ${image.publicId}:`, error);
            }
          }
        }
      }

      // Delete videos from Cloudinary
      if (property.videos && property.videos.length > 0) {
        for (const video of property.videos) {
          if (video.publicId) {
            try {
              await cloudinaryService.deleteFile(video.publicId);
            } catch (error) {
              console.error(`Failed to delete video ${video.publicId}:`, error);
            }
          }
        }
      }

      // Permanently delete from database
      await Property.findByIdAndDelete(req.params.id);

      res.status(200).json({
        success: true,
        message: 'Property permanently deleted successfully'
      });
    } catch (error) {
      console.error('Permanent delete property error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to permanently delete property',
        error: error.message
      });
    }
  }
);

/**
 * @desc    Restore soft-deleted property
 * @route   PUT /api/properties/admin/:id/restore
 * @access  Private (admin, super_admin only)
 */
router.put(
  '/admin/:id/restore',
  protect,
  authorize('admin', 'super_admin'),
  validatePropertyId,
  async (req, res) => {
    try {
      const Property = require('../models/Property');
      
      const property = await Property.findById(req.params.id);

      if (!property) {
        return res.status(404).json({
          success: false,
          message: 'Property not found'
        });
      }

      if (!property.isDeleted) {
        return res.status(400).json({
          success: false,
          message: 'Property is not deleted'
        });
      }

      property.isDeleted = false;
      await property.save();

      await property.populate('agent', 'name email phone');

      res.status(200).json({
        success: true,
        message: 'Property restored successfully',
        data: property
      });
    } catch (error) {
      console.error('Restore property error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to restore property',
        error: error.message
      });
    }
  }
);

/**
 * @desc    Update property featured status
 * @route   PUT /api/properties/admin/:id/featured
 * @access  Private (admin, super_admin only)
 */
router.put(
  '/admin/:id/featured',
  protect,
  authorize('admin', 'super_admin'),
  validatePropertyId,
  async (req, res) => {
    try {
      const Property = require('../models/Property');
      const { featured } = req.body;
      
      if (typeof featured !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'Featured status must be true or false'
        });
      }

      const property = await Property.findOneAndUpdate(
        { _id: req.params.id, isDeleted: false },
        { featured },
        { new: true, runValidators: true }
      ).populate('agent', 'name email phone');

      if (!property) {
        return res.status(404).json({
          success: false,
          message: 'Property not found'
        });
      }

      res.status(200).json({
        success: true,
        message: `Property ${featured ? 'featured' : 'unfeatured'} successfully`,
        data: property
      });
    } catch (error) {
      console.error('Update featured status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update featured status',
        error: error.message
      });
    }
  }
);

/**
 * @desc    Get property statistics (admin dashboard)
 * @route   GET /api/properties/admin/stats
 * @access  Private (admin, super_admin only)
 */
router.get(
  '/admin/stats',
  protect,
  authorize('admin', 'super_admin'),
  async (req, res) => {
    try {
      const Property = require('../models/Property');
      
      const stats = await Property.aggregate([
        {
          $group: {
            _id: null,
            totalProperties: { $sum: 1 },
            activeProperties: {
              $sum: { $cond: [{ $eq: ['$isDeleted', false] }, 1, 0] }
            },
            deletedProperties: {
              $sum: { $cond: [{ $eq: ['$isDeleted', true] }, 1, 0] }
            },
            featuredProperties: {
              $sum: { $cond: [{ $and: [{ $eq: ['$featured', true] }, { $eq: ['$isDeleted', false] }] }, 1, 0] }
            },
            availableProperties: {
              $sum: { $cond: [{ $and: [{ $eq: ['$status', 'available'] }, { $eq: ['$isDeleted', false] }] }, 1, 0] }
            },
            soldProperties: {
              $sum: { $cond: [{ $and: [{ $eq: ['$status', 'sold'] }, { $eq: ['$isDeleted', false] }] }, 1, 0] }
            },
            rentedProperties: {
              $sum: { $cond: [{ $and: [{ $eq: ['$status', 'rented'] }, { $eq: ['$isDeleted', false] }] }, 1, 0] }
            },
            averagePrice: { $avg: '$price' },
            totalImagesUploaded: { $sum: { $size: '$images' } },
            totalVideosUploaded: { $sum: { $size: '$videos' } }
          }
        }
      ]);

      // Get property type distribution
      const propertyTypeStats = await Property.aggregate([
        { $match: { isDeleted: false } },
        {
          $group: {
            _id: '$propertyType',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]);

      // Get monthly property creation stats for the last 12 months
      const monthlyStats = await Property.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(new Date().setMonth(new Date().getMonth() - 12))
            }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]);

      res.status(200).json({
        success: true,
        data: {
          overview: stats[0] || {
            totalProperties: 0,
            activeProperties: 0,
            deletedProperties: 0,
            featuredProperties: 0,
            availableProperties: 0,
            soldProperties: 0,
            rentedProperties: 0,
            averagePrice: 0,
            totalImagesUploaded: 0,
            totalVideosUploaded: 0
          },
          propertyTypeDistribution: propertyTypeStats,
          monthlyCreationStats: monthlyStats
        }
      });
    } catch (error) {
      console.error('Get property statistics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get property statistics',
        error: error.message
      });
    }
  }
);

module.exports = router;