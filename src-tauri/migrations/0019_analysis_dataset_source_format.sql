ALTER TABLE analysis_datasets
  ADD COLUMN source_format TEXT NOT NULL DEFAULT 'json'
  CHECK (source_format IN ('csv', 'json', 'xlsx'));

UPDATE analysis_datasets
SET source_format = source_type;
