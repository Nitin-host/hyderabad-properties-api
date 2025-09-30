FROM node:20-alpine

# Create app directory inside container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json separately
COPY package*.json ./

# Update npm to latest stable version to avoid npm timeout issues
RUN npm install -g npm@11.6.1 && npm cache clean --force && npm ci --only=production

# Copy rest of the code
COPY . .

# Expose port 5000 (should match your server.js code)
EXPOSE 5000

# Start the app by running server.js
CMD ["node", "server.js"]