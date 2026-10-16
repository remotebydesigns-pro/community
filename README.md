# Remote by Designs Community

**Live address:** https://community.remotebydesigns.com
**Current version:** `community-v4` (Oct 16, 2026)
**Replaces:** https://remote-bond-hub.base44.app

A members-only community for RBD learners, freelancers, aspiring VAs and remote professionals. It's a plain static site (no build step), hosted on Vercel. It uses the **same Supabase project as RBD Academy**, so members sign in with their Academy email and password.

---

## What's new in v4 (Oct 16, 2026)

- **Profile header fixed:** the name and headline now sit below the colour band, so they're always readable.
- **Colourful badges:** each badge has its own colour. Earned badges are highlighted; the rest show progress (for example 4 / 25 likes).
- **Give a badge (admins):** open any member's profile and click **Give a badge**. Choose from Bootcamp Graduate, Certified, Got Hired, Mentor, Community Helper, Event Host, Rising Star or Spotlight, with an optional note. Click again to take it back. The member gets a bell notification.
- **Job Board:** one wide column with no side widgets. The description is hidden until someone taps **View details**. Members tap **I applied** to mark that they applied; everyone sees the count, and admins can click the count to see who applied.
- Database changes: `supabase/community-v4.sql` (applied Oct 16, 2026).

## What's new in v3 (Oct 16, 2026)

- **Job Board.** New "Job Board" menu page and topic. Only admins post jobs, using a form (role, company, type, pay, location/hours, apply link or email, apply-by date). Members get a bell notification and a "Job alerts" email (they can switch it off). Admins can mark a job **Filled** or reopen it from the ⋯ menu. New openings also appear in the weekly round-up.
- **Topics.** Career Questions and Remote Work Tips are retired (hidden, not deleted). Use General Discussion. Topics now scroll as a slow marquee that pauses on hover.
- **Private groups.** A **Bootcamp** group with its own feed, visible only to its members (and admins). Admins add or remove people with **Manage members** on the group page or the Admin Dashboard. New posts notify group members. Group posts never show in the main feed or the weekly round-up.
- **Links instead of uploads in posts.** Posts take an **Image link** and a **Video link** (YouTube, Vimeo, Loom, Google Drive, or a direct .mp4) instead of file uploads. Profile photos still upload.
- **Badges** (typographic marks, no emoji): RBD Team, Top Contributor (top 3 of the last 30 days), Founding Member (first 100), Said Hello, First Post, Conversation Starter (10 posts), Helpful Voice (25 comments), Crowd Favorite (25 likes received), Event Regular (3 events), Bootcamper. Shown on profiles, member cards and next to names. Members page has a 30-day leaderboard (3 points per post, 2 per comment, 1 per like received).
- **Birthdays.** Month and day only, in My Profile (and in the welcome steps). Members choose whether it shows on their profile. On the day, they get a bell notification and a birthday email (8:00 AM Philippine time), and the feed shows a "Birthdays today" card.
- **Design:** menu selected/hover style matches the portfolio site, livelier cards (category colour accents, hover lift), compact event cards with a Details button, a redesigned Admin Dashboard (greeting banner with quick actions, colour stat tiles, 14-day activity chart, top contributors, upcoming birthdays, groups), solid-colour logo tile, WorkLedger link in the sidebar.
- **Phones:** text boxes are 16px so the phone no longer zooms in when you tap them, and nothing can push the page sideways.
- Database changes: `supabase/community-v3.sql` (applied Oct 16, 2026). New daily schedule `community-email-birthdays`.

## What's new in v2 (Oct 16, 2026)

