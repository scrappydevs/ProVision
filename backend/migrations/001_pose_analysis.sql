-- Migration: Add pose analysis tables
-- Run this in Supabase SQL Editor

-- Pose analysis results (frame-by-frame data)
CREATE TABLE IF NOT EXISTS pose_analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    frame_number INT NOT NULL,
    timestamp FLOAT NOT NULL,
    keypoints JSONB NOT NULL,
    joint_angles JSONB NOT NULL,
    body_metrics JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pose_session ON pose_analysis(session_id);
CREATE INDEX IF NOT EXISTS idx_pose_timestamp ON pose_analysis(session_id, timestamp);

-- Stroke events
CREATE TABLE IF NOT EXISTS strokes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    timestamp FLOAT NOT NULL,
    frame_start INT NOT NULL,
    frame_end INT NOT NULL,
    stroke_type TEXT NOT NULL,
    confidence FLOAT NOT NULL,
    metrics JSONB NOT NULL,
    form_score JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strokes_session ON strokes(session_id);
CREATE INDEX IF NOT EXISTS idx_strokes_type ON strokes(session_id, stroke_type);

-- Ball tracking data
CREATE TABLE IF NOT EXISTS ball_trajectories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    rally_number INT NOT NULL,
    start_time FLOAT NOT NULL,
    end_time FLOAT NOT NULL,
    points JSONB NOT NULL,
    metrics JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ball_session ON ball_trajectories(session_id);

-- Session summary metrics (aggregated)
CREATE TABLE IF NOT EXISTS session_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    total_strokes INT DEFAULT 0,
    forehand_count INT DEFAULT 0,
    backhand_count INT DEFAULT 0,
    serve_count INT DEFAULT 0,
    avg_form_score FLOAT DEFAULT 0,
    avg_ball_speed FLOAT DEFAULT 0,
    rally_count INT DEFAULT 0,
    best_stroke_id UUID REFERENCES strokes(id),
    worst_stroke_id UUID REFERENCES strokes(id),
    analysis_duration FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies for new tables
ALTER TABLE pose_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE strokes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ball_trajectories ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_metrics ENABLE ROW LEVEL SECURITY;

-- Users can view their own pose analysis
CREATE POLICY "Users can view own pose analysis"
    ON pose_analysis FOR SELECT
    USING (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()
        )
    );

-- Service role has full access
CREATE POLICY "Service role full access to pose_analysis"
    ON pose_analysis FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- Users can view their own strokes
CREATE POLICY "Users can view own strokes"
    ON strokes FOR SELECT
    USING (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Service role full access to strokes"
    ON strokes FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- Users can view their own ball trajectories
CREATE POLICY "Users can view own ball trajectories"
    ON ball_trajectories FOR SELECT
    USING (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Service role full access to ball_trajectories"
    ON ball_trajectories FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- Users can view their own session metrics
CREATE POLICY "Users can view own session metrics"
    ON session_metrics FOR SELECT
    USING (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Service role full access to session_metrics"
    ON session_metrics FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');
