/* Remote by Designs Community: feed, messages, events, members, profiles, admin.
   Talks to the shared RBD Academy Supabase project. All access rules live in the database. */
(function () {
  "use strict";
  var C = window.RBD_COMMUNITY;
  var sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey);

  var S = {
    user: null, me: null, isAdmin: false,
    members: new Map(), admins: new Set(), cats: [],
    cat: "all", feedOffset: 0, entered: false, channel: null,
    thread: null, authMode: "signin",
    groups: [], feedGroup: null, stats: new Map(), statsAt: 0, topIds: [], bdays: new Map(), awards: new Map(), applied: new Map()
  };
  var PAGE = 20;

  /* ---------- Helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function linkify(s) {
    return esc(s).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener nofollow ugc">$1</a>');
  }
  function safeUrl(u) {
    if (!u) return "";
    try { var x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch (e) { return ""; }
  }
  function ago(ts) {
    var s = (Date.now() - new Date(ts).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 172800) return "a day ago";
    if (s < 604800) return Math.floor(s / 86400) + " days ago";
    return fmtDate(ts, { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtDate(ts, opts) { return new Intl.DateTimeFormat(undefined, opts).format(new Date(ts)); }
  function fmtWhen(ts) { return fmtDate(ts, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  function initials(name) {
    var p = String(name || "?").trim().split(/\s+/);
    return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }
  function member(id) { return S.members.get(id) || { user_id: id, display_name: "Member" }; }
  function avatar(m, cls, link) {
    var inner = safeUrl(m.avatar_url) ? '<img src="' + esc(m.avatar_url) + '" alt="" loading="lazy">' : esc(initials(m.display_name));
    var tag = link === false ? "span" : "a";
    var href = link === false ? "" : ' href="#/u/' + esc(m.user_id) + '"';
    return "<" + tag + ' class="av ' + (cls || "") + '"' + href + ' aria-label="' + esc(m.display_name) + '">' + inner + "</" + tag + ">";
  }
  function adminTag(id) { return S.admins.has(id) ? '<span class="tag admin">Admin</span>' : ""; }
  var toastTimer;
  function toast(msg, isErr) {
    var t = $("#toast");
    t.textContent = msg; t.className = "toast" + (isErr ? " err" : ""); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function fail(err) { console.error(err); toast((err && err.message) || "Something went wrong. Please try again.", true); }
  function icon(name) {
    var P = {
      heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
      chat: '<path d="M4 5h16v11H8l-4 4z"/>',
      image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
      link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
      send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
      pin: '<path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8"/>',
      clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
      place: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
      mega: '<path d="M4 10v4h3l7 4V6L7 10zM17.5 9a4 4 0 0 1 0 6"/>',
      cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
      back: '<path d="M15 5 8 12l7 7"/>',
      check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
      play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
      brief: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18"/>',
      users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
      lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
      gift: '<rect x="4" y="9" width="16" height="11.5" rx="2"/><path d="M3 9h18M12 9v11.5M12 9S10.6 4 8.2 4.6C6.4 5 7 9 12 9zM12 9s1.4-5 3.8-4.4C17.6 5 17 9 12 9z"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
      spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'
    };
    return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + P[name] + "</svg>";
  }

  /* A simple dialog. body is HTML; returns the <dialog> element (removed from the page when closed). */
  function modal(title, body, opts) {
    opts = opts || {};
    var d = document.createElement("dialog");
    d.className = "modal" + (opts.wide ? " wide" : "");
    d.setAttribute("aria-label", title);
    d.innerHTML = '<div class="modal-head"><h2>' + esc(title) + '</h2>' +
      (opts.noClose ? "" : '<button class="round modal-x" type="button" aria-label="Close">✕</button>') + "</div>" + body;
    document.body.appendChild(d);
    var x = $(".modal-x", d); if (x) x.addEventListener("click", function () { d.close(); });
    d.addEventListener("close", function () { if (opts.onClose) opts.onClose(); d.remove(); });
    d.showModal();
    return d;
  }

  /* ---------- Media links (no uploads in posts: images and videos are shared by link) ---------- */
  function videoEmbed(u) {
    var url = safeUrl(u); if (!url) return "";
    var x = new URL(url), h = x.hostname.replace(/^www\.|^m\./, ""), id, src = "";
    if (h === "youtu.be") id = x.pathname.slice(1).split("/")[0];
    else if (/youtube\.com$/.test(h)) id = x.searchParams.get("v") || (x.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/) || [])[1];
    if (id && /^[\w-]{6,20}$/.test(id)) src = "https://www.youtube-nocookie.com/embed/" + id;
    else if (h === "vimeo.com" && (id = (x.pathname.match(/^\/(\d+)/) || [])[1])) src = "https://player.vimeo.com/video/" + id;
    else if (h === "loom.com" && (id = (x.pathname.match(/^\/share\/([\w-]+)/) || [])[1])) src = "https://www.loom.com/embed/" + id;
    else if (h === "drive.google.com" && (id = (x.pathname.match(/^\/file\/d\/([\w-]+)/) || [])[1])) src = "https://drive.google.com/file/d/" + id + "/preview";
    if (src) return '<div class="video"><iframe src="' + esc(src) + '" title="Shared video" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
    if (/\.(mp4|webm|mov)(\?|$)/i.test(x.pathname)) return '<video class="video-file" src="' + esc(url) + '" controls preload="metadata"></video>';
    return '<a class="post-link" href="' + esc(url) + '" target="_blank" rel="noopener nofollow ugc">' + icon("play") + "Watch video: " + esc(h) + "</a>";
  }
  function imageLinkOk(u) { return !!safeUrl(u); }

  /* ---------- Badges (typographic marks, no emoji) ---------- */
  var BADGES = [
    { id: "team", mark: "★", c: "#1D5F8E", name: "RBD Team", how: "Runs the community.", test: function (s, m) { return S.admins.has(m.user_id); } },
    { id: "top", mark: "♛", c: "#E09A2A", name: "Top Contributor", how: "Top 3 most active members in the last 30 days.", test: function (s, m) { return S.topIds.indexOf(m.user_id) >= 0; } },
    { id: "founding", mark: "✪", c: "#2B9FD3", name: "Founding Member", how: "One of the first 100 members.", test: function (s) { return s.join_rank <= 100; } },
    { id: "hello", mark: "✧", c: "#1D8FCF", name: "Said Hello", how: "Posted an introduction.", test: function (s) { return s.has_intro; }, goal: 1, val: function (s) { return s.has_intro ? 1 : 0; } },
    { id: "first", mark: "✎", c: "#2F8F9D", name: "First Post", how: "Shared a first post.", test: function (s) { return s.posts >= 1; }, goal: 1, val: function (s) { return s.posts; } },
    { id: "starter", mark: "✦", c: "#7C6CF0", name: "Conversation Starter", how: "10 posts shared.", test: function (s) { return s.posts >= 10; }, goal: 10, val: function (s) { return s.posts; } },
    { id: "helper", mark: "❖", c: "#22A06B", name: "Helpful Voice", how: "25 comments on other posts.", test: function (s) { return s.comments >= 25; }, goal: 25, val: function (s) { return s.comments; } },
    { id: "favorite", mark: "✺", c: "#E85D75", name: "Crowd Favorite", how: "25 likes received.", test: function (s) { return s.likes_received >= 25; }, goal: 25, val: function (s) { return s.likes_received; } },
    { id: "events", mark: "◈", c: "#D97706", name: "Event Regular", how: "Going to 3 events.", test: function (s) { return s.rsvps >= 3; }, goal: 3, val: function (s) { return s.rsvps; } },
    { id: "bootcamp", mark: "⚑", c: "#16395A", name: "Bootcamper", how: "Member of the Bootcamp group.", test: function (s) { return s.in_bootcamp; } }
  ];
  // Badges the RBD team gives by hand (Admin: open a member's profile, then "Give a badge")
  var AWARDS = [
    { id: "graduate", mark: "✔", c: "#22A06B", name: "Bootcamp Graduate", how: "Completed the RBD Bootcamp." },
    { id: "certified", mark: "◉", c: "#2B9FD3", name: "Certified", how: "Earned an RBD Academy certificate." },
    { id: "hired", mark: "➹", c: "#2F8F9D", name: "Got Hired", how: "Landed a remote role." },
    { id: "mentor", mark: "❂", c: "#7C6CF0", name: "Mentor", how: "Guides and supports other members." },
    { id: "helper-award", mark: "✚", c: "#0E7490", name: "Community Helper", how: "Goes out of their way to help others." },
    { id: "host", mark: "✹", c: "#E85D75", name: "Event Host", how: "Led a session for the community." },
    { id: "rising", mark: "✷", c: "#E09A2A", name: "Rising Star", how: "Stood out to the RBD team." },
    { id: "spotlight", mark: "☼", c: "#D97706", name: "Spotlight", how: "Featured by the RBD team." }
  ];
  function awardDef(id) { return AWARDS.find(function (a) { return a.id === id; }); }
  function badgesFor(m) {
    var st = S.stats.get(m.user_id) || null;
    var auto = st ? BADGES.filter(function (b) { return b.test(st, m); }) : BADGES.filter(function (b) { return b.id === "team" && S.admins.has(m.user_id); });
    var given = (S.awards.get(m.user_id) || []).map(function (x) { var d = awardDef(x.badge); return d ? Object.assign({ awarded: true, note: x.note }, d) : null; }).filter(Boolean);
    return given.concat(auto);
  }
  function bmark(b, big) {
    return '<span class="bmark' + (big ? " big" : "") + '" style="--bc:' + b.c + '" title="' + esc(b.name) + '" aria-label="' + esc(b.name) + ' badge">' + b.mark + "︎</span>";
  }
  function badgeMarks(m, max) { return badgesFor(m).slice(0, max || 3).map(function (b) { return bmark(b); }).join(""); }
  async function loadStats(force) {
    if (!force && Date.now() - S.statsAt < 120000) return;
    var r = await Promise.all([sb.rpc("cm_member_stats"), sb.from("cm_member_badges").select("user_id, badge, note, awarded_at")]);
    if (r[0].error) return;
    S.stats.clear();
    (r[0].data || []).forEach(function (x) { S.stats.set(x.user_id, x); });
    S.topIds = (r[0].data || []).filter(function (x) { return x.score_30d > 0; })
      .sort(function (a, b) { return b.score_30d - a.score_30d; }).slice(0, 3).map(function (x) { return x.user_id; });
    S.awards.clear();
    (r[1].data || []).forEach(function (x) { var a = S.awards.get(x.user_id) || []; a.push(x); S.awards.set(x.user_id, a); });
    S.statsAt = Date.now();
  }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  async function loadBirthdays() {
    var r = await sb.rpc("cm_public_birthdays");
    S.bdays.clear();
    (r.data || []).forEach(function (b) { S.bdays.set(b.user_id, b); });
  }
  function todayParts() {
    var p = new Intl.DateTimeFormat("en-CA", { timeZone: C.timeZone || "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-");
    return { y: +p[0], m: +p[1], d: +p[2] };
  }
  function isBirthdayToday(b) {
    var t = todayParts(), leap = (t.y % 4 === 0 && t.y % 100 !== 0) || t.y % 400 === 0;
    return b.month === t.m && (b.day === t.d || (!leap && t.m === 2 && t.d === 28 && b.day === 29));
  }

  async function uploadImage(file) {
    if (!file) return null;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("Please choose a JPG, PNG, WebP or GIF image.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Images must be 5 MB or smaller.");
    var ext = file.type.split("/")[1].replace("jpeg", "jpg");
    var path = S.user.id + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    var r = await sb.storage.from("community").upload(path, file, { contentType: file.type, upsert: false });
    if (r.error) throw r.error;
    return sb.storage.from("community").getPublicUrl(path).data.publicUrl;
  }

  async function loadMembers() {
    var r = await sb.from("cm_members").select("*").order("joined_at", { ascending: true });
    if (r.error) throw r.error;
    S.members.clear();
    r.data.forEach(function (m) { S.members.set(m.user_id, m); });
    S.me = S.members.get(S.user.id) || S.me;
  }
  async function ensureMembers(ids) {
    if (ids.some(function (id) { return id && !S.members.has(id); })) await loadMembers();
  }

  /* ---------- Sign in ---------- */
  function setAuthMode(mode) {
    S.authMode = mode;
    $$("[data-auth-tab]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.authTab === mode)); });
    $("[data-signup]").hidden = mode !== "signup";
    var f = $("#authForm");
    f.email.closest("label").hidden = mode === "reset";
    f.password.setAttribute("autocomplete", mode === "signin" ? "current-password" : "new-password");
    f.password.closest("label").firstChild.textContent = mode === "reset" ? "New password" : "Password";
    $("#authSubmit").textContent = { signin: "Sign in", signup: "Create my free account", reset: "Save new password" }[mode];
    $("#forgotBtn").hidden = mode !== "signin";
    $(".tabs").hidden = mode === "reset";
    authMsg("");
  }
  function authMsg(t, kind) { var m = $("#authMsg"); m.textContent = t; m.className = "form-msg" + (kind ? " " + kind : ""); }

  $$("[data-auth-tab]").forEach(function (b) { b.addEventListener("click", function () { setAuthMode(b.dataset.authTab); }); });
  $("#forgotBtn").addEventListener("click", async function () {
    var email = $("#authForm").email.value.trim();
    if (!email) { authMsg("Type your email above first, then tap Forgot password.", "err"); return; }
    var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: C.siteUrl });
    if (r.error) authMsg(r.error.message, "err");
    else authMsg("Check your inbox for a link to reset your password.", "ok");
  });
  $("#authForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var f = e.target, btn = $("#authSubmit");
    var email = f.email.value.trim(), password = f.password.value;
    if (S.authMode !== "reset" && !email) { authMsg("Please enter your email.", "err"); return; }
    if (password.length < 8) { authMsg("Passwords need at least 8 characters.", "err"); return; }
    btn.disabled = true; authMsg("");
    try {
      var r;
      if (S.authMode === "signin") {
        r = await sb.auth.signInWithPassword({ email: email, password: password });
        if (r.error) throw r.error;
      } else if (S.authMode === "signup") {
        var name = f.full_name.value.trim();
        if (!name) throw new Error("Please enter your name.");
        r = await sb.auth.signUp({ email: email, password: password, options: { data: { full_name: name }, emailRedirectTo: C.siteUrl } });
        if (r.error) throw r.error;
        if (!r.data.session) authMsg("Almost there! Check your email and tap the confirmation link.", "ok");
      } else {
        r = await sb.auth.updateUser({ password: password });
        if (r.error) throw r.error;
        toast("Password updated.");
        setAuthMode("signin");
        enter(r.data.user);
      }
    } catch (err) {
      authMsg(/invalid login/i.test(err.message) ? "That email and password don't match. Try again or reset your password." : err.message, "err");
    } finally { btn.disabled = false; }
  });

  function showAuth() {
    S.entered = false;
    $("#app").hidden = true; $("#auth").hidden = false;
    if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  }

  async function enter(user) {
    if (S.entered && S.user && S.user.id === user.id) return;
    S.user = user; S.entered = true;
    try {
      var j = await sb.rpc("cm_join");
      if (j.error) throw j.error;
      if (!j.data.ok) { await sb.auth.signOut(); showAuth(); authMsg(j.data.error, "err"); return; }
      var res = await Promise.all([
        sb.rpc("is_admin"),
        sb.from("cm_categories").select("*").order("sort"),
        sb.rpc("cm_admin_ids"),
        loadMembers(),
        sb.from("cm_groups").select("*").order("name"),
        loadBirthdays()
      ]);
      S.isAdmin = !!res[0].data;
      S.cats = (res[1].data || []).filter(function (c) { return !c.hidden; });
      S.groups = res[4].data || [];
      S.admins = new Set((res[2].data || []).map(function (x) { return typeof x === "string" ? x : x.cm_admin_ids; }));
    } catch (err) { S.entered = false; fail(err); return; }
    $("#auth").hidden = true; $("#app").hidden = false;
    $("#adminNav").hidden = !S.isAdmin;
    paintMe();
    paintGroupNav();
    await loadStats(true);
    subscribe();
    refreshCounts();
    route();
    if (S.me && !S.me.onboarded_at) openOnboarding();
  }

  /* ---------- First-run welcome: profile → introduce yourself → email settings ---------- */
  var INTRO_TEMPLATE = function (m) {
    var first = (m.display_name || "").split(" ")[0];
    return "Hi everyone! I'm " + (first && first !== "Member" ? first : "___") + (m.location ? " from " + m.location : "") + ".\n\n" +
      "👋 What I do (or want to do): \n" +
      "🎯 My goal for the next 90 days: \n" +
      "🧰 A skill or tool I'm learning: \n" +
      "💬 Happy to help with: ";
  };
  async function markOnboarded() {
    if (S.me.onboarded_at) return;
    var r = await sb.from("cm_members").update({ onboarded_at: new Date().toISOString() }).eq("user_id", S.user.id).select().single();
    if (!r.error && r.data) { S.me = r.data; S.members.set(S.user.id, r.data); }
  }
  function openOnboarding() {
    var m = S.me, first = (m.display_name || "").split(" ")[0], photo = null, step = 1;
    var d = modal("Welcome to the community", '<div class="ob-steps" aria-hidden="true"><span></span><span></span><span></span><span></span></div><div class="ob-body" id="obBody"></div>', {
      wide: true, onClose: function () { markOnboarded(); }
    });
    var body = $("#obBody", d), dots = $$(".ob-steps span", d);
    function paint() {
      dots.forEach(function (s, i) { s.classList.toggle("on", i < step); });
      if (step === 1) {
        body.innerHTML =
          '<p class="eyebrow"><span class="dot"></span>Step 1 of 4</p>' +
          "<h3>Hi " + esc(first && first !== "Member" ? first : "there") + ", glad you're here 👋</h3>" +
          '<p class="muted">This is where RBD learners, freelancers and remote professionals help each other grow. Here\'s how it works:</p>' +
          '<ul class="ob-list"><li><b>Ask and share.</b> Post questions, tools, wins and lessons in the feed.</li>' +
          "<li><b>Show up live.</b> Join workshops and Q&amp;As on the Events page.</li>" +
          "<li><b>Connect.</b> Message other members directly. Be kind, and no selling in DMs.</li></ul>" +
          '<div class="ob-actions"><button class="btn btn-navy" type="button" data-ob="next">Set up my profile</button><button class="linkish" type="button" data-ob="skip">Skip for now</button></div>';
      } else if (step === 2) {
        body.innerHTML =
          '<p class="eyebrow"><span class="dot"></span>Step 2 of 4</p><h3>Help people know who you are</h3>' +
          '<p class="muted">A photo and headline help members recognise you and know how to help.</p>' +
          '<form class="stack" id="obProfile"><div class="avatar-edit">' + avatar(m, "lg", false) +
          '<label class="btn btn-line btn-sm" style="flex-direction:row;color:var(--ink)">Add a photo<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden></label></div>' +
          '<label>Name<input name="display_name" maxlength="80" required value="' + esc(m.display_name === "Member" ? "" : m.display_name) + '" autocomplete="name"></label>' +
          '<label>Headline<input name="headline" maxlength="120" placeholder="e.g. Aspiring VA · Real estate support · Learning GoHighLevel" value="' + esc(m.headline || "") + '"></label>' +
          '<label>Location<input name="location" maxlength="80" placeholder="e.g. Cebu, Philippines" value="' + esc(m.location || "") + '"></label>' +
          birthdayFieldsHTML(null) +
          '<div class="ob-actions"><button class="btn btn-navy" type="submit">Save and continue</button><button class="linkish" type="button" data-ob="next">Skip this step</button></div></form>';
        var f = $("#obProfile", body);
        f.photo.addEventListener("change", function () {
          photo = this.files[0] || null;
          if (photo) $(".avatar-edit .av", f).innerHTML = '<img src="' + URL.createObjectURL(photo) + '" alt="">';
        });
        f.addEventListener("submit", async function (e) {
          e.preventDefault();
          var b = $("button[type=submit]", f); b.disabled = true;
          try {
            var upd = { display_name: f.display_name.value.trim(), headline: f.headline.value.trim() || null, location: f.location.value.trim() || null };
            if (!upd.display_name) throw new Error("Please enter your name.");
            if (photo) upd.avatar_url = await uploadImage(photo);
            await saveBirthday(f);
            var r = await sb.from("cm_members").update(upd).eq("user_id", S.user.id).select().single();
            if (r.error) throw r.error;
            S.me = m = r.data; S.members.set(S.user.id, r.data); paintMe();
            step = 3; paint();
          } catch (err) { fail(err); } finally { b.disabled = false; }
        });
      } else if (step === 3) {
        body.innerHTML =
          '<p class="eyebrow"><span class="dot"></span>Step 3 of 4</p><h3>Introduce yourself</h3>' +
          '<p class="muted">A short hello in <b>Introductions</b> is the fastest way to meet people. Edit the prompts below.</p>' +
          '<form class="stack" id="obIntro"><textarea name="body" maxlength="5000" rows="8" aria-label="Your introduction">' + esc(INTRO_TEMPLATE(m)) + "</textarea>" +
          '<div class="ob-actions"><button class="btn btn-navy" type="submit">Post my introduction</button><button class="linkish" type="button" data-ob="next">Skip this step</button></div></form>';
        var fi = $("#obIntro", body);
        fi.addEventListener("submit", async function (e) {
          e.preventDefault();
          var text = fi.body.value.trim();
          if (!text) { fi.body.focus(); return; }
          var b = $("button[type=submit]", fi); b.disabled = true;
          var r = await sb.from("cm_posts").insert({ author_id: S.user.id, category_id: "introductions", body: text }).select(POST_SELECT).single();
          b.disabled = false;
          if (r.error) { fail(r.error); return; }
          toast("Introduction posted. Welcome!");
          var box = $("#posts"); if (box) box.insertAdjacentHTML("afterbegin", postHTML(r.data));
          step = 4; paint();
        });
      } else {
        body.innerHTML =
          '<p class="eyebrow"><span class="dot"></span>Step 4 of 4</p><h3>Stay in the loop</h3>' +
          '<p class="muted">Choose what we email you about. You can change this anytime in My Profile.</p>' +
          '<div id="obPrefs" class="prefs"><div class="loading">Loading…</div></div>' +
          '<div class="ob-actions"><button class="btn btn-navy" type="button" data-ob="done">Go to the community</button></div>';
        renderPrefs($("#obPrefs", body));
      }
      var h = $("h3", body); if (h) { h.setAttribute("tabindex", "-1"); h.focus(); }
    }
    body.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ob]");
      if (!b) return;
      if (b.dataset.ob === "next") { step++; paint(); }
      else d.close();
    });
    paint();
  }

  /* ---------- Email settings (toggles save straight away) ---------- */
  var PREF_ROWS = [
    ["messages", "Direct messages", "When a member messages you and you haven't read it yet."],
    ["activity", "Comments & groups", "Comments on your posts or posts you've commented on, and new posts in your private groups."],
    ["announcements", "Announcements", "Official news from the RBD team."],
    ["events", "New events", "Workshops, Q&As and live sessions."],
    ["jobs", "Job alerts", "When a new opening is posted on the Job Board."],
    ["digest", "Weekly round-up", "Monday morning: top posts, upcoming events and new members."]
  ];
  async function renderPrefs(box) {
    var r = await sb.from("cm_email_prefs").select("announcements, events, messages, activity, digest, jobs").eq("user_id", S.user.id).maybeSingle();
    if (r.error) { box.innerHTML = '<p class="muted">Couldn\'t load your email settings.</p>'; return; }
    var p = r.data || { announcements: true, events: true, messages: true, activity: true, digest: true, jobs: true };
    box.innerHTML = PREF_ROWS.map(function (row) {
      return '<label class="pref"><span><b>' + row[1] + "</b><small>" + row[2] + '</small></span>' +
        '<input type="checkbox" role="switch" class="switch" data-pref="' + row[0] + '"' + (p[row[0]] ? " checked" : "") + "></label>";
    }).join("") + '<p class="tiny muted">Emails go to your Academy sign-in address. Likes are never emailed.</p>';
    box.addEventListener("change", async function (e) {
      var c = e.target.closest("[data-pref]");
      if (!c) return;
      var upd = {}; upd[c.dataset.pref] = c.checked;
      c.disabled = true;
      var u = await sb.from("cm_email_prefs").update(upd).eq("user_id", S.user.id);
      c.disabled = false;
      if (u.error) { c.checked = !c.checked; fail(u.error); } else toast("Email settings saved.");
    });
  }

  /* ---------- Reporting ---------- */
  var REPORT_REASONS = ["Spam or unwanted selling", "Scam or suspicious link", "Harassment or hate", "Sharing private information", "Something else"];
  function openReport(postId, commentId) {
    var d = modal(commentId ? "Report this comment" : "Report this post",
      '<form class="stack" id="reportForm"><p class="muted">Only the RBD team sees reports. Thanks for helping keep this space safe.</p>' +
      '<fieldset class="reasons"><legend class="tiny muted">What\'s wrong?</legend>' +
      REPORT_REASONS.map(function (r, i) { return '<label class="check"><input type="radio" name="reason" value="' + esc(r) + '"' + (i === 0 ? " checked" : "") + "> " + esc(r) + "</label>"; }).join("") +
      '</fieldset><label>Anything else we should know? (optional)<textarea name="detail" maxlength="400" rows="3"></textarea></label>' +
      '<div class="ob-actions"><button class="btn btn-navy" type="submit">Send report</button><button class="linkish" type="button" data-cancel>Cancel</button></div></form>');
    var f = $("#reportForm", d);
    $("[data-cancel]", f).addEventListener("click", function () { d.close(); });
    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var reason = f.querySelector("input[name=reason]:checked").value, detail = f.detail.value.trim();
      var b = $("button[type=submit]", f); b.disabled = true;
      var r = await sb.from("cm_reports").insert({ post_id: postId || null, comment_id: commentId || null, reporter_id: S.user.id, reason: (reason + (detail ? ": " + detail : "")).slice(0, 500) });
      b.disabled = false;
      if (r.error && r.error.code !== "23505") { fail(r.error); return; }
      d.close();
      toast(r.error ? "You've already reported this. The team will review it." : "Thanks. The RBD team will review it.");
    });
  }

  /* ---------- Editing a post ---------- */
  function startEdit(postEl, p) {
    if ($(".edit-form", postEl)) return;
    var bodyEl = $(".post-body", postEl), more = $(".read-more", postEl);
    var cats = S.cats.filter(function (c) { return !c.admin_only || S.isAdmin; });
    var form = document.createElement("form");
    form.className = "edit-form stack";
    form.innerHTML = '<textarea name="body" maxlength="5000" rows="6" aria-label="Edit your post" required>' + esc(p.body) + "</textarea>" +
      '<div class="composer-tools"><select name="category" aria-label="Category">' +
      cats.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === p.category_id ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") +
      '</select><button class="btn btn-navy btn-sm" type="submit">Save changes</button><button class="btn btn-line btn-sm" type="button" data-cancel>Cancel</button></div>';
    bodyEl.hidden = true; if (more) more.hidden = true;
    bodyEl.insertAdjacentElement("afterend", form);
    form.body.focus();
    $("[data-cancel]", form).addEventListener("click", function () { form.remove(); bodyEl.hidden = false; if (more) more.hidden = false; });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var text = form.body.value.trim();
      if (!text) return;
      var b = $("button[type=submit]", form); b.disabled = true;
      var r = await sb.from("cm_posts").update({ body: text, category_id: form.category.value }).eq("id", p.id).select(POST_SELECT).single();
      b.disabled = false;
      if (r.error) { fail(r.error); return; }
      var full = currentRoute()[0] === "post";
      postEl.insertAdjacentHTML("afterend", postHTML(r.data, { full: full }));
      var fresh = postEl.nextElementSibling;
      postEl.remove();
      if (full) loadComments(fresh);
      toast("Post updated.");
    });
  }
  function paintMe() { $("#meBtn").innerHTML = avatar(S.me, "sm", false); }
  function paintGroupNav() {
    $("#groupNav").hidden = !S.groups.length;
    $("#groupList").innerHTML = S.groups.map(function (g) {
      return '<a class="nav-item" href="#/g/' + esc(g.slug) + '" data-route="g-' + esc(g.slug) + '">' + icon("lock") + "<span>" + esc(g.name) + "</span></a>";
    }).join("");
  }

  $("#signOutBtn").addEventListener("click", async function () { await sb.auth.signOut(); location.hash = ""; showAuth(); });

  /* ---------- Live updates ---------- */
  function subscribe() {
    if (S.channel) sb.removeChannel(S.channel);
    S.channel = sb.channel("cm-" + S.user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cm_messages", filter: "recipient_id=eq." + S.user.id }, function (p) {
        var m = p.new;
        if (S.thread === m.sender_id) { appendMsg(m); markThreadRead(m.sender_id); }
        else toast(member(m.sender_id).display_name + " sent you a message");
        refreshCounts();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cm_notifications", filter: "user_id=eq." + S.user.id }, function () { refreshCounts(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cm_posts" }, function (p) {
        var r0 = currentRoute()[0], g = p.new.group_id || null;
        var onIt = (r0 === "feed" && !g) || (r0 === "g" && S.feedGroup && S.feedGroup.id === g) || (r0 === "jobs" && p.new.category_id === "jobs");
        if (p.new.author_id !== S.user.id && onIt) { var b = $("#newPosts"); if (b) b.hidden = false; }
      })
      .subscribe();
  }

  async function refreshCounts() {
    var r = await Promise.all([
      sb.from("cm_messages").select("id", { count: "exact", head: true }).eq("recipient_id", S.user.id).is("read_at", null),
      sb.from("cm_notifications").select("id", { count: "exact", head: true }).eq("user_id", S.user.id).is("read_at", null).neq("kind", "message")
    ]);
    var msgs = r[0].count || 0, notes = r[1].count || 0;
    var mc = $("#msgCount"); mc.hidden = !msgs; mc.textContent = msgs > 99 ? "99+" : msgs;
    var bc = $("#bellCount"); bc.hidden = !notes; bc.textContent = notes > 99 ? "99+" : notes;
  }

  /* ---------- Popovers & mobile menu ---------- */
  function togglePop(btn, pop, open) {
    var willOpen = open == null ? pop.hidden : open;
    $$(".pop").forEach(function (p) { if (p !== pop) p.hidden = true; });
    pop.hidden = !willOpen; btn.setAttribute("aria-expanded", String(willOpen));
    return willOpen;
  }
  $("#meBtn").addEventListener("click", function (e) { e.stopPropagation(); togglePop(this, $("#mePop")); });
  $("#bellBtn").addEventListener("click", async function (e) {
    e.stopPropagation();
    if (togglePop(this, $("#bellPop"))) await showNotifications();
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".pop-wrap") && !e.target.closest(".post-menu")) $$(".pop").forEach(function (p) { p.hidden = true; });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { $$(".pop").forEach(function (p) { p.hidden = true; }); closeMenu(); } });
  $$("[data-theme-toggle]").forEach(function (b) { b.addEventListener("click", function () { window.RBDTheme.toggle(); }); });
  function closeMenu() { $("#side").classList.remove("open"); $("#scrim").classList.remove("open"); $("#menuBtn").setAttribute("aria-expanded", "false"); }
  $("#menuBtn").addEventListener("click", function () {
    var open = !$("#side").classList.contains("open");
    $("#side").classList.toggle("open", open); $("#scrim").classList.toggle("open", open); this.setAttribute("aria-expanded", String(open));
  });
  $("#scrim").addEventListener("click", closeMenu);

  async function showNotifications() {
    var pop = $("#bellPop");
    pop.innerHTML = '<div class="loading">Loading…</div>';
    var r = await sb.from("cm_notifications").select("*, cm_events(title)").eq("user_id", S.user.id).neq("kind", "message").order("created_at", { ascending: false }).limit(30);
    if (r.error) { pop.innerHTML = '<div class="empty">Couldn\'t load notifications.</div>'; return; }
    await ensureMembers(r.data.map(function (n) { return n.actor_id; }));
    var rows = r.data.map(function (n) {
      var who = n.actor_id ? member(n.actor_id) : null, name = who ? "<b>" + esc(who.display_name) + "</b>" : "";
      var text = {
        comment: name + " commented on your post",
        reply: name + " also commented on a post you're following",
        report: name + " reported a post. Review it in the Admin Dashboard",
        group: name + " posted in " + esc((S.groups.find(function (g) { return g.id === n.group_id; }) || { name: "your group" }).name),
        job: "New opening on the <b>Job Board</b>",
        birthday: "<b>Happy birthday!</b> Everyone at Remote by Designs is celebrating you today.",
        badge: "You received the <b>" + esc((awardDef(n.badge) || { name: "new" }).name) + "</b> badge" + (name ? " from " + name : ""),
        like: name + " liked your post",
        announcement: "New announcement from " + (name || "the RBD team"),
        event: "New event: <b>" + esc(n.cm_events ? n.cm_events.title : "") + "</b>"
      }[n.kind] || "Update";
      var href = n.kind === "report" ? "#/admin" : n.kind === "job" ? "#/jobs" : n.kind === "birthday" || n.kind === "badge" ? "#/profile" : n.post_id ? "#/post/" + n.post_id : n.event_id ? "#/events" : "#/feed";
      return '<a class="notif' + (n.read_at ? "" : " unread") + '" href="' + href + '">' +
        (who ? avatar(who, "sm", false) : '<span class="av sm">' + icon(n.kind === "birthday" ? "gift" : "cal") + "</span>") +
        "<span>" + text + "<small>" + ago(n.created_at) + "</small></span></a>";
    }).join("");
    pop.innerHTML = '<div class="pop-head">Notifications</div>' + (rows || '<div class="empty">You\'re all caught up.</div>');
    if (r.data.some(function (n) { return !n.read_at; })) {
      await sb.from("cm_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", S.user.id).is("read_at", null).neq("kind", "message");
      refreshCounts();
    }
  }

  /* ---------- Router ---------- */
  var TITLES = { feed: "Community Feed", jobs: "Job Board", g: "Group", post: "Post", messages: "Messages", events: "Events", members: "Members", profile: "My Profile", u: "Member", admin: "Admin Dashboard", guidelines: "Community Guidelines" };
  function currentRoute() { return (location.hash.replace(/^#\/?/, "") || "feed").split("/"); }
  async function route() {
    if (!S.entered) return;
    var parts = currentRoute(), name = parts[0];
    if (!TITLES[name] || (name === "admin" && !S.isAdmin)) { location.hash = "#/feed"; return; }
    S.thread = null;
    closeMenu();
    $$(".pop").forEach(function (p) { p.hidden = true; });
    var navName = name === "post" ? "feed" : name === "u" ? (parts[1] === S.user.id ? "profile" : "members") : name === "g" ? "g-" + parts[1] : name;
    S.feedGroup = null;
    $$(".nav-item").forEach(function (a) { if (a.dataset.route === navName) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    $("#pageTitle").textContent = TITLES[name];
    document.title = TITLES[name] + " · Remote by Designs Community";
    // Fresh container per page so click handlers from the previous page go away with it
    var main = document.createElement("div");
    main.innerHTML = '<div class="loading">Loading…</div>';
    $("#main").replaceChildren(main);
    try {
      if (name === "feed") await renderFeed(main);
      else if (name === "jobs") await renderJobs(main);
      else if (name === "g") await renderGroup(main, parts[1]);
      else if (name === "post") await renderSinglePost(main, parts[1]);
      else if (name === "messages") await renderMessages(main, parts[1]);
      else if (name === "events") await renderEvents(main);
      else if (name === "members") await renderMembers(main);
      else if (name === "profile") await renderProfile(main, S.user.id, parts[1] === "edit");
      else if (name === "u") await renderProfile(main, parts[1]);
      else if (name === "admin") await renderAdmin(main);
      else if (name === "guidelines") renderGuidelines(main);
    } catch (err) { main.innerHTML = '<div class="card empty"><b>Something went wrong</b>Please refresh the page.</div>'; fail(err); }
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  /* ---------- Posts ---------- */
  var POST_SELECT = "*, cm_comments(count), cm_likes(user_id)";
  function catName(id) { var c = S.cats.find(function (x) { return x.id === id; }); return c ? c.name : ""; }

  function jobHTML(p, full) {
    var j = p.job || {}, apply = safeUrl(j.apply_url), mail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(j.apply_url || "") ? "mailto:" + j.apply_url : "";
    var bits = [j.company, j.type, j.location, j.pay].filter(Boolean);
    return '<div class="job">' +
      '<div class="job-top"><span class="job-ico">' + icon("brief") + "</span><div><h3>" + esc(j.title || "Open role") + "</h3>" +
      (bits.length ? '<div class="job-bits">' + bits.map(function (b) { return "<span>" + esc(b) + "</span>"; }).join("") + "</div>" : "") + "</div>" +
      '<span class="job-status ' + (p.job_closed ? "closed" : "open") + '">' + (p.job_closed ? "Filled" : "Open") + "</span></div>" +
      (j.closes_on ? '<p class="tiny muted job-close">Apply by ' + esc(fmtDate(j.closes_on + "T12:00:00", { month: "long", day: "numeric", year: "numeric" })) + "</p>" : "") +
      '<div class="job-actions">' +
      (!p.job_closed && (apply || mail) ? '<a class="btn btn-gold btn-sm" href="' + esc(apply || mail) + '" target="_blank" rel="noopener nofollow">Apply now</a>' : "") +
      (!p.job_closed ? '<button class="btn btn-line btn-sm applied-btn" type="button" data-act="applied" aria-pressed="false">' + icon("check") + "I applied</button>" : "") +
      '<button class="applied-n" type="button" data-act="applied-list"' + (S.isAdmin ? "" : " disabled") + '><b data-applied-count>0</b> applied</button>' +
      '<button class="linkish tiny job-more" type="button" data-act="job-more" aria-expanded="' + !!full + '">' + (full ? "Hide details" : "View details") + "</button>" +
      "</div></div>";
  }
  async function hydrateApplied(root) {
    var ids = $$("[data-post].is-job", root || document).map(function (el) { return el.dataset.post; });
    if (!ids.length) return;
    var r = await sb.rpc("cm_job_applied", { pids: ids });
    (r.data || []).forEach(function (x) {
      S.applied.set(x.post_id, x);
      $$('[data-post="' + x.post_id + '"]', root || document).forEach(function (el) { paintApplied(el, x); });
    });
  }
  function paintApplied(el, x) {
    var n = $("[data-applied-count]", el); if (n) n.textContent = x.applied;
    var b = $(".applied-btn", el);
    if (b) { b.setAttribute("aria-pressed", String(!!x.mine)); b.classList.toggle("on", !!x.mine); b.lastChild.textContent = x.mine ? "You applied" : "I applied"; }
  }
  function catClass(id) { return "c-" + String(id || "general").replace(/[^a-z0-9-]/g, ""); }

  function postHTML(p, opts) {
    opts = opts || {};
    var a = member(p.author_id), mine = p.author_id === S.user.id;
    var likes = p.cm_likes || [], liked = likes.some(function (l) { return l.user_id === S.user.id; });
    var cCount = p.cm_comments && p.cm_comments[0] ? p.cm_comments[0].count : 0;
    var long = p.body.length > 600 || p.body.split("\n").length > 9;
    var link = safeUrl(p.link_url), img = safeUrl(p.image_url), isJob = p.category_id === "jobs";
    var menu = '<div class="post-menu"><button class="menu-btn" type="button" data-act="menu" aria-label="Post options">⋯</button><div class="pop pop-sm" hidden>' +
      (mine ? '<button type="button" data-act="edit">Edit post</button>' : "") +
      (S.isAdmin && isJob ? '<button type="button" data-act="job-toggle">' + (p.job_closed ? "Reopen this job" : "Mark as filled") + "</button>" : "") +
      (S.isAdmin && !p.group_id ? '<button type="button" data-act="pin">' + (p.pinned ? "Unpin post" : "Pin to top") + "</button>" : "") +
      (mine || S.isAdmin ? '<button type="button" data-act="delete">Delete post</button>' : "") +
      (!mine ? '<button type="button" data-act="report">Report post</button>' : "") +
      "</div></div>";
    var grp = p.group_id ? S.groups.find(function (g) { return g.id === p.group_id; }) : null;
    return '<article class="card post ' + catClass(p.category_id) + (p.pinned ? " pinned" : "") + (isJob ? " is-job" : "") + (isJob && p.job_closed ? " job-closed" : "") + '" data-post="' + p.id + '">' +
      (p.pinned ? '<div class="pin-label">' + icon("pin") + (p.category_id === "announcement" ? "Official announcement" : "Pinned") + "</div>" : "") +
      '<div class="post-head">' + avatar(a) +
      '<div class="post-meta"><a class="name" href="#/u/' + a.user_id + '">' + esc(a.display_name) + adminTag(a.user_id) + badgeMarks(a, 2) + "</a>" +
      '<div class="sub">' + (a.headline ? '<span class="hl">' + esc(a.headline) + "</span><span>·</span>" : "") +
      '<a href="#/post/' + p.id + '" class="muted" style="text-decoration:none">' + ago(p.created_at) + "</a>" +
      (p.edited_at ? '<span class="muted" title="Edited ' + esc(fmtWhen(p.edited_at)) + '">· edited</span>' : "") +
      (grp ? '<span class="tag lock">' + icon("lock") + esc(grp.name) + "</span>" : '<span class="tag ' + catClass(p.category_id) + '">' + esc(catName(p.category_id)) + "</span>") +
      "</div></div>" + menu + "</div>" +
      (isJob && p.job ? jobHTML(p, opts.full) : "") +
      '<div class="post-body' + (long && !opts.full && !isJob ? " clamp" : "") + '"' + (isJob && p.job && !opts.full ? " hidden" : "") + ">" + linkify(p.body) + "</div>" +
      (long && !opts.full && !isJob ? '<button class="read-more" type="button" data-act="more">Read more</button>' : "") +
      (img ? '<a class="post-img-link" href="' + esc(img) + '" target="_blank" rel="noopener"><img class="post-img" src="' + esc(img) + '" alt="Image shared by ' + esc(a.display_name) + '" loading="lazy" onerror="this.closest(\'a\').classList.add(\'broken\')"><span class="img-fallback">' + icon("image") + "Open image</span></a>" : "") +
      (p.video_url ? videoEmbed(p.video_url) : "") +
      (link ? '<a class="post-link" href="' + esc(link) + '" target="_blank" rel="noopener nofollow ugc">' + icon("link") + esc(link) + "</a>" : "") +
      '<div class="post-actions">' +
      '<button class="act' + (liked ? " on" : "") + '" type="button" data-act="like" aria-pressed="' + liked + '">' + icon("heart") + '<span data-likes>' + likes.length + "</span></button>" +
      '<button class="act" type="button" data-act="comments" aria-expanded="' + !!opts.full + '">' + icon("chat") + "<span data-ccount>" + cCount + "</span> " + (cCount === 1 ? "comment" : "comments") + "</button>" +
      "</div>" +
      '<div class="comments" data-comments' + (opts.full ? "" : " hidden") + "></div></article>";
  }

  async function loadComments(postEl) {
    var box = $("[data-comments]", postEl), id = postEl.dataset.post;
    box.innerHTML = '<div class="tiny muted">Loading comments…</div>';
    var r = await sb.from("cm_comments").select("*").eq("post_id", id).order("created_at");
    if (r.error) { fail(r.error); return; }
    await ensureMembers(r.data.map(function (c) { return c.author_id; }));
    box.innerHTML = r.data.map(commentHTML).join("") +
      '<form class="comment-form">' + avatar(S.me, "sm", false) +
      '<textarea name="body" rows="1" maxlength="2000" placeholder="Write a comment…" aria-label="Write a comment" required></textarea>' +
      '<button class="btn btn-navy btn-sm" type="submit">Reply</button></form>';
  }
  function commentHTML(c) {
    var a = member(c.author_id), canDel = c.author_id === S.user.id || S.isAdmin;
    return '<div class="comment" data-comment="' + c.id + '">' + avatar(a, "sm") +
      '<div style="flex:1;min-width:0"><div class="comment-bubble"><b>' + esc(a.display_name) + "</b> " + adminTag(a.user_id) + "<p>" + linkify(c.body) + "</p></div>" +
      '<div class="comment-foot"><span>' + ago(c.created_at) + "</span>" + (canDel ? '<button class="linkish tiny" type="button" data-act="del-comment">Delete</button>' : "") +
      (c.author_id !== S.user.id ? '<button class="linkish tiny" type="button" data-act="report-comment">Report</button>' : "") + "</div></div></div>";
  }

  // One handler for every post on any page
  document.addEventListener("click", async function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var postEl = btn.closest("[data-post]");
    if (!postEl) return;
    var id = postEl.dataset.post, act = btn.dataset.act;
    try {
      if (act === "menu") { e.stopPropagation(); var pop = btn.nextElementSibling; $$(".pop").forEach(function (p) { if (p !== pop) p.hidden = true; }); pop.hidden = !pop.hidden; }
      else if (act === "more") { $(".post-body", postEl).classList.remove("clamp"); btn.remove(); }
      else if (act === "like") {
        var on = btn.getAttribute("aria-pressed") === "true", n = $("[data-likes]", btn);
        btn.disabled = true;
        var r = on ? await sb.from("cm_likes").delete().eq("post_id", id).eq("user_id", S.user.id)
                   : await sb.from("cm_likes").insert({ post_id: id, user_id: S.user.id });
        btn.disabled = false;
        if (r.error && r.error.code !== "23505") throw r.error;
        btn.setAttribute("aria-pressed", String(!on)); btn.classList.toggle("on", !on);
        n.textContent = Math.max(0, +n.textContent + (on ? -1 : 1));
      }
      else if (act === "comments") {
        var box = $("[data-comments]", postEl), open = box.hidden;
        box.hidden = !open; btn.setAttribute("aria-expanded", String(open));
        if (open) { await loadComments(postEl); var ta = $("textarea", box); if (ta) ta.focus(); }
      }
      else if (act === "del-comment") {
        if (!confirm("Delete this comment?")) return;
        var cEl = btn.closest("[data-comment]");
        var d = await sb.from("cm_comments").delete().eq("id", cEl.dataset.comment);
        if (d.error) throw d.error;
        cEl.remove(); bumpCount(postEl, -1);
      }
      else if (act === "delete") {
        if (!confirm("Delete this post? This can't be undone.")) return;
        var x = await sb.from("cm_posts").delete().eq("id", id);
        if (x.error) throw x.error;
        toast("Post deleted.");
        if (currentRoute()[0] === "post") location.hash = "#/feed"; else postEl.remove();
      }
      else if (act === "edit") {
        btn.closest(".pop").hidden = true;
        var ep = await sb.from("cm_posts").select("id, body, category_id").eq("id", id).single();
        if (ep.error) throw ep.error;
        startEdit(postEl, ep.data);
      }
      else if (act === "report") { btn.closest(".pop").hidden = true; openReport(id, null); }
      else if (act === "job-more") {
        var bd = $(".post-body", postEl), show = bd.hidden;
        bd.hidden = !show; btn.setAttribute("aria-expanded", String(show)); btn.textContent = show ? "Hide details" : "View details";
      }
      else if (act === "applied") {
        var cur = S.applied.get(id) || { post_id: id, applied: 0, mine: false };
        btn.disabled = true;
        var ar = cur.mine ? await sb.from("cm_job_applies").delete().eq("post_id", id).eq("user_id", S.user.id)
                          : await sb.from("cm_job_applies").insert({ post_id: id, user_id: S.user.id });
        btn.disabled = false;
        if (ar.error && ar.error.code !== "23505") throw ar.error;
        var nx = { post_id: id, applied: Math.max(0, cur.applied + (cur.mine ? -1 : 1)), mine: !cur.mine };
        S.applied.set(id, nx); paintApplied(postEl, nx);
        toast(nx.mine ? "Marked as applied. Good luck!" : "Removed your applied mark.");
      }
      else if (act === "applied-list") {
        if (!S.isAdmin) return;
        var al = await sb.from("cm_job_applies").select("user_id, created_at").eq("post_id", id).order("created_at");
        if (al.error) throw al.error;
        await ensureMembers(al.data.map(function (x) { return x.user_id; }));
        modal("Who applied (" + al.data.length + ")", al.data.length ? al.data.map(function (x) { var m = member(x.user_id);
          return '<a class="who-row" href="#/u/' + m.user_id + '">' + avatar(m, "sm", false) + "<b>" + esc(m.display_name) + '</b><span class="tiny muted">' + ago(x.created_at) + "</span></a>"; }).join("")
          : '<p class="muted">No one has marked this job as applied yet.</p>');
      }
      else if (act === "job-toggle") {
        var closed = postEl.classList.contains("job-closed");
        var jt = await sb.from("cm_posts").update({ job_closed: !closed }).eq("id", id);
        if (jt.error) throw jt.error;
        toast(closed ? "Job reopened." : "Marked as filled.");
        route();
      }
      else if (act === "report-comment") { openReport(id, btn.closest("[data-comment]").dataset.comment); }
      else if (act === "pin") {
        var pinned = postEl.classList.contains("pinned");
        var u = await sb.from("cm_posts").update({ pinned: !pinned }).eq("id", id);
        if (u.error) throw u.error;
        toast(pinned ? "Post unpinned." : "Post pinned to the top.");
        route();
      }
    } catch (err) { btn.disabled = false; fail(err); }
  });
  function bumpCount(postEl, by) {
    var c = $("[data-ccount]", postEl), n = Math.max(0, +c.textContent + by);
    c.textContent = n; c.nextSibling.textContent = " " + (n === 1 ? "comment" : "comments");
  }
  document.addEventListener("submit", async function (e) {
    var f = e.target;
    if (!f.classList.contains("comment-form")) return;
    e.preventDefault();
    var postEl = f.closest("[data-post]"), body = f.body.value.trim();
    if (!body) return;
    var b = $("button", f); b.disabled = true;
    var r = await sb.from("cm_comments").insert({ post_id: postEl.dataset.post, author_id: S.user.id, body: body }).select().single();
    b.disabled = false;
    if (r.error) { fail(r.error); return; }
    f.insertAdjacentHTML("beforebegin", commentHTML(r.data));
    f.body.value = ""; bumpCount(postEl, 1);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target.matches(".comment-form textarea, .msg-form textarea")) {
      e.preventDefault(); e.target.form.requestSubmit();
    }
  });

  /* ---------- Composer (feed, group and job board share it) ---------- */
  var JOB_TYPES = ["Full-time", "Part-time", "Project-based", "Freelance / contract", "Internship"];
  function composerHTML(mode) {
    var cats = S.cats.filter(function (c) { return !c.admin_only || S.isAdmin; });
    if (mode === "group") cats = cats.filter(function (c) { return !c.admin_only; });
    if (mode === "jobs") cats = cats.filter(function (c) { return c.id === "jobs"; });
    var opts = cats.filter(function (c) { return c.id !== "announcement" && c.id !== "jobs"; })
      .concat(cats.filter(function (c) { return c.id === "jobs"; }), cats.filter(function (c) { return c.id === "announcement"; }));
    var ph = mode === "jobs" ? "Describe the role: tasks, tools, schedule, who it's a good fit for…" : mode === "group" ? "Share with the group: a question, your homework, a win…" : "Share something with the community…";
    return '<form class="composer" data-mode="' + mode + '">' + avatar(S.me, "", false) +
      '<div class="composer-body">' +
      '<div class="job-fields" ' + (mode === "jobs" ? "" : "hidden") + '>' +
        '<label>Role title<input name="job_title" maxlength="120" placeholder="e.g. Real Estate Virtual Assistant"></label>' +
        '<div class="field-row"><label>Company or client<input name="job_company" maxlength="80" placeholder="e.g. US real estate team"></label>' +
        '<label>Type<select name="job_type">' + JOB_TYPES.map(function (t) { return "<option>" + t + "</option>"; }).join("") + "</select></label></div>" +
        '<div class="field-row"><label>Pay<input name="job_pay" maxlength="60" placeholder="e.g. $5–7/hr or ₱30k/month"></label>' +
        '<label>Location / hours<input name="job_location" maxlength="80" placeholder="e.g. Remote · US hours"></label></div>' +
        '<div class="field-row"><label>Apply link or email<input name="job_apply" maxlength="300" placeholder="https://… or hiring@company.com"></label>' +
        '<label>Apply by (optional)<input name="job_closes" type="date"></label></div>' +
      "</div>" +
      '<textarea name="body" maxlength="5000" placeholder="' + ph + '" aria-label="Write a post" required></textarea>' +
      '<div class="media-fields">' +
        '<input name="image_url" type="url" placeholder="Image link (https://…). Paste a link to an image that\'s already online" aria-label="Image link" hidden>' +
        '<input name="video_url" type="url" placeholder="Video link (YouTube, Vimeo, Loom, Google Drive or .mp4)" aria-label="Video link" hidden>' +
        '<input name="link" type="url" placeholder="Paste a link (https://…)" aria-label="Link" hidden>' +
      "</div>" +
      '<div class="composer-tools">' +
        (mode === "jobs" ? "" : '<select name="category" aria-label="Topic">' + opts.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>"; }).join("") + "</select>") +
        '<button class="tool-btn" type="button" data-field="image_url">' + icon("image") + "Image link</button>" +
        '<button class="tool-btn" type="button" data-field="video_url">' + icon("play") + "Video link</button>" +
        '<button class="tool-btn" type="button" data-field="link">' + icon("link") + "Link</button>" +
        '<button class="btn btn-navy" type="submit">' + icon("send") + (mode === "jobs" ? "Post job" : "Post") + "</button>" +
      "</div><p class=\"tiny muted media-note\">Photos and videos are shared by link, so nothing is uploaded here.</p></div></form>";
  }
  function bindComposer(form, mode, onPosted) {
    var jf = $(".job-fields", form), cat = form.category;
    function syncJob() { if (cat) jf.hidden = cat.value !== "jobs"; }
    if (cat) cat.addEventListener("change", syncJob);
    $$("[data-field]", form).forEach(function (b) {
      b.addEventListener("click", function () {
        var inp = form.elements[b.dataset.field]; inp.hidden = !inp.hidden; b.classList.toggle("on", !inp.hidden);
        if (!inp.hidden) inp.focus();
      });
    });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var body = form.body.value.trim(), link = form.link.value.trim(), img = form.image_url.value.trim(), vid = form.video_url.value.trim();
      var category = mode === "jobs" ? "jobs" : cat.value;
      if (!body) { form.body.focus(); return; }
      if (link && !safeUrl(link)) { toast("Links need to start with https://", true); return; }
      if (img && !imageLinkOk(img)) { toast("Image links need to start with https://", true); return; }
      if (vid && !safeUrl(vid)) { toast("Video links need to start with https://", true); return; }
      var row = { author_id: S.user.id, category_id: category, body: body, link_url: link || null, image_url: img || null, video_url: vid || null, pinned: category === "announcement" };
      if (mode === "group" && S.feedGroup) row.group_id = S.feedGroup.id;
      if (category === "jobs") {
        var j = { title: form.job_title.value.trim(), company: form.job_company.value.trim(), type: form.job_type.value, pay: form.job_pay.value.trim(),
                  location: form.job_location.value.trim(), apply_url: form.job_apply.value.trim(), closes_on: form.job_closes.value || null };
        if (!j.title) { toast("Add the role title.", true); form.job_title.focus(); return; }
        if (j.apply_url && !safeUrl(j.apply_url) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(j.apply_url)) { toast("Apply link should be a https:// link or an email address.", true); return; }
        Object.keys(j).forEach(function (k) { if (!j[k]) delete j[k]; });
        row.job = j;
      }
      var b = $("button[type=submit]", form); b.disabled = true;
      try {
        var r = await sb.from("cm_posts").insert(row).select(POST_SELECT).single();
        if (r.error) throw r.error;
        form.reset(); $$(".media-fields input", form).forEach(function (i) { i.hidden = true; }); $$("[data-field]", form).forEach(function (x) { x.classList.remove("on"); });
        syncJob();
        onPosted(r.data);
        toast(category === "jobs" ? "Job posted. Members get notified." : "Posted!");
        loadStats(true);
      } catch (err) { fail(err); } finally { b.disabled = false; }
    });
  }

  /* ---------- Feed ---------- */
  function topicMarquee() {
    var chips = [{ id: "all", name: "All posts" }].concat(S.cats.filter(function (c) { return c.id !== "announcement"; }), [{ id: "announcement", name: "Announcements" }]);
    function set(hidden) {
      return '<div class="mq-set"' + (hidden ? ' aria-hidden="true"' : "") + ">" + chips.map(function (c) {
        return '<button class="chip ' + catClass(c.id) + '" type="button" data-cat="' + esc(c.id) + '"' + (hidden ? ' tabindex="-1"' : "") + '><i class="dot" aria-hidden="true"></i>' + esc(c.name) + "</button>";
      }).join("") + "</div>";
    }
    return '<div class="topics" role="toolbar" aria-label="Filter by topic"><div class="mq-track">' + set(false) + set(true) + "</div></div>";
  }
  async function renderFeed(main) {
    var first = (S.me.display_name || "").split(" ")[0];
    var hour = +new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: C.timeZone || undefined }).format(new Date());
    var greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    main.innerHTML =
      '<div class="grid-feed"><div class="col">' +
      '<section class="card hello"><div class="hello-glow" aria-hidden="true"></div><p class="eyebrow"><span class="dot"></span>' + greet + '</p><h1>Welcome back' + (first && first !== "Member" ? ", " + esc(first) : "") + '</h1><p>Catch up with the community, share a win or ask a question.</p>' +
      '<div class="hello-links"><a href="#/jobs">' + icon("brief") + "Job Board</a><a href=\"#/events\">" + icon("cal") + "Events</a><a href=\"#/members\">" + icon("users") + "Members</a></div>" +
      (!S.me.avatar_url || !S.me.headline
        ? '<div class="nudge"><span>' + (!S.me.avatar_url && !S.me.headline ? "Add a photo and headline" : !S.me.avatar_url ? "Add a profile photo" : "Add a headline") +
          ' so members know who you are.</span><a class="btn btn-line btn-sm" href="#/profile/edit">Complete profile</a></div>' : "") +
      "</section>" +
      '<section class="card">' + composerHTML("feed") + "</section>" +
      topicMarquee() +
      '<button class="btn btn-gold" type="button" id="newPosts" hidden>New posts. Show them</button>' +
      '<div class="col" id="posts"></div>' +
      '<button class="btn btn-line" type="button" id="morePosts" hidden>Load more posts</button>' +
      '</div><div class="col sticky-col side-col" id="sideCol"></div></div>';
    bindComposer($(".composer", main), "feed", function (p) { $("#posts").insertAdjacentHTML("afterbegin", postHTML(p)); });
    $$(".topics .chip", main).forEach(function (c) {
      c.setAttribute("aria-pressed", String(c.dataset.cat === S.cat));
      c.addEventListener("click", function () {
        S.cat = c.dataset.cat;
        $$(".topics .chip", main).forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.cat === S.cat)); });
        loadFeed(true);
      });
    });
    $("#morePosts").addEventListener("click", function () { loadFeed(false); });
    $("#newPosts").addEventListener("click", function () { this.hidden = true; loadFeed(true); });
    await Promise.all([loadFeed(true), renderSideCol($("#sideCol"))]);
  }

  async function loadFeed(reset, opts) {
    opts = opts || {};
    if (reset) S.feedOffset = 0;
    var q = sb.from("cm_posts").select(POST_SELECT);
    if (opts.jobs) q = q.eq("category_id", "jobs").order("job_closed", { ascending: true });
    else if (S.feedGroup) q = q.eq("group_id", S.feedGroup.id);
    else { q = q.is("group_id", null); if (S.cat !== "all") q = q.eq("category_id", S.cat); }
    q = q.order("pinned", { ascending: false }).order("created_at", { ascending: false }).range(S.feedOffset, S.feedOffset + PAGE - 1);
    var r = await q;
    if (r.error) throw r.error;
    await ensureMembers(r.data.map(function (p) { return p.author_id; }));
    var box = $("#posts");
    if (!box) return;
    var html = r.data.map(function (p) { return postHTML(p); }).join("");
    var empty = opts.jobs ? '<div class="card empty"><b>No openings right now</b>New roles are posted here first. You\'ll get an email when one goes up.</div>'
      : '<div class="card empty"><b>No posts here yet</b>Be the first to start the conversation.</div>';
    if (reset) box.innerHTML = html || empty;
    else box.insertAdjacentHTML("beforeend", html);
    S.feedOffset += r.data.length;
    $("#morePosts").hidden = r.data.length < PAGE;
    hydrateApplied(box);
  }

  async function renderSideCol(col) {
    var r = await Promise.all([
      sb.from("cm_posts").select("*").eq("category_id", "announcement").is("group_id", null).order("created_at", { ascending: false }).limit(1),
      sb.from("cm_events").select("*").gte("starts_at", new Date(Date.now() - 2 * 3600e3).toISOString()).order("starts_at").limit(3),
      sb.from("cm_posts").select("id, job, job_closed, created_at").eq("category_id", "jobs").eq("job_closed", false).order("created_at", { ascending: false }).limit(3)
    ]);
    var ann = r[0].data && r[0].data[0], evs = r[1].data || [], jobs = r[2].data || [];
    var bdays = Array.from(S.bdays.values()).filter(isBirthdayToday).map(function (b) { return member(b.user_id); });
    var tops = S.topIds.map(member);
    col.innerHTML =
      (bdays.length ? '<section class="card side-card bday"><div class="card-title">' + icon("gift") + "Birthdays today</div>" +
        bdays.map(function (m) { return '<div class="who-row">' + avatar(m, "sm") + "<b>" + esc(m.display_name) + "</b>" +
          (m.user_id !== S.user.id ? '<a class="btn btn-line btn-sm" href="#/messages/' + m.user_id + '">Greet</a>' : '<span class="tag gold">That\'s you!</span>') + "</div>"; }).join("") + "</section>" : "") +
      '<section class="card side-card"><div class="card-title">' + icon("mega") + "Latest announcement</div>" +
      (ann ? '<p class="ann-body">' + esc(ann.body) + '</p><div class="ann-foot"><span>' + ago(ann.created_at) + '</span><a href="#/post/' + ann.id + '">Read more</a></div>'
           : '<p class="muted">No announcements yet.</p>') + "</section>" +
      '<section class="card side-card"><div class="card-title">' + icon("cal") + 'Upcoming events<a href="#/events">All</a></div>' +
      (evs.length ? evs.map(function (ev) {
        var d = new Date(ev.starts_at);
        return '<a class="ev-mini" href="#/events"><span class="ev-date"><small>' + fmtDate(d, { month: "short" }) + "</small><b>" + fmtDate(d, { day: "numeric" }) + "</b></span><span><b>" + esc(ev.title) + "</b><span>" + icon("clock") + fmtDate(d, { weekday: "short", hour: "numeric", minute: "2-digit" }) + "</span></span></a>";
      }).join("") : '<p class="muted">No events scheduled yet.</p>') + "</section>" +
      '<section class="card side-card"><div class="card-title">' + icon("brief") + 'Latest openings<a href="#/jobs">All</a></div>' +
      (jobs.length ? jobs.map(function (j) {
        var x = j.job || {};
        return '<a class="job-mini" href="#/jobs"><b>' + esc(x.title || "Open role") + "</b><span>" + esc([x.type, x.pay].filter(Boolean).join(" · ")) + "</span></a>";
      }).join("") : '<p class="muted">No openings right now. Check back soon.</p>') + "</section>" +
      (tops.length ? '<section class="card side-card"><div class="card-title">' + icon("spark") + 'Top contributors<a href="#/members">All</a></div>' +
        tops.map(function (m, i) { return '<a class="who-row rank" href="#/u/' + m.user_id + '"><span class="rank-n">' + (i + 1) + "</span>" + avatar(m, "sm", false) + "<b>" + esc(m.display_name) + '</b>' + bmark(BADGES[1]) + '</a>'; }).join("") + "</section>" : "");
  }

  /* ---------- Job Board ---------- */
  async function renderJobs(main) {
    main.innerHTML = '<div class="col jobs-page">' +
      '<section class="card page-hero jobs-hero"><div class="hello-glow" aria-hidden="true"></div><p class="eyebrow"><span class="dot"></span>Job Board</p><h1>Openings for the community</h1>' +
      "<p>Remote roles the RBD team has found or been asked to share. Tap <b>View details</b> to read more, apply through the post, then tap <b>I applied</b> so we can cheer you on.</p></section>" +
      (S.isAdmin ? '<details class="card post-job"><summary>' + icon("brief") + "Post a job</summary>" + composerHTML("jobs") + "</details>" : "") +
      '<button class="btn btn-gold" type="button" id="newPosts" hidden>New openings. Show them</button>' +
      '<div class="col" id="posts"></div>' +
      '<button class="btn btn-line" type="button" id="morePosts" hidden>Load more</button>' +
      "</div>";
    if (S.isAdmin) bindComposer($(".composer", main), "jobs", function (p) { var box = $("#posts"); var e = $(".empty", box); if (e) e.remove(); box.insertAdjacentHTML("afterbegin", postHTML(p)); $(".post-job", main).open = false; });
    $("#morePosts").addEventListener("click", function () { loadFeed(false, { jobs: true }); });
    $("#newPosts").addEventListener("click", function () { this.hidden = true; loadFeed(true, { jobs: true }); });
    await loadFeed(true, { jobs: true });
  }

  /* ---------- Private groups (e.g. Bootcamp) ---------- */
  async function renderGroup(main, slug) {
    var g = S.groups.find(function (x) { return x.slug === slug; });
    if (!g) {
      main.innerHTML = '<div class="card empty">' + icon("lock") + "<b>This group is private</b>Only invited members can see it. If you joined a program, the RBD team will add you.</div>";
      return;
    }
    S.feedGroup = g;
    $("#pageTitle").textContent = g.name; document.title = g.name + " · Remote by Designs Community";
    var mem = await sb.from("cm_group_members").select("user_id, added_at").eq("group_id", g.id).order("added_at");
    var ids = (mem.data || []).map(function (x) { return x.user_id; });
    await ensureMembers(ids);
    main.innerHTML = '<div class="grid-feed"><div class="col">' +
      '<section class="card page-hero group-hero"><div class="hello-glow" aria-hidden="true"></div><p class="eyebrow"><span class="dot"></span>' + icon("lock") + 'Private group</p><h1>' + esc(g.name) + "</h1>" +
      "<p>" + esc(g.description || "") + "</p>" +
      '<div class="group-meta"><span class="stack-av">' + ids.slice(0, 6).map(function (id) { return avatar(member(id), "sm", false); }).join("") + "</span><span>" + ids.length + " member" + (ids.length === 1 ? "" : "s") + " · only they can see what's posted here</span>" +
      (S.isAdmin ? '<button class="btn btn-line btn-sm" type="button" id="manageGroup">' + icon("users") + "Manage members</button>" : "") + "</div></section>" +
      '<section class="card">' + composerHTML("group") + "</section>" +
      '<button class="btn btn-gold" type="button" id="newPosts" hidden>New posts. Show them</button>' +
      '<div class="col" id="posts"></div>' +
      '<button class="btn btn-line" type="button" id="morePosts" hidden>Load more posts</button>' +
      '</div><div class="col sticky-col side-col" id="sideCol"></div></div>';
    bindComposer($(".composer", main), "group", function (p) { var box = $("#posts"); var e = $(".empty", box); if (e) e.remove(); box.insertAdjacentHTML("afterbegin", postHTML(p)); });
    if (S.isAdmin) $("#manageGroup").addEventListener("click", function () { manageGroup(g, ids); });
    $("#morePosts").addEventListener("click", function () { loadFeed(false); });
    $("#newPosts").addEventListener("click", function () { this.hidden = true; loadFeed(true); });
    $("#sideCol").innerHTML = '<section class="card side-card"><div class="card-title">' + icon("users") + "In this group</div>" +
      (ids.length ? ids.map(function (id) { var m = member(id); return '<a class="who-row" href="#/u/' + id + '">' + avatar(m, "sm", false) + "<b>" + esc(m.display_name) + "</b>" + badgeMarks(m, 1) + "</a>"; }).join("")
        : '<p class="muted">No one yet. ' + (S.isAdmin ? "Use Manage members to add people." : "") + "</p>") + "</section>";
    await loadFeed(true);
  }
  async function manageGroup(g, ids) {
    await loadMembers();
    var inSet = new Set(ids);
    var all = Array.from(S.members.values()).filter(function (m) { return !m.banned; }).sort(function (a, b) { return a.display_name.localeCompare(b.display_name); });
    var d = modal("Manage " + g.name + " members", '<input class="search" type="search" id="gmSearch" placeholder="Search members…" aria-label="Search members"><div class="gm-list" id="gmList"></div>' +
      '<p class="tiny muted">Added members can see and post in ' + esc(g.name) + ". Everyone else can't see it at all.</p>", { wide: true, onClose: function () { route(); } });
    function paint(q) {
      q = (q || "").toLowerCase();
      $("#gmList", d).innerHTML = all.filter(function (m) { return !q || m.display_name.toLowerCase().indexOf(q) >= 0; }).map(function (m) {
        var on = inSet.has(m.user_id);
        return '<div class="who-row">' + avatar(m, "sm", false) + "<b>" + esc(m.display_name) + '</b><button class="btn btn-sm ' + (on ? "btn-line" : "btn-navy") + '" type="button" data-gm="' + m.user_id + '">' + (on ? "Remove" : "Add") + "</button></div>";
      }).join("") || '<p class="muted">No one matches.</p>';
    }
    paint();
    $("#gmSearch", d).addEventListener("input", function () { paint(this.value); });
    $("#gmList", d).addEventListener("click", async function (e) {
      var b = e.target.closest("[data-gm]"); if (!b) return;
      var uid = b.dataset.gm, on = inSet.has(uid); b.disabled = true;
      var r = on ? await sb.from("cm_group_members").delete().eq("group_id", g.id).eq("user_id", uid)
                 : await sb.from("cm_group_members").insert({ group_id: g.id, user_id: uid });
      b.disabled = false;
      if (r.error && r.error.code !== "23505") { fail(r.error); return; }
      if (on) inSet.delete(uid); else inSet.add(uid);
      paint($("#gmSearch", d).value);
      toast(on ? "Removed from " + g.name + "." : "Added to " + g.name + ".");
    });
  }

  async function renderSinglePost(main, id) {
    var r = await sb.from("cm_posts").select(POST_SELECT).eq("id", id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) { main.innerHTML = '<div class="card empty"><b>Post not found</b>It may have been deleted. <a href="#/feed">Back to the feed</a></div>'; return; }
    await ensureMembers([r.data.author_id]);
    var pg = r.data.group_id ? S.groups.find(function (g) { return g.id === r.data.group_id; }) : null;
    var back = pg ? '<a href="#/g/' + esc(pg.slug) + '" class="linkish">← Back to ' + esc(pg.name) + "</a>" : r.data.category_id === "jobs" ? '<a href="#/jobs" class="linkish">← Back to the Job Board</a>' : '<a href="#/feed" class="linkish">← Back to the feed</a>';
    main.innerHTML = '<div class="grid-feed"><div class="col">' + back + postHTML(r.data, { full: true }) + '</div><div class="col sticky-col side-col" id="sideCol"></div></div>';
    await Promise.all([loadComments($("[data-post]", main)), renderSideCol($("#sideCol")), hydrateApplied(main)]);
  }

  /* ---------- Messages ---------- */
  async function renderMessages(main, otherId) {
    var me = S.user.id;
    var r = await sb.from("cm_messages").select("*").or("sender_id.eq." + me + ",recipient_id.eq." + me).order("created_at", { ascending: false }).limit(500);
    if (r.error) throw r.error;
    var convos = new Map();
    r.data.forEach(function (m) {
      var o = m.sender_id === me ? m.recipient_id : m.sender_id;
      var c = convos.get(o) || { other: o, last: m, unread: 0 };
      if (m.recipient_id === me && !m.read_at) c.unread++;
      convos.set(o, c);
    });
    if (otherId && !convos.has(otherId)) convos.set(otherId, { other: otherId, last: null, unread: 0 });
    await ensureMembers(Array.from(convos.keys()));
    var list = Array.from(convos.values()).map(function (c) {
      var o = member(c.other);
      return '<a class="convo' + (c.unread ? " unread" : "") + '" href="#/messages/' + c.other + '"' + (c.other === otherId ? ' aria-current="true"' : "") + ">" + avatar(o, "sm", false) +
        '<span class="txt"><b>' + esc(o.display_name) + (c.last ? "<small>" + ago(c.last.created_at) + "</small>" : "") + "</b><span>" +
        (c.last ? (c.last.sender_id === me ? "You: " : "") + esc(c.last.body) : "Start the conversation") + "</span></span></a>";
    }).join("");
    main.innerHTML = '<section class="card inbox' + (otherId ? " has-thread" : "") + '">' +
      '<div class="convos"><div class="convos-head">Messages <a class="btn btn-line btn-sm" href="#/members">New</a></div>' +
      (list || '<div class="empty"><b>No messages yet</b>Find someone on the <a href="#/members">Members</a> page and say hi.</div>') + "</div>" +
      '<div class="thread" id="thread">' + (otherId ? "" : '<div class="empty" style="margin:auto"><b>Choose a conversation</b>Or start one from the Members page.</div>') + "</div></section>";
    if (otherId) await openThread(otherId);
  }

  async function openThread(o) {
    var me = S.user.id, other = member(o), th = $("#thread");
    if (o === me) { location.hash = "#/messages"; return; }
    S.thread = o;
    th.innerHTML = '<div class="thread-head"><a class="round back" href="#/messages" aria-label="Back to conversations">' + icon("back") + "</a>" + avatar(other, "sm") +
      '<a href="#/u/' + o + '">' + esc(other.display_name) + "</a>" + adminTag(o) + "</div>" +
      '<div class="msgs" id="msgs"><div class="loading">Loading…</div></div>' +
      '<form class="msg-form" id="msgForm"><textarea name="body" maxlength="3000" placeholder="Write a message…" aria-label="Write a message" required></textarea>' +
      '<button class="btn btn-navy" type="submit">' + icon("send") + "Send</button></form>";
    var r = await sb.from("cm_messages").select("*")
      .or("and(sender_id.eq." + me + ",recipient_id.eq." + o + "),and(sender_id.eq." + o + ",recipient_id.eq." + me + ")")
      .order("created_at", { ascending: false }).limit(300);
    if (r.error) throw r.error;
    var box = $("#msgs");
    box.innerHTML = r.data.length ? "" : '<div class="empty" style="margin:auto">Say hello to ' + esc(other.display_name.split(" ")[0]) + " 👋</div>";
    r.data.reverse().forEach(appendMsg);
    markThreadRead(o);
    var f = $("#msgForm");
    f.body.focus();
    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var body = f.body.value.trim();
      if (!body) return;
      var b = $("button", f); b.disabled = true;
      var ins = await sb.from("cm_messages").insert({ sender_id: me, recipient_id: o, body: body }).select().single();
      b.disabled = false;
      if (ins.error) { fail(ins.error); return; }
      f.body.value = ""; appendMsg(ins.data); f.body.focus();
    });
  }
  function appendMsg(m) {
    var box = $("#msgs");
    if (!box) return;
    var empty = $(".empty", box); if (empty) empty.remove();
    box.insertAdjacentHTML("beforeend", '<div class="msg' + (m.sender_id === S.user.id ? " me" : "") + '">' + linkify(m.body) + "<small>" + ago(m.created_at) + "</small></div>");
    box.scrollTop = box.scrollHeight;
  }
  async function markThreadRead(o) {
    var now = new Date().toISOString();
    await sb.from("cm_messages").update({ read_at: now }).eq("recipient_id", S.user.id).eq("sender_id", o).is("read_at", null);
    await sb.from("cm_notifications").update({ read_at: now }).eq("user_id", S.user.id).eq("actor_id", o).eq("kind", "message").is("read_at", null);
    refreshCounts();
  }

  /* ---------- Events ---------- */
  async function renderEvents(main) {
    var r = await sb.from("cm_events").select("*, cm_rsvps(user_id)").order("starts_at", { ascending: true });
    if (r.error) throw r.error;
    var cutoff = Date.now() - 2 * 3600e3;
    var up = r.data.filter(function (e) { return new Date(e.ends_at || e.starts_at).getTime() >= cutoff; });
    var past = r.data.filter(function (e) { return new Date(e.ends_at || e.starts_at).getTime() < cutoff; }).reverse().slice(0, 10);
    main.innerHTML = '<div class="col">' +
      '<div class="page-head"><div><h1>Events</h1><p>Live sessions, workshops and meetups for the community.</p></div>' +
      (S.isAdmin ? '<button class="btn btn-navy" type="button" id="newEventBtn">+ New event</button>' : "") + "</div>" +
      (S.isAdmin ? eventFormHTML() : "") +
      '<div class="events">' + (up.length ? up.map(eventHTML).join("") : '<div class="card empty"><b>No upcoming events</b>Check back soon. We\'ll notify you when one is added.</div>') + "</div>" +
      (past.length ? '<h2 style="font-size:18px;margin-top:10px">Past events</h2><div class="events past">' + past.map(function (e) { return eventHTML(e, true); }).join("") + "</div>" : "") +
      "</div>";
    main.addEventListener("click", onEventClick);
    if (S.isAdmin) bindEventForm();
  }
  function eventHTML(ev, isPast) {
    var d = new Date(ev.starts_at), going = (ev.cm_rsvps || []).some(function (x) { return x.user_id === S.user.id; });
    var n = (ev.cm_rsvps || []).length, loc = ev.location || "", url = safeUrl(loc);
    var hasMore = ev.description || (loc && !url) || n;
    return '<article class="card event' + (isPast ? " past" : "") + '" data-event="' + ev.id + '"><div class="ev-row">' +
      '<div class="date-tile"><small>' + fmtDate(d, { month: "short" }) + "</small><b>" + fmtDate(d, { day: "numeric" }) + "</b></div>" +
      '<div class="ev-main"><h3>' + esc(ev.title) + '</h3><div class="when">' + icon("clock") + " " + fmtDate(d, { weekday: "short", hour: "numeric", minute: "2-digit" }) +
      (ev.ends_at ? " – " + fmtDate(ev.ends_at, { hour: "numeric", minute: "2-digit" }) : "") + '<span class="sep">·</span>' + n + " going</div></div>" +
      '<div class="ev-actions">' +
      (isPast ? '<span class="tag">Ended</span>' : '<button class="btn ' + (going ? "btn-line" : "btn-navy") + ' btn-sm" type="button" data-rsvp="' + (going ? "1" : "0") + '">' + (going ? "✓ Going" : "I'm going") + "</button>") +
      (url && !isPast ? '<a class="btn btn-gold btn-sm" href="' + esc(url) + '" target="_blank" rel="noopener">Join</a>' : "") +
      (hasMore ? '<button class="linkish tiny ev-toggle" type="button" data-details aria-expanded="false">Details</button>' : "") +
      "</div></div>" +
      '<div class="ev-details" hidden>' +
      (ev.description ? '<p class="desc">' + linkify(ev.description) + "</p>" : "") +
      (loc && !url ? '<p class="tiny">' + icon("place") + " " + esc(loc) + "</p>" : "") +
      '<p class="tiny muted">' + fmtWhen(ev.starts_at) + " · " + n + (n === 1 ? " person" : " people") + " going</p>" +
      (S.isAdmin ? '<button class="linkish tiny" type="button" data-del-event>Delete event</button>' : "") +
      "</div></article>";
  }
  function eventFormHTML() {
    return '<form class="card stack" id="eventForm" hidden><h2 style="font-size:18px">New event</h2>' +
      '<label>Title<input name="title" maxlength="160" required></label>' +
      '<div class="field-row"><label>Starts<input name="starts" type="datetime-local" required></label><label>Ends (optional)<input name="ends" type="datetime-local"></label></div>' +
      '<label>Where (Zoom/Meet link or place)<input name="location" maxlength="300" placeholder="https://meet.google.com/…"></label>' +
      '<label>Description<textarea name="description" maxlength="4000"></textarea></label>' +
      '<p class="tiny muted">Times use your device\'s time zone. Every member gets a notification.</p>' +
      '<div style="display:flex;gap:10px"><button class="btn btn-navy" type="submit">Publish event</button><button class="btn btn-line" type="button" id="cancelEvent">Cancel</button></div></form>';
  }
  function bindEventForm() {
    var f = $("#eventForm");
    $("#newEventBtn").addEventListener("click", function () { f.hidden = false; f.elements.title.focus(); });
    $("#cancelEvent").addEventListener("click", function () { f.hidden = true; });
    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var starts = new Date(f.starts.value), ends = f.ends.value ? new Date(f.ends.value) : null;
      if (ends && ends <= starts) { toast("The end time needs to be after the start.", true); return; }
      var b = $("button[type=submit]", f); b.disabled = true;
      var r = await sb.from("cm_events").insert({ title: f.elements.title.value.trim(), starts_at: starts.toISOString(), ends_at: ends && ends.toISOString(), location: f.location.value.trim() || null, description: f.description.value.trim() || null, created_by: S.user.id });
      b.disabled = false;
      if (r.error) { fail(r.error); return; }
      toast("Event published."); route();
    });
  }
  async function onEventClick(e) {
    var card = e.target.closest("[data-event]");
    if (!card) return;
    var id = card.dataset.event, b;
    try {
      if ((b = e.target.closest("[data-details]"))) {
        var det = $(".ev-details", card), open = det.hidden;
        det.hidden = !open; b.setAttribute("aria-expanded", String(open)); b.textContent = open ? "Hide" : "Details";
        return;
      }
      if ((b = e.target.closest("[data-rsvp]"))) {
        var going = b.dataset.rsvp === "1"; b.disabled = true;
        var r = going ? await sb.from("cm_rsvps").delete().eq("event_id", id).eq("user_id", S.user.id) : await sb.from("cm_rsvps").insert({ event_id: id, user_id: S.user.id });
        if (r.error && r.error.code !== "23505") throw r.error;
        route();
      } else if (e.target.closest("[data-del-event]")) {
        if (!confirm("Delete this event?")) return;
        var d = await sb.from("cm_events").delete().eq("id", id);
        if (d.error) throw d.error;
        card.remove(); toast("Event deleted.");
      }
    } catch (err) { fail(err); }
  }

  /* ---------- Members ---------- */
  async function renderMembers(main) {
    await Promise.all([loadMembers(), loadStats(true)]);
    var list = Array.from(S.members.values()).filter(function (m) { return !m.banned; });
    var board = Array.from(S.stats.values()).filter(function (x) { return x.score_30d > 0; }).sort(function (a, b) { return b.score_30d - a.score_30d; }).slice(0, 5);
    main.innerHTML = '<div class="col"><div class="page-head"><div><h1>Members</h1><p>' + list.length + " people learning and growing together.</p></div>" +
      '<input class="search" type="search" id="memberSearch" placeholder="Search by name or role…" aria-label="Search members"></div>' +
      '<section class="card leaderboard"><div class="card-title">' + icon("spark") + 'Top contributors · last 30 days<button class="linkish" type="button" id="howBadges">How badges work</button></div>' +
      (board.length ? '<ol class="lb">' + board.map(function (x, i) {
        var m = member(x.user_id);
        return '<li><a href="#/u/' + m.user_id + '"><span class="rank-n">' + (i + 1) + "</span>" + avatar(m, "sm", false) + '<span class="lb-name"><b>' + esc(m.display_name) + "</b><small>" +
          x.posts + " posts · " + x.comments + " comments</small></span>" + badgeMarks(m, 3) + '<span class="lb-score">' + x.score_30d + "<small>pts</small></span></a></li>";
      }).join("") + "</ol>" : '<p class="muted">No activity yet this month. Post, comment and help others to show up here.</p>') +
      '<p class="tiny muted">Points: 3 per post, 2 per comment, 1 per like you receive (last 30 days).</p></section>' +
      '<div class="members" id="memberGrid"></div></div>';
    function paint(q) {
      q = (q || "").toLowerCase();
      var rows = list.filter(function (m) { return !q || (m.display_name + " " + (m.headline || "") + " " + (m.location || "")).toLowerCase().indexOf(q) >= 0; });
      $("#memberGrid").innerHTML = rows.map(function (m) {
        return '<div class="card member">' + avatar(m) + "<b>" + esc(m.display_name) + "</b>" + adminTag(m.user_id) +
          '<span class="marks">' + badgeMarks(m, 4) + "</span>" +
          "<p>" + esc(m.headline || (m.location || "")) + '</p><div class="row"><a class="btn btn-line btn-sm" href="#/u/' + m.user_id + '">Profile</a>' +
          (m.user_id !== S.user.id ? '<a class="btn btn-navy btn-sm" href="#/messages/' + m.user_id + '">Message</a>' : "") + "</div></div>";
      }).join("") || '<div class="card empty" style="grid-column:1/-1"><b>No one matches that search</b></div>';
    }
    paint();
    $("#memberSearch").addEventListener("input", function () { paint(this.value); });
    $("#howBadges").addEventListener("click", showBadgeGuide);
  }
  function showBadgeGuide() {
    modal("Badges", '<p class="muted">Badges show up on profiles, member cards and next to names in the feed. They update on their own as you take part.</p>' +
      '<h3 class="bg-h">Earned by taking part</h3><ul class="badge-guide">' + BADGES.map(function (b) { return "<li>" + bmark(b, true) + "<span><b>" + esc(b.name) + "</b><small>" + esc(b.how) + "</small></span></li>"; }).join("") + "</ul>" +
      '<h3 class="bg-h">Given by the RBD team</h3><ul class="badge-guide">' + AWARDS.map(function (b) { return "<li>" + bmark(b, true) + "<span><b>" + esc(b.name) + "</b><small>" + esc(b.how) + "</small></span></li>"; }).join("") + "</ul>");
  }

  /* ---------- Profiles ---------- */
  async function renderProfile(main, id, openEdit) {
    await Promise.all([ensureMembers([id]), loadStats(), loadBirthdays()]);
    var m = S.members.get(id);
    if (!m) { main.innerHTML = '<div class="card empty"><b>Member not found</b><a href="#/members">See all members</a></div>'; return; }
    var mine = id === S.user.id;
    var posts = await sb.from("cm_posts").select(POST_SELECT).eq("author_id", id).order("created_at", { ascending: false }).limit(20);
    if (posts.error) throw posts.error;
    var myB = mine ? (await sb.from("cm_birthdays").select("month, day, show").eq("user_id", id).maybeSingle()).data : null;
    var pubB = S.bdays.get(id);
    var earned = badgesFor(m), st = S.stats.get(id) || {};
    var earnedIds = earned.map(function (b) { return b.id; });
    main.innerHTML = '<div class="col" style="max-width:820px">' +
      '<section class="card profile-card"><div class="profile-top"><div class="profile-hero">' + avatar(m, "lg", false) + '<div style="flex:1;min-width:200px"><h1>' + esc(m.display_name) + " " + adminTag(id) + "</h1>" +
      (m.headline ? '<p class="headline">' + esc(m.headline) + "</p>" : "") +
      '<p class="tiny muted">' + (m.location ? esc(m.location) + " · " : "") + "Joined " + fmtDate(m.joined_at, { month: "long", year: "numeric" }) +
      (pubB ? " · " + icon("gift") + " Birthday " + MONTHS[pubB.month - 1] + " " + pubB.day : "") + "</p></div>" +
      (mine ? '<button class="btn btn-glass" type="button" id="editProfileBtn">Edit profile</button>' : '<a class="btn btn-gold" href="#/messages/' + id + '">Message</a>') + "</div></div>" +
      (m.bio ? '<p class="profile-bio">' + linkify(m.bio) + "</p>" : mine ? '<p class="profile-bio muted">Add a short bio so others know what you do and what you\'re working toward.</p>' : "") +
      '<div class="pstats"><span><b>' + (st.posts || 0) + "</b>posts</span><span><b>" + (st.comments || 0) + "</b>comments</span><span><b>" + (st.likes_received || 0) + "</b>likes received</span><span><b>" + earned.length + "</b>badges</span></div>" +
      "</section>" +
      '<section class="card badges-card"><div class="card-title">' + icon("spark") + "Badges · " + earned.length + ' earned' +
      (S.isAdmin && !mine ? '<button class="btn btn-gold btn-sm" type="button" id="giveBadge">Give a badge</button>' : "") +
      '<button class="linkish" type="button" id="howBadges2">How badges work</button></div><div class="badges">' +
      earned.map(function (b) {
        return '<div class="badge on" style="--bc:' + b.c + '" title="' + esc(b.how) + '">' + bmark(b, true) + "<b>" + esc(b.name) + "</b>" +
          '<small>' + esc(b.awarded ? (b.note || b.how) : b.how) + "</small>" + '<span class="earned">' + (b.awarded ? "Given by RBD" : "Earned") + "</span></div>";
      }).join("") +
      BADGES.filter(function (b) { return b.id !== "team" && b.id !== "top" && b.id !== "bootcamp" && b.id !== "founding" && earnedIds.indexOf(b.id) < 0; }).map(function (b) {
        var v = b.val ? Math.min(b.val(st), b.goal) : 0, pct = b.goal ? Math.round(v / b.goal * 100) : 0;
        return '<div class="badge locked" style="--bc:' + b.c + '" title="' + esc(b.how) + '">' + bmark(b, true) + "<b>" + esc(b.name) + "</b><small>" + esc(b.how) + "</small>" +
          (b.goal ? '<span class="prog" role="img" aria-label="' + v + " of " + b.goal + '"><i style="width:' + pct + '%"></i></span><span class="prog-n">' + v + " / " + b.goal + "</span>" : "") + "</div>";
      }).join("") + "</div></section>" +
      (mine ? profileFormHTML(m, myB) : "") +
      '<h2 style="font-size:18px">' + (mine ? "Your posts" : "Posts") + "</h2>" +
      (posts.data.length ? posts.data.map(function (p) { return postHTML(p); }).join("") : '<div class="card empty">No posts yet.</div>') + "</div>";
    $("#howBadges2").addEventListener("click", showBadgeGuide);
    hydrateApplied(main);
    var gb = $("#giveBadge"); if (gb) gb.addEventListener("click", function () { giveBadges(m); });
    if (mine) {
      bindProfileForm(m);
      var prefsCard = document.createElement("section");
      prefsCard.className = "card"; prefsCard.id = "emailSettings";
      prefsCard.innerHTML = '<div class="card-title">Email settings</div><div class="prefs"><div class="loading">Loading…</div></div>';
      $("#profileForm", main).insertAdjacentElement("afterend", prefsCard);
      renderPrefs($(".prefs", prefsCard));
      if (openEdit) { $("#profileForm", main).hidden = false; $("#profileForm", main).display_name.focus(); }
    }
  }
  function giveBadges(m) {
    var have = new Set((S.awards.get(m.user_id) || []).map(function (x) { return x.badge; }));
    var d = modal("Give " + m.display_name.split(" ")[0] + " a badge",
      '<p class="muted">Tap a badge to give it or take it back. They get a notification right away.</p><div class="award-list" id="awardList"></div>' +
      '<label>Note (optional, shows on their profile)<input id="awardNote" maxlength="140" placeholder="e.g. Bootcamp Batch 1 · Oct 2026"></label>', { wide: true, onClose: function () { route(); } });
    function paint() {
      $("#awardList", d).innerHTML = AWARDS.map(function (a) {
        var on = have.has(a.id);
        return '<button type="button" class="award' + (on ? " on" : "") + '" style="--bc:' + a.c + '" data-award="' + a.id + '" aria-pressed="' + on + '">' + bmark(a, true) +
          "<span><b>" + esc(a.name) + "</b><small>" + esc(a.how) + "</small></span><em>" + (on ? "Given ✓" : "Give") + "</em></button>";
      }).join("");
    }
    paint();
    $("#awardList", d).addEventListener("click", async function (e) {
      var b = e.target.closest("[data-award]"); if (!b) return;
      var id = b.dataset.award, on = have.has(id); b.disabled = true;
      var r = on ? await sb.from("cm_member_badges").delete().eq("user_id", m.user_id).eq("badge", id)
                 : await sb.from("cm_member_badges").insert({ user_id: m.user_id, badge: id, note: $("#awardNote", d).value.trim() || null });
      b.disabled = false;
      if (r.error && r.error.code !== "23505") { fail(r.error); return; }
      if (on) have.delete(id); else have.add(id);
      await loadStats(true); paint();
      toast(on ? "Badge removed." : awardDef(id).name + " given to " + m.display_name.split(" ")[0] + ".");
    });
  }
  function birthdayFieldsHTML(b) {
    b = b || {};
    var days = ""; for (var i = 1; i <= 31; i++) days += '<option value="' + i + '"' + (b.day === i ? " selected" : "") + ">" + i + "</option>";
    return '<fieldset class="bday-fields"><legend>Birthday <span class="muted">(month and day only, optional)</span></legend><div class="field-row">' +
      '<label class="sr-label">Month<select name="bmonth"><option value="">Month</option>' + MONTHS.map(function (mn, i) { return '<option value="' + (i + 1) + '"' + (b.month === i + 1 ? " selected" : "") + ">" + mn + "</option>"; }).join("") + "</select></label>" +
      '<label class="sr-label">Day<select name="bday"><option value="">Day</option>' + days + "</select></label></div>" +
      '<label class="check"><input type="checkbox" name="bshow"' + (b.show === false ? "" : " checked") + "> Show my birthday on my profile so members can greet me</label>" +
      '<p class="tiny muted">We\'ll send you a birthday note on the day.</p></fieldset>';
  }
  async function saveBirthday(f) {
    var mo = +f.bmonth.value || 0, d = +f.bday.value || 0;
    if (!mo && !d) { await sb.from("cm_birthdays").delete().eq("user_id", S.user.id); return; }
    if (!mo || !d) throw new Error("Pick both the month and the day for your birthday (or leave both empty).");
    var max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
    if (d > max) throw new Error(MONTHS[mo - 1] + " only has " + max + " days.");
    var r = await sb.from("cm_birthdays").upsert({ user_id: S.user.id, month: mo, day: d, show: f.bshow.checked, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (r.error) throw r.error;
  }
  function profileFormHTML(m, b) {
    return '<form class="card stack" id="profileForm" hidden><h2 style="font-size:18px">Edit profile</h2>' +
      '<div class="avatar-edit">' + avatar(m, "lg", false) + '<div class="stack" style="gap:6px"><label class="btn btn-line btn-sm" style="flex-direction:row;color:var(--ink)">Upload photo<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden></label>' +
      (m.avatar_url ? '<button class="linkish tiny" type="button" id="removePhoto">Remove photo</button>' : "") + "</div></div>" +
      '<label>Name<input name="display_name" maxlength="80" required value="' + esc(m.display_name) + '"></label>' +
      '<label>Headline<input name="headline" maxlength="120" placeholder="e.g. Aspiring Virtual Assistant · Real estate ops" value="' + esc(m.headline || "") + '"></label>' +
      '<label>Location<input name="location" maxlength="80" placeholder="e.g. Cebu, Philippines" value="' + esc(m.location || "") + '"></label>' +
      '<label>Bio<textarea name="bio" maxlength="1000">' + esc(m.bio || "") + "</textarea></label>" +
      birthdayFieldsHTML(b) +
      '<div style="display:flex;gap:10px"><button class="btn btn-navy" type="submit">Save profile</button><button class="btn btn-line" type="button" id="cancelProfile">Cancel</button></div></form>';
  }
  function bindProfileForm(m) {
    var f = $("#profileForm"), photo = null, removed = false;
    $("#editProfileBtn").addEventListener("click", function () { f.hidden = false; f.display_name.focus(); });
    $("#cancelProfile").addEventListener("click", function () { f.hidden = true; });
    f.photo.addEventListener("change", function () {
      photo = this.files[0] || null;
      if (photo) $(".avatar-edit .av", f).innerHTML = '<img src="' + URL.createObjectURL(photo) + '" alt="">';
    });
    var rm = $("#removePhoto", f);
    if (rm) rm.addEventListener("click", function () { removed = true; photo = null; $(".avatar-edit .av", f).textContent = initials(m.display_name); });
    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var b = $("button[type=submit]", f); b.disabled = true;
      try {
        var upd = { display_name: f.display_name.value.trim(), headline: f.headline.value.trim() || null, location: f.location.value.trim() || null, bio: f.bio.value.trim() || null };
        if (!upd.display_name) throw new Error("Please enter your name.");
        if (photo) upd.avatar_url = await uploadImage(photo);
        else if (removed) upd.avatar_url = null;
        await saveBirthday(f);
        var r = await sb.from("cm_members").update(upd).eq("user_id", S.user.id).select().single();
        if (r.error) throw r.error;
        S.members.set(S.user.id, r.data); S.me = r.data; paintMe();
        toast("Profile saved."); route();
      } catch (err) { fail(err); } finally { b.disabled = false; }
    });
  }

  /* ---------- Admin ---------- */
  async function renderAdmin(main) {
    var r = await Promise.all([
      sb.rpc("cm_admin_stats"),
      sb.from("cm_posts").select(POST_SELECT).eq("pinned", true).order("created_at", { ascending: false }),
      loadMembers(),
      sb.from("cm_reports").select("*, cm_posts(id, body, author_id), cm_comments(id, body, author_id, post_id)").eq("status", "open").order("created_at", { ascending: false }).limit(50),
      sb.rpc("cm_admin_activity"),
      loadStats(true),
      loadBirthdays(),
      sb.from("cm_group_members").select("group_id, user_id")
    ]);
    if (r[0].error) throw r[0].error;
    var s = r[0].data, pinned = r[1].data || [], reports = (r[3] && r[3].data) || [], act = (r[4] && r[4].data) || [], gm = (r[7] && r[7].data) || [];
    await ensureMembers(reports.map(function (x) { return x.reporter_id; }).concat(reports.map(function (x) { return (x.cm_comments || x.cm_posts || {}).author_id; })));
    var all = Array.from(S.members.values()).sort(function (a, b) { return new Date(b.joined_at) - new Date(a.joined_at); });
    var first = (S.me.display_name || "").split(" ")[0];
    var hour = +new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: C.timeZone || undefined }).format(new Date());
    var greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    function tile(n, label, sub, ic, tone) {
      return '<div class="card stat tone-' + tone + '"><span class="stat-ico">' + icon(ic) + '</span><b>' + n + "</b><span>" + label + "</span>" + (sub ? '<small>' + sub + "</small>" : "") + "</div>";
    }
    // 14-day activity bars
    var maxV = Math.max.apply(null, act.map(function (d) { return d.posts + d.comments; }).concat([1]));
    var bars = act.map(function (d, i) {
      var tot = d.posts + d.comments, h = Math.round(tot / maxV * 100), hp = tot ? Math.round(d.posts / tot * 100) : 0;
      var day = new Date(d.day + "T12:00:00");
      return '<div class="bar" title="' + esc(fmtDate(day, { weekday: "short", month: "short", day: "numeric" })) + ": " + d.posts + " posts, " + d.comments + " comments" + (d.joins ? ", " + d.joins + " joined" : "") + '">' +
        '<span class="bar-col" style="height:' + Math.max(h, tot ? 6 : 2) + '%"><i style="height:' + hp + '%"></i></span>' +
        (d.joins ? '<span class="bar-join" aria-hidden="true">+' + d.joins + "</span>" : "") +
        '<small>' + (i % 2 === 0 || i === act.length - 1 ? fmtDate(day, { day: "numeric" }) : "") + "</small></div>";
    }).join("");
    var tot14 = act.reduce(function (t, d) { return t + d.posts + d.comments; }, 0);
    var board = Array.from(S.stats.values()).filter(function (x) { return x.score_30d > 0; }).sort(function (a, b) { return b.score_30d - a.score_30d; }).slice(0, 5);
    var t = todayParts(), soon = Array.from(S.bdays.values()).map(function (b) {
      var dt = new Date(t.y, b.month - 1, b.day), now = new Date(t.y, t.m - 1, t.d);
      if (dt < now) dt = new Date(t.y + 1, b.month - 1, b.day);
      return { b: b, days: Math.round((dt - now) / 864e5) };
    }).filter(function (x) { return x.days <= 30; }).sort(function (a, b) { return a.days - b.days; }).slice(0, 5);
    var boot = S.groups.find(function (g) { return g.slug === "bootcamp"; });
    main.innerHTML = '<div class="col">' +
      '<section class="admin-hero"><div class="hello-glow" aria-hidden="true"></div><div class="ah-text"><p class="eyebrow"><span class="dot"></span>Admin Dashboard</p><h1>' + greet + (first ? ", " + esc(first) : "") + "</h1>" +
      "<p>Here's how the community is doing. " + (s.open_reports ? "<b>" + s.open_reports + " report" + (s.open_reports === 1 ? "" : "s") + "</b> waiting for you." : "No reports waiting.") + "</p>" +
      '<div class="ah-actions"><button class="btn btn-gold btn-sm" type="button" data-go="ann">' + icon("mega") + 'Announcement</button><a class="btn btn-glass btn-sm" href="#/events">' + icon("cal") + 'New event</a>' +
      '<a class="btn btn-glass btn-sm" href="#/jobs">' + icon("brief") + "Post a job</a>" + (boot ? '<button class="btn btn-glass btn-sm" type="button" data-go="boot">' + icon("lock") + boot.name + " members</button>" : "") + "</div></div>" +
      '<div class="ah-kpi"><b>' + (s.active_7d || 0) + "</b><span>active members<br>this week</span></div></section>" +
      '<div class="stats">' +
      tile(s.members, "Members", "+" + s.new_members_7d + " this week", "users", "teal") +
      tile(s.posts, "Posts", "+" + s.posts_7d + " this week", "chat", "sky") +
      tile(s.comments, "Comments", "", "spark", "navy") +
      tile(s.upcoming_events, "Upcoming events", "", "cal", "gold") +
      tile(s.open_reports || 0, "Open reports", s.open_reports ? "Needs review" : "All clear", "flag", s.open_reports ? "red" : "green") +
      tile(s.academy_not_joined || 0, "Academy learners not joined", "", "lock", "slate") + "</div>" +
      '<section class="card"><div class="card-title">' + icon("chart") + 'Activity · last 14 days<span class="legend"><i class="lg-p"></i>Posts<i class="lg-c"></i>Comments</span></div>' +
      (tot14 ? '<div class="bars">' + bars + "</div>" : '<p class="muted">Quiet so far. Activity shows up here as members post and comment.</p>') + "</section>" +
      '<div class="admin-grid">' +
      '<section class="card"><div class="card-title">' + icon("spark") + 'Top contributors<a href="#/members">All members</a></div>' +
      (board.length ? '<ol class="lb">' + board.map(function (x, i) { var m = member(x.user_id); return '<li><a href="#/u/' + m.user_id + '"><span class="rank-n">' + (i + 1) + "</span>" + avatar(m, "sm", false) + '<span class="lb-name"><b>' + esc(m.display_name) + "</b><small>" + x.posts + " posts · " + x.comments + " comments</small></span>" + '<span class="lb-score">' + x.score_30d + "<small>pts</small></span></a></li>"; }).join("") + "</ol>"
        : '<p class="muted">No one has posted this month yet.</p>') + "</section>" +
      '<section class="card"><div class="card-title">' + icon("gift") + "Birthdays · next 30 days</div>" +
      (soon.length ? soon.map(function (x) { var m = member(x.b.user_id); return '<div class="who-row">' + avatar(m, "sm", false) + "<b>" + esc(m.display_name) + '</b><span class="tag ' + (x.days === 0 ? "gold" : "") + '">' + (x.days === 0 ? "Today" : MONTHS[x.b.month - 1].slice(0, 3) + " " + x.b.day) + "</span></div>"; }).join("")
        : '<p class="muted">No birthdays coming up. Members add theirs in My Profile.</p>') +
      (S.groups.length ? '<div class="card-title" style="margin-top:16px">' + icon("lock") + "Private groups</div>" + S.groups.map(function (g) {
        var n = gm.filter(function (x) { return x.group_id === g.id; }).length;
        return '<div class="who-row"><span class="g-ico">' + icon("lock") + '</span><a href="#/g/' + esc(g.slug) + '"><b>' + esc(g.name) + "</b></a><span class=\"muted tiny\">" + n + " member" + (n === 1 ? "" : "s") + '</span><button class="btn btn-line btn-sm" type="button" data-manage="' + g.id + '">Manage</button></div>';
      }).join("") : "") + "</section></div>" +
      '<section class="card" id="reports"><div class="card-title">' + icon("flag") + 'Reports to review (' + reports.length + ")</div>" +
      (reports.length ? reports.map(function (x) {
        var target = x.cm_comments || x.cm_posts || {}, kind = x.comment_id ? "Comment" : "Post";
        var postId = x.post_id || (x.cm_comments && x.cm_comments.post_id);
        return '<div class="report" data-report="' + x.id + '"><div class="report-top"><span class="tag gold">' + kind + "</span><b>" + esc(x.reason) + "</b></div>" +
          '<p class="report-quote">“' + esc((target.body || "This was already deleted.").slice(0, 220)) + "”</p>" +
          '<p class="tiny muted">By ' + esc(member(target.author_id).display_name) + " · reported by " + esc(member(x.reporter_id).display_name) + " · " + ago(x.created_at) + "</p>" +
          '<div class="row">' + (postId ? '<a class="btn btn-line btn-sm" href="#/post/' + postId + '">View</a>' : "") +
          '<button class="btn btn-line btn-sm" type="button" data-resolve="' + x.id + '">Keep it, mark reviewed</button>' +
          (target.id ? '<button class="btn btn-danger btn-sm" type="button" data-remove="' + x.id + '" data-kind="' + (x.comment_id ? "comment" : "post") + '" data-target="' + target.id + '">Delete ' + kind.toLowerCase() + "</button>" : "") +
          "</div></div>";
      }).join("") : '<p class="muted">Nothing to review. Members can report posts and comments from the ⋯ menu.</p>') + "</section>" +
      '<form class="card stack" id="annForm"><div class="card-title" style="margin:0">' + icon("mega") + 'Post an announcement</div>' +
      '<textarea name="body" maxlength="5000" placeholder="Write an announcement. Every member gets a notification and an email." required></textarea>' +
      '<label class="check"><input type="checkbox" name="pin" checked> Pin to the top of the feed</label>' +
      '<div><button class="btn btn-navy" type="submit">' + icon("send") + "Publish announcement</button></div></form>" +
      '<section class="card"><div class="card-title">' + icon("pin") + "Pinned posts (" + pinned.length + ")</div>" +
      (pinned.length ? pinned.map(function (p) {
        return '<div class="who" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><a href="#/post/' + p.id + '" style="color:var(--ink);text-decoration:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.body.slice(0, 90)) + '</a><button class="btn btn-line btn-sm" type="button" data-unpin="' + p.id + '">Unpin</button></div>';
      }).join("") : '<p class="muted">Nothing pinned. Use the ⋯ menu on any post to pin it.</p>') + "</section>" +
      '<section class="card"><div class="card-title">' + icon("users") + 'Members (' + all.length + ')</div><div class="table-wrap"><table class="table"><thead><tr><th>Member</th><th>Joined</th><th>Status</th><th></th></tr></thead><tbody>' +
      all.map(function (m) {
        return '<tr><td><div class="who">' + avatar(m, "sm") + '<div><a href="#/u/' + m.user_id + '" style="color:var(--ink);font-weight:600;text-decoration:none">' + esc(m.display_name) + "</a> " + adminTag(m.user_id) + '<div class="tiny muted">' + esc(m.headline || "") + "</div></div></div></td>" +
          '<td class="tiny">' + fmtDate(m.joined_at, { month: "short", day: "numeric", year: "numeric" }) + "</td>" +
          "<td>" + (m.banned ? '<span class="tag gold">Paused</span>' : '<span class="tag">Active</span>') + "</td>" +
          "<td>" + (m.user_id === S.user.id || S.admins.has(m.user_id) ? "" : '<button class="btn btn-sm ' + (m.banned ? "btn-line" : "btn-danger") + '" type="button" data-ban="' + m.user_id + '" data-banned="' + m.banned + '">' + (m.banned ? "Restore" : "Pause access") + "</button>") + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<details class="howto"><summary>How to make someone an admin</summary><ol>' +
      "<li>Open <b>supabase.com</b> and sign in. Open the project <b>Remote By Designs Framework</b>.</li>" +
      "<li>In the left menu, click <b>Table Editor</b>, then the table <b>profiles</b>.</li>" +
      "<li>Find the person by their <b>email</b> (use the search or filter at the top).</li>" +
      "<li>Double-click their <b>is_admin</b> cell, change it to <b>TRUE</b>, then click <b>Save</b>.</li>" +
      "<li>They sign out and back in here. They'll see the Admin Dashboard and an ADMIN badge.</li></ol>" +
      '<p class="tiny muted">Heads-up: this is the same switch the Academy uses, so they also become an Academy admin (they can see learners, payments and coaching there). To undo it, set it back to FALSE.</p></details>' +
      "</section></div>";

    main.addEventListener("click", function (e) {
      var g = e.target.closest("[data-go],[data-manage]");
      if (!g) return;
      if (g.dataset.go === "ann") { var fa = $("#annForm"); fa.scrollIntoView({ behavior: "smooth", block: "center" }); fa.body.focus({ preventScroll: true }); }
      else {
        var grp = g.dataset.manage ? S.groups.find(function (x) { return x.id === g.dataset.manage; }) : boot;
        if (grp) manageGroup(grp, gm.filter(function (x) { return x.group_id === grp.id; }).map(function (x) { return x.user_id; }));
      }
    });
    var f = $("#annForm");
    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var b = $("button", f); b.disabled = true;
      var ins = await sb.from("cm_posts").insert({ author_id: S.user.id, category_id: "announcement", body: f.body.value.trim(), pinned: f.pin.checked });
      b.disabled = false;
      if (ins.error) { fail(ins.error); return; }
      toast("Announcement published."); route();
    });
    main.addEventListener("click", async function (e) {
      var b = e.target.closest("[data-unpin],[data-ban],[data-resolve],[data-remove]");
      if (!b) return;
      try {
        if (b.dataset.resolve) {
          var rs = await sb.from("cm_reports").update({ status: "resolved" }).eq("id", b.dataset.resolve);
          if (rs.error) throw rs.error;
          toast("Marked as reviewed.");
        } else if (b.dataset.remove) {
          if (!confirm("Delete this " + b.dataset.kind + "? This can't be undone.")) return;
          var del = await sb.from(b.dataset.kind === "comment" ? "cm_comments" : "cm_posts").delete().eq("id", b.dataset.target);
          if (del.error) throw del.error;
          // Deleting a post removes its reports; for comments, close the report too
          if (b.dataset.kind === "comment") await sb.from("cm_reports").update({ status: "resolved" }).eq("id", b.dataset.remove);
          toast("Deleted.");
        } else if (b.dataset.unpin) {
          var u = await sb.from("cm_posts").update({ pinned: false }).eq("id", b.dataset.unpin);
          if (u.error) throw u.error;
        } else {
          var banned = b.dataset.banned === "true", who = member(b.dataset.ban).display_name;
          if (!banned && !confirm("Pause " + who + "'s access to the community?")) return;
          var x = await sb.from("cm_members").update({ banned: !banned }).eq("user_id", b.dataset.ban);
          if (x.error) throw x.error;
          toast(banned ? who + " can use the community again." : who + "'s access is paused.");
        }
        route();
      } catch (err) { fail(err); }
    });
  }

  /* ---------- Guidelines ---------- */
  function renderGuidelines(main) {
    main.innerHTML = '<article class="card prose" style="max-width:820px">' +
      '<p class="eyebrow"><span class="dot"></span>How we show up for each other</p><h1 style="font-size:28px;font-weight:800;margin-top:8px">Community Guidelines</h1>' +
      '<p class="muted" style="margin-top:8px">This is a space for learners, freelancers, aspiring virtual assistants and remote professionals to learn, connect and grow. These guidelines keep it useful and kind.</p>' +
      "<h2>1. Be kind and respectful</h2><ul><li>Treat everyone as a future colleague or client.</li><li>No harassment, hate speech, discrimination or personal attacks.</li><li>Disagree with ideas, never with people.</li></ul>" +
      "<h2>2. Share value</h2><ul><li>Introduce yourself, ask questions, share wins, tools and lessons learned.</li><li>Pick the right category so others can find your post.</li><li>Celebrate other people's wins. Everyone starts somewhere.</li></ul>" +
      "<h2>3. No spam or unsolicited selling</h2><ul><li>No mass promotion, MLM, or repeated self-promotion.</li><li>Don't DM members to sell without their permission.</li><li>Job and client opportunities are welcome when they're clear and genuine.</li></ul>" +
      "<h2>4. Protect privacy</h2><ul><li>Don't share other people's personal details, screenshots of private chats or client information.</li><li>Never post passwords, IDs or payment details.</li></ul>" +
      "<h2>5. Be honest</h2><ul><li>Share real experiences. Don't misrepresent credentials or results.</li><li>Credit others when you share their work or ideas.</li></ul>" +
      "<h2>6. Keep it safe</h2><ul><li>Watch out for scams. RBD will never ask for payment through a DM.</li><li>If something feels off, tap <b>⋯ → Report post</b> (or <b>Report</b> under a comment), or email <a href=\"mailto:" + esc(C.supportEmail) + "\">" + esc(C.supportEmail) + "</a>.</li></ul>" +
      "<h2>Moderation</h2><p>The RBD team may remove posts or pause access for anyone who breaks these guidelines. Thanks for helping us keep this community a great place to grow.</p></article>";
  }

  /* ---------- Start ---------- */
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === "PASSWORD_RECOVERY") { S.entered = false; $("#app").hidden = true; $("#auth").hidden = false; setAuthMode("reset"); authMsg("Choose a new password for your account."); return; }
    if (event === "SIGNED_OUT") { showAuth(); return; }
    if (session && session.user && S.authMode !== "reset") setTimeout(function () { enter(session.user); }, 0);
  });
  sb.auth.getSession().then(function (r) {
    var session = r.data.session;
    if (session) enter(session.user);
    else { setAuthMode("signin"); showAuth(); }
  });
})();
