// Supabase Edge Function that sends push notifications to phones. Most calls come from the
// dashboard in the browser, right after something happens (kudos, comment, plan saved, ...).
// The "new_run" type is different: it's called by the fetch-data.js sync job (GitHub Actions,
// unattended, no browser/no logged-in user), authenticated with a shared secret instead.
//
// Deploy: Dashboard -> Edge Functions -> Deploy a new function -> name it exactly
// `notify-push` -> paste this file -> in the function's settings turn "Verify JWT" OFF
// (this function checks the caller's login itself, and browsers' CORS preflight requests
// carry no login, so the platform-level check would block them).
//
// Secrets (Dashboard -> Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com)
//   COACH_EMAILS (optional, comma-separated; fallback for who gets coach-only alerts, only
//     used if the `roles` table (supabase/roles.sql) is empty/missing -- defaults to Shahar)
//   RUN_COMPLETE_EMAILS (optional, comma-separated; who gets notified when someone finishes a
//     run -- kept separate from COACH_EMAILS on purpose, so this can be just Eyal)
//   SYNC_SECRET -- shared with the fetch-data.js GitHub Action; lets it call this function with
//     no logged-in user (it runs on a schedule, unattended)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COACH_EMAILS_FALLBACK = (Deno.env.get("COACH_EMAILS") ?? "shahartwig1@gmail.com,eyalshlomi8@gmail.com")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const RUN_COMPLETE_EMAILS = (Deno.env.get("RUN_COMPLETE_EMAILS") ?? "eyalshlomi8@gmail.com")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
// Secrets pasted from a text file often carry an invisible trailing newline/space (or quotes) —
// strip them so a sloppy paste can't silently break a comparison or a signature.
const cleanSecret = (name: string) => (Deno.env.get(name) ?? "").trim().replace(/^["']|["']$/g, "").replace(/=+$/, "");
const SYNC_SECRET = cleanSecret("SYNC_SECRET");
const SITE_URL = "https://running-dashboard-eqyc.onrender.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function sb(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${path} -> HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Validates the caller's login with Supabase itself (works for real users only — the public
// anon key is not a logged-in user, so it fails here).
async function getUser(token: string) {
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  return res.ok ? res.json() : null;
}

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const inList = (vals: string[]) => `in.(${vals.map(v => `"${v.replace(/"/g, "")}"`).join(",")})`;

async function subscriptionsFor(emails: string[] | "all") {
  if (emails !== "all" && emails.length === 0) return [];
  const filter = emails === "all" ? "" : `&email=${inList(emails)}`;
  return await sb(`push_subscriptions?select=endpoint,email,p256dh,auth${filter}`) as
    { endpoint: string; email: string; p256dh: string; auth: string }[];
}

// The real source of truth for "who is a coach" -- one row per coach in the `roles` table
// (supabase/roles.sql), instead of the env-var list. Falls back to COACH_EMAILS_FALLBACK
// only if that table is empty or missing (e.g. the migration hasn't been run yet), so a
// query failure can never silently turn into "nobody is a coach".
async function coachEmails(): Promise<string[]> {
  const rows = await sb(`roles?select=email&role=eq.coach`).catch(() => []) as { email: string }[];
  const emails = rows.map(r => r.email.toLowerCase());
  return emails.length ? emails : COACH_EMAILS_FALLBACK;
}

// runner id -> login email, via the runner_emails table (empty until a runner has a login).
async function emailMapForRunners(ownerIds: string[]) {
  const map: Record<string, string> = {};
  if (ownerIds.length === 0) return map;
  const rows = await sb(`runner_emails?select=ownerId,email&ownerId=${inList(ownerIds)}`).catch(() => []) as
    { ownerId: string; email: string }[];
  for (const r of rows) map[r.ownerId] = r.email.toLowerCase();
  return map;
}

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(cleanSecret("VAPID_SUBJECT"), cleanSecret("VAPID_PUBLIC_KEY"), cleanSecret("VAPID_PRIVATE_KEY"));
  vapidReady = true;
}

