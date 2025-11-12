import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { createHmac } from 'crypto'

const LINE_CHANNEL_SECRET = 'test-channel-secret'

// Mock LINE Bot SDK Client
const mockReplyMessage = mock(() => Promise.resolve({}))
const mockPushMessage = mock(() => Promise.resolve({}))
const mockGetProfile = mock(() => Promise.resolve({ displayName: 'Test User' }))
const mockGetMessageContent = mock(() => Promise.resolve({
  on: (event: string, handler: (data?: any) => void) => {
    if (event === 'data') handler(Buffer.from('fake-audio-data'))
    if (event === 'end') handler()
    return mockGetMessageContent()
  }
}))

// Mock @line/bot-sdk module
mock.module('@line/bot-sdk', () => {
  return {
    Client: class {
      replyMessage = mockReplyMessage
      pushMessage = mockPushMessage
      getProfile = mockGetProfile
      getMessageContent = mockGetMessageContent
    }
  }
})

// Mock JobService
const mockCreateJob = mock(() => Promise.resolve({
  id: 'test-job-id',
  message_id: 'test-audio-message-id',
  user_id: 'test-user-id',
  status: 'PENDING'
}))
const mockUpdateJob = mock(() => Promise.resolve())

mock.module('../src/services/jobService', () => {
  return {
    JobService: class {
      createJob = mockCreateJob
      updateJob = mockUpdateJob
    }
  }
})

// Mock AudioService
const mockProcessAudio = mock(() => Promise.resolve({
  transcript: 'ผลการแปลงเสียงเป็นข้อความ',
  confidence: 0.95,
  audioFilePath: '/tmp/test-audio.m4a',
  convertedAudioPath: '/tmp/test-audio.wav'
}))
const mockCleanupAudioFiles = mock(() => Promise.resolve())

mock.module('../src/services/audioService', () => {
  return {
    AudioService: class {
      processAudio = mockProcessAudio
      cleanupAudioFiles = mockCleanupAudioFiles
    }
  }
})

// Mock STTService
const mockTranscribeAudio = mock(() => Promise.resolve({
  transcript: 'ผลการแปลงเสียงเป็นข้อความ',
  confidence: 0.95
}))

mock.module('../src/services/sttService', () => {
  return {
    STTService: class {
      transcribeAudio = mockTranscribeAudio
    }
  }
})

// Mock Supabase
const mockSupabaseFrom = mock(() => ({
  insert: mock(() => ({
    select: mock(() => ({
      single: mock(() => Promise.resolve({
        data: {
          id: 'test-job-id',
          message_id: 'test-audio-message-id',
          user_id: 'test-user-id',
          status: 'PENDING'
        },
        error: null
      }))
    }))
  })),
  update: mock(() => ({
    eq: mock(() => Promise.resolve({ error: null }))
  }))
}))

mock.module('@supabase/supabase-js', () => {
  return {
    createClient: () => ({
      from: mockSupabaseFrom
    })
  }
})

// Mock environment variables before importing app
process.env.LINE_CHANNEL_SECRET = LINE_CHANNEL_SECRET
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-access-token'
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_ANON_KEY = 'test-anon-key'

