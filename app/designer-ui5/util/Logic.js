sap.ui.define([], function () {
	"use strict";

	// The tour logic (validation, lint, snippets...) as built from the repository's own modules: lib/tourd-logic.js.
	// Loaded when the first page needs it.
	let loading;
	return {
		load() {
			return (loading = loading || import(new URL(sap.ui.require.toUrl("tourd/designer/lib/tourd-logic.js"), document.baseURI).href));
		}
	};
});
