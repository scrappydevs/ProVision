-- Migration 009: WTT Match Database (global/public sports data)

-- WTT Tournaments (scraped from SportDevs / WTT)
CREATE TABLE IF NOT EXISTS public.wtt_tournaments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id TEXT UNIQUE,
    name TEXT NOT NULL,
    season_name TEXT,
    location TEXT,
    start_date DATE,
    end_date DATE,
    tier TEXT,
    league_name TEXT,
    status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'ongoing', 'completed', 'cancelled')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wtt_tournaments_external_id ON wtt_tournaments(external_id);
CREATE INDEX IF NOT EXISTS idx_wtt_tournaments_status ON wtt_tournaments(status);
CREATE INDEX IF NOT EXISTS idx_wtt_tournaments_start_date ON wtt_tournaments(start_date);
CREATE INDEX IF NOT EXISTS idx_wtt_tournaments_tier ON wtt_tournaments(tier);

-- WTT Players (scraped bios, global)
CREATE TABLE IF NOT EXISTS public.wtt_players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id TEXT UNIQUE,
    ittf_id INTEGER,
    name TEXT NOT NULL,
    country TEXT,
    ranking INTEGER,
    grip_style TEXT,
    handedness TEXT,
    photo_url TEXT,
    birth_year INTEGER,
    playing_style TEXT,
    career_wins INTEGER,
    career_losses INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wtt_players_external_id ON wtt_players(external_id);
CREATE INDEX IF NOT EXISTS idx_wtt_players_name ON wtt_players(name);
CREATE INDEX IF NOT EXISTS idx_wtt_players_country ON wtt_players(country);
CREATE INDEX IF NOT EXISTS idx_wtt_players_ittf_id ON wtt_players(ittf_id);

-- WTT Matches (scraped results with set-by-set scores)
CREATE TABLE IF NOT EXISTS public.wtt_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id TEXT UNIQUE,
    tournament_id UUID NOT NULL REFERENCES wtt_tournaments(id) ON DELETE CASCADE,
    player_1_id UUID REFERENCES wtt_players(id) ON DELETE SET NULL,
    player_2_id UUID REFERENCES wtt_players(id) ON DELETE SET NULL,
    winner_id UUID REFERENCES wtt_players(id) ON DELETE SET NULL,
    round TEXT,
    score_summary TEXT,
    score_detail TEXT,
    scores_json JSONB,
    status TEXT DEFAULT 'upcoming' CHECK (status IN ('finished', 'live', 'upcoming', 'cancelled')),
    start_time TIMESTAMPTZ,
    duration_seconds INTEGER,
    video_url TEXT,
    video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wtt_matches_tournament_id ON wtt_matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_wtt_matches_player_1_id ON wtt_matches(player_1_id);
CREATE INDEX IF NOT EXISTS idx_wtt_matches_player_2_id ON wtt_matches(player_2_id);
CREATE INDEX IF NOT EXISTS idx_wtt_matches_winner_id ON wtt_matches(winner_id);
CREATE INDEX IF NOT EXISTS idx_wtt_matches_round ON wtt_matches(round);
CREATE INDEX IF NOT EXISTS idx_wtt_matches_status ON wtt_matches(status);
CREATE INDEX IF NOT EXISTS idx_wtt_matches_external_id ON wtt_matches(external_id);

-- RLS: All authenticated users can read (public sports data), only service role can write
ALTER TABLE wtt_tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE wtt_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE wtt_matches ENABLE ROW LEVEL SECURITY;

-- Read policies for authenticated users
CREATE POLICY "Authenticated users can view wtt_tournaments" ON wtt_tournaments
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can view wtt_players" ON wtt_players
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can view wtt_matches" ON wtt_matches
    FOR SELECT TO authenticated USING (true);

-- Service role full access (for scraper writes)
CREATE POLICY "Service role full access wtt_tournaments" ON wtt_tournaments
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access wtt_players" ON wtt_players
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access wtt_matches" ON wtt_matches
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
