# NutriTracker in Claude

Use the existing NutriTracker account from Claude to track meals, workouts,
water and body weight, review progress, and exchange meal proposals with accepted
buddies. The connector runs on the hosted NutriTracker
server, so a laptop does not need to stay on. Each person authorizes their own
login and receives the access granted to that account, including accepted-buddy
views when buddy permissions are approved.

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
4. Check the username and requested permissions shown on the permission page.
   If optional feature boxes appear, select the capabilities you want: **Workouts**,
   **Water and body weight**, **Saved meals and corrections**, and **Buddy logs
   and meal sharing**. Each box explains the additional read/write access. Choose **Allow
   connection** after reviewing your selection. If it shows the other person's
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

### Upgrade an existing connection

After the tracking release is deployed and verified, each person should reconnect
NutriTracker from their own Claude account, sign in with their own NutriTracker
login, and approve the additional capabilities. Keep the same connector URL.
The permission page offers the four unchecked feature boxes above even when
Claude sends its cached nutrition-only scope request. Select all four to enable
all additions. If Claude requests expanded permissions directly, the page lists
them under **Allow this assistant to** instead of duplicating optional boxes.

Existing connections keep their granted permissions. Deployment, token refresh,
and leaving optional boxes unchecked never expand access. An old connection can
continue using its nutrition tools; a new tool requiring additional permission
returns a reconnect instruction. Start a new Claude conversation after reconnecting
so the assistant can discover the updated tool list. If necessary, disconnect and
connect again under **Customize → Connectors**. Review granted access in
NutriTracker's **Connected assistants** page.

## Everyday use

Examples:

- “Log two eggs and one slice of toast for breakfast today in NutriTracker.”
- “Show me the estimate before saving that lunch.”
- “How much protein have I logged today, and what is my target?”
- “Show my last seven days of NutriTracker progress.”
- “Undo the meal we just logged.”
- “Log the bench press I just completed: 3 sets of 10 at 40 kg.”
- “What weights and reps did I record for shoulder press last month?”
- “Add two glasses of water today.”
- “Record today's weigh-in as 76.2 kg.”
- “Log half of my saved usual breakfast.”
- “Send these lunch items to my buddy for them to review.”
- “Show my accepted buddy's food and workouts for today.”

Claude first prepares a meal estimate. The preparation does not save anything.
It returns the foods, portions, estimated nutrients, date, and a short-lived
save token. Claude should show the estimate and resolve uncertain portions or
dates before saving, and save only when the user has asked it to do so. The
server's receipt confirms the saved meal and updated daily totals.

An interrupted save can be retried with the same preparation token without
creating a second meal. Undo is available for 24 hours and applies only to the
signed-in person's meals saved through this connector. With the additional meal
permissions, Claude can correct or remove other food entries after reading their
current versions. Retrying a save after Undo does not restore it.
An unsaved prepared estimate expires after 30 minutes. A retry of an already
saved token can still retrieve its receipt; check history before preparing
again if it is unclear whether an earlier save completed.

Dates use `America/Los_Angeles` by default, matching the existing app. Ask for
an explicit date or specify your time zone when travelling. Progress includes
only recorded data; a day without entries is not evidence that nothing was eaten.
The progress tool supports up to 31 days in one request. Target comparisons use
your current settings, rather than a history of previous target settings.

Workouts use structured completed exercises: sets, reps, load in kilograms, and/or
duration. Claude should clarify units and whether dumbbell load is per hand.
Workout calories are optional; only a figure supplied by the person or their
device is logged. Missing calories remain unknown and exercise calories do not
increase food targets. Workout and water/weight history support up to 366 days;
workout queries disclose truncation and can be narrowed by date or exercise.
Weight tools record dated weigh-ins only; they do not change profile settings or
recalculate nutrition targets. Water is stored in glasses with no assumed volume.

There is no separate “repeat session” or “weekly summary” tool. Claude composes
these tasks from history reads, the ordinary logging tools, and nutrition progress.
Reading a previous workout does not save it; a plan becomes a log only when the
person confirms completing it. A combined summary must distinguish unknown days
and truncated results from complete records.

New writes use a unique request ID with a durable account-scoped receipt. Retry
the exact ID and arguments after an interrupted request. A different correction
needs a new request ID. Edits require the record version or current measurement
read from the server; if it changed, reread and confirm the intended change.
Sharing sends only selected meal details to an accepted buddy. The recipient
chooses their own portions, date and meal type before accepting; sending alone
never adds entries to their log.

## Tools and access

The server exposes 23 tools. Requested permissions are checked on every call.

