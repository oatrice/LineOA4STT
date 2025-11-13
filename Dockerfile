# Use Bun official image
FROM oven/bun:1 AS base
WORKDIR /app

# Install ffmpeg
# The base image (oven/bun:1) is based on Debian, so we use apt-get
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Accept a build argument for the node environment, default to production
ARG NODE_ENV_ARG=production

# --- Install Stage ---
FROM base AS install
WORKDIR /app
COPY package.json bun.lock ./

# Pass the build argument to this stage
ARG NODE_ENV_ARG
# Install dependencies based on the environment
RUN if [ "${NODE_ENV_ARG}" = "production" ]; then \
      echo "Installing production dependencies..."; \
      bun install --production --frozen-lockfile; \
    else \
      echo "Installing all dependencies for ${NODE_ENV_ARG}..."; \
      bun install --frozen-lockfile; \
    fi

# --- Release Stage ---
FROM base AS release
WORKDIR /app

# Set the environment variable for runtime from the build argument
ARG NODE_ENV_ARG
ENV NODE_ENV=${NODE_ENV_ARG}

COPY --from=install /app/node_modules ./node_modules
COPY . .

# Expose port
EXPOSE 3000

# Run the application
CMD ["bun", "server.ts"]
