import * as sdk from 'microsoft-cognitiveservices-speech-sdk'
import { SpeechClient, protos } from '@google-cloud/speech'
import { Buffer } from 'node:buffer'

const GoogleAudioEncoding = protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding

export interface STTResult {
  transcript: string
  confidence: number
  provider: 'azure' | 'google'
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
    // In Bun/Node.js, credentials are typically supplied via environment variables.
    const azureSpeechKey = Bun.env.AZURE_SPEECH_KEY
    const azureSpeechRegion = Bun.env.AZURE_SPEECH_REGION

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

    // For Google Cloud, the SDK typically uses GOOGLE_APPLICATION_CREDENTIALS.
    // In a serverless environment, this should be the JSON content of the service account key.
    const googleCredentialsJson = Bun.env.GOOGLE_CREDENTIALS_JSON
    if (googleCredentialsJson) {
      try {
        const credentials = JSON.parse(googleCredentialsJson)
        this.googleSpeechClient = new SpeechClient({ credentials })
        console.log('✅ Google Cloud Speech Service initialized.')
      } catch (e) {
        console.error("❌ Failed to parse GOOGLE_CREDENTIALS_JSON:", e)
      }
    } else {
      console.warn('⚠️ GOOGLE_CREDENTIALS_JSON not found. Google Cloud STT will not be available.')
    }

    if (!this.azureSpeechConfig && !this.googleSpeechClient) {
      // This is not a fatal error at startup, but transcribe calls will fail.
      console.error('❌ No STT service configured. Please set Azure or Google Cloud credentials in environment variables.')
    }
  }

  async transcribeAudioBuffer(
    audioBuffer: Uint8Array,
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
          recognizer.canceled = (s: sdk.Recognizer, e: sdk.SpeechRecognitionCanceledEventArgs) => {
            console.error(`Azure STT CANCELED: Reason=${e.reason}`)
            if (e.reason === sdk.CancellationReason.Error) {
              console.error(`Azure STT CANCELED: ErrorCode=${e.errorCode}`)
              console.error(`Azure STT CANCELED: ErrorDetails=${e.errorDetails}`)
              reject(new Error(`Azure STT Canceled: ${e.errorDetails}`))
            }
            recognizer.close()
          }

          recognizer.sessionStopped = (s: sdk.Recognizer, e: sdk.SessionEventArgs) => {
            console.log('Azure STT Session stopped event.')
            recognizer.close()
          }

          recognizer.recognizeOnceAsync(
            (result: sdk.SpeechRecognitionResult) => {
              if (result.reason === sdk.ResultReason.RecognizedSpeech) {
                console.log(`[STTService] Azure recognized speech: ${result.text}`)
                const transcript = result.text
                const confidence = 0.9 // Placeholder confidence for Azure
                resolve({ transcript, confidence, provider: 'azure' })
              } else if (result.reason === sdk.ResultReason.NoMatch) {
                console.log('[STTService] Azure returned NoMatch.')
                resolve({ transcript: '', confidence: 0, provider: 'azure' })
              } else {
                reject(new Error(`Azure STT failed: ${result.reason}, details: ${result.errorDetails}`))
              }
              recognizer.close();
            },
            (err: string) => {
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
          content: Buffer.from(audioBuffer).toString('base64'),
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
        return { transcript, confidence, provider: 'google' }
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
