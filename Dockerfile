FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy server code
COPY server.js ./

# Create uploads directory
RUN mkdir -p uploads

# Expose port (Railway will set PORT env var)
EXPOSE $PORT

# Start server
CMD ["node", "server.js"]
