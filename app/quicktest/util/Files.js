sap.ui.define([], function () {
	"use strict";

	// Choosing a file from the computer, reading it, and handing a download to the browser.
	return {
		/** Opens the file chooser. Resolves to the File, or null when the person cancels. */
		pick(accept, multiple) {
			return new Promise((resolve) => {
				const input = document.createElement("input");
				input.type = "file";
				if (accept) input.accept = accept;
				if (multiple) input.multiple = true;
				input.onchange = () => resolve(multiple ? Array.from(input.files) : input.files[0] || null);
				input.addEventListener("cancel", () => resolve(null));
				input.click();
			});
		},

		/** The bytes of a file as base64 (a workbook is binary and travels in JSON). */
		async base64(file) {
			const bytes = new Uint8Array(await file.arrayBuffer());
			let binary = "";
			for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
			return btoa(binary);
		},

		/** Text from a file; a UTF-8 byte order mark is dropped. */
		async text(file) {
			return (await file.text()).replace(/^﻿/, "");
		},

		/** Starts a download of a link on this server (the server names the file). */
		download(url) {
			const a = document.createElement("a");
			a.href = url;
			a.rel = "noopener";
			document.body.appendChild(a);
			a.click();
			a.remove();
		},

		/** Saves text the page made itself. */
		save(name, text, type) {
			const url = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
			const a = document.createElement("a");
			a.href = url;
			a.download = name;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		},

		/** Copies text; resolves to true when it worked. */
		async copy(text) {
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch (e) {
				return false;
			}
		}
	};
});
