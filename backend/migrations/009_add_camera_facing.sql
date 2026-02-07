-- Add camera_facing column to sessions table (video-specific, not player-specific)
-- 'auto' = auto-detect from nose/ear visibility per video
-- 'toward' = player faces the camera (front-facing)
-- 'away' = player faces away from camera (back-facing, L/R keypoints are mirrored)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS camera_facing VARCHAR(10) DEFAULT 'auto'
  CHECK (camera_facing IN ('auto', 'toward', 'away'));
