# Line OA Voice-to-Text Bot

🤖 Line Official Account Bot ที่แปลงเสียงเป็นข้อความด้วย STT (Speech-to-Text) 
สร้างด้วย **Elysia.js + Bun + Supabase** - Modern TypeScript Stack

## 🏗️ Architecture

```
Line Platform → Elysia Server → Validation → Process → STT API → Text Response
```

## 🚀 Quick Start

### 1. ติดตั้ง Dependencies
```bash
bun install
```

### 2. ตั้งค่า Environment Variables
```bash
cp .env.example .env
# แก้ไข .env ด้วยค่าจริงจาก Line OA และ Supabase
```

### 3. รัน Development Server
```bash
bun server.ts
```

Server จะทำงานที่ `http://localhost:3000`

## 🔧 Configuration

### Required Environment Variables:

```bash
# Line OA Configuration
LINE_CHANNEL_SECRET=your-line-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=your-line-channel-access-token

# Supabase Configuration  
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key
```

## 📡 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check |
| POST | `/webhook` | Line webhook endpoint (with signature validation) |

## 🛡️ Security Features

- **Line Signature Validation**: ตรวจสอบความถูกต้องของ webhook จาก Line
- **Type-safe Payloads**: ใช้ TypeScript interfaces สำหรับ webhook data
- **Error Handling**: Comprehensive error handling และ logging

## 📦 Tech Stack

- **Runtime**: Bun (Ultra-fast JavaScript runtime)
- **Framework**: Elysia.js (Modern, Type-safe web framework)
- **Database**: Supabase (PostgreSQL with real-time features)
- **Language**: TypeScript (Strict mode enabled)
- **STT**: Google Speech-to-Text / Whisper API

## 🧪 Testing

### Running Tests

Run all tests:
```bash
bun test
```

Run tests in watch mode:
```bash
bun test:watch
```

### Test Structure

- **Unit Tests**: Located in `tests/` directory
  - `jobService.test.ts` - Tests for Supabase job operations
  - `audioService.test.ts` - Tests for audio processing logic
  - `sttService.test.ts` - Tests for STT integration

- **Integration Tests**: 
  - `webhook.integration.test.ts` - Tests for webhook endpoint with mock Line events

### Type Checking

```bash
bun run type-check
```

### Development Scripts

```bash
# Development with hot reload
bun run dev

# Production build
bun start

# Run tests
bun test

# Type check only
bun run type-check
```

## 🚢 Deployment

### Docker Deployment

Build and run with Docker:
```bash
docker build -t lineoa4stt .
docker run -p 3000:3000 --env-file .env lineoa4stt
```

### Deploy to Render.com

1. Connect your GitHub repository to Render
2. Create a new Web Service
3. Set build command: `bun install`
4. Set start command: `bun server.ts`
5. Add environment variables from `.env.example`
6. Deploy!

### Deploy to Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Login: `fly auth login`
3. Launch app: `fly launch`
4. Set secrets: `fly secrets set LINE_CHANNEL_SECRET=...`
5. Deploy: `fly deploy`

### Deploy to Railway

1. Connect your GitHub repository to Railway
2. Create a new project
3. Add environment variables
4. Railway will auto-detect Bun and deploy

### CI/CD with GitHub Actions

The project includes GitHub Actions workflows:

- **CI Workflow** (`.github/workflows/ci.yml`): Runs on every push/PR
  - Type checking
  - Unit and integration tests
  
- **Deploy Workflow** (`.github/workflows/deploy.yml`): Runs on main branch
  - Runs tests
  - Deploys to production (configure your deployment target)

To enable deployment, uncomment and configure the deployment step in `.github/workflows/deploy.yml`.

## 📁 Project Structure

```
.
├── src/
│   └── services/
│       ├── jobService.ts      # Supabase job operations
│       ├── audioService.ts    # Audio processing logic
│       └── sttService.ts      # STT integration
├── tests/
│   ├── jobService.test.ts
│   ├── audioService.test.ts
│   ├── sttService.test.ts
│   └── webhook.integration.test.ts
├── .github/
│   └── workflows/
│       ├── ci.yml             # CI workflow
│       └── deploy.yml         # CD workflow
├── index.ts                   # Main application entry
├── server.ts                  # Server setup
├── Dockerfile                 # Docker configuration
└── package.json
```

## 📋 Features

- [x] Basic Elysia webhook endpoint
- [x] Line signature validation with HMAC-SHA256
- [x] TypeBox schemas for runtime validation
- [x] Audio message processing
- [x] Google Cloud STT integration
- [x] Async job queue with Supabase
- [x] Service-based architecture
- [x] CI/CD with GitHub Actions
- [x] Unit & Integration tests
- [x] Docker support

## 🤝 Contributing

This project follows modern TypeScript best practices with Elysia.js ecosystem.

### Development Workflow

1. Create a feature branch
2. Make your changes
3. Write/update tests
4. Ensure all tests pass: `bun test`
5. Type check: `bun run type-check`
6. Submit a pull request

## 📝 License

MIT
