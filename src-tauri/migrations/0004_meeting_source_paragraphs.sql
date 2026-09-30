ALTER TABLE meeting_sources ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'text/plain';
ALTER TABLE meeting_sources ADD COLUMN parse_status TEXT NOT NULL DEFAULT 'parsed'
  CHECK (parse_status IN ('pending', 'parsed', 'failed'));
ALTER TABLE meeting_sources ADD COLUMN parse_error TEXT;
ALTER TABLE meeting_sources ADD COLUMN updated_at TEXT;

UPDATE meeting_sources
SET updated_at = created_at
WHERE updated_at IS NULL;

CREATE TABLE meeting_paragraphs (
  id TEXT PRIMARY KEY NOT NULL,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES meeting_sources(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  paragraph_text TEXT NOT NULL,
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source_id, ordinal)
);

CREATE INDEX idx_meeting_sources_hash ON meeting_sources(content_hash);
CREATE INDEX idx_meeting_paragraphs_meeting_ordinal
  ON meeting_paragraphs(meeting_id, ordinal);
