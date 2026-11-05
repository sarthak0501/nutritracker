# NutriTracker in Claude

Use the existing NutriTracker account from Claude to log a meal, check today's
totals, and review recent progress. The connector runs on the hosted NutriTracker
server, so a laptop does not need to stay on. Each person authorizes their own
login and receives access only to that account's data.

This document describes the implementation and deployment steps. It is not a
record of a completed production deployment or a successful phone connection.

## What Claude Free supports

Claude's current guidance allows **one custom remote connector on each Free
account**. Connectors can be used in Claude's iOS and Android apps. Initial
custom-connector setup is most reliable on `claude.ai`; mobile connector setup
is still described as beta. A phone browser can be used for the web setup, with
desktop web as a fallback if the setting is unavailable there.

See [custom remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
and [using connectors, including on mobile](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities).
Free account message limits still apply. NutriTracker's hosting/database limits
and its configured AI provider's API charges are separate from the Claude plan.
New meal estimates use that provider; reading existing progress does not call it.

## Connect each person's account

An administrator must first finish the deployment steps below. Use the same
public MCP URL for both people; do not create a shared login.

1. Sign in to your own Claude account at `claude.ai`. Open **Customize →
   Connectors → + Add → Add custom connector** (some versions place Connectors
   in Settings). If your Free account already has a
   custom connector, its one-connector allowance must be available.
2. Name it **NutriTracker**. Enter the URL
   `https://<your-nutritracker-host>/api/mcp`. Continue through the detected
   authentication settings. Choose **Sign in now** and, if an OAuth client
   choice is shown, **Register automatically**. Leave request headers and any
   manual client ID/client secret fields empty. This server uses automatic
   registration, rather than a Client ID Metadata Document.
3. Choose **Connect**. Claude opens NutriTracker's sign-in/permission page.
   Enter your existing NutriTracker username and password **on NutriTracker**.
   Complete your NutriTracker profile if this is a new account.
4. Check the username shown on the permission page before allowing access to
   read your nutrition data and log or undo meals. If it shows the other person's
   account, choose **Use a different NutriTracker account** and sign in with
   your own account.
5. Return to Claude. On your phone, open the Claude iOS or Android app using
   that same Claude account. Enable NutriTracker for the conversation in the
   connector/tool controls, if it is not already enabled.
6. Ask **“Which NutriTracker account am I connected to?”** Confirm the username
   before logging a meal. Then try **“Show my NutriTracker progress today.”**

The second person repeats these steps in their own Claude account and signs in
with their own NutriTracker username. They do not need an API key, OAuth secret,
or password pasted into a chat. Initial authorization opens the existing web
login; everyday use takes place in Claude.

## Everyday use

Examples:

- “Log two eggs and one slice of toast for breakfast today in NutriTracker.”
- “Show me the estimate before saving that lunch.”
- “How much protein have I logged today, and what is my target?”
- “Show my last seven days of NutriTracker progress.”
- “Undo the meal we just logged.”

Claude first prepares a meal estimate. The preparation does not save anything.
It returns the foods, portions, estimated nutrients, date, and a short-lived
save token. Claude should show the estimate and resolve uncertain portions or
dates before saving, and save only when the user has asked it to do so. The
server's receipt confirms the saved meal and updated daily totals.

An interrupted save can be retried with the same preparation token without
creating a second meal. Undo is available for 24 hours and applies only to the
signed-in person's meals saved through this connector. Use the website to
remove other entries. Retrying a save after Undo does not restore it.
An unsaved prepared estimate expires after 30 minutes. A retry of an already
saved token can still retrieve its receipt; check history before preparing
again if it is unclear whether an earlier save completed.

Dates use `America/Los_Angeles` by default, matching the existing app. Ask for
an explicit date or specify your time zone when travelling. Progress includes
only recorded data; a day without entries is not evidence that nothing was eaten.
The progress tool supports up to 31 days in one request. Target comparisons use
your current settings, rather than a history of previous target settings.

## Tools and access

| Tool | What it does | Scope |
|---|---|---|
| `nutritracker_get_account` | Shows connected account and nutrition targets | `nutrition:read` |
| `nutritracker_get_day` | Reads a day's meals, totals and targets | `nutrition:read` |
| `nutritracker_get_progress` | Reads recent daily progress | `nutrition:read` |
| `nutritracker_prepare_meal` | Estimates a meal and returns a preview; does not save | `nutrition:write` |
| `nutritracker_log_meal` | Saves a valid prepared meal once and returns updated daily progress | `nutrition:read` + `nutrition:write` |
| `nutritracker_undo_meal` | Undoes your recent connector meal batch and returns updated daily progress | `nutrition:read` + `nutrition:write` |

The authenticated connection determines the user. Tools do not accept a user ID
to switch accounts, expose passwords, or read buddy data. Account and progress
responses omit medical profile details. Data returned to Claude is handled under
the user's Claude account settings and policies. Meal estimation still uses
NutriTracker's configured AI service.

Saving and Undo require both scopes because their receipts include the current
day's log and totals. A write-only grant can prepare an estimate but cannot save
or undo until the user approves read access as well.

## Disconnect or change accounts

Open `https://<your-nutritracker-host>/connections` while signed in to
NutriTracker. Review the grants and revoke the one you no longer want. Revoking
blocks its existing access and refresh tokens immediately. Remove the connector
from Claude as well if you no longer want it listed there.

To switch NutriTracker users, revoke the old grant, sign out of NutriTracker,
and reconnect from Claude using the correct login. Merely signing out of the
website does not revoke a previously approved Claude connection.

Access tokens last one hour. Claude can renew them using rotating refresh
tokens; a refresh token lasts up to 30 days, with a connection lifetime of at
most 90 days. Expired or revoked connections require signing in again.

## Server configuration

| Variable | Setting |
|---|---|
| `MCP_ENABLED` | `false` by default. Set exactly `true` after the schema and hosting are ready. |
| `MCP_PUBLIC_URL` | The canonical origin, such as `https://nutrition.example.com`. Do not include `/api/mcp`, a query, or a fragment. HTTPS is required in production. |
| `MCP_ALLOWED_REDIRECT_URIS` | Optional comma-separated **exact** additional OAuth callback URLs. Normally leave empty. HTTPS is required in production; localhost is allowed in development. |
| `AUTH_SECRET` | Existing strong application secret, also used to sign consent and prepared-meal tokens. |
| `DATABASE_URL` | Existing NutriTracker database. OAuth grants are stored here. |
| `LLM_ENABLED`, `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | Existing meal-estimation settings. Estimation needs the configured provider to be available. |

The server provides Streamable HTTP at `/api/mcp`, protected-resource and
authorization-server metadata, registration, authorization, token exchange,
and revocation endpoints. It uses OAuth authorization code flow with S256 PKCE,
per-user consent, single-use five-minute codes, and hashed opaque tokens stored
in the database. Registration, authorization and token requests are rate limited.

The default allowed callback is exactly
`https://claude.ai/api/mcp/auth_callback`. Claude uses that callback for its web,
desktop, and mobile clients. Do not add a phone-specific URL. See
[Claude's connector authentication documentation](https://claude.com/docs/connectors/building/authentication).
The public host must be reachable by Claude's servers without deployment
protection or a private-network login in front of the OAuth discovery endpoints.
The MCP endpoint itself requires the user's OAuth access token.

## Deployment and database rollout

The repository's database predates Prisma migration history. **Do not run
`prisma db push`, a reset, or a destructive schema sync against an existing
deployment.** Use the reviewed additive SQL:
[`20261104_claude_mcp.sql`](../prisma/rollouts/20261104_claude_mcp.sql).

1. Identify the exact existing deployment and database. Take a fresh private
   database backup through its direct endpoint; verify that the archive can
   be listed and record its checksum. Keep credentials and archives out of Git.
2. Check the live schema against the currently deployed application. The daily
   logging rollout must already be present; if it is not, follow
   [its separate rollout procedure](daily-logging-rollout.md) first. Never
   blindly reapply a rollout that may already have committed.
3. Run the local unit, integration, lint, type and production-build checks.
   The rollout integration test starts from the original production schema,
   applies daily logging and MCP SQL, checks every original value and daily
   logging fixture, compares the final schema with Prisma, and tests both an
   interrupted MCP rollout and duplicate application. It uses disposable local
   PostgreSQL only. See [test setup](../tests/README.md).
4. Generate and inspect a rehearsal script with
   `node scripts/rollout-claude-mcp.mjs > /private/path/mcp-rehearsal.sql`.
   The generator does not load `.env`, connect to a database, or execute SQL.
   After checking the intended direct database connection and the backup, run
   the generated script in one private `psql` session. It executes the reviewed
   DDL with timeouts and data checks, then **rolls back**. Its preflight requires
   the exact 14-table pre-MCP schema and refuses duplicate application or
   unexpected table drift.
5. After a successful rehearsal, generate the apply script with
   `node scripts/rollout-claude-mcp.mjs --commit > /private/path/mcp-apply.sql`.
   Review it and run it once against the same intended database. The generated
   scripts enforce `ON_ERROR_STOP`, a repeatable-read transaction and
   `search_path=public,pg_catalog`. They compare counts and server-side hashes
   of all columns of the existing tables before and after the DDL and abort on
   any mismatch. They also require these six tables to start empty:
   `OAuthClient`, `OAuthConnection`,
   `OAuthAuthorizationCode`, `OAuthAccessToken`, `OAuthRefreshToken`, and
   `OAuthRateLimit`. This rollout only adds tables, indexes and foreign keys.
   It does not migrate passwords, rewrite meals, or create shared accounts.
6. Deploy the matching app with `MCP_ENABLED=false`. Confirm ordinary sign-in,
   existing history, meal logging, and the public host still work. The added
   schema is compatible with the previous application.
7. Set `MCP_PUBLIC_URL` to the final public HTTPS origin, set
   `MCP_ENABLED=true`, and redeploy. Verify public OAuth discovery and a 401
   authorization challenge from an unauthenticated `/api/mcp` request.
8. Complete the account/phone checks below. Record the deployed commit,
   host, schema outcome, and checks actually performed. A local test pass is
   not proof that the connector is live or works in a particular phone account.

The generator uses the fixed reviewed rollout file, records its SHA-256 in the
output, and replaces only its outer transaction with the guarded transaction.
Do not wrap generated scripts in another transaction. Keep the private `psql`
report, which contains per-table counts and verified hashes rather than meal
contents. The generator does not choose or validate a database host or create
backups; the operator must do those steps before execution. The backup and
before/after comparison are separate evidence. Concurrent normal writes outside
that snapshot are not included in the comparison.

### Release checks

- Each of two separate Claude Free accounts can add the connector and sign in
  with its own NutriTracker username; each phone reports the correct username.
- Each sees only its own existing daily meals and recent progress.
- A real meal requested by that person can be previewed, saved, and seen in
  NutriTracker. Retrying the same save does not add another entry. Use a fixture
  account for synthetic meals, rather than polluting a real person's history.
- Undo removes the intended batch and a retry cannot bring it back.
- Revoking one connection immediately blocks that connection while the other
  person's connection continues working.
- Token refresh and a fresh reconnect work; a valid code cannot be used twice,
  and an incorrect PKCE verifier cannot exchange it.

The local suite covers the server behavior. The native-phone checks must be
performed with the two actual Claude accounts after deployment.

### Rollback

Set `MCP_ENABLED=false` and redeploy to stop connector access. If necessary,
restore the previously verified application deployment. Keep the additive
OAuth tables and all nutrition records; do not drop tables or restore an old
backup over newer meals as an ordinary rollback. Revoke unwanted grants from
NutriTracker before re-enabling the connector.

If applying the SQL fails before commit, its transaction rolls back. If the
connection is lost and commit status is uncertain, inspect the live schema
before retrying. Duplicate application deliberately fails rather than hiding
an unexpected schema state.

## Troubleshooting

| Symptom | Check |
|---|---|
| No custom connector setting | Check the account's one-custom-connector Free allowance and try Claude's web settings. |
| Connector works on the web but is absent on the phone | Confirm the same Claude account, current app version, and connector enabled in the conversation. |
| Sign-in never opens | Confirm the public host, enabled flag, accessible discovery routes, and `/api/mcp` returning an OAuth 401 challenge. |
| Redirect or consent error | Use the canonical public origin and Claude's default callback. Reconnect from Claude rather than reusing an expired sign-in link. |
| Wrong username | Revoke the grant, sign out on the NutriTracker website, reconnect with the intended account, and check account identity again. |
| Estimate fails | Check the existing AI provider settings, quota and availability. Existing progress reads do not require an estimate. |
| Prepared meal expired | Check history if an earlier save may have completed. For an unsaved meal, prepare again and review the new estimate. |
| Authentication expired or revoked | Reconnect from Claude with the same intended NutriTracker account. |
