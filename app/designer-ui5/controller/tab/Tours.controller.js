sap.ui.define(
	["tourd/designer/controller/BaseController", "tourd/designer/util/Format", "sap/ui/model/json/JSONModel"],
	function (BaseController, Format, JSONModel) {
		"use strict";

		const STAGES = [
			["context", "Reading your files and the recording"],
			["generate", "Generating the tour"],
			["repair", "Fixing problems the checks found"],
			["validate", "Checking the result"],
			["save", "Saving the tour"]
		];
		const LAST_PROVIDER = "tourd.lastProvider";

		const remembered = () => {
			try {
				return localStorage.getItem(LAST_PROVIDER);
			} catch (e) {
				return null;
			}
		};

		return BaseController.extend("tourd.designer.controller.tab.Tours", {
			onInit() {
				this.initViewModel({ tours: [], recordings: [], loading: false, noRecording: false, error: "" });
				this._load();
			},

			_project() {
				return this.appModel().getProperty("/project");
			},

			async _load() {
				const model = this.viewModel();
				const id = this._project().ID;
				const result = await this.attempt(() => Promise.all([this.getApi().tours(id), this.getApi().recordings(id)]), "/loading");
				if (!result) return;
				const [tours, recordings] = result;
				model.setProperty("/recordings", recordings);
				model.setProperty("/noRecording", recordings.length === 0);
				model.setProperty(
					"/tours",
					tours.map((t) =>
						Object.assign({}, t, {
							generatorState: Format.GENERATOR_STATE[t.generator] || "None",
							changedText: Format.date(t.modifiedAt),
							checksText: "…",
							checksState: "None"
						})
					)
				);
				// the checks of each tour come one by one
				tours.forEach(async (t, i) => {
					try {
						const lint = await this.getApi().lintTour(t.ID);
						const row = model.getProperty("/tours/" + i);
						if (!row || row.ID !== t.ID) return;
						const text = lint.errors + lint.warnings === 0 ? "no problems" : [lint.errors ? lint.errors + " error(s)" : "", lint.warnings ? lint.warnings + " warning(s)" : ""].filter(Boolean).join(", ");
						model.setProperty("/tours/" + i + "/checksText", text);
						model.setProperty("/tours/" + i + "/checksState", lint.errors ? "Error" : lint.warnings ? "Warning" : "None");
					} catch (e) {
						/* the column stays empty */
					}
				});
			},

			onNeedRecording() {
				this.getRouter().navTo("project", { id: this._project().ID, "?query": { tab: "recordings" } }, true);
			},

			onOpen(e) {
				const tour = e.getSource().getBindingContext("view").getObject();
				this.getRouter().navTo("tour", { id: tour.ID });
			},

			async onDelete(e) {
				const tour = e.getSource().getBindingContext("view").getObject();
				if (!(await this.confirm(this.text("toursDeleteText", [tour.name]), this.text("toursDelete"), this.text("delete")))) return;
				await this.attempt(async () => {
					await this.getApi().deleteTour(tour.ID);
					await this._load();
					this.getBus().publish("tourd", "changed", { what: "tours" });
				});
			},

			// ---- generate a tour ----

			async onGenerate() {
				const dialog = await this.dialog("GenerateDialog");
				const model = new JSONModel({
					showAll: false,
					recordingID: "",
					recordings: [],
					hidden: 0,
					noneFit: false,
					providers: [],
					provider: remembered() || "rules",
					model: "",
					modelHint: "model name",
					title: "",
					isAi: false,
					usable: false,
					privacy: "",
					jobID: "",
					starting: false,
					stages: [],
					jobError: "",
					jobDone: "",
					jobDoneType: "Success",
					error: ""
				});
				dialog.setModel(model, "gen");
				this._fillRecordings(model, false);
				dialog.open();
				try {
					model.setProperty("/providers", await this.getApi().providers());
					this._providerChanged(model);
				} catch (e) {
					model.setProperty("/error", this.errorMessage(e));
				}
			},

			_fillRecordings(model, showAll) {
				const { shown, hidden, noneFit } = Format.recordingsFor(this.viewModel().getProperty("/recordings"), "tour", showAll);
				model.setProperty("/showAll", showAll);
				model.setProperty("/hidden", showAll ? 0 : hidden);
				model.setProperty("/noneFit", noneFit);
				model.setProperty(
					"/recordings",
					shown.map((r) => ({ ID: r.ID, text: showAll || noneFit ? r.name + " (" + Format.purposeLabel(Format.purposeOf(r)).toLowerCase() + ")" : r.name }))
				);
				const cur = model.getProperty("/recordingID");
				if (!shown.some((r) => r.ID === cur)) model.setProperty("/recordingID", shown[0] ? shown[0].ID : "");
				model.setProperty("/hiddenText", this.text("genShowAll", [hidden]));
			},

			onGenShowAll() {
				this._fillRecordings(this.byId("generateDialog").getModel("gen"), true);
			},

			onGenProvider() {
				this._providerChanged(this.byId("generateDialog").getModel("gen"));
			},

			_providerChanged(model) {
				const id = model.getProperty("/provider");
				const infos = model.getProperty("/providers");
				const info = infos.find((p) => p.id === id);
				model.setProperty(
					"/providers",
					infos.map((p) => Object.assign({}, p, { text: p.label + (p.configured ? "" : " (not configured on the server)") }))
				);
				model.setProperty("/usable", !!(info && info.configured));
				model.setProperty("/isAi", id !== "rules");
				model.setProperty("/modelHint", info && info.model ? "default: " + info.model : "model name");
				model.setProperty(
					"/privacy",
					this.text("genPrivacy", [info ? info.label : "the provider"]) +
						" " +
						(info && info.redaction === false ? this.text("genRedactionOff") : this.text("genRedactionOn"))
				);
			},

			async onGenStart() {
				const model = this.byId("generateDialog").getModel("gen");
				model.setProperty("/error", "");
				model.setProperty("/starting", true);
				try {
					const provider = model.getProperty("/provider");
					const job = await this.getApi().generateTour({
						projectID: this._project().ID,
						recordingID: model.getProperty("/recordingID"),
						provider,
						model: (model.getProperty("/model") || "").trim(),
						title: (model.getProperty("/title") || "").trim()
					});
					try {
						localStorage.setItem(LAST_PROVIDER, provider);
					} catch (e) {
						/* remembering the choice is a convenience only */
					}
					model.setProperty("/jobID", job.ID);
					this._poll(model, job.ID);
				} catch (e) {
					model.setProperty("/error", this.errorMessage(e));
				} finally {
					model.setProperty("/starting", false);
				}
			},

			async _poll(model, jobID) {
				for (;;) {
					if (model.getProperty("/jobID") !== jobID) return; // the dialog was closed
					let job;
					try {
						job = await this.getApi().job(jobID);
					} catch (e) {
						model.setProperty("/error", this.errorMessage(e));
						return;
					}
					this._showJob(model, job);
					if (job.status === "done" || job.status === "failed") {
						if (job.status === "done" && job.tour_ID) {
							this._closeGenerate();
							await this._load();
							this.getBus().publish("tourd", "changed", { what: "tours" });
							this.getRouter().navTo("tour", { id: job.tour_ID });
						}
						return;
					}
					await new Promise((r) => setTimeout(r, 500));
				}
			},

			_showJob(model, job) {
				const report = job.report ? JSON.parse(job.report) : null;
				const current = job.status === "done" ? STAGES.length : Math.max(0, STAGES.findIndex(([id]) => id === job.stage));
				const showRepair = (report && report.repairs > 0) || job.stage === "repair";
				const stages = STAGES.map(([id, label], i) => ({ id, label, i }))
					.filter((s) => s.id !== "repair" || showRepair)
					.map((s) => {
						const failed = job.status === "failed" && s.i === current;
						const done = s.i < current;
						return { label: s.label, icon: failed ? "sap-icon://error" : done ? "sap-icon://accept" : s.i === current ? "sap-icon://synchronize" : "sap-icon://circle-task", state: failed ? "Error" : done ? "Success" : s.i === current ? "Information" : "None" };
					});
				model.setProperty("/stages", stages);
				model.setProperty("/jobError", job.status === "failed" ? job.error || this.text("genFailed") : "");
				if (job.status === "done" && report)
					model.setProperty(
						"/jobDone",
						this.text("genDone", [report.steps]) +
							(report.repairs ? this.text("genRepairs", [report.repairs]) : "") +
							(report.unresolved ? this.text("genUnresolved", [report.unresolved]) : "")
					);
			},

			_closeGenerate() {
				const dialog = this.byId("generateDialog");
				dialog.getModel("gen").setProperty("/jobID", "");
				dialog.close();
			},

			onGenClose() {
				this._closeGenerate();
				this._load();
			}
		});
	}
);
