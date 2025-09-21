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
    .isNumeric()
    .withMessage("Broker charge must be a number")
    .isFloat({ min: 0 })
    .withMessage("Broker charge must be a positive number")
    .custom((value, { req }) => {
      // If listedBy is Owner, broker charge must be 0
      if (req.body.listedby === "Owner" && value !== 0) {
        throw new Error("Broker charge must be 0 when listed by Owner");
      }
      return true;
    }),

  body("bedrooms")
    .optional()
    .isIn(["1BHK", "2BHK", "3BHK", "4BHK"])
    .withMessage("Bedrooms must be 1BHK, 2BHK, 3BHK, or 4BHK"),
  
  body("bathrooms")
    .optional()
    .isInt({ min: 0, max: 20 })
    .withMessage("Bathrooms must be a number between 0 and 20"),

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

  body("featured")
    .optional()
    .isBoolean()
    .withMessage("Featured must be true or false"),

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

  body("bedrooms")
    .optional()
    .isIn(["1BHK", "2BHK", "3BHK", "4BHK"])
    .withMessage("Bedrooms must be 1BHK, 2BHK, 3BHK, or 4BHK"),

  body("bathrooms")
    .optional()
    .isInt({ min: 0, max: 20 })
    .withMessage("Bathrooms must be a number between 0 and 20"),

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

  body("featured")
    .optional()
    .isBoolean()
    .withMessage("Featured must be true or false"),

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

// Query parameters validation for property listing
const validatePropertyQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  query('minPrice')
    .optional()
    .isNumeric()
    .withMessage('Minimum price must be a number')
    .isFloat({ min: 0 })
    .withMessage('Minimum price must be positive'),

  query('maxPrice')
    .optional()
    .isNumeric()
    .withMessage('Maximum price must be a number')
    .isFloat({ min: 0 })
    .withMessage('Maximum price must be positive'),

  query('minSize')
    .optional()
    .isNumeric()
    .withMessage('Minimum size must be a number')
    .isFloat({ min: 0 })
    .withMessage('Minimum size must be positive'),

  query('maxSize')
    .optional()
    .isNumeric()
    .withMessage('Maximum size must be a number')
    .isFloat({ min: 0 })
    .withMessage('Maximum size must be positive'),

  query('propertyType')
    .optional()
    .isIn(['Apartment', 'Villa', 'Independent House', 'Plot', 'Commercial', 'Office Space', 'Other'])
    .withMessage('Invalid property type'),

  query('status')
    .optional()
    .isIn(['For Sale', 'For Rent', 'Sold', 'Rented', 'rented', 'Under Contract', 'Available', 'Occupied'])
    .withMessage('Invalid status'),

  query('bedrooms')
    .optional()
    .isIn(['1BHK', '2BHK', '3BHK', '4BHK'])
    .withMessage('Bedrooms must be 1BHK, 2BHK, 3BHK, or 4BHK'),

  query('furnished')
    .optional()
    .isIn(['Fully Furnished', 'Semi Furnished', 'Unfurnished'])
    .withMessage('Invalid furnished status'),

  query('sortBy')
    .optional()
    .isIn(['price_asc', 'price_desc', 'size_asc', 'size_desc', 'newest', 'oldest'])
    .withMessage('Invalid sort option'),

  query('featured')
    .optional()
    .isBoolean()
    .withMessage('Featured must be true or false'),

  query('search')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Search query must be between 2 and 100 characters'),

  query('city')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('City must be between 2 and 100 characters'),

  // Custom validation to ensure maxPrice >= minPrice
  query().custom((value, { req }) => {
    const { minPrice, maxPrice } = req.query;
    if (minPrice && maxPrice && parseFloat(maxPrice) < parseFloat(minPrice)) {
      throw new Error('Maximum price must be greater than or equal to minimum price');
    }
    return true;
  }),

  // Custom validation to ensure maxSize >= minSize
  query().custom((value, { req }) => {
    const { minSize, maxSize } = req.query;
    if (minSize && maxSize && parseFloat(maxSize) < parseFloat(minSize)) {
      throw new Error('Maximum size must be greater than or equal to minimum size');
    }
    return true;
  }),

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

module.exports = {
  validateCreateProperty,
  validateUpdateProperty,
  validatePropertyId,
  validateVideoIndex,
  validatePropertyQuery,
  validateVideoUpload,
  handleValidationErrors
};