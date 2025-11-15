import { mock as mockFn, vi } from 'bun:test'
import { createHmac } from 'crypto'
import { Client as LineClientType } from '@line/bot-sdk'
import { JobService } from '../src/services/jobService'
import { STTService } from '../src/services/sttService'
import { AudioService } from '../src/services/audioService'
import { SupabaseClient } from '@supabase/supabase-js'

export const LINE_CHANNEL_SECRET = 'test-channel-secret'

// Declare mock functions
export let mockReplyMessage: ReturnType<typeof mockFn>
export let mockPushMessage: ReturnType<typeof mockFn>
export let mockGetProfile: ReturnType<typeof mockFn>
export let mockGetGroupMemberProfile: ReturnType<typeof mockFn>
export let mockGetRoomMemberProfile: ReturnType<typeof mockFn>
export let mockGetMessageContent: ReturnType<typeof mockFn>

export let mockCreateJob: ReturnType<typeof mockFn>
export let mockUpdateJob: ReturnType<typeof mockFn>
export let mockGetJob: ReturnType<typeof mockFn>

export let mockTranscribeAudio: ReturnType<typeof mockFn>
export let mockTranscribeAudioBuffer: ReturnType<typeof mockFn>

export let mockProcessAudio: ReturnType<typeof mockFn>
export let mockCleanupAudioFiles: ReturnType<typeof mockFn>
export let mockDownloadAudio: ReturnType<typeof mockFn>
export let mockSaveAudioFile: ReturnType<typeof mockFn>

export let mockSupabaseFrom: ReturnType<typeof mockFn>

// Mock instances
export let mockLineClient: LineClientType
export let mockJobService: JobService
export let mockSTTService: STTService
export let mockAudioService: AudioService
export let mockSupabaseClient: SupabaseClient

// Store for created jobs
let jobs: { [key: string]: any } = {}

export const setupMocks = () => {
  jobs = {}
  // Initialize mock functions
  mockReplyMessage = mockFn(() => Promise.resolve({}))
  mockPushMessage = mockFn(() => Promise.resolve({}))
  mockGetProfile = mockFn(() => Promise.resolve({ displayName: 'Test User' }))
  mockGetGroupMemberProfile = mockFn(() => Promise.resolve({ displayName: 'Group Member Name' }))
  mockGetRoomMemberProfile = mockFn(() => Promise.resolve({ displayName: 'Room Member Name' }))
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
    getGroupMemberProfile: mockGetGroupMemberProfile,
    getRoomMemberProfile: mockGetRoomMemberProfile,
    getMessageContent: mockGetMessageContent,
  } as unknown as LineClientType

  mockCreateJob = mockFn(({ messageId, userId, groupId, roomId }) => {
    console.log(`Mock Create Job: messageId=${messageId}, userId=${userId}, groupId=${groupId}, roomId=${roomId}`);
    const job = {
      id: `test-job-id-${messageId}`,
      message_id: messageId,
      user_id: userId,
      group_id: groupId,
      room_id: roomId,
      status: 'PENDING'
    }
    jobs[job.id] = job
    return Promise.resolve(job)
  })
  mockUpdateJob = mockFn(() => Promise.resolve())
  mockGetJob = mockFn((jobId) => Promise.resolve(jobs[jobId]))

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
  }) as any)
  
  mockSupabaseClient = {
    from: mockSupabaseFrom
  } as unknown as SupabaseClient

  // Mock environment variables
  process.env.LINE_CHANNEL_SECRET = LINE_CHANNEL_SECRET
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-access-token'
  process.env.SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'test-anon-key'
}

export const clearMocks = () => {
  mockReplyMessage.mockClear()
  mockPushMessage.mockClear()
  mockGetProfile.mockClear()
  mockGetGroupMemberProfile.mockClear()
  mockGetRoomMemberProfile.mockClear()
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
}

export function createLineSignature(body: string): string {
  return createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64')
}

interface WebhookEvent {
  type: string;
  timestamp: number;
  source: {
    type: 'user' | 'group' | 'room';
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  replyToken?: string;
  message?: {
    id: string;
    type: string;
    text?: string;
    duration?: number;
  };
}

interface WebhookPayload {
  destination: string;
  events: WebhookEvent[];
}

export function createWebhookPayload(events: WebhookEvent[]): WebhookPayload {
  return {
    destination: 'test-destination',
    events,
  }
}

export function createMessageEvent(
  type: 'text' | 'audio' | 'sticker',
  messageId: string,
  sourceType: 'user' | 'group' | 'room',
  sourceId: string, // userId, groupId, or roomId
  replyToken?: string,
  messageContent?: string | number, // text for text message, duration for audio
  memberUserId?: string // Optional: userId for group/room members
): WebhookEvent {
  const source: any = { type: sourceType }
  if (sourceType === 'user') {
    source.userId = sourceId
  } else if (sourceType === 'group') {
    source.groupId = sourceId
    if (memberUserId) source.userId = memberUserId // Add memberUserId for group/room
  } else if (sourceType === 'room') {
    source.roomId = sourceId
    if (memberUserId) source.userId = memberUserId // Add memberUserId for group/room
  }

  const message: any = { id: messageId, type }
  if (type === 'text') message.text = messageContent
  if (type === 'audio') message.duration = messageContent

  return {
    type: 'message',
    timestamp: Date.now(),
    source,
    replyToken,
    message,
  }
}
