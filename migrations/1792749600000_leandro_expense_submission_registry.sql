-- Up Migration
CREATE TABLE expense_submission_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  operation text NOT NULL DEFAULT 'expense.create' CHECK (operation = 'expense.create'),
  intent_key uuid NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'failed' CHECK (state IN ('processing', 'failed', 'completed')),
  current_attempt_id uuid,
  lease_until timestamptz,
  note_id uuid REFERENCES expense_notes(id),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '7 days'),
  UNIQUE (user_id, company_id, operation, intent_key),
  UNIQUE (id, user_id, company_id),
  CHECK (
    (state = 'processing' AND current_attempt_id IS NOT NULL AND lease_until IS NOT NULL AND note_id IS NULL AND result IS NULL) OR
    (state = 'failed' AND current_attempt_id IS NULL AND lease_until IS NULL AND note_id IS NULL AND result IS NULL) OR
    (state = 'completed' AND current_attempt_id IS NOT NULL AND lease_until IS NULL AND note_id IS NOT NULL AND result IS NOT NULL AND jsonb_typeof(result) = 'object')
  )
);

CREATE TABLE expense_submission_attempts (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  extension text NOT NULL CHECK (extension IN ('.png', '.jpg', '.webp', '.pdf')),
  receipt_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'committed', 'retired')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cleanup_checked_at timestamptz,
  cleanup_result text CHECK (cleanup_result IN ('deleted', 'failed', 'referenced')),
  UNIQUE (operation_id, id),
  FOREIGN KEY (operation_id, user_id, company_id)
    REFERENCES expense_submission_operations(id, user_id, company_id),
  CHECK (receipt_key = 'receipts/' || id::text || extension)
);

ALTER TABLE expense_submission_operations ADD CONSTRAINT expense_submission_current_attempt
  FOREIGN KEY (id, current_attempt_id)
  REFERENCES expense_submission_attempts(operation_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- Maintenance is scoped, age checked and bounded; last-check ordering rotates tombstones.
CREATE INDEX expense_submission_operation_lease ON expense_submission_operations(company_id, state, lease_until, id);
CREATE INDEX expense_submission_attempt_cleanup ON expense_submission_attempts(company_id, state, cleanup_checked_at NULLS FIRST, created_at, id);
-- Exact reference checks are part of safe cleanup, not a bucket-wide inventory.
CREATE INDEX expense_notes_submission_receipt_ref ON expense_notes(receipt_key);

ALTER TABLE expense_submission_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_submission_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_submission_operations_select ON expense_submission_operations FOR SELECT USING (expense_submission_operations.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (SELECT 1 FROM users actor WHERE actor.id = expense_submission_operations.user_id AND actor.company_id = expense_submission_operations.company_id AND actor.is_active));
CREATE POLICY expense_submission_operations_insert ON expense_submission_operations FOR INSERT WITH CHECK (expense_submission_operations.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (SELECT 1 FROM users actor WHERE actor.id = expense_submission_operations.user_id AND actor.company_id = expense_submission_operations.company_id AND actor.is_active));
CREATE POLICY expense_submission_operations_update ON expense_submission_operations FOR UPDATE USING (expense_submission_operations.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (SELECT 1 FROM users actor WHERE actor.id = expense_submission_operations.user_id AND actor.company_id = expense_submission_operations.company_id AND actor.is_active)) WITH CHECK (expense_submission_operations.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (SELECT 1 FROM users actor WHERE actor.id = expense_submission_operations.user_id AND actor.company_id = expense_submission_operations.company_id AND actor.is_active));

ALTER TABLE expense_submission_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_submission_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_submission_attempts_select ON expense_submission_attempts FOR SELECT USING (expense_submission_attempts.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (SELECT 1 FROM users actor WHERE actor.id = expense_submission_attempts.user_id AND actor.company_id = expense_submission_attempts.company_id AND actor.is_active));
CREATE POLICY expense_submission_attempts_insert ON expense_submission_attempts FOR INSERT WITH CHECK (expense_submission_attempts.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (SELECT 1 FROM users actor WHERE actor.id = expense_submission_attempts.user_id AND actor.company_id = expense_submission_attempts.company_id AND actor.is_active));
CREATE POLICY expense_submission_attempts_update ON expense_submission_attempts FOR UPDATE USING (expense_submission_attempts.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (SELECT 1 FROM users actor WHERE actor.id = expense_submission_attempts.user_id AND actor.company_id = expense_submission_attempts.company_id AND actor.is_active)) WITH CHECK (expense_submission_attempts.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (SELECT 1 FROM users actor WHERE actor.id = expense_submission_attempts.user_id AND actor.company_id = expense_submission_attempts.company_id AND actor.is_active));

-- No application DELETE/TRUNCATE policy or runtime grants/role switch are introduced.
-- HA-04 must inventory these tables and prove its actual restricted login separately.

-- Down Migration
DROP INDEX expense_notes_submission_receipt_ref;
ALTER TABLE expense_submission_operations DROP CONSTRAINT expense_submission_current_attempt;
DROP TABLE expense_submission_attempts;
DROP TABLE expense_submission_operations;
