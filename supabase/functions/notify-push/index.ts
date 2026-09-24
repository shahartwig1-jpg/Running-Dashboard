// Supabase Edge Function that sends push notifications to phones. The dashboard calls it
// from the browser right after something happens (kudos, comment, plan saved, ...).
//
// Deploy: Dashboard -> Edge Functions -> Deploy a new function -> name it exactly
// `notify-push` -> paste this file -> in the function's settings turn "Verify JWT" OFF
// (this function checks the caller's login itself, and browsers' CORS preflight requests
// carry no login, so the platform-level check would block them).
//
// Secrets (Dashboard -> Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com)
//   COACH_EMAILS (optional, comma-separated; defaults to Shahar)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COACH_EMAILS = (Deno.env.get("COACH_EMAILS") ?? "shahartwig1@gmail.com")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const SITE_URL = "https://running-dashboard-eqyc.onrender.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

// runner id -> login email, via the runner_emails table (empty until runners have logins).
async function emailsForRunners(ownerIds: string[]) {
  if (ownerIds.length === 0) return [];
  const rows = await sb(`runner_emails?select=email&ownerId=${inList(ownerIds)}`).catch(() => []);
  return (rows as { email: string }[]).map(r => r.email.toLowerCase());
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const user = await getUser((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!user?.email) return json({ error: "not logged in" }, 401);
    const actorEmail = String(user.email).toLowerCase();
    const actor = actorEmail.split("@")[0];
    const isCoach = COACH_EMAILS.includes(actorEmail);
    const body = await req.json();

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
        recipients = await emailsForRunners([acts[0].ownerId]);
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
        recipients = await emailsForRunners(ids);
        message = { body: "🗓️ Your training plan was updated", tag: "plan" };
        break;
      }
      default:
        return json({ error: "unknown type" }, 400);
    }

    if (body.type !== "test" && recipients !== "all") recipients = recipients.filter(e => e !== actorEmail);
    const subs = (await subscriptionsFor(recipients)).filter(s => body.type === "test" || s.email.toLowerCase() !== actorEmail);
    if (subs.length === 0) return json({ sent: 0, note: "no subscribed devices" });

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT")!,
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );
    const payload = JSON.stringify({ title: "Eyal's Angels 👼", body: message.body, tag: message.tag, url: SITE_URL });
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
    return json({ sent, removed });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
