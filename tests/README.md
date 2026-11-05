# Database integration tests

Run `npm run test:integration` with PostgreSQL 17's `initdb`, `pg_ctl`, `psql`, and `createdb` on `PATH`. Alternatively set `TEST_POSTGRES_BIN` to their directory. No application `.env` or remote database is needed.

The harness creates a private cluster beneath the operating system's temporary directory, listens only on a Unix socket, and supplies its own fixture `DATABASE_URL`. Test modules reject any other connection. Tests create synthetic accounts and remove only their own records. The cluster remains running for local browser checks; `node scripts/test-db.mjs url` prints its fixture connection, and `node scripts/test-db.mjs stop` stops it.

`tests/fixtures/pre-daily-logging.prisma` is the unchanged production schema from commit `0884ab041b4c03c6b2e00157610df44d75f26a23`. The rollout test creates a separate disposable database from that schema, seeds all ten original tables, and applies `prisma/rollouts/20261006_daily_logging.sql` followed by `prisma/rollouts/20261104_claude_mcp.sql`. It compares every original column value, also seeds and preserves the four daily-logging tables and added columns, checks exact final schema parity, safe defaults and empty OAuth tables, and verifies atomic rollback after a forced failure before the MCP commit and after duplicate applications. It exercises the SQL generator `scripts/rollout-claude-mcp.mjs` in default rehearsal mode and explicit commit mode. It drops only the disposable database it created.

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

## Claude MCP browser checks

Prepare the private fixture database, then run `scripts/seed-ui-fixture.mjs` with
the fixture `DATABASE_URL` printed by `node scripts/test-db.mjs url`. Start Next
on `localhost:3091` with that same fixture URL, a test-only `AUTH_SECRET` of at
least 32 characters, `MCP_ENABLED=true`,
`MCP_PUBLIC_URL=http://localhost:3091`,
`MCP_ALLOWED_REDIRECT_URIS=http://127.0.0.1:3092/callback`, and `LLM_ENABLED=false`:

```sh
npm run dev -- --hostname localhost --port 3091
```

Supply those same environment values in a second terminal and run:

```sh
node --import tsx scripts/mcp-browser-smoke.ts
# Reseed the synthetic QA accounts before repeating with the Safari engine.
node scripts/seed-ui-fixture.mjs
MCP_TEST_BROWSER=webkit node --import tsx scripts/mcp-browser-smoke.ts
```

Install the engines with `npx playwright install chromium webkit` if needed.
The script receives OAuth redirects on a local-only callback server and submits
the consent form through the actual browser network stack. It never reconstructs
the consent POST with `route.fetch`. One account reloads the consent document
before submitting; the other submits directly after login. It checks the native
Origin header and verifies that the callback receives no referrer.
WebKit can hide the intermediate cross-site 303 response with `Frame load
interrupted`; the test permits only that exact signal and still requires the
real callback, matching state, authorization code, successful token exchange,
and correct account identity. Chromium also checks the 303 response headers.

The script verifies six flows using two separate 390px browser contexts,
including consent, isolated accounts, progress, fixture meal save/Undo, token
refresh, and revocation. Validation on 2026-11-04 passed 29 unit tests,
38 database integration tests, these six browser flows in both Chromium and
WebKit (including full-document consent reloads), and the production
build. Lint had only existing warnings. This tests a local browser and MCP
protocol client; native Claude phone-app behavior has not been tested.

## Read-only MCP model evaluation fixture

`fixtures/claude-mcp-evaluation.json` defines an entirely synthetic, fixed week.
`fixtures/claude-mcp-evaluation.xml` contains ten independent questions with
single exact answers, each requiring multiple read-tool calls. They cover
account identity, incomplete nutrition and fiber, comparisons, historical zero
snapshots, exercise kept separate from food targets, and averages over logged
dates. Answers were manually checked against this manifest: 3700 known recorded
calories across five logged dates gives 740 per logged date; two dates have no
food entries. These numbers do not establish complete actual intake.
All ten keys were also checked against actual read-only MCP responses using an
injected fixture principal. That deterministic check does not exercise a model
or OAuth; the separate browser checks cover OAuth.

To recreate it, prepare the private database and supply only its fixture
`DATABASE_URL` when running:

```sh
node scripts/seed-mcp-evaluation-fixture.mjs
```

The seeder refuses an application or remote database. It replaces only the two
named synthetic evaluation accounts, leaves other fixtures alone, and writes
their test login details to ignored `.test-state/claude-mcp-evaluation-fixture.json`.
The second account's 9000-calorie entry must never appear in the connected
`mcp-eval-jordan` account. Do not modify these accounts during an evaluation;
reseed if they have changed. Ignore the dynamic `today` field: every question
uses fixed dates, a fixed target, and the website's explicit calendar.

Use a local evaluation client with the app configured as above. Authorize the
synthetic `mcp-eval-jordan` account through its local OAuth flow requesting only
`nutrition:read`, and give that client only the three read tools. Run each XML
question in a fresh conversation and compare its final answer exactly to its
`answer` element. The MCP-builder skill's optional HTTP evaluation harness can
connect to `http://localhost:3091/api/mcp` using that fixture bearer token.
Model-based evaluations have **not** been run; the XML is an evaluation set,
not evidence of Claude Free or native mobile compatibility.

## Expanded MCP tracking validation (2026-11-05)

The MCP browser smoke now checks nine flows in each of Chromium and WebKit,
including a nutrition-only connection denied new tools, explicit opt-in on
reconnect, workout log/retry/correct/delete, unknown-calorie website rendering,
water/weight round trips, saved meals, portion corrections, and recipient-approved
buddy sharing. Each run uses isolated synthetic accounts and the native browser
callback flow described above.

The full suite has 30 unit/protocol tests and 60 database integration tests. New
integration cases cover mutation receipts, concurrent retries, stale versions,
transaction rollback, profile preservation, cross-account isolation, and
accepted-buddy locking/consent. The rollout test rehearses and applies
`20261105_mcp_tracking.sql`, verifies unchanged existing records and final Prisma
schema parity, and checks rollback after a forced failure.

These checks establish server/browser behavior, not assistant reasoning quality
or automatic tool rediscovery in an already-open Claude chat. See the ten
acceptance prompts in `docs/claude-mcp.md` for post-reconnect checks.
