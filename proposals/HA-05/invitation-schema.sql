-- DRAFT HA-05 proposal. Do not move into migrations/ or apply to an application
-- database before the identity-proof/signup contract is integrated and HA-04 supplies
-- the least-privilege access path. No application code imports this proposal.
-- Assumptions to approve: exact verified-email binding; employee-only ordinary
-- invitations; explicit expiry; first HR provisioned separately by an operator.

CREATE TABLE enrollment_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  proof_sha256 text UNIQUE CHECK (proof_sha256 ~ '^[0-9a-f]{64}$'),
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

-- Intentionally no grants, policies, runtime connection or public issuance API.
-- Stored rows contain a SHA-256 digest of a 256-bit random capability, never
-- its raw token. The issuer's authorization/identity proof remain PO-01 inputs.
