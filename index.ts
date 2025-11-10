import { Elysia } from 'elysia'
import { Client, middleware } from '@line/bot-sdk'

// สร้าง Elysia App พร้อม Type-safe configuration
const app = new Elysia()
  .get('/', () => 'Line OA STT Bot is running!')
  .post('/webhook', async ({ body, set }) => {
    try {
      console.log('Received webhook:', JSON.stringify(body, null, 2))
      
      // Basic webhook response for Line platform
      // TODO: Add signature validation
      // TODO: Add actual message processing logic
      
      // ตอบกลับ Line platform ว่าได้รับ webhook แล้ว
      set.status = 200
      return { status: 'ok', message: 'Webhook received successfully' }
      
    } catch (error) {
      console.error('Webhook error:', error)
      set.status = 500
      return { status: 'error', message: 'Internal server error' }
    }
  })

// Export เป็น fetch handler สำหรับใช้กับ runtime ต่างๆ (Bun, Deno, Cloudflare Workers)
export default app.handle

// ถ้าต้องการรัน local development สามารถใช้ Bun ได้:
// bun --watch index.ts