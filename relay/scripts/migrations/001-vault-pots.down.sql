-- 001 down: undo the rename. Deploy the code from tag pre-cleanup first (it reads `pots`), then run this.
BEGIN;
ALTER TABLE vault_pots RENAME TO pots;
ALTER INDEX IF EXISTS vault_pots_status_idx RENAME TO pots_status_idx;
SELECT count(*) AS rows_after_rollback FROM pots;
COMMIT;
