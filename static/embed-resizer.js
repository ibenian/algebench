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
    var list = embeds();
    for (var i = 0; i < list.length; i++) {
      if (list[i].contentWindow === e.source) {
        list[i].style.height = Math.ceil(d.height) + "px";
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
