sap.ui.define([], function () {
	"use strict";

	// The calls of the QuickTest service (/odata/v4/qtest). Projects are created and deleted through the QuickDev service
	// (/odata/v4/tour): a project is the same thing in all QuickDev apps. Recordings, app files and the browser extension
	// pairing are that service's too, so what is recorded or uploaded here shows up there and the other way round.
	const Q = "/odata/v4/qtest";
	const T = "/odata/v4/tour";

	/** An error with the message the server sent (already meant for end users). */
	class ApiError extends Error {
		constructor(message, status) {
			super(message);
			this.status = status;
		}
	}

	async function request(url, init) {
		let res;
		try {
			res = await fetch(url, init);
		} catch (e) {
			throw new ApiError("The QuickDev server is not reachable. Is it running?", 0);
		}
		if (!res.ok) {
			let message = res.status + " " + res.statusText;
			try {
				const j = await res.json();
				message = (j && ((j.error && j.error.message) || j.error)) || message;
			} catch (e) {
				/* keep the status text */
			}
			throw new ApiError(typeof message === "string" ? message : JSON.stringify(message), res.status);
		}
		return res;
	}

	async function call(base, method, path, body) {
		const res = await request(base + path, {
			method,
			headers: body !== undefined ? { "content-type": "application/json" } : undefined,
			body: body !== undefined ? JSON.stringify(body) : undefined
		});
		return res.status === 204 ? undefined : res.json();
	}

	/** A function that answers JSON in a string. */
	const fn = async (path) => {
		const r = await call(Q, "GET", "/" + path);
		return r && r.value ? JSON.parse(r.value) : null;
	};
	/** An action that answers JSON in a string. */
	const act = async (name, body) => {
		const r = await call(Q, "POST", "/" + name, body);
		return r && r.value ? JSON.parse(r.value) : r;
	};
	const list = async (base, path) => (await call(base, "GET", path)).value;
	const id = (v) => encodeURIComponent(v);

	return {
		ApiError,
		Q,
		providers: () => list(Q, "/providers()"),
		meta: () => fn("qtestMeta()"),

		// projects (QuickDev service)
		overview: () => fn("overview()"),
		project: (pid) => call(T, "GET", "/Projects(" + id(pid) + ")"),
		createProject: (name, description) => call(T, "POST", "/Projects", { name, description }),
		deleteProject: (pid) => call(T, "DELETE", "/Projects(" + id(pid) + ")"),
		projects: () => list(T, "/Projects?$orderby=createdAt desc"),

		dashboard: (pid) => fn("dashboard(projectID=" + id(pid) + ")"),

		// requirements
		requirements: (pid) => fn("listRequirements(projectID=" + id(pid) + ")"),
		requirement: (rid) => fn("getRequirement(ID=" + id(rid) + ")"),
		saveRequirement: (projectID, ID, data) => act("saveRequirement", { projectID, ID: ID || null, data: JSON.stringify(data) }),
		deleteRequirement: (ID) => act("deleteRequirement", { ID }),

		// test cases
		cases: (pid) => fn("listCases(projectID=" + id(pid) + ")"),
		testCase: (cid) => fn("getCase(ID=" + id(cid) + ")"),
		saveCase: (projectID, ID, data, note) => act("saveCase", { projectID, ID: ID || null, data: JSON.stringify(data), note }),
		deleteCase: (ID) => act("deleteCase", { ID }),
		duplicateCase: (ID) => act("duplicateCase", { ID }),
		caseVersions: (cid) => fn("caseVersions(caseID=" + id(cid) + ")"),
		caseVersion: (cid, version) => fn("getCaseVersion(caseID=" + id(cid) + ",version=" + version + ")"),
		restoreCaseVersion: (caseID, version) => act("restoreCaseVersion", { caseID, version }),
		bulk: (projectID, entity, ids, patch) => act("bulk", { projectID, entity, ids, patch: JSON.stringify(patch) }),
		bulkDelete: (projectID, entity, ids) => act("bulkDelete", { projectID, entity, ids }),
		setCoverage: (requirementID, caseID, linked) => act("setCoverage", { requirementID, caseID, linked }),
		linkCases: (requirementID, caseIDs) => act("linkCases", { requirementID, caseIDs }),
		matrix: (pid) => fn("matrix(projectID=" + id(pid) + ")"),
		saveBatch: (projectID, payload) => act("saveBatch", { projectID, payload: JSON.stringify(payload) }),
		importBook: (args) => act("importBook", args),

		// runs
		runs: (pid) => fn("listRuns(projectID=" + id(pid) + ")"),
		run: (rid) => fn("getRun(runID=" + id(rid) + ")"),
		runItem: (iid) => fn("getRunItem(itemID=" + id(iid) + ")"),
		createRun: (args) => act("createRun", Object.assign({}, args, { filter: args.filter ? JSON.stringify(args.filter) : undefined })),
		updateRun: (args) => act("updateRun", args),
		closeRun: (runID, reopen) => act("closeRun", { runID, reopen: !!reopen }),
		deleteRun: (runID) => act("deleteRun", { runID }),
		addRunCases: (runID, caseIDs) => act("addRunCases", { runID, caseIDs }),
		removeRunItems: (runID, itemIDs) => act("removeRunItems", { runID, itemIDs }),
		recordResult: (args) => act("recordResult", Object.assign({}, args, { steps: args.steps ? JSON.stringify(args.steps) : undefined })),
		importResults: (args) => act("importResults", args),

		// automation (wdi5)
		automation: (cid) => fn("getAutomation(caseID=" + id(cid) + ")"),
		automationCode: (cid) => fn("automationCode(caseID=" + id(cid) + ")"),
		caseFromRecording: (args) => act("caseFromRecording", Object.assign({}, args, { settings: args.settings ? JSON.stringify(args.settings) : undefined })),
		attachRecording: (args) => act("attachRecording", Object.assign({}, args, { settings: args.settings ? JSON.stringify(args.settings) : undefined })),
		automateCase: (args) => act("automateCase", Object.assign({}, args, { settings: args.settings ? JSON.stringify(args.settings) : undefined })),
		automationSettings: (caseID, settings) => act("automationSettings", { caseID, settings: JSON.stringify(settings) }),
		detachAutomation: (caseID) => act("detachAutomation", { caseID }),
		// writing the wdi5 files into the project's workspace is the QuickDev service's (the same dialog of the designer reviews them)
		applyTestToProject: (planID, accept) => call(T, "POST", "/applyTestToProject", { planID, paths: undefined, accept: !!accept }),

		// AI (proposals only)
		aiRequirements: (args) => act("aiRequirements", args),
		aiCases: (args) => act("aiCases", args),
		testProvider: (provider) => act("testProvider", { provider }),
		aiImprove: (args) => act("aiImprove", Object.assign({}, args, { draft: JSON.stringify(args.draft) })),

		// shared with the other QuickDev apps (QuickDev service)
		recordings: (pid) => list(T, "/Recordings?$filter=project_ID eq " + id(pid) + "&$orderby=createdAt desc"),
		importRecording: (projectID, name, raw) => call(T, "POST", "/importRecording", { projectID, name, raw, format: null, purpose: "test" }),
		importSources: (projectID, files, replace) => call(T, "POST", "/importSources", { projectID, files, replace }),
		countFiles: async (pid) => (await call(T, "GET", "/Sources?$filter=project_ID eq " + id(pid) + " and deleted eq false&$select=ID&$top=1&$count=true"))["@odata.count"] || 0,
		extensionTokens: () => list(T, "/ExtensionTokens?$orderby=createdAt desc"),
		createExtensionToken: (name) => call(T, "POST", "/createExtensionToken", { name }),
		revokeExtensionToken: (ID) => call(T, "POST", "/revokeExtensionToken", { ID }),

		// downloads are plain links
		url: {
			book: (pid, what) => "/qtest/project/" + pid + "/" + what,
			wdi5: (pid, caseIDs) => "/qtest/project/" + pid + "/wdi5.zip" + (caseIDs && caseIDs.length ? "?cases=" + caseIDs.join(",") : ""),
			report: (rid, what) => "/qtest/run/" + rid + "/" + what,
			template: "/qtest/template.xlsx"
		}
	};
});
