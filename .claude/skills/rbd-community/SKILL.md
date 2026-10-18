---
name: rbd-community
description: Working on the Remote by Designs Community (community.remotebydesigns.com). Use when changing the site, releasing it, debugging sign-in or password reset, or posting content (Job Board jobs, announcements) to the community from code or a scheduled task.
---

# RBD Community

A static site (no build step) on Vercel, backed by the **shared RBD Academy Supabase project** (`heamxeoqtncuneeoreda`). Members sign in with their Academy email and password. The owner reads `README.md`; keep it current and plain-English after every change.

## Files

| Path | What |
|---|---|
| `site/index.html` | Page shell. Loads supabase-js `2.45.4` (implicit auth flow) from jsDelivr. |
| `site/assets/community.js` | All app logic (one IIFE). Global state lives in `S`. |
| `site/assets/config.js` | Supabase URL, publishable key, `siteUrl`, support email, time zone. |
| `site/vercel.json` | Rewrites `/assets/*` to jsDelivr, **pinned to one commit**. |
| `supabase/community-v*.sql` | Database changes, applied in order. A record of what ran; new changes go in a new `community-vN.sql`. |
| `supabase/functions/community-email/index.ts` | Email edge function (queue, digest, birthdays, preview). |

## Releasing a change

1. Commit the change to `site/` or `supabase/`.
2. Put that commit's full SHA into `site/vercel.json` (`community@<sha>`), then commit with the message "Point Vercel asset rewrite at the latest commit". Skip this step and the live site keeps serving the old assets.
3. Merge to `main`. Vercel (project `rbd-community`, team `team_Hx2m1biaAozstXyqbUrM5LAW`) deploys `main` automatically.
4. Verify on the live site. The cloud container's network can't reach the site directly; use the Vercel MCP `web_fetch_vercel_url` on `https://community.remotebydesigns.com/assets/community.js` and grep for the change.
5. Update `README.md` ("What's new" / "Fix" section and the Progress list).

## Sign-in and password reset

- `resetPasswordForEmail(email, { redirectTo: C.siteUrl })`. The redirect URL `https://community.remotebydesigns.com/**` is allowed in Supabase.
- The reset link signs the member in. `getSession()` resolves **before** the `PASSWORD_RECOVERY` event fires, so the startup code reads `type=recovery` / `error_description` from `location.hash` **before** `createClient` (which clears the hash), and starts in `S.authMode = "reset"`. `enter()` bails out while in reset mode. Keep this ordering if you touch startup code, or reset links will open the feed again (the Oct 18, 2026 bug).
- Expired links arrive as `#error=...&error_description=...` and show a "request a new link" message.

## Posting content (Job Board and others)

Posts are rows in `public.cm_posts`. Inserting one fires the notification triggers (bell + email queue), exactly like posting from the site.

Job Board post shape (same as the site's form):

```json
{
  "author_id": "<admin user uuid>",
  "category_id": "jobs",
  "body": "Short description of the role",
  "link_url": null,
  "job": {
    "title": "Virtual Assistant",
    "company": "Acme",
    "type": "Part-time",
    "pay": "$6/hr",
    "location": "Remote, 20 hrs/week",
    "apply_url": "https://... or name@example.com",
    "closes_on": "2026-11-01"
  }
}
```

- `job.type` is one of: `Full-time`, `Part-time`, `Project-based`, `Freelance / contract`, `Internship`. Leave out empty keys. `title` is required. `apply_url` must be `https://` or an email address.
- Other categories: `announcement` (admins only; set `pinned: true` to pin), `general`, `introductions`, `wins`, `tools` and so on. See `cm_categories`.
- `jobs` and `announcement` are **admin-only**. `cm_posts_guard()` checks `public.is_admin()`, which reads `auth.uid()`. A plain SQL insert (no JWT) is not an admin and is rejected. When posting through SQL (Supabase MCP `execute_sql`, or pg_cron), run it as the admin inside one transaction:

  ```sql
  begin;
  select set_config('request.jwt.claims', json_build_object('sub', '<admin uuid>', 'role', 'authenticated')::text, true);
  insert into public.cm_posts (author_id, category_id, body, job)
  values ('<admin uuid>', 'jobs', '...', '{"title":"..."}'::jsonb);
  commit;
  ```

  This approach is not tested yet. Try it on one post, check it in the Job Board and the bell, then automate. Find the admin uuid with `select id from profiles where is_admin`.
- Before posting, check for duplicates: `select id from cm_posts where category_id = 'jobs' and job->>'title' = ... and job->>'company' = ...`.
- Mark a job filled: `update cm_posts set job_closed = true where id = ...` (as admin, same as above).

## Automation (planned, not set up yet)

The owner wants content (Job Board first) posted automatically with no computer on. Options:

- **Claude scheduled task** (`create_trigger`, `create_new_session_on_fire: true`, Supabase connector) that finds or writes content and inserts it as above. Use for content that needs judgment.
- **pg_cron job** in Supabase that publishes rows queued ahead of time. Use for content that is already written.

Before building either, confirm with the owner where jobs come from, how often to post, and whether to publish straight away or save drafts for review.
