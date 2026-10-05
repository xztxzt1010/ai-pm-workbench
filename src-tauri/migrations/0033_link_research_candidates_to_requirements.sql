ALTER TABLE research_requirement_candidates
ADD COLUMN requirement_card_id TEXT REFERENCES requirement_cards(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_requirement_candidates_requirement_card
ON research_requirement_candidates(requirement_card_id)
WHERE requirement_card_id IS NOT NULL;
