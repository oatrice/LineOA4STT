import { SpeechClient, protos } from '@google-cloud/speech'
import { promises as fs } from 'fs'

const AudioEncoding = protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding

export interface STTResult {
  transcript: string
  confidence: number
}

export interface STTConfig {
  languageCode?: string
  sampleRateHertz?: number
  encoding?: protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding
}

export class STTService {
  private speechClient: SpeechClient

  constructor() {
    this.speechClient = new SpeechClient()
  }

  async transcribeAudio(
    audioFilePath: string,
    config: STTConfig = {}
  ): Promise<STTResult> {
    const audioBuffer = await fs.readFile(audioFilePath)

    const audio = {
      content: audioBuffer.toString('base64'),
    }

    const recognitionConfig = {
      encoding: config.encoding || AudioEncoding.LINEAR16,
      sampleRateHertz: config.sampleRateHertz || 16000,
      languageCode: config.languageCode || 'th-TH',
    }

    const request: protos.google.cloud.speech.v1.IRecognizeRequest = {
      audio: audio,
      config: recognitionConfig,
    }

    const [response] = await this.speechClient.recognize(request)

    const transcript =
      response.results
        ?.map((result) => result.alternatives?.[0]?.transcript)
        .join('\n') || ''

    const confidence =
      response.results?.[0]?.alternatives?.[0]?.confidence || 0

    return {
      transcript,
      confidence,
    }
  }

  async transcribeAudioBuffer(
    audioBuffer: Buffer,
    config: STTConfig = {}
  ): Promise<STTResult> {
    const audio = {
      content: audioBuffer.toString('base64'),
    }

    const recognitionConfig = {
      encoding: config.encoding || AudioEncoding.LINEAR16,
      sampleRateHertz: config.sampleRateHertz || 16000,
      languageCode: config.languageCode || 'th-TH',
    }

    const request: protos.google.cloud.speech.v1.IRecognizeRequest = {
      audio: audio,
      config: recognitionConfig,
    }

    const [response] = await this.speechClient.recognize(request)

    const transcript =
      response.results
        ?.map((result) => result.alternatives?.[0]?.transcript)
        .join('\n') || ''

    const confidence =
      response.results?.[0]?.alternatives?.[0]?.confidence || 0

    return {
      transcript,
      confidence,
    }
  }
}

