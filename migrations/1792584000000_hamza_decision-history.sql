-- Up Migration
CREATE TABLE expense_decision_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_note_id uuid NOT NULL UNIQUE REFERENCES expense_notes(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  actor_display_name text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  from_status text NOT NULL CHECK (from_status = 'pending'),
  to_status text NOT NULL CHECK (to_status IN ('approved', 'rejected'))
);

ALTER TABLE expense_decision_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_decision_history FORCE ROW LEVEL SECURITY;

-- Defense in depth. HA-04 must grant privileges and validate the actual limited application role.
CREATE POLICY expense_decision_history_visible ON expense_decision_history FOR SELECT
USING (EXISTS (
  SELECT 1 FROM expense_notes en
  JOIN users owner ON owner.id = en.user_id
  JOIN users actor ON actor.id = nullif(current_setting('app.current_user_id', true), '')::uuid AND actor.is_active
  WHERE en.id = expense_note_id AND owner.company_id = actor.company_id
    AND expense_decision_history.company_id = actor.company_id
    AND (owner.id = actor.id
      OR (owner.id <> actor.id AND actor.role = 'manager' AND owner.role <> 'hr_admin' AND owner.manager_id = actor.id)
      OR (owner.id <> actor.id AND actor.role = 'hr_admin' AND (owner.role = 'hr_admin' OR NOT EXISTS (
        SELECT 1 FROM users manager WHERE manager.id = owner.manager_id AND manager.id <> owner.id
          AND manager.company_id = owner.company_id AND manager.role = 'manager' AND manager.is_active
      ))))
));

CREATE POLICY expense_decision_history_append ON expense_decision_history FOR INSERT
WITH CHECK (actor_id = nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (
  SELECT 1 FROM expense_notes en
  JOIN users owner ON owner.id = en.user_id
  JOIN users actor ON actor.id = actor_id AND actor.is_active
  WHERE en.id = expense_note_id AND en.status = to_status AND owner.company_id = actor.company_id
    AND expense_decision_history.company_id = actor.company_id
    AND owner.id <> actor.id
    AND ((actor.role = 'manager' AND owner.role <> 'hr_admin' AND owner.manager_id = actor.id)
      OR (actor.role = 'hr_admin' AND (owner.role = 'hr_admin' OR NOT EXISTS (
        SELECT 1 FROM users manager WHERE manager.id = owner.manager_id AND manager.id <> owner.id
          AND manager.company_id = owner.company_id AND manager.role = 'manager' AND manager.is_active
      ))))
));

-- No UPDATE/DELETE policy: the future limited app role cannot rewrite history.
-- Down Migration
DROP TABLE expense_decision_history;
