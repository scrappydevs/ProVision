-- Add selected_players column to sessions table to store multiple selected players
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS selected_players JSONB;
