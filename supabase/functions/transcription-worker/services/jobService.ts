import { type SupabaseClient } from 'npm:@supabase/supabase-js'
import { type TranscriptionJob, type UpdateJobParams } from './types.ts'

export class JobService {
  private supabase: SupabaseClient

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  async getJobsForWorker(limit: number): Promise<TranscriptionJob[] | null> {
    const { data, error } = await this.supabase
      .from('transcription_jobs')
      .select('*')
      .in('status', ['PENDING', 'PROCESSING']) // Include PROCESSING to retry timed-out jobs
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) {
      console.error('Error fetching jobs:', error.message)
      throw new Error(`Failed to fetch jobs: ${error.message}`)
    }

    // Mark jobs as PROCESSING to prevent other workers from picking them up
    // Note: This is a basic approach. For robust locking, consider using
    // database transactions or a dedicated locking mechanism.
    if (data && data.length > 0) {
      const jobIds = data.map(job => job.id);
      const { error: updateError } = await this.supabase
        .from('transcription_jobs')
        .update({ status: 'PROCESSING', processing_started_at: new Date().toISOString() })
        .in('id', jobIds);

      if (updateError) {
        console.error('Error updating job status to PROCESSING:', updateError.message);
        // Depending on desired behavior, you might throw or just log and proceed with original data
        throw new Error(`Failed to update job status: ${updateError.message}`);
      }
      console.log(`Updated ${jobIds.length} jobs to PROCESSING status.`);
    }

    return data
  }

  async createJob(params: Omit<TranscriptionJob, 'id' | 'created_at' | 'status'>): Promise<TranscriptionJob> {
    const { data, error } = await this.supabase
      .from('transcription_jobs')
      .insert({
        ...params,
        status: 'PENDING',
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating job:', error.message)
      throw new Error(`Failed to create job: ${error.message}`)
    }
    return data
  }

  async updateJob(
    jobId: string,
    params: UpdateJobParams
  ): Promise<TranscriptionJob> {
    const { data, error } = await this.supabase
      .from('transcription_jobs')
      .update(params)
      .eq('id', jobId)
      .select()
      .single()

    if (error) {
      console.error(`Error updating job ${jobId}:`, error.message)
      throw new Error(`Failed to update job ${jobId}: ${error.message}`)
    }
    return data
  }
}
