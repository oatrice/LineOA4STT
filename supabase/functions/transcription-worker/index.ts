import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';
import { Client as LineClient } from 'npm:@line/bot-sdk';
import { AudioService } from './services/audioService.ts'; // Deno-compatible AudioService
import { STTService } from './services/sttService.ts'; // Deno-compatible STTService
import { JobService } from './services/jobService.ts'; // Deno-compatible JobService
import type { TranscriptionJob, UpdateJobParams } from './services/jobService.ts';

// Define a reasonable concurrency limit to avoid overwhelming the system
const MAX_CONCURRENT_JOBS = 5;

// Helper function to initialize services for worker execution in Deno
function initializeDenoWorkerServices(
  supabaseUrl: string,
  supabaseAnonKey: string,
  lineChannelAccessToken: string,
  lineChannelSecret: string
) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const lineClient = new LineClient({ channelAccessToken: lineChannelAccessToken, channelSecret: lineChannelSecret });
  const sttService = new STTService(); // Deno-compatible STTService
  const audioService = new AudioService(lineClient, sttService); // Deno-compatible AudioService
  const jobService = new JobService(supabase);
  return { supabase, lineClient, sttService, audioService, jobService };
}

// Helper function to process a single transcription job in Deno
async function processDenoJob(
  job: TranscriptionJob,
  services: ReturnType<typeof initializeDenoWorkerServices>
): Promise<void> {
  const { jobService, audioService, lineClient } = services;
  console.log(`[Worker] Processing job: ${job.id} (Message ID: ${job.message_id})`);

  let updateParams: UpdateJobParams = { status: 'FAILED' };
  let audioFilePath: string | undefined;
  let convertedAudioPath: string | undefined;

  try {
    await jobService.updateJob(job.id, { status: 'PROCESSING' });

    const result = await audioService.processAudio(job.message_id, {
      languageCode: 'th-TH',
    });

    audioFilePath = result.audioFilePath;
    convertedAudioPath = result.convertedAudioPath;

    await sendTranscriptionResult(job, result, lineClient);

    updateParams = {
      status: 'COMPLETED',
      transcript: result.transcript,
      confidence: result.confidence,
      provider: result.provider,
      audio_file_path: result.audioFilePath,
      completed_at: new Date().toISOString(),
    };
    await jobService.updateJob(job.id, updateParams);

    console.log(`[Worker] Successfully processed job: ${job.id}. Transcript: "${result.transcript.substring(0, 50)}..."`);
  } catch (error) {
    console.error(`[Worker] Error processing job ${job.id}:`, error);
    updateParams = {
      status: 'FAILED',
      error_message: error instanceof Error ? error.message : 'Unknown error',
      completed_at: new Date().toISOString(),
    };
    await jobService.updateJob(job.id, updateParams);
    await sendErrorMessage(job, error instanceof Error ? error.message : 'Unknown error', lineClient);
    throw error;
  } finally {
    if (audioFilePath && convertedAudioPath) {
      try {
        await audioService.cleanupAudioFiles(audioFilePath, convertedAudioPath);
      } catch (cleanupError) {
        console.warn(`[Worker] Failed to cleanup audio files for job ${job.id}:`, cleanupError);
      }
    }
  }
}

