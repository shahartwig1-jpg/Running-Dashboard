# 🏃 Running Group Dashboard

A live training dashboard for a real running group — pulls everyone's runs into one place regardless of which watch/app they use, lets a coach manage weekly training plans in-app, and layers on a Strava-style social feed. Built solo, actively used daily by a real group, not a demo.

**Live app:** https://running-dashboard-eqyc.onrender.com
**Repo:** https://github.com/shahartwig1-jpg/Running-Dashboard

## What it does

- Aggregates every runner's activities from [Intervals.icu](https://intervals.icu) (which normalizes data from Garmin, Coros, Suunto, Strava, etc.), regardless of watch brand
- Weekly/comparison charts (distance, pace, per-weekday breakdown) with week-by-week navigation
- **In-app weekly training plan editor**, coach-only, enforced at the database level — not just hidden in the UI
- Social layer: kudos, comments, and photo uploads on individual runs
- Email notifications when someone kudos/comments your run
- Public deploy with real authentication (Supabase Auth), gated behind login

## Stack

Vanilla JS frontend (no framework), Node.js backend script, PostgreSQL (Supabase) with Row-Level Security, Supabase Auth + Storage + Edge Functions, GitHub Actions for scheduled jobs, deployed on Render. **Zero npm dependencies anywhere** — every network call, front and back, goes through the native `fetch()` API.

## A few engineering decisions worth highlighting

- **Security enforced server-side, not just in the UI.** The plan editor's "only the coach can edit" rule is a Postgres RLS policy checking the logged-in user's JWT claims — a request that bypasses the UI entirely still gets rejected by the database.
- **Defensive syncing against an unreliable third-party API.** Intervals.icu's activity-list endpoint can silently omit real, still-existing activities (confirmed by testing, not documented anywhere). Rather than trust "missing from the list" as proof of deletion, the sync only hard-deletes on a confirmed 404 from a direct lookup — anything else gets soft-hidden instead, so nothing is ever destroyed based on ambiguous evidence, and it self-heals if the data reappears.
- **Automated data pipeline.** A GitHub Actions cron job runs every 6 hours, pulling from the fitness API and reconciling it against the database — no manual step required to keep data fresh.

---

# דשבורד קבוצת ריצה

דשבורד שמציג את הריצות של כל חברי הקבוצה במקום אחד, בלי קשר לסוג השעון.
הנתונים מגיעים מ-Intervals.icu, שאליה כל רץ מחבר בעצמו את הגרמין / קורוס / סונטו / סטראבה שלו.

## הרצה

```
node serve.js
```
ואז לפתוח http://localhost:8371

בלי `data.json` הדשבורד מציג נתוני דמו. עם `data.json` הוא מציג נתונים אמיתיים.

## חיבור לנתונים אמיתיים

1. **מפתח API** — באתר intervals.icu: Settings ← לגלול למטה ל-Developer Settings ← ליד API Key ללחוץ (view) ואם אין, Generate.
2. **להדביק את המפתח** — לפתוח את `key.txt` ולהדביק בו את המפתח, בלי כלום מסביב. לשמור.
   הקובץ נשאר רק במחשב שלך. אל תשתף אותו — מפתח API שקול לסיסמה.
   (`config.json` מחזיק רק את רשימת הרצים, בלי סודות.)
3. **בדיקה** — להריץ:
   ```
   node fetch-data.js discover
   ```
   זה מוודא שהמפתח עובד, מראה איזה נתונים נגישים, ומדפיס פעילות אחת גולמית כדי לאמת את שמות השדות.
4. **משיכה** — להריץ:
   ```
   node fetch-data.js
   ```
   נוצר `data.json`. לרענן את הדשבורד.

## הוספת רצים

בתוך `config.json`, במערך `athletes`. `id` של `0` פירושו "אני".
כל רץ צריך קודם לאשר אותך ב-Intervals.icu (follow או coach) — הנתונים שם פרטיים כברירת מחדל.

אם יתברר שגישת מאמן לא מספיקה למשיכה דרך ה-API, אפשר לתת לכל רץ שורה משלו עם `apiKey` משלו:

