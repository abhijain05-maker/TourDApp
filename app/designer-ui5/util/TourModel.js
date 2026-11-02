sap.ui.define([], function () {
	"use strict";

	// Pure operations on a tour document (designer/src/editor/model.ts) and undo / redo (history.ts).
	// Every function returns a new document and never changes its input.

	const SIDES = ["Top", "Bottom", "Left", "Right"];

	/** The smallest unused "sN" id. */
	function uniqueStepId(doc, prefix = "s") {
		const used = new Set(doc.steps.map((s) => s.id));
		for (let n = 1; ; n++) if (!used.has(prefix + n)) return prefix + n;
	}

	function updateStep(doc, id, patch) {
		if (!doc.steps.some((s) => s.id === id)) return doc;
		return Object.assign({}, doc, { steps: doc.steps.map((s) => (s.id === id ? Object.assign({}, s, patch) : s)) });
	}

	function moveStep(doc, from, to) {
		const n = doc.steps.length;
		if (from === to || from < 0 || to < 0 || from >= n || to >= n) return doc;
		const steps = doc.steps.slice();
		const [moved] = steps.splice(from, 1);
		steps.splice(to, 0, moved);
		return Object.assign({}, doc, { steps });
	}

	/** Adds an empty step after the given step id (at the end when there is none). */
	function addStep(doc, afterId) {
		const id = uniqueStepId(doc);
		const step = { id, title: "New step", text: "", placement: "PreferredBottomOrFlip", before: [], meta: { source: "manual", unresolved: false } };
		const at = afterId ? doc.steps.findIndex((s) => s.id === afterId) + 1 : doc.steps.length;
		const steps = doc.steps.slice();
		steps.splice(at, 0, step);
		return { doc: Object.assign({}, doc, { steps }), id };
	}

	function duplicateStep(doc, id) {
		const index = doc.steps.findIndex((s) => s.id === id);
		if (index < 0) return { doc, id };
		const copyId = uniqueStepId(doc);
		const copy = structuredClone(doc.steps[index]);
		copy.id = copyId;
		copy.title = copy.title + " (copy)";
		copy.meta = Object.assign({}, copy.meta, { source: "manual", unresolved: (copy.meta && copy.meta.unresolved) || false });
		const steps = doc.steps.slice();
		steps.splice(index + 1, 0, copy);
		return { doc: Object.assign({}, doc, { steps }), id: copyId };
	}

	/** Deletes a step; a tour always keeps at least one. Returns the id to select next. */
	function deleteStep(doc, id) {
		const index = doc.steps.findIndex((s) => s.id === id);
		if (index < 0 || doc.steps.length <= 1) return { doc, selectId: id };
		const steps = doc.steps.filter((s) => s.id !== id);
		return { doc: Object.assign({}, doc, { steps }), selectId: steps[Math.min(index, steps.length - 1)].id };
	}

	/** Points a step at a control (or at nothing); a manual choice clears the "needs review" flag. */
	function setTarget(doc, id, target) {
		const step = doc.steps.find((s) => s.id === id);
		if (!step) return doc;
		const meta = Object.assign({}, step.meta, { unresolved: false });
		delete meta.note;
		if (target) meta.confidence = 1;
		return updateStep(doc, id, { target, meta });
	}

	/** "PreferredTopOrFlip" -> { side: "Top", flip: true }; "Vertical"/"Horizontal" have no single side. */
	function parsePlacement(placement) {
		const m = /^Preferred(Top|Bottom|Left|Right)OrFlip$/.exec(placement);
		if (m) return { side: m[1], flip: true };
		if (SIDES.includes(placement)) return { side: placement, flip: false };
		return { side: null, flip: false };
	}

	const buildPlacement = (side, flip) => (flip ? "Preferred" + side + "OrFlip" : side);

	// ---- undo / redo: rapid edits with the same key (typing in one field) are one undo step ----

	const LIMIT = 100;
	const COALESCE_MS = 1000;

	const History = {
		create: (present) => ({ past: [], present, future: [], lastKey: null, lastAt: 0 }),
		push(h, next, key) {
			if (next === h.present) return h;
			const now = Date.now();
			const k = key === undefined ? null : key;
			const merge = k !== null && k === h.lastKey && now - h.lastAt < COALESCE_MS && h.past.length > 0;
			return { past: merge ? h.past : h.past.concat([h.present]).slice(-LIMIT), present: next, future: [], lastKey: k, lastAt: now };
		},
		undo(h) {
			if (!h.past.length) return h;
			return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present].concat(h.future), lastKey: null, lastAt: 0 };
		},
		redo(h) {
			if (!h.future.length) return h;
			return { past: h.past.concat([h.present]), present: h.future[0], future: h.future.slice(1), lastKey: null, lastAt: 0 };
		},
		canUndo: (h) => h.past.length > 0,
		canRedo: (h) => h.future.length > 0
	};

	return { SIDES, uniqueStepId, updateStep, moveStep, addStep, duplicateStep, deleteStep, setTarget, parsePlacement, buildPlacement, History };
});
