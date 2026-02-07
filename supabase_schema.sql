-- Database Schema
-- Run this in your Supabase SQL Editor after creating a new project

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sessions table (main table for video analysis sessions)
CREATE TABLE public.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    video_path TEXT,
    ego_video_path TEXT,
    trajectory_data JSONB DEFAULT '{}',
    pose_data JSONB DEFAULT '{}',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster user queries
CREATE INDEX idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX idx_sessions_status ON public.sessions(status);

-- Enable Row Level Security
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own sessions
CREATE POLICY "Users can view own sessions"
    ON public.sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
    ON public.sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
    ON public.sessions FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
    ON public.sessions FOR DELETE
    USING (auth.uid() = user_id);

-- Service role bypass (for backend)
CREATE POLICY "Service role has full access"
    ON public.sessions FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON public.sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Session analytics cache (computed analytics stored for quick retrieval)
CREATE TABLE public.session_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    analytics JSONB NOT NULL,
    session_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id)
);

CREATE INDEX idx_session_analytics_session_id ON public.session_analytics(session_id);
CREATE INDEX idx_session_analytics_user_id ON public.session_analytics(user_id);

ALTER TABLE public.session_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analytics"
    ON public.session_analytics FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analytics"
    ON public.session_analytics FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analytics"
    ON public.session_analytics FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own analytics"
    ON public.session_analytics FOR DELETE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access (analytics)"
    ON public.session_analytics FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE TRIGGER update_session_analytics_updated_at
    BEFORE UPDATE ON public.session_analytics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Storage bucket for videos
-- Note: Create this bucket manually in Supabase Dashboard > Storage
-- Bucket name: "videos"
-- Public: Yes (for video playback URLs)

-- Storage policies (run after creating the bucket)
-- These allow users to manage their own video files

/*
-- Run these after creating the "videos" bucket:

CREATE POLICY "Users can upload videos"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'videos' AND
    auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view own videos"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'videos' AND
    auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete own videos"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'videos' AND
    auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Public video access"
ON storage.objects FOR SELECT
USING (bucket_id = 'videos');
*/
