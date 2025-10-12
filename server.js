const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const compression = require('compression');
// const apicache = require('apicache');
// const logger = require('./services/loggerService');
const { apiLimiter, authLimiter } = require('./middleware/rateLimiter');

// Load env vars
dotenv.config();

const app = express();

// ✅ Add this immediately after creating the app instance
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1); // Required for Render, Nginx, AWS ELB, Cloudflare, etc.
}

// Compression middleware - reduce response size
app.use(compression());

// Setup cache middleware
// const cache = apicache.middleware;
// Cache successful GET requests for 30 seconds by default
// const cacheSuccessfulResponses = cache('30 seconds', (req, res) => res.statusCode === 200);

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// // CORS middleware
// // app.use(cors({
// //   origin: process.env.CLIENT_URL || 'http://localhost:5173',
// //   credentials: true
// // }));

// app.use(
//   cors({
//     origin: (origin, callback) => {
//       if (!origin) return callback(null, true); // allow requests like Postman

//       // Allow all localhost ports
//       if (/^http:\/\/localhost(:\d+)?$/.test(origin)) {
//         return callback(null, true);
//       }

//       return callback(new Error("Not allowed by CORS"));
//     },
//     credentials: true,
//   })
// );
const allowedOrigins = [
  process.env.CLIENT_URL, // e.g. https://my-frontend.onrender.com
  "http://localhost:5173", // local dev
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow Postman or curl
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);


// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

// Connect to database
connectDB();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime()
  });
});

// Apply rate limiting to routes
app.use('/api/auth', authLimiter); // Stricter rate limiting for auth routes
app.use('/api', apiLimiter); // General rate limiting for all API routes

// Apply caching to GET routes
// app.use('/api/properties', (req, res, next) => {
//   if (req.method === 'GET') {
//     return cacheSuccessfulResponses(req, res, next);
//   }
//   next();
// });

// Routes
app.use('/api/auth', require('./routes/userRoutes'));
app.use('/api/properties', require('./routes/propertyRoutes'));
app.use('/api', require('./routes/contact'));

// Global error handler
app.use((err, req, res, next) => {
  // logger.error(`${err.name}: ${err.message}`, { 
  //   path: req.path,
  //   method: req.method,
  //   statusCode: err.statusCode || 500,
  //   stack: err.stack,
  //   body: req.body,
  //   query: req.query,
  //   ip: req.ip
  // });
  
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Handle 404 routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`📍 API Base URL: http://localhost:${PORT}`);
  console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Unhandled Rejection: ${err.message}`);
  // Close server & exit process
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.log(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

module.exports = app;
