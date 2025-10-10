const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please add a name"],
      trim: true,
      maxlength: [50, "Name cannot be more than 50 characters"],
    },
    email: {
      type: String,
      required: [true, "Please add an email"],
      unique: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please add a valid email",
      ],
    },
    password: {
      type: String,
      required: [true, "Please add a password"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    role: {
      type: String,
      enum: ["user", "admin", "super_admin"],
      default: "user",
    },
    phone: {
      type: String,
    },
    avatar: {
      type: String,
      default: "default-avatar.jpg",
    },
    otp: { type: String },
    otpExpiry: { type: Date },
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    tempPassword: String,
    mustChangePassword: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    avatar: String, 
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: Date,
    lastLogin: Date,
    isActive: { type: Boolean, default: true },
    wishlist: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Property",
      },
    ]
  },
  { timestamps: true }
);

// Encrypt password using bcrypt
UserSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  if (this.isModified("tempPassword") && this.tempPassword) {
    const salt = await bcrypt.genSalt(10);
    this.tempPassword = await bcrypt.hash(this.tempPassword, salt);
  }

  next();
});

// Match tempPassword method
UserSchema.methods.matchTempPassword = async function(enteredPassword) {
  if (!this.tempPassword) return false;
  return await bcrypt.compare(enteredPassword, this.tempPassword);
};


// Match user entered password to hashed password in database
UserSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);