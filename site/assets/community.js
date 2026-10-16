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
    thread: null, authMode: "signin"
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
      back: '<path d="M15 5 8 12l7 7"/>'
    };
    return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + P[name] + "</svg>";
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
        loadMembers()
      ]);
      S.isAdmin = !!res[0].data;
      S.cats = res[1].data || [];
      S.admins = new Set((res[2].data || []).map(function (x) { return typeof x === "string" ? x : x.cm_admin_ids; }));
    } catch (err) { S.entered = false; fail(err); return; }
    $("#auth").hidden = true; $("#app").hidden = false;
    $("#adminNav").hidden = !S.isAdmin;
    paintMe();
    subscribe();
    refreshCounts();
    route();
  }
  function paintMe() { $("#meBtn").innerHTML = avatar(S.me, "sm", false); }

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
        if (p.new.author_id !== S.user.id && currentRoute()[0] === "feed") { var b = $("#newPosts"); if (b) b.hidden = false; }
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
        like: name + " liked your post",
        announcement: "New announcement from " + (name || "the RBD team"),
        event: "New event: <b>" + esc(n.cm_events ? n.cm_events.title : "") + "</b>"
      }[n.kind] || "Update";
      var href = n.post_id ? "#/post/" + n.post_id : n.event_id ? "#/events" : "#/feed";
      return '<a class="notif' + (n.read_at ? "" : " unread") + '" href="' + href + '">' +
        (who ? avatar(who, "sm", false) : '<span class="av sm">' + icon("cal") + "</span>") +
        "<span>" + text + "<small>" + ago(n.created_at) + "</small></span></a>";
    }).join("");
    pop.innerHTML = '<div class="pop-head">Notifications</div>' + (rows || '<div class="empty">You\'re all caught up.</div>');
    if (r.data.some(function (n) { return !n.read_at; })) {
      await sb.from("cm_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", S.user.id).is("read_at", null).neq("kind", "message");
      refreshCounts();
    }
  }

  /* ---------- Router ---------- */
  var TITLES = { feed: "Community Feed", post: "Post", messages: "Messages", events: "Events", members: "Members", profile: "My Profile", u: "Member", admin: "Admin Dashboard", guidelines: "Community Guidelines" };
  function currentRoute() { return (location.hash.replace(/^#\/?/, "") || "feed").split("/"); }
  async function route() {
    if (!S.entered) return;
    var parts = currentRoute(), name = parts[0];
    if (!TITLES[name] || (name === "admin" && !S.isAdmin)) { location.hash = "#/feed"; return; }
    S.thread = null;
    closeMenu();
    $$(".pop").forEach(function (p) { p.hidden = true; });
    var navName = name === "post" ? "feed" : name === "u" ? (parts[1] === S.user.id ? "profile" : "members") : name;
    $$(".nav-item").forEach(function (a) { if (a.dataset.route === navName) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    $("#pageTitle").textContent = TITLES[name];
    document.title = TITLES[name] + " · Remote by Designs Community";
    // Fresh container per page so click handlers from the previous page go away with it
    var main = document.createElement("div");
    main.innerHTML = '<div class="loading">Loading…</div>';
    $("#main").replaceChildren(main);
    try {
      if (name === "feed") await renderFeed(main);
      else if (name === "post") await renderSinglePost(main, parts[1]);
      else if (name === "messages") await renderMessages(main, parts[1]);
      else if (name === "events") await renderEvents(main);
      else if (name === "members") await renderMembers(main);
      else if (name === "profile") await renderProfile(main, S.user.id);
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

  function postHTML(p, opts) {
    opts = opts || {};
    var a = member(p.author_id), mine = p.author_id === S.user.id;
    var likes = p.cm_likes || [], liked = likes.some(function (l) { return l.user_id === S.user.id; });
    var cCount = p.cm_comments && p.cm_comments[0] ? p.cm_comments[0].count : 0;
    var long = p.body.length > 600 || p.body.split("\n").length > 9;
    var link = safeUrl(p.link_url), img = safeUrl(p.image_url);
    var menu = (mine || S.isAdmin) ?
      '<div class="post-menu"><button class="menu-btn" type="button" data-act="menu" aria-label="Post options">⋯</button><div class="pop pop-sm" hidden>' +
      (S.isAdmin ? '<button type="button" data-act="pin">' + (p.pinned ? "Unpin post" : "Pin to top") + "</button>" : "") +
      '<button type="button" data-act="delete">Delete post</button></div></div>' : "";
    return '<article class="card post' + (p.pinned ? " pinned" : "") + '" data-post="' + p.id + '">' +
      (p.pinned ? '<div class="pin-label">' + icon("pin") + (p.category_id === "announcement" ? "Official announcement" : "Pinned") + "</div>" : "") +
      '<div class="post-head">' + avatar(a) +
      '<div class="post-meta"><a class="name" href="#/u/' + a.user_id + '">' + esc(a.display_name) + adminTag(a.user_id) + "</a>" +
      '<div class="sub">' + (a.headline ? "<span>" + esc(a.headline) + "</span><span>·</span>" : "") +
      '<a href="#/post/' + p.id + '" class="muted" style="text-decoration:none">' + ago(p.created_at) + "</a>" +
      '<span class="tag' + (p.category_id === "announcement" ? " gold" : "") + '">' + esc(catName(p.category_id)) + "</span></div></div>" + menu + "</div>" +
      '<div class="post-body' + (long && !opts.full ? " clamp" : "") + '">' + linkify(p.body) + "</div>" +
      (long && !opts.full ? '<button class="read-more" type="button" data-act="more">Read more</button>' : "") +
      (img ? '<a href="' + esc(img) + '" target="_blank" rel="noopener"><img class="post-img" src="' + esc(img) + '" alt="Image shared by ' + esc(a.display_name) + '" loading="lazy"></a>' : "") +
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
      '<div class="comment-foot"><span>' + ago(c.created_at) + "</span>" + (canDel ? '<button class="linkish tiny" type="button" data-act="del-comment">Delete</button>' : "") + "</div></div></div>";
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

  /* ---------- Feed ---------- */
  async function renderFeed(main) {
    var first = (S.me.display_name || "").split(" ")[0];
    var postable = S.cats.filter(function (c) { return !c.admin_only || S.isAdmin; });
    main.innerHTML =
      '<div class="grid-feed"><div class="col">' +
      '<section class="card hello"><h1>Welcome back, ' + esc(first) + '</h1><p>Catch up with the community, share a win or ask a question.</p></section>' +
      '<section class="card"><form class="composer" id="composer">' + avatar(S.me, "", false) +
      '<div class="composer-body"><textarea name="body" maxlength="5000" placeholder="Share something with the community…" aria-label="Write a post" required></textarea>' +
      '<div class="attach-preview" id="attachPreview"></div>' +
      '<input name="link" type="url" placeholder="Paste a link (https://…)" aria-label="Link" hidden>' +
      '<div class="composer-tools"><select name="category" aria-label="Category">' +
      postable.filter(function (c) { return c.id !== "announcement"; }).concat(postable.filter(function (c) { return c.id === "announcement"; }))
        .map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>"; }).join("") +
      '</select><label class="tool-btn" style="flex-direction:row;font-weight:500">' + icon("image") + 'Image<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" hidden></label>' +
      '<button class="tool-btn" type="button" id="linkBtn">' + icon("link") + "Link</button>" +
      '<button class="btn btn-navy" type="submit">' + icon("send") + "Post</button></div></div></form></section>" +
      '<div class="chips" role="toolbar" aria-label="Filter by category"><button class="chip" type="button" data-cat="all">All posts</button>' +
      S.cats.filter(function (c) { return c.id !== "announcement"; }).map(function (c) { return '<button class="chip" type="button" data-cat="' + esc(c.id) + '">' + esc(c.name) + "</button>"; }).join("") +
      '<button class="chip" type="button" data-cat="announcement">Announcements</button></div>' +
      '<button class="btn btn-gold" type="button" id="newPosts" hidden>New posts. Show them</button>' +
      '<div class="col" id="posts"></div>' +
      '<button class="btn btn-line" type="button" id="morePosts" hidden>Load more posts</button>' +
      '</div><div class="col sticky-col side-col" id="sideCol"></div></div>';

    var form = $("#composer");
    var file = null;
    form.image.addEventListener("change", function () {
      file = this.files[0] || null;
      var prev = $("#attachPreview");
      if (!file) { prev.innerHTML = ""; return; }
      var url = URL.createObjectURL(file);
      prev.innerHTML = '<img src="' + url + '" alt="Selected image"><span class="chip-x">' + esc(file.name) + ' <button type="button" aria-label="Remove image">✕</button></span>';
      $("button", prev).addEventListener("click", function () { file = null; form.image.value = ""; prev.innerHTML = ""; });
    });
    $("#linkBtn").addEventListener("click", function () { form.link.hidden = !form.link.hidden; if (!form.link.hidden) form.link.focus(); });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var body = form.body.value.trim(), link = form.link.value.trim();
      if (!body) { form.body.focus(); return; }
      if (link && !safeUrl(link)) { toast("Links need to start with https://", true); return; }
      var b = $("button[type=submit]", form); b.disabled = true;
      try {
        var img = await uploadImage(file);
        var isAnn = form.category.value === "announcement";
        var r = await sb.from("cm_posts").insert({ author_id: S.user.id, category_id: form.category.value, body: body, link_url: link || null, image_url: img, pinned: isAnn }).select(POST_SELECT).single();
        if (r.error) throw r.error;
        form.reset(); file = null; $("#attachPreview").innerHTML = ""; form.link.hidden = true;
        $("#posts").insertAdjacentHTML("afterbegin", postHTML(r.data));
        toast("Posted!");
      } catch (err) { fail(err); } finally { b.disabled = false; }
    });

    $$(".chip").forEach(function (c) {
      c.setAttribute("aria-pressed", String(c.dataset.cat === S.cat));
      c.addEventListener("click", function () {
        S.cat = c.dataset.cat;
        $$(".chip").forEach(function (x) { x.setAttribute("aria-pressed", String(x === c)); });
        loadFeed(true);
      });
    });
    $("#morePosts").addEventListener("click", function () { loadFeed(false); });
    $("#newPosts").addEventListener("click", function () { this.hidden = true; loadFeed(true); });
    await Promise.all([loadFeed(true), renderSideCol($("#sideCol"))]);
  }

  async function loadFeed(reset) {
    if (reset) S.feedOffset = 0;
    var q = sb.from("cm_posts").select(POST_SELECT).order("pinned", { ascending: false }).order("created_at", { ascending: false }).range(S.feedOffset, S.feedOffset + PAGE - 1);
    if (S.cat !== "all") q = q.eq("category_id", S.cat);
    var r = await q;
    if (r.error) throw r.error;
    await ensureMembers(r.data.map(function (p) { return p.author_id; }));
    var box = $("#posts");
    if (!box) return;
    var html = r.data.map(function (p) { return postHTML(p); }).join("");
    if (reset) box.innerHTML = html || '<div class="card empty"><b>No posts here yet</b>Be the first to start the conversation.</div>';
    else box.insertAdjacentHTML("beforeend", html);
    S.feedOffset += r.data.length;
    $("#morePosts").hidden = r.data.length < PAGE;
  }

  async function renderSideCol(col) {
    var r = await Promise.all([
      sb.from("cm_posts").select("*").eq("category_id", "announcement").order("created_at", { ascending: false }).limit(1),
      sb.from("cm_events").select("*").gte("starts_at", new Date(Date.now() - 2 * 3600e3).toISOString()).order("starts_at").limit(3)
    ]);
    var ann = r[0].data && r[0].data[0], evs = r[1].data || [];
    col.innerHTML =
      '<section class="card"><div class="card-title">' + icon("mega") + "Latest announcement</div>" +
      (ann ? '<p class="ann-body">' + esc(ann.body) + '</p><div class="ann-foot"><span>' + ago(ann.created_at) + '</span><a href="#/post/' + ann.id + '">Read more</a></div>'
           : '<p class="muted">No announcements yet.</p>') + "</section>" +
      '<section class="card"><div class="card-title">' + icon("cal") + 'Upcoming events<a href="#/events">All</a></div>' +
      (evs.length ? evs.map(function (ev) {
        return '<a class="ev-mini" href="#/events"><b>' + esc(ev.title) + "</b><span>" + icon("clock") + fmtWhen(ev.starts_at) + "</span></a>";
      }).join("") : '<p class="muted">No events scheduled yet.</p>') + "</section>";
  }

  async function renderSinglePost(main, id) {
    var r = await sb.from("cm_posts").select(POST_SELECT).eq("id", id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) { main.innerHTML = '<div class="card empty"><b>Post not found</b>It may have been deleted. <a href="#/feed">Back to the feed</a></div>'; return; }
    await ensureMembers([r.data.author_id]);
    main.innerHTML = '<div class="grid-feed"><div class="col"><a href="#/feed" class="linkish">← Back to the feed</a>' + postHTML(r.data, { full: true }) + '</div><div class="col sticky-col side-col" id="sideCol"></div></div>';
    await Promise.all([loadComments($("[data-post]", main)), renderSideCol($("#sideCol"))]);
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
    return '<article class="card event" data-event="' + ev.id + '"><div class="date-tile"><small>' + fmtDate(d, { month: "short" }) + "</small><b>" + fmtDate(d, { day: "numeric" }) + "</b><small>" + fmtDate(d, { weekday: "short" }) + "</small></div>" +
      "<div><h3>" + esc(ev.title) + '</h3><div class="when"><span>' + icon("clock") + " " + fmtWhen(ev.starts_at) + (ev.ends_at ? " – " + fmtDate(ev.ends_at, { hour: "numeric", minute: "2-digit" }) : "") + "</span>" +
      (loc && !url ? "<span>" + icon("place") + " " + esc(loc) + "</span>" : "") + "</div>" +
      (ev.description ? '<p class="desc">' + linkify(ev.description) + "</p>" : "") +
      '<div class="row">' +
      (isPast ? '<span class="tag">Ended</span>' : '<button class="btn ' + (going ? "btn-line" : "btn-navy") + ' btn-sm" type="button" data-rsvp="' + (going ? "1" : "0") + '">' + (going ? "✓ You're going" : "I'm going") + "</button>") +
      (url && !isPast ? '<a class="btn btn-gold btn-sm" href="' + esc(url) + '" target="_blank" rel="noopener">Join link</a>' : "") +
      '<span class="tiny muted">' + n + (n === 1 ? " person" : " people") + " going</span>" +
      (S.isAdmin ? '<button class="linkish tiny" type="button" data-del-event>Delete</button>' : "") +
      "</div></div></article>";
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
    await loadMembers();
    var list = Array.from(S.members.values()).filter(function (m) { return !m.banned; });
    main.innerHTML = '<div class="col"><div class="page-head"><div><h1>Members</h1><p>' + list.length + " people learning and growing together.</p></div>" +
      '<input class="search" type="search" id="memberSearch" placeholder="Search by name or role…" aria-label="Search members"></div><div class="members" id="memberGrid"></div></div>';
    function paint(q) {
      q = (q || "").toLowerCase();
      var rows = list.filter(function (m) { return !q || (m.display_name + " " + (m.headline || "") + " " + (m.location || "")).toLowerCase().indexOf(q) >= 0; });
      $("#memberGrid").innerHTML = rows.map(function (m) {
        return '<div class="card member">' + avatar(m) + "<b>" + esc(m.display_name) + "</b>" + adminTag(m.user_id) +
          "<p>" + esc(m.headline || (m.location || "")) + '</p><div class="row"><a class="btn btn-line btn-sm" href="#/u/' + m.user_id + '">Profile</a>' +
          (m.user_id !== S.user.id ? '<a class="btn btn-navy btn-sm" href="#/messages/' + m.user_id + '">Message</a>' : "") + "</div></div>";
      }).join("") || '<div class="card empty" style="grid-column:1/-1"><b>No one matches that search</b></div>';
    }
    paint();
    $("#memberSearch").addEventListener("input", function () { paint(this.value); });
  }

  /* ---------- Profiles ---------- */
  async function renderProfile(main, id) {
    await ensureMembers([id]);
    var m = S.members.get(id);
    if (!m) { main.innerHTML = '<div class="card empty"><b>Member not found</b><a href="#/members">See all members</a></div>'; return; }
    var mine = id === S.user.id;
    var posts = await sb.from("cm_posts").select(POST_SELECT).eq("author_id", id).order("created_at", { ascending: false }).limit(20);
    if (posts.error) throw posts.error;
    main.innerHTML = '<div class="col" style="max-width:820px">' +
      '<section class="card"><div class="profile-hero">' + avatar(m, "lg", false) + '<div style="flex:1;min-width:200px"><h1>' + esc(m.display_name) + " " + adminTag(id) + "</h1>" +
      (m.headline ? '<p class="headline">' + esc(m.headline) + "</p>" : "") +
      '<p class="tiny muted">' + (m.location ? esc(m.location) + " · " : "") + "Joined " + fmtDate(m.joined_at, { month: "long", year: "numeric" }) + "</p></div>" +
      (mine ? '<button class="btn btn-line" type="button" id="editProfileBtn">Edit profile</button>' : '<a class="btn btn-navy" href="#/messages/' + id + '">Message</a>') + "</div>" +
      (m.bio ? '<p class="profile-bio">' + linkify(m.bio) + "</p>" : mine ? '<p class="profile-bio muted">Add a short bio so others know what you do and what you\'re working toward.</p>' : "") +
      "</section>" + (mine ? profileFormHTML(m) : "") +
      '<h2 style="font-size:18px">' + (mine ? "Your posts" : "Posts") + "</h2>" +
      (posts.data.length ? posts.data.map(function (p) { return postHTML(p); }).join("") : '<div class="card empty">No posts yet.</div>') + "</div>";
    if (mine) bindProfileForm(m);
  }
  function profileFormHTML(m) {
    return '<form class="card stack" id="profileForm" hidden><h2 style="font-size:18px">Edit profile</h2>' +
      '<div class="avatar-edit">' + avatar(m, "lg", false) + '<div class="stack" style="gap:6px"><label class="btn btn-line btn-sm" style="flex-direction:row;color:var(--ink)">Upload photo<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden></label>' +
      (m.avatar_url ? '<button class="linkish tiny" type="button" id="removePhoto">Remove photo</button>' : "") + "</div></div>" +
      '<label>Name<input name="display_name" maxlength="80" required value="' + esc(m.display_name) + '"></label>' +
      '<label>Headline<input name="headline" maxlength="120" placeholder="e.g. Aspiring Virtual Assistant · Real estate ops" value="' + esc(m.headline || "") + '"></label>' +
      '<label>Location<input name="location" maxlength="80" placeholder="e.g. Cebu, Philippines" value="' + esc(m.location || "") + '"></label>' +
      '<label>Bio<textarea name="bio" maxlength="1000">' + esc(m.bio || "") + "</textarea></label>" +
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
      loadMembers()
    ]);
    if (r[0].error) throw r[0].error;
    var s = r[0].data, pinned = r[1].data || [];
    var all = Array.from(S.members.values()).sort(function (a, b) { return new Date(b.joined_at) - new Date(a.joined_at); });
    function stat(n, label) { return '<div class="card stat"><b class="grad">' + n + "</b><span>" + label + "</span></div>"; }
    main.innerHTML = '<div class="col">' +
      '<div class="page-head"><div><h1>Admin Dashboard</h1><p>Run the community: announcements, events and members.</p></div><a class="btn btn-line" href="#/events">Manage events</a></div>' +
      '<div class="stats">' + stat(s.members, "Members") + stat(s.new_members_7d, "New this week") + stat(s.posts, "Posts") + stat(s.posts_7d, "Posts this week") + stat(s.comments, "Comments") + stat(s.upcoming_events, "Upcoming events") + "</div>" +
      '<form class="card stack" id="annForm"><div class="card-title" style="margin:0">' + icon("mega") + 'Post an announcement</div>' +
      '<textarea name="body" maxlength="5000" placeholder="Write an announcement. Every member gets a notification." required></textarea>' +
      '<label class="check"><input type="checkbox" name="pin" checked> Pin to the top of the feed</label>' +
      '<div><button class="btn btn-navy" type="submit">' + icon("send") + "Publish announcement</button></div></form>" +
      '<section class="card"><div class="card-title">' + icon("pin") + "Pinned posts (" + pinned.length + ")</div>" +
      (pinned.length ? pinned.map(function (p) {
        return '<div class="who" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><a href="#/post/' + p.id + '" style="color:var(--ink);text-decoration:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.body.slice(0, 90)) + '</a><button class="btn btn-line btn-sm" type="button" data-unpin="' + p.id + '">Unpin</button></div>';
      }).join("") : '<p class="muted">Nothing pinned. Use the ⋯ menu on any post to pin it.</p>') + "</section>" +
      '<section class="card"><div class="card-title">Members (' + all.length + ')</div><div class="table-wrap"><table class="table"><thead><tr><th>Member</th><th>Joined</th><th>Status</th><th></th></tr></thead><tbody>' +
      all.map(function (m) {
        return '<tr><td><div class="who">' + avatar(m, "sm") + '<div><a href="#/u/' + m.user_id + '" style="color:var(--ink);font-weight:600;text-decoration:none">' + esc(m.display_name) + "</a> " + adminTag(m.user_id) + '<div class="tiny muted">' + esc(m.headline || "") + "</div></div></div></td>" +
          '<td class="tiny">' + fmtDate(m.joined_at, { month: "short", day: "numeric", year: "numeric" }) + "</td>" +
          "<td>" + (m.banned ? '<span class="tag gold">Paused</span>' : '<span class="tag">Active</span>') + "</td>" +
          "<td>" + (m.user_id === S.user.id || S.admins.has(m.user_id) ? "" : '<button class="btn btn-sm ' + (m.banned ? "btn-line" : "btn-danger") + '" type="button" data-ban="' + m.user_id + '" data-banned="' + m.banned + '">' + (m.banned ? "Restore" : "Pause access") + "</button>") + "</td></tr>";
      }).join("") + "</tbody></table></div><p class=\"tiny muted\" style=\"margin-top:10px\">Paused members can't see or post in the community. To make someone an admin, set <code>is_admin</code> on their Academy profile.</p></section></div>";

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
      var b = e.target.closest("[data-unpin],[data-ban]");
      if (!b) return;
      try {
        if (b.dataset.unpin) {
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
      "<h2>6. Keep it safe</h2><ul><li>Watch out for scams. RBD will never ask for payment through a DM.</li><li>If something feels off, report it to <a href=\"mailto:" + esc(C.supportEmail) + "\">" + esc(C.supportEmail) + "</a>.</li></ul>" +
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
