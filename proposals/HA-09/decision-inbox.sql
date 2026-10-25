-- DRAFT only: no automatic migration or runtime grants before HA-04 integration.
CREATE TABLE decision_notification_outbox (
  event_id uuid PRIMARY KEY REFERENCES expense_decision_history(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id),
  expense_id uuid NOT NULL REFERENCES expense_notes(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  last_failure_code text CHECK (last_failure_code = 'delivery_failed'),
  CHECK ((state = 'delivered') = (delivered_at IS NOT NULL))
);
CREATE TABLE decision_inbox (
  event_id uuid NOT NULL REFERENCES decision_notification_outbox(event_id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES expense_notes(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  PRIMARY KEY (event_id, recipient_id)
);
ALTER TABLE decision_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_notification_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE decision_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_outbox_append ON decision_notification_outbox FOR INSERT WITH CHECK (EXISTS (
  SELECT 1 FROM expense_decision_history h JOIN users actor ON actor.id=h.actor_id
  WHERE h.id=event_id AND h.expense_note_id=expense_id AND h.to_status=decision
    AND h.company_id=decision_notification_outbox.company_id AND actor.is_active
    AND actor.id=nullif(current_setting('app.current_user_id', true), '')::uuid
));
CREATE POLICY decision_inbox_owner ON decision_inbox FOR SELECT USING (
  recipient_id=nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM users actor JOIN expense_notes en ON en.user_id=actor.id
    WHERE actor.id=recipient_id AND actor.is_active AND actor.company_id=decision_inbox.company_id AND en.id=expense_id
  )
);
-- Deliberately no worker policy/grants: HA-04 must supply the actual narrow
-- worker identity. Tests use disposable bootstrap access, not isolation proof.

-- Future runtime grant must be UPDATE(read_at) only, never table-wide UPDATE.
-- Worker INSERT/delivery remains separately privileged; no runtime grants here.
CREATE POLICY decision_inbox_owner_read_state ON decision_inbox FOR UPDATE USING (
  recipient_id=nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM users actor JOIN expense_notes en ON en.user_id=actor.id
    WHERE actor.id=recipient_id AND actor.is_active AND actor.company_id=decision_inbox.company_id AND en.id=expense_id
  )
) WITH CHECK (
  recipient_id=nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM users actor JOIN expense_notes en ON en.user_id=actor.id
    WHERE actor.id=recipient_id AND actor.is_active AND actor.company_id=decision_inbox.company_id AND en.id=expense_id
  )
);
