// Remote by Designs Community: email notifications.
// Deployed as the Supabase Edge Function "community-email" (verify_jwt off; it checks its own key).
//
// POST {"mode":"queue"}   every 10 minutes (pg_cron). Emails members about unread notifications that are
//                         at least 5 minutes old: messages, comments, replies, announcements, events and,
//                         for admins, reports. One email per member per run; likes are never emailed.
// POST {"mode":"digest"}  Monday 9:00 AM Manila (pg_cron). Weekly round-up: top posts, upcoming events,
//                         new members. Sent once per week; skipped when there's nothing to share.
// POST {"mode":"preview"} Sends a sample digest to admins only (to check the email looks right).
// POST {"mode":"dryrun"}  Returns what the queue run would send, without sending or marking anything.
// GET  ?u=<token>&t=<type|all>  One-click unsubscribe link used in every email.
//
// POST calls need header x-cron-key = the vault secret "cm_email_cron_key" (read through cm_email_cron_key()).
// Email uses the same SMTP secrets as the Academy: SMTP_PASSWORD (+ optional SMTP_HOST, SMTP_PORT, SMTP_USER).
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import nodemailer from "npm:nodemailer@6.9.16";

const SITE = "https://community.remotebydesigns.com/";
const FN_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/community-email`;
const TZ = "Asia/Manila";
const DELAY_MIN = 5;            // give people a few minutes to see it in the app first
const MAX_EMAILS_PER_RUN = 200;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

type Prefs = { user_id: string; announcements: boolean; events: boolean; messages: boolean; activity: boolean; digest: boolean; token: string };
type Note = { id: string; user_id: string; actor_id: string | null; kind: string; post_id: string | null; event_id: string | null; read_at: string | null; created_at: string };

const PREF_FOR: Record<string, keyof Prefs | null> = {
  message: "messages", comment: "activity", reply: "activity",
  announcement: "announcements", event: "events", report: null, // reports always go to admins
};
const PREF_LABEL: Record<string, string> = {
  messages: "message emails", activity: "comment emails", announcements: "announcement emails",
  events: "event emails", digest: "the weekly round-up", all: "all community emails",
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const snip = (s: string | null | undefined, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const first = (name: string) => String(name || "there").trim().split(/\s+/)[0];
const when = (ts: string) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ts)) + " (PH time)";
const unsubUrl = (token: string, t: string) => `${FN_URL}?u=${encodeURIComponent(token)}&t=${encodeURIComponent(t)}`;

function transport() {
  const pass = Deno.env.get("SMTP_PASSWORD");
  if (!pass) throw new Error("SMTP_PASSWORD secret is not set");
  const port = Number(Deno.env.get("SMTP_PORT") || 465);
  const user = Deno.env.get("SMTP_USER") || "support@remotebydesigns.com";
  return { user, t: nodemailer.createTransport({ host: Deno.env.get("SMTP_HOST") || "mail.remotebydesigns.com", port, secure: port === 465, auth: { user, pass } }) };
}

// ---------- Email layout ----------
function layout(o: { preheader: string; heading: string; intro: string; rows: string; cta: string; ctaUrl: string; token: string; unsubType: string }) {
  const unsubType = o.unsubType;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.heading)}</title></head>
<body style="margin:0;padding:0;background:#EEF3F7;font-family:Poppins,Segoe UI,Helvetica,Arial,sans-serif;color:#0D2238">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF3F7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0D2238;padding:20px 26px">
  <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#86CDD6;font-weight:700">Remote by Designs</div>
  <div style="font-size:20px;font-weight:700;color:#ffffff;margin-top:2px">Community</div>
</td></tr>
<tr><td style="padding:26px 26px 6px">
  <h1 style="margin:0 0 8px;font-size:21px;line-height:1.3;color:#0D2238">${esc(o.heading)}</h1>
  <p style="margin:0 0 16px;font-size:14.5px;line-height:1.6;color:#41566B">${o.intro}</p>
  ${o.rows}
  <p style="margin:22px 0 8px"><a href="${esc(o.ctaUrl)}" style="display:inline-block;background:#2F8F9D;color:#ffffff;text-decoration:none;font-weight:600;font-size:14.5px;padding:12px 22px;border-radius:999px">${esc(o.cta)}</a></p>
</td></tr>
<tr><td style="padding:18px 26px 24px;border-top:1px solid #E3EAF0;font-size:12px;line-height:1.6;color:#6B7F92">
  You're getting this because you're a member of the Remote by Designs Community.<br>
  <a href="${SITE}#/profile" style="color:#2F8F9D">Email settings</a> ·
  <a href="${unsubUrl(o.token, unsubType)}" style="color:#2F8F9D">Turn off ${esc(PREF_LABEL[unsubType] || "these emails")}</a> ·
  <a href="${unsubUrl(o.token, "all")}" style="color:#2F8F9D">Unsubscribe from all</a>
</td></tr></table>
<p style="font-size:11px;color:#8A9AAB;margin:14px 0 0">Remote by Designs · support@remotebydesigns.com</p>
</td></tr></table></body></html>`;
}
function row(title: string, sub: string, url: string) {
  return `<a href="${esc(url)}" style="display:block;text-decoration:none;color:#0D2238;border:1px solid #E3EAF0;border-left:4px solid #2F8F9D;border-radius:10px;padding:12px 14px;margin:0 0 10px">
  <div style="font-size:14.5px;line-height:1.45">${title}</div>${sub ? `<div style="font-size:13px;line-height:1.5;color:#5B6F83;margin-top:4px">${sub}</div>` : ""}</a>`;
}

