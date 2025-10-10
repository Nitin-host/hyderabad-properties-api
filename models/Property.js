const mongoose = require('mongoose');

const PropertySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Please add a title"],
      trim: true,
      maxlength: [100, "Title cannot be more than 100 characters"],
    },
    description: {
      type: String,
      required: [true, "Please add a description"],
      maxlength: [2000, "Description cannot be more than 2000 characters"],
    },
    propertyType: {
      type: String,
      required: [true, "Please specify property type"],
      enum: [
        "Standalone",
        "Gated Community",
        "Apartment",
        "Villa",
        "Independent House",
        "Plot",
        "Commercial",
        "Office Space",
        "Other",
      ],
    },
    price: {
      type: Number,
      required: [true, "Please add a price"],
    },
    size: {
      type: Number,
      required: [true, "Please add property size"],
    },
    sizeUnit: {
      type: String,
      enum: ["sqft", "sqm", "acres", "cents", "yards"],
      default: "sqft",
    },
    maintenance: {
      type: Number,
      min: 0,
      default: 0,
    },
    listedBy: {
      type: String,
      enum: ["owner", "agent"],
      required: [true, "Please specify listed by"],
    },
    brokerCharge: {
      type: String,
      enum: ["20 Days", "1 month", "no charge", "Contact for details"],
    },
    totalFloors: {
      type: Number,
      min: 0,
      default: 0,
    },
    bedrooms: {
      type: String, // Allow both Number and String for values like '1BHK', '2BHK'
      required: true,
      enum: ["1BHK", "2BHK", "3BHK", "4BHK"],
    },
    bathrooms: {
      type: Number,
      min: 0,
    },
    balconies: {
      type: Number,
      enum: [0, 1, 2, 3],
    },
    furnished: {
      type: String,
      enum: ["Fully Furnished", "Semi Furnished", "Unfurnished"],
      default: "Unfurnished",
    },
    parking: {
      type: String,
      enum: ["bike", "car", "car & bike", "none"],
      default: "none",
    },

    // New fields from the image
    securityDeposit: {
      type: Number,
      min: 0,
      default: 0,
    },
    landmarks: String,
    location: String,
    flooring: {
      type: String,
      enum: [
        "Marble",
        "Tiles",
        "Wooden",
        "Granite",
        "Ceramic",
        "Vitrified",
        "Other",
      ],
      required: false,
    },
    overlooking: {
      type: String,
      enum: ["Main Road", "Garden", "Park", "Pool", "Club", "Other"],
      required: false
    },
    ageOfConstruction: {
      type: String,
      enum: [
        "Newly Built",
        "Under Construction",
        "Less than 5 years",
        "5-10 years",
        "10-15 years",
        "15-20 years",
        "More than 20 years",
      ],
      required: false,
    },
    additionalRooms: {
      type: String,
      enum: ["Puja Room", "Study Room", "Servant Room", "Store Room", "Other"],
      required: false,
    },
    waterAvailability: {
      type: String,
      enum: [
        "24 Hours Available",
        "12 Hours Available",
        "6 Hours Available",
        "Limited Supply",
        "Borewell",
        "Corporation Water",
        "Both",
      ],
      required: false,
    },
    statusOfElectricity: {
      type: String,
      enum: [
        "No/Rare Powercut",
        "Frequent Powercut",
        "Power Backup Available",
        "No Power Issues",
        "Generator Available",
      ],
      required: false,
    },
    lift: {
      type: Number,
      min: 0,
      default: 0,
    },
    amenities: [String],
    images: [
      {
        presignUrl: { type: String },
        key: { type: String },
      },
    ],
    videos: [
      {
        presignUrl: { type: String },
        key: { type: String },
        thumbnailKey: { type: String },
      },
    ],
    status: {
      type: String,
      enum: [
        "For Sale",
        "For Rent",
        "Sold",
        "Rented",
        "rented",
        "Under Contract",
        "Available",
        "Occupied",
      ],
      required: true,
    },
    availability: {
      type: String,
      enum: ["immediate", "date"],
      required: true,
    },
    availabilityDate: {
      type: Date,
      required: function () {
        return this.availability === "date";
      },
    },
    agent: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Create index for search functionality
PropertySchema.index({ 
  title: 'text', 
  description: 'text',
  'address.street': 'text',
  'address.landmark': 'text',
  propertyType: 'text'
});

// Create additional indexes for frequently queried fields
PropertySchema.index({ propertyType: 1 });
PropertySchema.index({ bedrooms: 1 });
PropertySchema.index({ price: 1 });
PropertySchema.index({ location: 1 });
PropertySchema.index({ furnished: 1 });
PropertySchema.index({ isDeleted: 1 });
PropertySchema.index({ createdAt: -1 }); // For sorting by newest

// Update the updatedAt field on save
PropertySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Property', PropertySchema);