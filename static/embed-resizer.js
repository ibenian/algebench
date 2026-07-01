// AlgeBench embed resizer — auto-sizes proof-animation iframes to their content.
//
// Drop-in companion to the embed snippet. The embedded /renderproof page posts its
// content height; this script (running on the HOST page) sets the matching iframe's
// height, so the embed shows no empty space or scrollbar and adapts as the reader
// steps through the proof. Safe: it only reads a numeric height from an iframe it
// already hosts (matched by contentWindow) and changes that iframe's height.
(function () {
  function embeds() {
    return document.querySelectorAll("iframe[data-algebench-embed]");
  }
  function onMessage(e) {
    var d = e.data;
    if (!d || d.type !== "algebench-embed-height" || typeof d.height !== "number") return;
    // Guard against a misbehaving embed: reject non-finite (NaN/Infinity both pass
    // `typeof === "number"`) and clamp to a sane range so a pathological height
    // can't thrash the host layout or blow up the iframe.
    if (!isFinite(d.height)) return;
    var h = Math.max(0, Math.min(Math.ceil(d.height), 20000));
    var list = embeds();
    for (var i = 0; i < list.length; i++) {
      if (list[i].contentWindow === e.source) {
        list[i].style.height = h + "px";
      }
    }
  }
  function request() {
    // Cover the race where an iframe finished loading (and posted its height) before
    // this script attached its listener: ask each embed to report again.
    var list = embeds();
    for (var i = 0; i < list.length; i++) {
      try { list[i].contentWindow.postMessage({ type: "algebench-embed-request" }, "*"); } catch (e) {}
    }
  }
  window.addEventListener("message", onMessage);
  if (document.readyState === "complete") request();
  else window.addEventListener("load", request);
})();