async function emailOf(userId: string): Promise<string | null> {
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}
async function prefsFor(ids: string[]): Promise<Map<string, Prefs>> {
  const m = new Map<string, Prefs>();
  if (!ids.length) return m;
  const { data } = await db.from("cm_email_prefs").select("*").in("user_id", ids);
  (data || []).forEach((p: Prefs) => m.set(p.user_id, p));
  // Members from before email settings existed get a row with everything on
  const missing = ids.filter((id) => !m.has(id));
  if (missing.length) {
    const ins = await db.from("cm_email_prefs").upsert(missing.map((user_id) => ({ user_id })), { onConflict: "user_id" }).select("*");
    (ins.data || []).forEach((p: Prefs) => m.set(p.user_id, p));
  }
  return m;
}
async function membersFor(ids: string[]) {
  const m = new Map<string, { display_name: string; banned: boolean }>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return m;
  const { data } = await db.from("cm_members").select("user_id, display_name, banned").in("user_id", uniq);
  (data || []).forEach((x: any) => m.set(x.user_id, x));
  return m;
}

// ---------- Queue: unread notifications ----------
async function runQueue(dry: boolean) {
  const now = Date.now();
  const { data: notes, error } = await db.from("cm_notifications")
    .select("id,user_id,actor_id,kind,post_id,event_id,read_at,created_at")
    .is("emailed_at", null)
    .gte("created_at", new Date(now - 2 * 864e5).toISOString())
    .lte("created_at", new Date(now - DELAY_MIN * 60e3).toISOString())
    .order("created_at").limit(2000);
  if (error) throw error;
  const list = (notes || []) as Note[];
  if (!list.length) return { considered: 0, emailed: 0, recipients: [] };

  const userIds = [...new Set(list.map((n) => n.user_id))];
  const [prefs, people] = await Promise.all([prefsFor(userIds), membersFor(list.map((n) => n.user_id).concat(list.map((n) => n.actor_id || "")))]);
  const postIds = [...new Set(list.map((n) => n.post_id).filter(Boolean))] as string[];
  const eventIds = [...new Set(list.map((n) => n.event_id).filter(Boolean))] as string[];
  const posts = new Map<string, string>(), events = new Map<string, { title: string; starts_at: string }>();
  if (postIds.length) ((await db.from("cm_posts").select("id, body").in("id", postIds)).data || []).forEach((p: any) => posts.set(p.id, p.body));
  if (eventIds.length) ((await db.from("cm_events").select("id, title, starts_at").in("id", eventIds)).data || []).forEach((e: any) => events.set(e.id, e));

  const byUser = new Map<string, Note[]>();
  list.forEach((n) => { const a = byUser.get(n.user_id) || []; a.push(n); byUser.set(n.user_id, a); });

  const { user: from, t } = dry ? { user: "", t: null as any } : transport();
  const summary: any[] = [];
  let emailed = 0;
  for (const [uid, all] of byUser) {
    const me = people.get(uid), p = prefs.get(uid);
    const send = all.filter((n) => {
      if (n.read_at || n.kind === "like" || !me || me.banned || !p) return false;
      const key = PREF_FOR[n.kind];
      return key === null ? n.kind === "report" : key ? !!p[key] : false;
    });
    const ids = all.map((n) => n.id);
    if (!send.length || emailed >= MAX_EMAILS_PER_RUN) {
      if (!send.length && !dry) await db.from("cm_notifications").update({ emailed_at: new Date().toISOString() }).in("id", ids);
      continue;
    }
    // Messages: one line per person, newest first
    const seenMsg = new Set<string>(), rows: string[] = [];
    for (const n of [...send].reverse()) {
      const who = esc(people.get(n.actor_id || "")?.display_name || "A member");
      const post = n.post_id ? posts.get(n.post_id) : null;
      if (n.kind === "message") {
        if (seenMsg.has(n.actor_id || "")) continue; seenMsg.add(n.actor_id || "");
        rows.push(row(`<b>${who}</b> sent you a message`, "Reply in the community. Messages stay private between you two.", `${SITE}#/messages/${n.actor_id}`));
      } else if (n.kind === "comment") rows.push(row(`<b>${who}</b> commented on your post`, post ? `“${esc(snip(post, 110))}”` : "", `${SITE}#/post/${n.post_id}`));
      else if (n.kind === "reply") rows.push(row(`<b>${who}</b> also commented on a post you're following`, post ? `“${esc(snip(post, 110))}”` : "", `${SITE}#/post/${n.post_id}`));
      else if (n.kind === "announcement") rows.push(row(`<b>New announcement</b> from the RBD team`, esc(snip(post, 180)), `${SITE}#/post/${n.post_id}`));
      else if (n.kind === "event") { const e = events.get(n.event_id || ""); if (e) rows.push(row(`<b>New event:</b> ${esc(e.title)}`, esc(when(e.starts_at)), `${SITE}#/events`)); }
      else if (n.kind === "report") rows.push(row(`<b>${who}</b> reported a post`, "Review it in the Admin Dashboard.", `${SITE}#/admin`));
    }
    if (!rows.length) { if (!dry) await db.from("cm_notifications").update({ emailed_at: new Date().toISOString() }).in("id", ids); continue; }

    const single = send.length === 1 || rows.length === 1;
    const k = send[0].kind;
    const subject = single
      ? (k === "message" ? `${people.get(send[0].actor_id || "")?.display_name || "A member"} sent you a message`
        : k === "comment" ? `${people.get(send[0].actor_id || "")?.display_name || "A member"} commented on your post`
        : k === "reply" ? `New comment on a post you're following`
        : k === "announcement" ? `New announcement in the RBD Community`
        : k === "event" ? `New event: ${events.get(send[0].event_id || "")?.title || "RBD Community"}`
        : `A post was reported in the RBD Community`)
      : `You have ${rows.length} new updates in the RBD Community`;
    const unsubType = single ? (PREF_FOR[k] as string) || "all" : "all";
    summary.push({ user: uid, subject, items: rows.length });
    if (dry) continue;

    const to = await emailOf(uid);
    if (!to) { await db.from("cm_notifications").update({ emailed_at: new Date().toISOString() }).in("id", ids); continue; }
    const html = layout({
      preheader: subject, heading: `Hi ${first(me!.display_name)}, here's what's new`,
      intro: "Here's what happened in the community since you were last there.",
      rows: rows.join(""), cta: "Open the community", ctaUrl: SITE, token: p!.token, unsubType,
    });
    try {
      await t.sendMail({
        from: `"RBD Community" <${from}>`, to, subject, html,
        text: `${subject}\n\nOpen the community: ${SITE}\n\nEmail settings: ${SITE}#/profile\nUnsubscribe from all: ${unsubUrl(p!.token, "all")}`,
        headers: { "List-Unsubscribe": `<${unsubUrl(p!.token, "all")}>` },
      });
      emailed++;
      await db.from("cm_notifications").update({ emailed_at: new Date().toISOString() }).in("id", ids);
    } catch (e) { console.error("send failed", uid, e); } // left unmarked; retried next run (within 2 days)
  }
  return { considered: list.length, emailed, recipients: summary };
}

