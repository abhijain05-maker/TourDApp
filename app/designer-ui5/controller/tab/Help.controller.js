sap.ui.define(
	["tourd/designer/controller/BaseController", "tourd/designer/util/Format", "tourd/designer/util/Markdown", "tourd/designer/util/ApplyDialog", "sap/ui/model/json/JSONModel"],
	function (BaseController, Format, Markdown, ApplyDialog, JSONModel) {
		"use strict";

		const parseLinks = (text) =>
			text
				.split(/\r?\n/)
				.map((line) => {
					const at = line.lastIndexOf("|");
					const url = (at >= 0 ? line.slice(at + 1) : line).trim();
					return /^https?:\/\/\S+$/i.test(url) ? { label: ((at >= 0 ? line.slice(0, at) : "").trim() || url).slice(0, 200), url } : null;
				})
				.filter(Boolean)
				.slice(0, 10);
		const formatLinks = (links) => (links || []).map((l) => l.label + " | " + l.url).join("\n");
		const where = (t) => [t.target.viewName && t.target.viewName.split(".").pop(), t.target.controlId || (t.target.fallbacks[0] && t.target.fallbacks[0].value)].filter(Boolean).join(" · ");

		return BaseController.extend("tourd.designer.controller.tab.Help", {
			onInit() {
				this.initViewModel({ topics: [], loading: false, empty: false, canAdd: false, versionText: "", error: "" });
				this._load();
			},

			_project() {
				return this.appModel().getProperty("/project");
			},

			async _load() {
				const model = this.viewModel();
				const sets = await this.attempt(() => this.getApi().helpSets(this._project().ID), "/loading");
				if (!sets) return;
				this._row = sets[0];
				let doc = null;
				try {
					doc = this._row ? JSON.parse(this._row.definition) : null;
				} catch (e) {
					doc = null;
				}
				this._doc = doc;
				const topics = (doc && doc.topics) || [];
				model.setProperty(
					"/topics",
					topics.map((t) => ({ id: t.id, title: t.title, summary: t.summary, where: where(t), controlType: (t.meta && t.meta.controlType && t.meta.controlType.split(".").pop()) || "", screen: (t.meta && t.meta.screen) || "" }))
				);
				model.setProperty("/empty", topics.length === 0);
				model.setProperty("/canAdd", !!this._row && topics.length > 0);
				model.setProperty("/versionText", this._row ? this.text("helpVersionText", [this._row.version, Format.date(this._row.modifiedAt)]) : "");
			},

			_topic(e) {
				const id = e.getSource().getBindingContext("view").getObject().id;
				return this._doc.topics.find((t) => t.id === id);
			},

			async onDelete(e) {
				const topic = this._topic(e);
				if (!(await this.confirm(this.text("helpDeleteText", [topic.title]), this.text("helpDeleteTitle"), this.text("delete")))) return;
				await this.attempt(async () => {
					await this.getApi().deleteHelpTopic(this._row.ID, topic.id);
					await this._load();
				});
			},

			onAddToProject() {
				this._apply = this._apply || new ApplyDialog(this);
				return this._apply.open({ kind: "help", id: this._row.ID, projectID: this._project().ID });
			},

			// ---- edit a topic ----

			async onEdit(e) {
				const t = this._topic(e);
				this._editing = t;
				const dialog = await this.dialog("HelpEditDialog");
				const model = new JSONModel({
					error: "",
					belongs: this.text("helpBelongs", [where(t)]),
					title: t.title,
					summary: t.summary,
					text: t.text,
					note: t.note,
					links: formatLinks(t.links),
					instruction: "",
					providers: [],
					provider: "",
					noAi: false,
					improving: false,
					canUndo: false,
					saving: false
				});
				this._before = null;
				dialog.setModel(model, "he");
				this._preview(model);
				dialog.open();
				try {
					const ai = (await this.getApi().providers()).filter((p) => p.configured && p.id !== "rules");
					model.setProperty("/providers", ai);
					model.setProperty("/provider", ai[0] ? ai[0].id : "");
					model.setProperty("/noAi", ai.length === 0);
				} catch (err) {
					model.setProperty("/error", this.errorMessage(err));
				}
			},

			_model() {
				return this.byId("helpEditDialog").getModel("he");
			},

			_preview(model) {
				model.setProperty("/previewTitle", model.getProperty("/title") || "Title");
				model.setProperty("/previewText", Markdown.toHtml(model.getProperty("/text")));
				model.setProperty("/previewNote", Markdown.toHtml(model.getProperty("/note")));
			},

			onPreview() {
				this._preview(this._model());
			},

			async onImprove() {
				const m = this._model();
				const t = this._editing;
				m.setProperty("/improving", true);
				m.setProperty("/error", "");
				try {
					const fb = t.target.fallbacks.find((f) => f.by === "text");
					const out = await this.getApi().improveHelpTopic({
						projectID: this._project().ID,
						topic: { title: m.getProperty("/title"), summary: m.getProperty("/summary"), text: m.getProperty("/text"), note: m.getProperty("/note") },
						control: { controlType: t.meta && t.meta.controlType, text: fb && fb.value, viewName: t.target.viewName, localId: t.target.controlId },
						screen: t.meta && t.meta.screen,
						instruction: (m.getProperty("/instruction") || "").trim(),
						provider: m.getProperty("/provider")
					});
					this._before = { title: m.getProperty("/title"), summary: m.getProperty("/summary"), text: m.getProperty("/text"), note: m.getProperty("/note") };
					["title", "summary", "text", "note"].forEach((k) => m.setProperty("/" + k, out[k]));
					m.setProperty("/canUndo", true);
					this._preview(m);
				} catch (e) {
					m.setProperty("/error", this.errorMessage(e));
				} finally {
					m.setProperty("/improving", false);
				}
			},

			onHelpUndo() {
				const m = this._model();
				if (!this._before) return;
				Object.keys(this._before).forEach((k) => m.setProperty("/" + k, this._before[k]));
				this._before = null;
				m.setProperty("/canUndo", false);
				this._preview(m);
			},

			async onSaveTopic() {
				const m = this._model();
				const t = this._editing;
				m.setProperty("/saving", true);
				try {
					const next = Object.assign({}, this._doc, {
						topics: this._doc.topics.map((x) =>
							x.id === t.id
								? Object.assign({}, x, { title: m.getProperty("/title").trim(), summary: (m.getProperty("/summary") || "").trim(), text: (m.getProperty("/text") || "").trim(), note: (m.getProperty("/note") || "").trim(), links: parseLinks(m.getProperty("/links") || "") })
								: x
						)
					});
					await this.getApi().saveHelpSet(this._row.ID, JSON.stringify(next), this._row.version);
					this.byId("helpEditDialog").close();
					await this._load();
				} catch (e) {
					m.setProperty("/error", this.errorMessage(e));
				} finally {
					m.setProperty("/saving", false);
				}
			},

			onEditClose() {
				this.byId("helpEditDialog").close();
			}
		});
	}
);