- **Email notifications.** Members get an email about unread messages, comments on their posts, replies on posts they commented on, announcements and new events. Admins also get report alerts. Emails go out every 10 minutes, at most one per member per run, and only for things still unread after 5 minutes. Likes are never emailed.
- **Weekly round-up.** Every Monday at 9:00 AM (Philippine time): top conversations, upcoming events and new members. It's skipped when there's nothing to share.
- **Email settings.** Five on/off switches in **My Profile → Email settings**. Every email has one-click "turn off" and "unsubscribe from all" links.
- **Welcome steps for new members.** On their first visit, members see four short steps: what the community is for, then photo/headline/location, then an introduction post (with prompts), then email settings. Closing it counts as "skip". The member card starts from their Academy name, headline and bio.
- **Profile nudge.** The feed asks members without a photo or headline to complete their profile.
- **Edit posts.** Authors can edit their own posts from the ⋯ menu; edited posts show "· edited".
- **Report posts and comments.** ⋯ → Report post, or Report under a comment. Admins see them in **Admin Dashboard → Reports to review** (View, Keep it, Delete) and get a bell notification and email.
- **Admin dashboard:** new "Active this week" and "Open reports" numbers, plus a reminder showing how many Academy learners haven't joined yet.
- **Fix:** creating an event failed in v1 (a database notification rule error). Fixed in v2.

## Progress (updated Oct 16, 2026)

**Done**
- [x] v1: community built, database added to the *Remote By Designs Framework* Supabase project, deployed to Vercel, DNS connected.
- [x] v2 database changes applied (`supabase/community-v2.sql`) and tested inside the real database (15 checks, all rolled back): reports, email settings privacy, post editing, reply/report/event/announcement notifications.
- [x] `community-email` function deployed, with two schedules in Supabase (pg_cron): `community-email-queue` (every 10 min) and `community-email-digest` (Mondays 01:00 UTC = 9:00 AM Manila). A preview email was sent to the admin to confirm sending works.
- [x] Every new screen tested in a browser with sample data (22 checks), including phone width.

**To do (owner)**
- [ ] Redeploy `rbd-community` in Vercel so the site picks up v2 (see "Publishing a change" below). Until then the database and emails are already on v2, the screens are still v1.
- [ ] Supabase redirect URL: add `https://community.remotebydesigns.com/**` (section 2, step 2), if not done yet.
- [ ] Post the welcome announcement and the first events.
- [ ] Revoke the Base44 access token that was shared in chat.
- [ ] Optional: install the Vercel GitHub app for `remotebydesigns-pro` so pushes deploy automatically.

**Open items**
- Old Base44 posts and members were **not** moved over (we only had a screenshot). Members re-join by signing in with their Academy account.

## Emails: how they work

| Piece | Where |
|---|---|
| Sending code | `supabase/functions/community-email/index.ts` (Supabase → Edge Functions → `community-email`) |
| Mail server | Same SMTP secrets as the Academy (`SMTP_PASSWORD`, optional `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`). Sends from support@remotebydesigns.com as "RBD Community". |
| Schedules | Supabase → Integrations → Cron: `community-email-queue`, `community-email-digest` |
| Key | The schedules send a secret key stored in Supabase Vault as `cm_email_cron_key`; the function rejects calls without it. |
| Member choices | Table `cm_email_prefs` (members can only see and change their own row) |

To **pause all emails**, turn off both cron jobs in Supabase → Integrations → Cron. To **send yourself a sample round-up**, run in SQL Editor:
`select net.http_post(url := 'https://heamxeoqtncuneeoreda.supabase.co/functions/v1/community-email', headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='cm_email_cron_key')), body := '{"mode":"preview"}'::jsonb);`

---

## 1. What's in it

