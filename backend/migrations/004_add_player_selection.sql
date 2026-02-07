-- Add player selection field to sessions table
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS selected_player JSONB;

-- selected_player will contain:
-- {
--   "player_idx": 0,
--   "bbox": {"x": 100, "y": 50, "width": 200, "height": 400},
--   "center": {"x": 200, "y": 250},
--   "confidence": 0.95
-- }

-- Add preview frame URL field
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS preview_frame_url TEXT;
