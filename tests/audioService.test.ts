import { describe, it, expect, beforeEach, mock, afterEach, vi } from 'bun:test'
import { AudioService } from '../src/services/audioService'
import { STTService } from '../src/services/sttService'
import type { Client } from '@line/bot-sdk'
import { Readable } from 'stream'
import { promises as fs } from 'fs'
import * as path from 'path'

// Declare mock functions globally
let mockGetMessageContent: ReturnType<typeof mock>
let mockTranscribeAudio: ReturnType<typeof mock>

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

    mockTranscribeAudio = mock(async () => ({
      transcript: 'Test transcript',
      confidence: 0.95,
    }))

    mockLineClient = {
      getMessageContent: mockGetMessageContent,
    }

    mockSTTService = {
      transcribeAudio: mockTranscribeAudio,
    }

    // Clear mock history before each test
    mockGetMessageContent.mockClear()
    mockTranscribeAudio.mockClear()

    // Ensure temp test directory is clean
    await fs.rm(tempTestDir, { recursive: true, force: true })
    await fs.mkdir(tempTestDir, { recursive: true })

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
    // Create a dummy audio file for testing conversion
    const testAudioSourcePath = path.join(process.cwd(), 'temp_audio_test', 'test-message-id.m4a')
    const testAudioInputPath = path.join(tempTestDir, 'test-message-id.m4a')
    await fs.copyFile(testAudioSourcePath, testAudioInputPath)

    // Mock downloadAudio to return the buffer of the created file
    const audioBuffer = await fs.readFile(testAudioSourcePath)
    const mockDownloadAudio = mock(audioService, 'downloadAudio').mockResolvedValue(audioBuffer)

    const result = await audioService.processAudio('test-message-id', {
      languageCode: 'th-TH',
      tempDir: tempTestDir,
    })

    expect(result).toBeDefined()
    expect(result.transcript).toBe('Test transcript')
    expect(result.confidence).toBe(0.95)
    expect(mockGetMessageContent).toHaveBeenCalledTimes(1)
    expect(mockTranscribeAudio).toHaveBeenCalledTimes(1)

    // Verify files were created and then cleaned up
    const audioFilePath = path.join(tempTestDir, 'test-message-id.m4a')
    const convertedAudioPath = path.join(tempTestDir, 'test-message-id.wav')

    // After processAudio, files should be cleaned up by cleanupAudioFiles
    // For this test, we need to mock cleanupAudioFiles to prevent actual deletion
    // Or, we can check for existence before cleanup and then after
    // For now, let's assume cleanup is handled by the service and focus on processAudio logic

    // To properly test cleanup, we'd need to mock fs.unlink or similar.
    // For this test, we'll just check the main processing flow.
    
    // Verify that the files were cleaned up
    const convertedAudioPath = path.join(tempTestDir, 'test-message-id.wav')
    await expect(fs.access(testAudioInputPath)).rejects.toThrow()
    await expect(fs.access(convertedAudioPath)).rejects.toThrow()

    mockDownloadAudio.mockRestore()
  })

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
