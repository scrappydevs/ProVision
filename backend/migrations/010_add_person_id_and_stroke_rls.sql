-- Add person_id column to pose_analysis for multi-person tracking.
-- The sessions.py background task (_run_pose_background) inserts rows with person_id,
-- and the frontend reads person_id to distinguish multiple players per frame.
ALTER TABLE pose_analysis ADD COLUMN IF NOT EXISTS person_id INTEGER DEFAULT 1;

-- Create composite index for efficient person-based queries
CREATE INDEX IF NOT EXISTS idx_pose_analysis_person
  ON pose_analysis(session_id, person_id, frame_number);

-- Enable RLS on stroke_analytics (was previously disabled — security fix)
ALTER TABLE stroke_analytics ENABLE ROW LEVEL SECURITY;

-- Service role needs full access for backend inserts
CREATE POLICY "Service role full access to stroke_analytics"
  ON stroke_analytics FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Users can view their own stroke analytics via session ownership
CREATE POLICY "Users can view own stroke analytics"
  ON stroke_analytics FOR SELECT
  USING (
    session_id IN (
      SELECT id FROM sessions WHERE user_id = auth.uid()
    )
  );
