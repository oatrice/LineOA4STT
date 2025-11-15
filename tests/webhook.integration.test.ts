import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test'
import { createApp } from '../index' // Import createApp
import {
  LINE_CHANNEL_SECRET,
  setupMocks,
  clearMocks,
  createLineSignature,
  createWebhookPayload,
  createMessageEvent,
  mockLineClient,
  mockJobService,
  mockAudioService,
  mockGetProfile,
  mockGetGroupMemberProfile,
  mockGetRoomMemberProfile,
  mockCreateJob,
  mockProcessAudio,
  mockCleanupAudioFiles,
} from './test-utils'

let app: any

beforeEach(async () => {
  setupMocks()
  // Create app with mocked services
  app = createApp({
    lineClient: mockLineClient,
    jobService: mockJobService,
    sttService: {} as any, // STTService is not directly used in webhook handler, only in async processing
    audioService: mockAudioService,
    lineChannelSecret: LINE_CHANNEL_SECRET,
    lineChannelAccessToken: 'test-access-token',
  })
})

afterEach(() => {
  clearMocks()
  vi.restoreAllMocks()
})

describe('Webhook Integration Tests', () => {
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
    const payload = createWebhookPayload([])

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
    const payload = createWebhookPayload([])
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

  it('should accept webhook with valid signature for text message', async () => {
    const event = createMessageEvent('text', 'test-message-id', 'user', 'test-user-id', 'test-reply-token', 'สวัสดี')
    const payload = createWebhookPayload([event])
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
          type: 'invalid-type',
          timestamp: 'not-a-number',
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
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('should call replyMessage for unsupported message types', async () => {
    const event = createMessageEvent('sticker', 'test-message-id', 'user', 'test-user-id', 'test-reply-token-unsupported')
    const payload = createWebhookPayload([event])
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
    expect(mockLineClient.replyMessage).toHaveBeenCalledTimes(1)
    expect(mockLineClient.replyMessage).toHaveBeenCalledWith('test-reply-token-unsupported', {
      type: 'text',
      text: 'ขออภัยครับ บอทยังไม่รองรับข้อความประเภทนี้ในตอนนี้ 🙏'
    })
  })

  it('should handle audio message - reply immediately and process async', async () => {
    const event = createMessageEvent('audio', 'test-audio-message-id', 'user', 'test-user-id', 'test-reply-token-audio', 10000)
    const payload = createWebhookPayload([event])
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
    
    expect(mockJobService.createJob).toHaveBeenCalledTimes(1)
    expect(mockJobService.createJob).toHaveBeenCalledWith({
      messageId: 'test-audio-message-id',
      userId: 'test-user-id',
      replyToken: 'test-reply-token-audio'
    })
    
    expect(mockLineClient.replyMessage).toHaveBeenCalledTimes(1)
    expect(mockLineClient.replyMessage).toHaveBeenCalledWith('test-reply-token-audio', {
      type: 'text',
      text: '🎵 กำลังแปลงเสียงเป็นข้อความ กรุณารอสักครู่ครับ...'
    })
    
    await new Promise(resolve => setTimeout(resolve, 100))
  })

  it('should handle text message without replyToken', async () => {
    const event = createMessageEvent('text', 'test-message-id', 'user', 'test-user-id', undefined, 'Hello')
    const payload = createWebhookPayload([event])
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
    expect(mockLineClient.replyMessage).toHaveBeenCalledTimes(0)
  })

  it('should handle text message that is not "สวัสดี"', async () => {
    const event = createMessageEvent('text', 'test-message-id', 'user', 'test-user-id', 'test-reply-token-other', 'Hello World')
    const payload = createWebhookPayload([event])
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
    expect(mockLineClient.replyMessage).toHaveBeenCalledTimes(0)
  })

  describe('Audio Processing - pushMessage และ getProfile', () => {
    it('should call pushMessage after audio processing completes successfully for user chat', async () => {
      const event = createMessageEvent('audio', 'test-audio-message-push', 'user', 'test-user-id-push', 'test-reply-token-push', 5000)
      const payload = createWebhookPayload([event])
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

      await new Promise(resolve => setTimeout(resolve, 200))

      expect(mockAudioService.processAudio).toHaveBeenCalledTimes(1)
      expect(mockLineClient.getProfile).toHaveBeenCalledTimes(1)
      expect(mockLineClient.getProfile).toHaveBeenCalledWith('test-user-id-push')
      
      expect(mockLineClient.pushMessage).toHaveBeenCalledTimes(1)
      const pushCall = (mockLineClient.pushMessage as any).mock.calls[0] as any[]
      expect(pushCall).toBeDefined()
      expect(pushCall[0]).toBe('test-user-id-push')
      expect(pushCall[1].type).toBe('text')
      expect(pushCall[1].text).toContain('Test User')
      expect(pushCall[1].text).toContain('ผลการแปลงเสียงเป็นข้อความ')
    })

    it('should call pushMessage with correct group member name after audio processing in a group chat', async () => {
      const groupId = 'test-group-id'
      const userId = 'test-group-user-id'
      const event = createMessageEvent('audio', 'test-audio-message-group', 'group', groupId, 'test-reply-token-group', 5000, userId)
      const payload = createWebhookPayload([event])
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

      await new Promise(resolve => setTimeout(resolve, 200))

      expect(mockAudioService.processAudio).toHaveBeenCalledTimes(1)
      expect(mockLineClient.getGroupMemberProfile).toHaveBeenCalledTimes(1)
      expect(mockLineClient.getGroupMemberProfile).toHaveBeenCalledWith(groupId, userId)
      
      expect(mockLineClient.pushMessage).toHaveBeenCalledTimes(1)
      const pushCall = (mockLineClient.pushMessage as any).mock.calls[0] as any[]
      expect(pushCall).toBeDefined()
      expect(pushCall[0]).toBe(groupId)
      expect(pushCall[1].type).toBe('text')
      expect(pushCall[1].text).toContain('Group Member Name')
      expect(pushCall[1].text).toContain('ผลการแปลงเสียงเป็นข้อความ')
    })

    it('should call pushMessage with correct room member name after audio processing in a room chat', async () => {
      const roomId = 'test-room-id'
      const userId = 'test-room-user-id'
      const event = createMessageEvent('audio', 'test-audio-message-room', 'room', roomId, 'test-reply-token-room', 5000, userId)
      const payload = createWebhookPayload([event])
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

      await new Promise(resolve => setTimeout(resolve, 200))

      expect(mockAudioService.processAudio).toHaveBeenCalledTimes(1)
      expect(mockLineClient.getRoomMemberProfile).toHaveBeenCalledTimes(1)
      expect(mockLineClient.getRoomMemberProfile).toHaveBeenCalledWith(roomId, userId)
      
      expect(mockLineClient.pushMessage).toHaveBeenCalledTimes(1)
      const pushCall = (mockLineClient.pushMessage as any).mock.calls[0] as any[]
      expect(pushCall).toBeDefined()
      expect(pushCall[0]).toBe(roomId)
      expect(pushCall[1].type).toBe('text')
      expect(pushCall[1].text).toContain('Room Member Name')
      expect(pushCall[1].text).toContain('ผลการแปลงเสียงเป็นข้อความ')
    })

    it('should handle getProfile failure gracefully and still send pushMessage', async () => {
      mockGetProfile.mockImplementationOnce(() => Promise.reject(new Error('Profile fetch failed')))

      const event = createMessageEvent('audio', 'test-audio-message-profile-fail', 'user', 'test-user-id-profile-fail', 'test-reply-token-profile-fail', 5000)
      const payload = createWebhookPayload([event])
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

      await new Promise(resolve => setTimeout(resolve, 200))

      expect(mockLineClient.pushMessage).toHaveBeenCalledTimes(1)
      const pushCall = (mockLineClient.pushMessage as any).mock.calls[0] as any[]
      expect(pushCall).toBeDefined()
      expect(pushCall[1].text).toContain('ผู้ใช้')
    })

    it('should update job status to FAILED when audio processing fails', async () => {
      mockProcessAudio.mockImplementationOnce(() => Promise.reject(new Error('Audio processing error')))

      const event = createMessageEvent('audio', 'test-audio-message-fail', 'user', 'test-user-id-fail', 'test-reply-token-fail', 5000)
      const payload = createWebhookPayload([event])
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

      await new Promise(resolve => setTimeout(resolve, 200))

      const updateCalls = (mockJobService.updateJob as any).mock.calls as any[]
      const failedUpdate = updateCalls.find((call: any) => call[1]?.status === 'FAILED')
      expect(failedUpdate).toBeDefined()
      if (failedUpdate) {
        expect(failedUpdate[1].error_message).toContain('Audio processing error')
      }
    })

    it('should call cleanupAudioFiles after successful processing', async () => {
      mockCleanupAudioFiles.mockImplementationOnce(() => Promise.resolve())

      const event = createMessageEvent('audio', 'test-audio-message-cleanup', 'user', 'test-user-cleanup', 'test-reply-token-cleanup', 5000)
      const payload = createWebhookPayload([event])
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

      await new Promise(resolve => setTimeout(resolve, 200))

      expect(mockAudioService.cleanupAudioFiles).toHaveBeenCalledTimes(1)
      expect(mockAudioService.cleanupAudioFiles).toHaveBeenCalledWith(
        '/tmp/test-audio.m4a',
        '/tmp/test-audio.wav'
      )
    })
  })

  describe('Error Handling Cases', () => {
    it('should handle missing userId in audio message', async () => {
      const event = createMessageEvent('audio', 'test-audio-message', 'user', undefined as any, 'test-reply-token', 5000)
      const payload = createWebhookPayload([event])
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

      expect(mockJobService.createJob).toHaveBeenCalledTimes(0)
    })

    it('should handle missing replyToken in audio message', async () => {
      const event = createMessageEvent('audio', 'test-audio-message', 'user', 'test-user-id', undefined, 5000)
      const payload = createWebhookPayload([event])
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

      expect(mockJobService.createJob).toHaveBeenCalledTimes(0)
    })

    it('should continue processing other events when one event fails', async () => {
      mockCreateJob
        .mockImplementationOnce(() => Promise.reject(new Error('Job creation failed')))
        .mockImplementationOnce(() => Promise.resolve({
          id: 'test-job-id-2',
          message_id: 'test-audio-message-2',
          user_id: 'test-user-id-2',
          status: 'PENDING'
        }))

      const event1 = createMessageEvent('audio', 'test-audio-message-1', 'user', 'test-user-id-1', 'test-reply-token-1', 5000)
      const event2 = createMessageEvent('audio', 'test-audio-message-2', 'user', 'test-user-id-2', 'test-reply-token-2', 5000)
      const payload = createWebhookPayload([event1, event2])
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
      expect(mockJobService.createJob).toHaveBeenCalledTimes(2)
    })
  })
})
