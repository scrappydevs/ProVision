-- Migration 013: YouTube Clips - Dedicated table for standalone YouTube video analysis
-- This allows users to create and analyze YouTube clips independently from players/sessions

CREATE TABLE public.youtube_clips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- YouTube source
  youtube_url TEXT NOT NULL,
  youtube_video_id TEXT NOT NULL,
  title TEXT,
  thumbnail_url TEXT,
  
  -- Clip metadata
  clip_start_time DOUBLE PRECISION DEFAULT 0,
  clip_end_time DOUBLE PRECISION NOT NULL,
  duration DOUBLE PRECISION NOT NULL, -- clip_end - clip_start
  
  -- Processed video (clipped, saved to storage)
  video_storage_path TEXT, -- Supabase storage path
  video_public_url TEXT,   -- Public URL for playback
  
  -- Analysis session (optional, created when analyzed)
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  
  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_youtube_clips_coach_id ON public.youtube_clips(coach_id);
CREATE INDEX idx_youtube_clips_session_id ON public.youtube_clips(session_id);
CREATE INDEX idx_youtube_clips_status ON public.youtube_clips(status);
CREATE INDEX idx_youtube_clips_created_at ON public.youtube_clips(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.youtube_clips ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own clips
CREATE POLICY "Users can view own clips"
  ON public.youtube_clips FOR SELECT
  USING (auth.uid() = coach_id);

CREATE POLICY "Users can insert own clips"
  ON public.youtube_clips FOR INSERT
  WITH CHECK (auth.uid() = coach_id);

CREATE POLICY "Users can update own clips"
  ON public.youtube_clips FOR UPDATE
  USING (auth.uid() = coach_id);

CREATE POLICY "Users can delete own clips"
  ON public.youtube_clips FOR DELETE
  USING (auth.uid() = coach_id);

-- Service role bypass (for backend operations)
CREATE POLICY "Service role has full access to clips"
  ON public.youtube_clips FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Auto-update timestamp trigger
CREATE TRIGGER update_youtube_clips_updated_at
  BEFORE UPDATE ON public.youtube_clips
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
