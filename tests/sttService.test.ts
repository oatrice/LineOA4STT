import { describe, it, expect, beforeEach, mock, afterEach, vi } from 'bun:test'
import { STTService } from '../src/services/sttService'
import { SpeechClient } from '@google-cloud/speech'
import { promises as fs } from 'fs'

// Mock Google Cloud Speech Client
const mockRecognize = mock(async () => [
  {
    results: [
      {
        alternatives: [
          {
            transcript: 'Test transcript',
            confidence: 0.95,
          },
        ],
      },
    ],
  },
])

mock.module('@google-cloud/speech', () => ({
  SpeechClient: mock(() => ({
    recognize: mockRecognize,
  })),
}))

describe('STTService', () => {
  let sttService: STTService

  beforeEach(() => {
    // Clear mock history before each test
    mockRecognize.mockClear()
    sttService = new STTService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should transcribe audio file', async () => {
    // Create a temporary test file
    const testFilePath = '/tmp/test-audio.wav'
    await fs.writeFile(testFilePath, Buffer.from('fake audio data'))

    try {
      const result = await sttService.transcribeAudio(testFilePath, {
        languageCode: 'th-TH',
      })

      expect(result).toBeDefined()
      expect(result.transcript).toBe('Test transcript')
      expect(result.confidence).toBe(0.95)
    } finally {
      // Cleanup
      try {
        await fs.unlink(testFilePath)
      } catch {
        // Ignore cleanup errors
      }
    }
  })

  it('should transcribe audio buffer', async () => {
    const audioBuffer = Buffer.from('fake audio data')

    const result = await sttService.transcribeAudioBuffer(audioBuffer, {
      languageCode: 'th-TH',
    })

    expect(result).toBeDefined()
    expect(result.transcript).toBe('Test transcript')
    expect(result.confidence).toBe(0.95)
  })
})
