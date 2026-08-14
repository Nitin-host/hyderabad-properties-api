const express = require('express');
const router = express.Router();
const {
  getProperties,
  getProperty,
  createProperty,
  updateProperty,
  deleteProperty,
  uploadPropertyImages,
  uploadPropertyVideos,
  upload,
  chunkUpload,
  getAdminProperties,
  getDeletedProperties,
  permanentDelete,
  checkVideoStatus,
  getPropertyBySlug,
  initiateChunkedVideoUpload,
  uploadVideoChunk,
  completeChunkedVideoUpload,
  abortChunkedVideoUpload,
  getAdminStats,
} = require('../controllers/propertyController');
const {
  validateCreateProperty,
  validateUpdateProperty,
  validatePropertyId,
  parseJsonFieldsMiddleware,
} = require('../middleware/propertyValidation');
const { protect, authorize, adminOrSuperAdmin } = require('../middleware/auth');

// Public routes
/**
 * @desc    Get all properties with filtering, sorting, and pagination
 * @route   GET /api/properties
 * @access  Public
 */
router.get('/', getProperties);

router.get( "/deleted", protect, adminOrSuperAdmin, getDeletedProperties);

router.get("/admin", protect, adminOrSuperAdmin, getAdminProperties);

/**
 * @desc    Get single property by ID
 * @route   GET /api/properties/:id
 * @access  Public
 */
router.get('/slug/:slug', getPropertyBySlug);
router.get('/:id', validatePropertyId, getProperty);

// Protected routes (require authentication)
/**
 * @desc    Create new property
 * @route   POST /api/properties
 * @access  Private (admin, super_admin only)
 */
router.post('/', protect, authorize('admin', 'super_admin'), parseJsonFieldsMiddleware(["amenities"]), validateCreateProperty, createProperty);

// Image Upload route
router.post('/:id/images', protect, authorize('admin', 'super_admin'), validatePropertyId, upload.array('images', 20), uploadPropertyImages);

// Chunked video upload (Railway-safe: small parts, source stored on R2)
router.post('/:id/video/initiate', protect, authorize('admin', 'super_admin'), validatePropertyId, initiateChunkedVideoUpload);
router.put(
  '/:id/video/part',
  protect,
  authorize('admin', 'super_admin'),
  validatePropertyId,
  chunkUpload.single('chunk'),
  uploadVideoChunk
);
router.post('/:id/video/complete', protect, authorize('admin', 'super_admin'), validatePropertyId, completeChunkedVideoUpload);
router.post('/:id/video/abort', protect, authorize('admin', 'super_admin'), validatePropertyId, abortChunkedVideoUpload);

// Legacy single-request video upload
router.post('/:id/video', protect, authorize('admin', 'super_admin'), validatePropertyId, upload.fields([{ name: 'videos', maxCount: 1 }]), uploadPropertyVideos);

//video status route
router.get('/:id/video/status', protect, authorize('admin', 'super_admin'), validatePropertyId, checkVideoStatus);
/**
 * @desc    Update property
 * @route   PUT /api/properties/:id
 * @access  Private (admin, super_admin only)
 */
router.put(
  "/:id",
  protect,
  authorize("admin", "super_admin"),
  upload.fields([
    { name: "images", maxCount: 20 },
    { name: "videos", maxCount: 1 },
    { name: "replaceMapFiles", maxCount: 10 }
  ]),
  parseJsonFieldsMiddleware([
    "amenities",
    "removedImages",
    "removedVideos",
    "replaceMap",
  ]),
  validatePropertyId,
  validateUpdateProperty,
  updateProperty
);

/**
 * @desc    Delete property (soft delete)
 * @route   DELETE /api/properties/:id
 * @access  Private (admin, super_admin only)
 */
router.delete('/:id', protect, authorize('admin', 'super_admin'), validatePropertyId, deleteProperty);

// Admin-only routes
/**
 * @desc    Permanently delete property (hard delete)
 * @route   DELETE /api/properties/admin/:id/permanent
 */
router.delete("/admin/:id/permanent", protect, adminOrSuperAdmin, validatePropertyId, permanentDelete);

/**
 * @desc    Restore soft-deleted property
 * @route   PUT /api/properties/admin/:id/restore
 * @access  Private (admin, super_admin only)
 */
router.put(
  "/admin/:id/restore",
  protect,
  authorize("admin", "super_admin"),
  validatePropertyId,
  async (req, res) => {
    try {
      const Property = require("../models/Property");

      // Restore property in one step
      const property = await Property.findByIdAndUpdate(
        req.params.id,
        {
          isDeleted: false,
          deletedBy: null,
          deletedAt: null,
        },
        { new: true, runValidators: true }
      ).populate("agent", "name email phone");

      if (!property) {
        return res.status(404).json({
          success: false,
          message: "Property not found",
        });
      }

      // Optional: check if it was already restored
      if (!property.isDeleted) {
        return res.status(200).json({
          success: true,
          message: "Property was restored successfully",
          data: property,
        });
      }

      res.status(200).json({
        success: true,
        message: "Property restored successfully",
        data: property,
      });
    } catch (error) {
      console.error("Restore property error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to restore property",
        error: error.message,
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
  "/admin/stats",
  protect,
  authorize("admin", "super_admin"),
  getAdminStats
);

module.exports = router;