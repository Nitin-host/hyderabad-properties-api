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
} = require('../controllers/propertyController');
const {
  validateCreateProperty,
  validateUpdateProperty,
  validatePropertyId,
  parseJsonFieldsMiddleware,
} = require('../middleware/propertyValidation');
const { protect, authorize } = require('../middleware/auth');


// Public routes
/**
 * @desc    Get all properties with filtering, sorting, and pagination
 * @route   GET /api/properties
 * @access  Public
 */
router.get('/', getProperties);

router.get(
  "/deleted",
  protect,
  authorize("admin", "super_admin"),
  async (req, res) => {
    try {
      const Property = require("../models/Property");
      const { getPresignedUrl } = require("../services/r2Service");

      // Fetch deleted properties
      const properties = await Property.find({ isDeleted: true })
        .populate("agent", "name email phone role")
        .sort({ createdAt: -1 })
        .populate('deletedBy', 'name email phone role')
        .populate('updatedBy', 'name email phone role')
        .populate('createdBy', 'name email phone role')
        .lean();

      // Add presigned URLs to images and videos for each property
      const propertiesWithPresignedUrls = await Promise.all(
        properties.map(async (property) => {
          const images = await Promise.all(
            (property.images || []).map(async (img) => ({
              ...img,
              presignUrl: img.key ? await getPresignedUrl(img.key) : null,
            }))
          );

          const videos = await Promise.all(
            (property.videos || []).map(async (vid) => ({
              ...vid,
              presignUrl: vid.key ? await getPresignedUrl(vid.key) : null,
              thumbnail: vid.thumbnailKey
                ? await getPresignedUrl(vid.thumbnailKey)
                : null,
            }))
          );

          return {
            ...property,
            images,
            videos,
          };
        })
      );

      res.status(200).json({
        success: true,
        count: propertiesWithPresignedUrls.length,
        data: propertiesWithPresignedUrls,
      });
    } catch (error) {
      console.error("Get deleted properties error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch deleted properties",
        error: error.message,
      });
    }
  }
);

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
router.post('/', protect, authorize('admin', 'super_admin'), parseJsonFieldsMiddleware(["amenities"]), validateCreateProperty, createProperty);

// Image Upload route
router.post('/:id/images', protect, authorize('admin', 'super_admin'), validatePropertyId, upload.array('images', 10), uploadPropertyImages);