async function sendToSubs(subs: { endpoint: string; email: string; p256dh: string; auth: string }[], payload: string) {
  ensureVapid();
  let sent = 0, removed = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
      sent++;
    } catch (e: any) {
      // 404/410 = that phone unsubscribed or uninstalled: forget the dead address.
      if (e.statusCode === 404 || e.statusCode === 410) {
        await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" }).catch(() => {});
        removed++;
      } else {
        console.error("push failed", e.statusCode, e.body);
      }
    }
  }));
  return { sent, removed };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();

    // The sync job (fetch-data.js, on a GitHub Actions schedule) has no logged-in user to send
    // a token for — it proves itself with a shared secret instead.
    if (body.type === "new_run") {
      if (!SYNC_SECRET || req.headers.get("x-sync-secret") !== SYNC_SECRET) return json({ error: "unauthorized" }, 401);
      const runs = Array.isArray(body.runs) ? body.runs : [];
      if (runs.length === 0 || RUN_COMPLETE_EMAILS.length === 0) return json({ sent: 0, note: "nothing to send" });

      const ownerIds = [...new Set(runs.map((r: any) => String(r.ownerId)))];
      const ownerEmailById = await emailMapForRunners(ownerIds);
      const subs = await subscriptionsFor(RUN_COMPLETE_EMAILS);
      if (subs.length === 0) return json({ sent: 0, note: "no subscribed devices" });

      let sent = 0, removed = 0;
      for (const r of runs) {
        // Don't tell someone about their own run, in the rare case a recipient is also a runner.
        const targetSubs = subs.filter(s => s.email.toLowerCase() !== ownerEmailById[String(r.ownerId)]);
        if (targetSubs.length === 0) continue;
        const payload = JSON.stringify({
          title: `🏃 ${clip(r.ownerName, 30) || "Someone"} completed a run`,
          tag: `run-${r.activityId}`,
          url: SITE_URL,
        });
        const result = await sendToSubs(targetSubs, payload);
        sent += result.sent; removed += result.removed;
      }
      return json({ sent, removed });
    }

    const user = await getUser((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!user?.email) return json({ error: "not logged in" }, 401);
    const actorEmail = String(user.email).toLowerCase();
    const actor = actorEmail.split("@")[0];
    const COACH_EMAILS = await coachEmails();
    const isCoach = COACH_EMAILS.includes(actorEmail);

    let recipients: string[] | "all";
    let message: { body: string; tag: string };

    switch (body.type) {
      case "test":
        recipients = [actorEmail]; // the only case where you notify yourself
        message = { body: "✅ Notifications are working on this device.", tag: "test" };
        break;
      case "like":
      case "comment": {
        const acts = await sb(`activities?activityId=eq.${encodeURIComponent(String(body.activityId))}&select=ownerId,activityName`);
        if (!acts?.[0]) return json({ sent: 0, note: "unknown activity" });
        recipients = Object.values(await emailMapForRunners([acts[0].ownerId]));
        const run = clip(acts[0].activityName, 60) || "your run";
        message = body.type === "like"
          ? { body: `👍 ${actor} gave kudos on "${run}"`, tag: `like-${body.activityId}` }
          : { body: `💬 ${actor} on "${run}": ${clip(body.text, 100)}`, tag: `comment-${body.activityId}` };
        break;
      }
      case "highlight_submitted":
        recipients = COACH_EMAILS;
        message = { body: `📝 ${actor} submitted a weekly highlight for approval`, tag: "highlight-submitted" };
        break;
      case "highlight_approved":
        if (!isCoach) return json({ error: "coach only" }, 403);
        recipients = "all";
        message = { body: "🎉 A new weekly highlight is up", tag: "highlight-approved" };
        break;
      case "race": {
        if (!isCoach) return json({ error: "coach only" }, 403);
        recipients = "all";
        const when = clip(body.date, 20);
        message = { body: `🏁 New race: ${clip(body.name, 80)}${when ? " · " + when : ""} — are you in?`, tag: "race" };
        break;
      }
      case "plan": {
        if (!isCoach) return json({ error: "coach only" }, 403);
        const ids = (Array.isArray(body.ownerIds) ? body.ownerIds : []).map((x: unknown) => clip(x, 40)).filter(Boolean);
        recipients = Object.values(await emailMapForRunners(ids));
        message = { body: "🗓️ Your training plan was updated", tag: "plan" };
        break;
      }
      default:
        return json({ error: "unknown type" }, 400);
    }

    if (body.type !== "test" && recipients !== "all") recipients = recipients.filter(e => e !== actorEmail);
    const subs = (await subscriptionsFor(recipients)).filter(s => body.type === "test" || s.email.toLowerCase() !== actorEmail);
    if (subs.length === 0) return json({ sent: 0, note: "no subscribed devices" });

    const payload = JSON.stringify({ title: "Eyal's Angels 👼", body: message.body, tag: message.tag, url: SITE_URL });
    const result = await sendToSubs(subs, payload);
    return json(result);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
