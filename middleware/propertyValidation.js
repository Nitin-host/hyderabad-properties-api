const { body, param, query, validationResult } = require('express-validator');

// Helper function to handle validation results
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.path,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

// Property creation validation
const validateCreateProperty = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ min: 3, max: 200 })
    .withMessage("Title must be between 3 and 200 characters"),

  body("description")
    .trim()
    .notEmpty()
    .withMessage("Description is required")
    .isLength({ min: 10, max: 2000 })
    .withMessage("Description must be between 10 and 2000 characters"),

  body("propertyType")
    .notEmpty()
    .withMessage("Property type is required")
    .isIn([
      "Standalone",
      "Gated Community",
      "Apartment",
      "Villa",
      "Independent House",
      "Plot",
      "Commercial",
      "Office Space",
      "Other",
    ])
    .withMessage("Invalid property type"),

  body("location")
    .notEmpty()
    .withMessage("Location is required")
    .isString()
    .isLength({ min: 3, max: 500 })
    .withMessage("Location must be between 3 and 500 characters"),

  body("landmarks")
    .notEmpty()
    .withMessage("Landmarks are required")
    .isString()
    .withMessage("Landmarks must be a string")
    .isLength({ max: 500 })
    .withMessage("Landmarks must not exceed 500 characters"),

  body("price")
    .isNumeric()
    .withMessage("Price must be a number")
    .isFloat({ min: 0 })
    .withMessage("Price must be a positive number"),

  body("size")
    .isNumeric()
    .withMessage("Size must be a number")
    .isFloat({ min: 0 })
    .withMessage("Size must be a positive number"),

  body("maintenance")
    .notEmpty()
    .withMessage("Maintenance is required")
    .isNumeric()
    .withMessage("Maintenance must be a number")
    .isFloat({ min: 0 })
    .withMessage("Maintenance must be a positive number"),

  body("listedBy")
    .notEmpty()
    .withMessage("Listed By is required")
    .isIn(["owner", "agent"])
    .withMessage("Listed By must be Owner or Agent"),

  body("brokerCharge")
    .optional()
    .isIn(["20 Days", "1 month", "no charge", "Contact for details"])
    .withMessage("Invalid broker charge option"),
  
  body("totalFloors")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Total floors must be a positive integer"),

  body("bedrooms")
    .optional()
    .isIn(["1BHK", "2BHK", "3BHK", "4BHK"])
    .withMessage("Bedrooms must be 1BHK, 2BHK, 3BHK, or 4BHK"),

  body("bathrooms")
    .optional()
    .isInt({ min: 0, max: 20 })
    .withMessage("Bathrooms must be a number between 0 and 20"),

  body("balconies")
    .optional()
    .isIn([0, 1, 2, 3])
    .withMessage("Balconies must be 0, 1, 2, or 3"),

  body("furnished")
    .optional()
    .isIn(["Fully Furnished", "Semi Furnished", "Unfurnished"])
    .withMessage(
      "Furnished status must be Fully Furnished, Semi Furnished, or Unfurnished"
    ),

  body("parking")
    .optional()
    .isIn(["bike", "car", "car & bike", "none"])
    .withMessage("Parking must be bike, car, car & bike, or none"),

  // Optional fields validation
  body("securityDeposit")
    .optional()
    .isNumeric()
    .withMessage("Security deposit must be a number")
    .isFloat({ min: 0 })
    .withMessage("Security deposit must be a positive number"),

  body("flooring")
    .optional()
    .isIn([
      "Marble",
      "Tiles",
      "Wooden",
      "Granite",
      "Ceramic",
      "Vitrified",
      "Other",
    ])
    .withMessage("Invalid flooring type"),

  body("overlooking")
    .optional()
    .isIn(["Main Road", "Garden", "Park", "Pool", "Club", "Other"])
    .withMessage("Invalid overlooking option"),

  body("ageOfConstruction")
    .optional()
    .isIn([
      "Newly Built",
      "Under Construction",
      "Less than 5 years",
      "5-10 years",
      "10-15 years",
      "15-20 years",
      "More than 20 years",
    ])
    .withMessage("Invalid age of construction"),

  body("additionalRooms")
    .optional()
    .isIn(["Puja Room", "Study Room", "Servant Room", "Store Room", "Other"])
    .withMessage("Invalid additional room"),

  body("waterAvailability")
    .optional()
    .isIn([
      "24 Hours Available",
      "12 Hours Available",
      "6 Hours Available",
      "Limited Supply",
      "Borewell",
      "Corporation Water",
      "Both",
    ])
    .withMessage("Invalid water availability option"),

  body("statusOfElectricity")
    .optional()
    .isIn([
      "No/Rare Powercut",
      "Frequent Powercut",
      "Power Backup Available",
      "No Power Issues",
      "Generator Available",
    ])
    .withMessage("Invalid electricity status"),

  body("lift")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Lift must be a number (0 or more)"),

  body("amenities")
    .optional()
    .isArray()
    .withMessage("Amenities must be an array")
    .custom((amenities) => {
      // Allow any string values for amenities as the model uses [String]
      amenities.forEach((amenity) => {
        if (typeof amenity !== "string" || amenity.trim().length === 0) {
          throw new Error("Each amenity must be a non-empty string");
        }
      });
      return true;
    }),

  body("status")
    .optional()
    .isIn([
      "For Sale",
      "For Rent",
      "Sold",
      "Rented",
      "rented",
      "Under Contract",
      "Available",
      "Occupied",
    ])
    .withMessage("Invalid status"),

  body("availability")
    .notEmpty()
    .withMessage("Availability is required")
    .isIn(["immediate", "date"])
    .withMessage("Availability must be either 'immediate' or 'date'"),

  body("availabilityDate")
    .if(body("availability").equals("date"))
    .notEmpty()
    .withMessage("Availability date is required when availability is 'date'")
    .isISO8601()
    .withMessage("Availability date must be a valid date")
    .custom((value) => {
      const today = new Date().setHours(0, 0, 0, 0);
      const selectedDate = new Date(value).setHours(0, 0, 0, 0);
      if (selectedDate < today) {
        throw new Error("Availability date cannot be in the past");
      }
      return true;
    }),

  handleValidationErrors,
];