// ---------- Weekly digest ----------
async function digestContent() {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const [postsR, eventsR, newR] = await Promise.all([
    db.from("cm_posts").select("id, body, author_id, category_id, created_at, cm_likes(count), cm_comments(count)").gte("created_at", weekAgo).limit(200),
    db.from("cm_events").select("id, title, starts_at").gte("starts_at", new Date().toISOString()).lte("starts_at", new Date(Date.now() + 14 * 864e5).toISOString()).order("starts_at").limit(5),
    db.from("cm_members").select("user_id, display_name").gte("joined_at", weekAgo).eq("banned", false).order("joined_at", { ascending: false }).limit(50),
  ]);
  const posts = (postsR.data || []).map((p: any) => ({ ...p, score: (p.cm_likes?.[0]?.count || 0) + 2 * (p.cm_comments?.[0]?.count || 0) }))
    .sort((a: any, b: any) => b.score - a.score || +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 5);
  const people = await membersFor(posts.map((p: any) => p.author_id));
  return { posts, people, events: eventsR.data || [], newbies: newR.data || [], postCount: (postsR.data || []).length };
}
function digestRows(c: Awaited<ReturnType<typeof digestContent>>) {
  let rows = "";
  if (c.posts.length) {
    rows += `<h2 style="font-size:15px;margin:18px 0 10px;color:#0D2238">Top conversations this week</h2>`;
    rows += c.posts.map((p: any) => {
      const likes = p.cm_likes?.[0]?.count || 0, comments = p.cm_comments?.[0]?.count || 0;
      return row(`<b>${esc(c.people.get(p.author_id)?.display_name || "A member")}</b>: “${esc(snip(p.body, 120))}”`,
        `${likes} like${likes === 1 ? "" : "s"} · ${comments} comment${comments === 1 ? "" : "s"}`, `${SITE}#/post/${p.id}`);
    }).join("");
  }
  if (c.events.length) {
    rows += `<h2 style="font-size:15px;margin:18px 0 10px;color:#0D2238">Coming up</h2>`;
    rows += c.events.map((e: any) => row(`<b>${esc(e.title)}</b>`, esc(when(e.starts_at)), `${SITE}#/events`)).join("");
  }
  if (c.newbies.length) {
    const names = c.newbies.slice(0, 5).map((m: any) => esc(first(m.display_name))).join(", ");
    rows += `<h2 style="font-size:15px;margin:18px 0 10px;color:#0D2238">Say hello</h2>`;
    rows += row(`<b>${c.newbies.length} new member${c.newbies.length === 1 ? "" : "s"}</b> joined this week`, `${names}${c.newbies.length > 5 ? " and more" : ""}. A quick welcome goes a long way.`, `${SITE}#/members`);
  }
  return rows;
}
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(), w = Math.ceil(((+t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}
async function runDigest(previewOnly: boolean) {
  const c = await digestContent();
  const hasNews = c.posts.length || c.events.length || c.newbies.length;
  if (!hasNews && !previewOnly) return { sent: 0, skipped: "nothing to share this week" };
  const runId = `digest-${isoWeek()}`;
  if (!previewOnly) {
    const claim = await db.from("cm_email_runs").insert({ id: runId });
    if (claim.error) return { sent: 0, skipped: `already sent (${runId})` };
  }
  let recipients: string[];
  if (previewOnly) {
    const { data } = await db.from("profiles").select("id").eq("is_admin", true);
    recipients = (data || []).map((x: any) => x.id);
  } else {
    const { data } = await db.from("cm_members").select("user_id").eq("banned", false);
    recipients = (data || []).map((x: any) => x.user_id);
  }
  const [prefs, people] = await Promise.all([prefsFor(recipients.filter(Boolean)), membersFor(recipients)]);
  const { user: from, t } = transport();
  const rows = digestRows(c) || `<p style="font-size:14px;color:#5B6F83">(Preview) Nothing new this week yet. Real digests are skipped when there's nothing to share.</p>`;
  let sent = 0;
  for (const uid of recipients) {
    const p = prefs.get(uid), me = people.get(uid);
    if (!p || !me || (!previewOnly && !p.digest)) continue;
    if (sent >= 500) break;
    const to = await emailOf(uid);
    if (!to) continue;
    const subject = (previewOnly ? "[Preview] " : "") + "Your week in the RBD Community";
    try {
      await t.sendMail({
        from: `"RBD Community" <${from}>`, to, subject,
        html: layout({
          preheader: `${c.postCount} new post${c.postCount === 1 ? "" : "s"}, ${c.events.length} upcoming event${c.events.length === 1 ? "" : "s"}`,
          heading: `Hi ${first(me.display_name)}, here's your week`,
          intro: "The best of the Remote by Designs Community from the last 7 days.",
          rows, cta: "Join the conversation", ctaUrl: SITE, token: p.token, unsubType: "digest",
        }),
        text: `${subject}\n\nOpen the community: ${SITE}\n\nTurn off the weekly round-up: ${unsubUrl(p.token, "digest")}`,
        headers: { "List-Unsubscribe": `<${unsubUrl(p.token, "digest")}>` },
      });
      sent++;
    } catch (e) { console.error("digest send failed", uid, e); }
  }
  if (!previewOnly) await db.from("cm_email_runs").update({ sent }).eq("id", runId);
  return { sent, run: previewOnly ? "preview" : runId };
}

// ---------- Unsubscribe page ----------
function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;font-family:Poppins,Segoe UI,Helvetica,Arial,sans-serif;background:#EEF3F7;color:#0D2238;display:grid;place-items:center;min-height:100vh;padding:16px">
<div style="max-width:460px;background:#fff;border-radius:16px;padding:28px;text-align:center">
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#2F8F9D;font-weight:700">Remote by Designs Community</div>
<h1 style="font-size:21px;margin:10px 0">${esc(title)}</h1><p style="color:#41566B;line-height:1.6;font-size:14.5px">${body}</p>
<p><a href="${SITE}#/profile" style="display:inline-block;background:#2F8F9D;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:999px">Email settings</a></p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
async function unsubscribe(url: URL) {
  const token = url.searchParams.get("u") || "", t = url.searchParams.get("t") || "all";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return page("Link not recognised", "This unsubscribe link looks incomplete. You can change your emails anytime from My Profile.", 400);
  const keys = ["announcements", "events", "messages", "activity", "digest"];
  const upd: Record<string, boolean> = {};
  (t === "all" ? keys : keys.includes(t) ? [t] : []).forEach((k) => (upd[k] = false));
  if (!Object.keys(upd).length) return page("Link not recognised", "You can change your emails anytime from My Profile.", 400);
  const { data, error } = await db.from("cm_email_prefs").update(upd).eq("token", token).select("user_id");
  if (error || !data?.length) return page("Link not recognised", "We couldn't find these email settings. You can change your emails anytime from My Profile.", 404);
  return page("You're unsubscribed", `We've turned off ${esc(PREF_LABEL[t] || "these emails")}. You can switch them back on anytime in My Profile → Email settings.`);
}

// ---------- Entry ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") return unsubscribe(url);
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const key = req.headers.get("x-cron-key") || "";
  const { data: expected } = await db.rpc("cm_email_cron_key");
  if (!expected || key !== expected) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const mode = String(body.mode || "queue");
  try {
    const result = mode === "digest" ? await runDigest(false)
      : mode === "preview" ? await runDigest(true)
      : mode === "dryrun" ? await runQueue(true)
      : await runQueue(false);
    return new Response(JSON.stringify({ ok: true, mode, ...result }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
