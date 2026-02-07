-- Migration 012: Make tournaments and matchups globally readable by any authenticated user
-- Write operations (INSERT, UPDATE, DELETE) remain restricted to the owner (coach_id)

-- ============================================================================
-- TOURNAMENTS: Open SELECT to all authenticated users
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own tournaments" ON tournaments;

CREATE POLICY "Authenticated users can view all tournaments" ON tournaments
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can insert own tournaments" ON tournaments;
CREATE POLICY "Users can insert own tournaments" ON tournaments
    FOR INSERT WITH CHECK (coach_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own tournaments" ON tournaments;
CREATE POLICY "Users can update own tournaments" ON tournaments
    FOR UPDATE USING (coach_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own tournaments" ON tournaments;
CREATE POLICY "Users can delete own tournaments" ON tournaments
    FOR DELETE USING (coach_id = auth.uid());

-- ============================================================================
-- TOURNAMENT_MATCHUPS: Open SELECT to all authenticated users
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own matchups" ON tournament_matchups;

CREATE POLICY "Authenticated users can view all matchups" ON tournament_matchups
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can insert own matchups" ON tournament_matchups;
CREATE POLICY "Users can insert own matchups" ON tournament_matchups
    FOR INSERT WITH CHECK (coach_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own matchups" ON tournament_matchups;
CREATE POLICY "Users can update own matchups" ON tournament_matchups
    FOR UPDATE USING (coach_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own matchups" ON tournament_matchups;
CREATE POLICY "Users can delete own matchups" ON tournament_matchups
    FOR DELETE USING (coach_id = auth.uid());
