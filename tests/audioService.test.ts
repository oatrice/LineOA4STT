import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { AudioService } from '../src/services/audioService'
import { STTService } from '../src/services/sttService'
import type { Client } from '@line/bot-sdk'
import { Readable } from 'stream'

describe('AudioService', () => {
  let audioService: AudioService
  let mockLineClient: Partial<Client>
  let mockSTTService: Partial<STTService>

  beforeEach(() => {
    mockSTTService = {
      transcribeAudio: mock(async () => ({
        transcript: 'Test transcript',
        confidence: 0.95,
      })),
    }

    mockLineClient = {
      getMessageContent: mock(async () => {
        const stream = new Readable()
        stream.push(Buffer.from('fake audio data'))
        stream.push(null) // End stream
        return stream as any
      }),
    }

    audioService = new AudioService(
      mockLineClient as Client,
      mockSTTService as STTService
    )
  })

  it('should download audio from Line', async () => {
    const buffer = await audioService.downloadAudio('test-message-id')

    expect(buffer).toBeInstanceOf(Buffer)
    expect(mockLineClient.getMessageContent).toHaveBeenCalledWith(
      'test-message-id'
    )
  })

  it('should save audio file', async () => {
    const buffer = Buffer.from('test audio data')
    const filePath = await audioService.saveAudioFile('test-message-id', buffer)

    expect(filePath).toContain('test-message-id.m4a')
    expect(filePath).toContain('temp_audio')
  })
})

