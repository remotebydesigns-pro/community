/* Light/dark mode. Follows the device until the visitor picks one with the sun/moon button. */
(function () {
  var KEY = "rbd-theme";
  var root = document.documentElement;
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  var s = saved();
  if (s === "light" || s === "dark") root.setAttribute("data-theme", s);

  function current() {
    var t = root.getAttribute("data-theme");
    if (t) return t;
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  window.RBDTheme = {
    current: current,
    toggle: function () {
      var next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      document.dispatchEvent(new CustomEvent("themechange"));
    }
  };
})();
