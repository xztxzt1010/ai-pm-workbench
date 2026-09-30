CREATE TABLE knowledge_import_receipts (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  package_hash TEXT NOT NULL CHECK (length(package_hash) = 64 AND package_hash = lower(package_hash)),
  imported_at TEXT NOT NULL
);

CREATE TRIGGER knowledge_items_invalidate_import_receipt
AFTER UPDATE ON knowledge_items
BEGIN
  DELETE FROM knowledge_import_receipts WHERE item_id = new.id;
END;

CREATE TRIGGER knowledge_sources_insert_invalidate_import_receipt
AFTER INSERT ON knowledge_sources
BEGIN
  DELETE FROM knowledge_import_receipts WHERE item_id = new.item_id;
END;

CREATE TRIGGER knowledge_sources_update_invalidate_import_receipt
AFTER UPDATE ON knowledge_sources
BEGIN
  DELETE FROM knowledge_import_receipts WHERE item_id = new.item_id;
END;

CREATE TRIGGER knowledge_sources_delete_invalidate_import_receipt
AFTER DELETE ON knowledge_sources
BEGIN
  DELETE FROM knowledge_import_receipts WHERE item_id = old.item_id;
END;

CREATE TRIGGER knowledge_relations_insert_invalidate_import_receipt
AFTER INSERT ON knowledge_relations
BEGIN
  DELETE FROM knowledge_import_receipts WHERE item_id IN (new.from_item_id, new.to_item_id);
END;

CREATE TRIGGER knowledge_relations_update_invalidate_import_receipt
AFTER UPDATE ON knowledge_relations
BEGIN
  DELETE FROM knowledge_import_receipts WHERE item_id IN (new.from_item_id, new.to_item_id);
END;

CREATE TRIGGER knowledge_relations_delete_invalidate_import_receipt
AFTER DELETE ON knowledge_relations
BEGIN
  DELETE FROM knowledge_import_receipts WHERE item_id IN (old.from_item_id, old.to_item_id);
END;
