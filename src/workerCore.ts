import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Client as LineClient } from '@line/bot-sdk'
import { AudioService } from './services/audioService'
import { STTService } from './services/sttService'
import { JobService, type TranscriptionJob, type UpdateJobParams } from './services/jobService'

// Define a reasonable concurrency limit to avoid overwhelming the system
const MAX_CONCURRENT_JOBS = 5

/**
 * Initialize services for worker execution
 */
export function initializeWorkerServices(
  supabaseUrl: string,
  supabaseAnonKey: string,
  lineChannelAccessToken: string
) {
  // Initialize Supabase Client
  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey)

  // Initialize Line Client
  const lineClient = new LineClient({
    channelAccessToken: lineChannelAccessToken,
  })

  // Initialize Services
  const sttService = new STTService()
  const audioService = new AudioService(lineClient, sttService)
  const jobService = new JobService(supabase)

  return { supabase, lineClient, sttService, audioService, jobService }
}

/**
 * Processes a single transcription job.
 * @param job The transcription job to process.
 * @param services Worker services instance
 */
export async function processJob(
  job: TranscriptionJob,
  services: ReturnType<typeof initializeWorkerServices>
): Promise<void> {
  const { jobService, audioService, lineClient } = services
  console.log(`[Worker] Processing job: ${job.id} (Message ID: ${job.message_id})`)

  let updateParams: UpdateJobParams = { status: 'FAILED' } // Default to FAILED
  let audioFilePath: string | undefined
  let convertedAudioPath: string | undefined

  try {
    // 1. Update job status to PROCESSING
    await jobService.updateJob(job.id, { status: 'PROCESSING' })

    // 2. Process audio (download, convert, transcribe)
    const result = await audioService.processAudio(job.message_id, {
      languageCode: 'th-TH',
    })

    audioFilePath = result.audioFilePath
    convertedAudioPath = result.convertedAudioPath

    // 3. Send result back to user via LINE
    await sendTranscriptionResult(job, result, lineClient)

    // 4. Update job with transcription results
    updateParams = {
      status: 'COMPLETED',
      transcript: result.transcript,
      confidence: result.confidence,
      provider: result.provider,
      audio_file_path: result.audioFilePath,
      completed_at: new Date().toISOString(),
    }
    await jobService.updateJob(job.id, updateParams)

    console.log(`[Worker] Successfully processed job: ${job.id}. Transcript: "${result.transcript.substring(0, 50)}..."`)
  } catch (error) {
    console.error(`[Worker] Error processing job ${job.id}:`, error)
    updateParams = {
      status: 'FAILED',
      error_message: error instanceof Error ? error.message : 'Unknown error',
      completed_at: new Date().toISOString(),
    }
    await jobService.updateJob(job.id, updateParams)
    
    // Send error message to user
    await sendErrorMessage(job, error instanceof Error ? error.message : 'Unknown error', lineClient)
    throw error // Re-throw to signal individual job failure
  } finally {
    // 5. Clean up temporary audio files
    if (audioFilePath && convertedAudioPath) {
      try {
        await audioService.cleanupAudioFiles(audioFilePath, convertedAudioPath)
      } catch (cleanupError) {
        console.warn(`[Worker] Failed to cleanup audio files for job ${job.id}:`, cleanupError)
      }
    }
  }
}

/**
 * Send transcription result back to user
 */
