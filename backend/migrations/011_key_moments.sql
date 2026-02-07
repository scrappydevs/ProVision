-- Key moments table: stores detected activity regions (rallies, points, etc.) per session
-- Used to render security-camera-style highlight blocks on the video timeline

CREATE TABLE IF NOT EXISTS public.key_moments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    start_frame INTEGER NOT NULL,
    end_frame INTEGER NOT NULL,
    start_time FLOAT NOT NULL,
    end_time FLOAT NOT NULL,
    moment_type VARCHAR(30) NOT NULL,  -- 'rally', 'stroke', 'point', 'serve'
    intensity FLOAT DEFAULT 0.5,       -- 0.0-1.0 activity intensity score
    label TEXT,                         -- human-readable label e.g. "Rally 3 — 4 strokes"
    metadata JSONB DEFAULT '{}',       -- stroke_ids, point_event, form_scores, etc.
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_key_moments_session ON public.key_moments(session_id);
CREATE INDEX IF NOT EXISTS idx_key_moments_type ON public.key_moments(session_id, moment_type);

-- Enable Row Level Security
ALTER TABLE public.key_moments ENABLE ROW LEVEL SECURITY;

-- RLS: users can read key_moments for their own sessions
CREATE POLICY "Users can view key moments for own sessions"
    ON public.key_moments FOR SELECT
    USING (
        session_id IN (
            SELECT id FROM public.sessions WHERE user_id = auth.uid()
        )
    );

-- RLS: users can insert key_moments for their own sessions
CREATE POLICY "Users can insert key moments for own sessions"
    ON public.key_moments FOR INSERT
    WITH CHECK (
        session_id IN (
            SELECT id FROM public.sessions WHERE user_id = auth.uid()
        )
    );

-- RLS: users can delete key_moments for their own sessions
CREATE POLICY "Users can delete key moments for own sessions"
    ON public.key_moments FOR DELETE
    USING (
        session_id IN (
            SELECT id FROM public.sessions WHERE user_id = auth.uid()
        )
    );

-- Service role bypass for backend operations
CREATE POLICY "Service role has full access to key_moments"
    ON public.key_moments FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');
