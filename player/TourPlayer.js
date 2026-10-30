/*!
 * TourD TourPlayer - guided tours for SAPUI5 / OpenUI5 apps.
 *
 * Plays a tour JSON (see shared/tour.schema.json): a bubble with title, text, Back / Next / Done,
 * anchored to a control, with a spotlight on the target. Needs UI5 >= 1.108.
 *
 *   sap.ui.require(["tourd/TourPlayer"], function (TourPlayer) {
 *     TourPlayer.start("tourd/tour.json", { component: this.getOwnerComponent() });
 *   });
 */
sap.ui.define(
	[
		"sap/ui/core/Element",
		"sap/ui/core/Component",
		"sap/ui/core/routing/HashChanger",
		"sap/base/security/sanitizeHTML",
		"sap/base/Log"
	],
	function (Element, Component, HashChanger, sanitizeHTML, Log) {
		"use strict";

		var VERSION = "0.1.0";
		var LOG = "tourd.TourPlayer";
		var STYLE_ID = "tourd-style";
		var GAP = 14;
		var MARGIN = 8;
		var SPOT_PAD = 4;
		var POLL_MS = 80;

		var DEFAULT_LABELS = {
			back: "Back",
			next: "Next",
			done: "Done",
			close: "Close tour",
			progress: "Step {0} of {1}",
			missing: "This step could not be attached to its control."
		};

		var CSS = [
			".tourd-shield{position:fixed;top:0;right:0;bottom:0;left:0;z-index:100000;background:transparent}",
			".tourd-shield--dim{background:rgba(0,0,0,.55)}",
			".tourd-spot{position:fixed;z-index:100001;pointer-events:none;box-sizing:border-box;border-radius:var(--sapElement_BorderCornerRadius,.375rem);outline:2px solid var(--sapHighlightColor,#0064d9);transition:left .18s ease,top .18s ease,width .18s ease,height .18s ease}",
			".tourd-spot--dim{box-shadow:0 0 0 9999px rgba(0,0,0,.55)}",
			".tourd-bubble{position:fixed;z-index:100002;box-sizing:border-box;width:17rem;height:auto;min-height:0;max-height:calc(100vh - 16px);overflow:auto;max-width:calc(100vw - 16px);background:var(--sapGroup_ContentBackground,#fff);color:var(--sapTextColor,#1d2d3e);font-family:var(--sapFontFamily,Arial,Helvetica,sans-serif);font-size:var(--sapFontSmallSize,.75rem);border-radius:var(--sapElement_BorderCornerRadius,.5rem);box-shadow:var(--sapContent_Shadow2,0 .25rem .75rem rgba(0,0,0,.25));visibility:hidden}",
			".tourd-bubble:focus{outline:none}",
			".tourd-head{display:flex;align-items:center;gap:.25rem;padding:.5rem .375rem .125rem .75rem}",
			".tourd-title{flex:1;margin:0;font-size:var(--sapFontSize,.875rem);font-weight:bold;line-height:1.3;font-family:var(--sapFontHeaderFamily,inherit)}",
			".tourd-close{flex:none;border:0;background:transparent;color:var(--sapContent_IconColor,#1d2d3e);font-size:1rem;line-height:1;width:1.5rem;height:1.5rem;border-radius:var(--sapButton_BorderCornerRadius,.5rem);cursor:pointer}",
			".tourd-close:hover{background:var(--sapButton_Lite_Hover_Background,#eaecee)}"
		].join("");

		CSS += [
			".tourd-body{padding:.125rem .75rem .5rem;line-height:1.4;overflow-wrap:anywhere}",
			".tourd-body p{margin:0 0 .5rem}.tourd-body p:last-child{margin-bottom:0}",
			".tourd-body ul{margin:0 0 .5rem 1.25rem;padding:0}",
			".tourd-body code{font-family:monospace;background:var(--sapShell_Background,#f5f6f7);padding:0 .25rem;border-radius:.25rem}",
			".tourd-warn{color:var(--sapCriticalTextColor,#e76500)}",
			".tourd-foot{display:flex;align-items:center;justify-content:space-between;gap:.375rem;padding:.25rem .75rem .625rem}",
			".tourd-progress{color:var(--sapContent_LabelColor,#556b82);font-size:var(--sapFontSmallSize,.75rem)}",
			".tourd-btns{display:flex;gap:.375rem;margin-left:auto}",
			".tourd-btn{box-sizing:border-box;min-width:3rem;height:1.75rem;padding:0 .625rem;border:1px solid var(--sapButton_BorderColor,#bcc3ca);border-radius:var(--sapButton_BorderCornerRadius,.5rem);background:var(--sapButton_Background,#fff);color:var(--sapButton_TextColor,#0064d9);font:inherit;font-size:var(--sapFontSmallSize,.75rem);font-weight:bold;cursor:pointer}",
			".tourd-btn:hover{background:var(--sapButton_Hover_Background,#eaecee)}",
			".tourd-btn:disabled{opacity:.4;cursor:default}",
			".tourd-btn--primary{background:var(--sapButton_Emphasized_Background,#0064d9);border-color:var(--sapButton_Emphasized_BorderColor,#0064d9);color:var(--sapButton_Emphasized_TextColor,#fff)}",
			".tourd-btn--primary:hover{background:var(--sapButton_Emphasized_Hover_Background,#0057b8)}",
			".tourd-btn:focus-visible,.tourd-close:focus-visible{outline:2px solid var(--sapContent_FocusColor,#0032a5);outline-offset:2px}",
			".tourd-arrow{position:absolute;width:12px;height:12px;background:var(--sapGroup_ContentBackground,#fff);transform:rotate(45deg)}",
			".tourd-bubble[data-side=top] .tourd-arrow{bottom:-6px;left:calc(var(--tourd-ax,50%) - 6px)}",
			".tourd-bubble[data-side=bottom] .tourd-arrow{top:-6px;left:calc(var(--tourd-ax,50%) - 6px)}",
			".tourd-bubble[data-side=left] .tourd-arrow{right:-6px;top:calc(var(--tourd-ay,50%) - 6px)}",
			".tourd-bubble[data-side=right] .tourd-arrow{left:-6px;top:calc(var(--tourd-ay,50%) - 6px)}",
			".tourd-bubble[data-side=center] .tourd-arrow{display:none}",
			"@media (prefers-reduced-motion:reduce){.tourd-spot{transition:none}}"
		].join("");

		// ---------------------------------------------------------------- text helpers

		function escapeHtml(s) {
			return String(s)
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;");
		}

		function inlineMarkdown(s) {
			s = escapeHtml(s);
			s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
			s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
			s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
			s = s.replace(
				/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
				'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
			);
			return s;
		}

		/** Markdown subset (bold, italic, code, links, bullet lists, paragraphs) -> sanitised HTML. */
		function renderMarkdown(md) {
			var blocks = String(md == null ? "" : md)
				.replace(/\r\n?/g, "\n")
				.split(/\n{2,}/);
			var html = blocks
				.filter(function (b) {
					return b.trim();
				})
				.map(function (b) {
					var lines = b.split("\n");
					var isList = lines.every(function (l) {
						return /^\s*[-*]\s+/.test(l);
					});
					if (isList) {
						return (
							"<ul>" +
							lines
								.map(function (l) {
									return "<li>" + inlineMarkdown(l.replace(/^\s*[-*]\s+/, "")) + "</li>";
								})
								.join("") +
							"</ul>"
						);
					}
					return "<p>" + lines.map(inlineMarkdown).join("<br>") + "</p>";
				})
				.join("");
			return sanitizeHTML(html);
		}

		var I18N_RE = /^\{([\w.-]+)>([^}]+)\}$/;

		function resolveI18n(text, component) {
			var m = I18N_RE.exec(text || "");
			if (!m || !component || !component.getModel) {
				return Promise.resolve(text);
			}
			var model = component.getModel(m[1]);
			if (!model || !model.getResourceBundle) {
				return Promise.resolve(text);
			}
			return Promise.resolve(model.getResourceBundle()).then(
				function (bundle) {
					return bundle.getText(m[2]);
				},
				function () {
					return text;
				}
			);
		}

		function format(pattern, args) {
			return pattern.replace(/\{(\d+)\}/g, function (_, i) {
				return args[i];
			});
		}

		// ---------------------------------------------------------------- UI5 lookup

		function uiVersion() {
			var p = String(sap.ui.version || "1.108.0").split(".");
			return { major: parseInt(p[0], 10), minor: parseInt(p[1], 10) };
		}

		// Element.registry is deprecated, ElementRegistry is public since 1.120.
		function loadRegistry() {
			var v = uiVersion();
			if (v.major === 1 && v.minor < 120) {
				return Promise.resolve(Element.registry);
			}
			return new Promise(function (resolve) {
				sap.ui.require(["sap/ui/core/ElementRegistry"], resolve, function () {
					resolve(Element.registry);
				});
			});
		}

		function isShown(dom) {
			if (!dom || !dom.isConnected) {
				return false;
			}
			var r = dom.getBoundingClientRect();
			if (r.width === 0 && r.height === 0) {
				return false;
			}
			var cs = window.getComputedStyle(dom);
			return cs.visibility !== "hidden" && cs.display !== "none";
		}

		function hit(control, via) {
			var dom = control && control.getDomRef && control.getDomRef();
			return isShown(dom) ? { control: control, dom: dom, via: via } : null;
		}

		function firstShown(controls, via) {
			for (var i = 0; i < controls.length; i++) {
				var h = hit(controls[i], via);
				if (h) {
					return h;
				}
			}
			return null;
		}

		function byViewLocal(registry, viewName, localId) {
			var views = registry.filter(function (e) {
				return e.isA("sap.ui.core.mvc.View") && e.getViewName() === viewName;
			});
			return firstShown(
				views
					.map(function (v) {
						return v.byId(localId);
					})
					.filter(Boolean),
				"view"
			);
		}

		function byGlobalId(registry, id) {
			var c = registry.get(id);
			return c ? hit(c, "id") : null;
		}

		function bySuffix(registry, id) {
			var suffix = "--" + id;
			return firstShown(
				registry.filter(function (e) {
					var eid = e.getId();
					return eid.length > suffix.length && eid.slice(-suffix.length) === suffix;
				}),
				"suffix"
			);
		}

		function normText(s) {
			return String(s).replace(/\s+/g, " ").trim().toLowerCase();
		}

		function byText(registry, text) {
			var needle = normText(text);
			var props = ["text", "title", "label", "placeholder"];
			return firstShown(
				registry.filter(function (e) {
					var md = e.getMetadata();
					return props.some(function (p) {
						return md.hasProperty(p) && e.getProperty(p) && normText(e.getProperty(p)) === needle;
					});
				}),
				"text"
			);
		}

		function byCss(selector) {
			var el;
			try {
				el = document.querySelector(selector);
			} catch (e) {
				return null;
			}
			if (!isShown(el)) {
				return null;
			}
			var control = typeof Element.closestTo === "function" ? Element.closestTo(el) : null;
			return { control: control, dom: el, via: "css" };
		}

		/** Resolve a step target to { control, dom, via } if it is currently on screen, else null. */
		function resolveTarget(registry, target) {
			if (!target) {
				return null;
			}
			var found = null;
			if (target.controlId) {
				if (target.viewName) {
					found = byViewLocal(registry, target.viewName, target.controlId);
				}
				found =
					found || byGlobalId(registry, target.controlId) || bySuffix(registry, target.controlId);
			}
			var fallbacks = target.fallbacks || [];
			for (var i = 0; !found && i < fallbacks.length; i++) {
				var fb = fallbacks[i];
				if (fb.by === "id") {
					found = byGlobalId(registry, fb.value) || bySuffix(registry, fb.value);
				} else if (fb.by === "css") {
					found = byCss(fb.value);
				} else if (fb.by === "text") {
					found = byText(registry, fb.value);
				}
			}
			return found;
		}

		// ---------------------------------------------------------------- routing

		function findComponent(opts) {
			if (opts.component) {
				return opts.component;
			}
			try {
				var all = Component.registry.filter(function (c) {
					return c.getRouter && c.getRouter();
				});
				return all[0] || null;
			} catch (e) {
				return null;
			}
		}

		function hashChangerOf(component) {
			try {
				var router = component && component.getRouter && component.getRouter();
				if (router && router.getHashChanger) {
					return router.getHashChanger();
				}
			} catch (e) {
				/* fall through */
			}
			return HashChanger.getInstance();
		}

		function normHash(h) {
			return String(h || "")
				.replace(/^#/, "")
				.replace(/^\//, "");
		}

		// ---------------------------------------------------------------- DOM + placement

		function ensureStyle() {
			if (!document.getElementById(STYLE_ID)) {
				var s = document.createElement("style");
				s.id = STYLE_ID;
				s.textContent = CSS;
				document.head.appendChild(s);
			}
		}

		function el(tag, cls, parent) {
			var e = document.createElement(tag);
			if (cls) {
				e.className = cls;
			}
			if (parent) {
				parent.appendChild(e);
			}
			return e;
		}

		function clamp(v, min, max) {
			return Math.max(min, Math.min(v, Math.max(min, max)));
		}

		var SIDE_ORDER = {
			Top: ["top"],
			Bottom: ["bottom"],
			Left: ["left"],
			Right: ["right"],
			PreferredTopOrFlip: ["top", "bottom", "right", "left"],
			PreferredBottomOrFlip: ["bottom", "top", "right", "left"],
			PreferredLeftOrFlip: ["left", "right", "bottom", "top"],
			PreferredRightOrFlip: ["right", "left", "bottom", "top"],
			Vertical: ["bottom", "top"],
			Horizontal: ["right", "left"]
		};

		function space(side, r, vw, vh) {
			if (side === "top") {
				return r.top - GAP - MARGIN;
			}
			if (side === "bottom") {
				return vh - r.bottom - GAP - MARGIN;
			}
			if (side === "left") {
				return r.left - GAP - MARGIN;
			}
			return vw - r.right - GAP - MARGIN;
		}

		// Quarter-pixel precision: whole pixels would miss the ~0.5px shifts that fractional scroll offsets cause.
		function rectKey(r) {
			return [r.left, r.top, r.width, r.height]
				.map(function (n) {
					return Math.round(n * 4) / 4;
				})
				.join(",");
		}

		function chooseSide(placement, r, bw, bh, vw, vh) {
			var order = (SIDE_ORDER[placement] || SIDE_ORDER.PreferredBottomOrFlip).slice();
			var byRoom = function (a, b) {
				return space(b, r, vw, vh) - space(a, r, vw, vh);
			};
			if (placement === "Vertical" || placement === "Horizontal") {
				order.sort(byRoom);
			}
			for (var i = 0; i < order.length; i++) {
				var need = order[i] === "top" || order[i] === "bottom" ? bh : bw;
				if (space(order[i], r, vw, vh) >= need) {
					return order[i];
				}
			}
			return order.length === 1 ? order[0] : order.sort(byRoom)[0];
		}

		// ---------------------------------------------------------------- session

		function Session(tour, opts, registry) {
			this.tour = tour;
			this.opts = opts;
			this.registry = registry;
			this.labels = Object.assign({}, DEFAULT_LABELS, opts.labels);
			this.component = findComponent(opts);
			this.hashChanger = hashChangerOf(this.component);
			this.startHash = normHash(this.hashChanger.getHash());
			this.index = -1;
			this._token = 0;
			this._found = null;
			this._ended = false;
		}

		Session.prototype._build = function () {
			var self = this;
			var uid = "tourd-" + Math.random().toString(36).slice(2, 8);
			ensureStyle();
			// interactive (the default): the app stays usable while the tour runs, nothing blocks its clicks
			this._shield = this.tour.options.interactive
				? null
				: el("div", "tourd-shield", document.body);
			this._spot = el("div", "tourd-spot", document.body);
			var b = (this._bubble = el("div", "tourd-bubble", document.body));
			b.setAttribute("role", "dialog");
			b.setAttribute("aria-modal", this.tour.options.interactive ? "false" : "true");
			b.setAttribute("aria-labelledby", uid + "-t");
			b.setAttribute("aria-describedby", uid + "-b");
			b.tabIndex = -1;
			this._arrow = el("div", "tourd-arrow", b);
			var head = el("div", "tourd-head", b);
			this._title = el("h2", "tourd-title", head);
			this._title.id = uid + "-t";
			this._closeBtn = el("button", "tourd-close", head);
			this._closeBtn.type = "button";
			this._closeBtn.textContent = "×";
			this._closeBtn.title = this.labels.close;
			this._closeBtn.setAttribute("aria-label", this.labels.close);
			this._closeBtn.style.display = this.tour.options.allowSkip ? "" : "none";
			this._closeBtn.onclick = function () {
				self.stop("skipped");
			};
			this._bodyEl = el("div", "tourd-body", b);
			this._bodyEl.id = uid + "-b";
			var foot = el("div", "tourd-foot", b);
			this._progress = el("span", "tourd-progress", foot);
			var btns = el("div", "tourd-btns", foot);
			this._backBtn = el("button", "tourd-btn", btns);
			this._backBtn.type = "button";
			this._backBtn.textContent = this.labels.back;
			this._backBtn.onclick = function () {
				self.back();
			};
			this._nextBtn = el("button", "tourd-btn tourd-btn--primary", btns);
			this._nextBtn.type = "button";
			this._nextBtn.onclick = function () {
				self.next();
			};

			this._reflow = function () {
				if (self._raf) {
					return;
				}
				self._raf = window.requestAnimationFrame(function () {
					self._raf = 0;
					if (!self._ended) {
						self._position();
					}
				});
			};
			this._keyHandler = function (e) {
				self._onKey(e);
			};
			window.addEventListener("resize", this._reflow);
			document.addEventListener("scroll", this._reflow, true);
			document.addEventListener("keydown", this._keyHandler, true);
			if (this.tour.options.interactive) {
				// pressing the highlighted control is the step: go on when the person does it
				this._clickHandler = function (e) {
					var f = self._found;
					if (self._ended || !f || !f.dom.contains(e.target) || self._bubble.contains(e.target)) {
						return;
					}
					var md = f.control && f.control.getMetadata && f.control.getMetadata();
					if (!md || !(md.getEvent("press") || md.getEvent("tap"))) {
						return;
					}
					var token = self._token;
					setTimeout(function () {
						if (!self._ended && self._token === token) {
							self.next();
						}
					}, 600);
				};
				document.addEventListener("click", this._clickHandler, true);
			}
		};

		Session.prototype._onKey = function (e) {
			var b = this._bubble;
			var t = e.target;
			var inBubble = b.contains(t);
			var free = this.tour.options.interactive; // the app is in use: keys outside the bubble are the app's
			if (e.key === "Escape" && this.tour.options.allowSkip && (!free || inBubble)) {
				e.preventDefault();
				e.stopPropagation();
				this.stop("skipped");
			} else if (e.key === "Tab" && !free) {
				var f = Array.prototype.filter.call(b.querySelectorAll("button, a[href]"), function (x) {
					return !x.disabled && x.offsetParent !== null;
				});
				if (!f.length) {
					return;
				}
				if (!inBubble) {
					e.preventDefault();
					f[0].focus();
				} else if (e.shiftKey && (t === f[0] || t === b)) {
					e.preventDefault();
					f[f.length - 1].focus();
				} else if (!e.shiftKey && t === f[f.length - 1]) {
					e.preventDefault();
					f[0].focus();
				}
			} else if ((inBubble || (!free && t === document.body)) && e.key === "ArrowRight") {
				e.preventDefault();
				this.next();
			} else if ((inBubble || (!free && t === document.body)) && e.key === "ArrowLeft") {
				e.preventDefault();
				this.back();
			}
		};

		Session.prototype._position = function () {
			var step = this.tour.steps[this.index];
			var overlay = this.tour.options.overlay;
			var f = this._found;
			var b = this._bubble;
			var vw = document.documentElement.clientWidth;
			var vh = document.documentElement.clientHeight;
			var bw = b.offsetWidth;
			var bh = b.offsetHeight;
			var x;
			var y;
			if (f && !f.dom.isConnected && f.control && f.control.getDomRef) {
				f.dom = f.control.getDomRef() || f.dom; // UI5 re-rendered the control
			}
			if (f && !isShown(f.dom)) {
				this._spot.style.display = "none"; // target hidden for now; the watcher repositions when it is back
				return;
			}
			if (f) {
				var r = f.dom.getBoundingClientRect();
				this._rectKey = rectKey(r);
				this._spot.style.display = "block";
				this._spot.className =
					"tourd-spot" + (overlay && !this.tour.options.interactive ? " tourd-spot--dim" : "");
				this._spot.style.left = r.left - SPOT_PAD + "px";
				this._spot.style.top = r.top - SPOT_PAD + "px";
				this._spot.style.width = r.width + 2 * SPOT_PAD + "px";
				this._spot.style.height = r.height + 2 * SPOT_PAD + "px";
				if (this._shield) {
					this._shield.className = "tourd-shield";
				}
				var side = chooseSide(step.placement, r, bw, bh, vw, vh);
				var cx = r.left + r.width / 2;
				var cy = r.top + r.height / 2;
				if (side === "top" || side === "bottom") {
					x = clamp(cx - bw / 2, MARGIN, vw - bw - MARGIN);
					y = side === "top" ? r.top - GAP - bh : r.bottom + GAP;
					b.style.setProperty("--tourd-ax", clamp(cx - x, 18, bw - 18) + "px");
				} else {
					y = clamp(cy - bh / 2, MARGIN, vh - bh - MARGIN);
					x = side === "left" ? r.left - GAP - bw : r.right + GAP;
					b.style.setProperty("--tourd-ay", clamp(cy - y, 18, bh - 18) + "px");
				}
				b.setAttribute("data-side", side);
			} else {
				this._spot.style.display = "none";
				if (this._shield) {
					this._shield.className = "tourd-shield" + (overlay ? " tourd-shield--dim" : "");
				}
				if (this.tour.options.interactive) {
					// no control to point at (yet): a small note at the top right, below a shell bar and away from the
					// footer buttons (Save, Cancel) a person needs
					x = vw - bw - 16;
					y = 56;
				} else {
					x = (vw - bw) / 2;
					y = (vh - bh) / 2;
				}
				b.setAttribute("data-side", "center");
			}
			b.style.left = Math.round(clamp(x, MARGIN, vw - bw - MARGIN)) + "px";
			b.style.top = Math.round(clamp(y, MARGIN, vh - bh - MARGIN)) + "px";
		};

		// The route a step needs: its own navigate action, else the last earlier one, else where we started.
		Session.prototype._hashFor = function (index) {
			for (var i = index; i >= 0; i--) {
				var actions = this.tour.steps[i].before || [];
				for (var j = actions.length - 1; j >= 0; j--) {
					if (actions[j].type === "navigate") {
						return normHash(actions[j].hash);
					}
				}
			}
			return this.startHash;
		};

		Session.prototype._ensureRoute = function (index, direction) {
			if (this.tour.options.interactive && direction > 0) {
				// the person is using the app and decides where to go: going on, only a step that says so brings
				// them somewhere (Back does return to the screen of the earlier step)
				var own = (this.tour.steps[index].before || []).filter(function (a) {
					return a.type === "navigate";
				});
				if (!own.length) {
					return;
				}
			}
			var want = this._hashFor(index);
			if (normHash(this.hashChanger.getHash()) !== want) {
				this.hashChanger.setHash(want);
			}
		};

		Session.prototype._waitFor = function (fn, token) {
			var self = this;
			// in use, the app may be one screen behind the tour: wait briefly, the step then waits for its control on its own
			var wait = this.tour.options.interactive
				? Math.min(this.tour.options.waitTimeoutMs, 1500)
				: this.tour.options.waitTimeoutMs;
			var deadline = Date.now() + wait;
			return new Promise(function (resolve) {
				(function tick() {
					if (self._token !== token || self._ended) {
						return resolve(null);
					}
					var r = fn();
					if (r || Date.now() >= deadline) {
						return resolve(r);
					}
					setTimeout(tick, POLL_MS);
				})();
			});
		};

		Session.prototype._emit = function (type, payload) {
			try {
				if (this.opts.onEvent) {
					this.opts.onEvent(type, payload);
				}
				window.dispatchEvent(new CustomEvent("tourd:" + type, { detail: payload }));
			} catch (e) {
				Log.error("onEvent handler failed: " + e.message, LOG);
			}
		};

		Session.prototype._fill = function (step, index, title, text, missing, keepText) {
			var n = this.tour.steps.length;
			var last = index === n - 1;
			this._title.textContent = title;
			if (!keepText) {
				var html = renderMarkdown(text);
				if (missing && this.opts.debug) {
					html += '<p class="tourd-warn">' + escapeHtml(this.labels.missing) + "</p>";
				}
				this._bodyEl.innerHTML = html;
			}
			this._progress.textContent = this.tour.options.showProgress
				? format(this.labels.progress, [index + 1, n])
				: "";
			this._backBtn.disabled = index === 0;
			this._nextBtn.textContent = last ? this.labels.done : this.labels.next;
		};

		// Keeps the spotlight on the target when it moves: page transitions, layout shifts, re-rendering.
		Session.prototype._watch = function (found) {
			var self = this;
			if (this._ro) {
				this._ro.disconnect();
				this._ro = null;
			}
			clearInterval(this._poll);
			if (!found) {
				return;
			}
			if (typeof window.ResizeObserver === "function") {
				this._ro = new window.ResizeObserver(this._reflow);
				this._ro.observe(found.dom);
			}
			this._poll = setInterval(function () {
				var f = self._found;
				if (self._ended || !f) {
					return;
				}
				if (!f.dom.isConnected && f.control && f.control.getDomRef) {
					f.dom = f.control.getDomRef() || f.dom;
				}
				if (rectKey(f.dom.getBoundingClientRect()) !== self._rectKey || !isShown(f.dom)) {
					self._position();
				}
			}, 100);
		};

		// While a step is up and the app is in use: find a control that appears later (the next screen), and go
		// on by itself when the person has moved to the screen of the next step.
		Session.prototype._startTick = function (index) {
			var self = this;
			clearInterval(this._tick);
			if (!this.tour.options.interactive) {
				return;
			}
			var step = this.tour.steps[index];
			var next = this.tour.steps[index + 1];
			var hash = window.location.hash;
			this._tick = setInterval(function () {
				if (self._ended || self.index !== index) {
					return clearInterval(self._tick);
				}
				if (step.target && !self._found) {
					var f = resolveTarget(self.registry, step.target);
					if (f) {
						self._found = f;
						self._fill(step, index, self._title.textContent, null, false, true);
						f.dom.scrollIntoView({ block: "center", inline: "nearest" });
						self._position();
						self._watch(f);
					}
				} else if (window.location.hash !== hash && next && next.target) {
					if (resolveTarget(self.registry, next.target)) {
						self.next();
					}
				}
			}, 300);
		};

		Session.prototype._show = async function (index, direction) {
			var self = this;
			var token = ++this._token;
			var steps = this.tour.steps;
			var step = steps[index];
			this.index = index;
			this._bubble.style.visibility = "hidden";
			this._ensureRoute(index, direction);

			var found = null;
			if (step.target) {
				found = await this._waitFor(function () {
					return resolveTarget(self.registry, step.target);
				}, token);
				if (token !== this._token) {
					return;
				}
				if (!found) {
					var message =
						"Target not found for step " +
						step.id +
						" (" +
						(step.target.controlId || JSON.stringify(step.target.fallbacks)) +
						")";
					Log.warning(message, LOG);
					this._emit("error", {
						code: "TARGET_NOT_FOUND",
						index: index,
						step: step,
						message: message
					});
					var next = index + direction;
					if (this.opts.missingTarget === "skip" && next >= 0 && next < steps.length) {
						return this._show(next, direction);
					}
					if (this.opts.missingTarget === "skip" && direction > 0) {
						return this.finish();
					}
				}
			}

			var texts = await Promise.all([
				resolveI18n(step.title, this.component),
				resolveI18n(step.text, this.component)
			]);
			if (token !== this._token) {
				return;
			}
			this._found = found;
			this._fill(step, index, texts[0], texts[1], !!step.target && !found);
			if (found) {
				found.dom.scrollIntoView({ block: "center", inline: "nearest" });
			}
			this._position();
			this._bubble.style.visibility = "visible";
			this._bubble.focus({ preventScroll: true });
			this._watch(found);
			this._startTick(index);
			this._emit("stepChanged", { index: index, step: step, via: found ? found.via : null });
		};

		Session.prototype.start = function () {
			this._prevFocus = document.activeElement;
			this._build();
			this._emit("started", { tour: this.tour });
			var first = this.opts.startIndex;
			first =
				typeof first === "number" && first >= 0 && first < this.tour.steps.length
					? Math.floor(first)
					: 0;
			return this._show(first, 1);
		};

		Session.prototype.next = function () {
			if (this._ended) {
				return Promise.resolve();
			}
			return this.index >= this.tour.steps.length - 1
				? this.finish()
				: this._show(this.index + 1, 1);
		};

		Session.prototype.back = function () {
			return !this._ended && this.index > 0 ? this._show(this.index - 1, -1) : Promise.resolve();
		};

		Session.prototype.goTo = function (index) {
			if (this._ended || index < 0 || index >= this.tour.steps.length) {
				return Promise.resolve();
			}
			return this._show(index, index >= this.index ? 1 : -1);
		};

		Session.prototype.finish = function () {
			this._end("completed");
			return Promise.resolve();
		};

		/** @param {string} [reason] "skipped" (user closed it); anything else counts as "stopped" */
		Session.prototype.stop = function (reason) {
			this._end(reason === "skipped" ? "skipped" : "stopped");
		};

		Session.prototype._end = function (kind) {
			if (this._ended) {
				return;
			}
			this._ended = true;
			this._token++;
			if (this._ro) {
				this._ro.disconnect();
			}
			clearInterval(this._poll);
			window.removeEventListener("resize", this._reflow);
			document.removeEventListener("scroll", this._reflow, true);
			document.removeEventListener("keydown", this._keyHandler, true);
			if (this._clickHandler) {
				document.removeEventListener("click", this._clickHandler, true);
			}
			clearInterval(this._tick);
			[this._shield, this._spot, this._bubble].forEach(function (n) {
				if (n && n.parentNode) {
					n.parentNode.removeChild(n);
				}
			});
			if (this._prevFocus && this._prevFocus.isConnected && this._prevFocus.focus) {
				this._prevFocus.focus({ preventScroll: true });
			}
			if (active === this) {
				active = null;
			}
			this._emit(kind, { tour: this.tour, index: this.index });
		};

		// ---------------------------------------------------------------- public API

		var active = null;

		function normalizeTour(raw) {
			if (!raw || !Array.isArray(raw.steps) || raw.steps.length === 0) {
				throw new Error("TourPlayer: the tour has no steps");
			}
			var o = raw.options || {};
			return {
				id: raw.id,
				title: raw.title,
				options: {
					showProgress: o.showProgress !== false,
					allowSkip: o.allowSkip !== false,
					overlay: o.overlay !== false,
					interactive: o.interactive !== false,
					waitTimeoutMs: typeof o.waitTimeoutMs === "number" ? o.waitTimeoutMs : 5000
				},
				steps: raw.steps.map(function (s, i) {
					return {
						id: s.id || "s" + (i + 1),
						title: s.title || "",
						text: s.text || "",
						target: s.target || null,
						placement: s.placement || "PreferredBottomOrFlip",
						before: s.before || [],
						meta: s.meta
					};
				})
			};
		}

		function loadTour(src) {
			if (typeof src !== "string") {
				return Promise.resolve(src);
			}
			return fetch(src).then(function (r) {
				if (!r.ok) {
					throw new Error("TourPlayer: could not load tour " + src + " (HTTP " + r.status + ")");
				}
				return r.json();
			});
		}

		return {
			version: VERSION,
			renderMarkdown: renderMarkdown,

			/**
			 * @param {object|string} tourOrUrl tour object or URL of a tour.json
			 * @param {object} [opts]
			 * @param {sap.ui.core.Component} [opts.component] owning component (routing, i18n); auto-detected if omitted
			 * @param {function(string, object)} [opts.onEvent] started | stepChanged | completed | skipped | stopped | error
			 * @param {"center"|"skip"} [opts.missingTarget="center"] what to do when a target cannot be found
			 * @param {object} [opts.labels] override the English button/progress texts
			 * @param {boolean} [opts.debug] show a warning in steps whose target is missing
			 * @param {number} [opts.startIndex=0] step to begin with (designer preview)
			 * @returns {Promise<Session>} resolves once the first step is shown
			 */
			start: function (tourOrUrl, opts) {
				return Promise.all([loadTour(tourOrUrl), loadRegistry()]).then(function (res) {
					if (active) {
						active.stop();
					}
					var session = new Session(normalizeTour(res[0]), opts || {}, res[1]);
					active = session;
					return session.start().then(function () {
						return session;
					});
				});
			},

			stop: function () {
				if (active) {
					active.stop();
				}
			},

			getActive: function () {
				return active;
			},

			/** Resolve a step target the same way the player does. */
			resolve: function (target) {
				return loadRegistry().then(function (registry) {
					return resolveTarget(registry, target);
				});
			},

			/** Resolve several targets at once (the help layer does this on every tick): an array of hit-or-null. */
			resolveAll: function (targets) {
				return loadRegistry().then(function (registry) {
					return targets.map(function (t) {
						return resolveTarget(registry, t);
					});
				});
			},

			/** "{i18n>key}" -> the text from the component's resource bundle; any other text is returned as it is. */
			resolveI18n: resolveI18n
		};
	}
);
