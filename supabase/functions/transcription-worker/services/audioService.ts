import { type Client } from 'npm:@line/bot-sdk'
import { STTService } from './sttService.ts'
import {
  type AudioProcessingOptions,
  type AudioProcessingResult,
  type STTResult,
} from './types.ts'

// Helper function to convert a Deno.Reader to a Uint8Array
async function readerToUint8Array(reader: Deno.Reader): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let totalLength = 0
  for await (const chunk of Deno.iter(reader)) {
    chunks.push(chunk)
    totalLength += chunk.length
  }
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

export class AudioService {
  private sttService: STTService
  private lineClient: Client
  private tempDir: string

  constructor(lineClient: Client, sttService: STTService) {
    this.lineClient = lineClient
    this.sttService = sttService
    // Use Deno.makeTempDir for robust temporary directory management in Deno
    // For Supabase Edge Functions, writing to disk is generally not recommended
    // as functions are stateless and have ephemeral storage.
    // However, if local temporary storage is strictly needed and supported,
    // we'd use something like /tmp.
    this.tempDir = Deno.env.get('TEMP_AUDIO_DIR') || '/tmp/audio'
  }

  async downloadAudio(messageId: string): Promise<Uint8Array> {
    try {
      const contentStream = await this.lineClient.getMessageContent(messageId)
      // The LINE SDK for Node returns a Node.js Readable stream.
      // Deno's Web Streams API is more compatible.
      // We need to convert Node.js Readable to Deno-compatible ReadableStream then to Uint8Array.
      // This conversion might be tricky in Deno directly if the SDK provides Node.js streams.
      // For Supabase Edge Functions, this interaction needs careful handling.
      // Assuming contentStream can be treated as a ReadableStream (web standard).
      return await readerToUint8Array(contentStream as Deno.Reader)
    } catch (error) {
      console.error(
        `[AudioService] Failed to download audio for messageId: ${messageId}.`
      )
      // The error from the line-bot-sdk is often an HTTPError wrapping an AxiosError.
      // We try to log the detailed error response from the API.
      // deno-lint-ignore no-explicit-any
      const originalError = (error as any).originalError
      if (originalError && originalError.response) {
        if (originalError.response.status === 400) {
          console.error(
            `[AudioService] LINE API Error 400 (Bad Request): This often means the messageId (${messageId}) is invalid, has expired, or is not for a downloadable media type.`,
            originalError.response.data
          )
        } else {
          console.error(
            '[AudioService] LINE API Error Response:',
            originalError.response.data
          )
        }
      } else {
        // Fallback for other error types
        console.error('[AudioService] Full error object:', error)
      }
      throw error // Re-throw the error to be handled by the caller
    }
  }

  async saveAudioFile(messageId: string, audioBuffer: Uint8Array): Promise<string> {
    await Deno.mkdir(this.tempDir, { recursive: true })
    const audioFilePath = `${this.tempDir}/${messageId}.m4a`
    await Deno.writeFile(audioFilePath, audioBuffer)
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
    // For the purpose of type checking, we'll keep the signature but emphasize it won't work.
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
      await Deno.mkdir(tempDir, { recursive: true })
      audioFilePath = `${tempDir}/${messageId}.m4a`
      console.log(`[AudioService] Saving audio to: ${audioFilePath}`)
      await Deno.writeFile(audioFilePath, audioBuffer)
      console.log(`[AudioService] Audio saved to: ${audioFilePath}`)

      // 3. Convert to WAV (This step will conceptually fail in Edge Functions)
      convertedAudioPath = `${tempDir}/${messageId}.wav`
      console.log(`[AudioService] Converting audio from ${audioFilePath} to ${convertedAudioPath}`)
      await this.convertAudioToWav(audioFilePath, convertedAudioPath)
      console.log(`[AudioService] Audio converted to: ${convertedAudioPath}`)

      // 4. Transcribe using STT
      console.log(`[AudioService] Transcribing audio using STTService for: ${convertedAudioPath}`)
      
      if (!convertedAudioPath) {
        throw new Error('convertedAudioPath is not defined before transcribing.')
      }
      
      const audioBufferForStt = await Deno.readFile(convertedAudioPath)
      const sttResult: STTResult = await this.sttService.transcribeAudioBuffer(
        audioBufferForStt,
        {
          languageCode: options.languageCode || 'th-TH',
        }
      )
      console.log(`[AudioService] STT transcription completed. Provider: ${sttResult.provider}`)

      if (!audioFilePath || !convertedAudioPath) {
        throw new Error('File paths were not generated correctly during processing.')
      }

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
      // Cleanup handled by caller
    }
  }

  async cleanupAudioFiles(
    audioFilePath: string,
    convertedAudioPath: string
  ): Promise<void> {
    try {
      if (audioFilePath) {
        await Deno.remove(audioFilePath)
        console.log(`🗑️ Deleted temporary audio file: ${audioFilePath}`)
      }
    } catch (error) {
      if ((error as Deno.errors.NotFound).name === 'NotFound') {
        console.warn(`⚠️ Temporary audio file not found, skipping deletion: ${audioFilePath}`)
      } else {
        console.error('❌ Error deleting temporary audio file:', error)
      }
    }

    try {
      if (convertedAudioPath) {
        await Deno.remove(convertedAudioPath)
        console.log(`🗑️ Deleted temporary converted file: ${convertedAudioPath}`)
      }
    } catch (error) {
      if ((error as Deno.errors.NotFound).name === 'NotFound') {
        console.warn(`⚠️ Temporary converted file not found, skipping deletion: ${convertedAudioPath}`)
      } else {
        console.error('❌ Error deleting temporary converted file:', error)
      }
    }
  }
}
