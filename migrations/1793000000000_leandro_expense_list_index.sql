-- Up Migration
-- LE-09: measured equality filters on the expense author and pending status.
-- Does not attempt to eliminate sorting of the shared aggregate/page CTE.
CREATE INDEX leandro_expense_owner_status_idx ON expense_notes (user_id, status);

-- Down Migration
DROP INDEX leandro_expense_owner_status_idx;
