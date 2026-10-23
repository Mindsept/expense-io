-- Up Migration
-- The migration connection owns DDL. Neither runtime role owns business tables.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='expense_web') THEN
    CREATE ROLE expense_web NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='expense_identity') THEN
    CREATE ROLE expense_identity NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('expense_web','expense_identity') AND
    (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit OR (rolname='expense_identity' AND rolcanlogin))) OR
    EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN ('expense_web','expense_identity')) OR
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND r.rolname IN ('expense_web','expense_identity')) THEN
    RAISE EXCEPTION 'Unsafe existing Expense.io runtime roles; review role attributes/memberships before migration.';
  END IF;
END $roles$;
CREATE SCHEMA expense_auth AUTHORIZATION expense_identity;
REVOKE ALL ON SCHEMA expense_auth FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO expense_web,expense_identity;
GRANT USAGE ON SCHEMA expense_auth TO expense_web;

-- Narrow non-login identity owner. Its permissive policies never apply to web.
GRANT SELECT ON public.users TO expense_identity;
GRANT UPDATE (name) ON public.users TO expense_identity;
GRANT INSERT (company_id,name,email,password_hash,role) ON public.users TO expense_identity;
GRANT SELECT,INSERT,UPDATE ON public.enrollment_invitations TO expense_identity;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_users_read ON public.users FOR SELECT TO expense_identity USING (true);
CREATE POLICY identity_users_lock ON public.users FOR UPDATE TO expense_identity USING (true) WITH CHECK (false);
CREATE POLICY identity_users_enroll ON public.users FOR INSERT TO expense_identity
  WITH CHECK (role='employee' AND manager_id IS NULL AND is_active);
CREATE POLICY identity_invitation_read ON public.enrollment_invitations FOR SELECT TO expense_identity USING (true);
CREATE POLICY identity_invitation_issue ON public.enrollment_invitations FOR INSERT TO expense_identity WITH CHECK (invited_role='employee');
CREATE POLICY identity_invitation_consume ON public.enrollment_invitations FOR UPDATE TO expense_identity USING (true) WITH CHECK (invited_role='employee');

