sap.ui.define(
	["tourd/designer/controller/BaseController", "tourd/designer/util/Format", "sap/ui/model/json/JSONModel"],
	function (BaseController, Format, JSONModel) {
		"use strict";

		const FORMATS = [
			{ value: "auto", label: "Detect automatically" },
			{ value: "tourd-recorder", label: "QuickDev recorder (JSON)" },
			{ value: "devtools-recorder", label: "Chrome DevTools Recorder (JSON)" },
			{ value: "ui5-test-recorder", label: "UI5 Test Recorder (OPA5 / wdi5 snippets)" },
			{ value: "plain-text", label: "Plain text (one step per line)" }
		];
		const PURPOSES = ["both", "tour", "test"].map((key) => ({ key, label: Format.PURPOSE[key] }));

		/** A recording written by the QuickDev extension says what it is for; other files do not. */
		const purposeInFile = (raw) => {
			try {
				const p = JSON.parse(raw).purpose;
				return p === "tour" || p === "test" || p === "both" ? p : null;
			} catch (e) {
				return null;
			}
		};

		const summaryOf = (r) => {
			try {
				return r.summary ? JSON.parse(r.summary) : null;
			} catch (e) {
				return null;
			}
		};

		const shortName = (name) => (name || "").split(".").slice(-1)[0];

		return BaseController.extend("tourd.designer.controller.tab.Recordings", {
			onInit() {
				this.initViewModel({
					formats: FORMATS,
					purposes: PURPOSES,
					name: "",
					format: "auto",
					raw: "",
					purpose: "both",
					filter: "all",
					all: [],
					shown: [],
					loading: false,
					importing: false,
					empty: false,
					error: "",
					resultText: "",
					resultType: "Success"
				});
				this._load();
			},

			_project() {
				return this.appModel().getProperty("/project");
			},

			async _load() {
				const project = this._project();
				const model = this.viewModel();
				model.setProperty("/empty", project.parseStatus === "empty");
				const rows = await this.attempt(() => this.getApi().recordings(project.ID), "/loading");
				if (!rows) return;
				model.setProperty(
					"/all",
					rows.map((r) => {
						const s = summaryOf(r);
						return Object.assign({}, r, {
							purposeKey: Format.purposeOf(r),
							formatText: Format.formatLabel(r.format),
							matchedText: s ? s.mapped + " of " + s.actionable : "–",
							matchedState: s ? (s.unmapped ? "Warning" : "Success") : "None",
							createdText: Format.date(r.createdAt)
						});
					})
				);
				this._applyFilter();
			},

			_applyFilter() {
				const model = this.viewModel();
				const filter = model.getProperty("/filter");
				model.setProperty(
					"/shown",
					model.getProperty("/all").filter((r) => filter === "all" || r.purposeKey === "both" || r.purposeKey === filter)
				);
			},

			onFilter() {
				this._applyFilter();
			},

			// pasting or loading a file from the extension: what it says it is for is already chosen
			onRawChange(e) {
				const inFile = purposeInFile(e.getParameter("value"));
				if (inFile) this.viewModel().setProperty("/purpose", inFile);
			},

			onLoadFile() {
				const input = document.createElement("input");
				input.type = "file";
				input.accept = ".json,.js,.txt,text/plain,application/json";
				input.onchange = async () => {
					const file = input.files && input.files[0];
					if (!file) return;
					const model = this.viewModel();
					const text = await file.text();
					model.setProperty("/raw", text);
					const inFile = purposeInFile(text);
					if (inFile) model.setProperty("/purpose", inFile);
					if (!model.getProperty("/name")) model.setProperty("/name", file.name.replace(/\.[^.]+$/, ""));
				};
				input.click();
			},

			async onImport() {
				const model = this.viewModel();
				const project = this._project();
				const format = model.getProperty("/format");
				const result = await this.attempt(
					() => this.getApi().importRecording(project.ID, model.getProperty("/name").trim(), model.getProperty("/raw"), format === "auto" ? "" : format, model.getProperty("/purpose")),
					"/importing"
				);
				if (!result) return;
				const purpose = Format.purposeOf(result);
				model.setProperty("/resultType", result.unmapped ? "Warning" : "Success");
				model.setProperty(
					"/resultText",
					this.text("recImportedMsg", [Format.formatLabel(result.format), result.steps, result.mapped, result.actionable]) +
						(result.unmapped ? this.text("recUnmapped", [result.unmapped]) : "") +
						this.text("recMadeFor", [Format.purposeLabel(purpose).toLowerCase()])
				);
				model.setProperty("/raw", "");
				model.setProperty("/name", "");
				await this._load();
				this.getBus().publish("tourd", "changed", { what: "recordings" });
			},

			async onRelabel(e) {
				const row = e.getSource().getBindingContext("view").getObject();
				const purpose = e.getSource().getSelectedKey();
				await this.attempt(() => this.getApi().setRecordingPurpose(row.ID, purpose));
				await this._load();
			},

			async onDelete(e) {
				const row = e.getSource().getBindingContext("view").getObject();
				await this.attempt(async () => {
					await this.getApi().deleteRecording(row.ID);
					await this._load();
					this.getBus().publish("tourd", "changed", { what: "recordings" });
				});
			},

			// ---- how the steps were matched ----

			async onDetails(e) {
				const row = e.getSource().getBindingContext("view").getObject();
				const dialog = await this.dialog("RecordingDetailsDialog");
				const model = new JSONModel({ title: this.text("recStepsOf", [row.name]), steps: [], loading: true, error: "" });
				dialog.setModel(model, "det");
				dialog.open();
				try {
					const mapped = await this.getApi().mappedRecording(row.ID);
					model.setProperty(
						"/steps",
						(mapped.steps || []).filter((s) => s.action !== "key").map((s) => this._stepRow(s))
					);
				} catch (err) {
					model.setProperty("/error", this.errorMessage(err));
				} finally {
					model.setProperty("/loading", false);
				}
			},

			_stepRow(s) {
				const u = s.ui5;
				const plain = !u && (s.action === "navigate" || s.action === "note");
				const notes = [
					s.submit ? "then Enter" : "",
					s.navigatesTo !== undefined ? (s.navigatesTo === "" ? "opens the start page" : 'opens "' + s.navigatesTo + '"') : "",
					s.choice ? 'chooses "' + s.choice + '"' : "",
					s.toggled !== undefined ? (s.toggled ? "switched on" : "switched off") : "",
					s.redacted ? "value left out (secret)" : s.value !== undefined ? "with a value" : ""
				]
					.filter(Boolean)
					.join(", ");
				return {
					index: s.index,
					action: s.action,
					matched: !!u,
					control: u ? (u.display || u.localId || "") + (u.localId ? "  " + u.localId : "  no id") : "",
					where: u ? [shortName(u.viewName), u.controllerName ? shortName(u.controllerName) : "", u.handler ? u.handler + "()" : ""].filter(Boolean).join(" · ") : "",
					isPlain: plain,
					plain: plain ? s.text || s.hash || "" : "",
					notFound: !u && !plain,
					via: u ? u.via + " (" + Math.round(u.confidence * 100) + "%)" : "",
					notes
				};
			},

			onDetailsClose() {
				this.byId("recDetailsDialog").close();
			}
		});
	}
);
