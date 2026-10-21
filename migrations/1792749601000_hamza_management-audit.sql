-- Up Migration
CREATE TABLE management_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  target_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  from_role text NOT NULL, to_role text NOT NULL,
  from_active boolean NOT NULL, to_active boolean NOT NULL,
  from_manager_id uuid, to_manager_id uuid
);
ALTER TABLE management_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE management_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY management_changes_hr_read ON management_changes FOR SELECT USING (EXISTS (
  SELECT 1 FROM users actor WHERE actor.id = nullif(current_setting('app.current_user_id', true), '')::uuid
    AND actor.company_id = management_changes.company_id AND actor.role = 'hr_admin' AND actor.is_active
));
CREATE POLICY management_changes_hr_append ON management_changes FOR INSERT WITH CHECK (
  actor_id = nullif(current_setting('app.current_user_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM users actor WHERE actor.id = actor_id AND actor.company_id = management_changes.company_id
      AND actor.role = 'hr_admin' AND actor.is_active
  )
);
-- Runtime grants and real restricted-role proof belong to HA-04. No UPDATE/DELETE policy.
-- Down Migration
DROP TABLE management_changes;
