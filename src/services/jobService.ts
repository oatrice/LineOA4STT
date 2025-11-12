import { SupabaseClient } from '@supabase/supabase-js'

export interface TranscriptionJob {
  id: string
  message_id: string
  user_id: string
  reply_token?: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  transcript?: string
  confidence?: number
  provider?: string
  audio_file_path?: string
  error_message?: string
  created_at?: string
  updated_at?: string
  completed_at?: string
}

export interface CreateJobParams {
  messageId: string
  userId: string
  replyToken?: string
}

export interface UpdateJobParams {
  status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  transcript?: string
  confidence?: number
  provider?: string
  audio_file_path?: string
  error_message?: string
  completed_at?: string
}

export class JobService {
  constructor(private supabase: SupabaseClient) {}

  async createJob(params: CreateJobParams): Promise<TranscriptionJob> {
    const { data, error } = await this.supabase
      .from('transcription_jobs')
      .insert({
        message_id: params.messageId,
        user_id: params.userId,
        reply_token: params.replyToken,
        status: 'PENDING',
      })
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to create job: ${error.message}`)
    }

    return data as TranscriptionJob
  }

  async updateJob(jobId: string, params: UpdateJobParams): Promise<void> {
    const { error } = await this.supabase
      .from('transcription_jobs')
      .update(params)
      .eq('id', jobId)

    if (error) {
      throw new Error(`Failed to update job: ${error.message}`)
    }
  }

  async getJob(jobId: string): Promise<TranscriptionJob | null> {
    const { data, error } = await this.supabase
      .from('transcription_jobs')
      .select()
      .eq('id', jobId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return null // Not found
      }
      throw new Error(`Failed to get job: ${error.message}`)
    }

    return data as TranscriptionJob
  }

  async getPendingJobs(limit: number = 10): Promise<TranscriptionJob[]> {
    const { data, error } = await this.supabase
      .from('transcription_jobs')
      .select()
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) {
      throw new Error(`Failed to get pending jobs: ${error.message}`)
    }

    return (data || []) as TranscriptionJob[]
  }
}

