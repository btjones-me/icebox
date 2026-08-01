# Icebox operations runbook

## Runtime bindings and secrets

- D1 binding: `DB`
- R2 binding: `MEDIA` (private; do not expose a public bucket URL)
- OpenAI: `OPENAI_API_KEY`, optionally `AI_MONTHLY_CAP_MICROUSD` (default `25000000`, i.e. $25) and a random `RATE_LIMIT_SALT`
- Pilot: `OPERATOR_CHATGPT_USER_ID` and/or comma-separated `PILOT_ALLOWED_EMAILS`
- Google: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_SPREADSHEET_ID`, `GOOGLE_WORKSHEET_ID`, and `GOOGLE_WORKSHEET_NAME=Inventory`

Never put secrets in source control or logs. Rotate the Google service-account key every 90 days: add a new key, update the Sites secret, verify schema and a test mirror, then revoke the previous key.

## Google Sheet setup

1. Create one private operator-owned spreadsheet and an `Inventory` worksheet.
2. Create a dedicated service account with no unrelated project roles. Do not enable domain-wide delegation.
3. Share only this spreadsheet with the service-account email as Editor.
4. Configure the fixed spreadsheet and worksheet IDs as server secrets.
5. While signed in as the configured operator, call `POST /api/operator/backup/schema` with `{"repair":true}`. This writes the fixed 23-column schema-version-2 header only when the sheet is empty, freezes it, adds a basic filter, and warning-protects the header.

The master Sheet contains every pilot household’s inventory and is visible to the operator. State that clearly in the pilot privacy notice. Images, members, invitations, preferences, and never-used empty structures are not backed up.

## Synchronisation

D1 is authoritative. Each item mutation writes the item and its complete mirror payload in one D1 batch. The Worker then tries the Sheet write after the response lifecycle. Failures leave a durable event with 1 minute, 5 minute, 30 minute, 2 hour, and 12 hour backoff. Subsequent authenticated traffic retries a small batch.

- User status: `GET /api/backup/status`
- Operator retry: `POST /api/operator/backup/retry`
- Operator schema check: `POST /api/operator/backup/schema` with `{"repair":false}`
- Operator reconciliation: `POST /api/operator/backup/reconcile`

Treat a queue older than 24 hours or any authentication/schema error as attention required. Investigate the structured error code; do not copy credentials or inventory text into logs.

## Recovery drill

Recovery is dry-run first and accepts either live Google credentials or an exported CSV:

```sh
npm run recover:sheet -- --csv Inventory.csv
npm run recover:sheet -- --csv Inventory.csv --confirm --out /secure/path/icebox-recovery.sql
```

Without `--csv`, the command reads the configured Sheet through the service account. It validates the exact headers and schema version, rejects duplicate IDs, and reports counts plus a deterministic row hash. `--confirm` emits SQL but does not apply it.

For a disposable drill:

1. Create a fresh D1-compatible database and apply `migrations/0001_initial.sql`.
2. Run the recovery dry run and record active count, tombstone count, and row hash.
3. Emit and apply the SQL to the disposable database.
4. Confirm active-item count and a canonical export hash match the dry run.
5. Confirm members, invitations, images, preferences, and empty structures are absent as expected.
6. Authenticate the intended owner, then replace each synthetic `recovery-owner-*` household owner ID with that user’s stable ChatGPT user ID and insert the owner into `household_members`. Shared members must be reinvited.

Do not apply recovery SQL to production until the dry-run report has been reviewed and the target database has been backed up.

## Incident controls

- AI labels automatically fail closed at per-user, household, IP, global, and monthly-cost limits; manual inventory remains available.

## Label schema migration

Schema version 3 renames the item `caption` field to `label` in D1, application APIs, AI structured output, and the Sheet mirror. Apply `migrations/0002_labels.sql` before starting the updated Worker. For an existing version-2 Sheet, run the operator schema repair once; it safely renames the fixed header in place. Then run reconciliation so every row is rewritten with `schema_version=3`. Keep the Sheet private throughout this process.
- Revoke the OpenAI project key immediately if exposed, then replace the Sites secret.
- Revoke the Google key if exposed; D1 writes continue and outbox events remain pending.
- R2 images are served only after household membership checks.
- Local inventory cache is user-keyed and cleared on identity change or sign-out. Offline mode is read-only.
