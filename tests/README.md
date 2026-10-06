# Database integration tests

Run `npm run test:integration` with PostgreSQL 17's `initdb`, `pg_ctl`, `psql`, and `createdb` on `PATH`. Alternatively set `TEST_POSTGRES_BIN` to their directory. No application `.env` or remote database is needed.

The harness creates a private cluster beneath the operating system's temporary directory, listens only on a Unix socket, and supplies its own fixture `DATABASE_URL`. Test modules reject any other connection. Tests create synthetic accounts and remove only their own records. The cluster remains running for local browser checks; `node scripts/test-db.mjs url` prints its fixture connection, and `node scripts/test-db.mjs stop` stops it.

`tests/fixtures/pre-daily-logging.prisma` is the unchanged production schema from commit `0884ab041b4c03c6b2e00157610df44d75f26a23`. The rollout test creates a separate disposable database from that schema, seeds all ten original tables, applies `prisma/rollouts/20261006_daily_logging.sql`, and compares every original column value. It also checks exact schema parity, safe defaults, empty new tables, and atomic failure on repeated application. It drops only the disposable database it created.

The meal tests exercise PostgreSQL transactions, concurrent duplicate saves, Undo and retry tombstones, historical nutrition snapshots including zeros, ownership checks, recipient consent and independent portions, conflicting proposal responses, and mutual opt-in visibility. Expected concurrent unique-constraint errors may appear in Prisma's logs while the retry-handling assertions pass.

For a locally extracted PostgreSQL distribution, `TEST_POSTGRES_CLIENT_ENV` may point to a JSON file of library-loader environment settings. `TEST_POSTGRES_SHARE` and `TEST_POSTGRES_LIBRARY` optionally locate its initialization resources. These settings are for fixture infrastructure only.

## Browser smoke test

Build the app, prepare the fixture database, seed the synthetic QA accounts with
`scripts/seed-ui-fixture.mjs`, and start the app on `localhost:3091` using the fixture
URL printed by `node scripts/test-db.mjs url`, a test-only `AUTH_SECRET`, and
`LLM_ENABLED=false`. Supply that same fixture `DATABASE_URL` when running
`node scripts/browser-smoke.mjs`. The script refuses remote origins/databases and
checks the database has no TCP listener. It uses the installed Playwright browser
(or Chrome channel) and records reports/screenshots in ignored `.test-state/browser/`.
It covers real mobile login, zero-nutrition saves/Undo, legacy portion repeats,
pinned meals, recipient consent, weekly opt-in, draft expiry, 316px layouts,
cross-tab logout, and server rejection of stale-account forms with storage blocked.

Release validation on 2026-10-06: 20 unit tests, 12 PostgreSQL integration tests
(including the additive rollout), and 11 browser scenarios passed. TypeScript,
ESLint (with existing warnings), and the production build passed. Known-meal
browser flows made no estimate requests, external requests, or page errors.
