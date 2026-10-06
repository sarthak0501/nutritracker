# Daily logging rollout

This release adds named whole-meal shortcuts, recent-meal repeats, portion review,
recipient-approved meal sharing, optional weekly check-ins, expiring local drafts,
and atomic, retry-safe logging with 24-hour Undo. It does not change the configured
AI provider/model or add a paid service. Repeating known meals makes no AI call.

## Existing data

The original database has no Prisma migration baseline. The reviewed SQL is
[`20261006_daily_logging.sql`](../prisma/rollouts/20261006_daily_logging.sql).
It adds three columns and four tables; it never rewrites existing nutrition,
history, profiles or buddy relationships. Existing ambiguous AI quantities remain
labelled as recorded portions. New estimates must provide grams. Copies and
portion changes use the original entry's nutrient snapshots.

The new `Profile.cooperativeCheckInEnabled` column defaults to false for everyone.
Only the signed-in person can change their preference. A meal proposal creates no
recipient log entry until that recipient accepts it with their own portions.

## Deploy order

1. Verify the target is the active AWS Oregon database. Use its direct endpoint
   for a fresh custom-format `pg_dump`; keep the archive private, verify its
   listing and record its SHA-256. Never commit a connection URL or backup.
2. Run `npm test`, `npm run test:integration`, `npm run lint`,
   `npm run typecheck`, `npm run build`, and the fixture browser smoke test.
   Integration tests rehearse the SQL on the original schema, verify existing
   values, compare the resulting schema and reject a duplicate application.
3. Inspect the SQL. It has its own `BEGIN`/`COMMIT`, with a 3-second lock timeout
   and 60-second statement timeout. A timeout must leave the old schema intact.
   Do not nest this unchanged file inside another transaction. If applying with
   a transaction API, remove only its transaction boundaries and execute the
   reviewed DDL inside that single transaction.
4. Before commit, compare counts and server-side hashes of **all original columns**
   of every existing table in the same repeatable-read transaction. Including new
   columns would falsely report data changes. Verify the new tables are empty and
   all cooperative preferences are false. Roll back if any assertion fails.
   Set the transaction's search path to `public, pg_catalog`.
5. Commit the schema, then deploy the matching app commit. The old app remains
   compatible with this additive schema. Main is the Vercel production branch;
   merging the PR starts production deployment.
6. Confirm the exact Git commit is Ready and serves the public alias. Check login,
   Today, History, Buddy, profile, trends and workouts; verify a previously known
   historical day and monitor runtime errors. Check the installation manifest and
   icons are public. Do not leave synthetic meal entries in real accounts.

Concurrent normal user writes outside the comparison snapshot are not covered by
the before/after attestation; the additive DDL does not overwrite them. Keep the
fresh backup evidence separate from this transaction's row comparison.

## Rollback and uncertainty

If the app fails after schema success, restore the previously Ready Vercel
deployment (`0884ab041b4c03c6b2e00157610df44d75f26a23` for this rollout).
Keep the additive schema and all newly entered records. Do not drop the new
tables or restore an old archive over newer writes as routine rollback.

If a connection or report-file write fails after commit may have happened,
inspect the live schema before any retry. The SQL is deliberately not silently
idempotent: a second application fails atomically rather than hiding drift.

The retired Azure source and its migration backup remain preserved. This release
does not delete the source or change model, plan, billing or account credentials.

## Local drafts

Drafts contain meal text and estimates in browser local storage, scoped to the
account, date and mode, and expire 24 hours after the last edit. Reading does not
extend their lifetime. Logout/discard clears them; cross-tab account changes
clear drafts and hide the stale page until reload. Storage failures do not block
online saves. Each logging action also checks the rendered account ID against
the authenticated account before writing, even when browser storage is disabled.

There is no service worker caching private pages, offline save queue, background
reminder, or automatic buddy logging. A lost save response keeps the same request
ID for a safe retry; Undo retains a tombstone so that retry cannot restore it.
