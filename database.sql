-- สร้าง table สำหรับเก็บ transcription jobs
CREATE TABLE IF NOT EXISTS transcription_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Line message info
  message_id VARCHAR(255) NOT NULL UNIQUE,
  user_id VARCHAR(255) NOT NULL,
  reply_token VARCHAR(255),
  group_id VARCHAR(255),
  room_id VARCHAR(255),
  
  -- Audio file info
  original_content_url TEXT,
  audio_file_path TEXT,
  file_size INTEGER,
  duration INTEGER,
  
  -- Job status
  status VARCHAR(50) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'TIMEOUT')),
  
  -- Transcription result
  transcript TEXT,
  confidence DECIMAL(3,2),
  provider VARCHAR(50) DEFAULT 'whisper', -- 'whisper', 'google', etc.
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  previous_job_id UUID REFERENCES transcription_jobs(id),
  retry_count INTEGER DEFAULT 0
);

-- เพิ่มคอลัมน์ group_id ถ้ายังไม่มี
DO $$ BEGIN
    ALTER TABLE transcription_jobs ADD COLUMN group_id VARCHAR(255);
EXCEPTION
    WHEN duplicate_column THEN RAISE NOTICE 'column group_id already exists in transcription_jobs.';
END $$;

-- เพิ่มคอลัมน์ room_id ถ้ายังไม่มี
DO $$ BEGIN
    ALTER TABLE transcription_jobs ADD COLUMN room_id VARCHAR(255);
EXCEPTION
    WHEN duplicate_column THEN RAISE NOTICE 'column room_id already exists in transcription_jobs.';
END $$;

-- สร้าง index สำหรับ performance
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_status ON transcription_jobs(status);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_user_id ON transcription_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_created_at ON transcription_jobs(created_at);

-- สร้าง trigger สำหรับ updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_transcription_jobs_updated_at ON transcription_jobs;
CREATE TRIGGER update_transcription_jobs_updated_at 
    BEFORE UPDATE ON transcription_jobs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
