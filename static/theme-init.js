//#region src/theme-init.ts
(function() {
	var t = null, p = null;
	try {
		var q = new URLSearchParams(location.search);
		t = q.get("theme");
		p = q.get("palette");
	} catch (e) {}
	if (t !== "dark" && t !== "light" && t !== "auto") try {
		t = localStorage.getItem("algebench-theme");
	} catch (e) {
		t = null;
	}
	if (t === "auto") t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
	document.documentElement.dataset.theme = t === "light" ? "light" : "dark";
	var PALETTES = [
		"blueprint",
		"sepia",
		"plum",
		"cerulean",
		"graphite",
		"contrast"
	];
	if (p === "slate" || p === "default") {
		try {
			localStorage.removeItem("algebench-palette");
		} catch (e) {}
		p = null;
	} else if (PALETTES.indexOf(p) !== -1) try {
		localStorage.setItem("algebench-palette", p);
	} catch (e) {}
	else try {
		p = localStorage.getItem("algebench-palette");
	} catch (e) {
		p = null;
	}
	if (PALETTES.indexOf(p) !== -1) document.documentElement.dataset.palette = p;
})();
//#endregion

