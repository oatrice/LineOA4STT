import { describe, it, expect, beforeEach, mock as mockFn, afterEach, vi } from 'bun:test'
import { createHmac } from 'crypto'
import { createAppWithEnv } from '../index' // Import createAppWithEnv
import { Client as LineClientType } from '@line/bot-sdk'
import { JobService } from '../src/services/jobService'
import { STTService } from '../src/services/sttService'
import { AudioService } from '../src/services/audioService'
import { SupabaseClient } from '@supabase/supabase-js'

const LINE_CHANNEL_SECRET = 'test-channel-secret'

// Declare mock functions globally
let mockReplyMessage: ReturnType<typeof mockFn>
let mockPushMessage: ReturnType<typeof mockFn>
let mockGetProfile: ReturnType<typeof mockFn>
let mockGetMessageContent: ReturnType<typeof mockFn>

let mockCreateJob: ReturnType<typeof mockFn>
let mockUpdateJob: ReturnType<typeof mockFn>
let mockGetJob: ReturnType<typeof mockFn>

let mockTranscribeAudio: ReturnType<typeof mockFn>
let mockTranscribeAudioBuffer: ReturnType<typeof mockFn>

let mockProcessAudio: ReturnType<typeof mockFn>
let mockCleanupAudioFiles: ReturnType<typeof mockFn>
let mockDownloadAudio: ReturnType<typeof mockFn>
let mockSaveAudioFile: ReturnType<typeof mockFn>

let mockSupabaseFrom: ReturnType<typeof mockFn>

// Mock instances
let mockLineClient: LineClientType
let mockJobService: JobService
let mockSTTService: STTService
let mockAudioService: AudioService
let mockSupabaseClient: SupabaseClient

let app: any