// Video Upload route
router.post('/:id/video', protect, authorize('admin', 'super_admin'), validatePropertyId, upload.fields([{ name: 'videos', maxCount: 1 }]), uploadPropertyVideos);

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
    { name: "images", maxCount: 10 },
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
  "/admin/:id/permanent",
  protect,
  authorize("super_admin"),
  validatePropertyId,
  async (req, res) => {
    try {
      const Property = require("../models/Property");
      const r2Service = require("../services/r2Service"); // your R2 service

      const property = await Property.findById(req.params.id);

      if (!property) {
        return res.status(404).json({
          success: false,
          message: "Property not found",
        });
      }

      // Delete images from R2
      if (property.images && property.images.length > 0) {
        for (const image of property.images) {
          if (image.key) {
            try {
              await r2Service.deleteFile(image.key);
            } catch (error) {
              console.error(`Failed to delete image ${image.key}:`, error);
            }
          }
        }
      }

      // Delete videos from R2
      if (property.videos && property.videos.length > 0) {
        for (const video of property.videos) {
          if (video.key && video.thumbnailKey) {
            try {
              await r2Service.deleteFile(video.key);
              await r2Service.deleteFile(video.thumbnailKey);
            } catch (error) {
              console.error(`Failed to delete video ${video.key}:`, error);
            }
          }
        }
      }

      // Permanently delete from database
      await Property.findByIdAndDelete(req.params.id);

      res.status(200).json({
        success: true,
        message: "Property permanently deleted successfully",
      });
    } catch (error) {
      console.error("Permanent delete property error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to permanently delete property",
        error: error.message,
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
        { isDeleted: false },
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
          message: "Property was already active",
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
  async (req, res) => {
    try {
      const Property = require("../models/Property");
      const range = req.query.range || "month";
      const now = new Date();

      // ✅ Function to get date range of ISO week
      function getDateRangeOfISOWeek(week, year) {
        const simple = new Date(year, 0, 1 + (week - 1) * 7);
        const ISOWeekStart = new Date(simple);
        if (simple.getDay() <= 4) {
          ISOWeekStart.setDate(simple.getDate() - simple.getDay() + 1);
        } else {
          ISOWeekStart.setDate(simple.getDate() + 8 - simple.getDay());
        }
        const ISOWeekEnd = new Date(ISOWeekStart);
        ISOWeekEnd.setDate(ISOWeekStart.getDate() + 6);
        return { start: ISOWeekStart, end: ISOWeekEnd };
      }

      // 1️⃣ Overview aggregation
      const overviewAgg = await Property.aggregate([
        {
          $group: {
            _id: null,
            totalProperties: { $sum: 1 },
            activeProperties: {
              $sum: { $cond: [{ $eq: ["$isDeleted", false] }, 1, 0] },
            },
            deletedProperties: {
              $sum: { $cond: [{ $eq: ["$isDeleted", true] }, 1, 0] },
            },
            averagePrice: { $avg: "$price" },
            totalImagesUploaded: { $sum: { $size: "$images" } },
            totalVideosUploaded: { $sum: { $size: "$videos" } },
          },
        },
      ]);

      const overview = overviewAgg[0] || {};
      const totalProperties = overview.totalProperties || 0;

      // 2️⃣ Dynamic type distribution
      const propertyTypeAgg = await Property.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: "$propertyType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);

      const propertyTypeDistribution = propertyTypeAgg.map((p) => ({
        type: p._id,
        count: p.count,
        percentage: totalProperties
          ? ((p.count / totalProperties) * 100).toFixed(1)
          : 0,
      }));

      // 3️⃣ Dynamic status distribution
      const statusAgg = await Property.aggregate([
        { $match: { isDeleted: false } },
        {
          $group: {
            _id: { $toLower: "$status" },
            originalStatuses: { $addToSet: "$status" },
            count: { $sum: 1 },
          },
        },
      ]);

      let statusStats = statusAgg.map((s) => ({
        status: s.originalStatuses[0],
        count: s.count,
        percentage: totalProperties
          ? ((s.count / totalProperties) * 100).toFixed(1)
          : 0,
      }));

      if (overview.deletedProperties > 0) {
        statusStats.push({
          status: "Deleted",
          count: overview.deletedProperties,
          percentage: totalProperties
            ? ((overview.deletedProperties / totalProperties) * 100).toFixed(1)
            : 0,
        });
      }

      // 4️⃣ Time range filter logic
      let match = {};
      if (range === "week") {
        const last12Weeks = new Date();
        last12Weeks.setDate(now.getDate() - 7 * 12);
        match.createdAt = { $gte: last12Weeks };
      } else if (range === "month") {
        const last12Months = new Date();
        last12Months.setMonth(now.getMonth() - 12);
        match.createdAt = { $gte: last12Months };
      } else {
        const last5Years = new Date();
        last5Years.setFullYear(now.getFullYear() - 5);
        match.createdAt = { $gte: last5Years };
      }

      // Group logic
      let groupId;
      if (range === "week")
        groupId = {
          year: { $year: "$createdAt" },
          week: { $isoWeek: "$createdAt" },
        };
      else if (range === "month")
        groupId = {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        };
      else groupId = { year: { $year: "$createdAt" } };

      // 5️⃣ Aggregation
      let creationStats = await Property.aggregate([
        { $match: match },
        { $group: { _id: groupId, count: { $sum: 1 } } },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.week": 1 } },
      ]);

      // ✅ Format stats with pretty labels
      const formattedCreationStats = creationStats.map((item) => {
        if (item._id.week) {
          const { start, end } = getDateRangeOfISOWeek(
            item._id.week,
            item._id.year
          );
          const label = `${start.toLocaleString("en-US", {
            month: "short",
          })} ${start.getDate()} - ${end.toLocaleString("en-US", {
            month: "short",
          })} ${end.getDate()}, ${item._id.year}`;
          return { ...item, label };
        }

        if (item._id.month) {
          const monthName = new Date(
            item._id.year,
            item._id.month - 1,
            1
          ).toLocaleString("en-US", { month: "short" });
          return { ...item, label: `${monthName} ${item._id.year}` };
        }

        return { ...item, label: `${item._id.year}` };
      });

      // ✅ Return response
      res.status(200).json({
        success: true,
        data: {
          overview,
          propertyTypeDistribution,
          statusDistribution: statusStats,
          creationStats: formattedCreationStats,
        },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Failed to get stats",
        error: error.message,
      });
    }
  }
);

module.exports = router;