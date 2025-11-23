import * as sdk from 'microsoft-cognitiveservices-speech-sdk'
import { SpeechClient, protos } from '@google-cloud/speech'
import * as fs from 'fs'
import { Buffer } from 'buffer'
import * as path from 'path'

const GoogleAudioEncoding = protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding

export interface STTResult {
  transcript: string
  confidence: number
  provider: 'azure' | 'google'
  isFallback: boolean
}

export interface STTConfig {
  languageCode?: string
  sampleRateHertz?: number // Required for Google STT
  encoding?: protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding // Required for Google STT
}

export class STTService {
  private azureSpeechConfig: sdk.SpeechConfig | null = null
  private googleSpeechClient: SpeechClient | null = null

  constructor() {
    let azureSpeechKey: string | undefined
    const azureSpeechRegion = process.env.AZURE_SPEECH_REGION

    // Try to read AZURE_SPEECH_KEY from a secret file
    const secretFilePath = process.env.AZURE_SPEECH_KEY_FILE || '/etc/secrets/AZURE_SPEECH_KEY'
    try {
      if (fs.existsSync(secretFilePath)) {
        azureSpeechKey = fs.readFileSync(secretFilePath, 'utf-8').trim()
        console.log(`✅ Azure Speech Key loaded from secret file: ${secretFilePath}`)
      }
    } catch (error) {
      console.warn(`⚠️ Could not read Azure Speech Key from secret file ${secretFilePath}:`, error)
    }

    // Fallback to environment variable if not found in file
    if (!azureSpeechKey) {
      azureSpeechKey = process.env.AZURE_SPEECH_KEY
      if (azureSpeechKey) {
        console.log('✅ Azure Speech Key loaded from environment variable.')
      }
    }

    if (azureSpeechKey && azureSpeechRegion) {
      this.azureSpeechConfig = sdk.SpeechConfig.fromSubscription(
        azureSpeechKey,
        azureSpeechRegion
      )
      this.azureSpeechConfig.speechRecognitionLanguage = 'th-TH' // Default to Thai
      console.log('✅ Azure Speech Service initialized.')
    } else {
      console.warn('⚠️ Azure Speech Key or Region not found. Azure STT will not be available.')
    }

    // Initialize Google Cloud Speech Client
    // GOOGLE_APPLICATION_CREDENTIALS is typically set as an environment variable
    // The SpeechClient constructor will automatically pick it up.
    let googleApplicationCredentialsFile: string | undefined
    const googleCredentialsJsonPath = process.env.GOOGLE_CREDENTIALS_JSON_FILE || '/etc/secrets/GOOGLE_CREDENTIALS_JSON'
    try {
      if (fs.existsSync(googleCredentialsJsonPath)) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = googleCredentialsJsonPath
        console.log(`✅ Google Cloud Credentials loaded from secret file: ${googleCredentialsJsonPath}`)
      }
    } catch (error) {
      console.warn(`⚠️ Could not read Google Cloud Credentials from secret file ${googleCredentialsJsonPath}:`, error)
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      this.googleSpeechClient = new SpeechClient()
      console.log('✅ Google Cloud Speech Service initialized.')
    } else {
      console.warn('⚠️ GOOGLE_APPLICATION_CREDENTIALS not found. Google Cloud STT will not be available.')
    }

