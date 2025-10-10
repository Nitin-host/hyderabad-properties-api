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
  getWishlist,
  verifyAdminOtp,
  verifyForgotOtp
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
router.post('/verify-admin-otp', verifyAdminOtp);
router.post('/refresh-token', validateRefreshToken, refreshToken);
router.post('/forgot-password', validateForgotPassword, forgotPassword);
router.post('/verify-forgot-otp', verifyForgotOtp);
router.post('/reset-password', resetPassword);

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


module.exports = router;