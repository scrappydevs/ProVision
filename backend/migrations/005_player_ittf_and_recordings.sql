-- Migration 003: Add ITTF fields to players + create recordings table

-- Player table additions
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE players ADD COLUMN IF NOT EXISTS ittf_id INTEGER;
ALTER TABLE players ADD COLUMN IF NOT EXISTS ittf_data JSONB;
ALTER TABLE players ADD COLUMN IF NOT EXISTS ittf_last_synced TIMESTAMPTZ;

-- Recordings table for categorized video storage
CREATE TABLE IF NOT EXISTS public.recordings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    coach_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    video_path TEXT,
    thumbnail_path TEXT,
    type TEXT NOT NULL CHECK (type IN ('match', 'informal', 'clip', 'highlight')),
    source_recording_id UUID REFERENCES recordings(id) ON DELETE SET NULL,
    clip_start_time FLOAT,
    clip_end_time FLOAT,
    duration FLOAT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for recordings
CREATE INDEX IF NOT EXISTS idx_recordings_player_id ON recordings(player_id);
CREATE INDEX IF NOT EXISTS idx_recordings_coach_id ON recordings(coach_id);
CREATE INDEX IF NOT EXISTS idx_recordings_type ON recordings(type);
CREATE INDEX IF NOT EXISTS idx_recordings_source ON recordings(source_recording_id);

-- RLS policies for recordings
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recordings" ON recordings
    FOR SELECT USING (coach_id = auth.uid());

CREATE POLICY "Users can insert own recordings" ON recordings
    FOR INSERT WITH CHECK (coach_id = auth.uid());

CREATE POLICY "Users can update own recordings" ON recordings
    FOR UPDATE USING (coach_id = auth.uid());

CREATE POLICY "Users can delete own recordings" ON recordings
    FOR DELETE USING (coach_id = auth.uid());
