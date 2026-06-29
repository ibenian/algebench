/* section-nav.js — drop-in section navigator.
 *
 * Adds a small up/down control fixed to the left edge of the page that smooth-
 * scrolls between section headings. Self-contained: it injects its own styles
 * (themed via the host page's CSS vars, with fallbacks), detects headings on
 * load, accounts for a sticky/fixed header, and disables the arrows at the ends.
 * Auto-hides on pages with too few sections.
 *
 * Use on any page:  <script defer src="section-nav.js"></script>
 * Optional tuning:   window.SECTION_NAV = { selector: "h1,h2,h3", min: 3 }  (before this script)
 */
(function () {
  "use strict";
  // No early-return guard: if this script is injected more than once (live-reload,
  // preview tooling, bfcache), each run tears down the previous navigator and its
  // window listeners below, so the page always ends with exactly one navigator.

  var CFG = window.SECTION_NAV || {};
  var SELECTOR = CFG.selector || "h1, h2";
  var MIN = CFG.min || 3;          // don't show the control for fewer sections than this
  var CONTENT = CFG.content || "main, article";   // reading column the arrows hug
  var GAP = CFG.gap != null ? CFG.gap : 16;       // space between the arrows and the column
  var EDGE = CFG.edge != null ? CFG.edge : 10;    // min distance from the viewport edge

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    // Idempotent: tear down any navigator (and its window listeners) a prior run left behind,
    // so re-injecting this script can never stack a second control or duplicate handlers.
    [].forEach.call(document.querySelectorAll(".secnav"), function (n) { n.remove(); });
    if (window.__secNavCleanup) { try { window.__secNavCleanup(); } catch (e) {} }

    var heads = [].slice.call(document.querySelectorAll(SELECTOR))
      .filter(function (h) { return h.offsetParent !== null; });   // visible only
    if (heads.length < MIN) return;

    // Height of any sticky/fixed top bar, so a target heading isn't hidden under it.
    function headerOffset() {
      var off = 0;
      [].forEach.call(document.querySelectorAll("header, nav, .bar"), function (el) {
        var cs = getComputedStyle(el);
        if ((cs.position === "sticky" || cs.position === "fixed") &&
            (parseFloat(cs.top) || 0) === 0) {
          off = Math.max(off, el.getBoundingClientRect().height);
        }
      });
      return off + 18;
    }

    // Stable id so a reinjection (live-reload) replaces the style instead of
    // stacking duplicate <style> blocks in <head>.
    var prevStyle = document.getElementById("secnav-style");
    if (prevStyle) prevStyle.remove();
    var style = document.createElement("style");
    style.id = "secnav-style";
    style.textContent =
      ".secnav{position:fixed;left:18px;top:50%;transform:translateY(-50%);z-index:9999;" +
      "display:flex;flex-direction:column;gap:10px;}" +
      ".secnav button{width:40px;height:40px;border-radius:50%;cursor:pointer;padding:0;" +
      "display:flex;align-items:center;justify-content:center;" +
      "border:1px solid var(--rule,#d6d9e2);background:var(--bar,#ffffff);color:var(--ink,#1f2430);" +
      "box-shadow:0 4px 16px rgba(15,18,40,.18);" +
      "transition:transform .15s ease,border-color .15s,color .15s,opacity .2s;}" +
      ".secnav button:hover{border-color:var(--accent,#4f46e5);color:var(--accent,#4f46e5);transform:scale(1.1);}" +
      ".secnav button:active{transform:scale(.96);}" +
      ".secnav button:disabled{opacity:.3;cursor:default;transform:none;}" +
      ".secnav svg{width:19px;height:19px;display:block;}" +
      "@media(max-width:760px){.secnav{left:8px;gap:8px}.secnav button{width:34px;height:34px}}" +
      "@media print{.secnav{display:none}}";
    document.head.appendChild(style);

    var ICON = function (d) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" ' +
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
    };
    var nav = document.createElement("nav");   // semantic landmark for assistive tech
    nav.className = "secnav";
    nav.setAttribute("aria-label", "Section navigation");
    var up = document.createElement("button");
    up.innerHTML = ICON("M18 15l-6-6-6 6");
    up.title = "Previous section"; up.setAttribute("aria-label", "Previous section");
    var down = document.createElement("button");
    down.innerHTML = ICON("M6 9l6 6 6-6");
    down.title = "Next section"; down.setAttribute("aria-label", "Next section");
    nav.appendChild(up); nav.appendChild(down);
    document.body.appendChild(nav);

    // Sit just left of the reading column instead of the viewport edge, so the
    // arrows stay near the text on wide screens. Clamp so they never run off-screen.
    var content = document.querySelector(CONTENT);
    function place() {
      var left = EDGE;
      if (content) {
        var colLeft = content.getBoundingClientRect().left;
        left = Math.max(EDGE, colLeft - nav.offsetWidth - GAP);
      }
      nav.style.left = left + "px";
    }
    place();

    // Recompute each time — iframe embeds resize after load and shift positions.
    function tops() {
      var off = headerOffset();
      return heads.map(function (h) {
        return Math.max(0, h.getBoundingClientRect().top + window.scrollY - off);
      });
    }

    function go(dir) {
      var ys = tops(), cur = window.scrollY, eps = 4, target = null;
      if (dir > 0) {
        for (var i = 0; i < ys.length; i++) { if (ys[i] > cur + eps) { target = ys[i]; break; } }
      } else {
        for (var j = ys.length - 1; j >= 0; j--) { if (ys[j] < cur - eps) { target = ys[j]; break; } }
      }
      if (target != null) window.scrollTo({ top: target, behavior: "smooth" });
    }
    up.addEventListener("click", function () { go(-1); });
    down.addEventListener("click", function () { go(1); });

    function refresh() {
      var ys = tops(), cur = window.scrollY, eps = 4;
      up.disabled = !ys.some(function (y) { return y < cur - eps; });
      down.disabled = !ys.some(function (y) { return y > cur + eps; });
    }
    refresh();
    var t;
    function onScroll() { clearTimeout(t); t = setTimeout(refresh, 80); }
    function onResize() { place(); refresh(); }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    // Expose teardown so a later run of this script can fully unwind this instance.
    window.__secNavCleanup = function () {
      clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      nav.remove();
      window.__secNavCleanup = null;
    };
  });
})();