beforeEach(async () => {
  // Initialize mock functions
  mockReplyMessage = mockFn(() => Promise.resolve({}))
  mockPushMessage = mockFn(() => Promise.resolve({}))
  mockGetProfile = mockFn(() => Promise.resolve({ displayName: 'Test User' }))
  mockGetMessageContent = mockFn(() => Promise.resolve({
    on: (event: string, handler: (data?: any) => void) => {
      if (event === 'data') handler(Buffer.from('fake-audio-data'))
      if (event === 'end') handler()
      return mockGetMessageContent()
    }
  }))

  mockLineClient = {
    replyMessage: mockReplyMessage,
    pushMessage: mockPushMessage,
    getProfile: mockGetProfile,
    getMessageContent: mockGetMessageContent,
  } as unknown as LineClientType

  // In-memory store for jobs
  const jobStore: Map<string, any> = new Map()
  let jobCounter = 1

  mockCreateJob = mockFn((jobData) => {
    const jobId = `test-job-id-${jobCounter++}`
    const newJob = {
      id: jobId,
      message_id: jobData.messageId,
      user_id: jobData.userId,
      status: 'PENDING',
      group_id: jobData.groupId,
      room_id: jobData.roomId,
      replyToken: jobData.replyToken, // Store replyToken as well
    }
    jobStore.set(jobId, newJob)
    return Promise.resolve(newJob)
  })

  mockUpdateJob = mockFn((jobId, updates) => {
    if (jobStore.has(jobId)) {
      const updatedJob = { ...jobStore.get(jobId), ...updates }
      jobStore.set(jobId, updatedJob)
    }
    return Promise.resolve()
  })

  mockGetJob = mockFn((jobId) => {
    return Promise.resolve(jobStore.get(jobId) || null)
  })

  mockJobService = {
    createJob: mockCreateJob,
    updateJob: mockUpdateJob,
    getJob: mockGetJob,
  } as unknown as JobService

  mockTranscribeAudio = mockFn(() => Promise.resolve({
    transcript: 'ผลการแปลงเสียงเป็นข้อความ',
    confidence: 0.95
  }))
  mockTranscribeAudioBuffer = mockFn(() => Promise.resolve({
    transcript: 'ผลการแปลงเสียงเป็นข้อความ',
    confidence: 0.95
  }))

  mockSTTService = {
    transcribeAudio: mockTranscribeAudio,
    transcribeAudioBuffer: mockTranscribeAudioBuffer,
  } as unknown as STTService

  mockProcessAudio = mockFn(() => Promise.resolve({
    transcript: 'ผลการแปลงเสียงเป็นข้อความ',
    confidence: 0.95,
    audioFilePath: '/tmp/test-audio.m4a',
    convertedAudioPath: '/tmp/test-audio.wav'
  }))
  mockCleanupAudioFiles = mockFn(() => Promise.resolve())
  mockDownloadAudio = mockFn(() => Promise.resolve(Buffer.from('fake audio data')))
  mockSaveAudioFile = mockFn(() => Promise.resolve('/tmp/test-audio.m4a'))

  mockAudioService = {
    processAudio: mockProcessAudio,
    cleanupAudioFiles: mockCleanupAudioFiles,
    downloadAudio: mockDownloadAudio,
    saveAudioFile: mockSaveAudioFile,
  } as unknown as AudioService

  mockSupabaseFrom = mockFn(() => ({
    insert: mockFn(() => ({
      select: mockFn(() => Promise.resolve({
        data: {
          id: 'test-job-id',
          message_id: 'test-audio-message-id',
          user_id: 'test-user-id',
          status: 'PENDING'
        },
        error: null
      }))
    }))
  }) as any) // Cast to any to satisfy TS for nested mocks
  
  mockSupabaseClient = {
    from: mockSupabaseFrom
  } as unknown as SupabaseClient

  // Mock environment variables
  process.env.LINE_CHANNEL_SECRET = LINE_CHANNEL_SECRET
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-access-token'
  process.env.SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'test-anon-key'

  // Clear mock history before each test
  mockReplyMessage.mockClear()
  mockPushMessage.mockClear()
  mockGetProfile.mockClear()
  mockGetMessageContent.mockClear()
  mockCreateJob.mockClear()
  mockUpdateJob.mockClear()
  mockGetJob.mockClear()
  mockTranscribeAudio.mockClear()
  mockTranscribeAudioBuffer.mockClear()
  mockProcessAudio.mockClear()
  mockCleanupAudioFiles.mockClear()
  mockDownloadAudio.mockClear()
  mockSaveAudioFile.mockClear()
  mockSupabaseFrom.mockClear()
  
  // Create app with mocked services injected directly
  const appInstance = createAppWithEnv(
    {
      LINE_CHANNEL_SECRET: LINE_CHANNEL_SECRET,
      LINE_CHANNEL_ACCESS_TOKEN: 'test-access-token',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      NODE_ENV: 'test',
    },
    {
      lineClient: mockLineClient,
      jobService: mockJobService,
      sttService: mockSTTService,
      audioService: mockAudioService,
    }
  );

  app = appInstance; // Assign the app instance to the global 'app' variable
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Webhook Integration Tests', () => {
  function createLineSignature(body: string): string {
    return createHmac('sha256', LINE_CHANNEL_SECRET)
      .update(body)
      .digest('base64')
  }

  it('should return 200 for health check', async () => {
    const request = new Request('http://localhost/', {
      method: 'GET',
    })

    const response = await app.handle(request)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain('Line OA STT Bot is running')
  })

  it('should reject webhook without signature', async () => {
    const payload = {
      destination: 'test-destination',
      events: [],
    }

    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const response = await app.handle(request)
    expect(response.status).toBe(401)
  })

  it('should reject webhook with invalid signature', async () => {
    const payload = {
      destination: 'test-destination',
      events: [],
    }

    const body = JSON.stringify(payload)
    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': 'invalid-signature',
      },
      body,
    })

    const response = await app.handle(request)
    expect(response.status).toBe(401)
  })

  it('should accept webhook with valid signature', async () => {
    const payload = {
      destination: 'test-destination',
      events: [
        {
          type: 'message',
          timestamp: Date.now(),
          source: {
            type: 'user',
            userId: 'test-user-id',
          },
          replyToken: 'test-reply-token',
          message: {
            id: 'test-message-id',
            type: 'text',
            text: 'สวัสดี',
          },
        },
      ],
    }

    const body = JSON.stringify(payload)
    const signature = createLineSignature(body)

    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': signature,
      },
      body,
    })

    const response = await app.handle(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.status).toBe('ok')
    // Verify that LINE API was called (mocked)
    expect(mockLineClient.replyMessage).toHaveBeenCalledTimes(1)
    expect(mockLineClient.replyMessage).toHaveBeenCalledWith('test-reply-token', {
      type: 'text',
      text: 'สวัสดีครับ! มีอะไรให้ช่วยไหมครับ?'
    })
  })

  it('should validate webhook payload schema', async () => {
    const invalidPayload = {
      destination: 'test-destination',
      events: [
        {
          type: 'invalid-type', // Invalid event type
          timestamp: 'not-a-number', // Invalid timestamp
        },
      ],
    }

    const body = JSON.stringify(invalidPayload)
    const signature = createLineSignature(body)

    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': signature,
      },
      body,
    })

    const response = await app.handle(request)
    // Should reject invalid schema
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('should call replyMessage for unsupported message types', async () => {
    const payload = {
      destination: 'test-destination',
      events: [
        {
          type: 'message',
          timestamp: Date.now(),
          source: {
            type: 'user',
            userId: 'test-user-id',
          },
          replyToken: 'test-reply-token-unsupported',
          message: {
            id: 'test-message-id',
            type: 'sticker', // Unsupported message type
          },
        },
      ],
    }

    const body = JSON.stringify(payload)
    const signature = createLineSignature(body)

    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': signature,
      },
      body,
    })

    const response = await app.handle(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.status).toBe('ok')
    // Verify that LINE API was called for unsupported message type
    expect(mockLineClient.replyMessage).toHaveBeenCalledTimes(1)
    expect(mockLineClient.replyMessage).toHaveBeenCalledWith('test-reply-token-unsupported', {
      type: 'text',
      text: 'ขออภัยครับ บอทยังไม่รองรับข้อความประเภทนี้ในตอนนี้ 🙏'
    })
  })

  it('should handle audio message - reply immediately and process async', async () => {
    const payload = {
      destination: 'test-destination',
      events: [
        {
          type: 'message',
          timestamp: Date.now(),
          source: {
            type: 'user',
            userId: 'test-user-id',
          },
          replyToken: 'test-reply-token-audio',
          message: {
            id: 'test-audio-message-id',
            type: 'audio',
            duration: 10000,
          },
        },
      ],
    }

    const body = JSON.stringify(payload)
    const signature = createLineSignature(body)

    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': signature,
      },
      body,
    })

    const response = await app.handle(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.status).toBe('ok')
    
    // ตรวจสอบว่าสร้าง job
    expect(mockJobService.createJob).toHaveBeenCalledTimes(1)
    expect(mockJobService.createJob).toHaveBeenCalledWith({
      messageId: 'test-audio-message-id',
      userId: 'test-user-id',
      replyToken: 'test-reply-token-audio'
    })
    
    // ตรวจสอบว่าตอบกลับทันที
    expect(mockLineClient.replyMessage).toHaveBeenCalledTimes(1)
    expect(mockLineClient.replyMessage).toHaveBeenCalledWith('test-reply-token-audio', {
      type: 'text',
      text: '🎵 กำลังแปลงเสียงเป็นข้อความ กรุณารอสักครู่ครับ...'
    })
    
    // รอให้ async processing เสร็จ (เพิ่มเวลารอเล็กน้อย)
    await new Promise(resolve => setTimeout(resolve, 100))
  })

  it('should handle text message without replyToken', async () => {
    const payload = {
      destination: 'test-destination',
      events: [
        {
          type: 'message',
          timestamp: Date.now(),
          source: {
            type: 'user',
            userId: 'test-user-id',
          },
          // No replyToken
          message: {
            id: 'test-message-id',
            type: 'text',
            text: 'Hello',
          },
        },
      ],
    }

    const body = JSON.stringify(payload)
    const signature = createLineSignature(body)

    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': signature,
      },
      body,
    })

    const response = await app.handle(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.status).toBe('ok')
    // Should not call LINE API when there's no replyToken
    expect(mockLineClient.replyMessage).toHaveBeenCalledTimes(0)
  })

  it('should handle text message that is not "สวัสดี"', async () => {
    const payload = {
      destination: 'test-destination',
      events: [
        {
          type: 'message',
          timestamp: Date.now(),
          source: {
            type: 'user',
            userId: 'test-user-id',
          },
          replyToken: 'test-reply-token-other',
          message: {
            id: 'test-message-id',
            type: 'text',
            text: 'Hello World', // Not "สวัสดี"
          },
        },
      ],
    }

    const body = JSON.stringify(payload)
    const signature = createLineSignature(body)

    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': signature,
      },
      body,
    })

    const response = await app.handle(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.status).toBe('ok')
    // Should not call LINE API for text messages that are not "สวัสดี"
    expect(mockLineClient.replyMessage).toHaveBeenCalledTimes(0)
  })

  describe('Audio Processing - pushMessage และ getProfile', () => {
    it('should call pushMessage after audio processing completes successfully', async () => {
      const payload = {
        destination: 'test-destination',
        events: [
          {
            type: 'message',
            timestamp: 1234567890000,
            source: {
              type: 'user',
              userId: 'test-user-id-push',
            },
            replyToken: 'test-reply-token-push',
            message: {
              id: 'test-audio-message-push',
              type: 'audio',
              duration: 5000,
            },
          },
        ],
      }

      const body = JSON.stringify(payload)
      const signature = createLineSignature(body)

      const request = new Request('http://localhost/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': signature,
        },
        body,
      })

      const response = await app.handle(request)
      expect(response.status).toBe(200)

      // รอให้ async processing เสร็จ
      await new Promise(resolve => setTimeout(resolve, 200))

      // ตรวจสอบว่าเรียก processAudio
      expect(mockAudioService.processAudio).toHaveBeenCalledTimes(1)
      
      // ตรวจสอบว่าเรียก getProfile
      expect(mockLineClient.getProfile).toHaveBeenCalledTimes(1)
      expect(mockLineClient.getProfile).toHaveBeenCalledWith('test-user-id-push')
      
      // ตรวจสอบว่าเรียก pushMessage พร้อมข้อความที่ถูกต้อง
      expect(mockLineClient.pushMessage).toHaveBeenCalledTimes(1)
      const pushCall = (mockLineClient.pushMessage as any).mock.calls[0] as any[]
      expect(pushCall).toBeDefined()
      expect(pushCall[0]).toBe('test-user-id-push')
      expect(pushCall[1].type).toBe('text')
      expect(pushCall[1].text).toContain('Test User') // ชื่อจาก mock getProfile
      expect(pushCall[1].text).toContain('ผลการแปลงเสียงเป็นข้อความ') // transcript จาก mock
    })

    it('should handle getProfile failure gracefully and still send pushMessage', async () => {
      // Mock getProfile to fail
      mockGetProfile.mockImplementationOnce(() => Promise.reject(new Error('Profile fetch failed')))

      const payload = {
        destination: 'test-destination',
        events: [
          {
            type: 'message',
            timestamp: 1234567890000,
            source: {
              type: 'user',
              userId: 'test-user-id-profile-fail',
            },
            replyToken: 'test-reply-token-profile-fail',
            message: {
              id: 'test-audio-message-profile-fail',
              type: 'audio',
              duration: 5000,
            },
          },
        ],
      }

      const body = JSON.stringify(payload)
      const signature = createLineSignature(body)

      const request = new Request('http://localhost/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': signature,
        },
        body,
      })

      const response = await app.handle(request)
      expect(response.status).toBe(200)

      // รอให้ async processing เสร็จ
      await new Promise(resolve => setTimeout(resolve, 200))

      // ตรวจสอบว่ายังคงเรียก pushMessage แม้ getProfile จะ fail
      expect(mockLineClient.pushMessage).toHaveBeenCalledTimes(1)
      const pushCall = (mockLineClient.pushMessage as any).mock.calls[0] as any[]
      expect(pushCall).toBeDefined()
      expect(pushCall[1].text).toContain('ผู้ใช้') // ใช้ชื่อ default เมื่อ getProfile fail
    })

    it('should update job status to FAILED when audio processing fails', async () => {
      // Mock processAudio to fail
      mockProcessAudio.mockImplementationOnce(() => Promise.reject(new Error('Audio processing error')))

      const payload = {
        destination: 'test-destination',
        events: [
          {
            type: 'message',
            timestamp: Date.now(),
            source: {
              type: 'user',
              userId: 'test-user-id-fail',
            },
            replyToken: 'test-reply-token-fail',
            message: {
              id: 'test-audio-message-fail',
              type: 'audio',
              duration: 5000,
            },
          },
        ],
      }

      const body = JSON.stringify(payload)
      const signature = createLineSignature(body)

      const request = new Request('http://localhost/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': signature,
        },
        body,
      })

      const response = await app.handle(request)
      expect(response.status).toBe(200)

      // รอให้ async processing เสร็จ
      await new Promise(resolve => setTimeout(resolve, 200))

      // ตรวจสอบว่า updateJob ถูกเรียกด้วย status FAILED
      const updateCalls = (mockJobService.updateJob as any).mock.calls as any[]
      const failedUpdate = updateCalls.find((call: any) => call[1]?.status === 'FAILED')
      expect(failedUpdate).toBeDefined()
      if (failedUpdate) {
        expect(failedUpdate[1].error_message).toContain('Audio processing error')
      }
    })

    it('should call cleanupAudioFiles after successful processing', async () => {
      // Mock cleanupAudioFiles to succeed
      mockCleanupAudioFiles.mockImplementationOnce(() => Promise.resolve())

      const payload = {
        destination: 'test-destination',
        events: [
          {
            type: 'message',
            timestamp: Date.now(),
            source: {
              type: 'user',
              userId: 'test-user-cleanup',
            },
            replyToken: 'test-reply-token-cleanup',
            message: {
              id: 'test-audio-message-cleanup',
              type: 'audio',
              duration: 5000,
            },
          },
        ],
      }

      const body = JSON.stringify(payload)
      const signature = createLineSignature(body)

      const request = new Request('http://localhost/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': signature,
        },
        body,
      })

      const response = await app.handle(request)
      expect(response.status).toBe(200)

      // รอให้ async processing เสร็จ
      await new Promise(resolve => setTimeout(resolve, 200))

      // ตรวจสอบว่าเรียก cleanupAudioFiles
      expect(mockAudioService.cleanupAudioFiles).toHaveBeenCalledTimes(1)
      expect(mockAudioService.cleanupAudioFiles).toHaveBeenCalledWith(
        '/tmp/test-audio.m4a',
        '/tmp/test-audio.wav'
      )
    })
  })

  describe('Error Handling Cases', () => {
    it('should handle missing userId in audio message', async () => {
      const payload = {
        destination: 'test-destination',
        events: [
          {
            type: 'message',
            timestamp: Date.now(),
            source: {
              type: 'user',
              // Missing userId
            },
            replyToken: 'test-reply-token',
            message: {
              id: 'test-audio-message',
              type: 'audio',
              duration: 5000,
            },
          },
        ],
      }

      const body = JSON.stringify(payload)
      const signature = createLineSignature(body)

      const request = new Request('http://localhost/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': signature,
        },
        body,
      })

      const response = await app.handle(request)
      expect(response.status).toBe(200)

      // ตรวจสอบว่าไม่เรียก createJob เพราะขาด userId
      expect(mockJobService.createJob).toHaveBeenCalledTimes(0)
    })

    it('should handle missing replyToken in audio message', async () => {
      const payload = {
        destination: 'test-destination',
        events: [
          {
            type: 'message',
            timestamp: Date.now(),
            source: {
              type: 'user',
              userId: 'test-user-id',
            },
            // Missing replyToken
            message: {
              id: 'test-audio-message',
              type: 'audio',
              duration: 5000,
            },
          },
        ],
      }

      const body = JSON.stringify(payload)
      const signature = createLineSignature(body)

      const request = new Request('http://localhost/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': signature,
        },
        body,
      })

      const response = await app.handle(request)
      expect(response.status).toBe(200)

      // ตรวจสอบว่าไม่เรียก createJob เพราะขาด replyToken
      expect(mockJobService.createJob).toHaveBeenCalledTimes(0)
    })

    it('should continue processing other events when one event fails', async () => {
      // Mock createJob to fail for first call but succeed for second
      mockCreateJob
        .mockImplementationOnce(() => Promise.reject(new Error('Job creation failed')))
        .mockImplementationOnce(() => Promise.resolve({
          id: 'test-job-id-2',
          message_id: 'test-audio-message-2',
          user_id: 'test-user-id-2',
          status: 'PENDING'
        }))

      const payload = {
        destination: 'test-destination',
        events: [
          {
            type: 'message',
            timestamp: Date.now(),
            source: {
              type: 'user',
              userId: 'test-user-id-1',
            },
            replyToken: 'test-reply-token-1',
            message: {
              id: 'test-audio-message-1',
              type: 'audio',
              duration: 5000,
            },
          },
          {
            type: 'message',
            timestamp: Date.now(),
            source: {
              type: 'user',
              userId: 'test-user-id-2',
            },
            replyToken: 'test-reply-token-2',
            message: {
              id: 'test-audio-message-2',
              type: 'audio',
              duration: 5000,
            },
          },
        ],
      }

      const body = JSON.stringify(payload)
      const signature = createLineSignature(body)

      const request = new Request('http://localhost/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': signature,
        },
        body,
      })

      const response = await app.handle(request)
      
      // Webhook ควร return 200 แม้ว่าบาง event จะ fail
      expect(response.status).toBe(200)
      
      // ตรวจสอบว่า createJob ถูกเรียก 2 ครั้ง
      expect(mockJobService.createJob).toHaveBeenCalledTimes(2)
    })
  })
})
