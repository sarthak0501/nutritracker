# NutriTracker

**AI-assisted nutrition tracking with social accountability.**

Log meals in plain English, hit macro targets, and stay consistent — with an AI coach that knows your allergies, health conditions, and goals, plus a buddy feed that keeps you accountable.

Built as an open base app: fork it, deploy your own on free tiers, and build whatever you want on top.

---

## What makes it different

Most nutrition apps are calorie calculators. NutriTracker is an **AI nutrition coach with a social layer**:

- **Health-aware AI suggestions** — meal recommendations that respect your allergies, dietary restrictions, and pre-existing conditions (diabetes, hypertension, IBS, etc.)
- **Buddy accountability** — share your daily log with friends, react to each other's meals, see who's on track
- **Zero-friction logging** — describe what you ate in plain English, AI estimates macros instantly
- **Habit-first design** — copy yesterday's meals, quick-log frequent foods, track water and workouts alongside nutrition
- **Meal grading** — every meal gets an A/B/C/D grade based on how well it fits your remaining daily budget

## Core features

| Area | What you get |
|---|---|
| **Logging** | AI text estimation, manual entry, barcode + Open Food Facts, copy-yesterday, frequent-foods |
| **Health profile** | Allergies, dietary restrictions, health conditions — AI honours them in all suggestions |
| **Targets** | Calories, protein, carbs, fat, fiber. Presets for lose/maintain/build/health |
| **Water & workouts** | Built-in trackers; workouts get AI calorie estimates |
| **Buddies** | Shared daily feed, reactions (👍 👎 🔥 💪), leaderboard |
| **Insights** | Weekly summaries, monthly review, weight & calorie trends, heatmap history |

## Tech stack

- **Next.js 15** (App Router, React Server Components)
- **Prisma + Neon Postgres** (serverless PostgreSQL)
- **NextAuth 5** (username/password, JWT sessions)
- **Tailwind CSS** + **Recharts**
- **Anthropic or OpenAI** (pluggable LLM — pick either)

---

## Fork & deploy your own

Everything below can be done on free tiers. Rough time to go from zero to a live, personal NutriTracker: **~20 minutes.**

### Prerequisites

