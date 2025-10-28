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
  getAdminProperties,
  getDeletedProperties,
  permanentDelete,
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