    if (!this.azureSpeechConfig && !this.googleSpeechClient) {
      throw new Error('No STT service configured. Please set Azure or Google Cloud credentials.')
    }
  }

  transcribeAudio(
    audioFilePath: string,
    config: STTConfig = {}
  ): Promise<STTResult> {
    const audioBuffer = fs.readFileSync(audioFilePath)
    return this.transcribeAudioBuffer(audioBuffer, config)
  }

  async transcribeAudioBuffer(
    audioBuffer: Buffer,
    config: STTConfig = {}
  ): Promise<STTResult> {
    let azureResult: STTResult | null = null
    let azureError: Error | null = null

    // 1. Try Azure AI Speech (Primary)
    if (this.azureSpeechConfig) {
      try {
        console.log('[STTService] Attempting transcription with Azure AI Speech...')
        const pushStream = sdk.AudioInputStream.createPushStream();
        const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

        const currentAzureSpeechConfig = this.azureSpeechConfig // Use a local variable for config
        if (config.languageCode) {
          currentAzureSpeechConfig.speechRecognitionLanguage = config.languageCode
        }

        const recognizer = new sdk.SpeechRecognizer(currentAzureSpeechConfig, audioConfig)

        azureResult = await new Promise<STTResult>((resolve, reject) => {
          recognizer.canceled = (s, e) => {
            console.error(`Azure STT CANCELED: Reason=${e.reason}`)
            if (e.reason === sdk.CancellationReason.Error) {
              console.error(`Azure STT CANCELED: ErrorCode=${e.errorCode}`)
              console.error(`Azure STT CANCELED: ErrorDetails=${e.errorDetails}`)
              reject(new Error(`Azure STT Canceled: ${e.errorDetails}`))
            }
            recognizer.close()
          }

          recognizer.sessionStopped = (s, e) => {
            console.log('Azure STT Session stopped event.')
            recognizer.close()
          }

          recognizer.recognizeOnceAsync(
            (result) => {
              if (result.reason === sdk.ResultReason.RecognizedSpeech) {
                console.log(`[STTService] Azure recognized speech: ${result.text}`)
                const transcript = result.text
                const confidence = 0.9 // Placeholder confidence for Azure
                resolve({ transcript, confidence, provider: 'azure', isFallback: false })
              } else if (result.reason === sdk.ResultReason.NoMatch) {
                console.log('[STTService] Azure returned NoMatch.')
                resolve({ transcript: '', confidence: 0, provider: 'azure', isFallback: false })
              } else {
                reject(new Error(`Azure STT failed: ${result.reason}, details: ${result.errorDetails}`))
              }
              recognizer.close();
            },
            (err) => {
              reject(new Error(`Azure STT Error: ${err}`))
              recognizer.close();
            }
          );

          const arrayBuffer = new Uint8Array(audioBuffer).buffer
          pushStream.write(arrayBuffer)
          pushStream.close()

        })
        console.log('✅ Azure STT successful.')
        return azureResult
      } catch (error) {
        azureError = error instanceof Error ? error : new Error(String(error))
        console.error('❌ Azure STT failed:', azureError.message)
      }
    } else {
      console.warn('⚠️ Azure STT not configured, skipping primary transcription attempt.')
    }

    // 2. Fallback to Google Cloud STT if Azure failed or not configured
    if (this.googleSpeechClient) {
      console.log('[STTService] 🔄 Falling back to Google Cloud STT...')
      try {
        const audio = {
          content: audioBuffer.toString('base64'),
        }

        const recognitionConfig = {
          encoding: config.encoding || GoogleAudioEncoding.LINEAR16,
          sampleRateHertz: config.sampleRateHertz || 16000,
          languageCode: config.languageCode || 'th-TH',
        }

        const request: protos.google.cloud.speech.v1.IRecognizeRequest = {
          audio: audio,
          config: recognitionConfig,
        }

        console.log('[STTService] Sending request to Google Cloud STT...')
        const [response] = await this.googleSpeechClient.recognize(request)
        console.log('[STTService] Received response from Google Cloud STT.')

        const transcript =
          response.results
            ?.map((result) => result.alternatives?.[0]?.transcript)
            .join('\n') || ''

        const confidence =
          response.results?.[0]?.alternatives?.[0]?.confidence || 0

        console.log('✅ Google Cloud STT successful.')
        // Determine if this was a fallback
        const isFallback = !!(this.azureSpeechConfig && azureError);
        return { transcript, confidence, provider: 'google', isFallback }
      } catch (error) {
        const googleError = error instanceof Error ? error : new Error(String(error))
        console.error('❌ Google Cloud STT failed:', googleError.message)
        throw new Error(`Both Azure and Google STT failed. Azure Error: ${azureError?.message || 'N/A'}, Google Error: ${googleError.message}`)
      }
    } else {
      console.warn('⚠️ Google Cloud STT not configured, skipping fallback transcription attempt.')
      if (azureError) {
        throw new Error(`Azure STT failed and Google STT not configured. Azure Error: ${azureError.message}`)
      }
    }

    // If neither service is configured or both failed
    throw new Error('No active STT service could transcribe the audio.')
  }
}
