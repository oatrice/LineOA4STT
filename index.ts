import { Elysia } from 'elysia'
import { Client, middleware } from '@line/bot-sdk'
import { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { promises as fs } from 'fs'
import * as path from 'path'
import { Readable } from 'stream'

// Helper function to convert a Readable stream to a Buffer
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

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
  let audioFilePath: string | undefined
  try {
    console.log(`🔄 Processing audio ${messageId} for job ${jobId}`)

    // 1. ดาวน์โหลดไฟล์เสียงจาก Line
    const contentStream = await lineClient.getMessageContent(messageId)
    const audioBuffer = await streamToBuffer(contentStream)
    
    // สร้าง directory ชั่วคราวถ้ายังไม่มี
    const tempDir = path.join(process.cwd(), 'temp_audio')
    await fs.mkdir(tempDir, { recursive: true })

    // กำหนดชื่อไฟล์และ path
    audioFilePath = path.join(tempDir, `${messageId}.m4a`) // Line ส่งเป็น .m4a
    await fs.writeFile(audioFilePath, audioBuffer)

    console.log(`✅ Audio file downloaded to: ${audioFilePath}`)

    // 2. อัปเดต job record ด้วย path ไฟล์เสียง
    await supabase
      .from('transcription_jobs')
      .update({
        audio_file_path: audioFilePath,
        status: 'PROCESSING'
      })
      .eq('id', jobId)

    // TODO: ในอนาคตจะ implement จริง (ส่งไป STT API)
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
  } finally {
    // ลบไฟล์เสียงชั่วคราวหลังจากประมวลผลเสร็จ (หรือย้ายไปเก็บถาวร)
    if (audioFilePath) {
      try {
        await fs.unlink(audioFilePath)
        console.log(`🗑️ Deleted temporary audio file: ${audioFilePath}`)
      } catch (cleanupError) {
        console.error('❌ Error deleting temporary audio file:', cleanupError)
      }
    }
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
  .onParse(async ({ request, set }) => {
    const signature = request.headers.get('x-line-signature')
    
    if (!signature) {
      console.error('⚠️ Missing x-line-signature header')
      set.status = 401
      return { status: 'error', message: 'Unauthorized: Missing signature' }
    }

    const rawBody = await request.text()
    
    const hash = createHash('SHA256')
      .update(rawBody)
      .digest('base64')
    
    const expectedSignature = `sha256=${hash}`
    
    if (signature !== expectedSignature) {
      console.error('⚠️ Invalid Line signature detected')
      console.error('Headers:', Object.fromEntries(request.headers.entries()))
      console.error('Raw Body:', rawBody)
      console.error('Expected Signature:', expectedSignature)
      console.error('Received Signature:', signature)
      set.status = 401
      return { status: 'error', message: 'Unauthorized: Invalid signature' }
    }
    
    console.log('✅ Valid Line signature')
    
    // Return parsed JSON body for Elysia to use
    return JSON.parse(rawBody)
  })

// สร้าง Elysia App พร้อม Type-safe configuration
const app = new Elysia()
  .use(lineSignatureValidation)
  .get('/', () => 'Line OA STT Bot is running!')
  .post('/webhook', async ({ body, request, set }) => {
    try {
      // Type-safe parse ของ webhook payload
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
                await lineClient.replyMessage(event.replyToken, {
                  type: 'text',
                  text: 'สวัสดีครับ! มีอะไรให้ช่วยไหมครับ?'
                });
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
  })

// Export เป็น fetch handler สำหรับใช้กับ runtime ต่างๆ (Bun, Deno, Cloudflare Workers)
export default app.handle

// ถ้าต้องการรัน local development สามารถใช้ Bun ได้:
// bun --watch index.ts