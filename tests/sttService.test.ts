import { describe, it, expect, beforeEach, mock, afterEach, vi } from 'bun:test'
import { STTService } from '../src/services/sttService'
import { promises as fs } from 'fs'

// Mock Azure Speech SDK directly
vi.mock('microsoft-cognitiveservices-speech-sdk', () => {
  const mockResultReason = {
    RecognizedSpeech: 0,
    NoMatch: 1,
    Canceled: 2,
  }

  const mockCancellationReason = {
    Error: 0,
    EndOfStream: 1,
  }

  // This is the key change: The mock for recognizeOnceAsync now simulates the callback behavior.
  const recognizerMock = {
    recognized: mock(),
    canceled: mock(),
    sessionStopped: mock(),
    recognizeOnceAsync: mock((successCallback) => {
      // Immediately invoke the success callback with a simulated successful result.
      successCallback({
        reason: mockResultReason.RecognizedSpeech,
        text: 'Test transcript',
        errorDetails: undefined,
      })
    }),
    close: mock(),
  }

  return {
    SpeechConfig: {
      fromSubscription: mock(() => ({
        speechRecognitionLanguage: 'th-TH',
      })),
    },
    AudioConfig: {
      fromStreamInput: mock(() => ({})),
    },
    SpeechRecognizer: mock(() => recognizerMock),
    ResultReason: mockResultReason,
    CancellationReason: mockCancellationReason,
    AudioInputStream: {
      createPushStream: mock(() => ({
        write: mock(),
        close: mock(),
      })),
    },
  }
})

describe('STTService', () => {
  let sttService: STTService

  beforeEach(() => {
    // We only need to instantiate the service, as the mocks are handled by vi.mock
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
      // The service hardcodes Azure confidence to 0.9, so the test must expect that.
      expect(result.confidence).toBe(0.9)
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
    // The service hardcodes Azure confidence to 0.9, so the test must expect that.
    expect(result.confidence).toBe(0.9)
  })
})
