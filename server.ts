import app from './index.ts'

// สร้าง HTTP server สำหรับรันบน Bun
const port = 3000

const server = Bun.serve({
  port,
  fetch: app, // app คือ fetch handler อยู่แล้ว
})

console.log(`🚀 Elysia server is running at http://localhost:${port}`)
console.log(`📝 Webhook endpoint: http://localhost:${port}/webhook`)
console.log(`🏠 Health check: http://localhost:${port}`)