// Import app after setting environment variables
// Use dynamic import to ensure env vars are set first
let app: any
beforeEach(async () => {
  // Reset mocks before each test
  mockReplyMessage.mockClear()
  mockPushMessage.mockClear()
  mockGetProfile.mockClear()
  mockGetMessageContent.mockClear()
  mockCreateJob.mockClear()
  mockUpdateJob.mockClear()
  mockProcessAudio.mockClear()
  mockCleanupAudioFiles.mockClear()
  mockTranscribeAudio.mockClear()
  
  if (!app) {
    const module = await import('../index')
    app = module.default
  }
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

    const response = await app(request)
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

    const response = await app(request)
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

    const response = await app(request)
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

    const response = await app(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.status).toBe('ok')
    // Verify that LINE API was called (mocked)
    expect(mockReplyMessage).toHaveBeenCalledTimes(1)
    expect(mockReplyMessage).toHaveBeenCalledWith('test-reply-token', {
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

    const response = await app(request)
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

    const response = await app(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.status).toBe('ok')
    // Verify that LINE API was called for unsupported message type
    expect(mockReplyMessage).toHaveBeenCalledTimes(1)
    expect(mockReplyMessage).toHaveBeenCalledWith('test-reply-token-unsupported', {
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

    const response = await app(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.status).toBe('ok')
    
    // ตรวจสอบว่าสร้าง job
    expect(mockCreateJob).toHaveBeenCalledTimes(1)
    expect(mockCreateJob).toHaveBeenCalledWith({
      messageId: 'test-audio-message-id',
      userId: 'test-user-id',
      replyToken: 'test-reply-token-audio'
    })
    
    // ตรวจสอบว่าตอบกลับทันที
    expect(mockReplyMessage).toHaveBeenCalledTimes(1)
    expect(mockReplyMessage).toHaveBeenCalledWith('test-reply-token-audio', {
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

    const response = await app(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.status).toBe('ok')
    // Should not call LINE API when there's no replyToken
    expect(mockReplyMessage).toHaveBeenCalledTimes(0)
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

    const response = await app(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.status).toBe('ok')
    // Should not call LINE API for text messages that are not "สวัสดี"
    expect(mockReplyMessage).toHaveBeenCalledTimes(0)
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

      const response = await app(request)
      expect(response.status).toBe(200)

      // รอให้ async processing เสร็จ
      await new Promise(resolve => setTimeout(resolve, 200))

      // ตรวจสอบว่าเรียก processAudio
      expect(mockProcessAudio).toHaveBeenCalledTimes(1)
      
      // ตรวจสอบว่าเรียก getProfile
      expect(mockGetProfile).toHaveBeenCalledTimes(1)
      expect(mockGetProfile).toHaveBeenCalledWith('test-user-id-push')
      
      // ตรวจสอบว่าเรียก pushMessage พร้อมข้อความที่ถูกต้อง
      expect(mockPushMessage).toHaveBeenCalledTimes(1)
      const pushCall = mockPushMessage.mock.calls[0] as any[]
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

      const response = await app(request)
      expect(response.status).toBe(200)

      // รอให้ async processing เสร็จ
      await new Promise(resolve => setTimeout(resolve, 200))

      // ตรวจสอบว่ายังคงเรียก pushMessage แม้ getProfile จะ fail
      expect(mockPushMessage).toHaveBeenCalledTimes(1)
      const pushCall = mockPushMessage.mock.calls[0] as any[]
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

      const response = await app(request)
      expect(response.status).toBe(200)

      // รอให้ async processing เสร็จ
      await new Promise(resolve => setTimeout(resolve, 200))

      // ตรวจสอบว่า updateJob ถูกเรียกด้วย status FAILED
      const updateCalls = mockUpdateJob.mock.calls as any[]
      const failedUpdate = updateCalls.find((call: any) => call[1]?.status === 'FAILED')
      expect(failedUpdate).toBeDefined()
      if (failedUpdate) {
        expect(failedUpdate[1].error_message).toContain('Audio processing error')
      }
    })

    it('should call cleanupAudioFiles after successful processing', async () => {
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

      const response = await app(request)
      expect(response.status).toBe(200)

      // รอให้ async processing เสร็จ
      await new Promise(resolve => setTimeout(resolve, 200))

      // ตรวจสอบว่าเรียก cleanupAudioFiles
      expect(mockCleanupAudioFiles).toHaveBeenCalledTimes(1)
      expect(mockCleanupAudioFiles).toHaveBeenCalledWith(
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

      const response = await app(request)
      expect(response.status).toBe(200)

      // ตรวจสอบว่าไม่เรียก createJob เพราะขาด userId
      expect(mockCreateJob).toHaveBeenCalledTimes(0)
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

      const response = await app(request)
      expect(response.status).toBe(200)

      // ตรวจสอบว่าไม่เรียก createJob เพราะขาด replyToken
      expect(mockCreateJob).toHaveBeenCalledTimes(0)
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

      const response = await app(request)
      
      // Webhook ควร return 200 แม้ว่าบาง event จะ fail
      expect(response.status).toBe(200)
      
      // ตรวจสอบว่า createJob ถูกเรียก 2 ครั้ง
      expect(mockCreateJob).toHaveBeenCalledTimes(2)
    })
  })
})
