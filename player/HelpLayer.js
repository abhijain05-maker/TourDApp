/*!
 * TourD HelpLayer - context help for SAPUI5 / OpenUI5 apps (like the Help Topics panel of the SAP BTP cockpit).
 *
 * Shows a help button; it opens a side panel with the help topics of the screen that is open (searchable). Each topic is
 * bound to a control: a "?" badge sits on the control, a line connects the topic in the list with its badge, and the
 * badge (or the topic) opens a popover with the text, a note and related links. Needs UI5 >= 1.108 and TourPlayer.js
 * (it is used to find the controls and to render the text).
 *
 *   sap.ui.require(["tourd/HelpLayer"], function (HelpLayer) {
 *     HelpLayer.start("tourd/help.json", { component: this.getOwnerComponent() });
 *   });
 */
sap.ui.define(["./TourPlayer", "sap/base/Log"], function (TourPlayer, Log) {
	"use strict";

	var VERSION = "0.2.0";
	var LOG = "tourd.HelpLayer";
	var STYLE_ID = "tourd-help-style";
	var TICK_MS = 300;
	var BADGE = 22;
	var PANEL_WIDTH = "20rem";
	var DOCK_MIN_WIDTH = 760;

	var DEFAULT_LABELS = {
		open: "Help",
		close: "Close",
		search: "Search Help Topics",
		screen: "About This Screen",
		elsewhere: "Elsewhere in the app",
		none: "There is no help for this screen yet.",
		noMatch: "No help topic matches your search.",
		related: "Related Information",
		note: "Note"
	};

	var CSS = [
		".tourd-help,.tourd-help *{box-sizing:border-box}",
		".tourd-help{font-family:var(--sapFontFamily,Arial,Helvetica,sans-serif);font-size:var(--sapFontSize,.875rem);color:var(--sapTextColor,#1d2d3e)}",
		".tourd-help-toggle{position:fixed;top:.25rem;right:.75rem;z-index:100014;width:2rem;height:2rem;padding:0;border-radius:50%;border:1px solid var(--sapButton_BorderColor,#bcc3ca);background:var(--sapButton_Background,#fff);color:var(--sapButton_TextColor,#0064d9);font:bold 1rem/1 var(--sapFontFamily,Arial);cursor:pointer;box-shadow:var(--sapContent_Shadow1,0 .125rem .5rem rgba(0,0,0,.15))}",
		".tourd-help-toggle:hover{background:var(--sapButton_Hover_Background,#eaecee)}",
		".tourd-help-toggle[aria-pressed=true]{background:var(--sapButton_Emphasized_Background,#0064d9);border-color:var(--sapButton_Emphasized_BorderColor,#0064d9);color:var(--sapButton_Emphasized_TextColor,#fff)}",
		".tourd-help[data-pos=bottom] .tourd-help-toggle{top:auto;bottom:1.25rem;right:1.25rem}",
		".tourd-help-panel{position:fixed;top:0;right:0;bottom:0;z-index:100011;width:" +
			PANEL_WIDTH +
			";max-width:100vw;display:flex;flex-direction:column;background:var(--sapGroup_ContentBackground,#fff);box-shadow:var(--sapContent_Shadow3,0 0 1rem rgba(0,0,0,.3))}",
		".tourd-help-panel[hidden],.tourd-help-toggle[hidden],.tourd-help-pop[hidden]{display:none}",
		".tourd-help-head{display:flex;align-items:center;gap:.5rem;padding:1rem 1rem .5rem}",
		".tourd-help-head h2{flex:1;margin:0;font-size:1.25rem;font-weight:bold;font-family:var(--sapFontHeaderFamily,inherit)}",
		".tourd-help-x{flex:none;width:1.75rem;height:1.75rem;border:0;border-radius:.5rem;background:transparent;color:var(--sapContent_IconColor,#1d2d3e);font-size:1.125rem;line-height:1;cursor:pointer}",
		".tourd-help-x:hover{background:var(--sapButton_Lite_Hover_Background,#eaecee)}",
		".tourd-help-search{margin:0 1rem .75rem;height:2.25rem;padding:0 .625rem;border:1px solid var(--sapField_BorderColor,#7c8b9a);border-radius:var(--sapField_BorderCornerRadius,.5rem);background:var(--sapField_Background,#fff);color:inherit;font:inherit}",
		".tourd-help-sec{margin:0;padding:.75rem 1rem .25rem;font-size:var(--sapFontSmallSize,.75rem);font-weight:bold;text-transform:none;color:var(--sapContent_LabelColor,#556b82);border-top:1px solid var(--sapList_BorderColor,#e5e5e5)}",
		".tourd-help-list{flex:1;margin:0;padding:0;list-style:none;overflow:auto}",
		".tourd-help-item{display:block;width:100%;padding:.625rem 1rem;border:0;border-bottom:1px solid var(--sapList_BorderColor,#e5e5e5);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}",
		".tourd-help-item:hover,.tourd-help-item:focus-visible,.tourd-help-item[data-on]{background:var(--sapList_Hover_Background,#eaecee)}",
		".tourd-help-item[data-on]{background:var(--sapList_SelectionBackgroundColor,#e5f0fa)}",
		".tourd-help-item b{display:block}",
		".tourd-help-item span{display:block;color:var(--sapContent_LabelColor,#556b82);font-size:var(--sapFontSmallSize,.75rem)}",
		".tourd-help-empty{padding:1rem;color:var(--sapContent_LabelColor,#556b82)}",
		".tourd-help-badge{position:fixed;z-index:100009;width:" +
			BADGE +
			"px;height:" +
			BADGE +
			"px;border-radius:50%;border:2px solid var(--sapGroup_ContentBackground,#fff);background:var(--sapAccentColor8,#0f828f);color:#fff;font:bold 12px/1 Arial,sans-serif;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;box-shadow:0 0 0 1px rgba(0,0,0,.2)}",
		".tourd-help-badge[data-on]{background:var(--sapHighlightColor,#0064d9);transform:scale(1.2)}",
		".tourd-help-spot{position:fixed;z-index:100008;pointer-events:none;border-radius:.375rem;outline:2px solid var(--sapHighlightColor,#0064d9);display:none}",
		".tourd-help-line{position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:100012;pointer-events:none;overflow:visible}",
		".tourd-help-line line{stroke:var(--sapHighlightColor,#0064d9);stroke-width:1.5}",
		".tourd-help-line circle{fill:var(--sapHighlightColor,#0064d9)}",
		".tourd-help-pop{position:fixed;z-index:100013;width:22rem;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;background:var(--sapGroup_ContentBackground,#fff);border-radius:.5rem;box-shadow:var(--sapContent_Shadow3,0 .5rem 1.5rem rgba(0,0,0,.3))}",
		".tourd-help-pop:focus{outline:none}",
		".tourd-help-pop-head{display:flex;align-items:flex-start;gap:.5rem;padding:1rem 1rem .5rem}",
		".tourd-help-pop-head h3{flex:1;margin:0;font-size:1.125rem;font-weight:bold;font-family:var(--sapFontHeaderFamily,inherit)}",
		".tourd-help-body{padding:0 1rem 1rem;line-height:1.45;overflow-wrap:anywhere}",
		".tourd-help-body p{margin:0 0 .75rem}.tourd-help-body ul{margin:0 0 .75rem 1.25rem;padding:0}",
		".tourd-help-body code{font-family:monospace;background:var(--sapShell_Background,#f5f6f7);padding:0 .25rem;border-radius:.25rem}",
		".tourd-help-body a,.tourd-help-links a{color:var(--sapLinkColor,#0064d9)}",
		".tourd-help-note{margin:.25rem 0 .75rem;padding:.75rem 1rem;border-left:.375rem solid var(--sapHighlightColor,#0064d9);background:var(--sapShell_Background,#f5f6f7)}",
		".tourd-help-note b{display:block;margin-bottom:.25rem;font-size:1.125rem}",
		".tourd-help-links h4{margin:0 0 .25rem;font-size:1.125rem;font-family:var(--sapFontHeaderFamily,inherit)}",
		".tourd-help-links a{display:block;margin:.25rem 0}",
		".tourd-help-toggle:focus-visible,.tourd-help-x:focus-visible,.tourd-help-badge:focus-visible,.tourd-help-search:focus-visible,.tourd-help-item:focus-visible{outline:2px solid var(--sapContent_FocusColor,#0032a5);outline-offset:2px}"
	].join("");

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) {
			n.className = cls;
		}
		if (text != null) {
			n.textContent = text;
		}
		n.setAttribute("data-tourd-ui", ""); // the recorder ignores everything of ours
		return n;
	}

	function clamp(v, lo, hi) {
		return Math.max(lo, Math.min(hi, v));
	}

	function normalize(raw) {
		if (!raw || !Array.isArray(raw.topics)) {
			throw new Error("HelpLayer: the help has no topics list");
		}
		var o = raw.options || {};
		return {
			id: raw.id,
			title: raw.title,
			options: {
				panelTitle: o.panelTitle || "Help Topics",
				showBadges: o.showBadges !== false,
				buttonPosition: o.buttonPosition === "bottom" ? "bottom" : "top"
			},
			topics: raw.topics.map(function (t, i) {
				return {
					id: t.id || "t" + (i + 1),
					title: t.title || "",
					summary: t.summary || "",
					text: t.text || "",
					note: t.note || "",
					links: (t.links || []).filter(function (l) {
						return l && /^https?:\/\//i.test(l.url || "");
					}),
					target: t.target || null
				};
			})
		};
	}

	function loadHelp(src) {
		if (typeof src !== "string") {
			return Promise.resolve(src);
		}
		return fetch(src).then(function (r) {
			if (!r.ok) {
				throw new Error("HelpLayer: could not load " + src + " (HTTP " + r.status + ")");
			}
			return r.json();
		});
	}

	function ensureStyle() {
		if (document.getElementById(STYLE_ID)) {
			return;
		}
		var s = document.createElement("style");
		s.id = STYLE_ID;
		s.textContent = CSS;
		document.head.appendChild(s);
	}

	// ---------------------------------------------------------------- session

	function Session(help, opts) {
		this.help = help;
		this.opts = opts || {};
		this.labels = Object.assign({}, DEFAULT_LABELS, this.opts.labels || {});
		this.query = "";
		this.isOpen = !!this.opts.open;
		this.activeId = null; // the topic whose popover is open
		this.hoverId = null; // the topic that is pointed at in the list
		this.found = {};
		this._sig = null;
		this._busy = false;
		this._stopped = false;
	}

	Session.prototype.start = function () {
		var self = this;
		ensureStyle();
		this.root = el("div", "tourd-help");
		this.root.setAttribute("data-pos", this.help.options.buttonPosition);
		// the ? at the top of the app: one button that switches the help on and off
		this.toggle = el("button", "tourd-help-toggle", "?");
		this.toggle.type = "button";
		this.toggle.setAttribute("aria-label", this.labels.open);
		this.toggle.title = this.labels.open;
		this.toggle.addEventListener("click", function () {
			self.setOpen(!self.isOpen);
		});
		this.panel = el("aside", "tourd-help-panel");
		this.panel.setAttribute("aria-label", this.help.options.panelTitle);
		var head = el("div", "tourd-help-head");
		var h = el("h2", null, this.help.options.panelTitle);
		var x = el("button", "tourd-help-x", "×");
		x.type = "button";
		x.setAttribute("aria-label", this.labels.close);
		x.addEventListener("click", function () {
			self.setOpen(false);
		});
		head.appendChild(h);
		head.appendChild(x);
		this.search = el("input", "tourd-help-search");
		this.search.type = "search";
		this.search.placeholder = this.labels.search;
		this.search.setAttribute("aria-label", this.labels.search);
		this.search.addEventListener("input", function () {
			self.query = self.search.value;
			self._sig = null;
			self.refresh();
		});
		this.list = el("div", "tourd-help-list");
		this.panel.appendChild(head);
		this.panel.appendChild(this.search);
		this.panel.appendChild(this.list);
		this.badges = el("div", "tourd-help-badges");
		this.spot = el("div", "tourd-help-spot");
		this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		this.svg.setAttribute("class", "tourd-help-line");
		this.svg.setAttribute("data-tourd-ui", "");
		this.svg.setAttribute("aria-hidden", "true");
		this.pop = el("div", "tourd-help-pop");
		this.pop.hidden = true;
		this.pop.tabIndex = -1;
		this.pop.setAttribute("role", "dialog");
		[this.toggle, this.panel, this.badges, this.spot, this.svg, this.pop].forEach(function (n) {
			self.root.appendChild(n);
		});
		document.body.appendChild(this.root);

		this._onKey = function (e) {
			if (e.key === "Escape") {
				if (!self.pop.hidden) {
					self.closePopover();
					e.stopPropagation();
				} else if (self.isOpen) {
					self.setOpen(false);
				}
			}
		};
		this._onReflow = function () {
			self._place();
		};
		document.addEventListener("keydown", this._onKey, true);
		window.addEventListener("resize", this._onReflow);
		window.addEventListener("scroll", this._onReflow, true);
		this._tick = setInterval(function () {
			self.refresh();
		}, TICK_MS);
		this._applyOpen();
		return this.refresh().then(function () {
			self._emit("started", {});
		});
	};

	Session.prototype._emit = function (type, detail) {
		try {
			if (typeof this.opts.onEvent === "function") {
				this.opts.onEvent(type, detail);
			}
			window.dispatchEvent(new CustomEvent("tourd:help:" + type, { detail: detail }));
		} catch (e) {
			Log.warning("event handler failed", String(e), LOG);
		}
	};

	Session.prototype.setOpen = function (open) {
		this.isOpen = !!open;
		if (!open) {
			this.closePopover();
		}
		this._applyOpen();
		this._sig = null;
		this.refresh();
		this._emit(open ? "opened" : "closed", {});
	};

	Session.prototype._applyOpen = function () {
		this.panel.hidden = !this.isOpen;
		this._dock(this.isOpen);
		// the button stays next to the panel while help is on; when the panel lies over the app it has its own close button
		var docked = !!this._docked;
		this.toggle.setAttribute("aria-pressed", String(this.isOpen));
		this.toggle.hidden = this.isOpen && !docked;
		this._placeToggle();
	};

	/**
	 * Makes room for the panel instead of covering the app (like the cockpit does): the page body gets less width,
	 * so the app is laid out in what is left and every control stays reachable. Not on a narrow window: there the
	 * panel simply lies over the app.
	 */
	Session.prototype._dock = function (on) {
		var body = document.body;
		if (on && !this._docked && window.innerWidth >= DOCK_MIN_WIDTH) {
			// (UI5 pages usually say width:100% on the body, so a margin alone would not shrink it)
			this._docked = { width: body.style.width, maxWidth: body.style.maxWidth };
			body.style.width = "calc(100% - " + PANEL_WIDTH + ")";
			body.style.maxWidth = "none";
		} else if (!on && this._docked) {
			body.style.width = this._docked.width;
			body.style.maxWidth = this._docked.maxWidth;
			this._docked = null;
		} else {
			return;
		}
		window.dispatchEvent(new Event("resize")); // UI5 lays the app out again
	};

	/** Replaces the help (the extension does this while an author types) without closing anything. */
	Session.prototype.update = function (help) {
		this.help = help;
		this._sig = null;
		if (this.activeId && !this._topic(this.activeId)) {
			this.closePopover();
		}
		return this.refresh();
	};

	Session.prototype._topic = function (id) {
		for (var i = 0; i < this.help.topics.length; i++) {
			if (this.help.topics[i].id === id) {
				return this.help.topics[i];
			}
		}
		return null;
	};

	Session.prototype.refresh = function () {
		var self = this;
		if (this._busy || this._stopped) {
			return Promise.resolve();
		}
		this._busy = true;
		var topics = this.help.topics;
		return TourPlayer.resolveAll(
			topics.map(function (t) {
				return t.target;
			})
		).then(
			function (hits) {
				self._busy = false;
				if (self._stopped) {
					return;
				}
				var found = {};
				topics.forEach(function (t, i) {
					if (hits[i]) {
						found[t.id] = hits[i];
					}
				});
				self.found = found;
				var sig =
					Object.keys(found).sort().join("|") +
					"#" +
					self.query +
					"#" +
					self.isOpen +
					"#" +
					topics.length +
					"#" +
					JSON.stringify(topics);
				if (sig !== self._sig) {
					self._sig = sig;
					self._renderList();
					self._renderBadges();
				}
				self._place();
			},
			function (e) {
				self._busy = false;
				Log.warning("could not look up the controls", String(e), LOG);
			}
		);
	};

	Session.prototype._domOf = function (id) {
		var hit = this.found[id];
		if (!hit) {
			return null;
		}
		var live = hit.control && hit.control.getDomRef && hit.control.getDomRef();
		return live || hit.dom;
	};

	function matches(topic, q) {
		var hay = (
			topic.title +
			" " +
			topic.summary +
			" " +
			topic.text +
			" " +
			topic.note
		).toLowerCase();
		return q
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean)
			.every(function (w) {
				return hay.indexOf(w) >= 0;
			});
	}

	function byPosition(session) {
		return function (a, b) {
			var ra = session._domOf(a.id).getBoundingClientRect();
			var rb = session._domOf(b.id).getBoundingClientRect();
			return ra.top - rb.top || ra.left - rb.left;
		};
	}

	Session.prototype._item = function (topic) {
		var self = this;
		var b = el("button", "tourd-help-item");
		b.type = "button";
		b.setAttribute("data-topic", topic.id);
		b.appendChild(el("b", null, topic.title));
		if (topic.summary) {
			b.appendChild(el("span", null, topic.summary));
		}
		b.addEventListener("mouseenter", function () {
			self.point(topic.id);
		});
		b.addEventListener("focus", function () {
			self.point(topic.id);
		});
		b.addEventListener("mouseleave", function () {
			self.point(null);
		});
		b.addEventListener("blur", function () {
			self.point(null);
		});
		b.addEventListener("click", function () {
			self.openTopic(topic.id);
		});
		return b;
	};

	Session.prototype._renderList = function () {
		var self = this;
		this.list.textContent = "";
		if (!this.isOpen) {
			return;
		}
		var q = this.query.trim();
		var here = this.help.topics
			.filter(function (t) {
				return self.found[t.id] && (!q || matches(t, q));
			})
			.sort(byPosition(this));
		var away = q
			? this.help.topics.filter(function (t) {
					return !self.found[t.id] && matches(t, q);
				})
			: [];
		this.list.appendChild(el("h3", "tourd-help-sec", this.labels.screen));
		here.forEach(function (t) {
			self.list.appendChild(self._item(t));
		});
		if (!here.length) {
			this.list.appendChild(
				el("div", "tourd-help-empty", q ? this.labels.noMatch : this.labels.none)
			);
		}
		if (away.length) {
			this.list.appendChild(el("h3", "tourd-help-sec", this.labels.elsewhere));
			away.forEach(function (t) {
				self.list.appendChild(self._item(t));
			});
		}
	};

	Session.prototype._renderBadges = function () {
		var self = this;
		this.badges.textContent = "";
		if (!this.isOpen || !this.help.options.showBadges) {
			return;
		}
		this.help.topics.forEach(function (t) {
			if (!self.found[t.id]) {
				return;
			}
			var b = el("button", "tourd-help-badge", "?");
			b.type = "button";
			b.setAttribute("data-topic", t.id);
			b.setAttribute("aria-label", t.title);
			b.title = t.title;
			b.addEventListener("click", function () {
				self.openTopic(t.id);
			});
			b.addEventListener("mouseenter", function () {
				self.point(t.id);
			});
			b.addEventListener("mouseleave", function () {
				self.point(null);
			});
			self.badges.appendChild(b);
		});
	};

	/** Points at a topic: its badge grows, its control is outlined and a line runs from the list to the badge. */
	Session.prototype.point = function (id) {
		this.hoverId = id;
		this._place();
	};

	Session.prototype._badgeOf = function (id) {
		return this.badges.querySelector('[data-topic="' + id.replace(/"/g, "") + '"]');
	};

	/**
	 * Puts the ? in its corner (beside the panel while the help is on) and moves it to the left, button by button,
	 * for as long as it would lie over something the user can click in the app: it must never hide the app's own buttons.
	 */
	Session.prototype._placeToggle = function () {
		var t = this.toggle;
		if (!t || t.hidden) {
			return;
		}
		var gap = 12;
		var base = gap;
		if (this.isOpen && this._docked) {
			base += this.panel.getBoundingClientRect().width;
		} else if (this.help.options.buttonPosition === "bottom") {
			base = 20;
		}
		var size = t.offsetWidth || 36;
		var step = size + 6;
		var clickable =
			"button,a,input,select,textarea,summary,[role=button],[role=link],[role=combobox],[role=menuitem],[role=tab],[role=checkbox]";
		var right = base;
		for (var i = 0; i < 6; i++) {
			var left = window.innerWidth - right - size;
			var y = t.getBoundingClientRect().top + size / 2;
			var blocked = [left - 4, left + 8, left + size / 2, left + size - 8, left + size + 4].some(
				function (x) {
					return document.elementsFromPoint(x, y).some(function (e) {
						return !e.closest("[data-tourd-ui]") && e.closest(clickable);
					});
				}
			);
			if (!blocked) {
				break;
			}
			right += step;
		}
		t.style.right = right + "px";
	};

	Session.prototype._place = function () {
		if (this._stopped) {
			return;
		}
		this._placeToggle();
		var self = this;
		var vw = window.innerWidth;
		var vh = window.innerHeight;
		var current = this.hoverId || this.activeId;
		Array.prototype.forEach.call(this.badges.children, function (b) {
			var dom = self._domOf(b.getAttribute("data-topic"));
			if (!dom) {
				b.style.display = "none";
				return;
			}
			var r = dom.getBoundingClientRect();
			b.style.display = "";
			b.style.left = clamp(r.right - BADGE / 2, 4, vw - BADGE - 4) + "px";
			b.style.top = clamp(r.top - BADGE / 2, 4, vh - BADGE - 4) + "px";
			if (b.getAttribute("data-topic") === current) {
				b.setAttribute("data-on", "");
			} else {
				b.removeAttribute("data-on");
			}
		});
		Array.prototype.forEach.call(this.list.querySelectorAll(".tourd-help-item"), function (i) {
			if (i.getAttribute("data-topic") === current) {
				i.setAttribute("data-on", "");
			} else {
				i.removeAttribute("data-on");
			}
		});
		// outline + line
		this.svg.textContent = "";
		var dom = current ? this._domOf(current) : null;
		if (!dom) {
			this.spot.style.display = "none";
		} else {
			var r2 = dom.getBoundingClientRect();
			this.spot.style.cssText =
				"display:block;left:" +
				r2.left +
				"px;top:" +
				r2.top +
				"px;width:" +
				r2.width +
				"px;height:" +
				r2.height +
				"px";
			var badge = this.isOpen ? this._badgeOf(current) : null;
			var item = this.list.querySelector('[data-topic="' + current.replace(/"/g, "") + '"]');
			if (badge && item && badge.style.display !== "none") {
				var rb = badge.getBoundingClientRect();
				var ri = item.getBoundingClientRect();
				var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
				line.setAttribute("x1", ri.left);
				line.setAttribute("y1", ri.top + ri.height / 2);
				line.setAttribute("x2", rb.left + rb.width / 2);
				line.setAttribute("y2", rb.top + rb.height / 2);
				var dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
				dot.setAttribute("cx", ri.left);
				dot.setAttribute("cy", ri.top + ri.height / 2);
				dot.setAttribute("r", 4);
				this.svg.appendChild(line);
				this.svg.appendChild(dot);
			}
		}
		if (!this.pop.hidden && this.activeId) {
			this._placePopover();
		}
	};

	Session.prototype._placePopover = function () {
		var vw = window.innerWidth;
		var vh = window.innerHeight;
		var dom = this._domOf(this.activeId);
		var pw = this.pop.offsetWidth;
		var ph = this.pop.offsetHeight;
		var left;
		var top;
		if (dom) {
			var r = dom.getBoundingClientRect();
			var panelLeft = this.isOpen ? this.panel.getBoundingClientRect().left : vw;
			left = clamp(r.left, 8, Math.max(8, Math.min(vw, panelLeft) - pw - 8));
			top = r.bottom + 12;
			if (top + ph > vh - 8) {
				top = Math.max(8, r.top - ph - 12);
			}
		} else {
			left = Math.max(8, (vw - pw) / 2);
			top = Math.max(8, (vh - ph) / 3);
		}
		this.pop.style.left = left + "px";
		this.pop.style.top = clamp(top, 8, Math.max(8, vh - ph - 8)) + "px";
	};

	Session.prototype.openTopic = function (id) {
		var self = this;
		var t = this._topic(id);
		if (!t) {
			return Promise.resolve();
		}
		this.activeId = id;
		var component = this.opts.component;
		return Promise.all([
			TourPlayer.resolveI18n(t.title, component),
			TourPlayer.resolveI18n(t.text, component),
			TourPlayer.resolveI18n(t.note, component)
		]).then(function (res) {
			if (self._stopped || self.activeId !== id) {
				return;
			}
			var pop = self.pop;
			pop.textContent = "";
			pop.setAttribute("aria-label", res[0]);
			var head = el("div", "tourd-help-pop-head");
			head.appendChild(el("h3", null, res[0]));
			var x = el("button", "tourd-help-x", "×");
			x.type = "button";
			x.setAttribute("aria-label", self.labels.close);
			x.addEventListener("click", function () {
				self.closePopover();
			});
			head.appendChild(x);
			pop.appendChild(head);
			var body = el("div", "tourd-help-body");
			body.innerHTML = TourPlayer.renderMarkdown(res[1]);
			if (res[2]) {
				var note = el("div", "tourd-help-note");
				note.appendChild(el("b", null, self.labels.note));
				var p = el("div", "tourd-help-body");
				p.style.padding = "0";
				p.innerHTML = TourPlayer.renderMarkdown(res[2]);
				note.appendChild(p);
				body.appendChild(note);
			}
			if (t.links.length) {
				var links = el("div", "tourd-help-links");
				links.appendChild(el("h4", null, self.labels.related));
				t.links.forEach(function (l) {
					var a = el("a", null, l.label);
					a.href = l.url;
					a.target = "_blank";
					a.rel = "noopener noreferrer";
					links.appendChild(a);
				});
				body.appendChild(links);
			}
			pop.appendChild(body);
			pop.hidden = false;
			self._place();
			pop.focus({ preventScroll: true });
			self._emit("topicOpened", { id: id });
		});
	};

	Session.prototype.closePopover = function () {
		if (this.pop.hidden && !this.activeId) {
			return;
		}
		this.pop.hidden = true;
		this.activeId = null;
		this._place();
	};

	Session.prototype.stop = function () {
		if (this._stopped) {
			return;
		}
		this._stopped = true;
		clearInterval(this._tick);
		document.removeEventListener("keydown", this._onKey, true);
		window.removeEventListener("resize", this._onReflow);
		window.removeEventListener("scroll", this._onReflow, true);
		this._dock(false);
		if (this.root && this.root.parentNode) {
			this.root.parentNode.removeChild(this.root);
		}
		if (active === this) {
			active = null;
		}
		this._emit("stopped", {});
	};

	// ---------------------------------------------------------------- public API

	var active = null;

	return {
		version: VERSION,

		/**
		 * @param {object|string} helpOrUrl help object (shared/help.schema) or URL of a help.json
		 * @param {object} [opts]
		 * @param {sap.ui.core.Component} [opts.component] owning component (for {i18n>key} texts)
		 * @param {boolean} [opts.open] open the panel at once (authoring preview)
		 * @param {object} [opts.labels] override the English texts
		 * @param {function(string, object)} [opts.onEvent] started | opened | closed | topicOpened | stopped
		 * @returns {Promise<Session>}
		 */
		start: function (helpOrUrl, opts) {
			return loadHelp(helpOrUrl).then(function (raw) {
				if (active) {
					active.stop();
				}
				var session = new Session(normalize(raw), opts);
				active = session;
				return session.start().then(function () {
					return session;
				});
			});
		},

		/** Shows new help in the running layer (starts one if none runs). */
		update: function (raw, opts) {
			if (!active) {
				return this.start(raw, opts);
			}
			var session = active;
			return session.update(normalize(raw)).then(function () {
				if (opts && opts.open && !session.isOpen) {
					session.setOpen(true);
				}
				return session;
			});
		},

		/** Opens the popover of one topic (and the panel). */
		openTopic: function (id) {
			if (!active) {
				return Promise.resolve();
			}
			if (!active.isOpen) {
				active.setOpen(true);
			}
			return active.refresh().then(function () {
				return active && active.openTopic(id);
			});
		},

		stop: function () {
			if (active) {
				active.stop();
			}
		},

		getActive: function () {
			return active;
		}
	};
});
