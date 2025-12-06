  const mongoose = require("mongoose");
  const slugify = require("slugify");

  const PropertySchema = new mongoose.Schema(
    {
      slug: { type: String, unique: true },
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
        type: String,
        required: true,
        enum: ["1BHK", "2BHK", "3BHK", "4BHK"],
      },
      bathrooms: { type: Number, min: 0 },
      balconies: { type: Number, enum: [0, 1, 2, 3] },
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

      // New fields
      securityDeposit: { type: Number, min: 0, default: 0 },
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
      },
      overlooking: {
        type: String,
        enum: ["Main Road", "Garden", "Park", "Pool", "Club", "Other"],
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
      },
      additionalRooms: {
        type: String,
        enum: [
          "Puja Room",
          "Study Room",
          "Servant Room",
          "Store Room",
          "Other",
        ],
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
      },
      lift: { type: Number, min: 0, default: 0 },
      amenities: [String],

      // 🖼️ Images (R2)
      images: [
        {
          key: { type: String },
          presignUrl: { type: String },
        },
      ],

      // 🎥 Videos (R2 with HLS)
      videos: [
        {
          masterKey: { type: String }, // e.g., properties/{id}/videos/master.m3u8
          thumbnailKey: { type: String }, // e.g., properties/{id}/videos/thumbnails/thumb.jpg
          qualityKeys: {
            "480p": { type: String },
            "720p": { type: String },
            "1080p": { type: String },
          },
          videoStatus: {
            type: String,
            enum: [
              "queued",
              "processing",
              "completed",
              "failed",
              "error",
              "ready",
            ],
            default: "queued",
          },
          errorMessage: { type: String, default: "" },
        },
      ],

      status: {
        type: String,
        enum: [
          "For Sale",
          "For Rent",
          "Sold",
          "Rented",
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

      // Relations & system fields
      agent: { type: mongoose.Schema.ObjectId, ref: "User", required: true },
      createdBy: { type: mongoose.Schema.ObjectId, ref: "User" },
      updatedBy: { type: mongoose.Schema.ObjectId, ref: "User" },
      isDeleted: { type: Boolean, default: false },
      deletedBy: { type: mongoose.Schema.ObjectId, ref: "User", default: null },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  // 🔍 Indexes for better search performance
  PropertySchema.index({
    title: "text",
    description: "text",
    location: "text",
    propertyType: "text",
  });
  PropertySchema.index({ propertyType: 1 });
  PropertySchema.index({ bedrooms: 1 });
  PropertySchema.index({ price: 1 });
  PropertySchema.index({ location: 1 });
  PropertySchema.index({ furnished: 1 });
  PropertySchema.index({ isDeleted: 1 });
  PropertySchema.index({ createdAt: -1 });

  PropertySchema.pre("save", function (next) {
    this.updatedAt = Date.now();
    next();
  });

  // Auto-generate slug before saving
PropertySchema.pre("save", async function (next) {
  if (this.isModified("title") || this.isModified("bedrooms") || this.isModified("location")) {
    const baseSlug = slugify(
      `${this.bedrooms}-${this.title}-${this.location}`,
      { lower: true, strict: true }
    );

    let finalSlug = baseSlug;
    let counter = 1;

    // Ensure unique slug
    while (await mongoose.models.Property.findOne({ slug: finalSlug })) {
      finalSlug = `${baseSlug}-${counter++}`;
    }

    this.slug = finalSlug;
  }

  next();
});

  module.exports = mongoose.model("Property", PropertySchema);