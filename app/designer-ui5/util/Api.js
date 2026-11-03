sap.ui.define([], function () {
	"use strict";

	// The same calls as designer/src/api.ts, for the SAPUI5 designer.
	const BASE = "/odata/v4/tour";

	/** An error with the message the server sent (already meant for end users). */
	class ApiError extends Error {
		constructor(message, status) {
			super(message);
			this.status = status;
		}
	}

	async function request(url, init, pick) {
		let res;
		try {
			res = await fetch(url, init);
		} catch (e) {
			throw new ApiError("The QuickDev server is not reachable. Is it running?", 0);
		}
		if (!res.ok) {
			let message = res.status + " " + res.statusText;
			try {
				message = pick(await res.json()) || message;
			} catch (e) {
				/* keep the status text */
			}
			throw new ApiError(message, res.status);
		}
		return res;
	}

	async function call(method, path, body) {
		const res = await request(
			BASE + path,
			{
				method,
				headers: body !== undefined ? { "content-type": "application/json" } : undefined,
				body: body !== undefined ? JSON.stringify(body) : undefined
			},
			(j) => j && j.error && j.error.message
		);
		return res.status === 204 ? undefined : res.json();
	}

	/** Plain JSON from a route outside the OData service (/preview, /export); errors carry the server's explanation. */
	async function getJson(path) {
		const res = await request(path, undefined, (j) => j && j.error);
		return res.json();
	}

	const list = async (path) => (await call("GET", path)).value;
	const text = async (path) => (await call("GET", path)).value;
	const forProject = (entity, id, order) => list("/" + entity + "?$filter=project_ID eq " + id + "&$orderby=" + order);

	return {
		ApiError,
		providers: () => list("/providers()"),
		exportCheck: (tourID) => getJson("/export/" + tourID + "/check.json"),
		previewInfo: (projectID, controllers) => getJson("/preview/" + projectID + "/info.json?controllers=" + controllers),

		projects: () => list("/Projects?$orderby=createdAt desc"),
		project: (id) => call("GET", "/Projects(" + id + ")"),
		createProject: (name, description) => call("POST", "/Projects", { name, description }),
		deleteProject: (id) => call("DELETE", "/Projects(" + id + ")"),

		countFiles: async (projectID) =>
			(await call("GET", "/Sources?$filter=project_ID eq " + projectID + " and deleted eq false&$select=ID&$top=1&$count=true"))["@odata.count"] || 0,
		sources: (projectID) => list("/Sources?$filter=project_ID eq " + projectID + " and deleted eq false&$orderby=path"),
		deleteSource: (id) => call("DELETE", "/Sources(" + id + ")"),
		importSources: (projectID, files, replace) => call("POST", "/importSources", { projectID, files, replace }),
		inventory: async (projectID) => JSON.parse(await text("/getInventory(projectID=" + projectID + ")")),
		sourceContent: (id) => text("/getSourceContent(sourceID=" + id + ")"),

		// the workspace: read, edit, add, rename, remove and put back files
		file: (id) => call("GET", "/getFile(fileID=" + id + ")"),
		saveFile: (fileID, content, expectedHash) => call("POST", "/saveFile", { fileID, content, expectedHash }),
		createFile: (projectID, path, content = "", binary = false) => call("POST", "/createFile", { projectID, path, content, binary }),
		renameFile: (fileID, path) => call("POST", "/renameFile", { fileID, path }),
		deleteFile: (fileID) => call("POST", "/deleteFile", { fileID }),
		revertFile: (fileID) => call("POST", "/revertFile", { fileID }),
		acceptChanges: async (projectID, fileIDs = []) => (await call("POST", "/acceptChanges", { projectID, fileIDs })).value,
		changes: (projectID) => list("/getChanges(projectID=" + projectID + ")"),

		testPlans: (projectID) => forProject("TestPlans", projectID, "modifiedAt desc"),
		testPlan: (id) => call("GET", "/TestPlans(" + id + ")"),
		deleteTestPlan: (id) => call("DELETE", "/TestPlans(" + id + ")"),
		createTestPlan: (args) => call("POST", "/createTestPlan", Object.assign({}, args, { settings: JSON.stringify(args.settings) })),
		saveTestPlan: (planID, definition, baseVersion) => call("POST", "/saveTestPlan", { planID, definition, baseVersion }),
		rebuildTestPlan: (planID) => call("POST", "/rebuildTestPlan", { planID }),
		capability: (scope, id) => text("/capability(scope='" + scope + "',id=" + id + ")"),
		dryRunTestPlan: async (planID) => JSON.parse(await text("/dryRunTestPlan(planID=" + planID + ")")),
		previewTestApply: (planID) => call("POST", "/previewTestApply", { planID }),
		applyTestToProject: (planID, paths, accept = false) => call("POST", "/applyTestToProject", { planID, paths, accept }),

		helpSets: (projectID) => forProject("HelpSets", projectID, "modifiedAt desc"),
		saveHelpSet: (helpID, definition, baseVersion) => call("POST", "/saveHelpSet", { helpID, definition, baseVersion }),
		deleteHelpTopic: (helpID, topicID) => call("POST", "/deleteHelpTopic", { helpID, topicID }),
		improveHelpTopic: async (args) =>
			JSON.parse(
				(
					await call(
						"POST",
						"/improveHelpTopic",
						Object.assign({}, args, {
							topic: JSON.stringify(args.topic),
							control: args.control ? JSON.stringify(args.control) : undefined
						})
					)
				).value
			),
		previewHelpApply: (helpID) => call("POST", "/previewHelpApply", { helpID }),
		applyHelpToProject: (helpID, paths, accept = false) => call("POST", "/applyHelpToProject", { helpID, paths, accept }),
		previewTourApply: (tourID) => call("POST", "/previewTourApply", { tourID }),
		applyTourToProject: (tourID, paths, accept = false) => call("POST", "/applyTourToProject", { tourID, paths, accept }),

		recordings: (projectID) => forProject("Recordings", projectID, "createdAt desc"),
		importRecording: (projectID, name, raw, format, purpose) =>
			call("POST", "/importRecording", { projectID, name, raw, format: format || null, purpose }),
		setRecordingPurpose: (recordingID, purpose) => call("POST", "/setRecordingPurpose", { recordingID, purpose }),
		mappedRecording: async (id) => JSON.parse(await text("/getRecording(recordingID=" + id + ")")),
		deleteRecording: (id) => call("DELETE", "/Recordings(" + id + ")"),

		tours: (projectID) => forProject("Tours", projectID, "modifiedAt desc"),
		tour: (id) => call("GET", "/Tours(" + id + ")"),
		deleteTour: (id) => call("DELETE", "/Tours(" + id + ")"),
		lintTour: (id) => call("GET", "/lintTour(tourID=" + id + ")"),
		generateTour: (args) => call("POST", "/generateTour", args),
		job: (id) => call("GET", "/GenerationJobs(" + id + ")"),

		// readiness: the checklist of what the project depends on
		readinessMeta: async () => JSON.parse(await text("/readinessMeta()")),
		readinessSummary: async (projectID) => JSON.parse(await text("/readinessSummary(projectID=" + projectID + ")")),
		readinessScanReport: async (projectID) => {
			// no scan yet: the server answers 204 without a body
			const r = await call("GET", "/readinessScanReport(projectID=" + projectID + ")");
			return r && r.value ? JSON.parse(r.value) : null;
		},
		readinessItems: (projectID) => list("/ReadinessItems?$filter=project_ID eq " + projectID + "&$orderby=category,title"),
		scanReadiness: async (projectID) => JSON.parse((await call("POST", "/scanReadiness", { projectID })).value),
		checkReadiness: (args) => call("POST", "/checkReadiness", args),
		addReadinessItem: (args) => call("POST", "/addReadinessItem", args),
		removeReadinessItem: (itemID) => call("POST", "/removeReadinessItem", { itemID }),

		extensionTokens: () => list("/ExtensionTokens?$orderby=createdAt desc"),
		createExtensionToken: (name) => call("POST", "/createExtensionToken", { name }),
		revokeExtensionToken: (ID) => call("POST", "/revokeExtensionToken", { ID }),

		versions: (tourID) => list("/TourVersions?$filter=tour_ID eq " + tourID + "&$orderby=version desc"),
		saveTour: (args) => call("POST", "/saveTour", args),
		restoreVersion: (tourID, version) => call("POST", "/restoreVersion", { tourID, version }),
		refineStep: (args) => call("POST", "/refineStep", args)
	};
});
