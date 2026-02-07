-- Add AI insight columns to stroke_analytics
ALTER TABLE stroke_analytics ADD COLUMN IF NOT EXISTS ai_insight TEXT;
ALTER TABLE stroke_analytics ADD COLUMN IF NOT EXISTS ai_insight_data JSONB;

-- Add insight generation status to sessions (decoupled from stroke_analysis_status)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS insight_generation_status VARCHAR(20) DEFAULT NULL;
