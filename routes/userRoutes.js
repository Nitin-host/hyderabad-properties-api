const express = require('express');
const {
  register,
  login,
  refreshToken,
  getProfile,
  updateProfile,
  createUser,
  getAllUsers,
  updateUserRole,
  deleteUser,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  addToWishlist,
  removeFromWishlist,
  getWishlist
} = require('../controllers/userController');
const {
  protect,
  authorize,
  superAdminOnly,
  adminOrSuperAdmin,
  ownerOrAdmin
} = require('../middleware/auth');
const {
  validateUserRegistration,
  validateUserLogin,
  validateCreateUser,
  validateUpdateProfile,
  validateUpdateUserRole,
  validateRefreshToken,
  validateForgotPassword,
  validatePasswordReset,
  validateChangePassword
} = require('../middleware/validation');

const router = express.Router();

// Public routes
router.post('/register', validateUserRegistration, register);
router.post('/login', validateUserLogin, login);
router.post('/refresh-token', validateRefreshToken, refreshToken);
router.post('/forgot-password', validateForgotPassword, forgotPassword);
router.put('/reset-password/:token', validatePasswordReset, resetPassword);

// Protected routes (require authentication)
router.use(protect); // All routes below this middleware require authentication

// User profile routes
router.get('/profile', getProfile);
router.put('/profile', validateUpdateProfile, updateProfile);
router.put('/change-password', validateChangePassword, changePassword);
router.post('/logout', logout);

//Wishlist routes
router.get("/favorites", getWishlist);
router.post("/favorites/:id", addToWishlist);
router.delete("/favorites/:id", removeFromWishlist);

// Super Admin only routes
router.post('/admin/create', superAdminOnly, validateCreateUser, createUser);
router.get('/', superAdminOnly, getAllUsers);
router.put('/:id/role', superAdminOnly, validateUpdateUserRole, updateUserRole);
router.delete('/:id', superAdminOnly, deleteUser);

// Additional routes that might be useful

// Get user by ID (Admin or Super Admin only)
router.get('/:id', adminOrSuperAdmin, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.params.id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Update user (Admin or Super Admin only, or user updating their own profile)
router.put('/:id', ownerOrAdmin, validateUpdateProfile, async (req, res) => {
  try {
    const User = require('../models/User');
    const { name, phone } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, phone },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Get users with pagination and filtering (Admin or Super Admin only)
router.get('/search/filter', adminOrSuperAdmin, async (req, res) => {
  try {
    const User = require('../models/User');
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { role, search } = req.query;

    // Build query
    let query = {};
    
    if (role && ['user', 'admin', 'super_admin'].includes(role)) {
      query.role = role;
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        },
        filters: {
          role: role || 'all',
          search: search || ''
        }
      }
    });
  } catch (error) {
    console.error('Filter users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Get user statistics (Super Admin only)
router.get('/stats/overview', superAdminOnly, async (req, res) => {
  try {
    const User = require('../models/User');
    
    const totalUsers = await User.countDocuments();
    const usersByRole = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const recentUsers = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(5);

    // Get users created in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const newUsersThisMonth = await User.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        usersByRole: usersByRole.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        newUsersThisMonth,
        recentUsers
      }
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});


module.exports = router;