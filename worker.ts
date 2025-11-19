import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@line/bot-sdk';
import { JobService } from './src/services/jobService';
import { STTService } from './src/services/sttService';
import { AudioService } from './src/services/audioService';
import { promises as fs } from 'fs';
import * as path from 'path';

import type { TranscriptionJob } from './src/services/jobService';
import type { AudioProcessingResult } from './src/services/audioService';

const SECRET_FILES_PATH = process.env.LOCAL_SECRET_DIR || '/etc/secrets';
const TEMP_DIR = path.join(process.cwd(), 'temp');

// Helper to read secret from file or env
async function getSecret(filename: string, envVarName: string, fileEnvVarName: string): Promise<string | undefined> {
  let secret: string | undefined;
  // 1. Try to read from file path specified by environment variable (e.g., LOCAL_SECRET_DIR/filename or explicit _FILE env var)
  const explicitFileEnvPath = process.env[fileEnvVarName];
  if (explicitFileEnvPath) {
    try {
      secret = await fs.readFile(explicitFileEnvPath, 'utf8');
      console.log(`✅ Secret '${filename}' loaded from explicit file path env var: ${explicitFileEnvPath}`);
      return secret.trim();
    } catch (error) {
      console.warn(`⚠️ Could not read secret '${filename}' from explicit file path env var ${explicitFileEnvPath}:`, error);
    }
  }

  // 2. Try to read from default secret file path (SECRET_FILES_PATH/filename)
  secret = await readSecretFile(filename);
  if (secret) {
    console.log(`✅ Secret '${filename}' loaded from default secret file: ${path.join(SECRET_FILES_PATH, filename)}`);
    return secret.trim();
  }

  // 3. Fallback to direct environment variable
  secret = process.env[envVarName];
  if (secret) {
    console.log(`✅ Secret '${filename}' loaded from environment variable: ${envVarName}`);
    return secret.trim();
  }
  return undefined;
}

// Function to read secret files
async function readSecretFile(filename: string): Promise<string | undefined> {
  try {
    const filePath = path.join(SECRET_FILES_PATH, filename);
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    console.warn(`⚠️ Could not read secret file ${filename} from ${SECRET_FILES_PATH}:`, error);
    return undefined;
  }
}

