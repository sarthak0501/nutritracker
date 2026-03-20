# Apple Health Integration via Shortcuts

## Approach
Use Apple Shortcuts + a server API endpoint to sync health data for free (no Apple Developer account needed).

## How It Works
1. A `/api/health-sync` endpoint accepts weight, nutrition, and workout data via POST
2. An Apple Shortcut on iPhone reads data from HealthKit and POSTs it to the endpoint
3. Shortcut Automations can run this daily (e.g., every morning at 8am)

## API Endpoint Design

### POST `/api/health-sync`
**Auth:** API key per user (generated in profile settings)

**Request body:**
```json
{
  "apiKey": "user-generated-key",
  "weight": [
    { "date": "2026-03-20", "kg": 96.0 }
  ],
  "workouts": [
    {
      "date": "2026-03-20",
      "name": "Running",
      "durationMinutes": 30,
      "caloriesBurned": 350
    }
  ]
}
```

**Response:**
```json
{ "synced": { "weight": 1, "workouts": 1 } }
```

## Apple Shortcut Steps
1. "Find Health Samples" → Weight, last 1 day
2. "Find Health Samples" → Workouts, last 1 day
3. Build JSON dictionary with the data
4. "Get Contents of URL" → POST to `/api/health-sync`

## Implementation Tasks
- [ ] Add `apiKey` field to User model (or separate ApiKey model)
- [ ] Create `/api/health-sync` POST route
- [ ] Upsert WeightEntry records from synced weight data
- [ ] Create WorkoutEntry records from synced workout data
- [ ] Add "Generate Sync Key" button in profile page
- [ ] Write step-by-step Shortcut setup guide for users

## Limitations
- Not real-time — runs on schedule or manual trigger
- One-directional per run (Health → NutriTracker)
- Shortcut setup is manual (could provide an iCloud link to install)
