-- Up Migration
CREATE TABLE enrollment_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  proof_sha256 text NOT NULL UNIQUE CHECK (proof_sha256 ~ '^[0-9a-f]{64}$'),
  company_id uuid NOT NULL REFERENCES companies(id),
  issued_by uuid NOT NULL REFERENCES users(id),
  intended_email text NOT NULL CHECK (length(intended_email) BETWEEN 3 AND 254),
  invited_role text NOT NULL CHECK (invited_role = 'employee'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES users(id),
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL) = (consumed_by IS NULL)),
  CHECK (revoked_at IS NULL OR consumed_at IS NULL)
);

ALTER TABLE enrollment_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY enrollment_hr_select ON enrollment_invitations FOR SELECT USING (
  EXISTS (SELECT 1 FROM users a WHERE a.id=nullif(current_setting('app.current_user_id',true),'')::uuid
    AND a.is_active AND a.role='hr_admin' AND a.company_id=enrollment_invitations.company_id)
);

-- Down Migration
DROP TABLE enrollment_invitations;
