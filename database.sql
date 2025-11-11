-- สร้าง table สำหรับเก็บ transcription jobs
CREATE TABLE IF NOT EXISTS transcription_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Line message info
  message_id VARCHAR(255) NOT NULL UNIQUE,
  user_id VARCHAR(255) NOT NULL,
  reply_token VARCHAR(255),
  
  -- Audio file info
  original_content_url TEXT,
  audio_file_path TEXT,
  file_size INTEGER,
  duration INTEGER,
  
  -- Job status
  status VARCHAR(50) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  
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
  retry_count INTEGER DEFAULT 0
);

-- สร้าง index สำหรับ performance
CREATE INDEX idx_transcription_jobs_status ON transcription_jobs(status);
CREATE INDEX idx_transcription_jobs_user_id ON transcription_jobs(user_id);
CREATE INDEX idx_transcription_jobs_created_at ON transcription_jobs(created_at);

-- สร้าง trigger สำหรับ updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_transcription_jobs_updated_at 
    BEFORE UPDATE ON transcription_jobs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();