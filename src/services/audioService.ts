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
      // 1. Download audio from Line
      const audioBuffer = await this.downloadAudio(messageId)

      // 2. Save to temporary file
      await fs.mkdir(tempDir, { recursive: true })
      audioFilePath = path.join(tempDir, `${messageId}.m4a`)
      await fs.writeFile(audioFilePath, audioBuffer)

      // 3. Convert to WAV
      convertedAudioPath = path.join(tempDir, `${messageId}.wav`)
      await this.convertAudioToWav(audioFilePath, convertedAudioPath)

      // 4. Transcribe using STT
      const sttResult = await this.sttService.transcribeAudio(
        convertedAudioPath,
        {
          languageCode: options.languageCode || 'th-TH',
        }
      )

      return {
        transcript: sttResult.transcript,
        confidence: sttResult.confidence,
        audioFilePath,
        convertedAudioPath,
      }
    } catch (error) {
      // Cleanup on error
      if (audioFilePath) {
        try {
          await fs.unlink(audioFilePath)
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
      if (convertedAudioPath) {
        try {
          await fs.unlink(convertedAudioPath)
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
      throw error
    }
  }

  async cleanupAudioFiles(
    audioFilePath: string,
    convertedAudioPath: string
  ): Promise<void> {
    try {
      if (audioFilePath) {
        await fs.unlink(audioFilePath)
      }
    } catch (error) {
      console.error('Error deleting temporary audio file:', error)
    }

    try {
      if (convertedAudioPath) {
        await fs.unlink(convertedAudioPath)
      }
    } catch (error) {
      console.error('Error deleting temporary converted file:', error)
    }
  }
}

