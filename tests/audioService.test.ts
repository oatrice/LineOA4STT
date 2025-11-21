import { describe, it, expect, beforeEach, mock, afterEach, vi } from 'bun:test'
import { AudioService } from '../src/services/audioService'
import { STTService } from '../src/services/sttService'
import type { Client } from '@line/bot-sdk'
import { Readable } from 'stream'
import { promises as fs } from 'fs'
import * as path from 'path'

// Declare mock functions globally
let mockGetMessageContent: ReturnType<typeof mock>
let mockTranscribeAudioBuffer: ReturnType<typeof mock>

// Mock instances
let mockLineClient: Partial<Client>
let mockSTTService: Partial<STTService>
let audioService: AudioService

describe('AudioService', () => {
  const tempTestDir = path.join(process.cwd(), 'temp_audio_test')

  beforeEach(async () => {
    // Initialize mock functions
    mockGetMessageContent = mock(async () => {
      const stream = new Readable()
      stream.push(Buffer.from('fake audio data'))
      stream.push(null) // End stream
      return stream as any
    })

    mockTranscribeAudioBuffer = mock(async () => ({
      transcript: 'Test transcript',
      confidence: 0.95,
      provider: 'azure' as const,
    }))

    mockLineClient = {
      getMessageContent: mockGetMessageContent,
    }

    mockSTTService = {
      transcribeAudioBuffer: mockTranscribeAudioBuffer,
    }

    // Clear mock history before each test
    mockGetMessageContent.mockClear()
    mockTranscribeAudioBuffer.mockClear()

    // Ensure temp test directory is clean
    await fs.rm(tempTestDir, { recursive: true, force: true })
    await fs.mkdir(tempTestDir, { recursive: true })

    // Create a dummy audio file for testing conversion in the tempTestDir
    const testAudioSourcePath = path.join(tempTestDir, 'test-message-id.m4a')
    // Use ffmpeg to create a valid m4a file
    await new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const ffmpeg = spawn('ffmpeg', [
        '-y', // Overwrite output files without asking
        '-f', 'lavfi',
        '-i', 'anullsrc=r=44100:cl=mono',
        '-t', '1', // Duration 1 second
        '-q:a', '9', // Audio quality
        '-acodec', 'aac',
        testAudioSourcePath
      ]);
      ffmpeg.on('close', (code: number) => {
        if (code === 0) {
          resolve(null);
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
      ffmpeg.on('error', (err: Error) => {
        reject(err);
      });
    });

    audioService = new AudioService(
      mockLineClient as Client,
      mockSTTService as STTService
    )
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    // Clean up temp test directory after each test
    await fs.rm(tempTestDir, { recursive: true, force: true })
  })

  it('should download audio from Line', async () => {
    const buffer = await audioService.downloadAudio('test-message-id')

    expect(buffer).toBeInstanceOf(Buffer)
    // The mock Readable stream pushes a Buffer, so the output will be a Buffer.
    // We can check its content to be sure.
    expect(buffer.toString('utf-8')).toEqual('fake audio data')
    expect(mockLineClient.getMessageContent).toHaveBeenCalledWith(
      'test-message-id'
    )
  })

  it('should save audio file', async () => {
    const buffer = Buffer.from('test audio data')
    const filePath = await audioService.saveAudioFile('test-message-id', buffer)

    expect(filePath).toContain('test-message-id.m4a')
    expect(filePath).toContain('temp_audio') // This will still be 'temp_audio' from the service's constructor
    // To test with tempTestDir, AudioService constructor would need to accept tempDir
  })

  it('should process audio successfully', async () => {
    // Mock convertAudioToWav to prevent it from throwing the intentional error
    const mockConvertAudioToWav = vi.spyOn(audioService, 'convertAudioToWav').mockImplementation(async (inputPath, outputPath) => {
      // In a real scenario, this would create a wav file. For the test, we can just create a dummy file.
      await fs.writeFile(outputPath, 'fake wav data');
    });

    // The dummy audio file is already created in beforeEach
    const audioBuffer = Buffer.from('fake audio data');

    // Mock downloadAudio to return the buffer
    const mockDownloadAudio = vi.spyOn(audioService, 'downloadAudio').mockResolvedValue(audioBuffer);

    const result = await audioService.processAudio('test-message-id', {
      languageCode: 'th-TH',
      tempDir: tempTestDir,
    });

    expect(result).toBeDefined();
    expect(result.transcript).toBe('Test transcript');
    expect(result.confidence).toBe(0.95);
    expect(mockDownloadAudio).toHaveBeenCalledTimes(1);
    expect(mockConvertAudioToWav).toHaveBeenCalledTimes(1);
    expect(mockTranscribeAudioBuffer).toHaveBeenCalledTimes(1);

    // Cleanup
    const initialAudioFilePath = path.join(tempTestDir, 'test-message-id.m4a');
    const convertedAudioPath = path.join(tempTestDir, 'test-message-id.wav');
    await audioService.cleanupAudioFiles(initialAudioFilePath, convertedAudioPath);

    // Verify cleanup
    await expect(fs.access(initialAudioFilePath)).rejects.toThrow();
    await expect(fs.access(convertedAudioPath)).rejects.toThrow();

    mockDownloadAudio.mockRestore();
    mockConvertAudioToWav.mockRestore();
  });

  it('should cleanup audio files', async () => {
    const audioFilePath = path.join(tempTestDir, 'test-message-id.m4a')
    const convertedAudioPath = path.join(tempTestDir, 'test-message-id.wav')

    await fs.writeFile(audioFilePath, Buffer.from('test'))
    await fs.writeFile(convertedAudioPath, Buffer.from('test'))

    await audioService.cleanupAudioFiles(audioFilePath, convertedAudioPath)

    await expect(fs.access(audioFilePath)).rejects.toThrow()
    await expect(fs.access(convertedAudioPath)).rejects.toThrow()
  })
})
