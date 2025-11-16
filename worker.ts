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

async function startWorker() {
  console.log('🚀 Starting transcription worker...');
  const services = await initializeServices();
  const { jobService } = services;

  const POLLING_INTERVAL_MS = 5000; // Poll every 5 seconds
  const PROCESSING_TIMEOUT_MINUTES = 5; // Re-process jobs stuck in PROCESSING after 5 minutes

  while (true) {
    try {
      // Fetch PENDING jobs and PROCESSING jobs that have timed out
      const jobsToProcess: TranscriptionJob[] = await jobService.getJobsForWorker(10, PROCESSING_TIMEOUT_MINUTES);

      if (jobsToProcess && jobsToProcess.length > 0) {
        console.log(`🔎 Found ${jobsToProcess.length} jobs to process. Processing...`);
        for (const job of jobsToProcess) {
          if (job.status === 'PROCESSING') {
            console.log(`⚠️ Job ${job.id} (message: ${job.message_id}) was stuck in PROCESSING for too long. Marking as TIMEOUT and re-queuing...`);

            // 1. Update the original job to TIMEOUT status
            await jobService.updateJob(job.id, {
              status: 'TIMEOUT',
              error_message: 'Processing timed out. Re-queued.',
            });

            // 2. Create a new job record for re-processing
            const newJob = await jobService.createJob({
              messageId: `${job.message_id}_retry_${(job.retry_count || 0) + 1}`,
              userId: job.user_id,
              replyToken: job.reply_token,
              groupId: job.group_id,
              roomId: job.room_id,
              retryCount: (job.retry_count || 0) + 1,
              previousJobId: job.id, // Reference the original job
            });
            console.log(`✅ Created new job ${newJob.id} for re-processing (original: ${job.id}, retry_count: ${newJob.retry_count}).`);
            continue; // Skip immediate processing of this timed-out job, let the new job be picked up naturally
          }
          
          try {
            await processAudioJob(job, services);
          } catch (jobError) {
            console.error(`❌ Error processing job ${job.id}, but worker will continue.`, jobError);
            await services.jobService.updateJob(job.id, {
              status: 'FAILED',
              error_message: 'Worker caught an unhandled exception during re-processing.',
            });
          }
        }
      } else {
        console.log('😴 No pending or timed-out jobs found. Waiting...');
      }
    } catch (workerError) {
      console.error('❌ Uncaught error in worker loop:', workerError);
    }
    await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
  }
}

startWorker().catch(error => {
  console.error('❌ Worker failed to start:', error);
  process.exit(1);
});