async function sendTranscriptionResult(
  job: TranscriptionJob,
  result: { transcript: string; confidence: number },
  lineClient: LineClient
) {
  try {
    // Get user profile for personalized message
    let displayName = 'ผู้ใช้'
    if (job.group_id && job.user_id) {
      try {
        const memberProfile = await lineClient.getGroupMemberProfile(job.group_id, job.user_id)
        displayName = memberProfile.displayName
      } catch (error) {
        console.error(`Failed to get group member profile for user ${job.user_id} in group ${job.group_id}:`, error)
      }
    } else if (job.room_id && job.user_id) {
      try {
        const memberProfile = await lineClient.getRoomMemberProfile(job.room_id, job.user_id)
        displayName = memberProfile.displayName
      } catch (error) {
        console.error(`Failed to get room member profile for user ${job.user_id} in room ${job.room_id}:`, error)
      }
    } else if (job.user_id) {
      try {
        const userProfile = await lineClient.getProfile(job.user_id)
        displayName = userProfile.displayName
      } catch (error) {
        console.error(`Failed to get profile for user ${job.user_id}:`, error)
      }
    }

    // Format timestamp
    const messageTime = new Date(job.created_at || new Date())
    const timeString = messageTime.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Bangkok',
    })

    // Determine destination
    let to: string | undefined
    if (job.group_id) {
      to = job.group_id
    } else if (job.room_id) {
      to = job.room_id
    } else if (job.user_id) {
      to = job.user_id
    }

    if (!to) {
      console.error(`❌ No valid destination found for job ${job.id}. Cannot send reply.`)
      return
    }

    // Send result using push_message
    console.log(`✉️ Sending transcription result using push_message to ${to}`)
    await lineClient.pushMessage(to, {
      type: 'text',
      text: `✨ เสร็จแล้วครับ!\n\nจาก: ${displayName}\nข้อความเมื่อ ${timeString}\nผลลัพธ์: ${result.transcript}`,
    })
  } catch (error) {
    console.error(`Failed to send transcription result for job ${job.id}:`, error)
    throw error
  }
}

/**
 * Send error message to user
 */
async function sendErrorMessage(
  job: TranscriptionJob,
  errorMessage: string,
  lineClient: LineClient
) {
  try {
    console.log('😢 Trying to send error message to user via push message...')
    const errorText = `ขออภัยครับ เกิดข้อผิดพลาดในการประมวลผล: ${errorMessage} 🙏`

    let to: string | undefined
    if (job.group_id) {
      to = job.group_id
    } else if (job.room_id) {
      to = job.room_id
    } else if (job.user_id) {
      to = job.user_id
    }

    if (to) {
      await lineClient.pushMessage(to, {
        type: 'text',
        text: errorText,
      })
    }
  } catch (error) {
    console.error('❌ Failed to send error message in worker:', error)
  }
}

/**
 * Fetches and processes pending transcription jobs in a one-shot execution.
 * This function is designed to be called by a Supabase Edge Function (Scheduled Job).
 */
export async function runWorker(
  services: ReturnType<typeof initializeWorkerServices>
): Promise<{ status: number; message: string }> {
  const { jobService } = services
  console.log('Worker starting to process pending jobs...')

  try {
    const jobs = await jobService.getJobsForWorker(MAX_CONCURRENT_JOBS)

    if (!jobs || jobs.length === 0) {
      console.log('No pending or timed-out processing jobs found. Worker exiting.')
      return { status: 200, message: 'No pending jobs to process.' }
    }

    console.log(`Found ${jobs.length} pending or timed-out processing jobs.`)

    // Process jobs in parallel with Promise.allSettled to handle individual failures
    const results = await Promise.allSettled(
      jobs.map((job) => processJob(job, services))
    )

    let processedCount = 0
    let failedCount = 0
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        processedCount++
      } else {
        failedCount++
        if (jobs && jobs[index]) {
          console.error(`Job ${jobs[index].id} failed to process:`, result.reason)
        } else {
          console.error(`An unknown job failed to process:`, result.reason)
        }
      }
    })

    console.log(
      `Job processing round finished. Successfully processed: ${processedCount}, Failed: ${failedCount}`,
    )
    return {
      status: 200,
      message: `Processed ${processedCount} jobs, ${failedCount} failed.`,
    }
  } catch (err) {
    console.error('An unexpected error occurred during worker execution:', err)
    // For Edge Functions, return an error status
    return {
      status: 500,
      message: `Worker encountered an unhandled error: ${err instanceof Error ? err.message : 'Unknown error'
        }`,
    }
  }
}
