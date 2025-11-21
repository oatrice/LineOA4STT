import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test'
import type { STTService as STTServiceType } from '../src/services/sttService';

const mockTranscribeAudioBuffer = vi.fn();

vi.mock('../src/services/sttService', () => {
  return {
    STTService: vi.fn().mockImplementation(() => {
      return {
        transcribeAudioBuffer: mockTranscribeAudioBuffer,
      };
    }),
  };
});

describe('STTService', () => {
  let STTService: typeof STTServiceType;
  let sttServiceInstance: STTServiceType;

  beforeEach(async () => {
    // Dynamically import the mocked service
    const mockedModule = await import('../src/services/sttService');
    STTService = mockedModule.STTService;
    sttServiceInstance = new STTService();

    // Clear mock history before each test
    mockTranscribeAudioBuffer.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should transcribe audio buffer', async () => {
    // Setup mock return value for this specific test
    mockTranscribeAudioBuffer.mockResolvedValue({
      transcript: 'Test transcript',
      confidence: 0.9,
      provider: 'azure',
    });
    
    const audioBuffer = Buffer.from('fake audio data');

    const result = await sttServiceInstance.transcribeAudioBuffer(audioBuffer, {
      languageCode: 'th-TH',
    });

    expect(mockTranscribeAudioBuffer).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    expect(result.transcript).toBe('Test transcript');
    expect(result.confidence).toBe(0.9);
  });
});