| Tool | What it does | Scope |
|---|---|---|
| `nutritracker_get_account` | Shows connected account and nutrition targets | `nutrition:read` |
| `nutritracker_get_day` | Reads a day's meals, totals and targets | `nutrition:read` |
| `nutritracker_get_progress` | Reads recent daily progress | `nutrition:read` |
| `nutritracker_prepare_meal` | Estimates a meal and returns a preview; does not save | `nutrition:write` |
| `nutritracker_log_meal` | Saves a valid prepared meal once and returns updated daily progress | `nutrition:read` + `nutrition:write` |
| `nutritracker_undo_meal` | Undoes your recent connector meal batch and returns updated daily progress | `nutrition:read` + `nutrition:write` |
| `nutritracker_get_workouts` | Reads bounded exercise history and recorded totals | `workouts:read` |
| `nutritracker_log_workout` | Logs completed exercises with optional supplied calories | `workouts:read` + `workouts:write` |
| `nutritracker_update_workout` | Corrects one exercise using its current version | `workouts:read` + `workouts:write` |
| `nutritracker_delete_workout` | Removes an explicitly identified exercise | `workouts:read` + `workouts:write` |
| `nutritracker_get_measurements` | Reads water glasses and body-weight history | `wellness:read` |
| `nutritracker_set_water` | Sets a dated water total after checking the current total | `wellness:read` + `wellness:write` |
| `nutritracker_set_weight` | Records or corrects a dated weigh-in | `wellness:read` + `wellness:write` |
| `nutritracker_delete_weight` | Deletes a dated weigh-in after checking its value | `wellness:read` + `wellness:write` |
| `nutritracker_get_saved_meals` | Lists reusable meals with saved portions and nutrition | `meals:read` |
| `nutritracker_save_meal_preset` | Saves a reusable meal from existing entries or a preset | `meals:read` + `meals:write` + `nutrition:read` |
| `nutritracker_remove_meal_preset` | Removes a preset while retaining existing food logs | `meals:read` + `meals:write` |
| `nutritracker_log_existing_meal` | Logs a preset or selected existing items with chosen portions | `meals:read` + `nutrition:read` + `nutrition:write` |
| `nutritracker_correct_meal_entries` | Scales, moves, renames or removes current food entries | `meals:write` + `nutrition:read` + `nutrition:write` |
| `nutritracker_get_buddy_meals` | Lists accepted buddies and pending incoming meal proposals | `sharing:read` |
| `nutritracker_get_buddy_day` | Reads an accepted buddy's daily food and workout logs under the existing buddy relationship | `sharing:read` |
| `nutritracker_share_meal` | Sends selected meal details to an explicitly chosen accepted buddy | `sharing:read` + `sharing:write` + `nutrition:read` |
| `nutritracker_respond_shared_meal` | Accepts or declines an incoming proposal; acceptance logs chosen portions | `sharing:read` + `sharing:write` + `nutrition:read` + `nutrition:write` |

The authenticated connection determines the user. Tools do not accept a user ID
to switch the authenticated account or expose passwords. The buddy-day tool
accepts an explicitly selected buddy ID and checks that the signed-in person has
an accepted buddy relationship before returning daily food/workout logs. Buddy
access also includes accepted buddy identities and permitted meal proposals.
Private buddy profiles, water and body weights are not returned. Account and progress
responses omit medical profile details. Data returned to Claude is handled under
the user's Claude account settings and policies. Meal estimation still uses
NutriTracker's configured AI service.

Saving and Undo require both scopes because their receipts include the current
day's log and totals. A write-only grant can prepare an estimate but cannot save
or undo until the user approves read access as well. Each new capability has
separate read/write scopes, and cross-capability operations require every scope
listed above.

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

### Existing MCP deployment: tracking upgrade

The expanded tools also require
[`20261105_mcp_tracking.sql`](../prisma/rollouts/20261105_mcp_tracking.sql).
This upgrade adds the `McpMutation` receipt table and allows an unknown
`WorkoutEntry.caloriesBurned` value. Existing rows, calorie values, OAuth grants,
and user accounts are preserved. Apply the schema before deploying the expanded
tools. For a fresh installation, apply the original daily-logging and MCP rollouts
first, then this upgrade.

1. Verify the exact target deployment/database and take a fresh private backup
   through its direct endpoint. Verify the archive and record its checksum.
2. Run the local checks documented in [tests/README.md](../tests/README.md),
   including the complete schema rollout and the expanded browser consent flow.
3. Generate `node scripts/rollout-mcp-tracking.mjs > /private/path/tracking-rehearsal.sql`.
   Review it, then run it through `psql` against the verified direct connection.
   It requires the exact 20-table pre-tracking schema, compares counts and hashes
   of every existing table, checks the new table is empty, and rolls back.
4. After a successful rehearsal, generate
   `node scripts/rollout-mcp-tracking.mjs --commit > /private/path/tracking-apply.sql`.
   Review and run it once against the same database. Retain the private report.
   The generator itself never reads credentials or connects to a database.
5. Deploy the matching application. Existing connections retain their original
   scopes. Verify the new 23-tool surface, old-grant permission restrictions,
   native mobile-sized consent submission, and synthetic-account write/retry
   and isolation behavior. Clean up only those exact synthetic records.
