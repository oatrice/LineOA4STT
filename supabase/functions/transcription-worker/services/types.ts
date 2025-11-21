export interface TranscriptionJob {
  id: string
  message_id: string
  user_id: string | null
  group_id: string | null
  room_id: string | null
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  created_at: string
  processing_started_at: string | null
  completed_at: string | null
  transcript: string | null
  confidence: number | null
  provider: 'azure' | 'google' | null
  audio_file_path: string | null
  error_message: string | null
}

export interface UpdateJobParams {
  status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  processing_started_at?: string
  completed_at?: string
  transcript?: string | null
  confidence?: number | null
  provider?: 'azure' | 'google' | null
  audio_file_path?: string | null
  error_message?: string | null
}

export interface STTResult {
  transcript: string
  confidence: number
  provider: 'azure' | 'google'
}

export interface STTConfig {
  languageCode?: string
  sampleRateHertz?: number // Required for Google STT
  encoding?: number // Use number for Deno, as protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding is from npm package
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