async function initializeServices() {
  const LINE_CHANNEL_SECRET = (await getSecret(
    'LINE_CHANNEL_SECRET',
    'LINE_CHANNEL_SECRET',
    'LINE_CHANNEL_SECRET_FILE'
  )) || 'your-line-channel-secret';

  const LINE_CHANNEL_ACCESS_TOKEN = (await getSecret(
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LINE_CHANNEL_ACCESS_TOKEN_FILE'
  )) || '';

  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  console.log(`Worker SUPABASE_URL: ${SUPABASE_URL}`);

  const SUPABASE_ANON_KEY = (await getSecret(
    'SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY_FILE'
  )) || '';
  console.log(`Worker SUPABASE_ANON_KEY (first 5 chars): ${SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.substring(0, 5) : 'N/A'}`);

  // Handle Google Application Credentials
  let googleCredentialsPath: string | undefined;
  let googleCredentialsJsonContent: string | undefined;

  const explicitGoogleCredentialsFileEnvPath = process.env.GOOGLE_CREDENTIALS_JSON_FILE;
  if (explicitGoogleCredentialsFileEnvPath) {
    try {
      googleCredentialsJsonContent = await fs.readFile(explicitGoogleCredentialsFileEnvPath, 'utf8');
      console.log(`✅ Google Credentials loaded from explicit file path env var: ${explicitGoogleCredentialsFileEnvPath}`);
    } catch (error) {
      console.warn(`⚠️ Could not read Google Credentials from explicit file path env var ${explicitGoogleCredentialsFileEnvPath}:`, error);
    }
  }

  if (!googleCredentialsJsonContent) {
    googleCredentialsJsonContent = await readSecretFile('GOOGLE_CREDENTIALS_JSON');
    if (googleCredentialsJsonContent) {
      console.log(`✅ Google Credentials loaded from default secret file: ${path.join(SECRET_FILES_PATH, 'GOOGLE_CREDENTIALS_JSON')}`);
    }
  }

  if (!googleCredentialsJsonContent) {
    googleCredentialsJsonContent = process.env.GOOGLE_CREDENTIALS_JSON;
    if (googleCredentialsJsonContent) {
      console.log('✅ Google Credentials loaded from environment variable: GOOGLE_CREDENTIALS_JSON');
    }
  }

  if (googleCredentialsJsonContent) {
    try {
      await fs.mkdir(TEMP_DIR, { recursive: true });
      googleCredentialsPath = path.join(TEMP_DIR, 'google-credentials.json');
      await fs.writeFile(googleCredentialsPath, googleCredentialsJsonContent, 'utf8');
      process.env.GOOGLE_APPLICATION_CREDENTIALS = googleCredentialsPath;
      console.log('✅ Google Application Credentials set to temp file.');
    } catch (error) {
      console.error('❌ Error writing Google credentials to temp file:', error);
    }
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    googleCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    console.log('✅ Google Application Credentials set from existing environment variable.');
  } else {
    console.warn('⚠️ GOOGLE_APPLICATION_CREDENTIALS not found. STT service might fail.');
  }

  if (!LINE_CHANNEL_SECRET || !LINE_CHANNEL_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const missing = [];
    if (!LINE_CHANNEL_SECRET) missing.push('LINE_CHANNEL_SECRET');
    if (!LINE_CHANNEL_ACCESS_TOKEN) missing.push('LINE_CHANNEL_ACCESS_TOKEN');
    if (!SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY');
    throw new Error(`Missing required environment variables or secrets for worker: ${missing.join(', ')}. Please check your .env file or Render secrets.`);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const lineClient = new Client({ channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN });
  const jobService = new JobService(supabase);
  const sttService = new STTService();
  const audioService = new AudioService(lineClient, sttService);

  return { lineClient, jobService, sttService, audioService, lineChannelSecret: LINE_CHANNEL_SECRET };
}

// ฟังก์ชันสำหรับส่งข้อความแจ้งข้อผิดพลาด
async function sendErrorMessage(
  userId: string | undefined,
  groupId: string | undefined,
  roomId: string | undefined,
  errorMessage: string,
  lineClient: Client
) {
  try {
    console.log('😢 Trying to send error message to user via push message...');
    const errorText = `ขออภัยครับ เกิดข้อผิดพลาดในการประมวลผล: ${errorMessage} 🙏`;

    let to: string | undefined;
    if (groupId) {
      to = groupId;
    } else if (roomId) {
      to = roomId;
    } else if (userId) {
      to = userId;
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

// ฟังก์ชันสำหรับประมวลผลเสียงแบบ async (ย้ายมาจาก index.ts เพื่อให้ worker เรียกใช้ได้)
async function processAudioJob(job: TranscriptionJob, services: Awaited<ReturnType<typeof initializeServices>>) {
  const { lineClient, jobService, audioService } = services;
  let result: AudioProcessingResult | undefined;
  let processingError: Error | undefined;

  // Use optional chaining for replyToken, groupId, roomId from job
  const { id: jobId, message_id: messageId, reply_token: replyToken, user_id: userId, group_id: groupId, room_id: roomId } = job;

  try {
    console.log(`🔄 Worker processing audio ${messageId} for job ${jobId}`);

    // Update job status to PROCESSING
    await jobService.updateJob(jobId, { status: 'PROCESSING' });

    // Process audio using AudioService
    result = await audioService.processAudio(messageId, {
      languageCode: 'th-TH',
    });

    console.log(`📝 Transcription Result: ${result.transcript}`);
    console.log(`📊 Confidence: ${result.confidence}`);

    // Get user profile for personalized message
    let displayName = 'ผู้ใช้';
    if (groupId && userId) {
      try {
        const memberProfile = await lineClient.getGroupMemberProfile(groupId, userId);
        displayName = memberProfile.displayName;
      } catch (error) {
        console.error(`Failed to get group member profile for user ${userId} in group ${groupId}:`, error);
      }
    } else if (roomId && userId) {
      try {
        const memberProfile = await lineClient.getRoomMemberProfile(roomId, userId);
        displayName = memberProfile.displayName;
      } catch (error) {
        console.error(`Failed to get room member profile for user ${userId} in room ${roomId}:`, error);
      }
    } else if (userId) {
      try {
        const userProfile = await lineClient.getProfile(userId);
        displayName = userProfile.displayName;
      } catch (error) {
        console.error(`Failed to get profile for user ${userId}:`, error);
      }
    }

    // Format timestamp (using job's created_at as original message timestamp is not directly available here)
    // NOTE: If original message timestamp is crucial, it should be stored in the job table.
    const messageTime = new Date(job.created_at || new Date());
    const timeString = messageTime.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Bangkok',
    });

    let to: string | undefined;
    if (groupId) {
      to = groupId;
    } else if (roomId) {
      to = roomId;
    } else if (userId) {
      to = userId;
    }

    if (!to) {
      console.error(`❌ No valid destination (userId, groupId, or roomId) found for job ${jobId}. Cannot send reply.`);
      // Update job status to FAILED as we cannot inform the user
      await jobService.updateJob(jobId, {
        status: 'FAILED',
        error_message: 'No valid destination found to send result.',
      });
      return;
    }

    // Send result to user using push_message
    console.log(`✉️ Sending transcription result using push_message to ${to}`);
    await lineClient.pushMessage(to, {
      type: 'text',
      text: `✨ เสร็จแล้วครับ!\n\nจาก: ${displayName}\nข้อความเมื่อ ${timeString}\nผลลัพธ์: ${result.transcript}`,
    });

    // Update job record with STT results and set to COMPLETED
    await jobService.updateJob(jobId, {
      status: 'COMPLETED',
      transcript: result.transcript,
      confidence: result.confidence,
      provider: result.provider,
      audio_file_path: result.audioFilePath,
      completed_at: new Date().toISOString(),
    });

    console.log(`✅ Completed job ${jobId}`);
  } catch (error) {
    console.error('❌ Error in worker processing audio job:', error);
    processingError = error instanceof Error ? error : new Error(String(error));

    await sendErrorMessage(
      userId,
      groupId,
      roomId,
      'ไม่สามารถแปลงเสียงเป็นข้อความได้ กรุณาลองใหม่อีกครั้ง',
      lineClient
    );
  } finally {
    if (result && result.audioFilePath && result.convertedAudioPath) {
      await audioService.cleanupAudioFiles(
        result.audioFilePath,
        result.convertedAudioPath
      );
    }

    if (processingError) {
      await jobService.updateJob(jobId, {
        status: 'FAILED',
        error_message: processingError.message,
      });
    }
  }
}

// New runWorker function for one-shot execution
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Client as LineClient } from '@line/bot-sdk'
import { AudioService } from './src/services/audioService'
import { STTService } from './src/services/sttService'
import { JobService, TranscriptionJob, UpdateJobParams } from './src/services/jobService'

// Ensure environment variables are loaded if not already (for local testing)
import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET!

// Initialize Supabase Client
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Initialize Line Client
const lineClient = new LineClient({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
})

// Initialize Services
const sttService = new STTService()
const audioService = new AudioService(lineClient, sttService)
const jobService = new JobService(supabase)

// Define a reasonable concurrency limit to avoid overwhelming the system
const MAX_CONCURRENT_JOBS = 5

/**
 * Processes a single transcription job.
 * @param job The transcription job to process.
 */
async function processJob(job: TranscriptionJob): Promise<void> {
  console.log(`[Worker] Processing job: ${job.id} (Message ID: ${job.message_id})`)

  let updateParams: UpdateJobParams = { status: 'FAILED' } // Default to FAILED

  try {
    // 1. Update job status to PROCESSING
    await jobService.updateJob(job.id, { status: 'PROCESSING' })

    // 2. Process audio (download, convert, transcribe)
    const { transcript, confidence, provider, audioFilePath, convertedAudioPath } =
      await audioService.processAudio(job.message_id)

    // 3. Update job with transcription results
    updateParams = {
      status: 'COMPLETED',
      transcript,
      confidence,
      provider,
      audio_file_path: audioFilePath,
      completed_at: new Date().toISOString(),
    }
    await jobService.updateJob(job.id, updateParams)

    console.log(`[Worker] Successfully processed job: ${job.id}. Transcript: "${transcript.substring(0, 50)}..."`)

    // 4. Clean up temporary audio files
    await audioService.cleanupAudioFiles(audioFilePath, convertedAudioPath)
  } catch (error) {
    console.error(`[Worker] Error processing job ${job.id}:`, error)
    updateParams = {
      status: 'FAILED',
      error_message: error instanceof Error ? error.message : 'Unknown error',
      completed_at: new Date().toISOString(),
    }
    await jobService.updateJob(job.id, updateParams)
    throw error // Re-throw to signal individual job failure
  }
}

/**
 * Fetches and processes pending transcription jobs in a one-shot execution.
 * This function is designed to be called by a Supabase Edge Function (Scheduled Job).
 */
export async function runWorker() {
  console.log('Worker starting to process pending jobs...')

  try {
    const jobs = await jobService.getJobsForWorker(MAX_CONCURRENT_JOBS)

    if (!jobs || jobs.length === 0) {
      console.log('No pending or timed-out processing jobs found. Worker exiting.')
      return { status: 200, message: 'No pending jobs to process.' }
    }

    console.log(`Found ${jobs.length} pending or timed-out processing jobs.`)

    // Process jobs in parallel with Promise.allSettled to handle individual failures
    const results = await Promise.allSettled(jobs.map((job) => processJob(job)))

    let processedCount = 0
    let failedCount = 0
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        processedCount++
      } else {
        failedCount++
        // Ensure job is not undefined before accessing its id
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
