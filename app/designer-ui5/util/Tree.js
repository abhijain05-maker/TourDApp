sap.ui.define([], function () {
	"use strict";

	// The file list of a project as a tree (folders first, then files, both alphabetical); the same as designer/src/workspace/tree.ts.
	// The nodes are plain objects for a sap.m.Tree bound with arrayNames: ["children"].

	const IMAGES = ["png", "jpg", "jpeg", "gif", "svg", "ico", "webp"];
	const LETTER = { added: "A", modified: "M", deleted: "D" };
	const LABEL = { added: "new", modified: "changed", deleted: "removed", unchanged: "as uploaded" };

	const extOf = (path) => {
		const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
		return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
	};

	function iconFor(file) {
		const ext = extOf(file.path);
		if (file.binary || IMAGES.includes(ext)) return "sap-icon://picture";
		if (["js", "ts", "mjs", "cjs"].includes(ext) || file.kind === "controller") return "sap-icon://source-code";
		if (file.kind === "view" || file.kind === "fragment") return "sap-icon://document";
		return "sap-icon://document-text";
	}

	const compare = (a, b) =>
		a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

	function buildTree(files) {
		const root = { children: [] };
		for (const file of files) {
			const parts = file.path.split("/");
			let node = root;
			parts.forEach((name, i) => {
				const path = parts.slice(0, i + 1).join("/");
				const last = i === parts.length - 1;
				let next = node.children.find((c) => c.name === name && c.type === (last ? "file" : "dir"));
				if (!next) {
					next = { name, path, type: last ? "file" : "dir", children: [], changed: false, icon: "sap-icon://folder-blank" };
					if (last) {
						const status = file.status && file.status !== "unchanged" ? file.status : "";
						Object.assign(next, { id: file.ID, status, badge: LETTER[status] || "", badgeText: LABEL[status] || "", icon: iconFor(file), file });
					}
					node.children.push(next);
				}
				node = next;
			});
		}
		const finish = (n) => {
			n.children.sort(compare);
			let changed = n.type === "file" && !!n.status;
			for (const c of n.children) changed = finish(c) || changed;
			n.changed = changed;
			if (n.type === "dir") n.badge = changed ? "•" : "";
			return changed;
		};
		finish(root);
		return root.children;
	}

	/** Files whose path contains every word of the query (any order, any case). */
	function filterFiles(files, query) {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return words.length ? files.filter((f) => words.every((w) => f.path.toLowerCase().includes(w))) : files;
	}

	return {
		buildTree,
		filterFiles,
		extOf,
		fileName: (path) => path.slice(path.lastIndexOf("/") + 1),
		folderOf: (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""),
		STATUS_TEXT: { added: "New", modified: "Changed", deleted: "Removed", unchanged: "As uploaded" }
	};
});