-- Clear stale direct/public grants before installing the exact capability set.
DO $privileges$
DECLARE relation text; column_name text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['companies','users','expense_notes','expense_decision_history','management_changes','expense_submission_operations','expense_submission_attempts','enrollment_invitations'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM expense_web,PUBLIC',relation);
    FOR column_name IN SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=relation AND a.attnum>0 AND NOT a.attisdropped LOOP
      EXECUTE format('REVOKE ALL (%I) ON public.%I FROM expense_web,PUBLIC',column_name,relation);
    END LOOP;
  END LOOP;
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM expense_web',current_database());
END $privileges$;
REVOKE CREATE ON SCHEMA public FROM expense_web;

CREATE FUNCTION expense_auth.current_actor() RETURNS TABLE(id uuid,company_id uuid,role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
  SELECT u.id,u.company_id,u.role FROM public.users u
  WHERE u.id=nullif(current_setting('app.current_user_id',true),'')::uuid AND u.is_active
$body$;
CREATE FUNCTION expense_auth.credentials(account_email text)
RETURNS TABLE(id uuid,email text,password_hash text,role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
  SELECT u.id,u.email,u.password_hash,u.role FROM public.users u
  WHERE u.email=account_email AND length(account_email)<=254 AND u.is_active
$body$;
CREATE FUNCTION expense_auth.session_identity(account_id uuid) RETURNS TABLE(role text,email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
  SELECT u.role,u.email FROM public.users u WHERE u.id=account_id AND u.is_active
$body$;
CREATE FUNCTION expense_auth.can_validate(owner_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
  SELECT EXISTS (
    SELECT 1 FROM expense_auth.current_actor() a JOIN public.users o ON o.id=owner_id AND o.company_id=a.company_id AND o.id<>a.id
    WHERE (a.role='manager' AND o.role<>'hr_admin' AND o.manager_id=a.id) OR
      (a.role='hr_admin' AND (o.role='hr_admin' OR NOT EXISTS (
        SELECT 1 FROM public.users m WHERE m.id=o.manager_id AND m.id<>o.id AND m.company_id=o.company_id AND m.role='manager' AND m.is_active
      )))
  )
$body$;
CREATE FUNCTION expense_auth.issue_invitation(actor_id uuid,recipient text,ttl integer,invitation_hash text,address_hash text)
RETURNS TABLE(invitation_id uuid,company_id uuid,expires_at timestamptz,error_code text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE actor public.users%ROWTYPE; saved public.enrollment_invitations%ROWTYPE;
BEGIN
  IF ttl IS NULL OR ttl<60 OR ttl>604800 OR recipient IS NULL OR length(recipient)>254 OR recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR
    invitation_hash IS NULL OR invitation_hash !~ '^[0-9a-f]{64}$' OR address_hash IS NULL OR address_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::timestamptz,'invalid_input'::text; RETURN;
  END IF;
  SELECT * INTO actor FROM public.users u WHERE u.id=actor_id AND u.role='hr_admin' AND u.is_active FOR SHARE;
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::timestamptz,'issuer_forbidden'::text; RETURN; END IF;
  INSERT INTO public.enrollment_invitations(token_sha256,proof_sha256,company_id,issued_by,intended_email,invited_role,expires_at)
    VALUES(invitation_hash,address_hash,actor.company_id,actor.id,recipient,'employee',clock_timestamp()+ttl*interval '1 second') RETURNING * INTO saved;
  RETURN QUERY SELECT saved.id,saved.company_id,saved.expires_at,NULL::text;
END $body$;

CREATE FUNCTION expense_auth.revoke_invitation(actor_id uuid,invitation_id uuid)
RETURNS TABLE(id uuid,revoked_at timestamptz,error_code text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE actor public.users%ROWTYPE; saved public.enrollment_invitations%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.users u WHERE u.id=actor_id AND u.role='hr_admin' AND u.is_active FOR SHARE;
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid,NULL::timestamptz,'issuer_forbidden'::text; RETURN; END IF;
  UPDATE public.enrollment_invitations i SET revoked_at=coalesce(i.revoked_at,clock_timestamp())
    WHERE i.id=invitation_id AND i.company_id=actor.company_id AND i.consumed_at IS NULL RETURNING i.* INTO saved;
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid,NULL::timestamptz,'invitation_unavailable'::text; RETURN; END IF;
  RETURN QUERY SELECT saved.id,saved.revoked_at,NULL::text;
END $body$;

CREATE FUNCTION expense_auth.redeem_invitation(invitation_hash text,address_hash text,display_name text,hash text)
RETURNS TABLE(user_id uuid,company_id uuid,email text,error_code text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE invitation public.enrollment_invitations%ROWTYPE; created_id uuid; constraint_name text;
BEGIN
  IF invitation_hash IS NULL OR invitation_hash !~ '^[0-9a-f]{64}$' OR address_hash IS NULL OR address_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,'invitation_unavailable'::text; RETURN;
  END IF;
  IF display_name IS NULL OR length(btrim(display_name)) NOT BETWEEN 1 AND 200 OR hash IS NULL OR hash !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$' THEN
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,'invalid_input'::text; RETURN;
  END IF;
  SELECT * INTO invitation FROM public.enrollment_invitations i WHERE i.token_sha256=invitation_hash FOR UPDATE;
  IF NOT FOUND OR invitation.proof_sha256<>address_hash OR invitation.revoked_at IS NOT NULL OR invitation.consumed_at IS NOT NULL OR invitation.expires_at<=clock_timestamp() THEN
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,'invitation_unavailable'::text; RETURN;
  END IF;
  INSERT INTO public.users(company_id,name,email,password_hash,role)
    VALUES(invitation.company_id,btrim(display_name),invitation.intended_email,hash,'employee') RETURNING id INTO created_id;
  UPDATE public.enrollment_invitations i SET consumed_at=clock_timestamp(),consumed_by=created_id
    WHERE i.id=invitation.id AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='invitation_unavailable'; END IF;
  RETURN QUERY SELECT created_id,invitation.company_id,invitation.intended_email,NULL::text;
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,CASE WHEN constraint_name='users_email_key' THEN 'account_exists' ELSE 'enrollment_unavailable' END;
  WHEN raise_exception THEN
    -- The function exception block rolls back the account insert as well.
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,'invitation_unavailable'::text;
END $body$;
ALTER FUNCTION expense_auth.issue_invitation(uuid,text,integer,text,text) OWNER TO expense_identity;
ALTER FUNCTION expense_auth.revoke_invitation(uuid,uuid) OWNER TO expense_identity;
ALTER FUNCTION expense_auth.redeem_invitation(text,text,text,text) OWNER TO expense_identity;
ALTER FUNCTION expense_auth.current_actor() OWNER TO expense_identity;
ALTER FUNCTION expense_auth.credentials(text) OWNER TO expense_identity;
ALTER FUNCTION expense_auth.session_identity(uuid) OWNER TO expense_identity;
ALTER FUNCTION expense_auth.can_validate(uuid) OWNER TO expense_identity;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA expense_auth FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA expense_auth TO expense_web;

CREATE POLICY web_company_read ON public.companies FOR SELECT TO expense_web
  USING (id=(SELECT company_id FROM expense_auth.current_actor()));
CREATE POLICY web_users_read ON public.users FOR SELECT TO expense_web
  USING (company_id=(SELECT company_id FROM expense_auth.current_actor()));
-- Row locking needs UPDATE USING, including SELECT FOR SHARE by an employee.
-- Only HR may actually change a row: WITH CHECK is not run by row locks.
CREATE POLICY web_users_lock_or_update ON public.users FOR UPDATE TO expense_web
  USING (company_id=(SELECT company_id FROM expense_auth.current_actor()))
  WITH CHECK (company_id=(SELECT company_id FROM expense_auth.current_actor()) AND (SELECT role FROM expense_auth.current_actor())='hr_admin');
GRANT SELECT (id,company_id,name,email,role,manager_id,is_active,created_at) ON public.users TO expense_web;
GRANT UPDATE (role,is_active,manager_id) ON public.users TO expense_web;
GRANT SELECT ON public.companies TO expense_web;

DROP POLICY IF EXISTS expense_notes_owner_select ON public.expense_notes;
DROP POLICY IF EXISTS expense_notes_owner_insert ON public.expense_notes;
DROP POLICY IF EXISTS expense_notes_manager_select ON public.expense_notes;
DROP POLICY IF EXISTS expense_notes_manager_update ON public.expense_notes;
DROP POLICY IF EXISTS expense_notes_hr_root_manager_select ON public.expense_notes;
DROP POLICY IF EXISTS expense_notes_hr_root_manager_update ON public.expense_notes;
CREATE POLICY web_expense_read ON public.expense_notes FOR SELECT TO expense_web USING (
  user_id=(SELECT id FROM expense_auth.current_actor()) OR expense_auth.can_validate(user_id)
);
CREATE POLICY web_expense_insert ON public.expense_notes FOR INSERT TO expense_web WITH CHECK (
  user_id=(SELECT id FROM expense_auth.current_actor()) AND status='pending' AND btrim(receipt_key)<>''
);
CREATE POLICY web_expense_lock_or_decide ON public.expense_notes FOR UPDATE TO expense_web
  USING (user_id=(SELECT id FROM expense_auth.current_actor()) OR expense_auth.can_validate(user_id))
  WITH CHECK (expense_auth.can_validate(user_id) AND status IN ('approved','rejected'));
GRANT SELECT ON public.expense_notes TO expense_web;
GRANT INSERT (user_id,amount,expense_date,description,receipt_key) ON public.expense_notes TO expense_web;
GRANT UPDATE (status) ON public.expense_notes TO expense_web;
GRANT USAGE ON SEQUENCE public.expense_notes_receipt_seq_seq TO expense_web;

-- Already company/actor-aware policies remain in force; column grants are narrow.
GRANT SELECT ON public.expense_decision_history,public.management_changes,
  public.expense_submission_operations,public.expense_submission_attempts TO expense_web;
GRANT INSERT (expense_note_id,actor_id,company_id,actor_display_name,from_status,to_status)
  ON public.expense_decision_history TO expense_web;
GRANT INSERT (company_id,actor_id,target_id,from_role,to_role,from_active,to_active,from_manager_id,to_manager_id)
  ON public.management_changes TO expense_web;
GRANT INSERT (user_id,company_id,intent_key,fingerprint) ON public.expense_submission_operations TO expense_web;
GRANT UPDATE (state,current_attempt_id,lease_until,updated_at,note_id,result) ON public.expense_submission_operations TO expense_web;
GRANT INSERT (id,operation_id,user_id,company_id,extension,receipt_key) ON public.expense_submission_attempts TO expense_web;
GRANT UPDATE (state,updated_at) ON public.expense_submission_attempts TO expense_web;
GRANT SELECT (id,company_id,intended_email,created_at,expires_at,revoked_at,consumed_at)
  ON public.enrollment_invitations TO expense_web;

CREATE POLICY management_target_company ON public.management_changes AS RESTRICTIVE FOR INSERT TO expense_web
  WITH CHECK (EXISTS (SELECT 1 FROM public.users target WHERE target.id=target_id AND target.company_id=management_changes.company_id));
CREATE POLICY operation_result_scope ON public.expense_submission_operations AS RESTRICTIVE FOR ALL TO expense_web
  USING (true) WITH CHECK (
    (note_id IS NULL OR EXISTS (SELECT 1 FROM public.expense_notes note WHERE note.id=note_id AND note.user_id=(SELECT id FROM expense_auth.current_actor()))) AND
    (result IS NULL OR (result->>'userId'=(SELECT id::text FROM expense_auth.current_actor()) AND result->>'id'=note_id::text))
  );

-- No DELETE/TRUNCATE, password-table read, schema CREATE, role membership or
-- blanket function execution is granted to the web role. Provision LOGIN/password
-- independently with the explicit administrator CLI; the migration adds no secret.

-- Down Migration
-- Fail closed for web access; preserve every business record. Administrator
-- rollback requires stopping web processes before switching application revisions.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM expense_web;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM expense_web;
DO $columns$
DECLARE relation text; column_name text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['companies','users','expense_notes','expense_decision_history','management_changes','expense_submission_operations','expense_submission_attempts','enrollment_invitations'] LOOP
    FOR column_name IN SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=relation AND a.attnum>0 AND NOT a.attisdropped LOOP
      EXECUTE format('REVOKE ALL (%I) ON public.%I FROM expense_web,expense_identity',column_name,relation);
    END LOOP;
  END LOOP;
END $columns$;

REVOKE ALL ON SCHEMA expense_auth FROM expense_web;
DROP POLICY IF EXISTS management_target_company ON public.management_changes;
DROP POLICY IF EXISTS operation_result_scope ON public.expense_submission_operations;
DROP SCHEMA expense_auth CASCADE;
DROP POLICY IF EXISTS web_company_read ON public.companies;
DROP POLICY IF EXISTS web_users_read ON public.users;
DROP POLICY IF EXISTS web_users_lock_or_update ON public.users;
DROP POLICY identity_users_read ON public.users;
DROP POLICY identity_users_lock ON public.users;
DROP POLICY identity_users_enroll ON public.users;
DROP POLICY identity_invitation_read ON public.enrollment_invitations;
DROP POLICY identity_invitation_issue ON public.enrollment_invitations;
DROP POLICY identity_invitation_consume ON public.enrollment_invitations;
REVOKE ALL ON public.users,public.enrollment_invitations FROM expense_identity;
-- RLS remains enabled. Reversing isolation must not silently restore the unsafe
-- baseline policies. NOLOGIN roles are retained because roles are cluster-wide.
