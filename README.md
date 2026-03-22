# NutriTracker

**AI-assisted nutrition tracking with social accountability.**

Log meals, hit your macro targets, and stay consistent — with an AI coach that knows your allergies, health conditions, and goals, and a buddy feed that keeps you accountable.

## What makes it different

Most nutrition apps are calorie calculators. NutriTracker is an **AI nutrition coach with a social layer**:

- **Health-aware AI suggestions** — meal recommendations that respect your allergies, dietary restrictions, and pre-existing conditions (diabetes, hypertension, IBS, etc.)
- **Buddy accountability** — share your daily log with friends, react to each other's meals, see who's on track
- **Zero-friction logging** — describe what you ate in plain English, AI estimates the macros instantly
- **Habit-first design** — copy yesterday's meals, quick-log frequent foods, track water and workouts alongside nutrition
- **Meal grading** — every meal gets an A/B/C/D grade based on how well it fits your remaining budget

## Core features

### Logging
- AI text estimation: "2 scrambled eggs, toast, banana" → full macro breakdown in seconds
- Manual entry with barcode and Open Food Facts integration
- Copy yesterday's meals, quick-log frequent foods
- Breakfast / Lunch / Dinner / Snacks / Custom meal types

### Health profile
- Set allergies, dietary restrictions, and health conditions once
- AI meal suggestions automatically filter based on your profile
- Body stats (height, weight, age) for personalised targets

### Targets & tracking
- Daily targets for calories, protein, carbs, fat, fiber
- Goal presets: lose weight, maintain, build muscle, improve health
- Real-time remaining macros and meal-level grading
- Water intake tracker
- Weight history with trend chart

### Social (Buddy feed)
- Connect with friends
- See their daily meals in a shared feed
- React with 👍 👎 🔥 💪 to keep each other motivated

### Insights
- Weekly nutrition summaries
- Weight and calorie trend charts
- Workout logging with AI calorie estimates

## Tech stack

- **Next.js 15** (App Router, React Server Components)
- **Prisma + Neon Postgres** (serverless PostgreSQL)
- **NextAuth** (username/password auth, JWT sessions)
- **Tailwind CSS**
- **Recharts** for data visualisation
- **OpenAI / Anthropic** (pluggable LLM for AI features)

## Setup

```bash
# 1. Clone and install
git clone https://github.com/sarthak0501/nutritracker
cd nutritracker
npm install

# 2. Configure environment
cp .env.example .env
# Fill in DATABASE_URL, AUTH_SECRET, and LLM_API_KEY

# 3. Set up database
npx prisma db push

# 4. Run locally
npm run dev
```

### Required environment variables

```
DATABASE_URL=       # Neon Postgres connection string
AUTH_SECRET=        # Random secret: openssl rand -base64 32
LLM_ENABLED=true
LLM_PROVIDER=       # openai or anthropic
LLM_API_KEY=        # Your OpenAI or Anthropic key
LLM_MODEL=          # e.g. gpt-4o-mini or claude-haiku-4-5-20251001
```

## Privacy

- All health data (allergies, conditions, restrictions) is stored only in your database and used solely for personalising your experience
- No health data is sold or shared
- Food logs are personal — only you and your approved buddies can see them
