-- Add stroke analytics table
CREATE TABLE IF NOT EXISTS stroke_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    start_frame INTEGER NOT NULL,
    end_frame INTEGER NOT NULL,
    peak_frame INTEGER NOT NULL,
    stroke_type VARCHAR(20) NOT NULL, -- 'forehand', 'backhand', 'serve', 'unknown'
    duration FLOAT NOT NULL,
    max_velocity FLOAT NOT NULL,
    form_score FLOAT NOT NULL,
    metrics JSONB NOT NULL, -- Joint angles, body position, ranges
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for efficient querying by session
CREATE INDEX IF NOT EXISTS idx_stroke_analytics_session_id ON stroke_analytics(session_id);

-- Create index for querying by stroke type
CREATE INDEX IF NOT EXISTS idx_stroke_analytics_stroke_type ON stroke_analytics(stroke_type);

-- Add stroke summary fields to sessions table
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS stroke_summary JSONB;

-- stroke_summary will contain:
-- {
--   "average_form_score": 85.5,
--   "best_form_score": 95.0,
--   "consistency_score": 78.0,
--   "total_strokes": 12,
--   "forehand_count": 7,
--   "backhand_count": 4,
--   "serve_count": 1
-- }