6. Only after live verification, tell each person to reconnect and select the
   additional feature boxes. Test their actual Claude phone conversations.

Do not rerun the original MCP rollout on a database where it already exists.
Tracking rollout scripts refuse duplicate application. If commit status is
uncertain, inspect the schema before retrying. Never wrap generated scripts
in another transaction. The previous app's handling of nullable workout calories
must be checked before restoring an older deployment; disabling MCP on the
current compatible app is the immediate access rollback.

### Initial MCP installation

1. Identify the exact existing deployment and database. Take a fresh private
   database backup through its direct endpoint; verify that the archive can
   be listed and record its checksum. Keep credentials and archives out of Git.
2. Check the live schema against the currently deployed application. The daily
   logging rollout must already be present; if it is not, follow
   [its separate rollout procedure](daily-logging-rollout.md) first. Never
   blindly reapply a rollout that may already have committed.
3. Run the local unit, integration, lint, type and production-build checks.
   The rollout integration test starts from the original production schema,
   applies daily logging, MCP and tracking SQL, checks every original value and daily
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
6. Apply the tracking upgrade above before deploying the expanded application.
   Deploy the matching app with `MCP_ENABLED=false`. Confirm ordinary sign-in,
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
- Old grants cannot call newly scoped tools. A fresh consent grants only the
  requested permissions plus checked signed optional offers; refresh cannot add scopes.
- Exercise and measurement writes are isolated, duplicate-safe and reject stale
  corrections. Omitted workout calories remain unknown; weigh-ins do not change
  profile settings.
- Saved-meal logging preserves stored nutrition. Meal corrections preserve
  nutrition provenance and delayed retries cannot restore deleted records.
- Sharing requires an accepted buddy and explicit intent; only the recipient's
  acceptance writes their food entries. Declining or removing the buddy cannot
  be bypassed by another account.
- Accepted buddy daily views match the website's food/workout access. Pending,
  removed and unrelated buddies are rejected; private profiles, water and body
  weights are excluded.

The local suite covers the server behavior. The native-phone checks must be
performed with the two actual Claude accounts after deployment.

### Acceptance prompts for the expanded connector

These are evaluation prompts and expected behaviors, not a record of successful
Claude conversations. Run write prompts using synthetic accounts with known
fixture records and an accepted synthetic buddy. Local tests exercise the server
invariants; assistant tool selection and phone behavior need separate validation.

| Prompt | Expected behavior |
|---|---|
| “I completed 3 sets of 10 bench presses at 40 kg today. Log it; I don't have a calorie number.” | Logs the completed exercise with unknown calories. A retry returns the original receipt without another exercise. |
| “Show my last shoulder-press workout, compare it with the previous one, then log the same exercises I completed today at 2 kg heavier.” | Reads workout history, checks the intended entries and units, and uses normal workout logging. No repeat-session tool or invented history. |
| “Plan a leg workout for tomorrow.” | Can discuss a plan; does not write completed workouts or measurements for a future date. |
| “That bench press was 30 kg, not 40 kg. Correct it.” | Reads the current entry, identifies it unambiguously, and uses its version for the correction. A stale version prompts a reread. |
| “Add two glasses of water today. The connection timed out—try the same save again.” | Reads the current total, sets total plus two with its precondition, and reuses identical request ID/arguments so it adds only two. |
| “Record 76.2 kg today and show my weight trend.” | Reads existing measurements, saves the dated weigh-in, and reads bounded history. Profile settings and nutrition targets are unchanged. |
| “Save this logged breakfast as My breakfast, then log half of it for today's actual lunch.” | Creates a preset from owned entries, logs the selected portion once, and preserves existing nutrition snapshots without re-estimation. |
| “I ate half the rice shown in today's lunch. Fix the portion, then remove the duplicate yogurt entry.” | Reads entry IDs/versions, scales the current rice portion and nutrition together, and removes only the selected yogurt. Retried changes do not apply twice. |
| “Show my accepted buddy's food and workouts today, then send only the dal from my lunch to that buddy.” | Reads only the accepted buddy's permitted food/workout records. Requires explicit sharing; excludes private profiles, water, body weights and unselected meal items. No recipient log changes until that account accepts its chosen portion/date/meal. |
| “Summarize my food, workouts, water and weight for the last seven days.” | Combines progress, workout and measurement reads; identifies missing days and truncation, keeps estimated exercise calories separate from food targets, and does not infer unlogged days were rest/fasting days. |

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
| New tools ask for additional permissions | Reconnect, review the permission page, and select the optional capability boxes you want. Existing grants never gain scopes through refresh. |
| Claude cannot see a newly deployed tool | Start a fresh conversation after reconnecting and check that the connector is enabled. |
| Correction says the record changed | Read the current record and confirm the intended change, then use a new request ID. Do not overwrite using the old version. |
