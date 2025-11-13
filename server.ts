import { createAppWithEnv } from './index'

// สร้าง app instance โดยใช้ factory function และส่ง environment variables เข้าไป
const app = createAppWithEnv({
  LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET!,
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  NODE_ENV: process.env.NODE_ENV,
});

// สร้าง HTTP server สำหรับรันบน Bun
const port = 3000

const server = Bun.serve({
  port,
  fetch: app.handle, // ใช้ app.handle สำหรับ Bun server
})

console.log(`🚀 Elysia server is running at http://localhost:${port}`)
console.log(`📝 Webhook endpoint: http://localhost:${port}/webhook`)
console.log(`🏠 Health check: http://localhost:${port}`)