import { Elysia, t } from 'elysia'
import { Client } from '@line/bot-sdk'
import { createHmac } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { JobService } from './src/services/jobService'
import { STTService } from './src/services/sttService'
import { AudioService } from './src/services/audioService'

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
)

// Line client
const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
})

// Initialize services
const jobService = new JobService(supabase)
const sttService = new STTService()
const audioService = new AudioService(lineClient, sttService)

// ฟังก์ชันสำหรับจัดการ audio messages
async function handleAudioMessage(event: LineWebhookEvent) {
  try {
    if (!event.message || !event.replyToken || !event.source.userId) {
      console.error('❌ Missing required fields for audio processing')
      return
    }

    console.log(`🎵 Processing audio message: ${event.message.id}`)

    // 1. สร้าง job record ใน Supabase
    const job = await jobService.createJob({
      messageId: event.message.id,
      userId: event.source.userId,
      replyToken: event.replyToken,
    })

    console.log(`✅ Created job ${job.id} for message ${event.message.id}`)

    // 2. ตอบกลับ user ว่ากำลังประมวลผล
    await lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: '🎵 กำลังแปลงเสียงเป็นข้อความ กรุณารอสักครู่ครับ...',
    })

    // 3. เริ่มการประมวลผลแบบ async (ไม่ block webhook response)
    processAudioAsync(
      event.message.id,
      job.id,
      event.source.userId,
      event.timestamp
    )
  } catch (error) {
    console.error('❌ Error handling audio message:', error)
  }
}