// Helper function to send transcription result back to user (Deno-compatible)
async function sendTranscriptionResult(
  job: TranscriptionJob,
  result: { transcript: string; confidence: number },
  lineClient: LineClient
) {
  try {
    let displayName = 'ผู้ใช้';
    if (job.group_id && job.user_id) {
      try {
        const memberProfile = await lineClient.getGroupMemberProfile(job.group_id, job.user_id);
        displayName = memberProfile.displayName;
      } catch (error) {
        console.error(`Failed to get group member profile for user ${job.user_id} in group ${job.group_id}:`, error);
      }
    } else if (job.room_id && job.user_id) {
      try {
        const memberProfile = await lineClient.getRoomMemberProfile(job.room_id, job.user_id);
        displayName = memberProfile.displayName;
      } catch (error) {
        console.error(`Failed to get room member profile for user ${job.user_id} in room ${job.room_id}:`, error);
      }
    } else if (job.user_id) {
      try {
        const userProfile = await lineClient.getProfile(job.user_id);
        displayName = userProfile.displayName;
      } catch (error) {
        console.error(`Failed to get profile for user ${job.user_id}:`, error);
      }
    }

    const messageTime = new Date(job.created_at || new Date());
    const timeString = messageTime.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Bangkok',
    });

    let to: string | undefined;
    if (job.group_id) {
      to = job.group_id;
    } else if (job.room_id) {
      to = job.room_id;
    } else if (job.user_id) {
      to = job.user_id;
    }

    if (!to) {
      console.error(`❌ No valid destination found for job ${job.id}. Cannot send reply.`);
      return;
    }

    console.log(`✉️ Sending transcription result using push_message to ${to}`);
    await lineClient.pushMessage(to, {
      type: 'text',
      text: `✨ เสร็จแล้วครับ!\n\nจาก: ${displayName}\nข้อความเมื่อ ${timeString}\nผลลัพธ์: ${result.transcript}`,
    });
  } catch (error) {
    console.error(`Failed to send transcription result for job ${job.id}:`, error);
    throw error;
  }
}

// Helper function to send error message to user (Deno-compatible)
async function sendErrorMessage(
  job: TranscriptionJob,
  errorMessage: string,
  lineClient: LineClient
) {
  try {
    console.log('😢 Trying to send error message to user via push message...');
    const errorText = `ขออภัยครับ เกิดข้อผิดพลาดในการประมวลผล: ${errorMessage} 🙏`;

    let to: string | undefined;
    if (job.group_id) {
      to = job.group_id;
    } else if (job.room_id) {
      to = job.room_id;
    } else if (job.user_id) {
      to = job.user_id;
    }

    if (to) {
      await lineClient.pushMessage(to, {
        type: 'text',
        text: errorText,
      });
    }
  } catch (error) {
    console.error('❌ Failed to send error message in worker:', error);
  }
}

// Main worker function for Deno, designed to be called by a Supabase Edge Function (Scheduled Job)
async function runDenoWorker(
  services: ReturnType<typeof initializeDenoWorkerServices>
): Promise<{ status: number; message: string }> {
  const { jobService } = services;
  console.log('Worker starting to process pending jobs...');

  try {
    const jobs = await jobService.getJobsForWorker(MAX_CONCURRENT_JOBS);

    if (!jobs || jobs.length === 0) {
      console.log('No pending or timed-out processing jobs found. Worker exiting.');
      return { status: 200, message: 'No pending jobs to process.' };
    }

    console.log(`Found ${jobs.length} pending or timed-out processing jobs.`);

    const results = await Promise.allSettled(
      jobs.map((job) => processDenoJob(job, services))
    );

    let processedCount = 0;
    let failedCount = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        processedCount++;
      } else {
        failedCount++;
        if (jobs && jobs[index]) {
          console.error(`Job ${jobs[index].id} failed to process:`, result.reason);
        } else {
          console.error(`An unknown job failed to process:`, result.reason);
        }
      }
    });

    console.log(
      `Job processing round finished. Successfully processed: ${processedCount}, Failed: ${failedCount}`,
    );
    return {
      status: 200,
      message: `Processed ${processedCount} jobs, ${failedCount} failed.`,
    };
  } catch (err) {
    console.error('An unexpected error occurred during worker execution:', err);
    return {
      status: 500,
      message: `Worker encountered an unhandled error: ${err instanceof Error ? err.message : 'Unknown error'
        }`,
    };
  }
}

console.log('Supabase Edge Function for Transcription Worker starting up...');

serve(async (req: Request) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
    const LINE_CHANNEL_SECRET = Deno.env.get('LINE_CHANNEL_SECRET');

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !LINE_CHANNEL_ACCESS_TOKEN || !LINE_CHANNEL_SECRET) {
      throw new Error('Missing required environment variables for the worker.');
    }

    const services = initializeDenoWorkerServices(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      LINE_CHANNEL_ACCESS_TOKEN,
      LINE_CHANNEL_SECRET
    );

    const result = await runDenoWorker(services);

    return new Response(JSON.stringify(result), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Unhandled error in Supabase Edge Function:', error);
    return new Response(
      JSON.stringify({
        message: `Edge function failed: ${(error instanceof Error) ? error.message : 'Unknown error'}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
