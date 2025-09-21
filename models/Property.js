const mongoose = require('mongoose');

const PropertySchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please add a title'],
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Please add a description'],
    maxlength: [2000, 'Description cannot be more than 2000 characters']
  },
  propertyType: {
    type: String,
    required: [true, 'Please specify property type'],
    enum: [
      'Standalone',
      'Gated Community',
      'Apartment',
      'Villa',
      'Independent House',
      'Plot',
      'Commercial',
      'Office Space',
      'Other'
    ]
  },
  price: {
    type: Number,
    required: [true, 'Please add a price']
  },
  size: {
    type: Number,
    required: [true, 'Please add property size']
  },
  sizeUnit: {
    type: String,
    enum: ['sqft', 'sqm', 'acres', 'cents', 'yards'],
    default: 'sqft'
  },
  maintenance: {
    type: Number,
    min: 0
  },
  listedBy: {
    type: String,
    enum: ['owner', 'agent'],
    required: [true, 'Please specify listed by']
  },
  brokerCharge: {
    type: Number,
    default: 0
  },
  bedrooms: {
    type: mongoose.Schema.Types.Mixed, // Allow both Number and String for values like '1BHK', '2BHK'
    required: true,
    enum: ['1BHK', '2BHK', '3BHK', '4BHK']
  },
  bathrooms: {
    type: Number,
    min: 0
  },
  furnished: {
    type: String,
    enum: ['Fully Furnished', 'Semi Furnished', 'Unfurnished'],
    default: 'Unfurnished'
  },
  parking: {
    type: String,
    enum: ['bike', 'car', 'car & bike', 'none'],
    default: 'none'
  },

  // New fields from the image
  securityDeposit: {
    type: Number,
    min: 0
  },
  landmarks: String,
  location: String,
  flooring: {
    type: String,
    enum: ['Marble', 'Tiles', 'Wooden', 'Granite', 'Ceramic', 'Vitrified', 'Other']
  },
  overlooking: {
    type: String,
    enum: ['Main Road', 'Garden', 'Park', 'Pool', 'Club', 'Other']
  },
  ageOfConstruction: {
    type: String,
    enum: ['Newly Built','Under Construction', 'Less than 5 years', '5-10 years', '10-15 years', '15-20 years', 'More than 20 years']
  },
  additionalRooms: {
    type: String,
    enum: ['Puja Room', 'Study Room', 'Servant Room', 'Store Room', 'Other']
  },
  waterAvailability: {
    type: String,
    enum: ['24 Hours Available', '12 Hours Available', '6 Hours Available', 'Limited Supply', 'Borewell', 'Corporation Water', 'Both']
  },
  statusOfElectricity: {
    type: String,
    enum: ['No/Rare Powercut', 'Frequent Powercut', 'Power Backup Available', 'No Power Issues', 'Generator Available']
  },
  lift: {
    type: Number,
    min: 0,
    default: 0
  },
  amenities: [String],
  images: [
    {
      path: {
        type: String,
        required: false // Make path optional since we might only have cloudinaryUrl
      },
      cloudinaryUrl: {
        type: String
      },
      publicId: {
        type: String
      },
      caption: String,
      isMain: {
        type: Boolean,
        default: false
      }
    }
  ],
  videos: [
    {
      path: {
        type: String
      },
      cloudinaryUrl: {
        type: String
      },
      publicId: {
        type: String
      },
      caption: String,
      description: String,
      hashtags: [String],
      youtubeUrl: {
        type: String,
        required: false
      },
      youtubeId: {
        type: String,
        required: false
      },
      instagramUrl: String,
      isUploaded: {
        type: Boolean,
        default: false
      },
      socialMediaStatus: {
        youtube: {
          status: {
            type: String,
            enum: ['pending', 'uploading', 'completed', 'failed'],
            default: 'pending'
          },
          uploadedAt: Date,
          platformUrl: String,
          platformId: String,
          error: String
        },
        facebook: {
          status: {
            type: String,
            enum: ['pending', 'uploading', 'completed', 'failed'],
            default: 'pending'
          },
          uploadedAt: Date,
          platformUrl: String,
          platformId: String,
          error: String
        },
        instagram: {
          status: {
            type: String,
            enum: ['pending', 'uploading', 'completed', 'failed'],
            default: 'pending'
          },
          uploadedAt: Date,
          platformUrl: String,
          platformId: String,
          error: String
        }
      }
    }
  ],
  status: {
    type: String,
    enum: ['For Sale', 'For Rent', 'Sold', 'Rented', 'rented', 'Under Contract', 'Available', 'Occupied'],
    required: true
  },
  featured: {
    type: Boolean,
    default: false
  },
  agent: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
});

// Create index for search functionality
PropertySchema.index({ 
  title: 'text', 
  description: 'text',
  'address.street': 'text',
  'address.landmark': 'text',
  propertyType: 'text'
});

// Update the updatedAt field on save
PropertySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Property', PropertySchema);