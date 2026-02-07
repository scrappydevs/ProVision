-- Migration 004: Create tournaments table

CREATE TABLE IF NOT EXISTS public.tournaments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coach_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    location TEXT,
    start_date DATE,
    end_date DATE,
    level TEXT CHECK (level IN ('local', 'regional', 'national', 'international', 'world')),
    status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'ongoing', 'completed', 'cancelled')),
    surface TEXT,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tournament matchups: individual matches within a tournament
CREATE TABLE IF NOT EXISTS public.tournament_matchups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    coach_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    opponent_name TEXT NOT NULL,
    opponent_club TEXT,
    opponent_ranking TEXT,
    round TEXT,
    scheduled_at TIMESTAMPTZ,
    result TEXT CHECK (result IN ('win', 'loss', 'draw', 'pending', 'walkover', 'retired')),
    score TEXT,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tournaments_coach_id ON tournaments(coach_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_start_date ON tournaments(start_date);
CREATE INDEX IF NOT EXISTS idx_matchups_tournament_id ON tournament_matchups(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matchups_player_id ON tournament_matchups(player_id);
CREATE INDEX IF NOT EXISTS idx_matchups_coach_id ON tournament_matchups(coach_id);

-- RLS policies
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_matchups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tournaments" ON tournaments
    FOR SELECT USING (coach_id = auth.uid());

CREATE POLICY "Users can insert own tournaments" ON tournaments
    FOR INSERT WITH CHECK (coach_id = auth.uid());

CREATE POLICY "Users can update own tournaments" ON tournaments
    FOR UPDATE USING (coach_id = auth.uid());

CREATE POLICY "Users can delete own tournaments" ON tournaments
    FOR DELETE USING (coach_id = auth.uid());

CREATE POLICY "Users can view own matchups" ON tournament_matchups
    FOR SELECT USING (coach_id = auth.uid());

CREATE POLICY "Users can insert own matchups" ON tournament_matchups
    FOR INSERT WITH CHECK (coach_id = auth.uid());

CREATE POLICY "Users can update own matchups" ON tournament_matchups
    FOR UPDATE USING (coach_id = auth.uid());

CREATE POLICY "Users can delete own matchups" ON tournament_matchups
    FOR DELETE USING (coach_id = auth.uid());
