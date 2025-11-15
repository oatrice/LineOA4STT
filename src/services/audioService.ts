import { Client } from '@line/bot-sdk'
import { Readable } from 'stream'
import { promises as fs } from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import { exec } from 'child_process'
import { STTService } from './sttService'
import type { STTResult } from './sttService'

const execPromise = promisify(exec)

// Helper function to convert a Readable stream to a Buffer
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

export interface AudioProcessingResult {
  transcript: string
  confidence: number
  provider: 'azure' | 'google' // Add provider field
  audioFilePath: string
  convertedAudioPath: string
}

export interface AudioProcessingOptions {
  tempDir?: string
  languageCode?: string
}

export class AudioService {
  private sttService: STTService
  private lineClient: Client
  private tempDir: string

  constructor(lineClient: Client, sttService: STTService) {
    this.lineClient = lineClient
    this.sttService = sttService
    this.tempDir = path.join(process.cwd(), 'temp_audio')
  }

  async downloadAudio(messageId: string): Promise<Buffer> {
    const contentStream = await this.lineClient.getMessageContent(messageId)
    return await streamToBuffer(contentStream)
  }

  async saveAudioFile(messageId: string, audioBuffer: Buffer): Promise<string> {
    await fs.mkdir(this.tempDir, { recursive: true })
    const audioFilePath = path.join(this.tempDir, `${messageId}.m4a`)
    await fs.writeFile(audioFilePath, audioBuffer)
    return audioFilePath
  }

  async convertAudioToWav(
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    try {
      await execPromise(
        `ffmpeg -y -i "${inputPath}" -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}"`
      )
    } catch (error) {
      throw new Error(
        `FFmpeg conversion failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  async processAudio(
    messageId: string,
    options: AudioProcessingOptions = {}
  ): Promise<AudioProcessingResult> {
    const tempDir = options.tempDir || this.tempDir
    let audioFilePath: string | undefined
    let convertedAudioPath: string | undefined

    try {
      console.log(`[AudioService] Starting processAudio for messageId: ${messageId}`)

      // 1. Download audio from Line
      console.log(`[AudioService] Downloading audio for messageId: ${messageId}`)
      const audioBuffer = await this.downloadAudio(messageId)
      console.log(`[AudioService] Audio downloaded. Buffer size: ${audioBuffer.length} bytes`)

      // 2. Save to temporary file
      await fs.mkdir(tempDir, { recursive: true })
      audioFilePath = path.join(tempDir, `${messageId}.m4a`)
      console.log(`[AudioService] Saving audio to: ${audioFilePath}`)
      await fs.writeFile(audioFilePath, audioBuffer)
      console.log(`[AudioService] Audio saved to: ${audioFilePath}`)

      // 3. Convert to WAV
      convertedAudioPath = path.join(tempDir, `${messageId}.wav`)
      console.log(`[AudioService] Converting audio from ${audioFilePath} to ${convertedAudioPath}`)
      await this.convertAudioToWav(audioFilePath, convertedAudioPath)
      console.log(`[AudioService] Audio converted to: ${convertedAudioPath}`)

      // 4. Transcribe using STT
      console.log(`[AudioService] Transcribing audio using STTService for: ${convertedAudioPath}`)
      const sttResult = await this.sttService.transcribeAudio(
        convertedAudioPath,
        {
          languageCode: options.languageCode || 'th-TH',
        }
      )
      console.log(`[AudioService] STT transcription completed. Provider: ${sttResult.provider}`)

      return {
        transcript: sttResult.transcript,
        confidence: sttResult.confidence,
        provider: sttResult.provider, // Pass the provider from STTResult
        audioFilePath,
        convertedAudioPath,
      }
    } catch (error) {
      console.error(`[AudioService] Error in processAudio for messageId ${messageId}:`, error)
      throw error // Re-throw the error so it can be caught by processAudioAsync
    } finally {
      // Ensure cleanup happens regardless of success or failure
      // The cleanup is now handled by the caller (index.ts) to avoid premature deletion
      // if the file paths are passed to another service for further processing.
      // This also allows for more robust error handling in the main application logic.
    }
  }

  async cleanupAudioFiles(
    audioFilePath: string,
    convertedAudioPath: string
  ): Promise<void> {
    try {
      if (audioFilePath) {
        await fs.unlink(audioFilePath)
        console.log(`🗑️ Deleted temporary audio file: ${audioFilePath}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`⚠️ Temporary audio file not found, skipping deletion: ${audioFilePath}`)
      } else {
        console.error('❌ Error deleting temporary audio file:', error)
      }
    }

    try {
      if (convertedAudioPath) {
        await fs.unlink(convertedAudioPath)
        console.log(`🗑️ Deleted temporary converted file: ${convertedAudioPath}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`⚠️ Temporary converted file not found, skipping deletion: ${convertedAudioPath}`)
      } else {
        console.error('❌ Error deleting temporary converted file:', error)
      }
    }
  }
}