| Account | Purpose | Free tier? |
|---|---|---|
| [GitHub](https://github.com/) | Fork the repo | ✅ |
| [Neon](https://neon.tech/) | Postgres database | ✅ |
| [Vercel](https://vercel.com/) | Hosting | ✅ |
| [Anthropic](https://console.anthropic.com/) *or* [OpenAI](https://platform.openai.com/) | LLM for AI features | ⚠️ Anthropic gives a small free credit; OpenAI is pay-as-you-go |

Plus `node >= 20` and `git` locally if you want to run it on your machine.

---

### 1. Fork the repo

Click "Fork" on GitHub, then clone your fork:

```bash
git clone https://github.com/<your-username>/nutritracker
cd nutritracker
npm install
```

### 2. Create the Postgres database (Neon)

1. Sign in to [neon.tech](https://neon.tech/) and create a new project.
2. In the project dashboard, copy the **pooled** connection string (starts with `postgresql://...?sslmode=require`).
3. Save it — you'll paste it as `DATABASE_URL` in two places (local `.env` and Vercel).

### 3. Get an LLM API key

Pick **one** provider:

**Option A — Anthropic (recommended, Claude)**
1. Go to [console.anthropic.com](https://console.anthropic.com/).
2. Create an API key.
3. You'll use:
   ```
   LLM_PROVIDER=anthropic
   LLM_MODEL=claude-haiku-4-5-20251001
   ```

**Option B — OpenAI**
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Create a key and add a small top-up (a few dollars lasts a long time for this app).
3. You'll use:
   ```
   LLM_PROVIDER=openai
   LLM_MODEL=gpt-4o-mini
   ```

### 4. Run locally (optional but recommended)

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

Minimum you need in `.env` to run locally:

```
DATABASE_URL="postgresql://...?sslmode=require"
AUTH_SECRET="$(openssl rand -base64 32)"
LLM_ENABLED=true
LLM_PROVIDER=anthropic       # or openai
LLM_API_KEY=sk-...
LLM_MODEL=claude-haiku-4-5-20251001

# For the seed step below:
SEED_PASSWORD=pick-a-password
SEED_PRIMARY_USERNAME=you
SEED_PARTNER_USERNAME=buddy
```

Then:

```bash
npx prisma db push          # creates tables in your Neon DB
npm run db:seed             # creates your two users (linked as buddies)
npm run dev                 # http://localhost:3000
```

Log in as `you` / your `SEED_PASSWORD` and you're in. Complete onboarding on first login.

### 5. Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new), import your forked GitHub repo.
2. Keep the default build settings (Next.js auto-detect is fine).
3. Before deploying, add **Environment Variables** (Production scope):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Your Neon pooled URL |
   | `AUTH_SECRET` | `openssl rand -base64 32` output |
   | `LLM_ENABLED` | `true` |
   | `LLM_PROVIDER` | `anthropic` or `openai` |
   | `LLM_API_KEY` | Your LLM key |
   | `LLM_MODEL` | `claude-haiku-4-5-20251001` or `gpt-4o-mini` |

4. Hit **Deploy**. The build will run `prisma generate` + `next build`.
5. First deploy will succeed but you can't log in yet — there are no users. Go to step 6.

### 6. Create your users (seed)

The app has no signup flow by design — users are created via the seed script. Run it once, locally, pointed at your production database:

```bash
# .env must have production DATABASE_URL + SEED_* vars
npm run db:seed
```

This creates two users (you + a buddy) already linked as buddies. You can add more buddies later through the app UI.

### 7. Log in 🎉

Visit your Vercel URL, log in, finish onboarding. Done.

---

## Environment variables — full reference

| Variable | Required | Purpose |
|---|:-:|---|
| `DATABASE_URL` | ✅ | Neon Postgres pooled connection string |
| `AUTH_SECRET` | ✅ | JWT signing secret (32+ random bytes) |
| `NEXTAUTH_URL` | only if Vercel doesn't auto-detect | Your deployed URL |
| `LLM_ENABLED` | ✅ | `true` to enable AI features |
| `LLM_PROVIDER` | ✅ | `anthropic` or `openai` |
| `LLM_API_KEY` | ✅ | Provider API key |
| `LLM_MODEL` | ✅ | Model ID (see step 3) |
| `SEED_PASSWORD` | seed only | Password for seeded users |
| `SEED_PRIMARY_USERNAME` | seed only | Your username |
| `SEED_PARTNER_USERNAME` | seed only | Buddy username |
| `SWEETHEART_USERNAME` | optional | Enables partner/anniversary UI for this username (see below) |
| `PARTNER_NAME` | optional | Display name shown in partner UI |
| `ANNIVERSARY_DATE` | optional | `YYYY-MM-DD` wedding date for countdown/takeover |

---

## Optional: partner / anniversary personalization

There's a small "love-bomb" feature set — a special login message for a specific partner user, a 3-day countdown banner before an anniversary, and a full-screen takeover on the day itself (floating hearts, year count, celebration card, ambient decoration).

It's **completely off by default**. To turn it on, set three env vars on Vercel:

```
SWEETHEART_USERNAME=<partner's username from your seed>
PARTNER_NAME=<your name shown in messages>
ANNIVERSARY_DATE=<wedding date, YYYY-MM-DD>
```

If `SWEETHEART_USERNAME` is unset, the whole feature is invisible — every user sees the standard app.

The code paths are isolated in:
- `lib/personalization.ts` — env-var reader
- `components/LoveMessage.tsx`, `AnniversaryCelebration.tsx`, `AnniversaryCountdown.tsx`, `AmbientHearts.tsx`, `LoveLetterButton.tsx`

Delete those files and their references in `app/page.tsx` if you want to strip the feature entirely.

---

## Local development

```bash
npm run dev                 # start dev server
npm run build               # production build (runs prisma generate first)
npm run lint                # eslint
npm run prisma:studio       # Prisma Studio GUI for your DB
```

Schema changes:

```bash
# edit prisma/schema.prisma, then:
npx prisma db push          # applies to DB without migrations (simpler on Neon)
npx prisma generate         # regenerates client
```

This project deliberately uses `prisma db push` rather than `prisma migrate dev` — migrations can drift on Neon's branching model, and `db push` keeps schema and DB in sync without fuss for a small-team project.

---

## Building on top

Good places to start if you want to extend the app:

| Want to add | Start here |
|---|---|
| A new page | `app/<route>/page.tsx` + add to `components/Nav.tsx` |
| A new AI feature | `lib/llm-client.ts` (provider-agnostic wrapper) + a new `app/api/*/route.ts` |
| Schema changes | `prisma/schema.prisma` → `prisma db push` |
| Charts / visualisations | Use Recharts; existing examples in `components/TrendsChart.tsx`, `CalendarHeatmap.tsx` |
| Meal grading logic | `lib/meal-scoring.ts` |
| Social features | `app/actions/reactions.ts`, `app/actions/buddy.ts`, `components/BuddyTodayFeed.tsx` |

The LLM client is provider-agnostic and reads config from env, so you can swap Claude ↔ GPT by changing three env vars. Add a new provider by extending `lib/llm-client.ts`.

---

## Privacy

- All health data (allergies, conditions, restrictions) lives only in your Neon database — not shared with any third party beyond the LLM call you configured.
- LLM prompts include profile context for better suggestions; your provider's data-retention policy applies to those calls. Anthropic and OpenAI both offer options to disable training on API usage.
- Food logs are personal to each user and their approved buddies.

---

## License

MIT — see [LICENSE](LICENSE). Fork, modify, and deploy your own freely. No warranty — use at your own risk, especially for anything health-related.
