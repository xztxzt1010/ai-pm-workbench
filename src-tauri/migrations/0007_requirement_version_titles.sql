ALTER TABLE requirement_versions ADD COLUMN title TEXT NOT NULL DEFAULT '';

UPDATE requirement_versions
SET title = (
  SELECT title
  FROM requirement_cards
  WHERE requirement_cards.id = requirement_versions.requirement_card_id
)
WHERE title = '';