// Property update validation (similar to create but all fields optional)
const validateUpdateProperty = [
  body("title")
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage("Title must be between 3 and 200 characters"),

  body("description")
    .optional()
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage("Description must be between 10 and 2000 characters"),

  body("location")
    .notEmpty()
    .withMessage("Location is required")
    .isString()
    .isLength({ min: 3, max: 500 })
    .withMessage("Location must be between 3 and 500 characters"),

  body("maintenance")
    .notEmpty()
    .withMessage("Maintenance is required")
    .isNumeric()
    .withMessage("Maintenance must be a number")
    .isFloat({ min: 0 })
    .withMessage("Maintenance must be a positive number"),

  body("listedBy")
    .notEmpty()
    .withMessage("Listed By is required")
    .isIn(["owner", "agent"])
    .withMessage("Listed By must be Owner or Agent"),

  body("brokerCharge")
    .optional()
    .isIn(["20 Days", "1 month", "no charge", "Contact for details"])
    .withMessage("Invalid broker charge option"),

  body("landmarks")
    .notEmpty()
    .withMessage("Landmarks are required")
    .isString()
    .withMessage("Landmarks must be a string")
    .isLength({ max: 500 })
    .withMessage("Landmarks must not exceed 500 characters"),

  body("propertyType")
    .optional()
    .isIn([
      "Standalone",
      "Gated Community",
      "Apartment",
      "Villa",
      "Independent House",
      "Plot",
      "Commercial",
      "Office Space",
      "Other",
    ])
    .withMessage("Invalid property type"),

  body("price")
    .optional()
    .isNumeric()
    .withMessage("Price must be a number")
    .isFloat({ min: 0 })
    .withMessage("Price must be a positive number"),

  body("size")
    .optional()
    .isNumeric()
    .withMessage("Size must be a number")
    .isFloat({ min: 0 })
    .withMessage("Size must be a positive number"),

  body("totalFloors")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Total floors must be a positive integer"),

  body("bedrooms")
    .optional()
    .isIn(["1BHK", "2BHK", "3BHK", "4BHK"])
    .withMessage("Bedrooms must be 1BHK, 2BHK, 3BHK, or 4BHK"),

  body("bathrooms")
    .optional()
    .isInt({ min: 0, max: 20 })
    .withMessage("Bathrooms must be a number between 0 and 20"),

  body("balconies")
    .optional()
    .isIn([0, 1, 2, 3])
    .withMessage("Balconies must be 0, 1, 2, or 3"),

  body("furnished")
    .optional()
    .isIn(["Fully Furnished", "Semi Furnished", "Unfurnished"])
    .withMessage(
      "Furnished status must be Fully Furnished, Semi Furnished, or Unfurnished"
    ),

  body("parking")
    .optional()
    .isIn(["bike", "car", "car & bike", "none"])
    .withMessage("Parking must be bike, car, car & bike, or none"),

  // Optional fields validation
  body("securityDeposit")
    .optional()
    .isNumeric()
    .withMessage("Security deposit must be a number")
    .isFloat({ min: 0 })
    .withMessage("Security deposit must be a positive number"),

  body("flooring")
    .optional()
    .isIn([
      "Marble",
      "Tiles",
      "Wooden",
      "Granite",
      "Ceramic",
      "Vitrified",
      "Other",
    ])
    .withMessage("Invalid flooring type"),

  body("overlooking")
    .optional()
    .isIn(["Main Road", "Garden", "Park", "Pool", "Club", "Other"])
    .withMessage("Invalid overlooking option"),

  body("ageOfConstruction")
    .optional()
    .isIn([
      "Newly Built",
      "Under Construction",
      "Less than 5 years",
      "5-10 years",
      "10-15 years",
      "15-20 years",
      "More than 20 years",
    ])
    .withMessage("Invalid age of construction"),

  body("additionalRooms")
    .optional()
    .isIn(["Puja Room", "Study Room", "Servant Room", "Store Room", "Other"])
    .withMessage("Invalid additional room"),

  body("waterAvailability")
    .optional()
    .isIn([
      "24 Hours Available",
      "12 Hours Available",
      "6 Hours Available",
      "Limited Supply",
      "Borewell",
      "Corporation Water",
      "Both",
    ])
    .withMessage("Invalid water availability option"),

  body("statusOfElectricity")
    .optional()
    .isIn([
      "No/Rare Powercut",
      "Frequent Powercut",
      "Power Backup Available",
      "No Power Issues",
      "Generator Available",
    ])
    .withMessage("Invalid electricity status"),

  body("lift")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Lift must be a number (0 or more)"),

  body("amenities")
    .optional()
    .isArray()
    .withMessage("Amenities must be an array")
    .custom((amenities) => {
      // Allow any string values for amenities as the model uses [String]
      amenities.forEach((amenity) => {
        if (typeof amenity !== "string" || amenity.trim().length === 0) {
          throw new Error("Each amenity must be a non-empty string");
        }
      });
      return true;
    }),

  body("status")
    .optional()
    .isIn([
      "For Sale",
      "For Rent",
      "Sold",
      "Rented",
      "Under Contract",
      "Available",
      "Occupied",
    ])
    .withMessage("Invalid status"),

  body("availability")
    .optional()
    .isIn(["immediate", "date"])
    .withMessage("Availability must be either 'immediate' or 'date'"),

  body("availabilityDate")
    .optional()
    .if(body("availability").equals("date"))
    .notEmpty()
    .withMessage("Availability date is required when availability is 'date'")
    .isISO8601()
    .withMessage("Availability date must be a valid date")
    .custom((value) => {
      const today = new Date().setHours(0, 0, 0, 0);
      const selectedDate = new Date(value).setHours(0, 0, 0, 0);
      if (selectedDate < today) {
        throw new Error("Availability date cannot be in the past");
      }
      return true;
    }),

  handleValidationErrors,
];

