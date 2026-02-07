-- Add pose_video_path column to sessions table
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pose_video_path TEXT;
