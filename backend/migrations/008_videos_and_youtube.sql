-- Migration 008: Videos table + youtube_url on matchups

-- Videos table for YouTube and external video references
CREATE TABLE IF NOT EXISTS public.videos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coach_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    youtube_video_id TEXT,
    title TEXT,
    thumbnail_url TEXT,
    duration TEXT,
    source TEXT NOT NULL DEFAULT 'youtube' CHECK (source IN ('youtube', 'upload', 'other')),
    matchup_id UUID REFERENCES tournament_matchups(id) ON DELETE SET NULL,
    tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
    player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_videos_coach_id ON videos(coach_id);
CREATE INDEX IF NOT EXISTS idx_videos_matchup_id ON videos(matchup_id);
CREATE INDEX IF NOT EXISTS idx_videos_tournament_id ON videos(tournament_id);
CREATE INDEX IF NOT EXISTS idx_videos_player_id ON videos(player_id);
CREATE INDEX IF NOT EXISTS idx_videos_youtube_video_id ON videos(youtube_video_id);

-- RLS
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own videos" ON videos
    FOR SELECT USING (coach_id = auth.uid());

CREATE POLICY "Users can insert own videos" ON videos
    FOR INSERT WITH CHECK (coach_id = auth.uid());

CREATE POLICY "Users can update own videos" ON videos
    FOR UPDATE USING (coach_id = auth.uid());

CREATE POLICY "Users can delete own videos" ON videos
    FOR DELETE USING (coach_id = auth.uid());

-- Add youtube_url quick-access field to matchups
ALTER TABLE tournament_matchups ADD COLUMN IF NOT EXISTS youtube_url TEXT;
