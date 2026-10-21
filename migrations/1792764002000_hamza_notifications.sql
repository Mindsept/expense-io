-- Up Migration
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='expense_notifications') THEN
    CREATE ROLE expense_notifications NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='expense_notifications' AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit)) OR
     EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='expense_notifications') THEN
    RAISE EXCEPTION 'Unsafe existing notification worker role.';
  END IF;
END $role$;
GRANT USAGE ON SCHEMA public TO expense_notifications;
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

-- The worker can route/deliver minimal metadata, never receipts, amounts or hashes.
GRANT SELECT (id,company_id,role,manager_id,is_active) ON users TO expense_notifications;
GRANT SELECT (id,user_id,status,created_at) ON expense_notes TO expense_notifications;
CREATE POLICY notification_worker_users ON users FOR SELECT TO expense_notifications USING (true);
CREATE POLICY notification_worker_notes ON expense_notes FOR SELECT TO expense_notifications USING (true);
CREATE POLICY decision_outbox_worker_read ON decision_notification_outbox FOR SELECT TO expense_notifications USING (true);
CREATE POLICY decision_outbox_worker_update ON decision_notification_outbox FOR UPDATE TO expense_notifications USING (true) WITH CHECK (true);
CREATE POLICY decision_inbox_worker_read ON decision_inbox FOR SELECT TO expense_notifications USING (true);
CREATE POLICY decision_inbox_worker_insert ON decision_inbox FOR INSERT TO expense_notifications WITH CHECK (EXISTS (
  SELECT 1 FROM decision_notification_outbox o JOIN users recipient ON recipient.id=o.recipient_id
  JOIN expense_notes en ON en.id=o.expense_id AND en.user_id=recipient.id
  WHERE o.event_id=decision_inbox.event_id AND o.company_id=decision_inbox.company_id AND o.recipient_id=decision_inbox.recipient_id
    AND o.expense_id=decision_inbox.expense_id AND o.decision=decision_inbox.decision AND recipient.company_id=o.company_id
));
-- Actor-only intent confirmation; no generic web outbox maintenance/read access.
CREATE POLICY decision_outbox_actor_read ON decision_notification_outbox FOR SELECT TO expense_web USING (EXISTS (
  SELECT 1 FROM expense_decision_history h WHERE h.id=event_id AND h.actor_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND h.company_id=decision_notification_outbox.company_id
));
DROP POLICY decision_outbox_append ON decision_notification_outbox;
CREATE POLICY decision_outbox_append ON decision_notification_outbox FOR INSERT TO expense_web WITH CHECK (EXISTS (
  SELECT 1 FROM expense_decision_history h JOIN expense_notes en ON en.id=h.expense_note_id JOIN users owner ON owner.id=en.user_id
  WHERE h.id=event_id AND en.id=expense_id AND en.user_id=recipient_id AND h.to_status=decision AND en.status=h.to_status
    AND h.company_id=decision_notification_outbox.company_id AND owner.company_id=h.company_id
    AND h.actor_id=nullif(current_setting('app.current_user_id',true),'')::uuid
));
GRANT SELECT ON decision_notification_outbox TO expense_notifications,expense_web;
GRANT INSERT(event_id,company_id,recipient_id,expense_id,decision) ON decision_notification_outbox TO expense_web;
GRANT UPDATE(state,attempts,next_attempt_at,delivered_at,last_failure_code) ON decision_notification_outbox TO expense_notifications;
GRANT SELECT ON decision_inbox TO expense_notifications,expense_web;
GRANT INSERT(event_id,recipient_id,company_id,expense_id,decision) ON decision_inbox TO expense_notifications;
GRANT UPDATE(read_at) ON decision_inbox TO expense_web;

CREATE FUNCTION notification_read_once() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $body$
BEGIN NEW.read_at=coalesce(OLD.read_at,clock_timestamp());RETURN NEW;END $body$;
CREATE TRIGGER decision_inbox_read_once BEFORE UPDATE OF read_at ON decision_inbox FOR EACH ROW EXECUTE FUNCTION notification_read_once();

