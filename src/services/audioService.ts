import { type Client } from 'npm:@line/bot-sdk'
import { Buffer } from 'https://deno.land/std@0.177.0/io/buffer.ts'
import * as fs from 'https://deno.land/std@0.177.0/fs/mod.ts'
import * as path from 'https://deno.land/std@0.177.0/path/mod.ts'
import { STTService } from './sttService.ts'
import type { STTResult } from './sttService.ts'

// Helper function to convert a ReadableStream to a Buffer
async function streamToBuffer(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(value)
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const buffer = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.length
  }
  return buffer
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

  async downloadAudio(messageId: string): Promise<Uint8Array> {
    const contentStream = await this.lineClient.getMessageContent(messageId)
    // The LINE SDK for Node returns a Node stream, but in Deno context, we expect a Web API ReadableStream.
    // Assuming the SDK adapts or we're using a Deno-compatible version.
    // If it returns a raw response body, it would be a ReadableStream.
    return await streamToBuffer(contentStream as unknown as ReadableStream)
  }

  async saveAudioFile(messageId: string, audioBuffer: Uint8Array): Promise<string> {
    await fs.mkdir(this.tempDir, { recursive: true })
    const audioFilePath = path.join(this.tempDir, `${messageId}.m4a`)
    await fs.writeFile(audioFilePath, audioBuffer)
    return audioFilePath
  }

  async convertAudioToWav(
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    // IMPORTANT: Spawning subprocesses like ffmpeg is not supported in Supabase Edge Functions.
    // This function will fail at runtime. The audio conversion logic must be handled
    // outside the Edge Function, for example, in your main web service before creating the job,
    // or by another dedicated service.
    console.error("FATAL: ffmpeg execution is not supported in this environment.")
    throw new Error("Audio conversion via ffmpeg is not supported in Supabase Edge Functions.")
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
      const audioBufferForStt = await Deno.readFile(convertedAudioPath)
      const sttResult = await this.sttService.transcribeAudioBuffer(
        audioBufferForStt,
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
