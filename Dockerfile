# Stage 1: Build dependencies
FROM node:20-alpine AS deps

# Install build tools for native modules (needed by ffmpeg wrappers, mongoose, etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg \
    bash

WORKDIR /usr/src/app

# Copy only package files to leverage Docker cache
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Stage 2: Final runtime
FROM node:20-alpine

WORKDIR /usr/src/app

# Install ffmpeg & ffprobe for fluent-ffmpeg
RUN apk add --no-cache ffmpeg bash

# Copy production node_modules from deps stage
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy rest of the app
COPY . .

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Expose your API port
EXPOSE 5000

# Start your backend
CMD ["node", "server.js"]