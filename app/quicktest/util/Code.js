sap.ui.define([], function () {
	"use strict";

	const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(const|let|var|function|async|await|return|if|else|for|of|in|new|import|export|from|describe|it|xit|before|after|beforeEach|afterEach|require|module|default|class|true|false|null|undefined)\b|\b(\d+(?:\.\d+)?)\b/g;

	return {
		/** JavaScript as HTML with a few colours (classes c, s, k, n of .qtCodeBox); good enough to read generated tests. */
		highlight(code) {
			let out = "";
			let last = 0;
			const text = String(code == null ? "" : code);
			for (const m of text.matchAll(TOKEN)) {
				out += esc(text.slice(last, m.index));
				const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "k" : "n";
				out += "<span class='" + cls + "'>" + esc(m[0]) + "</span>";
				last = m.index + m[0].length;
			}
			return out + esc(text.slice(last));
		}
	};
});
