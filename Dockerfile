# Use the official lightweight Node.js 20 Alpine image
FROM node:20-alpine

# Set working directory inside the container
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies only (ignores devDependencies to keep image size small)
RUN npm ci --omit=dev

# Copy all application source code, config, and sample data files
COPY . .

# Expose port 3000 to the host machine
EXPOSE 3000

# Set Node environment to production
ENV NODE_ENV=production

# Start the application server
CMD ["node", "server.js"]
