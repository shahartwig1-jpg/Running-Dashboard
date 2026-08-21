# 🏃 Running Group Dashboard

![Node.js](https://img.shields.io/badge/Node.js-backend-339933?logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-336791?logo=postgresql&logoColor=white)
![Deployed on Render](https://img.shields.io/badge/Deployed%20on-Render-46E3B7?logo=render&logoColor=white)
![Zero dependencies](https://img.shields.io/badge/npm%20dependencies-0-blue)
![CI](https://github.com/shahartwig1-jpg/Running-Dashboard/actions/workflows/test.yml/badge.svg)

A live training dashboard built for a real running group of six athletes across five different watch brands. It unifies everyone's activity data in one place, gives the coach an in-app tool to manage weekly training plans, and layers a Strava-style social feed on top — kudos, comments, and photos. Designed, built, and shipped solo; in daily production use, not a demo.

**Live app:** https://running-dashboard-eqyc.onrender.com
**Setup / local dev:** see [SETUP.md](SETUP.md)

## What it does

- Aggregates every runner's activities from [Intervals.icu](https://intervals.icu) — which itself normalizes data from Garmin, Coros, Suunto, and Strava — so the dashboard works regardless of which watch a runner owns
- Weekly comparison charts (distance, pace, per-weekday breakdown), with week-by-week navigation for tracking trends over time
- An in-app weekly training-plan editor, restricted to the coach and enforced at the database layer, not just hidden in the UI
- A social layer — kudos, comments, and photo uploads on individual runs
- Email notifications on kudos/comments, via a Supabase Edge Function and Resend
- Public deployment gated behind real authentication (Supabase Auth)

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript, no framework |
| Backend | Node.js script, run on a schedule |
| Database | PostgreSQL (Supabase), with Row-Level Security |
| Auth / Storage / Serverless | Supabase Auth, Supabase Storage, Supabase Edge Functions |
| Scheduling | GitHub Actions cron, every 6 hours |
| Hosting | Render (static site) |
| Testing | `node:test`, run in CI on every push |

Every network call, frontend and backend, goes through the native `fetch()` API — **zero npm dependencies**, by deliberate design choice.

## Engineering decisions worth calling out

**Security enforced at the database, not the UI.** The plan editor's "coach-only" write access is a PostgreSQL Row-Level Security policy that checks the logged-in user's JWT claims server-side. A request that bypasses the UI entirely is still rejected by Postgres itself.

**Defensive syncing against an unreliable upstream API.** Intervals.icu's activity-list endpoint was found, through direct testing, to silently omit real, still-existing activities — with no documented flag or parameter explaining why. Rather than trust "missing from the list" as proof of deletion, the sync pipeline only hard-deletes on a confirmed 404 from a direct per-activity lookup; anything less certain is soft-hidden instead of destroyed, and self-heals automatically if the data reappears in a later sync.

**Fully automated data pipeline.** A GitHub Actions cron job runs every 6 hours, pulling fresh data from the upstream API and reconciling it against the database — no manual step required to keep the dashboard current.