// ฟังก์ชันสำหรับประมวลผลเสียงแบบ async
async function processAudioAsync(
  messageId: string,
  jobId: string,
  userId: string,
  timestamp: number
) {
  try {
    console.log(`🔄 Processing audio ${messageId} for job ${jobId}`)

    // Update job status to PROCESSING
    await jobService.updateJob(jobId, { status: 'PROCESSING' })

    // Process audio using AudioService
    const result = await audioService.processAudio(messageId, {
      languageCode: 'th-TH',
    })

    console.log(`📝 Transcription Result: ${result.transcript}`)
    console.log(`📊 Confidence: ${result.confidence}`)

    // Update job record with STT results
    await jobService.updateJob(jobId, {
      status: 'COMPLETED',
      transcript: result.transcript,
      confidence: result.confidence,
      provider: 'google-cloud-stt',
      audio_file_path: result.audioFilePath,
      completed_at: new Date().toISOString(),
    })

    // Get user profile for personalized message
    let displayName = 'ผู้ใช้'
    try {
      const userProfile = await lineClient.getProfile(userId)
      displayName = userProfile.displayName
    } catch (error) {
      console.error(`Failed to get profile for user ${userId}:`, error)
    }

    // Format timestamp
    const messageTime = new Date(timestamp)
    const timeString = messageTime.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Bangkok',
    })

    // Send result to user
    await lineClient.pushMessage(userId, {
      type: 'text',
      text: `✨ เสร็จแล้วครับ!\n\nจาก: ${displayName}\nข้อความเมื่อ ${timeString}\nผลลัพธ์: ${result.transcript}`,
    })

    console.log(`✅ Completed job ${jobId}`)

    // Cleanup temporary files
    await audioService.cleanupAudioFiles(
      result.audioFilePath,
      result.convertedAudioPath
    )
  } catch (error) {
    console.error('❌ Error in async processing:', error)

    // Update job status to FAILED
    await jobService.updateJob(jobId, {
      status: 'FAILED',
      error_message:
        error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

// TypeBox schemas สำหรับ Line webhook payload validation
const LineWebhookSourceSchema = t.Object({
  type: t.Union([t.Literal('user'), t.Literal('group'), t.Literal('room')]),
  userId: t.Optional(t.String()),
  groupId: t.Optional(t.String()),
  roomId: t.Optional(t.String()),
})

const LineWebhookMessageSchema = t.Object({
  id: t.String(),
  type: t.Union([
    t.Literal('text'),
    t.Literal('image'),
    t.Literal('video'),
    t.Literal('audio'),
    t.Literal('file'),
    t.Literal('location'),
    t.Literal('sticker'),
  ]),
  text: t.Optional(t.String()),
  originalContentUrl: t.Optional(t.String()),
  previewImageUrl: t.Optional(t.String()),
  fileName: t.Optional(t.String()),
  fileSize: t.Optional(t.Number()),
  duration: t.Optional(t.Number()),
})

const LineWebhookEventSchema = t.Object({
  type: t.Union([
    t.Literal('message'),
    t.Literal('follow'),
    t.Literal('unfollow'),
    t.Literal('join'),
    t.Literal('leave'),
    t.Literal('postback'),
    t.Literal('beacon'),
  ]),
  timestamp: t.Number(),
  source: LineWebhookSourceSchema,
  replyToken: t.Optional(t.String()),
  message: t.Optional(LineWebhookMessageSchema),
  webhookEventId: t.Optional(t.String()),
  deliveryContext: t.Optional(
    t.Object({
      isRedelivery: t.Boolean(),
    })
  ),
})

const LineWebhookPayloadSchema = t.Object({
  destination: t.String(),
  events: t.Array(LineWebhookEventSchema),
})

// Type-safe interfaces สำหรับ TypeScript (derived from schemas)
type LineWebhookEvent = typeof LineWebhookEventSchema.static
type LineWebhookPayload = typeof LineWebhookPayloadSchema.static

// Environment variables (ควรใช้ .env ใน production)
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'your-line-channel-secret'

// สร้าง Elysia App พร้อม Type-safe configuration
const app = new Elysia()
  .onRequest(async ({ request, set }) => {
    // Validate LINE signature for POST /webhook before body parsing
    if (request.method === 'POST' && new URL(request.url).pathname === '/webhook') {
      const signature = request.headers.get('x-line-signature')
      
      if (!signature) {
        console.error('⚠️ Missing x-line-signature header')
        set.status = 401
        set.headers['Content-Type'] = 'application/json'
        return Response.json(
          { status: 'error', message: 'Unauthorized: Missing signature' },
          { status: 401 }
        )
      }

      // Clone request to read body without consuming it
      const clonedRequest = request.clone()
      const rawBody = await clonedRequest.text()
      
      // Line uses HMAC-SHA256 with channel secret
      const hash = createHmac('sha256', LINE_CHANNEL_SECRET)
        .update(rawBody)
        .digest('base64')
      
      if (signature !== hash) {
        console.error('⚠️ Invalid Line signature detected')
        set.status = 401
        set.headers['Content-Type'] = 'application/json'
        return Response.json(
          { status: 'error', message: 'Unauthorized: Invalid signature' },
          { status: 401 }
        )
      }
      
      console.log('✅ Valid Line signature')
    }
  })
  .get('/', () => 'Line OA STT Bot is running!')
  .post(
    '/webhook',
    async ({ body, request, set }) => {
      try {
        // Type-safe parse ของ webhook payload (validated by schema)
        const webhookData = body as LineWebhookPayload
      
      console.log(`📨 Received ${webhookData.events.length} events from ${webhookData.destination}`)
      
      // Process events
      for (const event of webhookData.events) {
        console.log(`🔍 Processing event type: ${event.type}`)
        
        if (event.type === 'message' && event.message) {
          switch (event.message.type) {
            case 'text':
              // --- START: เพิ่ม Logic การตอบกลับข้อความ ---
              if (event.message.text === 'สวัสดี' && event.replyToken) {
                try {
                  await lineClient.replyMessage(event.replyToken, {
                    type: 'text',
                    text: 'สวัสดีครับ! มีอะไรให้ช่วยไหมครับ?'
                  });
                } catch (error) {
                  console.error('❌ Error replying to message:', error)
                  // Continue processing even if LINE API fails (e.g., in test environment)
                }
              }
              // --- END: เพิ่ม Logic การตอบกลับข้อความ ---
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
              if (event.replyToken) {
                await lineClient.replyMessage(event.replyToken, {
                  type: 'text',
                  text: 'ขออภัยครับ บอทยังไม่รองรับข้อความประเภทนี้ในตอนนี้ 🙏'
                })
              }
              break
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
  },
    {
      body: LineWebhookPayloadSchema,
    }
  )

// Export เป็น fetch handler สำหรับใช้กับ runtime ต่างๆ (Bun, Deno, Cloudflare Workers)
export default app.handle

// ถ้าต้องการรัน local development สามารถใช้ Bun ได้:
// bun --watch index.ts