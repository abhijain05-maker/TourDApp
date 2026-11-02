sap.ui.define(["sap/ui/core/Theming"], function (Theming) {
	"use strict";

	// Light and dark appearance. "auto" follows the operating system. The choice is remembered per browser.
	const KEY = "tourd.theme";
	const prefersDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
	const LABEL = { auto: "Appearance: automatic", light: "Appearance: light", dark: "Appearance: dark" };

	let current = (() => {
		try {
			const v = localStorage.getItem(KEY);
			return v === "light" || v === "dark" ? v : "auto";
		} catch (e) {
			return "auto";
		}
	})();

	const resolved = () => (current === "auto" ? (prefersDark() ? "dark" : "light") : current);

	const listeners = [];

	function apply() {
		const dark = resolved() === "dark";
		document.documentElement.dataset.theme = dark ? "dark" : "light";
		document.documentElement.style.colorScheme = dark ? "dark" : "light";
		Theming.setTheme(dark ? "sap_horizon_dark" : "sap_horizon");
		listeners.forEach((fn) => fn(dark));
	}

	return {
		choice: () => current,
		label: (c) => LABEL[c || current],
		isDark: () => resolved() === "dark",
		/** fn(dark) runs whenever the appearance changes; returns a function that stops listening. */
		onChange(fn) {
			listeners.push(fn);
			return () => listeners.splice(listeners.indexOf(fn), 1);
		},
		next: () => (current === "auto" ? "light" : current === "light" ? "dark" : "auto"),
		/** Call once at start. */
		init() {
			apply();
			if (typeof matchMedia === "function")
				matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
					if (current === "auto") apply();
				});
		},
		set(choice) {
			current = choice;
			try {
				if (choice === "auto") localStorage.removeItem(KEY);
				else localStorage.setItem(KEY, choice);
			} catch (e) {
				/* a remembered choice is only a convenience */
			}
			apply();
		}
	};
});
