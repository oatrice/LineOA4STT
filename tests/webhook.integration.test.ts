import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { createHmac } from 'crypto'

const LINE_CHANNEL_SECRET = 'test-channel-secret'

// Mock LINE Bot SDK Client
const mockReplyMessage = mock(() => Promise.resolve({}))
const mockPushMessage = mock(() => Promise.resolve({}))
const mockGetProfile = mock(() => Promise.resolve({ displayName: 'Test User' }))

// Mock @line/bot-sdk module
mock.module('@line/bot-sdk', () => {
  return {
    Client: class {
      replyMessage = mockReplyMessage
      pushMessage = mockPushMessage
      getProfile = mockGetProfile
    }
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

  // Note: Audio message test requires mocking jobService and audioService
  // This test is skipped until those services are properly mocked
  it.skip('should call replyMessage for audio message', async () => {
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
    // Verify that LINE API was called for audio message
    expect(mockReplyMessage).toHaveBeenCalledTimes(1)
    expect(mockReplyMessage).toHaveBeenCalledWith('test-reply-token-audio', {
      type: 'text',
      text: '🎵 กำลังแปลงเสียงเป็นข้อความ กรุณารอสักครู่ครับ...'
    })
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
})