// Property ID validation
const validatePropertyId = [
  param('id')
    .isMongoId()
    .withMessage('Invalid property ID format'),
  handleValidationErrors
];

// Video index validation
const validateVideoIndex = [
  param('videoIndex')
    .isInt({ min: 0 })
    .withMessage('Video index must be a non-negative integer'),
  handleValidationErrors
];

// Video upload validation
const validateVideoUpload = [
  body('caption')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Caption must not exceed 200 characters'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description must not exceed 1000 characters'),

  body('hashtags')
    .optional()
    .custom((hashtags) => {
      // Parse if string
      const parsedHashtags = typeof hashtags === 'string' ? JSON.parse(hashtags) : hashtags;
      
      if (!Array.isArray(parsedHashtags)) {
        throw new Error('Hashtags must be an array');
      }
      
      if (parsedHashtags.length > 20) {
        throw new Error('Maximum 20 hashtags allowed');
      }
      
      parsedHashtags.forEach(tag => {
        if (typeof tag !== 'string' || tag.trim().length === 0 || tag.trim().length > 50) {
          throw new Error('Each hashtag must be a non-empty string with maximum 50 characters');
        }
      });
      
      return true;
    }),

  body('platforms')
    .optional()
    .custom((platforms) => {
      // Parse if string
      const parsedPlatforms = typeof platforms === 'string' ? JSON.parse(platforms) : platforms;
      
      if (!Array.isArray(parsedPlatforms)) {
        throw new Error('Platforms must be an array');
      }
      
      const validPlatforms = ['youtube', 'facebook', 'instagram'];
      parsedPlatforms.forEach(platform => {
        if (!validPlatforms.includes(platform)) {
          throw new Error(`Invalid platform: ${platform}. Valid platforms are: ${validPlatforms.join(', ')}`);
        }
      });
      
      return true;
    }),

  handleValidationErrors
];

const parseJsonFieldsMiddleware =
  (fields = []) =>
  (req, res, next) => {
    fields.forEach((field) => {
      if (req.body[field] && typeof req.body[field] === "string") {
        try {
          req.body[field] = JSON.parse(req.body[field]);
        } catch (e) {
          // Ignore parse errors; validation will catch invalid values
        }
      }
    });
    next();
  };


module.exports = {
  validateCreateProperty,
  validateUpdateProperty,
  validatePropertyId,
  validateVideoIndex,
  validateVideoUpload,
  handleValidationErrors,
  parseJsonFieldsMiddleware
};