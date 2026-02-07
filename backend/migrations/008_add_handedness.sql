-- Add handedness column to players table
ALTER TABLE players ADD COLUMN IF NOT EXISTS handedness VARCHAR(10) DEFAULT 'right'
  CHECK (handedness IN ('left', 'right'));
