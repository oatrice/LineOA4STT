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

## 🧪 Development

### Running Tests
```bash
bun test
```

### Type Checking
```bash
bun tsc --noEmit
```

### Code Format
```bash
bun format
```

## 📋 Todo List

- [x] Basic Elysia webhook endpoint
- [x] Line signature validation
- [ ] Audio message processing
- [ ] STT API integration
- [ ] Async job queue with Supabase
- [ ] CI/CD with GitHub Actions
- [ ] Unit & Integration tests

## 🤝 Contributing

This project follows modern TypeScript best practices with Elysia.js ecosystem.