```json
{ "id": "i123456", "name": "יואב", "apiKey": "..." }
```

## שימור נתונים (Supabase)

`data.json` ו-`details/*.json` הם קבצים "חד-פעמיים" — כל הרצה של `fetch-data.js` דורסת אותם מחדש, ומוגבלים לחלון של 70 הימים האחרונים (`DAYS_BACK`). כדי שהיסטוריית ריצות לא תלך לאיבוד, כל ריצה, פרטי ריצה (הפסקות + סטרימס), לילות שינה, ותכנית האימונים (כולל שבועות עברו) נשמרים *גם* לצמיתות ב-**Supabase** — Postgres בענן, בטיר החינמי.

התקשורת עם Supabase (`supabase.js`) היא קריאות `fetch()` פשוטות ל-REST API האוטומטי שלו (PostgREST) — בלי שום חבילת client, כדי לשמור על העיקרון של אפס תלויות חיצוניות בפרויקט.

**הגדרה חד-פעמית:**
1. ליצור פרויקט חינמי ב-[supabase.com](https://supabase.com).
2. בטאב **SQL Editor**, להדביק ולהריץ את `supabase/schema.sql` (יוצר את הטבלאות).
3. ב-Project Settings → API, להעתיק את ה-**Project URL** לתוך `supabase-url.txt`, ואת מפתח ה-**service_role** (לא ה-anon key) לתוך `supabase-key.txt`. שני הקבצים לא בגיט.
4. אם כבר יש נתונים מקומיים ב-`dashboard.db` הישן (SQLite): להריץ פעם אחת `node migrate-to-supabase.js` כדי להעביר את ההיסטוריה הקיימת. בטוח להריץ פעמיים.

`db.js`/`dashboard.db` (SQLite) לא נמחקים — הם נשארים כגיבוי מקומי ישן, ומשמשים היום רק את סקריפט המיגרציה החד-פעמי. `fetch-data.js` עצמו כבר לא נוגע בהם.

## משיכה אוטומטית בענן (GitHub Actions)

במקום לזכור להריץ `node fetch-data.js` ידנית, יש workflow ב-`.github/workflows/fetch-data.yml` שרץ לבד כל 6 שעות (וגם ניתן להרצה ידנית מהטאב Actions בגיטהאב, כפתור "Run workflow"). מאחר שכל מה ש-`fetch-data.js` כותב הולך ישר ל-Supabase, אין כאן שום ריפו פרטי/קבצים לדחוף בחזרה — ה-workflow רק צריך את אותם secrets שהיו לו ממילא, ועוד שניים:

בריפו הציבורי, תחת Settings → Secrets and variables → Actions, להוסיף 4 secrets:
- `INTERVALS_API_KEY` — תוכן `key.txt`.
- `ATHLETES_JSON` — תוכן מערך ה-`athletes` מתוך `config.json` (רק המערך, כ-JSON).
- `SUPABASE_URL` — תוכן `supabase-url.txt`.
- `SUPABASE_SERVICE_KEY` — תוכן `supabase-key.txt`.

## קבצים

| קובץ | תפקיד |
|---|---|
| `index.html` | הדשבורד עצמו — עיצוב, גרפים, נתוני דמו (שם הקובץ `index.html` ולא `dashboard.html` כדי שאתרי אחסון סטטי כמו Render יגישו אותו אוטומטית ב-`/`) |
| `fetch-data.js` | מושך מ-Intervals.icu, כותב את `data.json`/`details/`, ומעדכן את Supabase |
| `supabase.js` | קריאות REST ל-Supabase (אפס תלויות חיצוניות) |
| `supabase/schema.sql` | מבנה הטבלאות ב-Supabase — מריצים פעם אחת ב-SQL Editor |
| `migrate-to-supabase.js` | מיגרציה חד-פעמית מ-`dashboard.db` הישן ל-Supabase |
| `db.js` | SQLite ישן — נשאר רק לצורך המיגרציה החד-פעמית |
| `serve.js` | שרת מקומי קטן |
| `config.json` | רשימת הרצים (לא בגיט, לא לשיתוף) |
