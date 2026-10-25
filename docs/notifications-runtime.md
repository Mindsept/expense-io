# HA-09 — durable in-app notifications

Hugo's product decision was relayed directly by Hamza on 25 October 2026: every active eligible HR in the same company is notified, excluding the author. The first committed decision wins; peers see the note as already processed. Without any eligible HR the note stays pending with a visible explanation. Self-approval is forbidden and the normal assigned-manager circuit is unchanged. This supersedes the 23 October arbitration hold and exclusive-recipient proposal.

## Decision and assignment behavior

The published composition preserves LE-08's observer and appends the notification intent on HA-03's transaction client. Decision, history and intent commit or roll back together. No channel/network operation runs in that transaction. The restricted worker writes the inbox and delivery acknowledgement atomically, with unique event/recipient keys preventing duplicates on replay.

Discovery rotates through batches of 25 pending notes. An active assigned same-company manager receives the assignment unless the author is HR. Otherwise every currently eligible HR receives it, excluding the author; no exclusive recipient map or arbitrary two-person limit applies. The sorted recipient set forms the routing generation. An empty set remains `routing_pending / no_active_validator`. Each changed generation creates one event per recipient in one SQL statement. Delivery remains bounded to 25 assignments per cycle and rechecks eligibility, company, generation and pending status. Existing delivered assignment notifications remain visible as processed after a decision, subject to current authorization. Lost rights immediately hide the notification and refuse read commands. The original transaction lock ensures competing real HTTP decisions produce one success and one conflict, one history row and one author-notification intent.

## Web contract

The authenticated `/notifications` page uses the actual limited `expense_web` connection and current actor. `notificationInbox(client, actor)` returns at most 50 currently visible records, newest first:

```ts
type InboxItem = {
  eventId: string
  expenseId: string
  kind: 'decision' | 'assignment'
  decision: 'approved' | 'rejected' | null
  expenseStatus: 'pending' | 'approved' | 'rejected'
  createdAt: string // ISO timestamp
  readAt: string | null
  href: '/expenses' | '/manager' | '/hr'
}
```

`markNotificationRead(previous, form)` accepts only `eventId` and `kind`. The authenticated ID, company and role are reloaded on the server. It returns `{ readAt }` on success or a bounded `{ error }`. A database trigger fixes the first server read timestamp; retries cannot clear or rewrite it. It changes neither decision nor worker acknowledgement. The UI displays persisted read state, pending state and current-rights refusal. Fixed links lead to the appropriate existing list; their destination authorization still applies. No receipt URL, email, amount, description, password or invitation capability is copied to an inbox. This is a server-page/server-action contract, **not a new REST API**; the existing OpenAPI route inventory is unchanged. EL-06 can reuse this contract; its separate review is not implied by these tests.

## Separate database identities and migration

Apply `1792764002000_hamza_notifications.sql` through the separate migration administrator after HA-04. It creates five tables with ENABLE/FORCE RLS, policies and narrow column grants together. The web role can append and confirm its real decision intent, read its currently authorized inbox and update only `read_at`. It cannot create assignments, maintain outbox state, alter metadata or truncate/delete tables.

`expense_notifications` is a separately provisioned non-owner, NOSUPERUSER/NOBYPASSRLS login with no membership/admin/schema privileges. It can read only routing identity/status metadata, not passwords, receipts, amounts, email or names; it cannot decide notes or mutate users. It receives the required queue/inbox capabilities. `assertNotificationWorker` checks its actual current/session identity, flags, memberships, ownership, dangerous privileges and callable SECURITY DEFINER routines. The web startup guard requires all 13 protected tables. Never supply migration/admin credentials to either application process.

Provision the worker password with `node scripts/notifications/provision-worker-cli.mjs --apply`, private `HA09_ADMIN_DATABASE_URL` and the generated password on stdin. The command accepts only this explicit administrator operation and logs no credentials. Configure the resulting private worker URL separately, then remove administrator variables from its environment. No `.env` is loaded and there is no administrator/web URL fallback.

## Operation and recovery

With only private `NOTIFICATION_WORKER_DATABASE_URL` configured:

```sh
node scripts/notifications/worker.mjs --once
node scripts/notifications/worker.mjs --serve
node scripts/notifications/worker.mjs --failed
node scripts/notifications/worker.mjs --routing
node scripts/notifications/worker.mjs --requeue decision EVENT_UUID COMPANY_UUID
node scripts/notifications/worker.mjs --requeue assignment EVENT_UUID COMPANY_UUID
```

The worker is compatible with the repository's Node 24 runtime and uses native TypeScript stripping for the type-only module imports. `--serve` repeats bounded scans/processing with a one-second pause. Each cycle processes at most 25 decisions and 25 assignments; statements are limited to five seconds and idle transactions to ten seconds. SIGINT/SIGTERM stop the loop and close the pool. An external process supervisor can restart an exited worker; shared orchestration belongs to Mathis and is not silently edited here. Run it as a separate service with a restart policy and its private URL, independently of web instances and migration jobs.

Delivery uses `FOR UPDATE SKIP LOCKED`, five attempts and 60 seconds between failed attempts. Failed events retain attempts and static `delivery_failed`; private `--failed` lists at most 100 actionable event/company/note IDs. `--routing` lists at most 100 unresolved attribution reasons. These commands are private operator tools, not web endpoints or public logs. Explicit `--requeue` requires kind/event/company and changes only a matching failed event; it never resends a delivered event. This is an operator capability, not an unimplemented HR web permission. Successful loop output contains aggregate counters only; failures never log raw DB causes or payloads.

Stopping a worker leaves committed intents pending. Losing a session before commit rolls back inbox/acknowledgement together and releases the row lock. Restart resumes safely. A channel outage cannot undo an already committed business decision. A failure to persist its transactional intent correctly aborts the decision; the two cases are distinct. No automatic retention deletion is introduced: preserve traceable history until a retention policy is agreed.

Before rolling this migration down, stop workers and web instances using these tables and export required notification evidence. Down removes only the five notification/routing tables, their trigger/function and worker metadata policies/grants; it preserves business rows and the global role definition. Rolling down intentionally removes notification state. Do not run this procedure on a real database as part of tests.

## Proof and remaining acceptance

`tests/api/hamza/HA-09/runtime-notifications.spec.ts` uses a random newly created disposable DB, actual restricted web/worker logins, a real production Next process and the actual worker CLI. It exercises real HTTP submission/decision, assignment/reassignment, all-eligible-HR fanout, concurrent first-decision wins, self-exclusion and no-eligible-HR explanation, channel outage/terminal state/private replay, immutable read state, foreign/grant refusals, concurrent reservations and session-loss recovery. The browser suite under `tests/e2e/hamza/HA-09` checks actual UI delivery/read persistence and loss of assignment visibility. The original proposal tests remain historical preparation; they are not substituted for these real-role tests. HA-04 migration down/up regression now accounts for the later notification migration.

Reproduce with `npm ci && npm run test:ci`; tests refuse personal/non-loopback/non-test targets and use owned disposable Docker services. Current sanitized evidence is under `docs/evidence/HA-09-Runtime-2026-10-25/` (664 unit, 239 API, 27 E2E on Node 24.22.1); 23 October evidence remains historical. No real notification/email, deployed credential or personal database has been modified. See PR #9 for the final local/remote CI results and current acceptance evidence.
