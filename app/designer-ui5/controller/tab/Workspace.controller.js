sap.ui.define(
	["tourd/designer/controller/BaseController", "tourd/designer/util/Tree", "sap/ui/model/json/JSONModel"],
	function (BaseController, Tree, JSONModel) {
		"use strict";

		// CodeMirror (editor, diff) and the upload readers (folder, zip, files) come from the same bundle.
		let lib;
		const cm = () => (lib = lib || import(new URL(sap.ui.require.toUrl("tourd/designer/lib/codemirror.js"), document.baseURI).href));

		/** Kinds the parsers read: after saving one of them the controls of the app are new. */
		const PARSED = new Set(["view", "fragment", "controller", "manifest", "i18n"]);
		const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", svg: "image/svg+xml" };
		const BADGE = { added: "A", modified: "M", deleted: "D" };
		const PARSED_FILE = /\.(view|fragment)\.xml$|\.controller\.(js|ts)$|(^|\/)manifest\.json$|(^|\/)i18n[^/]*\.properties$/i;
		const LANGUAGE = { js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", ts: "TypeScript", json: "JSON", xml: "XML", html: "HTML", css: "CSS", md: "Markdown", yaml: "YAML", yml: "YAML", properties: "Properties", svg: "SVG" };

		return BaseController.extend("tourd.designer.controller.tab.Workspace", {
			onInit() {
				this._drafts = {}; // file id -> unsaved text
				this._detail = null; // the file shown (api.file)
				this._files = [];
				this.initViewModel({
					tree: [],
					treeEmpty: "",
					count: 0,
					filter: "",
					sel: { isFile: false, changed: false, id: "", path: "", dir: "" },
					changes: [],
					changeCount: 0,
					tabs: [],
					active: "",
					file: { path: "", status: "", statusText: "", language: "", loading: false, isEditable: false, isDiff: false, isBinary: false, isDeleted: false, canCompare: false, dirty: false, imageSrc: "" },
					conflict: "",
					full: false,
					saving: false,
					importing: false,
					error: "",
					outcome: "",
					skipped: [],
					inventory: { show: false, unstable: 0, warnings: [] },
					emptyText: "",
					dl: {}
				});
				this._onUnload = (e) => {
					if (Object.keys(this._drafts).length) e.preventDefault();
				};
				window.addEventListener("beforeunload", this._onUnload);
				this._onKey = (e) => {
					if (e.key === "Escape" && this.viewModel().getProperty("/full") && !document.querySelector(".sapMDialog")) this.onFull();
				};
				window.addEventListener("keydown", this._onKey);
				const base = "/export/project/" + this._project().ID;
				this.viewModel().setProperty("/dl", { changes: base + "/changes.zip", patch: base + "/changes.patch", full: base + "/full.zip" });
				this._load().then(() => this._openPending());
				// the readiness checklist asks to show the file a check was found in
				this.getBus().subscribe("tourd", "openFile", this._openPending, this);
			},

			_openPending() {
				const store = this.getOwnerComponent().readiness;
				const path = store.model.getProperty("/openFile");
				if (!path || !this._files.length) return;
				store.model.setProperty("/openFile", "");
				const file = this._files.find((f) => f.path === path);
				if (file) this._open(file);
			},

			/** The files and the workspace actions for the command palette (Ctrl+K). */
			_registerCommands() {
				const model = this.viewModel();
				const full = model.getProperty("/full");
				const active = model.getProperty("/tabs").find((t) => t.key === model.getProperty("/active"));
				const group = this.text("paletteFiles");
				const actions = this.text("paletteActions");
				const commands = this._files.slice(0, 400).map((f) => ({ id: "file-" + f.ID, group, title: Tree.fileName(f.path), hint: Tree.folderOf(f.path), run: () => this._open(f), keywords: f.path }));
				commands.push({ id: "ws-new", group: actions, title: this.text("paletteNewFile"), run: () => this.onNewFile(), keywords: "add create" });
				commands.push({ id: "ws-full", group: actions, title: full ? this.text("paletteLeaveFull") : this.text("paletteFull"), run: () => this.onFull(), keywords: "maximize expand editor" });
				if (active && active.dirty) commands.push({ id: "ws-save", group: actions, title: this.text("paletteSaveFile"), run: () => this.onSave() });
				if (active) commands.push({ id: "ws-close", group: actions, title: this.text("paletteCloseTab"), run: () => this._closeTab(active) });
				this.getOwnerComponent().registerCommands("workspace", commands);
			},

			onExit() {
				this.getBus().unsubscribe("tourd", "openFile", this._openPending, this);
				this.getOwnerComponent().unregisterCommands("workspace");
				window.removeEventListener("beforeunload", this._onUnload);
				window.removeEventListener("keydown", this._onKey);
			},

			_project() {
				return this.appModel().getProperty("/project");
			},

			// ---- the files and the changes ----

			async _load() {
				const model = this.viewModel();
				const id = this._project().ID;
				const result = await this.attempt(() => Promise.all([this.getApi().sources(id), this.getApi().changes(id)]));
				if (!result) return;
				const [files, changes] = result;
				this._files = files;
				model.setProperty("/count", files.length);
				model.setProperty("/changes", changes.map((c) => Object.assign({}, c, { badge: BADGE[c.status] || "M" })));
				model.setProperty("/changeCount", changes.length);
				model.setProperty("/emptyText", files.length ? this.text("wsOpenHint") : this.text("wsUploadHint"));
				this._renderTree();
				// tabs of files that are gone (removed, renamed) close by themselves
				const have = new Set(files.map((f) => f.ID));
				const tabs = model.getProperty("/tabs");
				const keep = tabs.filter((t) => t.type === "diff" || have.has(t.id));
				if (keep.length !== tabs.length) {
					model.setProperty("/tabs", keep);
					if (!keep.some((t) => t.key === model.getProperty("/active"))) {
						if (keep.length) this._activate(keep[keep.length - 1].key);
						else model.setProperty("/active", "");
					}
				}
				this._registerCommands();
				if (files.length) this._loadInventory();
				else model.setProperty("/inventory/show", false);
			},

			async _loadInventory() {
				const model = this.viewModel();
				try {
					const inv = await this.getApi().inventory(this._project().ID);
					const unstable = inv.controls.filter((c) => !c.hasStableId);
					model.setProperty("/inventory", {
						show: true,
						viewsText: this.text("wsViews", [inv.views.length]),
						controlsText: this.text("wsControls", [inv.controls.length]),
						unstable: unstable.length,
						unstableText: this.text("wsUnstable", [unstable.length]),
						unstableTip: unstable.map((c) => c.type + " " + (c.display || "")).join("\n"),
						warnings: inv.warnings
					});
				} catch (e) {
					model.setProperty("/inventory/show", false);
				}
			},

			_renderTree() {
				const model = this.viewModel();
				const q = model.getProperty("/filter") || "";
				const shown = Tree.filterFiles(this._files, q);
				model.setProperty("/tree", Tree.buildTree(shown));
				model.setProperty("/treeEmpty", shown.length ? "" : this._files.length ? this.text("wsNoMatch", [q]) : this.text("wsNoFiles"));
				// small projects open fully, a search shows every match, big ones only their top folders
				this.byId("fileTree").expandToLevel(q.trim() || this._files.length <= 80 ? 99 : 1);
			},

			onFilter() {
				this._renderTree();
			},

			onTreeSelect(e) {
				const node = e.getParameter("listItem").getBindingContext("view").getObject();
				const model = this.viewModel();
				model.setProperty("/sel", {
					isFile: node.type === "file",
					changed: node.type === "file" && !!node.status,
					id: node.id || "",
					path: node.path,
					dir: node.type === "dir" ? node.path : Tree.folderOf(node.path)
				});
				if (node.type === "file") this._open(node.file);
			},

			// ---- open files (tabs) ----

			_open(file, type = "file") {
				const model = this.viewModel();
				const key = type + ":" + file.ID;
				const tabs = model.getProperty("/tabs");
				if (!tabs.some((t) => t.key === key))
					model.setProperty("/tabs", tabs.concat({ key, type, id: file.ID, path: file.path, name: Tree.fileName(file.path), icon: type === "diff" ? "sap-icon://compare" : "", dirty: file.ID in this._drafts }));
				return this._activate(key);
			},

			async _activate(key) {
				const model = this.viewModel();
				const tab = model.getProperty("/tabs").find((t) => t.key === key);
				if (!tab) return;
				model.setProperty("/active", key);
				model.setProperty("/conflict", "");
				model.setProperty("/file/loading", true);
				this._selectTab(key);
				const detail = await this.attempt(() => this.getApi().file(tab.id));
				model.setProperty("/file/loading", false);
				if (!detail || model.getProperty("/active") !== key) return;
				this._detail = detail;
				const ext = Tree.extOf(tab.path);
				const isDiff = tab.type === "diff";
				const isDeleted = detail.status === "deleted";
				const isEditable = !isDiff && !isDeleted && !detail.binary;
				const text = tab.id in this._drafts ? this._drafts[tab.id] : detail.content;
				model.setProperty("/file", {
					path: tab.path,
					status: detail.status,
					statusText: Tree.STATUS_TEXT[detail.status] || detail.status,
					language: LANGUAGE[ext] || "Plain text",
					loading: false,
					isEditable,
					isDiff,
					isBinary: !isDiff && !isDeleted && !!detail.binary,
					isDeleted: !isDiff && isDeleted,
					canCompare: isEditable && detail.status !== "unchanged",
					dirty: tab.id in this._drafts,
					imageSrc: detail.binary && MIME[ext] ? "data:" + MIME[ext] + ";base64," + detail.content : ""
				});
				if (isEditable) {
					const ed = this.byId("editor");
					ed.setPath(tab.path);
					ed.setValue(text);
				}
				if (isDiff) {
					const diff = this.byId("diff");
					diff.setPath(tab.path);
					diff.setBefore(detail.base || "");
					diff.setAfter(isDeleted ? "" : detail.content);
					diff.setAfterLabel(isDeleted ? this.text("wsRemovedLabel") : this.text("wsNow"));
					diff.setBeforeLabel(this.text("wsAsUploaded"));
				}
			},

			_selectTab(key) {
				const tc = this.byId("fileTabs");
				const item = tc.getItems().find((i) => i.getBindingContext("view").getObject().key === key);
				if (!item) return void setTimeout(() => this._selectTab(key), 0); // the item is created with the next rendering
				if (tc.getSelectedItem() === item.getId()) return;
				this._silent = true; // setSelectedItem fires itemSelect too
				tc.setSelectedItem(item);
				this._silent = false;
			},

			onTabSelect(e) {
				const item = e.getParameter("item");
				const ctx = item && item.getBindingContext("view");
				if (this._silent || !ctx) return;
				const tab = ctx.getObject();
				if (tab.key !== this.viewModel().getProperty("/active")) this._activate(tab.key);
			},

			async onTabClose(e) {
				e.preventDefault();
				const tab = e.getParameter("item").getBindingContext("view").getObject();
				if (tab.type === "file" && tab.id in this._drafts) {
					const ok = await this.confirm(this.text("wsUnsavedText", [tab.name]), this.text("wsUnsaved"), this.text("wsCloseAnyway"));
					if (!ok) return;
				}
				this._closeTab(tab);
			},

			_closeTab(tab) {
				const model = this.viewModel();
				const tabs = model.getProperty("/tabs");
				const at = tabs.findIndex((t) => t.key === tab.key);
				const next = tabs.filter((t) => t.key !== tab.key);
				model.setProperty("/tabs", next);
				delete this._drafts[tab.id];
				if (model.getProperty("/active") === tab.key) {
					const target = next[Math.max(0, at - 1)] || next[0];
					if (target) this._activate(target.key);
					else model.setProperty("/active", "");
				}
			},

			// ---- editing and saving ----

			onEdit(e) {
				const value = e.getParameter("value");
				const model = this.viewModel();
				const tab = model.getProperty("/tabs").find((t) => t.key === model.getProperty("/active"));
				if (!tab || !this._detail) return;
				if (value === this._detail.content) delete this._drafts[tab.id];
				else this._drafts[tab.id] = value;
				this._syncDirty();
			},

			_syncDirty() {
				const model = this.viewModel();
				setTimeout(() => this._files && this._registerCommands(), 0);
				const tabs = model.getProperty("/tabs").map((t) => Object.assign({}, t, { dirty: t.type === "file" && t.id in this._drafts }));
				model.setProperty("/tabs", tabs);
				const tab = tabs.find((t) => t.key === model.getProperty("/active"));
				model.setProperty("/file/dirty", !!tab && tab.id in this._drafts);
			},

			onSave() {
				this._save(false);
			},

			onSaveForce() {
				this._save(true);
			},

			async _save(force) {
				const model = this.viewModel();
				const tab = model.getProperty("/tabs").find((t) => t.key === model.getProperty("/active"));
				if (!tab || tab.type !== "file" || !(tab.id in this._drafts) || model.getProperty("/saving")) return;
				model.setProperty("/saving", true);
				try {
					const info = await this.getApi().saveFile(tab.id, this._drafts[tab.id], force ? null : this._detail.hash);
					model.setProperty("/conflict", "");
					delete this._drafts[tab.id];
					await this._refresh(info.kind);
					this._syncDirty();
					await this._activate(tab.key);
				} catch (e) {
					if (e.status === 409) model.setProperty("/conflict", e.message);
					else this.fail(e);
				} finally {
					model.setProperty("/saving", false);
				}
			},

			async onDiscard() {
				const model = this.viewModel();
				const tab = model.getProperty("/tabs").find((t) => t.key === model.getProperty("/active"));
				if (tab) delete this._drafts[tab.id];
				model.setProperty("/conflict", "");
				await this._refresh();
				this._syncDirty();
				if (tab) this._activate(tab.key);
			},

			onShowDiff() {
				const model = this.viewModel();
				const tab = model.getProperty("/tabs").find((t) => t.key === model.getProperty("/active"));
				if (tab) this._open({ ID: tab.id, path: tab.path }, "diff");
			},

			/** After a change of the files: lists, tiles and (for files the parsers read) the controls of the app. */
			async _refresh(kind) {
				await this._load();
				if (kind && PARSED.has(kind)) this.getBus().publish("tourd", "projectChanged");
				this.getBus().publish("tourd", "changed", { what: "files" });
			},

			// ---- file operations ----

			async _nameDialog(settings) {
				const dialog = await this.dialog("NameDialog");
				dialog.setModel(new JSONModel(Object.assign({ error: "", busy: false }, settings)), "nm");
				dialog.open();
			},

			onNewFile() {
				const dir = this.viewModel().getProperty("/sel/dir");
				return this._nameDialog({ mode: "create", title: this.text("wsNewFile"), label: this.text("wsNewFileLabel"), confirm: this.text("create"), value: dir ? dir + "/" : "" });
			},

			onRename() {
				const sel = this.viewModel().getProperty("/sel");
				return this._nameDialog({ mode: "rename", id: sel.id, title: this.text("wsRenameTitle"), label: this.text("wsRenameLabel"), confirm: this.text("wsRename"), value: sel.path });
			},

			onNameClose() {
				this.byId("nameDialog").close();
			},

			async onNameConfirm() {
				const dialog = this.byId("nameDialog");
				const nm = dialog.getModel("nm");
				const value = (nm.getProperty("/value") || "").trim();
				if (!value || nm.getProperty("/busy")) return;
				nm.setProperty("/busy", true);
				try {
					const api = this.getApi();
					if (nm.getProperty("/mode") === "create") {
						const info = await api.createFile(this._project().ID, value, "");
						dialog.close();
						await this._refresh(info.kind);
						await this._open({ ID: info.ID, path: info.path });
					} else {
						const id = nm.getProperty("/id");
						const info = await api.renameFile(id, value);
						dialog.close();
						const model = this.viewModel();
						model.setProperty("/tabs", model.getProperty("/tabs").filter((t) => t.id !== id));
						await this._refresh(info.kind);
						await this._open({ ID: info.ID, path: info.path });
					}
				} catch (e) {
					nm.setProperty("/error", this.errorMessage(e));
				} finally {
					nm.setProperty("/busy", false);
				}
			},

			async onRemove() {
				const sel = this.viewModel().getProperty("/sel");
				if (!(await this.confirm(this.text("wsRemoveText", [sel.path]), this.text("wsRemoveTitle"), this.text("wsRemove")))) return;
				await this.attempt(async () => this._refresh((await this.getApi().deleteFile(sel.id)).kind));
			},

			onRevertSelected() {
				const sel = this.viewModel().getProperty("/sel");
				return this._revert({ ID: sel.id, path: sel.path });
			},

			onRevertChange(e) {
				return this._revert(e.getSource().getBindingContext("view").getObject());
			},

			async _revert(file) {
				if (!(await this.confirm(this.text("wsRevertText", [file.path]), this.text("wsRevertTitle"), this.text("wsPutBackButton")))) return;
				await this.attempt(async () => {
					const info = await this.getApi().revertFile(file.ID);
					delete this._drafts[file.ID];
					await this._refresh(info.kind);
					this._syncDirty();
				});
			},

			onOpenChange(e) {
				const change = e.getSource().getBindingContext("view").getObject();
				this._open(change, "diff");
			},

			onAcceptFile(e) {
				return this._accept(e.getSource().getBindingContext("view").getObject());
			},

			onAcceptAll() {
				return this._accept(null);
			},

			async _accept(file) {
				const count = this.viewModel().getProperty("/changeCount");
				const text = file ? this.text("wsAcceptFileText", [file.path]) : this.text("wsAcceptAllText", [count]);
				if (!(await this.confirm(text, file ? this.text("wsAcceptFileTitle") : this.text("wsAcceptAllTitle"), file ? this.text("wsAcceptFile") : this.text("wsAcceptAll")))) return;
				await this.attempt(async () => {
					await this.getApi().acceptChanges(this._project().ID, file ? [file.ID] : []);
					if (file) delete this._drafts[file.ID];
					else this._drafts = {};
					await this._refresh("manifest");
					this._syncDirty();
				});
			},

			/** Full screen: the workspace covers the window and the side menu is folded away; it comes back as it was afterwards. */
			onFull() {
				const model = this.viewModel();
				const full = !model.getProperty("/full");
				model.setProperty("/full", full);
				this.byId("workspace").toggleStyleClass("tourdWsFull", full);
				document.body.classList.toggle("tourdWsFullBody", full);
				const app = this.appModel();
				if (full) {
					this._navWasExpanded = app.getProperty("/navExpanded");
					app.setProperty("/navExpanded", false);
				} else if (this._navWasExpanded !== undefined) {
					app.setProperty("/navExpanded", this._navWasExpanded);
					this._navWasExpanded = undefined;
				}
			},

			// ---- upload ----

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
						const lib = await cm();
						await this._upload(await read(lib, input), replace);
					} catch (e) {
						this.fail(e);
					}
				};
				input.click();
			},

			onPickFolder() {
				this._pick(
					(i) => {
						i.multiple = true;
						i.webkitdirectory = true;
					},
					(lib, i) => lib.readFiles(i.files),
					true
				);
			},

			onPickZip() {
				this._pick(
					(i) => (i.accept = ".zip,application/zip"),
					async (lib, i) => lib.readZip(new Uint8Array(await i.files[0].arrayBuffer())),
					true
				);
			},

			onPickFiles() {
				this._pick(
					(i) => (i.multiple = true),
					(lib, i) => lib.readFiles(i.files),
					false
				);
			},

			async onPaste() {
				const dialog = await this.dialog("PasteDialog");
				dialog.setModel(new JSONModel({ path: "webapp/view/Main.view.xml", content: "" }), "paste");
				dialog.open();
			},

			onPasteClose() {
				this.byId("pasteDialog").close();
			},

			async onPasteAdd() {
				const dialog = this.byId("pasteDialog");
				const data = dialog.getModel("paste").getData();
				dialog.close();
				const model = this.viewModel();
				model.setProperty("/error", "");
				model.setProperty("/outcome", "");
				model.setProperty("/skipped", []);
				await this._upload({ files: [{ path: data.path.trim(), content: data.content }], skipped: [], ignored: 0 }, false);
			},

			/** Folder and zip are a full snapshot of the app (replace); loose files are added or updated. */
			async _upload(intake, replace) {
				const model = this.viewModel();
				model.setProperty("/importing", true);
				try {
					if (!intake.files.length) throw new Error(this.text("wsNoFilesFound"));
					if (!intake.files.some((f) => PARSED_FILE.test(f.path))) throw new Error(this.text("wsNoAppFiles"));
					const lib = await cm();
					const api = this.getApi();
					let result;
					let imported = 0;
					const chunks = lib.chunkFiles(intake.files);
					for (let i = 0; i < chunks.length; i++) {
						result = await api.importSources(this._project().ID, chunks[i], replace && i === 0);
						imported += result.imported;
					}
					let text = this.text("wsImported", [imported, result.appId ? " of " + result.appId : "", result.views, result.controls]);
					if (intake.ignored > 0) text += " " + this.text("wsIgnored", [intake.ignored]);
					model.setProperty("/outcome", text);
					const left = (intake.skipped || []).concat((result.skipped || []).filter((s) => !s.expected));
					model.setProperty("/skipped", left.map((s) => ({ text: this.text("wsSkipped", [s.path, s.reason]) })));
					await this._refresh("manifest");
					this.getBus().publish("tourd", "projectChanged");
				} catch (e) {
					this.fail(e);
				} finally {
					model.setProperty("/importing", false);
				}
			}
		});
	}
);
