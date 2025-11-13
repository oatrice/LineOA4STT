import { Elysia, t } from 'elysia'
import { Client } from '@line/bot-sdk'
import { createHmac } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { JobService } from './src/services/jobService'
import { STTService } from './src/services/sttService'
import { AudioService } from './src/services/audioService'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Client as LineClientType } from '@line/bot-sdk'
import type { AudioProcessingResult } from './src/services/audioService'

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

interface AppServices {
  lineClient: LineClientType;
  jobService: JobService;
  sttService: STTService;
  audioService: AudioService;
  lineChannelSecret: string; // Add lineChannelSecret to services
}

interface AppEnv {
  LINE_CHANNEL_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  NODE_ENV?: string; // Add NODE_ENV to AppEnv
}

export function createApp(services: AppServices) {
  const { lineClient, jobService, sttService, audioService, lineChannelSecret } = services;

  console.log('Current NODE_ENV:', process.env.NODE_ENV); // Keep using process.env for NODE_ENV as it's a global concept

  // ฟังก์ชันสำหรับส่งข้อความแจ้งข้อผิดพลาด
  async function sendErrorMessage(
    replyToken: string | undefined, 
    userId: string | undefined,
    groupId: string | undefined,
    roomId: string | undefined,
    errorMessage: string
  ) {
    try {
      const errorText = `ขออภัยครับ เกิดข้อผิดพลาดในการประมวลผล: ${errorMessage} 🙏`;
      
      // ถ้ามี replyToken ให้ใช้ replyMessage
      if (replyToken) {
        await lineClient.replyMessage(replyToken, {
          type: 'text',
          text: errorText,
        });
        return;
      }
      
      // ถ้าไม่มี replyToken แต่มี userId, groupId หรือ roomId ให้ใช้ pushMessage
      let to: string | undefined;
      if (groupId) {
        to = groupId;
      } else if (roomId) {
        to = roomId;
      } else if (userId) {
        to = userId;
      }
      
      if (to) {
        await lineClient.pushMessage(to, {
          type: 'text',
          text: errorText,
        });
      }
    } catch (error) {
      console.error('❌ Failed to send error message:', error);
    }
  }

  // ฟังก์ชันสำหรับจัดการ audio messages
  async function handleAudioMessage(event: LineWebhookEvent) {
    try {
      if (!event.message || !event.replyToken || !event.source.userId && !event.source.groupId && !event.source.roomId) {
        console.error('❌ Missing required fields for audio processing')
        // ส่งข้อความแจ้งข้อผิดพลาด
        await sendErrorMessage(
          event.replyToken,
          event.source.userId,
          event.source.groupId,
          event.source.roomId,
          'ไม่สามารถดำเนินการได้เนื่องจากข้อมูลไม่ครบถ้วน'
        )
        return
      }

      console.log(`🎵 Processing audio message: ${event.message.id}`)

      // 1. ตอบกลับ user ว่ากำลังประมวลผล
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '🎵 กำลังแปลงเสียงเป็นข้อความ กรุณารอสักครู่ครับ...',
      })

      // 2. สร้าง job record ใน Supabase
      const job = await jobService.createJob({
        messageId: event.message.id,
        userId: event.source.userId || undefined, // Ensure userId is string or undefined
        replyToken: event.replyToken,
        groupId: event.source.groupId,
        roomId: event.source.roomId,
      })

      console.log(`✅ Created job ${job.id} for message ${event.message.id}`)

      // 3. เริ่มการประมวลผลแบบ async (ไม่ block webhook response)
      // ไม่ต้องรอให้ processAudioAsync เสร็จสิ้น เพื่อให้ webhook response กลับไปได้ทันที
      processAudioAsync(
        event.message.id,
        job.id,
        event.source.userId,
        event.timestamp
      ).catch(error => {
        console.error('❌ Uncaught error in processAudioAsync:', error)
        // ส่งข้อความแจ้งข้อผิดพลาดเมื่อเกิดข้อผิดพลาดใน processAudioAsync
        sendErrorMessage(
          event.replyToken,
          event.source.userId,
          event.source.groupId,
          event.source.roomId,
          'เกิดข้อผิดพลาดในระหว่างการประมวลผลเสียง กรุณาลองใหม่อีกครั้ง'
        )
      })
    } catch (error) {
      console.error('❌ Error handling audio message:', error)
      // ส่งข้อความแจ้งข้อผิดพลาดเมื่อเกิดข้อผิดพลาดใน handleAudioMessage
      await sendErrorMessage(
        event.replyToken,
        event.source.userId,
        event.source.groupId,
        event.source.roomId,
        'เกิดข้อผิดพลาดในการดำเนินการ กรุณาลองใหม่อีกครั้ง'
      )
    }
  }

  // ฟังก์ชันสำหรับประมวลผลเสียงแบบ async
  async function processAudioAsync(
    messageId: string,
    jobId: string,
    userId: string | undefined, // Allow userId to be undefined
    timestamp: number
  ) {
    let result: AudioProcessingResult | undefined
    let processingError: Error | undefined
    let replyToken: string | undefined
    let groupId: string | undefined
    let roomId: string | undefined

    try {
      console.log(`🔄 Processing audio ${messageId} for job ${jobId}`)

      // Update job status to PROCESSING
      await jobService.updateJob(jobId, { status: 'PROCESSING' })

      // Retrieve the job to get the replyToken and source IDs for error handling
      const job = await jobService.getJob(jobId)
      if (!job) {
        console.error(`❌ Job ${jobId} not found.`)
        return
      }
      
      replyToken = job.reply_token
      groupId = job.group_id
      roomId = job.room_id

      // Process audio using AudioService
      result = await audioService.processAudio(messageId, {
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
      if (userId) { // Only try to get profile if userId is defined
        try {
          const userProfile = await lineClient.getProfile(userId)
          displayName = userProfile.displayName
        } catch (error) {
          console.error(`Failed to get profile for user ${userId}:`, error)
        }
      }

      // Format timestamp
      const messageTime = new Date(timestamp)
      const timeString = messageTime.toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Bangkok',
      })

      let to: string | undefined
      if (job.group_id) {
        to = job.group_id
      } else if (job.room_id) {
        to = job.room_id
      } else if (job.user_id) {
        to = job.user_id
      }

      if (!to) {
        console.error(`❌ No valid destination (userId, groupId, or roomId) found for job ${jobId}. Cannot send reply.`)
        return
      }

      // Send result to user using push_message
      console.log(`✉️ Sending transcription result using push_message to ${to}`)
      await lineClient.pushMessage(to, {
        type: 'text',
        text: `✨ เสร็จแล้วครับ!\n\nจาก: ${displayName}\nข้อความเมื่อ ${timeString}\nผลลัพธ์: ${result.transcript}`,
      })

      console.log(`✅ Completed job ${jobId}`)
    } catch (error) {
      console.error('❌ Error in async processing:', error)
      processingError = error instanceof Error ? error : new Error(String(error))
      
      // ส่งข้อความแจ้งข้อผิดพลาดเมื่อเกิดข้อผิดพลาดใน processAudioAsync
      await sendErrorMessage(
        replyToken,
        userId,
        groupId,
        roomId,
        'ไม่สามารถแปลงเสียงเป็นข้อความได้ กรุณาลองใหม่อีกครั้ง'
      )
    } finally {
      // Ensure cleanup happens regardless of success or failure in async processing
      if (result && result.audioFilePath && result.convertedAudioPath) {
        await audioService.cleanupAudioFiles(
          result.audioFilePath,
          result.convertedAudioPath
        )
      }

      // Update job status to FAILED if an error occurred
      if (processingError) {
        await jobService.updateJob(jobId, {
          status: 'FAILED',
          error_message: processingError.message,
        })
      }
    }
  }

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
      const hash = createHmac('sha256', lineChannelSecret)
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
                try {
                  if (event.message.text === 'สวัสดี' && event.replyToken) {
                    await lineClient.replyMessage(event.replyToken, {
                      type: 'text',
                      text: 'สวัสดีครับ! มีอะไรให้ช่วยไหมครับ?'
                    });
                  }
                } catch (error) {
                  console.error('❌ Error handling text message:', error);
                  // ส่งข้อความแจ้งข้อผิดพลาดสำหรับข้อความ
                  await sendErrorMessage(
                    event.replyToken,
                    event.source.userId,
                    event.source.groupId,
                    event.source.roomId,
                    'เกิดข้อผิดพลาดในการตอบกลับข้อความ'
                  );
                }
                // --- END: เพิ่ม Logic การตอบกลับข้อความ ---
                console.log(`💬 Text message: ${event.message.text}`)
                break
              case 'audio':
                console.log(`🎵 Audio message: ${event.message.id}`)
                try {
                  await handleAudioMessage(event)
                } catch (error) {
                  console.error('❌ Error handling audio message:', error);
                  // ข้อความแจ้งข้อผิดพลาดจะถูกส่งภายใน handleAudioMessage แล้ว
                }
                break
              case 'image':
                console.log(`🖼️ Image message: ${event.message.id}`)
                break
              default:
                console.log(`📎 Other message type: ${event.message.type}`)
                try {
                  if (event.replyToken) {
                    await lineClient.replyMessage(event.replyToken, {
                      type: 'text',
                      text: 'ขออภัยครับ บอทยังไม่รองรับข้อความประเภทนี้ในตอนนี้ 🙏'
                    })
                  }
                } catch (error) {
                  console.error('❌ Error handling unsupported message type:', error);
                  // ส่งข้อความแจ้งข้อผิดพลาดสำหรับข้อความที่ไม่รองรับ
                  await sendErrorMessage(
                    event.replyToken,
                    event.source.userId,
                    event.source.groupId,
                    event.source.roomId,
                    'เกิดข้อผิดพลาดในการตอบกลับข้อความ'
                  );
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
  return app;
}

export function createAppWithEnv(env: AppEnv, mockServices?: Partial<AppServices>) {
  // Validate environment variables
  if (!env.LINE_CHANNEL_SECRET) {
    throw new Error('LINE_CHANNEL_SECRET is not defined in environment variables.')
  }
  if (!env.SUPABASE_URL) {
    throw new Error('SUPABASE_URL is not defined in environment variables.')
  }
  if (!env.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_ANON_KEY is not defined in environment variables.')
  }
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not defined in environment variables.')
  }

  // Supabase client
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)

  // Line client
  const lineClient = mockServices?.lineClient || new Client({
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
  })

  // Initialize services
  const jobService = mockServices?.jobService || new JobService(supabase)
  const sttService = mockServices?.sttService || new STTService()
  const audioService = mockServices?.audioService || new AudioService(lineClient, sttService)

  return createApp({ lineClient, jobService, sttService, audioService, lineChannelSecret: env.LINE_CHANNEL_SECRET })
}

// ถ้าต้องการรัน local development สามารถใช้ Bun ได้:
// bun --watch index.ts
