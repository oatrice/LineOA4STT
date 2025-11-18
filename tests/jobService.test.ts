import { describe, it, expect, beforeEach, mock, afterEach, vi } from 'bun:test'
import { JobService } from '../src/services/jobService'
import type { SupabaseClient } from '@supabase/supabase-js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('JobService', () => {
  let jobService: JobService
  let mockSupabase: Partial<SupabaseClient>

  beforeEach(() => {
    // Re-initialize mockSupabase and jobService for each test
    const mockInsert = {
      select: mock(() => ({
        single: mock(async () => ({
          data: {
            id: 'test-job-id',
            message_id: 'test-message-id',
            user_id: 'test-user-id',
            reply_token: 'test-reply-token',
            status: 'PENDING',
          },
          error: null,
        })),
      })),
    }

    const mockUpdate = {
      eq: mock(async () => ({
        data: null,
        error: null,
      })),
    }

    const mockSelect = {
      eq: mock(() => ({
        single: mock(async () => ({
          data: {
            id: 'test-job-id',
            message_id: 'test-message-id',
            user_id: 'test-user-id',
            status: 'PENDING',
          },
          error: null,
        })),
      })),
    }

    mockSupabase = {
      from: mock(() => ({
        insert: mock(() => mockInsert),
        update: mock(() => mockUpdate),
        select: mock(() => mockSelect),
      })),
    } as any

    jobService = new JobService(mockSupabase as SupabaseClient)
  })

  it('should create a job successfully', async () => {
    const job = await jobService.createJob({
      messageId: 'test-message-id',
      userId: 'test-user-id',
      replyToken: 'test-reply-token',
    })

    expect(job).toBeDefined()
    expect(job.id).toBe('test-job-id')
    expect(job.message_id).toBe('test-message-id')
    expect(job.user_id).toBe('test-user-id')
    expect(job.status).toBe('PENDING')
  })

  it('should update a job successfully', async () => {
    await jobService.updateJob('test-job-id', {
      status: 'COMPLETED',
      transcript: 'Test transcript',
      confidence: 0.95,
    })

    expect(mockSupabase.from).toHaveBeenCalledWith('transcription_jobs')
  })

  it('should get a job by id', async () => {
    const job = await jobService.getJob('test-job-id')

    expect(job).toBeDefined()
    expect(job?.id).toBe('test-job-id')
  })

  it('should return null for non-existent job', async () => {
    // Mock not found error
    const mockFrom = mock(() => ({
      select: mock(() => ({
        eq: mock(() => ({
          single: mock(async () => ({
            data: null,
            error: { code: 'PGRST116', message: 'Not found' },
          })),
        })),
      })),
    }))

    mockSupabase.from = mockFrom as any
    jobService = new JobService(mockSupabase as SupabaseClient)

    const job = await jobService.getJob('non-existent-id')

    expect(job).toBeNull()
  })
})
//