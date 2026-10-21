-- Up Migration
ALTER TABLE users ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- Down Migration
ALTER TABLE users DROP COLUMN is_active;