CREATE TABLE expense_notification_routes (
  expense_id uuid PRIMARY KEY REFERENCES expense_notes(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 0 CHECK (generation>=0),
  signature text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'routing_pending' CHECK (state IN ('routed','routing_pending')),
  reason text DEFAULT 'no_active_validator' CHECK (reason IN ('multiple_hr_policy_pending','no_active_validator')),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state='routed')=(reason IS NULL))
);
CREATE TABLE assignment_notification_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES expense_notes(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id),
  generation integer NOT NULL CHECK (generation>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','failed','obsolete')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  last_failure_code text CHECK (last_failure_code='delivery_failed'),
  UNIQUE(expense_id,generation,recipient_id),
  CHECK ((state='delivered')=(delivered_at IS NOT NULL))
);
CREATE TABLE assignment_inbox (
  event_id uuid NOT NULL REFERENCES assignment_notification_outbox(event_id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES expense_notes(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  PRIMARY KEY(event_id,recipient_id)
);
ALTER TABLE expense_notification_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_notification_routes FORCE ROW LEVEL SECURITY;
ALTER TABLE assignment_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_notification_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE assignment_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY routes_worker ON expense_notification_routes FOR ALL TO expense_notifications USING (true) WITH CHECK (EXISTS (
  SELECT 1 FROM expense_notes en JOIN users owner ON owner.id=en.user_id WHERE en.id=expense_notification_routes.expense_id AND owner.company_id=expense_notification_routes.company_id
));
CREATE POLICY routes_visible ON expense_notification_routes FOR SELECT TO expense_web USING (
  company_id=(SELECT company_id FROM expense_auth.current_actor()) AND EXISTS (
    SELECT 1 FROM expense_notes en WHERE en.id=expense_id AND en.status='pending' AND expense_auth.can_validate(en.user_id)
  )
);
CREATE POLICY assignment_worker_read ON assignment_notification_outbox FOR SELECT TO expense_notifications USING (true);
CREATE POLICY assignment_worker_update ON assignment_notification_outbox FOR UPDATE TO expense_notifications USING (true) WITH CHECK (true);
CREATE POLICY assignment_worker_append ON assignment_notification_outbox FOR INSERT TO expense_notifications WITH CHECK (EXISTS (
  SELECT 1 FROM expense_notes en JOIN users owner ON owner.id=en.user_id
  JOIN users recipient ON recipient.id=assignment_notification_outbox.recipient_id AND recipient.company_id=owner.company_id AND recipient.is_active
  JOIN expense_notification_routes route ON route.expense_id=en.id AND route.generation=assignment_notification_outbox.generation AND route.state='routed'
  WHERE en.id=assignment_notification_outbox.expense_id AND en.status='pending' AND owner.company_id=assignment_notification_outbox.company_id AND recipient.id<>owner.id AND (
    (recipient.role='manager' AND owner.role<>'hr_admin' AND owner.manager_id=recipient.id) OR
    (recipient.role='hr_admin' AND (owner.role='hr_admin' OR NOT EXISTS(SELECT 1 FROM users m WHERE m.id=owner.manager_id AND m.id<>owner.id AND m.company_id=owner.company_id AND m.role='manager' AND m.is_active)))
  )
));
CREATE POLICY assignment_inbox_worker_read ON assignment_inbox FOR SELECT TO expense_notifications USING (true);
CREATE POLICY assignment_inbox_worker_append ON assignment_inbox FOR INSERT TO expense_notifications WITH CHECK (EXISTS (
  SELECT 1 FROM assignment_notification_outbox o WHERE o.event_id=assignment_inbox.event_id AND o.recipient_id=assignment_inbox.recipient_id AND o.company_id=assignment_inbox.company_id AND o.expense_id=assignment_inbox.expense_id AND o.generation=assignment_inbox.generation
));
CREATE POLICY assignment_inbox_visible ON assignment_inbox FOR SELECT TO expense_web USING (
  recipient_id=(SELECT id FROM expense_auth.current_actor()) AND company_id=(SELECT company_id FROM expense_auth.current_actor()) AND EXISTS (
    SELECT 1 FROM expense_notes en JOIN expense_notification_routes r ON r.expense_id=en.id AND r.generation=assignment_inbox.generation AND r.state='routed'
    WHERE en.id=assignment_inbox.expense_id AND en.status='pending' AND expense_auth.can_validate(en.user_id)
  )
);
CREATE POLICY assignment_inbox_read_state ON assignment_inbox FOR UPDATE TO expense_web USING (
  recipient_id=(SELECT id FROM expense_auth.current_actor()) AND company_id=(SELECT company_id FROM expense_auth.current_actor()) AND EXISTS (
    SELECT 1 FROM expense_notes en JOIN expense_notification_routes r ON r.expense_id=en.id AND r.generation=assignment_inbox.generation AND r.state='routed'
    WHERE en.id=assignment_inbox.expense_id AND en.status='pending' AND expense_auth.can_validate(en.user_id)
  )
) WITH CHECK (
  recipient_id=(SELECT id FROM expense_auth.current_actor()) AND company_id=(SELECT company_id FROM expense_auth.current_actor()) AND EXISTS (
    SELECT 1 FROM expense_notes en JOIN expense_notification_routes r ON r.expense_id=en.id AND r.generation=assignment_inbox.generation AND r.state='routed'
    WHERE en.id=assignment_inbox.expense_id AND en.status='pending' AND expense_auth.can_validate(en.user_id)
  )
);
GRANT SELECT ON expense_notification_routes,assignment_notification_outbox,assignment_inbox TO expense_notifications;
GRANT INSERT(expense_id,company_id) ON expense_notification_routes TO expense_notifications;
GRANT UPDATE(company_id,generation,signature,state,reason,checked_at) ON expense_notification_routes TO expense_notifications;
GRANT INSERT(expense_id,company_id,recipient_id,generation) ON assignment_notification_outbox TO expense_notifications;
GRANT UPDATE(state,attempts,next_attempt_at,delivered_at,last_failure_code) ON assignment_notification_outbox TO expense_notifications;
GRANT INSERT(event_id,recipient_id,company_id,expense_id,generation) ON assignment_inbox TO expense_notifications;
GRANT SELECT(expense_id,company_id,generation,state) ON expense_notification_routes TO expense_web;
GRANT SELECT ON assignment_inbox TO expense_web;
GRANT UPDATE(read_at) ON assignment_inbox TO expense_web;
CREATE TRIGGER assignment_inbox_read_once BEFORE UPDATE OF read_at ON assignment_inbox FOR EACH ROW EXECUTE FUNCTION notification_read_once();
CREATE INDEX decision_outbox_pending ON decision_notification_outbox(next_attempt_at,created_at) WHERE state='pending';
CREATE INDEX assignment_outbox_pending ON assignment_notification_outbox(next_attempt_at,created_at) WHERE state='pending';
CREATE INDEX decision_inbox_recent ON decision_inbox(recipient_id,created_at DESC,event_id DESC);
CREATE INDEX assignment_inbox_recent ON assignment_inbox(recipient_id,created_at DESC,event_id DESC);

-- Down Migration
DROP TABLE assignment_inbox;
DROP TABLE assignment_notification_outbox;
DROP TABLE expense_notification_routes;
DROP TABLE decision_inbox;
DROP TABLE decision_notification_outbox;
DROP FUNCTION notification_read_once();
DROP POLICY notification_worker_users ON users;
DROP POLICY notification_worker_notes ON expense_notes;
REVOKE SELECT(id,company_id,role,manager_id,is_active) ON users FROM expense_notifications;
REVOKE SELECT(id,user_id,status,created_at) ON expense_notes FROM expense_notifications;
