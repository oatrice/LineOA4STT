import { describe, it, expect, beforeEach } from 'bun:test'
import { createHmac } from 'crypto'

const LINE_CHANNEL_SECRET = 'test-channel-secret'

// Mock environment variables before importing app
process.env.LINE_CHANNEL_SECRET = LINE_CHANNEL_SECRET
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-access-token'
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_ANON_KEY = 'test-anon-key'

// Import app after setting environment variables
// Use dynamic import to ensure env vars are set first
let app: any
beforeEach(async () => {
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
})

