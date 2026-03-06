# NutriTracker

Track the nutrition of everything you eat—**across all daily meals**—and turn it into actionable insights: **macros, micros, targets, and trends over time**.

## What it is

NutriTracker is a personal nutrition logging and analytics app. You log foods for breakfast/lunch/dinner/snacks (and custom meals), and the app calculates:

- **Macros**: calories, protein, carbs, fat, fiber (and optionally sugar, saturated fat, etc.)
- **Micros**: vitamins and minerals (e.g., iron, calcium, potassium, vitamin D, B12)
- **Totals & remaining** against your daily targets
- **Trends**: week/month views, rolling averages, and consistency streaks

## Core product idea

- **Fast daily logging**: minimize friction so logging stays sustainable.
- **Clear targets**: set goals (cut/bulk/maintenance, performance, or health) and get simple “on track / off track” feedback.
- **Better decisions**: surface patterns like “low fiber on weekdays” or “protein dips on rest days”.

## Key features (planned)

### Food logging

- **Meals**: breakfast, lunch, dinner, snacks + custom meal names
- **Food entries**: per serving / grams / common units
- **Favorites & recent foods** for quick repeat logging
- **Recipes**: save multi-ingredient meals and log them in one tap

### Nutrition breakdown

- **Per-meal and per-day totals**
- **Macro split** (e.g., protein/carbs/fat ratio)
- **Micronutrient coverage** (e.g., % of daily recommended intake)

### Trends & insights

- **Daily/weekly/monthly charts**
- **Rolling averages** (e.g., 7-day protein average)
- **Nutrient consistency** (variance, adherence to targets)
- **Flags** for recurring gaps/excesses (e.g., low iron, high sodium)

### Goals & targets

- Customizable targets for **calories, macros, and selected micros**
- Optional **goal presets** (maintenance, cut, bulk, endurance training)
- **Adaptive targets** (future): adjust based on weigh-ins or activity level

## MVP scope (first build)

- Create a user profile with daily targets
- Log foods into meals for a date
- Compute and display macros + a small set of micros
- Show a simple weekly trend view for calories + protein + fiber

## Data assumptions

NutriTracker can be backed by a nutrition database (to be chosen). Common options:

- A public dataset (e.g., USDA FoodData Central)
- A curated internal dataset
- Manual entry (always available as a fallback)

## Non-goals (for now)

- Medical diagnosis or treatment guidance
- “Perfect accuracy” claims (nutrition labels and databases vary)

## Privacy principles (intended)

- Your food logs are personal data.
- Prefer **local-first** or clear export/delete controls.
- No selling of personal nutrition data.

## Roadmap ideas

- Barcode scanning (mobile)
- Photo-assisted logging (optional)
- Meal planning + grocery list
- Smart suggestions (“add a high-fiber side”)
- Integrations (fitness trackers, activity, weigh-ins)
- Export to CSV/JSON and personal dashboards

## Status

This repository currently contains the product idea and documentation. Implementation will be added as the project takes shape.
