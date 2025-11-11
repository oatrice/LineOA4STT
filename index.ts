import { Elysia } from 'elysia'
import { Client, middleware } from '@line/bot-sdk'
import { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
)

// Line client
const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || ''
})

// ฟังก์ชันสำหรับจัดการ audio messages
async function handleAudioMessage(event: LineWebhookEvent) {
  try {
    if (!event.message || !event.replyToken || !event.source.userId) {
      console.error('❌ Missing required fields for audio processing')
      return
    }

    console.log(`🎵 Processing audio message: ${event.message.id}`)
    
    // 1. สร้าง job record ใน Supabase
    const { data: job, error: insertError } = await supabase
      .from('transcription_jobs')
      .insert({
        message_id: event.message.id,
        user_id: event.source.userId,
        reply_token: event.replyToken,
        status: 'PENDING'
      })
      .select()
      .single()

    if (insertError) {
      console.error('❌ Failed to create job:', insertError)
      return
    }

    console.log(`✅ Created job ${job.id} for message ${event.message.id}`)

    // 2. ตอบกลับ user ว่ากำลังประมวลผล
    await lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: '🎵 กำลังแปลงเสียงเป็นข้อความ กรุณารอสักครู่ครับ...'
    })

    // 3. เริ่มการประมวลผลแบบ async (ไม่ block webhook response)
    processAudioAsync(event.message.id, job.id, event.replyToken)

  } catch (error) {
    console.error('❌ Error handling audio message:', error)
  }
}

// ฟังก์ชันสำหรับประมวลผลเสียงแบบ async
async function processAudioAsync(messageId: string, jobId: string, replyToken: string) {
  try {
    // TODO: ในอนาคตจะ implement จริง
    console.log(`🔄 Processing audio ${messageId} for job ${jobId}`)
    
    // จำลองการทำงาน 3 วินาที
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // Update job ว่าเสร็จแล้ว
    await supabase
      .from('transcription_jobs')
      .update({
        status: 'COMPLETED',
        transcript: 'นี่คือผลลัพธ์จากการแปลงเสียง (ตัวอย่าง)',
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId)

    // ส่งผลลัพธ์กลับไปให้ user
    await lineClient.replyMessage(replyToken, {
      type: 'text',
      text: '✨ เสร็จแล้วครับ!\n\nผลลัพธ์: นี่คือผลลัพธ์จากการแปลงเสียง (ตัวอย่าง)'
    })

    console.log(`✅ Completed job ${jobId}`)
    
  } catch (error) {
    console.error('❌ Error in async processing:', error)
    
    // Update job ว่า failed
    await supabase
      .from('transcription_jobs')
      .update({
        status: 'FAILED',
        error_message: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', jobId)
  }
}

// Type-safe interfaces สำหรับ Line webhook payload
interface LineWebhookEvent {
  type: 'message' | 'follow' | 'unfollow' | 'join' | 'leave' | 'postback' | 'beacon'
  timestamp: number
  source: {
    type: 'user' | 'group' | 'room'
    userId?: string
    groupId?: string
    roomId?: string
  }
  replyToken?: string
  message?: {
    id: string
    type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'location' | 'sticker'
    text?: string
    originalContentUrl?: string
    previewImageUrl?: string
    fileName?: string
    fileSize?: number
    duration?: number
  }
  webhookEventId?: string
  deliveryContext?: {
    isRedelivery: boolean
  }
}

interface LineWebhookPayload {
  destination: string
  events: LineWebhookEvent[]
}

// Environment variables (ควรใช้ .env ใน production)
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'your-line-channel-secret'

// Custom Plugin สำหรับ Line Signature Validation
const lineSignatureValidation = new Elysia({ name: 'line-signature' })
  .derive({ as: 'scoped' }, ({ request }) => {
    return {
      validateLineSignature: async (body: string | Buffer) => {
        try {
          const signature = request.headers.get('x-line-signature')
          
          if (!signature) {
            throw new Error('Missing x-line-signature header')
          }

          const hash = createHash('SHA256')
            .update(body)
            .digest('base64')
          
          const expectedSignature = `sha256=${hash}`
          
          if (signature !== expectedSignature) {
            throw new Error('Invalid signature')
          }
          
          return true
        } catch (error) {
          console.error('Signature validation error:', error)
          return false
        }
      }
    }
  })

// สร้าง Elysia App พร้อม Type-safe configuration
const app = new Elysia()
  .use(lineSignatureValidation)
  .get('/', () => 'Line OA STT Bot is running!')
  .post('/webhook', async ({ body, request, set, validateLineSignature }) => {
    try {
      // แปลง body เป็น string สำหรับ validation
      const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
      
      // Validate Line signature
      const isValidSignature = await validateLineSignature(bodyText)
      
      if (!isValidSignature) {
        console.error('⚠️ Invalid Line signature detected')
        console.error('Headers:', Object.fromEntries(request.headers.entries()))
        set.status = 401
        return { status: 'error', message: 'Unauthorized: Invalid signature' }
      }
      
      console.log('✅ Valid Line signature')
      
      // Type-safe parse ของ webhook payload
      const webhookData = body as LineWebhookPayload
      
      console.log(`📨 Received ${webhookData.events.length} events from ${webhookData.destination}`)
      
      // Process events
      for (const event of webhookData.events) {
        console.log(`🔍 Processing event type: ${event.type}`)
        
        if (event.type === 'message' && event.message) {
          switch (event.message.type) {
            case 'text':
              console.log(`💬 Text message: ${event.message.text}`)
              break
            case 'audio':
              console.log(`🎵 Audio message: ${event.message.id}`)
              await handleAudioMessage(event)
              break
            case 'image':
              console.log(`🖼️ Image message: ${event.message.id}`)
              break
            default:
              console.log(`📎 Other message type: ${event.message.type}`)
          }
        }
        
        // TODO: Add other event types (follow, unfollow, etc.)
      }
      
      // ตอบกลับ Line platform ว่าได้รับ webhook แล้ว
      set.status = 200
      return { status: 'ok', message: 'Webhook processed successfully' }
      
    } catch (error) {
      console.error('❌ Webhook error:', error)
      set.status = 500
      return { status: 'error', message: 'Internal server error' }
    }
  })

// Export เป็น fetch handler สำหรับใช้กับ runtime ต่างๆ (Bun, Deno, Cloudflare Workers)
export default app.handle

// ถ้าต้องการรัน local development สามารถใช้ Bun ได้:
// bun --watch index.ts