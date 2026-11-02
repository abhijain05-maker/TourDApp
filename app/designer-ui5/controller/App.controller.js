sap.ui.define(
	["tourd/designer/controller/BaseController", "tourd/designer/util/Theme", "tourd/designer/util/Format", "sap/ui/Device", "sap/ui/model/json/JSONModel"],
	function (BaseController, Theme, Format, Device, JSONModel) {
		"use strict";

		return BaseController.extend("tourd.designer.controller.App", {
			onInit() {
				// the side navigation marks the open project
				this.getRouter().attachRouteMatched((e) => {
					const id = e.getParameter("arguments").id;
					this.appModel().setProperty("/navKey", e.getParameter("name") === "project" ? id : "projects");
				});
				this.getBus().subscribe("tourd", "palette", () => this.onPaletteOpen());
				// Ctrl+K / Cmd+K from anywhere
				this._onKey = (e) => {
					if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
						e.preventDefault();
						this.onPalette();
					}
				};
				window.addEventListener("keydown", this._onKey);
				// narrow windows start with the slim navigation
				Device.media.attachHandler(
					(p) => {
						if (p.from < 1180) this.appModel().setProperty("/navExpanded", false);
					},
					null,
					Device.media.RANGESETS.SAP_STANDARD_EXTENDED
				);
			},

			onExit() {
				window.removeEventListener("keydown", this._onKey);
			},

			onToggleNav() {
				const model = this.appModel();
				model.setProperty("/navExpanded", !model.getProperty("/navExpanded"));
			},

			onNavSelect(e) {
				const key = e.getParameter("item").getKey();
				if (key === "projects") this.getRouter().navTo("projects");
				else if (key) this.getRouter().navTo("project", { id: key });
			},

			onTheme() {
				const next = Theme.next();
				Theme.set(next);
				const model = this.appModel();
				model.setProperty("/theme", Theme.isDark() ? "dark" : "light");
				model.setProperty("/themeText", Theme.label(next));
			},

			// ---- the browser extension dialog ----

			async onExtension() {
				const dialog = await this.dialog("ExtensionDialog");
				if (!dialog.getModel("ext")) {
					dialog.setModel(
						new JSONModel({
							name: "",
							tokens: [],
							created: null,
							copied: "",
							snippet: "",
							addressCopied: "",
							error: "",
							origin: window.location.origin,
							steps: [1, 2, 3].map((n) => ({ n, html: this.text("extStep" + n) }))
						}),
						"ext"
					);
				}
				await this._loadTokens(dialog);
				dialog.open();
			},

			async _loadTokens(dialog) {
				const model = dialog.getModel("ext");
				try {
					const rows = await this.getApi().extensionTokens();
					model.setProperty(
						"/tokens",
						rows.map((t) => Object.assign({}, t, { createdText: Format.date(t.createdAt), createdAgo: Format.ago(t.createdAt), lastUsedText: t.lastUsedAt ? Format.date(t.lastUsedAt) : this.text("never"), lastUsedAgo: t.lastUsedAt ? Format.ago(t.lastUsedAt) : "" }))
					);
					model.setProperty("/error", "");
				} catch (e) {
					model.setProperty("/error", this.errorMessage(e));
				}
			},

			async onTokenCreate() {
				const dialog = this.byId("extensionDialog");
				const model = dialog.getModel("ext");
				try {
					const row = await this.getApi().createExtensionToken(model.getProperty("/name").trim());
					model.setProperty("/created", { name: row.name, token: row.token });
					model.setProperty("/createdText", this.text("extCreatedFor", [row.name]));
					model.setProperty("/copied", "");
					model.setProperty("/name", "");
					model.setProperty("/error", "");
					await this._loadTokens(dialog);
				} catch (e) {
					model.setProperty("/error", this.errorMessage(e));
				}
			},

			async onTokenRevoke(e) {
				const dialog = this.byId("extensionDialog");
				const row = e.getSource().getBindingContext("ext").getObject();
				try {
					await this.getApi().revokeExtensionToken(row.ID);
					await this._loadTokens(dialog);
				} catch (err) {
					dialog.getModel("ext").setProperty("/error", this.errorMessage(err));
				}
			},

			async onAddressCopy() {
				const model = this.byId("extensionDialog").getModel("ext");
				try {
					await navigator.clipboard.writeText(model.getProperty("/origin"));
					model.setProperty("/addressCopied", this.text("copied"));
				} catch (e) {
					model.setProperty("/addressCopied", this.text("copyFailed"));
				}
			},

			async onTokenCopy() {
				const model = this.byId("extensionDialog").getModel("ext");
				try {
					await navigator.clipboard.writeText(model.getProperty("/created/token"));
					model.setProperty("/copied", this.text("copied"));
				} catch (e) {
					model.setProperty("/copied", this.text("copyFailed"));
				}
			},

			/** The recorder as a console snippet: the server builds it (the same text the React designer copies). */
			async onSnippetCopy() {
				const model = this.byId("extensionDialog").getModel("ext");
				try {
					const res = await fetch("/live/recorder.js");
					if (!res.ok) throw new Error(res.status + " " + res.statusText);
					await navigator.clipboard.writeText(await res.text());
					model.setProperty("/snippet", this.text("copied"));
				} catch (e) {
					model.setProperty("/snippet", this.text("copyFailed"));
				}
			},

			onExtensionClose() {
				this.byId("extensionDialog").close();
			},

			onExtensionAfterClose() {
				this.byId("extensionDialog").getModel("ext").setProperty("/created", null); // the token is not shown again once the dialog is closed
			},

			onPalette() {
				this.getBus().publish("tourd", "palette");
			},

			// ---- the command palette (Ctrl+K) ----

			/** The shell's own commands, then the ones of the screen that is shown. */
			_commands() {
				const model = this.appModel();
				const next = Theme.next();
				return [
					{ id: "go-projects", group: this.text("paletteGoTo"), title: this.text("paletteAllProjects"), run: () => this.getRouter().navTo("projects"), keywords: "home start" },
					{ id: "new-project", group: this.text("paletteActions"), title: this.text("paletteNewProject"), run: () => this.getRouter().navTo("projects", { "?query": { new: "1" } }), keywords: "create add" },
					{ id: "extension", group: this.text("paletteActions"), title: this.text("paletteExtension"), run: () => this.onExtension(), keywords: "recorder token chrome edge" },
					{ id: "theme", group: this.text("paletteActions"), title: this.text("paletteAppearance", [next]), hint: this.text("paletteNow", [Theme.choice()]), run: () => this.onTheme(), keywords: "dark light mode theme" }
				]
					.concat(
						model
							.getProperty("/projects")
							.slice(0, 30)
							.map((p) => ({ id: "project-" + p.ID, group: this.text("paletteProjects"), title: p.name, hint: p.appId || "", run: () => this.getRouter().navTo("project", { id: p.ID }), keywords: "open project" }))
					)
					.concat(this.getOwnerComponent().getCommands());
			},

			/** Every word must appear in the title, the hint, the group or the keywords; earlier hits first. */
			_search(commands, query, limit = 50) {
				const words = query.toLowerCase().split(/\s+/).filter(Boolean);
				if (!words.length) return commands.slice(0, limit);
				const scored = [];
				for (const c of commands) {
					const title = c.title.toLowerCase();
					const hay = (title + " " + (c.hint || "") + " " + c.group + " " + (c.keywords || "")).toLowerCase();
					if (!words.every((w) => hay.includes(w))) continue;
					const first = title.indexOf(words[0]);
					scored.push({ c, score: first >= 0 ? first : 1000 + hay.indexOf(words[0]) });
				}
				return scored.sort((a, b) => a.score - b.score || a.c.title.length - b.c.title.length).slice(0, limit).map((s) => s.c);
			},

			async onPaletteOpen() {
				const dialog = await this.dialog("CommandPalette");
				this._all = this._commands();
				dialog.setModel(new JSONModel({ query: "", items: [], index: 0 }), "pal");
				this._paletteFill("");
				if (!this._keyHooked) {
					this._keyHooked = true;
					dialog.attachBrowserEvent("keydown", (e) => this._paletteKey(e));
				}
				dialog.open();
			},

			onPaletteOpened() {
				this.byId("paletteInput").focus();
			},

			_paletteFill(query) {
				const model = this.byId("paletteDialog").getModel("pal");
				this._matches = this._search(this._all, query);
				model.setProperty(
					"/items",
					this._matches.map((c, i) => ({ title: c.title, hint: c.hint || "", group: c.group, selected: i === 0 }))
				);
				model.setProperty("/index", 0);
			},

			_paletteMove(delta) {
				const model = this.byId("paletteDialog").getModel("pal");
				const n = this._matches.length;
				if (!n) return;
				const index = Math.min(n - 1, Math.max(0, model.getProperty("/index") + delta));
				model.setProperty("/index", index);
				for (let i = 0; i < n; i++) model.setProperty("/items/" + i + "/selected", i === index);
				const item = this.byId("paletteList").getItems()[index];
				if (item && item.getDomRef()) item.getDomRef().scrollIntoView({ block: "nearest" });
			},

			_paletteKey(e) {
				if (e.key === "ArrowDown") (e.preventDefault(), this._paletteMove(1));
				else if (e.key === "ArrowUp") (e.preventDefault(), this._paletteMove(-1));
			},

			onPaletteSearch(e) {
				this._paletteFill(e.getParameter("newValue") !== undefined ? e.getParameter("newValue") : e.getParameter("value"));
			},

			_paletteRun(command) {
				if (!command) return;
				this.byId("paletteDialog").close();
				// after the dialog is gone, so a command that opens another dialog is not closed with it
				setTimeout(command.run, 0);
			},

			onPaletteEnter() {
				const index = this.byId("paletteDialog").getModel("pal").getProperty("/index");
				this._paletteRun(this._matches[index]);
			},

			onPalettePick(e) {
				const index = this.byId("paletteList").indexOfItem(e.getSource());
				this._paletteRun(this._matches[index]);
			},

			onPaletteClose() {
				this.byId("paletteDialog").close();
			}
		});
	}
);
