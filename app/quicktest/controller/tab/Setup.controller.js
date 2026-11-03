sap.ui.define(["quicktest/controller/BaseController"], function (BaseController) {
	"use strict";

	// Which files of an upload are the app (the others do not make it an app that can be tested).
	const PARSED_FILE = /\.(view|fragment)\.xml$|\.controller\.(js|ts)$|(^|\/)manifest\.json$|(^|\/)i18n[^/]*\.properties$/i;

	// The reading of a folder or a zip (what to leave out: node_modules, binaries, huge files; how to cut the upload into
	// parts) is the QuickDev designer's, so the same app uploads the same way in both. Loaded only when somebody uploads.
	let lib;
	const intake = () => (lib = lib || import(new URL("/designer-ui5/lib/codemirror.js", document.baseURI).href));

	return BaseController.extend("quicktest.controller.tab.Setup", {
		onInit() {
			this.initViewModel({ files: 0, appText: "", outcome: "", skipped: [], importing: false, error: "", designerUrl: "", providers: [] });
			this._projectId = (this.appModel().getProperty("/project") || {}).ID;
			this.viewModel().setProperty("/designerUrl", "/designer-ui5/index.html#/projects/" + this._projectId + "?tab=sources");
			this._providers();
			this.appModel().bindProperty("/providers").attachChange(() => this._providers());
			this._load();
		},

		async _load() {
			const files = await this.attempt(() => this.getApi().countFiles(this._projectId));
			if (files === undefined) return;
			const project = this.appModel().getProperty("/project") || {};
			this.viewModel().setProperty("/files", files);
			this.viewModel().setProperty("/appText", files ? this.text("setupAppOk", [files, project.appId || "?"]) : this.text("setupAppNone"));
		},

		_pick(configure, read, replace) {
			const input = document.createElement("input");
			input.type = "file";
			configure(input);
			input.onchange = async () => {
				const model = this.viewModel();
				model.setProperty("/error", "");
				model.setProperty("/outcome", "");
				model.setProperty("/skipped", []);
				try {
					await this._upload(await read(await intake(), input), replace);
				} catch (e) {
					this.fail(e);
				}
			};
			input.click();
		},

		onPickFolder() {
			this._pick((i) => ((i.multiple = true), (i.webkitdirectory = true)), (l, i) => l.readFiles(i.files), true);
		},

		onPickZip() {
			this._pick((i) => (i.accept = ".zip,application/zip"), async (l, i) => l.readZip(new Uint8Array(await i.files[0].arrayBuffer())), true);
		},

		onPickFiles() {
			this._pick((i) => (i.multiple = true), (l, i) => l.readFiles(i.files), false);
		},

		/** A folder or a zip is a full snapshot of the app (replace); loose files are added or updated. */
		async _upload(read, replace) {
			const model = this.viewModel();
			model.setProperty("/importing", true);
			try {
				if (!read.files.length) throw new Error(this.text("setupNoFiles"));
				if (!read.files.some((f) => PARSED_FILE.test(f.path))) throw new Error(this.text("setupNoAppFiles"));
				const l = await intake();
				let result;
				let imported = 0;
				const chunks = l.chunkFiles(read.files);
				for (let i = 0; i < chunks.length; i++) {
					result = await this.getApi().importSources(this._projectId, chunks[i], replace && i === 0);
					imported += result.imported;
				}
				model.setProperty("/outcome", this.text("setupImported", [imported, result.appId || "?", result.views, result.controls]));
				const left = (read.skipped || []).concat((result.skipped || []).filter((s) => !s.expected));
				model.setProperty("/skipped", left.map((s) => ({ text: s.path + ": " + s.reason })));
				this.getBus().publish("qt", "projectChanged");
				await this._load();
			} catch (e) {
				this.fail(e);
			} finally {
				model.setProperty("/importing", false);
			}
		},

		/** One row per AI provider the server knows: ready or not, with the lines to put into .env when it is not. */
		_providers() {
			const t = this.text.bind(this);
			const rows = (this.appModel().getProperty("/providers") || []).map((p) => ({
				id: p.id,
				label: p.label,
				configured: p.configured || p.id === "rules",
				detail: p.id === "rules" ? t("setupRulesDetail") : p.model ? t("setupModel", [p.model]) : t("setupNoModel"),
				statusText: p.id === "rules" || p.configured ? t("setupReady") : t("notSetUp"),
				statusState: p.id === "rules" || p.configured ? "Success" : "Warning",
				hint: p.id === "gemini" ? t("hintGemini") : p.id === "sap-ai-core" ? t("hintAiCore") : "",
				result: "",
				resultType: "Information",
				testing: false
			}));
			this.viewModel().setProperty("/providers", rows);
		},

		async onTestProvider(e) {
			const ctx = e.getSource().getBindingContext("view");
			const path = ctx.getPath();
			const model = this.viewModel();
			model.setProperty(path + "/testing", true);
			model.setProperty(path + "/result", this.text("setupTesting"));
			model.setProperty(path + "/resultType", "Information");
			try {
				const out = await this.getApi().testProvider(ctx.getProperty("id"));
				model.setProperty(path + "/result", out.ok ? this.text("setupTestOk", [out.model || "", out.ms]) : out.message);
				model.setProperty(path + "/resultType", out.ok ? "Success" : "Error");
			} catch (err) {
				model.setProperty(path + "/result", this.errorMessage(err));
				model.setProperty(path + "/resultType", "Error");
			} finally {
				model.setProperty(path + "/testing", false);
			}
		},

		onRecorder() {
			this.getOwnerComponent().getRootControl().getController().onExtension();
		}
	});
});
