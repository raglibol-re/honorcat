-- 001 up (2026-11-16): retired vault table pots -> vault_pots. Also runs automatically at startup (relay/src/db.ts MIGRATIONS).
BEGIN;
SELECT count(*) AS rows_before FROM pots;
ALTER TABLE pots RENAME TO vault_pots;
ALTER INDEX IF EXISTS pots_status_idx RENAME TO vault_pots_status_idx;
SELECT count(*) AS rows_after FROM vault_pots;
COMMIT;
