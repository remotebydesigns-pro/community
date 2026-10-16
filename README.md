# Remote by Designs Community

**Live address (once connected):** https://community.remotebydesigns.com
**Current version:** `community-v1` (Oct 16, 2026)
**Replaces:** https://remote-bond-hub.base44.app

A members-only community for RBD learners, freelancers, aspiring VAs and remote professionals. It's a plain static site (no build step), the same as the Academy. It uses the **same Supabase project as RBD Academy**, so members sign in with their Academy email and password.

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
3. **Publish.** Cloudflare → **Workers & Pages** → **Create application** → **upload / drag and drop your files** → name it `rbd-community` → upload the **`site`** folder → **Deploy**.
4. **Connect the address.** Project → **Custom domains** → **Set up a custom domain** → `community.remotebydesigns.com` → **Activate**.
5. **Seed it.** Sign in with your admin account → **Admin Dashboard** → post the welcome announcement → **Events** → add the first events.

To publish a new version later: same project → **Deployments** → **New deployment** → upload `site`. To undo: pick the previous deployment → **Rollback to this deployment**.

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

**Files:** `site/index.html`, `site/assets/community.js`, `site/assets/community.css`, `site/assets/config.js`, `site/assets/theme.js`, logos, `supabase/community-v1.sql`