| Menu | What it does |
|---|---|
| **Feed** | Welcome card, post composer (category, image up to 5 MB, link), category filter chips, pinned posts first, likes, comments, "Read more" on long posts. Right column: latest announcement and the next 3 events. A "New posts" button appears when someone else posts. |
| **Messages** | One-to-one direct messages, with an unread count in the menu. New messages arrive live. Only the two people in a conversation can read it (admins can't either). |
| **Events** | Upcoming and past events with date tiles, "I'm going" RSVPs, attendee count and a **Join link** button when the location is a URL. Admins see **+ New event** and **Delete**. |
| **Members** | Everyone in the community, with search, a profile link and a **Message** button. |
| **My Profile** | Photo, name, headline, location and bio, plus your posts. Other members' profiles show a **Message** button. |
| **Admin Dashboard** (admins only) | Stats, **Post an announcement** (notifies everyone, pinned by default), pinned posts with **Unpin**, members list with **Pause access / Restore**. |
| **Community Guidelines** | The house rules. Text lives in `renderGuidelines` in `site/assets/community.js`. |
| **Bell** | Notifications for comments and likes on your posts, new announcements and new events. |

Light/dark mode follows the device until someone taps the sun/moon (same as the main site). On phones the menu becomes a ☰ drawer.

**Categories:** General Discussion, Introductions, Career Questions, Remote Work Tips, Wins & Milestones, Tools & Resources, and Announcement (RBD team only).

---

## 2. To go live

1. **Database (already done Oct 16, 2026).** The tables were added to the *Remote By Designs Framework* Supabase project. `supabase/community-v1.sql` is kept as the record and can be re-run in **SQL Editor** if ever needed. It only adds new `cm_*` tables and the `community` storage bucket. Existing Academy tables aren't touched.
2. **Allow sign-in links from the new address.** Supabase → **Authentication** → **URL Configuration** → **Redirect URLs** → add `https://community.remotebydesigns.com/**`. (Without this, password-reset and confirm-email links go to the Academy instead.)
3. **Hosting (done Oct 16, 2026).** The site is on **Vercel**, project `rbd-community`, with `community.remotebydesigns.com` attached. Vercel serves `index.html` and fetches everything in `site/assets/` from the public GitHub repo through jsDelivr, pinned to one commit (see `site/vercel.json`).
4. **Point the address at Vercel.** Cloudflare → remotebydesigns.com → **DNS** → **Add record**: type `CNAME`, name `community`, target `cname.vercel-dns.com`, proxy **off** (grey cloud, DNS only). Vercel issues the HTTPS certificate within a few minutes.
5. **Seed it.** Sign in with your admin account → **Admin Dashboard** → post the welcome announcement → **Events** → add the first events.

**Publishing a change:** push to `main`, put the new commit's ID into `site/vercel.json`, then redeploy `rbd-community` in Vercel. Or, simpler: install the Vercel GitHub app for `remotebydesigns-pro` (Vercel → project → Settings → Git) so every push deploys automatically. To undo a release: Vercel → Deployments → previous one → **Promote to Production**.

The `rbd-community.vercel.app` address asks for a Vercel login (Vercel's default protection). Members should use community.remotebydesigns.com.

---

## 3. Quick reference

| I want to… | Do this |
|---|---|
| Make someone an admin | Supabase → Table Editor → `profiles` → set `is_admin` to true (same switch as the Academy). |
| Remove someone | Admin Dashboard → Members → **Pause access**. **Restore** undoes it. |
| Pin / unpin a post | ⋯ menu on the post (admins), or **Unpin** on the Admin Dashboard. |
| Add / rename a category | Supabase → `cm_categories`. `admin_only` = only admins can post there. `sort` = order of the chips. |
| Change links, support email, Supabase keys | `site/assets/config.js`. |
| Change colours | Tokens at the top of `site/assets/community.css` (same as the main site). |

---

## 4. Look and feel

- **Colours:** Midnight Navy `#0D2238`, RBD Teal `#2F8F9D`, Logo Sky `#2B9FD3`, Accent Gold `#F2A93B`. Same tokens as the portfolio site.
- **Type:** Poppins throughout.
- Pinned posts and official announcements get a gold outline. The ADMIN badge is navy (gold in dark mode).

---

## 5. How it's protected

All rules live in the database (`supabase/community-v1.sql`), not the browser:

- Signed-out visitors can't read anything. Only signed-in, non-paused members can read the community.
- Members can only post, comment, like and RSVP as themselves, and edit or delete only their own posts and comments.
- Only admins can pin posts, post announcements, create events, see stats or pause members. Members can't un-pause themselves.
- Direct messages are visible only to the sender and recipient. The recipient can mark a message read but can't change its text.
- Private Academy data (emails, phone numbers, payments, coaching) is never exposed. The community has its own member cards (`cm_members`), created from the Academy name the first time someone opens the community.
- Uploaded images go to the public `community` bucket in each member's own folder. Anyone with an image's link can view it, so don't post private documents.

**Files:** `site/index.html`, `site/assets/community.js`, `site/assets/community.css`, `site/assets/config.js`, `site/assets/theme.js`, logos, `supabase/community-v1.sql`, `supabase/community-v2.sql`, `supabase/functions/community-email/index.ts`
