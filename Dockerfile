# Use Bun official image
FROM oven/bun:1 AS base
WORKDIR /app

# Install ffmpeg
# The base image (oven/bun:1) is based on Debian, so we use apt-get
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Install dependencies
FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source code
FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY . .

# Expose port
EXPOSE 3000

# Run the application
CMD ["bun", "server.ts"]
