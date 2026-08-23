// Supabase Edge Function, triggered by a Database Webhook on INSERT into `likes`,
// `comments`, and `weekly_highlights`. Deployed by pasting this file's contents into the
// Supabase Dashboard's Edge Functions editor — no CLI needed, same paste-and-run workflow
// already used for the SQL migrations in this folder.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by the Supabase
// platform to every Edge Function — no need to set them as secrets. RESEND_API_KEY is the
// one secret you do need to add yourself (Dashboard -> Edge Functions -> Secrets).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SITE_URL = "https://running-dashboard-eqyc.onrender.com";
const COACH_EMAIL = "shahartwig1@gmail.com";

async function sb(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Running Group Dashboard <onboarding@resend.dev>", to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend -> HTTP ${res.status}: ${await res.text()}`);
}

Deno.serve(async req => {
  try {
    const payload = await req.json();
    const table = payload.table as "likes" | "comments" | "weekly_highlights";
    const record = payload.record;
    if (payload.type !== "INSERT") return new Response("ignored", { status: 200 });

    if (table === "weekly_highlights") {
      await sendEmail(
        COACH_EMAIL,
        `📝 ${record.authorName} submitted a weekly highlight for approval`,
        `<p>${record.authorName} submitted a group highlight for the week of ${record.weekStart}:</p>
         <p>"${record.description}"</p>
         <p><a href="${SITE_URL}">Review it on the dashboard</a></p>`,
      );
      return new Response("sent", { status: 200 });
    }
    if (table !== "likes" && table !== "comments") {
      return new Response("ignored", { status: 200 });
    }

    const activities = await sb(
      `activities?activityId=eq.${encodeURIComponent(record.activityId)}&select=ownerId,activityName`,
    );
    const activity = activities[0];
    if (!activity) return new Response("no matching activity", { status: 200 });

    const runners = await sb(`runners?id=eq.${encodeURIComponent(activity.ownerId)}&select=name`);
    const ownerName = runners[0]?.name;
    if (!ownerName || ownerName === record.authorName) {
      return new Response("self-action or unknown owner, skipped", { status: 200 }); // don't email people about their own kudos/comments
    }

    const emails = await sb(`runner_emails?ownerId=eq.${encodeURIComponent(activity.ownerId)}&select=email`);
    const toEmail = emails[0]?.email;
    if (!toEmail) return new Response("no email on file for owner, skipped", { status: 200 });

    const runName = activity.activityName || "your run";
    const subject = table === "likes"
      ? `👍 ${record.authorName} gave kudos on ${runName}`
      : `💬 ${record.authorName} commented on ${runName}`;
    const bodyLine = table === "likes"
      ? `${record.authorName} gave you kudos on "${runName}".`
      : `${record.authorName} commented on "${runName}": "${record.text}"`;

    await sendEmail(toEmail, subject, `<p>${bodyLine}</p><p><a href="${SITE_URL}">Open the dashboard</a></p>`);
    return new Response("sent", { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response(String(e), { status: 500 });
  }
});
