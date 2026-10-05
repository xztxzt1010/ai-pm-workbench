ALTER TABLE research_entries ADD COLUMN plan_id TEXT REFERENCES research_plans(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_research_entries_plan ON research_entries(plan_id);
