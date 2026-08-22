# --------------------------------------------------------------
# Build stage
# --------------------------------------------------------------
FROM node:20-alpine AS builder

# Set working directory to the monorepo root
WORKDIR /app

# Copy only package manifests first (caching layer)
COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/
COPY packages/shared/package.json packages/shared/
# Add other packages if they have separate manifests

# Install root dependencies (workspaces)
RUN npm ci

# Copy the entire source tree
COPY . .

# Build the workspace (will run each package's build script)
RUN npm run build

# --------------------------------------------------------------
# Production stage
# --------------------------------------------------------------
FROM node:20-alpine AS runtime

# Create non‑root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

WORKDIR /app

# Copy only the built backend and its runtime dependencies
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/package.json ./packages/backend/
COPY --from=builder /app/package.json .
COPY --from=builder /app/package-lock.json .

# Install only production dependencies for backend
RUN npm ci --omit=dev --workspace=packages/backend

# Expose the port Cloud Run expects (default 8080)
ENV PORT=8080
EXPOSE 8080

# Entrypoint – adjust if your compiled file lives elsewhere
CMD ["node", "packages/backend/dist/index.js"]
