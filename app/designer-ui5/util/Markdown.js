sap.ui.define([], function () {
	"use strict";

	// The Markdown subset tour texts use (**bold**, *italic*, `code`, [text](https://link), "- " lists, paragraphs) as HTML for
	// sap.m.FormattedText. The text is escaped first, so no HTML of the author's is ever injected.
	const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
	const TOKEN = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
	const BULLET = /^\s*[-*]\s+/;

	function inline(source) {
		let out = "";
		let last = 0;
		for (const m of source.matchAll(TOKEN)) {
			const at = m.index || 0;
			out += esc(source.slice(last, at));
			if (m[1] !== undefined) out += "<strong>" + esc(m[1]) + "</strong>";
			else if (m[2] !== undefined) out += "<em>" + esc(m[2]) + "</em>";
			else if (m[3] !== undefined) out += "<code>" + esc(m[3]) + "</code>";
			else out += '<a href="' + esc(m[5]) + '" target="_blank" rel="noopener noreferrer">' + esc(m[4]) + "</a>";
			last = at + m[0].length;
		}
		return out + esc(source.slice(last));
	}

	return {
		toHtml(markdown) {
			return String(markdown || "")
				.replace(/\r\n?/g, "\n")
				.split(/\n{2,}/)
				.filter((b) => b.trim())
				.map((block) => {
					const lines = block.split("\n");
					if (lines.every((l) => BULLET.test(l))) return "<ul>" + lines.map((l) => "<li>" + inline(l.replace(BULLET, "")) + "</li>").join("") + "</ul>";
					return "<p>" + lines.map(inline).join("<br>") + "</p>";
				})
				.join("");
		}
	};
});
