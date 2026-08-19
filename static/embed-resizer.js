//#region src/embed-resizer.ts
(function() {
	function embeds() {
		return document.querySelectorAll("iframe[data-algebench-embed]");
	}
	function onMessage(e) {
		var d = e.data;
		if (!d || d.type !== "algebench-embed-height" || typeof d.height !== "number") return;
		if (!isFinite(d.height)) return;
		var h = Math.max(0, Math.min(Math.ceil(d.height), 2e4));
		var list = embeds();
		for (var i = 0; i < list.length; i++) if (list[i].contentWindow === e.source) list[i].style.height = h + "px";
	}
	function request() {
		var list = embeds();
		for (var i = 0; i < list.length; i++) try {
			list[i].contentWindow.postMessage({ type: "algebench-embed-request" }, "*");
		} catch (e) {}
	}
	window.addEventListener("message", onMessage);
	if (document.readyState === "complete") request();
	else window.addEventListener("load", request);
})();
//#endregion

