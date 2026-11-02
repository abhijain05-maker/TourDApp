// ../player/TourPlayer.js?raw
var e = "/*!\n * TourD TourPlayer - guided tours for SAPUI5 / OpenUI5 apps.\n *\n * Plays a tour JSON (see shared/tour.schema.json): a bubble with title, text, Back / Next / Done,\n * anchored to a control, with a spotlight on the target. Needs UI5 >= 1.108.\n *\n *   sap.ui.require([\"tourd/TourPlayer\"], function (TourPlayer) {\n *     TourPlayer.start(\"tourd/tour.json\", { component: this.getOwnerComponent() });\n *   });\n */\nsap.ui.define(\n	[\n		\"sap/ui/core/Element\",\n		\"sap/ui/core/Component\",\n		\"sap/ui/core/routing/HashChanger\",\n		\"sap/base/security/sanitizeHTML\",\n		\"sap/base/Log\"\n	],\n	function (Element, Component, HashChanger, sanitizeHTML, Log) {\n		\"use strict\";\n\n		var VERSION = \"0.1.0\";\n		var LOG = \"tourd.TourPlayer\";\n		var STYLE_ID = \"tourd-style\";\n		var GAP = 14;\n		var MARGIN = 8;\n		var SPOT_PAD = 4;\n		var POLL_MS = 80;\n\n		var DEFAULT_LABELS = {\n			back: \"Back\",\n			next: \"Next\",\n			done: \"Done\",\n			close: \"Close tour\",\n			progress: \"Step {0} of {1}\",\n			missing: \"This step could not be attached to its control.\"\n		};\n\n		var CSS = [\n			\".tourd-shield{position:fixed;top:0;right:0;bottom:0;left:0;z-index:100000;background:transparent}\",\n			\".tourd-shield--dim{background:rgba(0,0,0,.55)}\",\n			\".tourd-spot{position:fixed;z-index:100001;pointer-events:none;box-sizing:border-box;border-radius:var(--sapElement_BorderCornerRadius,.375rem);outline:2px solid var(--sapHighlightColor,#0064d9);transition:left .18s ease,top .18s ease,width .18s ease,height .18s ease}\",\n			\".tourd-spot--dim{box-shadow:0 0 0 9999px rgba(0,0,0,.55)}\",\n			\".tourd-bubble{position:fixed;z-index:100002;box-sizing:border-box;width:17rem;height:auto;min-height:0;max-height:calc(100vh - 16px);overflow:auto;max-width:calc(100vw - 16px);background:var(--sapGroup_ContentBackground,#fff);color:var(--sapTextColor,#1d2d3e);font-family:var(--sapFontFamily,Arial,Helvetica,sans-serif);font-size:var(--sapFontSmallSize,.75rem);border-radius:var(--sapElement_BorderCornerRadius,.5rem);box-shadow:var(--sapContent_Shadow2,0 .25rem .75rem rgba(0,0,0,.25));visibility:hidden}\",\n			\".tourd-bubble:focus{outline:none}\",\n			\".tourd-head{display:flex;align-items:center;gap:.25rem;padding:.5rem .375rem .125rem .75rem}\",\n			\".tourd-title{flex:1;margin:0;font-size:var(--sapFontSize,.875rem);font-weight:bold;line-height:1.3;font-family:var(--sapFontHeaderFamily,inherit)}\",\n			\".tourd-close{flex:none;border:0;background:transparent;color:var(--sapContent_IconColor,#1d2d3e);font-size:1rem;line-height:1;width:1.5rem;height:1.5rem;border-radius:var(--sapButton_BorderCornerRadius,.5rem);cursor:pointer}\",\n			\".tourd-close:hover{background:var(--sapButton_Lite_Hover_Background,#eaecee)}\"\n		].join(\"\");\n\n		CSS += [\n			\".tourd-body{padding:.125rem .75rem .5rem;line-height:1.4;overflow-wrap:anywhere}\",\n			\".tourd-body p{margin:0 0 .5rem}.tourd-body p:last-child{margin-bottom:0}\",\n			\".tourd-body ul{margin:0 0 .5rem 1.25rem;padding:0}\",\n			\".tourd-body code{font-family:monospace;background:var(--sapShell_Background,#f5f6f7);padding:0 .25rem;border-radius:.25rem}\",\n			\".tourd-warn{color:var(--sapCriticalTextColor,#e76500)}\",\n			\".tourd-foot{display:flex;align-items:center;justify-content:space-between;gap:.375rem;padding:.25rem .75rem .625rem}\",\n			\".tourd-progress{color:var(--sapContent_LabelColor,#556b82);font-size:var(--sapFontSmallSize,.75rem)}\",\n			\".tourd-btns{display:flex;gap:.375rem;margin-left:auto}\",\n			\".tourd-btn{box-sizing:border-box;min-width:3rem;height:1.75rem;padding:0 .625rem;border:1px solid var(--sapButton_BorderColor,#bcc3ca);border-radius:var(--sapButton_BorderCornerRadius,.5rem);background:var(--sapButton_Background,#fff);color:var(--sapButton_TextColor,#0064d9);font:inherit;font-size:var(--sapFontSmallSize,.75rem);font-weight:bold;cursor:pointer}\",\n			\".tourd-btn:hover{background:var(--sapButton_Hover_Background,#eaecee)}\",\n			\".tourd-btn:disabled{opacity:.4;cursor:default}\",\n			\".tourd-btn--primary{background:var(--sapButton_Emphasized_Background,#0064d9);border-color:var(--sapButton_Emphasized_BorderColor,#0064d9);color:var(--sapButton_Emphasized_TextColor,#fff)}\",\n			\".tourd-btn--primary:hover{background:var(--sapButton_Emphasized_Hover_Background,#0057b8)}\",\n			\".tourd-btn:focus-visible,.tourd-close:focus-visible{outline:2px solid var(--sapContent_FocusColor,#0032a5);outline-offset:2px}\",\n			\".tourd-arrow{position:absolute;width:12px;height:12px;background:var(--sapGroup_ContentBackground,#fff);transform:rotate(45deg)}\",\n			\".tourd-bubble[data-side=top] .tourd-arrow{bottom:-6px;left:calc(var(--tourd-ax,50%) - 6px)}\",\n			\".tourd-bubble[data-side=bottom] .tourd-arrow{top:-6px;left:calc(var(--tourd-ax,50%) - 6px)}\",\n			\".tourd-bubble[data-side=left] .tourd-arrow{right:-6px;top:calc(var(--tourd-ay,50%) - 6px)}\",\n			\".tourd-bubble[data-side=right] .tourd-arrow{left:-6px;top:calc(var(--tourd-ay,50%) - 6px)}\",\n			\".tourd-bubble[data-side=center] .tourd-arrow{display:none}\",\n			\"@media (prefers-reduced-motion:reduce){.tourd-spot{transition:none}}\"\n		].join(\"\");\n\n		// ---------------------------------------------------------------- text helpers\n\n		function escapeHtml(s) {\n			return String(s)\n				.replace(/&/g, \"&amp;\")\n				.replace(/</g, \"&lt;\")\n				.replace(/>/g, \"&gt;\")\n				.replace(/\"/g, \"&quot;\");\n		}\n\n		function inlineMarkdown(s) {\n			s = escapeHtml(s);\n			s = s.replace(/`([^`]+)`/g, \"<code>$1</code>\");\n			s = s.replace(/\\*\\*([^*]+)\\*\\*/g, \"<strong>$1</strong>\");\n			s = s.replace(/(^|[^*])\\*([^*\\s][^*]*)\\*/g, \"$1<em>$2</em>\");\n			s = s.replace(\n				/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g,\n				'<a href=\"$2\" target=\"_blank\" rel=\"noopener noreferrer\">$1</a>'\n			);\n			return s;\n		}\n\n		/** Markdown subset (bold, italic, code, links, bullet lists, paragraphs) -> sanitised HTML. */\n		function renderMarkdown(md) {\n			var blocks = String(md == null ? \"\" : md)\n				.replace(/\\r\\n?/g, \"\\n\")\n				.split(/\\n{2,}/);\n			var html = blocks\n				.filter(function (b) {\n					return b.trim();\n				})\n				.map(function (b) {\n					var lines = b.split(\"\\n\");\n					var isList = lines.every(function (l) {\n						return /^\\s*[-*]\\s+/.test(l);\n					});\n					if (isList) {\n						return (\n							\"<ul>\" +\n							lines\n								.map(function (l) {\n									return \"<li>\" + inlineMarkdown(l.replace(/^\\s*[-*]\\s+/, \"\")) + \"</li>\";\n								})\n								.join(\"\") +\n							\"</ul>\"\n						);\n					}\n					return \"<p>\" + lines.map(inlineMarkdown).join(\"<br>\") + \"</p>\";\n				})\n				.join(\"\");\n			return sanitizeHTML(html);\n		}\n\n		var I18N_RE = /^\\{([\\w.-]+)>([^}]+)\\}$/;\n\n		function resolveI18n(text, component) {\n			var m = I18N_RE.exec(text || \"\");\n			if (!m || !component || !component.getModel) {\n				return Promise.resolve(text);\n			}\n			var model = component.getModel(m[1]);\n			if (!model || !model.getResourceBundle) {\n				return Promise.resolve(text);\n			}\n			return Promise.resolve(model.getResourceBundle()).then(\n				function (bundle) {\n					return bundle.getText(m[2]);\n				},\n				function () {\n					return text;\n				}\n			);\n		}\n\n		function format(pattern, args) {\n			return pattern.replace(/\\{(\\d+)\\}/g, function (_, i) {\n				return args[i];\n			});\n		}\n\n		// ---------------------------------------------------------------- UI5 lookup\n\n		function uiVersion() {\n			var p = String(sap.ui.version || \"1.108.0\").split(\".\");\n			return { major: parseInt(p[0], 10), minor: parseInt(p[1], 10) };\n		}\n\n		// Element.registry is deprecated, ElementRegistry is public since 1.120.\n		function loadRegistry() {\n			var v = uiVersion();\n			if (v.major === 1 && v.minor < 120) {\n				return Promise.resolve(Element.registry);\n			}\n			return new Promise(function (resolve) {\n				sap.ui.require([\"sap/ui/core/ElementRegistry\"], resolve, function () {\n					resolve(Element.registry);\n				});\n			});\n		}\n\n		function isShown(dom) {\n			if (!dom || !dom.isConnected) {\n				return false;\n			}\n			var r = dom.getBoundingClientRect();\n			if (r.width === 0 && r.height === 0) {\n				return false;\n			}\n			var cs = window.getComputedStyle(dom);\n			return cs.visibility !== \"hidden\" && cs.display !== \"none\";\n		}\n\n		function hit(control, via) {\n			var dom = control && control.getDomRef && control.getDomRef();\n			return isShown(dom) ? { control: control, dom: dom, via: via } : null;\n		}\n\n		function firstShown(controls, via) {\n			for (var i = 0; i < controls.length; i++) {\n				var h = hit(controls[i], via);\n				if (h) {\n					return h;\n				}\n			}\n			return null;\n		}\n\n		function byViewLocal(registry, viewName, localId) {\n			var views = registry.filter(function (e) {\n				return e.isA(\"sap.ui.core.mvc.View\") && e.getViewName() === viewName;\n			});\n			return firstShown(\n				views\n					.map(function (v) {\n						return v.byId(localId);\n					})\n					.filter(Boolean),\n				\"view\"\n			);\n		}\n\n		function byGlobalId(registry, id) {\n			var c = registry.get(id);\n			return c ? hit(c, \"id\") : null;\n		}\n\n		function bySuffix(registry, id) {\n			var suffix = \"--\" + id;\n			return firstShown(\n				registry.filter(function (e) {\n					var eid = e.getId();\n					return eid.length > suffix.length && eid.slice(-suffix.length) === suffix;\n				}),\n				\"suffix\"\n			);\n		}\n\n		function normText(s) {\n			return String(s).replace(/\\s+/g, \" \").trim().toLowerCase();\n		}\n\n		function byText(registry, text) {\n			var needle = normText(text);\n			var props = [\"text\", \"title\", \"label\", \"placeholder\"];\n			return firstShown(\n				registry.filter(function (e) {\n					var md = e.getMetadata();\n					return props.some(function (p) {\n						return md.hasProperty(p) && e.getProperty(p) && normText(e.getProperty(p)) === needle;\n					});\n				}),\n				\"text\"\n			);\n		}\n\n		function byCss(selector) {\n			var el;\n			try {\n				el = document.querySelector(selector);\n			} catch (e) {\n				return null;\n			}\n			if (!isShown(el)) {\n				return null;\n			}\n			var control = typeof Element.closestTo === \"function\" ? Element.closestTo(el) : null;\n			return { control: control, dom: el, via: \"css\" };\n		}\n\n		/** Resolve a step target to { control, dom, via } if it is currently on screen, else null. */\n		function resolveTarget(registry, target) {\n			if (!target) {\n				return null;\n			}\n			var found = null;\n			if (target.controlId) {\n				if (target.viewName) {\n					found = byViewLocal(registry, target.viewName, target.controlId);\n				}\n				found =\n					found || byGlobalId(registry, target.controlId) || bySuffix(registry, target.controlId);\n			}\n			var fallbacks = target.fallbacks || [];\n			for (var i = 0; !found && i < fallbacks.length; i++) {\n				var fb = fallbacks[i];\n				if (fb.by === \"id\") {\n					found = byGlobalId(registry, fb.value) || bySuffix(registry, fb.value);\n				} else if (fb.by === \"css\") {\n					found = byCss(fb.value);\n				} else if (fb.by === \"text\") {\n					found = byText(registry, fb.value);\n				}\n			}\n			return found;\n		}\n\n		// ---------------------------------------------------------------- routing\n\n		function findComponent(opts) {\n			if (opts.component) {\n				return opts.component;\n			}\n			try {\n				var all = Component.registry.filter(function (c) {\n					return c.getRouter && c.getRouter();\n				});\n				return all[0] || null;\n			} catch (e) {\n				return null;\n			}\n		}\n\n		function hashChangerOf(component) {\n			try {\n				var router = component && component.getRouter && component.getRouter();\n				if (router && router.getHashChanger) {\n					return router.getHashChanger();\n				}\n			} catch (e) {\n				/* fall through */\n			}\n			return HashChanger.getInstance();\n		}\n\n		function normHash(h) {\n			return String(h || \"\")\n				.replace(/^#/, \"\")\n				.replace(/^\\//, \"\");\n		}\n\n		// ---------------------------------------------------------------- DOM + placement\n\n		function ensureStyle() {\n			if (!document.getElementById(STYLE_ID)) {\n				var s = document.createElement(\"style\");\n				s.id = STYLE_ID;\n				s.textContent = CSS;\n				document.head.appendChild(s);\n			}\n		}\n\n		function el(tag, cls, parent) {\n			var e = document.createElement(tag);\n			if (cls) {\n				e.className = cls;\n			}\n			if (parent) {\n				parent.appendChild(e);\n			}\n			return e;\n		}\n\n		function clamp(v, min, max) {\n			return Math.max(min, Math.min(v, Math.max(min, max)));\n		}\n\n		var SIDE_ORDER = {\n			Top: [\"top\"],\n			Bottom: [\"bottom\"],\n			Left: [\"left\"],\n			Right: [\"right\"],\n			PreferredTopOrFlip: [\"top\", \"bottom\", \"right\", \"left\"],\n			PreferredBottomOrFlip: [\"bottom\", \"top\", \"right\", \"left\"],\n			PreferredLeftOrFlip: [\"left\", \"right\", \"bottom\", \"top\"],\n			PreferredRightOrFlip: [\"right\", \"left\", \"bottom\", \"top\"],\n			Vertical: [\"bottom\", \"top\"],\n			Horizontal: [\"right\", \"left\"]\n		};\n\n		function space(side, r, vw, vh) {\n			if (side === \"top\") {\n				return r.top - GAP - MARGIN;\n			}\n			if (side === \"bottom\") {\n				return vh - r.bottom - GAP - MARGIN;\n			}\n			if (side === \"left\") {\n				return r.left - GAP - MARGIN;\n			}\n			return vw - r.right - GAP - MARGIN;\n		}\n\n		// Quarter-pixel precision: whole pixels would miss the ~0.5px shifts that fractional scroll offsets cause.\n		function rectKey(r) {\n			return [r.left, r.top, r.width, r.height]\n				.map(function (n) {\n					return Math.round(n * 4) / 4;\n				})\n				.join(\",\");\n		}\n\n		function chooseSide(placement, r, bw, bh, vw, vh) {\n			var order = (SIDE_ORDER[placement] || SIDE_ORDER.PreferredBottomOrFlip).slice();\n			var byRoom = function (a, b) {\n				return space(b, r, vw, vh) - space(a, r, vw, vh);\n			};\n			if (placement === \"Vertical\" || placement === \"Horizontal\") {\n				order.sort(byRoom);\n			}\n			for (var i = 0; i < order.length; i++) {\n				var need = order[i] === \"top\" || order[i] === \"bottom\" ? bh : bw;\n				if (space(order[i], r, vw, vh) >= need) {\n					return order[i];\n				}\n			}\n			return order.length === 1 ? order[0] : order.sort(byRoom)[0];\n		}\n\n		// ---------------------------------------------------------------- session\n\n		function Session(tour, opts, registry) {\n			this.tour = tour;\n			this.opts = opts;\n			this.registry = registry;\n			this.labels = Object.assign({}, DEFAULT_LABELS, opts.labels);\n			this.component = findComponent(opts);\n			this.hashChanger = hashChangerOf(this.component);\n			this.startHash = normHash(this.hashChanger.getHash());\n			this.index = -1;\n			this._token = 0;\n			this._found = null;\n			this._ended = false;\n		}\n\n		Session.prototype._build = function () {\n			var self = this;\n			var uid = \"tourd-\" + Math.random().toString(36).slice(2, 8);\n			ensureStyle();\n			// interactive (the default): the app stays usable while the tour runs, nothing blocks its clicks\n			this._shield = this.tour.options.interactive\n				? null\n				: el(\"div\", \"tourd-shield\", document.body);\n			this._spot = el(\"div\", \"tourd-spot\", document.body);\n			var b = (this._bubble = el(\"div\", \"tourd-bubble\", document.body));\n			b.setAttribute(\"role\", \"dialog\");\n			b.setAttribute(\"aria-modal\", this.tour.options.interactive ? \"false\" : \"true\");\n			b.setAttribute(\"aria-labelledby\", uid + \"-t\");\n			b.setAttribute(\"aria-describedby\", uid + \"-b\");\n			b.tabIndex = -1;\n			this._arrow = el(\"div\", \"tourd-arrow\", b);\n			var head = el(\"div\", \"tourd-head\", b);\n			this._title = el(\"h2\", \"tourd-title\", head);\n			this._title.id = uid + \"-t\";\n			this._closeBtn = el(\"button\", \"tourd-close\", head);\n			this._closeBtn.type = \"button\";\n			this._closeBtn.textContent = \"×\";\n			this._closeBtn.title = this.labels.close;\n			this._closeBtn.setAttribute(\"aria-label\", this.labels.close);\n			this._closeBtn.style.display = this.tour.options.allowSkip ? \"\" : \"none\";\n			this._closeBtn.onclick = function () {\n				self.stop(\"skipped\");\n			};\n			this._bodyEl = el(\"div\", \"tourd-body\", b);\n			this._bodyEl.id = uid + \"-b\";\n			var foot = el(\"div\", \"tourd-foot\", b);\n			this._progress = el(\"span\", \"tourd-progress\", foot);\n			var btns = el(\"div\", \"tourd-btns\", foot);\n			this._backBtn = el(\"button\", \"tourd-btn\", btns);\n			this._backBtn.type = \"button\";\n			this._backBtn.textContent = this.labels.back;\n			this._backBtn.onclick = function () {\n				self.back();\n			};\n			this._nextBtn = el(\"button\", \"tourd-btn tourd-btn--primary\", btns);\n			this._nextBtn.type = \"button\";\n			this._nextBtn.onclick = function () {\n				self.next();\n			};\n\n			this._reflow = function () {\n				if (self._raf) {\n					return;\n				}\n				self._raf = window.requestAnimationFrame(function () {\n					self._raf = 0;\n					if (!self._ended) {\n						self._position();\n					}\n				});\n			};\n			this._keyHandler = function (e) {\n				self._onKey(e);\n			};\n			window.addEventListener(\"resize\", this._reflow);\n			document.addEventListener(\"scroll\", this._reflow, true);\n			document.addEventListener(\"keydown\", this._keyHandler, true);\n			if (this.tour.options.interactive) {\n				// pressing the highlighted control is the step: go on when the person does it\n				this._clickHandler = function (e) {\n					var f = self._found;\n					if (self._ended || !f || !f.dom.contains(e.target) || self._bubble.contains(e.target)) {\n						return;\n					}\n					var md = f.control && f.control.getMetadata && f.control.getMetadata();\n					if (!md || !(md.getEvent(\"press\") || md.getEvent(\"tap\"))) {\n						return;\n					}\n					var token = self._token;\n					setTimeout(function () {\n						if (!self._ended && self._token === token) {\n							self.next();\n						}\n					}, 600);\n				};\n				document.addEventListener(\"click\", this._clickHandler, true);\n			}\n		};\n\n		Session.prototype._onKey = function (e) {\n			var b = this._bubble;\n			var t = e.target;\n			var inBubble = b.contains(t);\n			var free = this.tour.options.interactive; // the app is in use: keys outside the bubble are the app's\n			if (e.key === \"Escape\" && this.tour.options.allowSkip && (!free || inBubble)) {\n				e.preventDefault();\n				e.stopPropagation();\n				this.stop(\"skipped\");\n			} else if (e.key === \"Tab\" && !free) {\n				var f = Array.prototype.filter.call(b.querySelectorAll(\"button, a[href]\"), function (x) {\n					return !x.disabled && x.offsetParent !== null;\n				});\n				if (!f.length) {\n					return;\n				}\n				if (!inBubble) {\n					e.preventDefault();\n					f[0].focus();\n				} else if (e.shiftKey && (t === f[0] || t === b)) {\n					e.preventDefault();\n					f[f.length - 1].focus();\n				} else if (!e.shiftKey && t === f[f.length - 1]) {\n					e.preventDefault();\n					f[0].focus();\n				}\n			} else if ((inBubble || (!free && t === document.body)) && e.key === \"ArrowRight\") {\n				e.preventDefault();\n				this.next();\n			} else if ((inBubble || (!free && t === document.body)) && e.key === \"ArrowLeft\") {\n				e.preventDefault();\n				this.back();\n			}\n		};\n\n		Session.prototype._position = function () {\n			var step = this.tour.steps[this.index];\n			var overlay = this.tour.options.overlay;\n			var f = this._found;\n			var b = this._bubble;\n			var vw = document.documentElement.clientWidth;\n			var vh = document.documentElement.clientHeight;\n			var bw = b.offsetWidth;\n			var bh = b.offsetHeight;\n			var x;\n			var y;\n			if (f && !f.dom.isConnected && f.control && f.control.getDomRef) {\n				f.dom = f.control.getDomRef() || f.dom; // UI5 re-rendered the control\n			}\n			if (f && !isShown(f.dom)) {\n				this._spot.style.display = \"none\"; // target hidden for now; the watcher repositions when it is back\n				return;\n			}\n			if (f) {\n				var r = f.dom.getBoundingClientRect();\n				this._rectKey = rectKey(r);\n				this._spot.style.display = \"block\";\n				this._spot.className =\n					\"tourd-spot\" + (overlay && !this.tour.options.interactive ? \" tourd-spot--dim\" : \"\");\n				this._spot.style.left = r.left - SPOT_PAD + \"px\";\n				this._spot.style.top = r.top - SPOT_PAD + \"px\";\n				this._spot.style.width = r.width + 2 * SPOT_PAD + \"px\";\n				this._spot.style.height = r.height + 2 * SPOT_PAD + \"px\";\n				if (this._shield) {\n					this._shield.className = \"tourd-shield\";\n				}\n				var side = chooseSide(step.placement, r, bw, bh, vw, vh);\n				var cx = r.left + r.width / 2;\n				var cy = r.top + r.height / 2;\n				if (side === \"top\" || side === \"bottom\") {\n					x = clamp(cx - bw / 2, MARGIN, vw - bw - MARGIN);\n					y = side === \"top\" ? r.top - GAP - bh : r.bottom + GAP;\n					b.style.setProperty(\"--tourd-ax\", clamp(cx - x, 18, bw - 18) + \"px\");\n				} else {\n					y = clamp(cy - bh / 2, MARGIN, vh - bh - MARGIN);\n					x = side === \"left\" ? r.left - GAP - bw : r.right + GAP;\n					b.style.setProperty(\"--tourd-ay\", clamp(cy - y, 18, bh - 18) + \"px\");\n				}\n				b.setAttribute(\"data-side\", side);\n			} else {\n				this._spot.style.display = \"none\";\n				if (this._shield) {\n					this._shield.className = \"tourd-shield\" + (overlay ? \" tourd-shield--dim\" : \"\");\n				}\n				if (this.tour.options.interactive) {\n					// no control to point at (yet): a small note at the top right, below a shell bar and away from the\n					// footer buttons (Save, Cancel) a person needs\n					x = vw - bw - 16;\n					y = 56;\n				} else {\n					x = (vw - bw) / 2;\n					y = (vh - bh) / 2;\n				}\n				b.setAttribute(\"data-side\", \"center\");\n			}\n			b.style.left = Math.round(clamp(x, MARGIN, vw - bw - MARGIN)) + \"px\";\n			b.style.top = Math.round(clamp(y, MARGIN, vh - bh - MARGIN)) + \"px\";\n		};\n\n		// The route a step needs: its own navigate action, else the last earlier one, else where we started.\n		Session.prototype._hashFor = function (index) {\n			for (var i = index; i >= 0; i--) {\n				var actions = this.tour.steps[i].before || [];\n				for (var j = actions.length - 1; j >= 0; j--) {\n					if (actions[j].type === \"navigate\") {\n						return normHash(actions[j].hash);\n					}\n				}\n			}\n			return this.startHash;\n		};\n\n		Session.prototype._ensureRoute = function (index, direction) {\n			if (this.tour.options.interactive && direction > 0) {\n				// the person is using the app and decides where to go: going on, only a step that says so brings\n				// them somewhere (Back does return to the screen of the earlier step)\n				var own = (this.tour.steps[index].before || []).filter(function (a) {\n					return a.type === \"navigate\";\n				});\n				if (!own.length) {\n					return;\n				}\n			}\n			var want = this._hashFor(index);\n			if (normHash(this.hashChanger.getHash()) !== want) {\n				this.hashChanger.setHash(want);\n			}\n		};\n\n		Session.prototype._waitFor = function (fn, token) {\n			var self = this;\n			// in use, the app may be one screen behind the tour: wait briefly, the step then waits for its control on its own\n			var wait = this.tour.options.interactive\n				? Math.min(this.tour.options.waitTimeoutMs, 1500)\n				: this.tour.options.waitTimeoutMs;\n			var deadline = Date.now() + wait;\n			return new Promise(function (resolve) {\n				(function tick() {\n					if (self._token !== token || self._ended) {\n						return resolve(null);\n					}\n					var r = fn();\n					if (r || Date.now() >= deadline) {\n						return resolve(r);\n					}\n					setTimeout(tick, POLL_MS);\n				})();\n			});\n		};\n\n		Session.prototype._emit = function (type, payload) {\n			try {\n				if (this.opts.onEvent) {\n					this.opts.onEvent(type, payload);\n				}\n				window.dispatchEvent(new CustomEvent(\"tourd:\" + type, { detail: payload }));\n			} catch (e) {\n				Log.error(\"onEvent handler failed: \" + e.message, LOG);\n			}\n		};\n\n		Session.prototype._fill = function (step, index, title, text, missing, keepText) {\n			var n = this.tour.steps.length;\n			var last = index === n - 1;\n			this._title.textContent = title;\n			if (!keepText) {\n				var html = renderMarkdown(text);\n				if (missing && this.opts.debug) {\n					html += '<p class=\"tourd-warn\">' + escapeHtml(this.labels.missing) + \"</p>\";\n				}\n				this._bodyEl.innerHTML = html;\n			}\n			this._progress.textContent = this.tour.options.showProgress\n				? format(this.labels.progress, [index + 1, n])\n				: \"\";\n			this._backBtn.disabled = index === 0;\n			this._nextBtn.textContent = last ? this.labels.done : this.labels.next;\n		};\n\n		// Keeps the spotlight on the target when it moves: page transitions, layout shifts, re-rendering.\n		Session.prototype._watch = function (found) {\n			var self = this;\n			if (this._ro) {\n				this._ro.disconnect();\n				this._ro = null;\n			}\n			clearInterval(this._poll);\n			if (!found) {\n				return;\n			}\n			if (typeof window.ResizeObserver === \"function\") {\n				this._ro = new window.ResizeObserver(this._reflow);\n				this._ro.observe(found.dom);\n			}\n			this._poll = setInterval(function () {\n				var f = self._found;\n				if (self._ended || !f) {\n					return;\n				}\n				if (!f.dom.isConnected && f.control && f.control.getDomRef) {\n					f.dom = f.control.getDomRef() || f.dom;\n				}\n				if (rectKey(f.dom.getBoundingClientRect()) !== self._rectKey || !isShown(f.dom)) {\n					self._position();\n				}\n			}, 100);\n		};\n\n		// While a step is up and the app is in use: find a control that appears later (the next screen), and go\n		// on by itself when the person has moved to the screen of the next step.\n		Session.prototype._startTick = function (index) {\n			var self = this;\n			clearInterval(this._tick);\n			if (!this.tour.options.interactive) {\n				return;\n			}\n			var step = this.tour.steps[index];\n			var next = this.tour.steps[index + 1];\n			var hash = window.location.hash;\n			this._tick = setInterval(function () {\n				if (self._ended || self.index !== index) {\n					return clearInterval(self._tick);\n				}\n				if (step.target && !self._found) {\n					var f = resolveTarget(self.registry, step.target);\n					if (f) {\n						self._found = f;\n						self._fill(step, index, self._title.textContent, null, false, true);\n						f.dom.scrollIntoView({ block: \"center\", inline: \"nearest\" });\n						self._position();\n						self._watch(f);\n					}\n				} else if (window.location.hash !== hash && next && next.target) {\n					if (resolveTarget(self.registry, next.target)) {\n						self.next();\n					}\n				}\n			}, 300);\n		};\n\n		Session.prototype._show = async function (index, direction) {\n			var self = this;\n			var token = ++this._token;\n			var steps = this.tour.steps;\n			var step = steps[index];\n			this.index = index;\n			this._bubble.style.visibility = \"hidden\";\n			this._ensureRoute(index, direction);\n\n			var found = null;\n			if (step.target) {\n				found = await this._waitFor(function () {\n					return resolveTarget(self.registry, step.target);\n				}, token);\n				if (token !== this._token) {\n					return;\n				}\n				if (!found) {\n					var message =\n						\"Target not found for step \" +\n						step.id +\n						\" (\" +\n						(step.target.controlId || JSON.stringify(step.target.fallbacks)) +\n						\")\";\n					Log.warning(message, LOG);\n					this._emit(\"error\", {\n						code: \"TARGET_NOT_FOUND\",\n						index: index,\n						step: step,\n						message: message\n					});\n					var next = index + direction;\n					if (this.opts.missingTarget === \"skip\" && next >= 0 && next < steps.length) {\n						return this._show(next, direction);\n					}\n					if (this.opts.missingTarget === \"skip\" && direction > 0) {\n						return this.finish();\n					}\n				}\n			}\n\n			var texts = await Promise.all([\n				resolveI18n(step.title, this.component),\n				resolveI18n(step.text, this.component)\n			]);\n			if (token !== this._token) {\n				return;\n			}\n			this._found = found;\n			this._fill(step, index, texts[0], texts[1], !!step.target && !found);\n			if (found) {\n				found.dom.scrollIntoView({ block: \"center\", inline: \"nearest\" });\n			}\n			this._position();\n			this._bubble.style.visibility = \"visible\";\n			this._bubble.focus({ preventScroll: true });\n			this._watch(found);\n			this._startTick(index);\n			this._emit(\"stepChanged\", { index: index, step: step, via: found ? found.via : null });\n		};\n\n		Session.prototype.start = function () {\n			this._prevFocus = document.activeElement;\n			this._build();\n			this._emit(\"started\", { tour: this.tour });\n			var first = this.opts.startIndex;\n			first =\n				typeof first === \"number\" && first >= 0 && first < this.tour.steps.length\n					? Math.floor(first)\n					: 0;\n			return this._show(first, 1);\n		};\n\n		Session.prototype.next = function () {\n			if (this._ended) {\n				return Promise.resolve();\n			}\n			return this.index >= this.tour.steps.length - 1\n				? this.finish()\n				: this._show(this.index + 1, 1);\n		};\n\n		Session.prototype.back = function () {\n			return !this._ended && this.index > 0 ? this._show(this.index - 1, -1) : Promise.resolve();\n		};\n\n		Session.prototype.goTo = function (index) {\n			if (this._ended || index < 0 || index >= this.tour.steps.length) {\n				return Promise.resolve();\n			}\n			return this._show(index, index >= this.index ? 1 : -1);\n		};\n\n		Session.prototype.finish = function () {\n			this._end(\"completed\");\n			return Promise.resolve();\n		};\n\n		/** @param {string} [reason] \"skipped\" (user closed it); anything else counts as \"stopped\" */\n		Session.prototype.stop = function (reason) {\n			this._end(reason === \"skipped\" ? \"skipped\" : \"stopped\");\n		};\n\n		Session.prototype._end = function (kind) {\n			if (this._ended) {\n				return;\n			}\n			this._ended = true;\n			this._token++;\n			if (this._ro) {\n				this._ro.disconnect();\n			}\n			clearInterval(this._poll);\n			window.removeEventListener(\"resize\", this._reflow);\n			document.removeEventListener(\"scroll\", this._reflow, true);\n			document.removeEventListener(\"keydown\", this._keyHandler, true);\n			if (this._clickHandler) {\n				document.removeEventListener(\"click\", this._clickHandler, true);\n			}\n			clearInterval(this._tick);\n			[this._shield, this._spot, this._bubble].forEach(function (n) {\n				if (n && n.parentNode) {\n					n.parentNode.removeChild(n);\n				}\n			});\n			if (this._prevFocus && this._prevFocus.isConnected && this._prevFocus.focus) {\n				this._prevFocus.focus({ preventScroll: true });\n			}\n			if (active === this) {\n				active = null;\n			}\n			this._emit(kind, { tour: this.tour, index: this.index });\n		};\n\n		// ---------------------------------------------------------------- public API\n\n		var active = null;\n\n		function normalizeTour(raw) {\n			if (!raw || !Array.isArray(raw.steps) || raw.steps.length === 0) {\n				throw new Error(\"TourPlayer: the tour has no steps\");\n			}\n			var o = raw.options || {};\n			return {\n				id: raw.id,\n				title: raw.title,\n				options: {\n					showProgress: o.showProgress !== false,\n					allowSkip: o.allowSkip !== false,\n					overlay: o.overlay !== false,\n					interactive: o.interactive !== false,\n					waitTimeoutMs: typeof o.waitTimeoutMs === \"number\" ? o.waitTimeoutMs : 5000\n				},\n				steps: raw.steps.map(function (s, i) {\n					return {\n						id: s.id || \"s\" + (i + 1),\n						title: s.title || \"\",\n						text: s.text || \"\",\n						target: s.target || null,\n						placement: s.placement || \"PreferredBottomOrFlip\",\n						before: s.before || [],\n						meta: s.meta\n					};\n				})\n			};\n		}\n\n		function loadTour(src) {\n			if (typeof src !== \"string\") {\n				return Promise.resolve(src);\n			}\n			return fetch(src).then(function (r) {\n				if (!r.ok) {\n					throw new Error(\"TourPlayer: could not load tour \" + src + \" (HTTP \" + r.status + \")\");\n				}\n				return r.json();\n			});\n		}\n\n		return {\n			version: VERSION,\n			renderMarkdown: renderMarkdown,\n\n			/**\n			 * @param {object|string} tourOrUrl tour object or URL of a tour.json\n			 * @param {object} [opts]\n			 * @param {sap.ui.core.Component} [opts.component] owning component (routing, i18n); auto-detected if omitted\n			 * @param {function(string, object)} [opts.onEvent] started | stepChanged | completed | skipped | stopped | error\n			 * @param {\"center\"|\"skip\"} [opts.missingTarget=\"center\"] what to do when a target cannot be found\n			 * @param {object} [opts.labels] override the English button/progress texts\n			 * @param {boolean} [opts.debug] show a warning in steps whose target is missing\n			 * @param {number} [opts.startIndex=0] step to begin with (designer preview)\n			 * @returns {Promise<Session>} resolves once the first step is shown\n			 */\n			start: function (tourOrUrl, opts) {\n				return Promise.all([loadTour(tourOrUrl), loadRegistry()]).then(function (res) {\n					if (active) {\n						active.stop();\n					}\n					var session = new Session(normalizeTour(res[0]), opts || {}, res[1]);\n					active = session;\n					return session.start().then(function () {\n						return session;\n					});\n				});\n			},\n\n			stop: function () {\n				if (active) {\n					active.stop();\n				}\n			},\n\n			getActive: function () {\n				return active;\n			},\n\n			/** Resolve a step target the same way the player does. */\n			resolve: function (target) {\n				return loadRegistry().then(function (registry) {\n					return resolveTarget(registry, target);\n				});\n			},\n\n			/** Resolve several targets at once (the help layer does this on every tick): an array of hit-or-null. */\n			resolveAll: function (targets) {\n				return loadRegistry().then(function (registry) {\n					return targets.map(function (t) {\n						return resolveTarget(registry, t);\n					});\n				});\n			},\n\n			/** \"{i18n>key}\" -> the text from the component's resource bundle; any other text is returned as it is. */\n			resolveI18n: resolveI18n\n		};\n	}\n);\n";
// ../node_modules/zod/v4/core/util.js
function t(e) {
	let t = Object.values(e).filter((e) => typeof e == "number");
	return Object.entries(e).filter(([e, n]) => t.indexOf(+e) === -1).map(([e, t]) => t);
}
function n(e, t = "|") {
	return e.map((e) => ce(e)).join(t);
}
function r(e, t) {
	return typeof t == "bigint" ? t.toString() : t;
}
var i = class {
	constructor(e) {
		this._getter = e, this._value = void 0;
	}
	get value() {
		let e = this._getter;
		return e !== void 0 && (this._value = e(), this._getter = void 0), this._value;
	}
};
function a(e) {
	return new i(e);
}
function o(e) {
	return e == null;
}
function s(e) {
	let t = +!!e.startsWith("^"), n = e.endsWith("$") ? e.length - 1 : e.length;
	return e.slice(t, n);
}
function c(e, t) {
	let n = e / t, r = Math.round(n), i = 4 * 2 ** -52 * Math.max(Math.abs(n), 1);
	return Math.abs(n - r) < i ? 0 : n - r;
}
function l(e, t, n) {
	Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
}
function u(e) {
	let t = Object.getOwnPropertyDescriptor(e, "shape");
	return t?.get ? t.get.raw : t?.value;
}
function d(e) {
	return u(e._zod.def) ?? e._zod.def.shape;
}
function f(e, t, n) {
	Object.defineProperty(e, t, {
		get() {
			let e = n();
			return l(this, t, e), e;
		},
		enumerable: !0,
		configurable: !0
	});
}
function p(e, t, n) {
	t in e ? l(e, t, n) : e[t] = n;
}
function m(e, t, n, r) {
	let i = d(t);
	for (let a of n) {
		let n = Object.getOwnPropertyDescriptor(i, a);
		n.enumerable && (n.get ? f(e, a, () => {
			let e = t._zod.def.shape[a];
			return r ? r(e, a) : e;
		}) : p(e, a, r ? r(n.value, a) : n.value));
	}
}
function ee(e, t) {
	for (let n of Reflect.ownKeys(t)) {
		let r = Object.getOwnPropertyDescriptor(t, n);
		r.enumerable && (r.get ? f(e, n, () => t[n]) : p(e, n, r.value));
	}
}
function h(...e) {
	let t = {};
	for (let n of e) {
		let e = Object.getOwnPropertyDescriptors(n);
		Object.assign(t, e);
	}
	return Object.defineProperties({}, t);
}
function te(e) {
	return JSON.stringify(e);
}
function ne(e) {
	return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var re = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {};
function ie(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
var ae = /* @__PURE__*/ a(() => {
	if (k.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
	try {
		return Function(""), !0;
	} catch {
		return !1;
	}
});
function g(e) {
	if (ie(e) === !1) return !1;
	let t = e.constructor;
	if (t === void 0 || typeof t != "function") return !0;
	let n = t.prototype;
	return ie(n) !== !1 && Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") !== !1;
}
function oe(e) {
	return g(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
var se = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function _(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function v(e, t, n) {
	let r = new e._zod.constr(t ?? e._zod.def);
	return (!t || n?.parent) && (r._zod.parent = e), r;
}
function y(e) {
	let t = e;
	if (!t) return {};
	if (typeof t == "string") return { error: () => t };
	if (t?.message !== void 0) {
		if (t?.error !== void 0) throw Error("Cannot specify both `message` and `error` params");
		t.error = t.message;
	}
	return delete t.message, typeof t.error == "string" ? {
		...t,
		error: () => t.error
	} : t;
}
function ce(e) {
	return typeof e == "bigint" ? e.toString() + "n" : typeof e == "string" ? `"${e}"` : `${e}`;
}
function le(e) {
	return Object.keys(e).filter((t) => e[t]._zod.optin !== void 0 && e[t]._zod.optout === "optional");
}
var ue = {
	safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}, de = {
	int64: [/* @__PURE__*/ BigInt("-9223372036854775808"), /* @__PURE__*/ BigInt("9223372036854775807")],
	uint64: [/* @__PURE__*/ BigInt(0), /* @__PURE__*/ BigInt("18446744073709551615")]
};
function fe(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".pick() cannot be used on object schemas containing refinements");
	let i = {};
	return m(i, e, pe(e, t)), v(e, h(n, {
		shape: i,
		checks: []
	}));
}
function pe(e, t) {
	let n = d(e), r = [];
	for (let e of Reflect.ownKeys(t)) {
		if (!Object.getOwnPropertyDescriptor(n, e)?.enumerable) throw Error(`Unrecognized key: "${String(e)}"`);
		t[e] && r.push(e);
	}
	return r;
}
function me(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".omit() cannot be used on object schemas containing refinements");
	let i = new Set(pe(e, t)), a = {};
	return m(a, e, Reflect.ownKeys(d(e)).filter((e) => !i.has(e))), v(e, h(n, {
		shape: a,
		checks: []
	}));
}
function he(e, t) {
	if (!g(t)) throw Error("Invalid input to extend: expected a plain object");
	let n = e._zod.def.checks;
	if (n && n.length > 0) {
		let n = d(e);
		for (let e of Reflect.ownKeys(t)) if (Object.getOwnPropertyDescriptor(n, e) !== void 0) throw Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return v(e, h(e._zod.def, { shape: ge(e, t) }));
}
function ge(e, t) {
	let n = {};
	return m(n, e, Reflect.ownKeys(d(e))), ee(n, t), n;
}
function _e(e, t) {
	if (!g(t)) throw Error("Invalid input to safeExtend: expected a plain object");
	return v(e, h(e._zod.def, { shape: ge(e, t) }));
}
function ve(e, t) {
	if (!t?._zod?.def) throw Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
	if (e._zod.def.checks?.length) throw Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	let n = {};
	return m(n, e, Reflect.ownKeys(d(e))), m(n, t, Reflect.ownKeys(d(t))), v(e, h(e._zod.def, {
		shape: n,
		get catchall() {
			return t._zod.def.catchall;
		},
		checks: t._zod.def.checks ?? []
	}));
}
function ye(e, t, n, r = "partial") {
	let i = t._zod.def.checks;
	if (i && i.length > 0) throw Error(`.${r}() cannot be used on object schemas containing refinements`);
	let a = n ? new Set(pe(t, n)) : void 0, o = {};
	return m(o, t, Reflect.ownKeys(d(t)), e && ((t, n) => a && !a.has(n) ? t : new e({
		type: "optional",
		innerType: t
	}))), v(t, h(t._zod.def, {
		shape: o,
		checks: []
	}));
}
function be(e, t, n) {
	let r = n ? new Set(pe(t, n)) : void 0, i = {};
	return m(i, t, Reflect.ownKeys(d(t)), (t, n) => r && !r.has(n) ? t : new e({
		type: "nonoptional",
		innerType: t
	})), v(t, h(t._zod.def, { shape: i }));
}
function b(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
	return !1;
}
function xe(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0;
	return !1;
}
function x(e, t) {
	return t.map((t) => {
		var n;
		return (n = t).path ?? (n.path = []), t.path.unshift(e), t;
	});
}
function Se(e) {
	return typeof e == "string" ? e : e?.message;
}
function Ce(e) {
	let t = [];
	for (let n of e ?? []) {
		let e = n._zod.def;
		if (!/_(length|size)$|_equals$/.test(e.check)) break;
		let r = e.maximum ?? e.length ?? e.size;
		r >= 0 && t.push([r, n]);
	}
	return t;
}
function we(e, t, n) {
	var r;
	for (let i = t; i < e.length; i++) (r = e[i]).schema ?? (r.schema = n);
}
function S(e, t, n) {
	var r;
	let i = e.inst?._zod?.traits;
	i?.has("$ZodType") && (i.has("$ZodCheck") ? (r = e).schema ?? (r.schema = e.inst) : e.schema = e.inst);
	let a = e.schema === e.inst ? void 0 : e.schema?._zod.def?.error, o = e.message ? e.message : Se(e.inst?._zod.def?.error?.(e)) ?? Se(a?.(e)) ?? Se(t?.error?.(e)) ?? Se(n.customError?.(e)) ?? Se(n.localeError?.(e)) ?? "Invalid input", s = {};
	for (let t of Object.keys(e)) t !== "inst" && t !== "schema" && t !== "continue" && t !== "input" && t !== "__proto__" && (s[t] = e[t]);
	return s.path ??= [], s.message = o, t?.reportInput && (s.input = e.input), s;
}
var Te = /[\uD800-\uDBFF]/;
function Ee(e) {
	let t = e.length;
	if (!Te.test(e)) return t;
	let n = t;
	for (let r = 0; r < t - 1; r++) (e.charCodeAt(r) & 64512) == 55296 && (e.charCodeAt(r + 1) & 64512) == 56320 && (n--, r++);
	return n;
}
function De(e) {
	return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function Oe(e) {
	let t = typeof e;
	switch (t) {
		case "number": return Number.isNaN(e) ? "nan" : "number";
		case "object": {
			if (e === null) return "null";
			if (Array.isArray(e)) return "array";
			let t = e;
			if (t && Object.getPrototypeOf(t) !== Object.prototype && "constructor" in t && t.constructor) return t.constructor.name;
		}
	}
	return t;
}
function C(...e) {
	let [t, n, r] = e;
	return typeof t == "string" ? {
		message: t,
		code: "custom",
		input: n,
		inst: r
	} : { ...t };
}
function ke(e, t) {
	for (let n in t) {
		let r = Object.getOwnPropertyDescriptor(t, n);
		r.get ? Object.defineProperty(e, n, {
			...r,
			enumerable: !1
		}) : Me(e, n, r.value);
	}
}
function w(e, t, n, r = !0) {
	return Object.defineProperty(e, t, {
		configurable: !0,
		writable: !0,
		enumerable: r,
		value: n
	}), n;
}
function Ae(e, t, n) {
	return w(e, t, n, !1);
}
/* @__NO_SIDE_EFFECTS__ */
function je(e, t) {
	for (let n in e) {
		let r = e[n];
		Object.defineProperty(t, n, {
			configurable: !0,
			enumerable: !0,
			get() {
				return w(this, n, r(this));
			},
			set(e) {
				w(this, n, e);
			}
		});
	}
	return t;
}
function Me(e, t, n) {
	Object.defineProperty(e, t, {
		configurable: !0,
		get() {
			return this == null ? n : w(this, t, n.bind(this));
		},
		set(e) {
			w(this, t, e);
		}
	});
}
function Ne(e, t) {
	let n = Object.getPrototypeOf(e);
	return t in n ? void 0 : n;
}
var Pe, T = !1, Fe = {
	configurable: !0,
	get() {
		T = !0;
	}
};
function E(e, t, n) {
	let r = Object.getPrototypeOf(e._zod);
	t in r && Pe !== e._zod ? Pe = void 0 : (Pe = e._zod, Object.defineProperty(r, t, {
		configurable: !0,
		get() {
			Object.defineProperty(this, t, Fe);
			let e = T;
			T = !1;
			try {
				let r = n(this);
				return T ? delete this[t] : Object.defineProperty(this, t, {
					configurable: !0,
					writable: !0,
					value: r
				}), T ||= e, r;
			} catch (n) {
				throw delete this[t], T ||= e, n;
			}
		},
		set(e) {
			Object.defineProperty(this, t, {
				configurable: !0,
				writable: !0,
				value: e
			});
		}
	}));
}
function Ie(e, t, n, r) {
	let i = Ne(e, t);
	i && Object.defineProperty(i, t, {
		configurable: !0,
		get() {
			let e = {
				configurable: !0,
				writable: !0,
				enumerable: r,
				value: void 0
			};
			return Object.defineProperty(this, t, e), e.value = n(this), Object.defineProperty(this, t, e), e.value;
		},
		set(e) {
			Object.defineProperty(this, t, {
				configurable: !0,
				writable: !0,
				enumerable: r,
				value: e
			});
		}
	});
}
var Le = "~constantCatch";
function Re(e) {
	let t = () => e;
	return t[Le] = !0, t;
}
// ../node_modules/zod/v4/core/core.js
var ze, Be = {
	value: void 0,
	enumerable: !1
}, Ve = "captureStackTrace" in Error ? Error : null;
function He(e) {
	let t = Ve;
	if (t) {
		let n = t.stackTraceLimit;
		if (typeof n == "number") {
			try {
				t.stackTraceLimit = 0;
			} catch {
				return Ve = null, new e();
			}
			try {
				return new e();
			} finally {
				t.stackTraceLimit = n;
			}
		}
	}
	return new e();
}
/* @__NO_SIDE_EFFECTS__ */
function D(e, t, n, r) {
	let i = {};
	function a(e) {
		this.def = e, this.constr = d, this.traits = /* @__PURE__ */ new Set();
	}
	a.prototype = i;
	let o = n, s = o && /* @__PURE__ */ new WeakSet();
	function c(n, r) {
		if (!n._zod) {
			Be.value = new a(r);
			try {
				Object.defineProperty(n, "_zod", Be);
			} finally {
				Be.value = void 0;
			}
		} else if (n._zod.traits.has(e)) return;
		if (n._zod.traits.add(e), t(n, r), s) {
			let e = Object.getPrototypeOf(n), t = n._zod.constr.prototype, r = e;
			for (; r && r !== t;) r = Object.getPrototypeOf(r);
			let i = r ?? e;
			s.has(i) || (s.add(i), ke(i, o));
		}
		let i = d.prototype;
		for (let e in i) Object.prototype.hasOwnProperty.call(i, e) && (e in n || (n[e] = i[e].bind(n)));
	}
	let l = r?.Parent ?? Object;
	class u extends l {}
	Object.defineProperty(u, "name", { value: e });
	function d(e) {
		let t = r?.Parent ? He(u) : this;
		c(t, e);
		let n = t._zod.deferred;
		if (n) {
			for (let e of n) e();
			t._zod.deferred = void 0;
		}
		let i = globalThis.__zod_globalConfig?.postProcessor;
		return i && i(t), t;
	}
	return Object.defineProperty(d, "init", { value: c }), Object.defineProperty(d, Symbol.hasInstance, { value: (t) => r?.Parent && t instanceof r.Parent ? !0 : t?._zod?.traits?.has(e) }), Object.defineProperty(d, "name", { value: e }), d;
}
var O = class extends Error {
	constructor() {
		super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
	}
}, Ue = class extends Error {
	constructor(e) {
		super(`Encountered unidirectional transform during encode: ${e}`), this.name = "ZodEncodeError";
	}
};
(ze = globalThis).__zod_globalConfig ?? (ze.__zod_globalConfig = {});
var k = globalThis.__zod_globalConfig;
function A(e) {
	return e && Object.assign(k, e), k;
}
// ../node_modules/zod/v4/core/errors.js
function We() {
	let e = this._zod;
	return e.message ??= JSON.stringify(e.def, r, 2), e.message;
}
function Ge(e) {
	this._zod.message = e;
}
var Ke = {
	get: We,
	set: Ge,
	enumerable: !0,
	configurable: !0
}, qe = {
	value: void 0,
	enumerable: !1
}, Je = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]), Ye = /* @__PURE__ */ D("$ZodError", (e, t) => {
	e.name = "$ZodError", qe.value = t, Object.defineProperty(e, "issues", qe), qe.value = void 0, Object.defineProperty(e, "message", Ke);
	let n = Object.getPrototypeOf(e);
	Je.has(n) || (Je.add(n), Object.defineProperty(n, "toString", {
		configurable: !0,
		enumerable: !1,
		get() {
			let e = () => this.message;
			return Object.defineProperty(this, "toString", {
				value: e,
				configurable: !0,
				writable: !0
			}), e;
		},
		set(e) {
			Object.defineProperty(this, "toString", {
				value: e,
				configurable: !0,
				writable: !0
			});
		}
	}));
});
function Xe(e, t, n) {
	return Object.prototype.hasOwnProperty.call(e, t) || (t === "__proto__" ? Object.defineProperty(e, t, {
		value: n(),
		writable: !0,
		enumerable: !0,
		configurable: !0
	}) : e[t] = n()), e[t];
}
function Ze(e, t = (e) => e.message) {
	let n = {}, r = [];
	for (let i of e.issues) i.path.length > 0 ? Xe(n, i.path[0], () => []).push(t(i)) : r.push(t(i));
	return {
		formErrors: r,
		fieldErrors: n
	};
}
function Qe(e, t = (e) => e.message) {
	let n = { _errors: [] }, r = (e, i = []) => {
		for (let a of e.issues) if (a.code === "invalid_union" && a.errors.length) a.errors.map((e) => r({ issues: e }, [...i, ...a.path]));
		else if (a.code === "invalid_key") r({ issues: a.issues }, [...i, ...a.path]);
		else if (a.code === "invalid_element") r({ issues: a.issues }, [...i, ...a.path]);
		else {
			let e = [...i, ...a.path];
			if (e.length === 0) n._errors.push(t(a));
			else {
				let r = n, i = 0;
				for (; i < e.length;) {
					let n = e[i], o = i === e.length - 1;
					if (n === "_errors") {
						o && r._errors.push(t(a)), i++;
						continue;
					}
					Object.prototype.hasOwnProperty.call(r, n) || Object.defineProperty(r, n, {
						value: { _errors: [] },
						enumerable: !0,
						writable: !0,
						configurable: !0
					});
					let s = r[n];
					o && s._errors.push(t(a)), r = s, i++;
				}
			}
		}
	};
	return r(e), n;
}
// ../node_modules/zod/v4/core/parse.js
function $e(e, t) {
	return {
		callee: t?.callee ?? e,
		Err: t?.Err
	};
}
var et = (e) => {
	let t = (n, r, i, a) => {
		let o = i ? {
			...i,
			async: !1
		} : { async: !1 }, s = n._zod.run({
			value: r,
			issues: []
		}, o);
		if (s instanceof Promise) throw new O();
		if (s.issues.length) {
			let n = new ((a?.Err) ?? e)(s.issues.map((e) => S(e, o, A())));
			throw re(n, a?.callee ?? t), n;
		}
		return s.value;
	};
	return t;
}, tt = (e) => {
	let t = async (n, r, i, a) => {
		let o = i ? {
			...i,
			async: !0
		} : { async: !0 }, s = n._zod.run({
			value: r,
			issues: []
		}, o);
		if (s instanceof Promise && (s = await s), s.issues.length) {
			let n = new ((a?.Err) ?? e)(s.issues.map((e) => S(e, o, A())));
			throw re(n, a?.callee ?? t), n;
		}
		return s.value;
	};
	return t;
}, nt = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		async: !1
	} : { async: !1 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	if (a instanceof Promise) throw new O();
	return a.issues.length ? rt(e, a.issues, i) : {
		success: !0,
		data: a.value
	};
};
function rt(e, t, n) {
	let r;
	return {
		success: !1,
		get error() {
			return r || (r = new e(t.map((e) => S(e, n, A()))), t = void 0, n = void 0), r;
		},
		set error(e) {
			r = e, t = void 0, n = void 0;
		}
	};
}
var it = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		async: !0
	} : { async: !0 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	return a instanceof Promise && (a = await a), a.issues.length ? rt(e, a.issues, i) : {
		success: !0,
		data: a.value
	};
}, at = /* @__PURE__ */ Symbol.for("zod.compile.invalid"), ot = /* @__PURE__ */ Symbol.for("zod.compile.fallback"), st = ((e, t, n) => {
	let r = e._zod.bag.validator;
	if (r !== void 0) {
		if (r(t) !== at) return !0;
		if (r.definite === !0 && n === void 0) return !1;
	}
	return ct(e, t, n);
});
function ct(e, t, n) {
	let r = n ? {
		...n,
		async: !1,
		abortEarly: !0
	} : {
		async: !1,
		abortEarly: !0
	}, i = e._zod.bag.fallbackRun, a;
	if (i ? (r[ot] = !0, a = i({
		value: t,
		issues: []
	}, r)) : a = e._zod.run({
		value: t,
		issues: []
	}, r), a instanceof Promise) throw new O();
	return a.issues.length === 0;
}
var lt = async (e, t, n) => {
	let r = n ? {
		...n,
		async: !0,
		abortEarly: !0
	} : {
		async: !0,
		abortEarly: !0
	}, i = e._zod.run({
		value: t,
		issues: []
	}, r);
	return i instanceof Promise && (i = await i), i.issues.length === 0;
}, ut = (e) => {
	let t = et(e), n = (e, r, i, a) => {
		let o = i ? {
			...i,
			direction: "backward"
		} : { direction: "backward" };
		return t(e, r, o, $e(n, a));
	};
	return n;
}, dt = (e) => {
	let t = et(e), n = (e, r, i, a) => t(e, r, i, $e(n, a));
	return n;
}, ft = (e) => {
	let t = tt(e), n = async (e, r, i, a) => {
		let o = i ? {
			...i,
			direction: "backward"
		} : { direction: "backward" };
		return await t(e, r, o, $e(n, a));
	};
	return n;
}, pt = (e) => {
	let t = tt(e), n = async (e, r, i, a) => await t(e, r, i, $e(n, a));
	return n;
}, mt = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return nt(e)(t, n, i);
}, ht = (e) => (t, n, r) => nt(e)(t, n, r), gt = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return it(e)(t, n, i);
}, _t = (e) => async (t, n, r) => it(e)(t, n, r), vt = /^[cC][0-9a-z]{6,}$/, yt = /^[0-9a-z]+$/, bt = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/, xt = /^[0-9a-vA-V]{20}$/, St = /^[A-Za-z0-9]{27}$/, Ct = /^[a-zA-Z0-9_-]{21}$/;
function wt(e) {
	return RegExp(`^[a-zA-Z0-9_-]{${e}}$`);
}
var Tt = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, Et = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, Dt = (e) => e ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, Ot = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, kt = "^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$";
function At() {
	return new RegExp(kt, "u");
}
var jt = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, Mt = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, Nt = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, Pt = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, Ft = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, It = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/, Lt = /^https?$/, Rt = /^\+[1-9]\d{6,14}$/, zt = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
function Bt(e) {
	return RegExp(`^${e}$`);
}
var Vt = /*@__PURE__*/ Bt(zt);
function Ht(e) {
	let t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
	return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : e.seconds ? `${t}:[0-5]\\d(?:\\.\\d+)?` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function Ut(e) {
	return RegExp(`^${Ht(e)}$`);
}
function Wt(e) {
	let t = ["Z"];
	e.offset && t.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
	let n = `${Ht({
		precision: e.precision,
		seconds: !0
	})}(?:${t.join("|")})`, r = e.local ? `${n}|${Ht({ precision: e.precision })}` : n;
	return RegExp(`^${zt}T(?:${r})$`);
}
var Gt = /^[\s\S]{0,}$/, Kt = /^-?\d+$/, qt = /^-?\d+(?:\.\d+)?$/, Jt = /^(?:true|false)$/i, Yt = /^[^A-Z]*$/, Xt = /^[^a-z]*$/, j = /*@__PURE__*/ D("$ZodCheck", (e, t) => {
	var n;
	e._zod ??= {}, e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), Zt = (e) => {
	let t = e.value;
	return !o(t) && t.length !== void 0;
}, Qt = {
	number: "number",
	bigint: "bigint",
	object: "date"
}, $t = /*@__PURE__*/ D("$ZodCheckLessThan", (e, t) => {
	j.init(e, t);
	let n = Qt[typeof t.value];
	e._zod.check = (r) => {
		(t.inclusive ? r.value <= t.value : r.value < t.value) || r.issues.push({
			origin: Qt[typeof r.value] ?? n,
			code: "too_big",
			maximum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), en = /*@__PURE__*/ D("$ZodCheckGreaterThan", (e, t) => {
	j.init(e, t);
	let n = Qt[typeof t.value];
	e._zod.check = (r) => {
		(t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
			origin: Qt[typeof r.value] ?? n,
			code: "too_small",
			minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), tn = /*@__PURE__*/ D("$ZodCheckMultipleOf", (e, t) => {
	j.init(e, t), e._zod.check = (n) => {
		if (typeof n.value != typeof t.value) throw Error("Cannot mix number and bigint in multiple_of check.");
		(typeof n.value == "bigint" ? t.value !== BigInt(0) && n.value % t.value === BigInt(0) : c(n.value, t.value) === 0) || n.issues.push({
			origin: typeof n.value,
			code: "not_multiple_of",
			divisor: t.value,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), nn = /*@__PURE__*/ D("$ZodCheckNumberFormat", (e, t) => {
	j.init(e, t), t.format = t.format || "float64";
	let n = t.format?.includes("int"), r = n ? "int" : "number", [i, a] = ue[t.format];
	e._zod.check = (o) => {
		let s = o.value;
		if (n) {
			if (!Number.isInteger(s)) {
				o.issues.push({
					expected: r,
					format: t.format,
					code: "invalid_type",
					continue: !1,
					input: s,
					inst: e
				});
				return;
			}
			if (!Number.isSafeInteger(s)) {
				s > 0 ? o.issues.push({
					input: s,
					code: "too_big",
					maximum: 2 ** 53 - 1,
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					inclusive: !0,
					continue: !t.abort
				}) : o.issues.push({
					input: s,
					code: "too_small",
					minimum: -(2 ** 53 - 1),
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					inclusive: !0,
					continue: !t.abort
				});
				return;
			}
		}
		s < i && o.issues.push({
			origin: "number",
			input: s,
			code: "too_small",
			minimum: i,
			inclusive: !0,
			inst: e,
			continue: !t.abort
		}), s > a && o.issues.push({
			origin: "number",
			input: s,
			code: "too_big",
			maximum: a,
			inclusive: !0,
			inst: e,
			continue: !t.abort
		});
	};
}), rn = /*@__PURE__*/ D("$ZodCheckMaxLength", (e, t) => {
	var n;
	j.init(e, t), (n = e._zod.def).when ?? (n.when = Zt), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if ((typeof r == "string" && i > t.maximum ? Ee(r) : i) <= t.maximum) return;
		let a = De(r);
		n.issues.push({
			origin: a,
			code: "too_big",
			maximum: t.maximum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), an = /*@__PURE__*/ D("$ZodCheckMinLength", (e, t) => {
	var n;
	j.init(e, t), (n = e._zod.def).when ?? (n.when = Zt), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if ((typeof r == "string" && i >= t.minimum && i < t.minimum * 2 ? Ee(r) : i) >= t.minimum) return;
		let a = De(r);
		n.issues.push({
			origin: a,
			code: "too_small",
			minimum: t.minimum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), on = /*@__PURE__*/ D("$ZodCheckLengthEquals", (e, t) => {
	var n;
	j.init(e, t), (n = e._zod.def).when ?? (n.when = Zt), e._zod.check = (n) => {
		let r = n.value, i = r.length, a = typeof r == "string" && i >= t.length && i <= t.length * 2 ? Ee(r) : i;
		if (a === t.length) return;
		let o = De(r), s = a > t.length;
		n.issues.push({
			origin: o,
			...s ? {
				code: "too_big",
				maximum: t.length
			} : {
				code: "too_small",
				minimum: t.length
			},
			inclusive: !0,
			exact: !0,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), sn = /*@__PURE__*/ D("$ZodCheckStringFormat", (e, t) => {
	var n, r;
	j.init(e, t), t.pattern ? (n = e._zod).check ?? (n.check = (n) => {
		t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: t.format,
			input: n.value,
			...t.pattern ? { pattern: t.pattern.toString() } : {},
			inst: e,
			continue: !t.abort
		});
	}) : (r = e._zod).check ?? (r.check = () => {});
}), cn = /*@__PURE__*/ D("$ZodCheckRegex", (e, t) => {
	sn.init(e, t), e._zod.check = (n) => {
		t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: n.value,
			pattern: t.pattern.toString(),
			inst: e,
			continue: !t.abort
		});
	};
}), ln = /*@__PURE__*/ D("$ZodCheckLowerCase", (e, t) => {
	t.pattern ??= Yt, sn.init(e, t);
}), un = /*@__PURE__*/ D("$ZodCheckUpperCase", (e, t) => {
	t.pattern ??= Xt, sn.init(e, t);
}), dn = /*@__PURE__*/ D("$ZodCheckIncludes", (e, t) => {
	j.init(e, t);
	let n = _(t.includes);
	t.pattern = new RegExp(typeof t.position == "number" ? `^.{${t.position},}${n}` : n), e._zod.check = (n) => {
		n.value.includes(t.includes, t.position) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: t.includes,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), fn = /*@__PURE__*/ D("$ZodCheckStartsWith", (e, t) => {
	j.init(e, t);
	let n = RegExp(`^${_(t.prefix)}.*`);
	t.pattern ??= n, e._zod.check = (n) => {
		n.value.startsWith(t.prefix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: t.prefix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), pn = /*@__PURE__*/ D("$ZodCheckEndsWith", (e, t) => {
	j.init(e, t);
	let n = RegExp(`.*${_(t.suffix)}$`);
	t.pattern ??= n, e._zod.check = (n) => {
		n.value.endsWith(t.suffix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: t.suffix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), mn = /*@__PURE__*/ D("$ZodCheckOverwrite", (e, t) => {
	j.init(e, t), e._zod.check = (e) => {
		e.value = t.tx(e.value);
	};
}), hn = class {
	constructor(e = [], t = {}) {
		this.content = [], this.indent = 0, this.args = e, this.closed = t;
	}
	indented(e) {
		this.indent += 1;
		try {
			e(this);
		} finally {
			--this.indent;
		}
	}
	write(e) {
		if (typeof e == "function") {
			e(this, { execution: "sync" }), e(this, { execution: "async" });
			return;
		}
		let t = e.split("\n").filter((e) => e), n = Math.min(...t.map((e) => e.length - e.trimStart().length)), r = t.map((e) => e.slice(n)).map((e) => " ".repeat(this.indent * 2) + e);
		for (let e of r) this.content.push(e);
	}
	compile() {
		let e = Function, t = this?.content ?? [""];
		return new e(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {\n${t.join("\n")}\n};`)(...Object.values(this.closed));
	}
}, gn = {
	major: 4,
	minor: 6,
	patch: 7
}, M = /*@__PURE__*/ D("$ZodType", (e, t) => {
	var n;
	e ??= {}, e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = gn;
	let r = e._zod.def.checks, i = e._zod.traits.has("$ZodCheck") ? [e, ...r ?? []] : r?.length ? [...r] : [];
	for (let t of i) for (let n of t._zod.onattach) n(e);
	if (i.length === 0) (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
		e._zod.run = e._zod.parse;
	});
	else {
		let t = (t, n, r) => {
			if (t.memo) return t;
			let i = b(t), a;
			for (let o of n) {
				if (o._zod.def.when) {
					if (xe(t) || !o._zod.def.when(t)) continue;
				} else if (i) continue;
				let n = t.issues.length, s = o._zod.check(t);
				if (s instanceof Promise && r?.async === !1) throw new O();
				if (a || s instanceof Promise) a = (a ?? Promise.resolve()).then(async () => {
					await s, t.issues.length !== n && (we(t.issues, n, e), i ||= b(t, n));
				});
				else {
					if (t.issues.length === n) continue;
					we(t.issues, n, e), i ||= b(t, n);
				}
			}
			return a ? a.then(() => t) : t;
		}, n = (n, r, a) => {
			if (b(n)) return n.aborted = !0, n;
			let o = t(r, i, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new O();
				return o.then((t) => e._zod.parse(t, a));
			}
			return e._zod.parse(o, a);
		};
		e._zod.run = (r, a) => {
			if (a.skipChecks) return e._zod.parse(r, a);
			if (a.direction === "backward") {
				let t = e._zod.parse({
					value: r.value,
					issues: []
				}, {
					...a,
					skipChecks: !0
				});
				return t instanceof Promise ? t.then((e) => n(e, r, a)) : n(t, r, a);
			}
			let o = e._zod.parse(r, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new O();
				return o.then((e) => t(e, i, a));
			}
			return t(o, i, a);
		};
	}
}, {
	get "~standard"() {
		return Ae(this, "~standard", yn(this));
	},
	set "~standard"(e) {
		w(this, "~standard", e);
	}
}), _n = (e, t) => e.issues.length ? { issues: e.issues.map((e) => S(e, t, A())) } : { value: e.value };
async function vn(e, t) {
	let n = { async: !0 };
	return _n(await e._zod.run({
		value: t,
		issues: []
	}, n), n);
}
function yn(e) {
	return {
		validate: (t) => {
			let n = { async: !1 };
			try {
				let r = e._zod.run({
					value: t,
					issues: []
				}, n);
				if (!(r instanceof Promise)) return _n(r, n);
			} catch {}
			return vn(e, t);
		},
		vendor: "zod",
		version: 1
	};
}
var bn = /*@__PURE__*/ D("$ZodString", (e, t) => {
	M.init(e, t), e._zod.pattern = t.pattern ?? Gt, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = String(n.value);
		} catch {}
		return typeof n.value == "string" || n.issues.push({
			expected: "string",
			code: "invalid_type",
			input: n.value,
			inst: e
		}), n;
	};
}), N = /*@__PURE__*/ D("$ZodStringFormat", (e, t) => {
	sn.init(e, t), bn.init(e, t);
}), xn = /*@__PURE__*/ D("$ZodGUID", (e, t) => {
	t.pattern ??= Et, N.init(e, t);
}), Sn = /*@__PURE__*/ D("$ZodUUID", (e, t) => {
	if (t.version) {
		let e = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[t.version];
		if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`);
		t.pattern ??= Dt(e);
	} else t.pattern ??= Dt();
	N.init(e, t);
}), Cn = /*@__PURE__*/ D("$ZodEmail", (e, t) => {
	t.pattern ??= Ot, N.init(e, t);
});
function wn(e) {
	try {
		return typeof URL < "u" && typeof URL.canParse == "function" ? URL.canParse(e) : (new URL(e), !0);
	} catch {
		return !1;
	}
}
function Tn(e, t) {
	return !("normalize" in t) && !("hostname" in t) && !("protocol" in t) ? wn(e) || 2 : En(e, t);
}
function En(e, t) {
	if (!t.normalize && t.protocol?.source === Lt.source && !/^https?:\/\//i.test(e)) return 1;
	try {
		if (typeof URL < "u") {
			let t = URL;
			if (typeof t.parse == "function") return t.parse(e) ?? 2;
		}
		return new URL(e);
	} catch {
		return 2;
	}
}
var Dn = /[\t\n\r]/g;
function On(e) {
	return e.replace(Dn, "");
}
function kn(e, t) {
	return t.lastIndex = 0, t.test(e.hostname);
}
function An(e, t) {
	return t.lastIndex = 0, t.test(e.protocol.endsWith(":") ? e.protocol.slice(0, -1) : e.protocol);
}
var jn = /*@__PURE__*/ D("$ZodURL", (e, t) => {
	N.init(e, t), e._zod.check = (n) => {
		try {
			let r = n.value.trim(), i = Tn(r, t);
			if (i === 1) {
				n.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid URL format",
					input: n.value,
					inst: e,
					continue: !t.abort
				});
				return;
			}
			if (i === 2) {
				n.issues.push({
					code: "invalid_format",
					format: "url",
					input: n.value,
					inst: e,
					continue: !t.abort
				});
				return;
			}
			if (i === !0) {
				n.value = On(r);
				return;
			}
			t.hostname && !kn(i, t.hostname) && n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: t.hostname.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			}), t.protocol && !An(i, t.protocol) && n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: t.protocol.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			}), n.value = t.normalize ? i.href : On(r);
			return;
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "url",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
}), Mn = /*@__PURE__*/ D("$ZodEmoji", (e, t) => {
	t.pattern ??= At(), N.init(e, t);
}), Nn = /*@__PURE__*/ D("$ZodNanoID", (e, t) => {
	if (t.length !== void 0 && (!Number.isInteger(t.length) || t.length < 1)) throw Error(`Invalid nanoid length: ${t.length}`);
	t.pattern ??= t.length === void 0 ? Ct : wt(t.length), N.init(e, t);
}), Pn = /*@__PURE__*/ D("$ZodCUID", (e, t) => {
	t.pattern ??= vt, N.init(e, t);
}), Fn = /*@__PURE__*/ D("$ZodCUID2", (e, t) => {
	t.pattern ??= yt, N.init(e, t);
}), In = /*@__PURE__*/ D("$ZodULID", (e, t) => {
	t.pattern ??= bt, N.init(e, t);
}), Ln = /*@__PURE__*/ D("$ZodXID", (e, t) => {
	t.pattern ??= xt, N.init(e, t);
}), Rn = /*@__PURE__*/ D("$ZodKSUID", (e, t) => {
	t.pattern ??= St, N.init(e, t);
}), zn = /*@__PURE__*/ D("$ZodISODateTime", (e, t) => {
	t.pattern ??= Wt(t), N.init(e, t);
}), Bn = /*@__PURE__*/ D("$ZodISODate", (e, t) => {
	t.pattern ??= Vt, N.init(e, t);
}), Vn = /*@__PURE__*/ D("$ZodISOTime", (e, t) => {
	t.pattern ??= Ut(t), N.init(e, t);
}), Hn = /*@__PURE__*/ D("$ZodISODuration", (e, t) => {
	t.pattern ??= Tt, N.init(e, t);
}), Un = /*@__PURE__*/ D("$ZodIPv4", (e, t) => {
	t.pattern ??= jt, N.init(e, t);
}), Wn = /^[0-9a-fA-F:.]+$/;
function Gn(e) {
	return Wn.test(e) ? wn(`http://[${e}]`) : !1;
}
var Kn = /*@__PURE__*/ D("$ZodIPv6", (e, t) => {
	t.pattern ??= Mt, N.init(e, t), e._zod.check = (n) => {
		Gn(n.value) || n.issues.push({
			code: "invalid_format",
			format: "ipv6",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), qn = /*@__PURE__*/ D("$ZodCIDRv4", (e, t) => {
	t.pattern ??= Nt, N.init(e, t);
});
function Jn(e) {
	let t = e.split("/");
	if (t.length !== 2) return !1;
	let [n, r] = t;
	if (!r) return !1;
	let i = Number(r);
	return `${i}` !== r || i < 0 || i > 128 ? !1 : Gn(n);
}
var Yn = /*@__PURE__*/ D("$ZodCIDRv6", (e, t) => {
	t.pattern ??= Pt, N.init(e, t), e._zod.check = (n) => {
		Jn(n.value) || n.issues.push({
			code: "invalid_format",
			format: "cidrv6",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
});
function Xn(e) {
	if (e === "") return !0;
	if (/\s/.test(e) || e.length % 4 != 0) return !1;
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}
var Zn = /^[0-9a-zA-Z+/]*={0,2}$/, Qn = /*@__PURE__*/ D("$ZodBase64", (e, t) => {
	t.pattern ??= Zn, N.init(e, t), e._zod.check = (n) => {
		Xn(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), $n = /^[A-Za-z0-9_-]*$/;
function er(e) {
	if (!$n.test(e)) return !1;
	let t = e.replace(/[-_]/g, (e) => e === "-" ? "+" : "/");
	return Xn(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
}
var tr = /*@__PURE__*/ D("$ZodBase64URL", (e, t) => {
	t.pattern ??= $n, N.init(e, t), e._zod.check = (n) => {
		er(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), nr = /*@__PURE__*/ D("$ZodE164", (e, t) => {
	t.pattern ??= Rt, N.init(e, t);
});
function rr(e, t = null) {
	try {
		let n = e.split(".");
		if (n.length !== 3) return !1;
		let [r] = n;
		if (!r) return !1;
		let i = JSON.parse(atob(r));
		return !("typ" in i && i?.typ !== "JWT" || !i.alg || t && (!("alg" in i) || i.alg !== t));
	} catch {
		return !1;
	}
}
var ir = /*@__PURE__*/ D("$ZodJWT", (e, t) => {
	N.init(e, t), e._zod.check = (n) => {
		rr(n.value, t.alg) || n.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), ar = /*@__PURE__*/ D("$ZodNumber", (e, t) => {
	M.init(e, t), e._zod.pattern = qt, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = Number(n.value);
		} catch {}
		let i = n.value;
		if (typeof i == "number" && !Number.isNaN(i) && Number.isFinite(i)) return n;
		let a = typeof i == "number" ? Number.isNaN(i) ? "NaN" : Number.isFinite(i) ? void 0 : String(i) : void 0;
		return n.issues.push({
			expected: "number",
			code: "invalid_type",
			input: i,
			inst: e,
			...a ? { received: a } : {}
		}), n;
	};
}), or = /*@__PURE__*/ D("$ZodNumberFormat", (e, t) => {
	nn.init(e, t), ar.init(e, t);
}), sr = /*@__PURE__*/ D("$ZodBoolean", (e, t) => {
	M.init(e, t), e._zod.pattern = Jt, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = !!n.value;
		} catch {}
		let i = n.value;
		return typeof i == "boolean" || n.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
	};
}), cr = /*@__PURE__*/ D("$ZodUnknown", (e, t) => {
	M.init(e, t), e._zod.parse = (e) => e;
}), lr = /*@__PURE__*/ D("$ZodNever", (e, t) => {
	M.init(e, t), e._zod.parse = (t, n) => (t.issues.push({
		expected: "never",
		code: "invalid_type",
		input: t.value,
		inst: e
	}), t);
});
function ur(e, t) {
	let n = Ce(e._zod.def.checks);
	if (!n.length) return;
	let r = Math.min(...n.map((e) => e[0])), i = e._zod.parse;
	e._zod.parse = (n, a) => {
		let o = t(n.value);
		if (o > r && !a?.skipChecks && a?.direction !== "backward") {
			for (let [t, r] of Ce(e._zod.def.checks)) if (o > t && r._zod.def.when(n)) {
				let t = n.issues.length;
				return r._zod.check(n), n.issues[t].continue = !1, we(n.issues, t, e), n;
			}
		}
		return i(n, a);
	};
}
var dr = (e) => Array.isArray(e) ? e.length : -1;
function fr(e, t, n) {
	e.issues.length && t.issues.push(...x(n, e.issues)), t.value[n] = e.value;
}
var pr = /*@__PURE__*/ D("$ZodArray", (e, t) => {
	M.init(e, t);
	let n = k.memoizer;
	n?.attach(e), e._zod.parse = (r, i) => {
		let a = r.value;
		if (!Array.isArray(a)) return r.issues.push({
			expected: "array",
			code: "invalid_type",
			input: a,
			inst: e
		}), r;
		r.value = n ? n.alloc(e, r, Array(a.length), i) : Array(a.length);
		let o = [], s = i?.abortEarly;
		for (let e = 0; e < a.length; e++) {
			let n = a[e], c = t.element._zod.run({
				value: n,
				issues: []
			}, i);
			if (c instanceof Promise) o.push(c.then((t) => fr(t, r, e)));
			else if (fr(c, r, e), s && c.issues.length !== 0 && b(c)) break;
		}
		return o.length ? Promise.all(o).then(() => r) : r;
	}, ur(e, dr);
});
function mr(e, t, n, r, i, a) {
	let o = n in r, s = a === "optional";
	if (o || !s || i !== "optional") {
		if (e.issues.length) {
			if (i !== void 0 && s && !o) return;
			t.issues.push(...x(n, e.issues));
		}
		!o && i === void 0 ? e.issues.length || t.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [n]
		}) : e.value === void 0 ? (o || i === "defaulted" && !s) && (t.value[n] = void 0) : t.value[n] = e.value;
	}
}
var hr = [];
function gr(e) {
	let t = Object.keys(e.shape), n = Object.getOwnPropertySymbols(e.shape), r = n.length ? n : hr, i = r.length ? [...t, ...r] : t;
	for (let t of i) if (!e.shape?.[t]?._zod?.traits?.has("$ZodType")) throw Error(`Invalid element at key "${String(t)}": expected a Zod schema`);
	let a = le(e.shape);
	return {
		...e,
		allKeys: i,
		symbolKeys: r,
		keySet: new Set(t),
		numKeys: t.length,
		optionalKeys: new Set(a)
	};
}
function _r(e, t, n, r, i, a, o) {
	let s = [], c = i.keySet, l = i.catchall._zod, u = l.def.type, d = l.optin, f = l.optout, p = 0;
	for (let i in t) {
		if (o && n.issues.length !== p) {
			if (b(n, p)) break;
			p = n.issues.length;
		}
		if (c.has(i)) continue;
		if (i === "__proto__") {
			u === "never" && s.push(i);
			continue;
		}
		if (u === "never") {
			s.push(i);
			continue;
		}
		let a = l.run({
			value: t[i],
			issues: []
		}, r);
		a instanceof Promise ? e.push(a.then((e) => mr(e, n, i, t, d, f))) : mr(a, n, i, t, d, f);
	}
	return s.length && n.issues.push({
		code: "unrecognized_keys",
		keys: s,
		input: t,
		inst: a,
		continue: !0
	}), e.length ? Promise.all(e).then(() => n) : n;
}
var vr = /*@__PURE__*/ D("$ZodObject", (e, t) => {
	M.init(e, t);
	let n = Object.getOwnPropertyDescriptor(t, "shape"), r = n?.get ? n.get.raw : t.shape ?? {};
	if (r) {
		let e = () => {
			let n = { ...r };
			return Object.defineProperty(t, "shape", { value: n }), e.raw = n, n;
		};
		e.raw = r, Object.defineProperty(t, "shape", { get: e });
	}
	let i = a(() => gr(t));
	E(e, "propValues", (e) => {
		let t = e.def.shape, n = {};
		for (let e in t) {
			let r = t[e]._zod;
			if (r.values) {
				Object.prototype.hasOwnProperty.call(n, e) || l(n, e, /* @__PURE__ */ new Set());
				for (let t of r.values) n[e].add(t);
				r.optin !== void 0 && n[e].add(void 0);
			}
		}
		return n;
	});
	let o = ie, s = t.catchall, c, u = k.memoizer;
	u?.attach(e), e._zod.parse = (t, n) => {
		c ??= i.value;
		let r = t.value;
		if (!o(r)) return t.issues.push({
			expected: "object",
			code: "invalid_type",
			input: r,
			inst: e
		}), t;
		t.value = u ? u.alloc(e, t, {}, n) : {};
		let a = [], l = c.shape, d = n?.abortEarly, f = t.issues.length;
		for (let e of c.allKeys) {
			if (d && t.issues.length !== f) {
				if (b(t, f)) break;
				f = t.issues.length;
			}
			if (e === "__proto__") continue;
			let i = l[e], o = i._zod.optin, s = i._zod.optout, c = i._zod.run({
				value: r[e],
				issues: []
			}, n);
			c instanceof Promise ? a.push(c.then((n) => mr(n, t, e, r, o, s))) : mr(c, t, e, r, o, s);
		}
		return s ? _r(a, r, t, n, i.value, e, d === !0) : a.length ? Promise.all(a).then(() => t) : t;
	};
}), yr = /*@__PURE__*/ D("$ZodObjectJIT", (e, t) => {
	vr.init(e, t);
	let n = e._zod.parse, r = a(() => gr(t)), i = k.memoizer, o = (t) => {
		let n = r.value, a = n.symbolKeys, o = new hn(["payload", "ctx"], {
			shape: t,
			inst: e,
			memo: i,
			syms: a
		}), s = (e) => `shape[${e}]._zod.run({ value: input[${e}], issues: [] }, ctx)`, c = (e, t) => `
          let ${e}_ab = false;
          for (let i = 0; i < ${e}.issues.length; i++) {
            const iss = ${e}.issues[i];
            iss.path = iss.path ? [${t}, ...iss.path] : [${t}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${e}_ab = true;
          }
          if (${e}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
		o.write("const input = payload.value;");
		let l = Object.create(null), u = 0;
		for (let e of n.allKeys) l[e] = `key_${u++}`;
		o.write(i ? "const newResult = memo.alloc(inst, payload, {}, ctx);" : "const newResult = {};");
		for (let e of n.allKeys) {
			if (e === "__proto__") continue;
			let n = l[e], r = typeof e == "symbol" ? `syms[${a.indexOf(e)}]` : te(e), i = `${r} in input`, u = t[e], d = u?._zod?.optin, f = d !== void 0, p = u?._zod?.optout === "optional";
			if (o.write(`const ${n} = ${s(r)};`), f && p) {
				let e = d === "optional" ? `${n}_present` : `${n}.value !== undefined || ${n}_present`;
				o.write(`
        const ${n}_present = ${i};
        if (!${n}.issues.length || ${n}_present) {
          if (${n}.issues.length) {${c(n, r)}
          }

          if (${e}) {
            newResult[${r}] = ${n}.value;
          }
        }

      `);
			} else f ? (o.write(`
        if (${n}.issues.length) {${c(n, r)}
        }
      `), d === "defaulted" ? o.write(`newResult[${r}] = ${n}.value;`) : o.write(`
        if (${n}.value !== undefined || ${i}) {
          newResult[${r}] = ${n}.value;
        }
      `)) : o.write(`
        const ${n}_present = ${i};
        if (${n}.issues.length) {${c(n, r)}
        }
        if (!${n}_present && !${n}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${r}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${n}_present) {
          newResult[${r}] = ${n}.value;
        }

      `);
		}
		return o.write("payload.value = newResult;"), o.write("return payload;"), o.compile();
	}, s, c = ie, l = !k.jitless, u = l && ae.value, d = t.catchall, f;
	e._zod.parse = (i, a) => {
		f ??= r.value;
		let p = i.value;
		return c(p) ? l && u && a?.async === !1 && a.jitless !== !0 ? (s ||= o(t.shape), i = s(i, a), d ? _r([], p, i, a, f, e, a?.abortEarly === !0) : i) : n(i, a) : (i.issues.push({
			expected: "object",
			code: "invalid_type",
			input: p,
			inst: e
		}), i);
	};
});
function br(e, t, n, r) {
	for (let n of e) if (n.issues.length === 0) return t.value = n.value, t;
	let i = e.filter((e) => !b(e));
	return i.length === 1 ? (t.value = i[0].value, i[0]) : (t.issues.push({
		code: "invalid_union",
		input: t.value,
		inst: n,
		errors: e.map((e) => e.issues.map((e) => S(e, r, A())))
	}), t);
}
var xr = /*@__PURE__*/ D("$ZodUnion", (e, t) => {
	M.init(e, t), E(e, "optin", (e) => e.def.options.some((e) => e._zod.optin === "defaulted") ? "defaulted" : e.def.options.some((e) => e._zod.optin !== void 0) ? "optional" : void 0), E(e, "optout", (e) => e.def.options.some((e) => e._zod.optout === "optional") ? "optional" : void 0), E(e, "values", (e) => {
		if (e.def.options.every((e) => e._zod.values)) return new Set(e.def.options.flatMap((e) => Array.from(e._zod.values)));
	}), E(e, "pattern", (e) => {
		if (e.def.options.every((e) => e._zod.pattern)) {
			let t = e.def.options.map((e) => e._zod.pattern);
			return RegExp(`^(${t.map((e) => s(e.source)).join("|")})$`);
		}
	});
	let n = t.options.length === 1 ? t.options[0]._zod.run : null;
	e._zod.parse = (r, i) => {
		if (n) return n(r, i);
		let a = !1, o = [];
		for (let e of t.options) {
			let t = e._zod.run({
				value: r.value,
				issues: []
			}, i);
			if (t instanceof Promise) o.push(t), a = !0;
			else {
				if (t.issues.length === 0) return t;
				o.push(t);
			}
		}
		return a ? Promise.all(o).then((t) => br(t, r, e, i)) : br(o, r, e, i);
	};
});
function Sr(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.options) {
		let r = n._zod.propValues?.[e.discriminator];
		if (!r || r.size === 0) throw Error(`Invalid discriminated union option at index "${e.options.indexOf(n)}"`);
		for (let e of r) if (t.has(e)) {
			if (e !== void 0) throw Error(`Duplicate discriminator value "${String(e)}"`);
			t.set(e, null);
		} else t.set(e, n);
	}
	return t;
}
var Cr = /*@__PURE__*/ D("$ZodDiscriminatedUnion", (e, t) => {
	t.inclusive = !1, xr.init(e, t);
	let n = e._zod.parse;
	E(e, "propValues", (e) => {
		let t = {}, n = 0;
		for (let r of e.def.options) {
			let i = r._zod.propValues;
			if (!i || Object.keys(i).length === 0) throw Error(`Invalid discriminated union option at index "${e.def.options.indexOf(r)}"`);
			i[e.def.discriminator]?.has(void 0) && n++;
			for (let [e, n] of Object.entries(i)) {
				Object.prototype.hasOwnProperty.call(t, e) || l(t, e, /* @__PURE__ */ new Set());
				for (let r of n) t[e].add(r);
			}
		}
		return !e.def.unionFallback && n > 1 && t[e.def.discriminator]?.delete(void 0), t;
	}), t.options.forEach((e, n) => {
		let r = u(e._zod.def);
		if (r && !Object.prototype.hasOwnProperty.call(r, t.discriminator)) throw Error(`Invalid discriminated union option at index "${n}"`);
	});
	let r = a(() => Sr(t));
	e._zod.parse = (i, a) => {
		let o = i.value;
		if (!ie(o)) return i.issues.push({
			code: "invalid_type",
			expected: "object",
			input: o,
			inst: e
		}), i;
		let s = o?.[t.discriminator], c = r.value.get(s);
		return c && (s !== void 0 || a.direction !== "backward") ? c._zod.run(i, a) : t.unionFallback || a.direction === "backward" ? n(i, a) : (i.issues.push({
			code: "invalid_union",
			errors: [],
			note: "No matching discriminator",
			discriminator: t.discriminator,
			options: Array.from(r.value.keys()).filter((e) => r.value.get(e) !== null),
			input: o,
			path: [t.discriminator],
			inst: e
		}), i);
	};
}), wr = /*@__PURE__*/ D("$ZodIntersection", (e, t) => {
	M.init(e, t), e._zod.parse = (e, n) => {
		let r = e.value, i = t.left._zod.run({
			value: r,
			issues: []
		}, n), a = t.right._zod.run({
			value: r,
			issues: []
		}, n);
		return i instanceof Promise || a instanceof Promise ? Promise.all([i, a]).then(([t, n]) => Er(e, t, n)) : Er(e, i, a);
	};
});
function Tr(e, t) {
	if (e === t || e instanceof Date && t instanceof Date && +e == +t) return {
		valid: !0,
		data: e
	};
	if (g(e) && g(t)) {
		let n = Object.keys(t), r = Object.keys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		Object.prototype.hasOwnProperty.call(i, "__proto__") && delete i.__proto__;
		for (let n of r) {
			if (n === "__proto__") continue;
			let r = Tr(e[n], t[n]);
			if (!r.valid) return {
				valid: !1,
				mergeErrorPath: [n, ...r.mergeErrorPath]
			};
			i[n] = r.data;
		}
		return {
			valid: !0,
			data: i
		};
	}
	if (Array.isArray(e) && Array.isArray(t)) {
		if (e.length !== t.length) return {
			valid: !1,
			mergeErrorPath: []
		};
		let n = [];
		for (let r = 0; r < e.length; r++) {
			let i = e[r], a = t[r], o = Tr(i, a);
			if (!o.valid) return {
				valid: !1,
				mergeErrorPath: [r, ...o.mergeErrorPath]
			};
			n.push(o.data);
		}
		return {
			valid: !0,
			data: n
		};
	}
	return {
		valid: !1,
		mergeErrorPath: []
	};
}
function Er(e, t, n) {
	let r = /* @__PURE__ */ new Map(), i, a = /* @__PURE__ */ new Map(), o = (e, t) => {
		let n;
		if (e.code === "unrecognized_keys" && !e.path?.length) i ??= e, n = e.keys;
		else if (e.code === "invalid_key" && e.origin === "record" && e.path?.length === 1) {
			let t = String(e.path[0]);
			a.has(t) || a.set(t, e), n = [t];
		} else return !1;
		for (let e of n) r.has(e) || r.set(e, {}), r.get(e)[t] = !0;
		return !0;
	};
	for (let n of t.issues) o(n, "l") || e.issues.push(n);
	for (let t of n.issues) o(t, "r") || e.issues.push(t);
	let s = [...r].filter(([, e]) => e.l && e.r).map(([e]) => e);
	if (s.length) {
		let t = i ? s.filter((e) => i.keys.includes(e)) : [];
		t.length && e.issues.push({
			...i,
			keys: t
		});
		for (let n of s) !t.includes(n) && a.has(n) && e.issues.push(a.get(n));
	}
	let c = Tr(t.value, n.value);
	if (!c.valid) {
		if (b(e)) return e;
		throw Error(`Unmergable intersection. Error path: ${JSON.stringify(c.mergeErrorPath)}`);
	}
	return e.value = c.data, e;
}
var Dr = /*@__PURE__*/ D("$ZodRecord", (e, t) => {
	M.init(e, t);
	let n = k.memoizer;
	n?.attach(e), e._zod.parse = (r, i) => {
		let a = r.value;
		if (!g(a)) return r.issues.push({
			expected: "record",
			code: "invalid_type",
			input: a,
			inst: e
		}), r;
		let o = [], s = t.keyType._zod.values;
		if (s && !t.partial) {
			r.value = n ? n.alloc(e, r, {}, i) : {};
			let c = /* @__PURE__ */ new Set();
			for (let n of s) if (typeof n == "string" || typeof n == "number" || typeof n == "symbol") {
				if (c.add(typeof n == "number" ? n.toString() : n), n === "__proto__") continue;
				let s = t.keyType._zod.run({
					value: n,
					issues: []
				}, i);
				if (s instanceof Promise) throw Error("Async schemas not supported in object keys currently");
				if (s.issues.length) {
					r.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: s.issues.map((e) => S(e, i, A())),
						input: n,
						path: [n],
						inst: e
					});
					continue;
				}
				let l = s.value;
				if (l === "__proto__") continue;
				let u = t.valueType._zod.run({
					value: a[n],
					issues: []
				}, i);
				u instanceof Promise ? o.push(u.then((e) => {
					e.issues.length && r.issues.push(...x(n, e.issues)), r.value[l] = e.value;
				})) : (u.issues.length && r.issues.push(...x(n, u.issues)), r.value[l] = u.value);
			}
			let l;
			for (let e in a) if (!c.has(e)) {
				if (t.mode === "loose") {
					if (e === "__proto__") continue;
					r.value[e] = a[e];
				} else l ??= [], l.push(e);
			}
			l && l.length > 0 && r.issues.push({
				code: "unrecognized_keys",
				input: a,
				inst: e,
				keys: l,
				continue: !0
			});
		} else {
			r.value = n ? n.alloc(e, r, {}, i) : {};
			let c;
			for (let n of Reflect.ownKeys(a)) {
				if (n === "__proto__" || !Object.prototype.propertyIsEnumerable.call(a, n)) continue;
				let l = t.keyType._zod.run({
					value: n,
					issues: []
				}, i);
				if (l instanceof Promise) throw Error("Async schemas not supported in object keys currently");
				if (typeof n == "string" && qt.test(n) && l.issues.length) {
					let e = t.keyType._zod.run({
						value: Number(n),
						issues: []
					}, i);
					if (e instanceof Promise) throw Error("Async schemas not supported in object keys currently");
					e.issues.length === 0 && (l = e);
				}
				if (l.issues.length) {
					t.mode === "loose" ? r.value[n] = a[n] : s ? (c ??= [], c.push(n)) : r.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: l.issues.map((e) => S(e, i, A())),
						input: n,
						path: [n],
						inst: e
					});
					continue;
				}
				let u = l.value;
				if (u === "__proto__") continue;
				let d = t.valueType._zod.run({
					value: a[n],
					issues: []
				}, i);
				d instanceof Promise ? o.push(d.then((e) => {
					e.issues.length && r.issues.push(...x(n, e.issues)), r.value[u] = e.value;
				})) : (d.issues.length && r.issues.push(...x(n, d.issues)), r.value[u] = d.value);
			}
			c && c.length > 0 && r.issues.push({
				code: "unrecognized_keys",
				input: a,
				inst: e,
				keys: c,
				continue: !0
			});
		}
		return o.length ? Promise.all(o).then(() => r) : r;
	};
}), Or = /*@__PURE__*/ D("$ZodEnum", (e, n) => {
	M.init(e, n);
	let r = t(n.entries), i = new Set(r);
	e._zod.values = i, E(e, "pattern", (e) => {
		let n = t(e.def.entries).filter((e) => se.has(typeof e));
		return RegExp(n.length ? `^(${n.map((e) => _(e.toString())).join("|")})$` : "^[^\\s\\S]$");
	}), e._zod.parse = (t, n) => {
		let a = t.value;
		return i.has(a) || t.issues.push({
			code: "invalid_value",
			values: r,
			input: a,
			inst: e
		}), t;
	};
}), kr = /*@__PURE__*/ D("$ZodLiteral", (e, t) => {
	M.init(e, t);
	let n = new Set(t.values);
	e._zod.values = n, E(e, "pattern", (e) => {
		let t = e.def.values;
		return RegExp(t.length ? `^(${t.map((e) => typeof e == "string" ? _(e) : e ? _(e.toString()) : String(e)).join("|")})$` : "^[^\\s\\S]$");
	}), e._zod.parse = (r, i) => {
		let a = r.value;
		return n.has(a) || r.issues.push({
			code: "invalid_value",
			values: t.values,
			input: a,
			inst: e
		}), r;
	};
}), Ar = /*@__PURE__*/ D("$ZodTransform", (e, t) => {
	M.init(e, t), e._zod.optin = "optional", k.memoizer?.guard(e), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new Ue(e.constructor.name);
		let i = t.transform(n.value, n);
		if (r.async) return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => (n.value = e, n));
		if (i instanceof Promise) throw new O();
		return n.value = i, n;
	};
});
function jr(e, t) {
	return e.value = t.issues.length ? void 0 : t.value, e;
}
var Mr = /*@__PURE__*/ D("$ZodOptional", (e, t) => {
	M.init(e, t), E(e, "optin", (e) => e.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), e._zod.optout = "optional", E(e, "values", (e) => {
		let t = e.def.innerType._zod.values;
		return t ? /* @__PURE__ */ new Set([...t, void 0]) : void 0;
	}), E(e, "pattern", (e) => {
		let t = e.def.innerType._zod.pattern;
		return t ? RegExp(`^(${s(t.source)})?$`) : void 0;
	}), e._zod.parse = (e, n) => {
		if (e.value === void 0) {
			if (t.innerType._zod.optin !== "defaulted") return e;
			let r = t.innerType._zod.run({
				value: e.value,
				issues: []
			}, n);
			return r instanceof Promise ? r.then((t) => jr(e, t)) : jr(e, r);
		}
		return t.innerType._zod.run(e, n);
	};
}), Nr = /*@__PURE__*/ D("$ZodExactOptional", (e, t) => {
	Mr.init(e, t), E(e, "values", (e) => e.def.innerType._zod.values), E(e, "pattern", (e) => e.def.innerType._zod.pattern), e._zod.parse = (e, n) => t.innerType._zod.run(e, n);
}), Pr = /*@__PURE__*/ D("$ZodNullable", (e, t) => {
	M.init(e, t), E(e, "optin", (e) => e.def.innerType._zod.optin), E(e, "optout", (e) => e.def.innerType._zod.optout), E(e, "pattern", (e) => {
		let t = e.def.innerType._zod.pattern;
		return t ? RegExp(`^(${s(t.source)}|null)$`) : void 0;
	}), E(e, "values", (e) => e.def.innerType._zod.values ? /* @__PURE__ */ new Set([...e.def.innerType._zod.values, null]) : void 0), e._zod.parse = (e, n) => e.value === null ? e : t.innerType._zod.run(e, n);
}), Fr = /*@__PURE__*/ D("$ZodDefault", (e, t) => {
	M.init(e, t), e._zod.optin = "defaulted", E(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		if (e.value === void 0) return e.value = t.defaultValue, e;
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => Ir(e, t)) : Ir(r, t);
	};
});
function Ir(e, t) {
	return e.value === void 0 && (e.value = t.defaultValue), e;
}
var Lr = /*@__PURE__*/ D("$ZodPrefault", (e, t) => {
	M.init(e, t), e._zod.optin = "defaulted", E(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => (n.direction === "backward" || e.value === void 0 && (e.value = t.defaultValue), t.innerType._zod.run(e, n));
}), Rr = /*@__PURE__*/ D("$ZodNonOptional", (e, t) => {
	M.init(e, t), E(e, "values", (e) => {
		let t = e.def.innerType._zod.values;
		return t ? new Set([...t].filter((e) => e !== void 0)) : void 0;
	}), e._zod.parse = (n, r) => {
		let i = t.innerType._zod.run(n, r);
		return i instanceof Promise ? i.then((t) => zr(t, e)) : zr(i, e);
	};
});
function zr(e, t) {
	return !e.issues.length && e.value === void 0 && e.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: e.value,
		inst: t
	}), e;
}
function Br(e, t, n, r) {
	return t.issues.length ? (e.value = n.catchValue({
		...t,
		value: e.value,
		error: { issues: t.issues.map((e) => S(e, r, A())) },
		input: e.value
	}), e) : (e.value = t.value, t.memo && (e.memo = !0), e);
}
var Vr = /*@__PURE__*/ D("$ZodCatch", (e, t) => {
	M.init(e, t), E(e, "optin", (e) => e.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), E(e, "optout", (e) => e.def.innerType._zod.optout), E(e, "values", (e) => e.def.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run({
			value: e.value,
			issues: []
		}, n);
		return r instanceof Promise ? r.then((r) => Br(e, r, t, n)) : Br(e, r, t, n);
	};
}), Hr = /*@__PURE__*/ D("$ZodPipe", (e, t) => {
	M.init(e, t), E(e, "values", (e) => e.def.in._zod.values), E(e, "optin", (e) => e.def.in._zod.optin), E(e, "optout", (e) => e.def.out._zod.optout), E(e, "propValues", (e) => e.def.in._zod.propValues), e._zod.parse = (e, n) => {
		if (n.direction === "backward") {
			let r = t.out._zod.run(e, n);
			return r instanceof Promise ? r.then((e) => Ur(e, t.in, n)) : Ur(r, t.in, n);
		}
		let r = t.in._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => Ur(e, t.out, n)) : Ur(r, t.out, n);
	};
});
function Ur(e, t, n) {
	return e.issues.some((e) => e.code !== "unrecognized_keys") ? (e.aborted = !0, e) : t._zod.run({
		value: e.value,
		issues: e.issues
	}, n);
}
var Wr = /*@__PURE__*/ D("$ZodReadonly", (e, t) => {
	M.init(e, t), E(e, "propValues", (e) => e.def.innerType._zod.propValues), E(e, "values", (e) => e.def.innerType._zod.values), E(e, "optin", (e) => e.def.innerType?._zod?.optin), E(e, "optout", (e) => e.def.innerType?._zod?.optout), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then(Gr) : Gr(r);
	};
});
function Gr(e) {
	return e.memo || (e.value = Object.freeze(e.value)), e;
}
var Kr = /*@__PURE__*/ D("$ZodCustom", (e, t) => {
	j.init(e, t), M.init(e, t), e._zod.parse = (e, t) => e, e._zod.check = (n) => {
		let r = n.value, i = t.fn(r);
		if (i instanceof Promise) return i.then((t) => qr(t, n, r, e));
		qr(i, n, r, e);
	};
});
function qr(e, t, n, r) {
	if (!e) {
		let e = {
			code: "custom",
			input: n,
			inst: r,
			path: [...r._zod.def.path ?? []],
			continue: !r._zod.def.abort
		};
		r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(C(e));
	}
}
// ../node_modules/zod/v4/core/memoizer.js
var Jr = class extends Error {
	constructor() {
		super("Cannot parse a reference cycle that closes through a transform"), this.name = "ZodCyclicError";
	}
}, Yr = "~memo", Xr = [];
function Zr(e) {
	return typeof e == "object" && !!e;
}
function Qr(e) {
	return e.map((e) => e.path ? {
		...e,
		path: e.path.slice()
	} : { ...e });
}
var $r = /*@__PURE__*/ new WeakMap(), P = 0, ei = 1, F = 2;
function ti(e, t, n) {
	let r = $r.get(e);
	if (r !== void 0) return r ? F : P;
	if (t.has(e)) return F;
	t.add(e);
	let i = P, a = (e) => {
		if (i !== F && e?._zod) {
			let r = ti(e, t, n);
			r > i && (i = r);
		}
	}, o = (e, r) => {
		let i = P;
		for (let a of Reflect.ownKeys(e)) {
			let o = Object.getOwnPropertyDescriptor(e, a);
			if (r && !o.enumerable) continue;
			let s = o.get ? ei : o.value?._zod ? ti(o.value, t, n) : P;
			s > i && (i = s);
		}
		return i;
	}, s = (e) => {
		e > i && (i = e);
	}, c = e._zod.def;
	switch (c.type) {
		case "object": {
			let e = u(c);
			s(e ? o(e, !0) : ei), a(c.catchall);
			break;
		}
		case "array":
			a(c.element);
			break;
		case "tuple":
			for (let e of c.items) a(e);
			a(c.rest);
			break;
		case "record":
		case "map":
			a(c.keyType), a(c.valueType);
			break;
		case "set":
			a(c.valueType);
			break;
		case "union":
			for (let e of c.options) a(e);
			break;
		case "intersection":
			a(c.left), a(c.right);
			break;
		case "optional":
		case "nullable":
		case "default":
		case "prefault":
		case "catch":
		case "readonly":
		case "nonoptional":
		case "promise":
		case "success":
			a(c.innerType);
			break;
		case "pipe":
			a(c.in), a(c.out);
			break;
		case "function":
			a(c.input), a(c.output);
			break;
		case "lazy": {
			let r = c._cachedInner ?? (n ? e._zod.innerType : void 0);
			s(r ? ti(r, t, !1) : ei);
			break;
		}
		case "template_literal":
		case "string":
		case "number":
		case "int":
		case "boolean":
		case "bigint":
		case "symbol":
		case "undefined":
		case "null":
		case "void":
		case "never":
		case "any":
		case "unknown":
		case "date":
		case "nan":
		case "enum":
		case "literal":
		case "file":
		case "transform":
		case "custom": break;
		default: for (let e in c) {
			let t = Object.getOwnPropertyDescriptor(c, e);
			if (!t || t.get) continue;
			let n = t.value;
			if (n && typeof n == "object") {
				if (n._zod) a(n);
				else if (Array.isArray(n)) for (let e of n) a(e);
			}
		}
	}
	return t.delete(e), ni(e, i);
}
function ni(e, t) {
	return t !== ei && $r.set(e, t === F), t;
}
function ri(e, t) {
	let n = e.buckets.get(t);
	return n || (n = /* @__PURE__ */ new WeakMap(), e.buckets.set(t, n)), n;
}
var ii, ai = [], oi = {
	alloc(e, t, n) {
		let r = ii;
		if (!r) return n;
		ii = void 0;
		let i = {
			value: n,
			issues: null
		};
		return r.set(t.value, i), ai.push(i), n;
	},
	guard(e) {
		var t;
		(t = e._zod).deferred ?? (t.deferred = []), e._zod.deferred.push(() => {
			let t = e._zod.parse, n = (e, n) => {
				if (n.direction !== "backward" && ci(n, e.value)) throw new Jr();
				return t(e, n);
			};
			e._zod.parse = n, e._zod.run === t && (e._zod.run = n);
		});
	},
	attach(e) {
		var t;
		let n, r = !1, i, a;
		(t = e._zod).deferred ?? (t.deferred = []), e._zod.deferred.push(() => {
			let t = e._zod.parse, o = (s, c) => {
				if (n === void 0) {
					let i = ti(e, /* @__PURE__ */ new Set(), !1);
					if (i === P) return e._zod.parse = t, e._zod.run === o && (e._zod.run = t), t(s, c);
					i === F || r ? n = !0 : r = !0;
				}
				let l = s.value;
				if (!Zr(l)) return t(s, c);
				let u = c[Yr];
				u || (u = {
					buckets: /* @__PURE__ */ new WeakMap(),
					backEdges: void 0
				}, c[Yr] = u);
				let d;
				i === c ? d = a : (d = ri(u, e), i = c, a = d);
				let f = d.get(l);
				if (f) return s.value = f.value, f.issues ? f.issues.length && s.issues.push(...Qr(f.issues)) : (s.memo = !0, u.backEdges ?? (u.backEdges = /* @__PURE__ */ new WeakSet()), u.backEdges.add(f.value)), s;
				ii = d;
				let p = ai.length, m = t(s, c);
				ii = void 0;
				let ee = ai.length > p ? ai.pop() : void 0;
				return m instanceof Promise ? m.then((e) => (ee && (ee.issues = e.issues.length ? Qr(e.issues) : Xr), e)) : (ee && (ee.issues = m.issues.length ? Qr(m.issues) : Xr), m);
			};
			e._zod.parse = o, e._zod.run === t && (e._zod.run = o);
		});
	}
};
function si() {
	return oi;
}
function ci(e, t) {
	let n = e[Yr]?.backEdges;
	return n !== void 0 && Zr(t) && n.has(t);
}
// ../node_modules/zod/v4/locales/en.js
var li = () => {
	let e = {
		string: {
			unit: "characters",
			verb: "to have"
		},
		file: {
			unit: "bytes",
			verb: "to have"
		},
		array: {
			unit: "items",
			verb: "to have"
		},
		set: {
			unit: "items",
			verb: "to have"
		},
		map: {
			unit: "entries",
			verb: "to have"
		}
	};
	function t(t) {
		return e[t] ?? null;
	}
	let r = {
		regex: "input",
		email: "email address",
		url: "URL",
		emoji: "emoji",
		uuid: "UUID",
		uuidv4: "UUIDv4",
		uuidv6: "UUIDv6",
		nanoid: "nanoid",
		guid: "GUID",
		cuid: "cuid",
		cuid2: "cuid2",
		ulid: "ULID",
		xid: "XID",
		ksuid: "KSUID",
		datetime: "ISO datetime",
		date: "ISO date",
		time: "ISO time",
		duration: "ISO duration",
		ipv4: "IPv4 address",
		ipv6: "IPv6 address",
		mac: "MAC address",
		cidrv4: "IPv4 range",
		cidrv6: "IPv6 range",
		base64: "base64-encoded string",
		base64url: "base64url-encoded string",
		json_string: "JSON string",
		e164: "E.164 number",
		currency_code: "currency code",
		credit_card: "credit card number",
		iban: "IBAN",
		jwt: "JWT",
		template_literal: "input"
	}, i = { nan: "NaN" };
	function a(e, t) {
		return e === "number" && typeof t == "number" && !Number.isFinite(t) ? String(t) : i[e] ?? e;
	}
	return (e) => {
		switch (e.code) {
			case "invalid_type": return `Invalid input: expected ${a(e.expected)}, received ${a(Oe(e.input), e.input)}`;
			case "invalid_value": return e.values.length === 1 ? `Invalid input: expected ${ce(e.values[0])}` : `Invalid option: expected one of ${n(e.values, "|")}`;
			case "too_big": {
				let n = e.exact ? "exactly " : e.inclusive ? "<=" : "<", r = t(e.origin);
				return r ? `Too big: expected ${e.origin ?? "value"} to have ${n}${e.maximum.toString()} ${r.unit ?? "elements"}` : `Too big: expected ${e.origin ?? "value"} to be ${n}${e.maximum.toString()}`;
			}
			case "too_small": {
				let n = e.exact ? "exactly " : e.inclusive ? ">=" : ">", r = t(e.origin);
				return r ? `Too small: expected ${e.origin} to have ${n}${e.minimum.toString()} ${r.unit}` : `Too small: expected ${e.origin} to be ${n}${e.minimum.toString()}`;
			}
			case "invalid_format": {
				let t = e;
				return t.format === "starts_with" ? `Invalid string: must start with "${t.prefix}"` : t.format === "ends_with" ? `Invalid string: must end with "${t.suffix}"` : t.format === "includes" ? `Invalid string: must include "${t.includes}"` : t.format === "regex" ? `Invalid string: must match pattern ${t.pattern}` : `Invalid ${r[t.format] ?? e.format}`;
			}
			case "not_multiple_of": return `Invalid number: must be a multiple of ${e.divisor}`;
			case "unrecognized_keys": return `Unrecognized key${e.keys.length > 1 ? "s" : ""}: ${n(e.keys, ", ")}`;
			case "invalid_key": return `Invalid key in ${e.origin}`;
			case "invalid_union": return e.options && Array.isArray(e.options) && e.options.length > 0 ? `Invalid discriminator value. Expected ${e.options.map((e) => `'${e}'`).join(" | ")}` : e.inclusive === !1 ? "Invalid input: more than one option matched" : "Invalid input";
			case "invalid_element": return `Invalid value in ${e.origin}`;
			default: return "Invalid input";
		}
	};
};
function ui() {
	return { localeError: li() };
}
// ../node_modules/zod/v4/core/registries.js
var di, fi = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
	}
	add(e, ...t) {
		let n = t[0];
		return this._map.set(e, n), n && typeof n == "object" && "id" in n && this._idmap.set(n.id, e), this;
	}
	clear() {
		return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
	}
	remove(e) {
		let t = this._map.get(e);
		return t && typeof t == "object" && "id" in t && this._idmap.delete(t.id), this._map.delete(e), this;
	}
	get(e) {
		let t = e._zod.parent;
		if (t) {
			let n = { ...this.get(t) ?? {} };
			delete n.id;
			let r = {
				...n,
				...this._map.get(e)
			};
			return Object.keys(r).length ? r : void 0;
		}
		return this._map.get(e);
	}
	has(e) {
		return this._map.has(e);
	}
};
function pi() {
	return new fi();
}
(di = globalThis).__zod_globalRegistry ?? (di.__zod_globalRegistry = pi());
var I = globalThis.__zod_globalRegistry;
// ../node_modules/zod/v4/core/api.js
function mi(e) {
	return e.checks &&= [...e.checks], e;
}
// @__NO_SIDE_EFFECTS__
function hi(e, t) {
	return new e(mi({
		type: "string",
		...y(t)
	}));
}
// @__NO_SIDE_EFFECTS__
function gi(e, t) {
	return new e({
		type: "string",
		format: "email",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function _i(e, t) {
	return new e({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function vi(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function yi(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v4",
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function bi(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v6",
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function xi(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v7",
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Si(e, t) {
	return new e({
		type: "string",
		format: "url",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ci(e, t) {
	return new e({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function wi(e, t) {
	return new e({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ti(e, t) {
	return new e({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ei(e, t) {
	return new e({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Di(e, t) {
	return new e({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Oi(e, t) {
	return new e({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ki(e, t) {
	return new e({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ai(e, t) {
	return new e({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ji(e, t) {
	return new e({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Mi(e, t) {
	return new e({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ni(e, t) {
	return new e({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Pi(e, t) {
	return new e({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Fi(e, t) {
	return new e({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ii(e, t) {
	return new e({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Li(e, t) {
	return new e({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: !1,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ri(e, t) {
	return new e({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: !1,
		local: !1,
		precision: null,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function zi(e, t) {
	return new e({
		type: "string",
		format: "date",
		check: "string_format",
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Bi(e, t) {
	return new e({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Vi(e, t) {
	return new e({
		type: "string",
		format: "duration",
		check: "string_format",
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Hi(e, t) {
	return new e(mi({
		type: "number",
		checks: [],
		...y(t)
	}));
}
// @__NO_SIDE_EFFECTS__
function Ui(e, t) {
	return new e({
		type: "number",
		check: "number_format",
		abort: !1,
		format: "safeint",
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Wi(e, t) {
	return new e({
		type: "boolean",
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Gi(e) {
	return new e({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function Ki(e, t) {
	return new e({
		type: "never",
		...y(t)
	});
}
// @__NO_SIDE_EFFECTS__
function qi(e, t) {
	return new $t({
		check: "less_than",
		...y(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function Ji(e, t) {
	return new $t({
		check: "less_than",
		...y(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function Yi(e, t) {
	return new en({
		check: "greater_than",
		...y(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function Xi(e, t) {
	return new en({
		check: "greater_than",
		...y(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function Zi(e, t) {
	return new tn({
		check: "multiple_of",
		...y(t),
		value: e
	});
}
// @__NO_SIDE_EFFECTS__
function Qi(e, t) {
	return new rn({
		check: "max_length",
		...y(t),
		maximum: e
	});
}
// @__NO_SIDE_EFFECTS__
function $i(e, t) {
	return new an({
		check: "min_length",
		...y(t),
		minimum: e
	});
}
// @__NO_SIDE_EFFECTS__
function ea(e, t) {
	return new on({
		check: "length_equals",
		...y(t),
		length: e
	});
}
// @__NO_SIDE_EFFECTS__
function ta(e, t) {
	return new cn({
		check: "string_format",
		format: "regex",
		...y(t),
		pattern: e
	});
}
// @__NO_SIDE_EFFECTS__
function na(e) {
	return new ln({
		check: "string_format",
		format: "lowercase",
		...y(e)
	});
}
// @__NO_SIDE_EFFECTS__
function ra(e) {
	return new un({
		check: "string_format",
		format: "uppercase",
		...y(e)
	});
}
// @__NO_SIDE_EFFECTS__
function ia(e, t) {
	return new dn({
		check: "string_format",
		format: "includes",
		...y(t),
		includes: e
	});
}
// @__NO_SIDE_EFFECTS__
function aa(e, t) {
	return new fn({
		check: "string_format",
		format: "starts_with",
		...y(t),
		prefix: e
	});
}
// @__NO_SIDE_EFFECTS__
function oa(e, t) {
	return new pn({
		check: "string_format",
		format: "ends_with",
		...y(t),
		suffix: e
	});
}
// @__NO_SIDE_EFFECTS__
function L(e) {
	return new mn({
		check: "overwrite",
		tx: e
	});
}
// @__NO_SIDE_EFFECTS__
function sa(e) {
	return /* @__PURE__ */ L((t) => t.normalize(e));
}
// @__NO_SIDE_EFFECTS__
function ca() {
	return /* @__PURE__ */ L((e) => e.trim());
}
// @__NO_SIDE_EFFECTS__
function la() {
	return /* @__PURE__ */ L((e) => e.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function ua() {
	return /* @__PURE__ */ L((e) => e.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function da() {
	return /* @__PURE__ */ L((e) => ne(e));
}
// @__NO_SIDE_EFFECTS__
function fa(e, t, n) {
	return new e({
		type: "array",
		element: t,
		...y(n)
	});
}
// @__NO_SIDE_EFFECTS__
function pa(e, t, n) {
	return new e({
		type: "custom",
		check: "custom",
		fn: t,
		...y(n)
	});
}
// @__NO_SIDE_EFFECTS__
function ma(e, t) {
	let n = /* @__PURE__ */ ha((t) => (t.addIssue = (e) => {
		if (typeof e == "string") t.issues.push(C(e, t.value, n._zod.def));
		else {
			let r = e;
			r.fatal && (r.continue = !1), r.code ??= "custom", "input" in r || (r.input = t.value), r.inst ??= n, r.continue ??= !n._zod.def.abort, t.issues.push(C(r));
		}
	}, e(t.value, t)), t);
	return n;
}
// @__NO_SIDE_EFFECTS__
function ha(e, t) {
	let n = new j({
		check: "custom",
		...y(t)
	});
	return n._zod.check = e, n;
}
// ../node_modules/zod/v4/core/to-json-schema.js
function R(e, ...t) {
	for (let n of t) for (let t of Reflect.ownKeys(n)) Object.prototype.propertyIsEnumerable.call(n, t) && l(e, t, n[t]);
	return e;
}
function ga(e) {
	let t = e?.target ?? "draft-2020-12";
	return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
		processors: e.processors ?? {},
		metadataRegistry: e?.metadata ?? I,
		target: t,
		unrepresentable: e?.unrepresentable ?? "throw",
		override: e?.override ?? (() => {}),
		io: e?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		sharedDefsExtractedFor: void 0,
		sharedEmitDoneFor: void 0,
		cycles: e?.cycles ?? "ref",
		reused: e?.reused ?? "inline",
		intersections: [],
		deferred: [],
		external: e?.external ?? void 0
	};
}
function z(e, t, n, r, i) {
	let a = typeof t.unrepresentable == "function" ? t.unrepresentable({
		zodSchema: e,
		path: r.path,
		message: i
	}) : t.unrepresentable;
	if (a === "any") return !1;
	if (a === void 0 || a === "throw") throw Error(i);
	return Object.assign(n, a), !0;
}
function B(e, t, n = {
	path: [],
	schemaPath: []
}) {
	var r;
	let i = e._zod.def, a = t.seen.get(e);
	if (a) return a.count++, n.schemaPath.includes(e) && (a.cycle = n.path), a.schema;
	let o = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: n.path
	};
	t.seen.set(e, o), t.sharedDefsExtractedFor = void 0, t.sharedEmitDoneFor = void 0;
	let s = e._zod.toJSONSchema?.();
	if (s) o.schema = s;
	else {
		let r = {
			...n,
			schemaPath: [...n.schemaPath, e],
			path: n.path
		};
		if (e._zod.processJSONSchema) e._zod.processJSONSchema(t, o.schema, r);
		else {
			let n = o.schema, a = t.processors[i.type];
			if (!a) throw Error(`[toJSONSchema]: Non-representable type encountered: ${i.type}`);
			a(e, t, n, r);
		}
		let a = e._zod.parent;
		a && (o.ref ||= a, B(a, t, r), t.seen.get(a).isParent = !0);
	}
	let c = t.metadataRegistry.get(e);
	return c && R(o.schema, c), t.io === "input" && V(e) && (delete o.schema.examples, delete o.schema.default), t.io === "input" && "_prefault" in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)), delete o.schema._prefault, t.seen.get(e).schema;
}
function _a(e) {
	return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
function va(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	if (e.external && e.sharedDefsExtractedFor === e.external) return;
	let r = /* @__PURE__ */ new Map();
	for (let t of e.seen.entries()) {
		let n = e.metadataRegistry.get(t[0])?.id;
		if (n) {
			let e = r.get(n);
			if (e && e !== t[0]) throw Error(`Duplicate schema id "${n}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			r.set(n, t[0]);
		}
	}
	let i = (t) => {
		let r = e.target === "draft-2020-12" ? "$defs" : "definitions";
		if (e.external) {
			let n = e.external.registry.get(t[0])?.id, i = e.external.uri ?? ((e) => e);
			if (n) return { ref: i(n) };
			let a = t[1].defId ?? t[1].schema.id ?? `schema${e.counter++}`;
			return t[1].defId = a, {
				defId: a,
				ref: `${i("__shared")}#/${r}/${_a(a)}`
			};
		}
		let i = `#/${r}/`;
		if (t[1] === n && !t[1].schema.id) return { ref: "#" };
		let a = t[1].schema.id ?? `__schema${e.counter++}`;
		return {
			defId: a,
			ref: i + _a(a)
		};
	}, a = (e) => {
		if (e[1].schema.$ref) return;
		let t = e[1], { ref: n, defId: r } = i(e);
		t.def = { ...t.schema }, r && (t.defId = r);
		let a = t.schema;
		for (let e in a) delete a[e];
		a.$ref = n;
	};
	if (e.cycles === "throw") for (let t of e.seen.entries()) {
		let e = t[1];
		if (e.cycle) throw Error(`Cycle detected: #/${e.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (let n of e.seen.entries()) {
		let r = n[1];
		if (t === n[0]) a(n);
		else {
			if (e.external) {
				let r = e.external.registry.get(n[0])?.id;
				if (t !== n[0] && r) {
					a(n);
					continue;
				}
			}
			(e.metadataRegistry.get(n[0])?.id || r.cycle || r.count > 1 && e.reused === "ref") && a(n);
		}
	}
	e.external && (e.sharedDefsExtractedFor = e.external);
}
function ya(e) {
	let t = e.anyOf;
	if (!Array.isArray(t) || t.length === 0 || e.type !== void 0) return;
	let n = [];
	for (let e of t) {
		if (!e || typeof e != "object") return;
		ya(e);
		let t = Object.keys(e);
		if (t.length !== 1 || t[0] !== "type") return;
		let r = e.type;
		for (let e of Array.isArray(r) ? r : [r]) {
			if (typeof e != "string") return;
			n.includes(e) || n.push(e);
		}
	}
	delete e.anyOf, e.type = n.length === 1 ? n[0] : n;
}
var ba = /* @__PURE__ */ new Set([
	"type",
	"properties",
	"required",
	"additionalProperties"
]), xa = ["oneOf", "anyOf"];
function Sa(e) {
	let t = e.additionalProperties;
	return t === void 0 || t === !1 || typeof t != "object" || !t ? null : Object.keys(t).length ? t : null;
}
function Ca(e) {
	let t = [];
	for (let n of e) {
		if (typeof n != "object" || n.type !== "object") return null;
		for (let e in n) if (!ba.has(e)) return null;
		t.push(n);
	}
	let n = {}, r = /* @__PURE__ */ new Set();
	for (let e of t) {
		for (let r in e.properties) {
			if (Object.prototype.hasOwnProperty.call(n, r)) continue;
			let e = [];
			for (let n of t) {
				let t = n.properties?.[r] ?? Sa(n);
				t != null && (e.some((e) => JSON.stringify(e) === JSON.stringify(t)) || e.push(t));
			}
			l(n, r, e.length === 1 ? e[0] : Ca(e) ?? { allOf: e });
		}
		for (let t of e.required ?? []) r.add(t);
	}
	let i = {
		type: "object",
		properties: n
	};
	if (r.size && (i.required = [...r]), t.every((e) => e.additionalProperties === !1)) i.additionalProperties = !1;
	else {
		let e = [];
		for (let n of t) {
			let t = Sa(n);
			t && !e.some((e) => JSON.stringify(e) === JSON.stringify(t)) && e.push(t);
		}
		e.length === 1 ? i.additionalProperties = e[0] : e.length > 1 && (i.additionalProperties = { allOf: e });
	}
	return i;
}
function wa(e) {
	let t = e.allOf;
	if (!Array.isArray(t) || t.length < 2) return;
	for (let t of ba) if (t in e) return;
	let n = t.filter((e) => xa.some((t) => Array.isArray(e[t]))), r = null;
	if (!n.length) r = Ca(t);
	else {
		let e = n[0], i = xa.find((t) => Array.isArray(e[t]));
		if (Object.keys(e).length !== 1) return;
		let a = t.filter((t) => t !== e), o = e[i].map((e) => Ca([...a, e]));
		if (o.some((e) => !e)) return;
		r = { [i]: o };
	}
	r && (delete e.allOf, R(e, r));
}
function Ta(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	let r = (t) => {
		let n = e.seen.get(t);
		if (n.ref === null) return;
		let i = n.def ?? n.schema, a = { ...i }, o = n.ref;
		if (n.ref = null, o) {
			r(o);
			let n = e.seen.get(o), s = n.schema;
			if (s.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (i.allOf = i.allOf ?? [], i.allOf.push(s)) : R(i, s), R(i, a), t._zod.parent === o) for (let e in i) e !== "$ref" && e !== "allOf" && (e in a || delete i[e]);
			if (s.$ref && n.def) for (let e in i) e !== "$ref" && e !== "allOf" && e in n.def && JSON.stringify(i[e]) === JSON.stringify(n.def[e]) && delete i[e];
		}
		let s = t._zod.parent;
		if (s && s !== o) {
			r(s);
			let t = e.seen.get(s);
			if (t?.schema.$ref && (i.$ref = t.schema.$ref, t.def)) for (let e in i) e !== "$ref" && e !== "allOf" && e in t.def && JSON.stringify(i[e]) === JSON.stringify(t.def[e]) && delete i[e];
		}
		e.override({
			zodSchema: t,
			jsonSchema: i,
			path: n.path ?? []
		});
	};
	if (!e.external || e.sharedEmitDoneFor !== e.external) {
		for (let t of [...e.seen.entries()].reverse()) r(t[0]);
		if (e.target !== "openapi-3.0") for (let t of e.seen.entries()) ya(t[1].def ?? t[1].schema);
		for (let t of e.deferred) t();
		if (e.intersections.length) {
			let t = /* @__PURE__ */ new Map();
			for (let n of e.seen.values()) for (let e of [n.schema, n.def]) {
				let n = e?.allOf;
				if (!Array.isArray(n)) continue;
				let r = t.get(n);
				r ? r.push(e) : t.set(n, [e]);
			}
			for (let n of e.intersections) for (let e of t.get(n) ?? []) wa(e);
		}
	}
	let i = {};
	if (e.target === "draft-2020-12" ? i.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? i.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? i.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
		let n = e.external.registry.get(t)?.id;
		if (!n) throw Error("Schema is missing an `id` property");
		i.$id = e.external.uri(n);
	}
	R(i, n.defId ? n.schema : n.def ?? n.schema);
	let a = e.metadataRegistry.get(t)?.id;
	a !== void 0 && i.id === a && delete i.id;
	let o = e.external?.defs ?? {};
	if (!e.external || e.sharedEmitDoneFor !== e.external) for (let t of e.seen.entries()) {
		let e = t[1];
		e.def && e.defId && (e.def.id === e.defId && delete e.def.id, l(o, e.defId, e.def));
	}
	e.external && (e.sharedEmitDoneFor = e.external), e.external || Object.keys(o).length > 0 && (e.target === "draft-2020-12" ? i.$defs = o : i.definitions = o);
	try {
		let n = JSON.parse(JSON.stringify(i));
		return Object.defineProperty(n, "~standard", {
			value: {
				...t["~standard"],
				jsonSchema: {
					input: Da(t, "input", e.processors),
					output: Da(t, "output", e.processors)
				}
			},
			enumerable: !1,
			writable: !1
		}), n;
	} catch {
		throw Error("Error converting schema to JSON.");
	}
}
function V(e, t) {
	let n = t ?? { seen: /* @__PURE__ */ new Set() };
	if (n.seen.has(e)) return !1;
	n.seen.add(e);
	let r = e._zod.def;
	if (r.type === "transform") return !0;
	if (r.type === "array") return V(r.element, n);
	if (r.type === "set") return V(r.valueType, n);
	if (r.type === "lazy") return V(r.getter(), n);
	if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault" || r.type === "catch") return V(r.innerType, n);
	if (r.type === "intersection") return V(r.left, n) || V(r.right, n);
	if (r.type === "record" || r.type === "map") return V(r.keyType, n) || V(r.valueType, n);
	if (r.type === "pipe") return e._zod.traits.has("$ZodCodec") ? !0 : V(r.in, n) || V(r.out, n);
	if (r.type === "object") {
		for (let e in r.shape) if (V(r.shape[e], n)) return !0;
		return !1;
	}
	if (r.type === "union") {
		for (let e of r.options) if (V(e, n)) return !0;
		return !1;
	}
	if (r.type === "tuple") {
		for (let e of r.items) if (V(e, n)) return !0;
		return !!(r.rest && V(r.rest, n));
	}
	return !1;
}
var Ea = (e, t = {}) => (n) => {
	let r = ga({
		...n,
		processors: t
	});
	return B(e, r), va(r, e), Ta(r, e);
}, Da = (e, t, n = {}) => (r) => {
	let { libraryOptions: i, target: a } = r ?? {}, o = ga({
		...i ?? {},
		target: a,
		io: t,
		processors: n
	});
	return B(e, o), va(o, e), Ta(o, e);
}, H = (e, t, n) => {
	(e[t] === void 0 || n > e[t]) && (e[t] = n);
}, U = (e, t, n) => {
	(e[t] === void 0 || n < e[t]) && (e[t] = n);
}, Oa = (e, t) => {
	H(e, "minimum", t), U(e, "maximum", t);
}, ka = (e, t) => {
	e.multipleOf ??= [], e.multipleOf.includes(t) || e.multipleOf.push(t);
}, Aa = (e, t) => {
	e.patterns ??= /* @__PURE__ */ new Set(), e.patterns.add(t);
}, ja = (e, t) => {
	e.mime = e.mime ? e.mime.filter((e) => t.includes(e)) : [...t];
}, Ma = (e, t) => {
	e.format = t, t.includes("int") && (e.isInt = !0);
}, Na = (e, t) => H(e, "minimum", t.minimum), Pa = (e, t) => U(e, "maximum", t.maximum), Fa = (e) => (t, n) => {
	Ma(t, n.format);
	let [r, i] = e[n.format];
	H(t, "minimum", r), U(t, "maximum", i);
}, Ia = {
	greater_than: (e, t) => H(e, t.inclusive ? "minimum" : "exclusiveMinimum", t.value),
	less_than: (e, t) => U(e, t.inclusive ? "maximum" : "exclusiveMaximum", t.value),
	multiple_of: (e, t) => ka(e, t.value),
	number_format: Fa(ue),
	bigint_format: Fa(de),
	min_length: Na,
	max_length: Pa,
	length_equals: (e, t) => Oa(e, t.length),
	min_size: Na,
	max_size: Pa,
	size_equals: (e, t) => Oa(e, t.size),
	string_format: (e, t) => {
		Ma(e, t.format), t.pattern && Aa(e, t.pattern), (t.format === "base64" || t.format === "base64url") && (e.contentEncoding = t.format), (t.local || t.precision === -1) && (e.laxFormat = !0);
	},
	mime_type: (e, t) => ja(e, t.mime)
};
function W(e) {
	let t = {}, n = e._zod.def, r = e._zod.traits.has("$ZodCheck") ? [e, ...n.checks ?? []] : n.checks ?? [];
	for (let e of r) Ia[e._zod.def.check]?.(t, e._zod.def);
	let i = e._zod.bag;
	i.minimum !== void 0 && H(t, "minimum", i.minimum), i.exclusiveMinimum !== void 0 && H(t, "exclusiveMinimum", i.exclusiveMinimum), i.maximum !== void 0 && U(t, "maximum", i.maximum), i.exclusiveMaximum !== void 0 && U(t, "exclusiveMaximum", i.exclusiveMaximum), i.multipleOf !== void 0 && ka(t, i.multipleOf), i.format !== void 0 && (t.format ??= i.format, i.format.includes("int") && (t.isInt = !0)), i.mime && ja(t, i.mime);
	for (let e of i.patterns ?? []) Aa(t, e);
	return t;
}
var La = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
}, Ra = /* @__PURE__ */ new Map([[Zn, Ft], [$n, It]]), za = (e) => Ra.get(e) ?? e, Ba = (e, t, n, r) => {
	let i = n;
	i.type = "string";
	let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l, laxFormat: u } = W(e);
	if (typeof a == "number" && (i.minLength = a), typeof o == "number" && (i.maxLength = o), s && (i.format = La[s] ?? s, i.format === "" && delete i.format, (s === "time" || u) && delete i.format), l && (i.contentEncoding = l), c && c.size > 0) {
		let e = [...c].map(za);
		e.length === 1 ? i.pattern = e[0].source : e.length > 1 && (i.allOf = [...e.map((e) => ({
			...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: e.source
		}))]);
	}
}, Va = (e, t, n, r) => {
	let i = n, { minimum: a, maximum: o, multipleOf: s, exclusiveMaximum: c, exclusiveMinimum: l, isInt: u } = W(e);
	i.type = u ? "integer" : "number";
	let d = typeof l == "number" && l >= (a ?? -Infinity), f = typeof c == "number" && c <= (o ?? Infinity), p = t.target === "draft-04" || t.target === "openapi-3.0";
	if (d ? p ? (i.minimum = l, i.exclusiveMinimum = !0) : i.exclusiveMinimum = l : typeof a == "number" && (i.minimum = a), f ? p ? (i.maximum = c, i.exclusiveMaximum = !0) : i.exclusiveMaximum = c : typeof o == "number" && (i.maximum = o), s) {
		let n = /* @__PURE__ */ new Set();
		for (let a of s) Number.isFinite(a) && a !== 0 ? n.add(Math.abs(a)) : z(e, t, i, r, `A multipleOf divisor of ${a} cannot be represented in JSON Schema`);
		let [a, ...o] = n;
		a !== void 0 && (i.multipleOf = a), o.length && (i.allOf = [...i.allOf ?? [], ...o.map((e) => ({ multipleOf: e }))]);
	}
}, Ha = (e, t, n, r) => {
	n.type = "boolean";
}, Ua = (e, t, n, r) => {
	n.not = {};
}, Wa = (e, n, r, i) => {
	let a = e._zod.def, o = t(a.entries);
	o.length === 0 ? r.not = {} : (o.every((e) => typeof e == "number") && (r.type = "number"), o.every((e) => typeof e == "string") && (r.type = "string"), r.enum = o);
}, Ga = (e, t, n, r) => {
	let i = e._zod.def;
	if (i.values.length === 0) {
		n.not = {};
		return;
	}
	let a = [];
	for (let o of i.values) if (o === void 0) {
		if (z(e, t, n, r, "Literal `undefined` cannot be represented in JSON Schema")) return;
	} else if (typeof o == "bigint") {
		if (z(e, t, n, r, "BigInt literals cannot be represented in JSON Schema")) return;
		a.push(Number(o));
	} else a.push(o);
	if (a.length !== 0) {
		if (a.length === 1) {
			let e = a[0];
			n.type = e === null ? "null" : typeof e, t.target === "draft-04" || t.target === "openapi-3.0" ? n.enum = [e] : n.const = e;
		} else a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), a.every((e) => typeof e == "boolean") && (n.type = "boolean"), a.every((e) => e === null) && (n.type = "null"), n.enum = a;
	}
}, Ka = (e, t, n, r) => {
	z(e, t, n, r, "Custom types cannot be represented in JSON Schema");
}, qa = (e, t, n, r) => {
	z(e, t, n, r, "Transforms cannot be represented in JSON Schema");
}, Ja = (e, t, n, r) => {
	let i = n, a = e._zod.def, { minimum: o, maximum: s } = W(e);
	typeof o == "number" && (i.minItems = o), typeof s == "number" && (i.maxItems = s), i.type = "array", i.items = B(a.element, t, {
		...r,
		path: [...r.path, "items"]
	});
};
function Ya(e) {
	let t = e._zod.def;
	return t.type === "pipe" && t.in._zod.traits.has("$ZodTransform") ? Ya(t.out) : t.type === "catch" ? Ya(t.innerType) : e._zod.optin;
}
var Xa = (e, t, n, r) => {
	let i = n, a = e._zod.def, o = a.shape;
	if (Object.getOwnPropertySymbols(o).length && z(e, t, i, r, "Symbol keys cannot be represented in JSON Schema")) return;
	i.type = "object", i.properties = {};
	for (let e in o) l(i.properties, e, B(o[e], t, {
		...r,
		path: [
			...r.path,
			"properties",
			e
		]
	}));
	let s = [];
	for (let e of Object.keys(o)) {
		let n = a.shape[e];
		(t.io === "input" ? Ya(n) === void 0 : n._zod.optout === void 0) && s.push(e);
	}
	s.length > 0 && (i.required = s), a.catchall?._zod.def.type === "never" ? i.additionalProperties = !1 : a.catchall ? a.catchall && (i.additionalProperties = B(a.catchall, t, {
		...r,
		path: [...r.path, "additionalProperties"]
	})) : t.io === "output" && (i.additionalProperties = !1);
}, Za = (e, t, n, r) => {
	let i = e._zod.def, a = i.inclusive === !1, o = i.options.map((e, n) => B(e, t, {
		...r,
		path: [
			...r.path,
			a ? "oneOf" : "anyOf",
			n
		]
	}));
	a ? n.oneOf = o : n.anyOf = o;
}, Qa = (e, t, n, r) => {
	let i = e._zod.def, a = B(i.left, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			0
		]
	}), o = B(i.right, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			1
		]
	}), s = (e) => "allOf" in e && Object.keys(e).length === 1, c = [...s(a) ? a.allOf : [a], ...s(o) ? o.allOf : [o]];
	n.allOf = c, t.intersections.push(c);
};
function $a(e, t, n) {
	if (t.$ref) {
		if (n.has(t)) return t;
		n.add(t);
		let r = e.get(t)?.def;
		if (!r) return t;
		let i = $a(e, r, n);
		return i === r ? t : i;
	}
	for (let r of ["anyOf", "oneOf"]) {
		let i = t[r];
		if (!Array.isArray(i)) continue;
		let a = i.map((t) => $a(e, t, n));
		a.some((e, t) => e !== i[t]) && (t = {
			...t,
			[r]: a
		});
	}
	let r = Array.isArray(t.type) ? t.type : [t.type], i = !r.includes("string") && r.some((e) => e === "number" || e === "integer"), a = t.enum ?? (t.const === void 0 ? void 0 : [t.const]);
	if (!i && !a?.some((e) => typeof e == "number")) return t;
	let { minimum: o, maximum: s, exclusiveMinimum: c, exclusiveMaximum: l, multipleOf: u, format: d, id: f, ...p } = t;
	return p.enum ? p.enum = p.enum.map((e) => typeof e == "number" ? String(e) : e) : typeof p.const == "number" && (p.const = String(p.const)), i && (p.type = "string", a || (p.pattern = (r.includes("number") ? qt : Kt).source)), p;
}
var eo = /* @__PURE__ */ new WeakMap();
function to(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.seen.values()) n.def && !t.has(n.schema) && t.set(n.schema, n);
	let n = /* @__PURE__ */ new Map();
	for (let r of eo.get(e) ?? []) {
		let i = e.seen.get(r), a = (i?.def ?? i?.schema)?.propertyNames;
		if (!a || a === !0 || n.has(a)) continue;
		let o = $a(t, a, /* @__PURE__ */ new Set());
		o !== a && n.set(a, o);
	}
	if (n.size) for (let t of e.seen.values()) for (let e of [t.schema, t.def]) {
		let t = e && n.get(e.propertyNames);
		t && (e.propertyNames = t);
	}
}
var no = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "object";
	let o = a.keyType, s = W(o).patterns;
	if (a.mode === "loose" && s && s.size > 0) {
		let e = B(a.valueType, t, {
			...r,
			path: [
				...r.path,
				"patternProperties",
				"*"
			]
		});
		i.patternProperties = {};
		for (let t of s) l(i.patternProperties, za(t).source, e);
	} else {
		if (t.target === "draft-07" || t.target === "draft-2020-12") {
			i.propertyNames = B(a.keyType, t, {
				...r,
				path: [...r.path, "propertyNames"]
			});
			let n = eo.get(t);
			n || (n = [], eo.set(t, n), t.deferred.push(() => to(t))), n.push(e);
		}
		i.additionalProperties = B(a.valueType, t, {
			...r,
			path: [...r.path, "additionalProperties"]
		});
	}
	let c = o._zod.values, u = t.io === "input" && Ya(a.valueType) !== void 0;
	if (c && !a.partial && !u) {
		let e = [...c].filter((e) => typeof e == "string" || typeof e == "number");
		e.length > 0 && (i.required = e.map(String));
	}
}, ro = (e, t, n, r) => {
	let i = e._zod.def, a = B(i.innerType, t, r), o = t.seen.get(e);
	t.target === "openapi-3.0" ? (o.ref = i.innerType, n.nullable = !0) : n.anyOf = [a, { type: "null" }];
}, io = (e, t, n, r) => {
	let i = e._zod.def;
	B(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, ao = Symbol();
function oo(e, t, n, r, i) {
	let a = !1, o = JSON.stringify(e, (e, t) => typeof t == "bigint" ? (a = !0, null) : t);
	return a ? (z(t, n, r, i, "BigInt defaults cannot be represented in JSON Schema"), ao) : JSON.parse(o);
}
var so = (e, t, n, r) => {
	let i = e._zod.def;
	B(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o = oo(i.defaultValue, e, t, n, r);
	o !== ao && (n.default = o);
}, co = (e, t, n, r) => {
	let i = e._zod.def;
	B(i.innerType, t, r);
	let a = t.seen.get(e);
	if (a.ref = i.innerType, t.io !== "input") return;
	let o = oo(i.defaultValue, e, t, n, r);
	o !== ao && (n._prefault = o);
}, lo = (e, t, n, r) => {
	let i = e._zod.def;
	B(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o;
	try {
		o = i.catchValue(void 0);
	} catch {
		z(e, t, n, r, "Dynamic catch values are not supported in JSON Schema");
		return;
	}
	n.default = o;
}, uo = (e, t, n, r) => {
	let i = e._zod.def, a = i.in._zod.traits.has("$ZodTransform"), o = t.io === "input" ? a ? i.out : i.in : i.out;
	B(o, t, r);
	let s = t.seen.get(e);
	s.ref = o;
}, fo = (e, t, n, r) => {
	let i = e._zod.def;
	B(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.readOnly = !0;
}, po = (e, t, n, r) => {
	let i = e._zod.def;
	B(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, mo = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function ho(e, t, n) {
	Object.defineProperty(e, t, {
		configurable: !0,
		enumerable: !1,
		get() {
			let e = n(this);
			return Object.defineProperty(this, t, {
				value: e,
				configurable: !0,
				writable: !0
			}), e;
		},
		set(e) {
			Object.defineProperty(this, t, {
				value: e,
				configurable: !0,
				writable: !0
			});
		}
	});
}
var G = /*@__PURE__*/ D("ZodError", (e, t) => {
	Ye.init(e, t), e.name = "ZodError";
	let n = Object.getPrototypeOf(e);
	mo.has(n) || (mo.add(n), ho(n, "format", (e) => (t) => Qe(e, t)), ho(n, "flatten", (e) => (t) => Ze(e, t)), ho(n, "addIssue", (e) => (t) => {
		e.issues.push(t), e.message = JSON.stringify(e.issues, r, 2);
	}), ho(n, "addIssues", (e) => (t) => {
		e.issues.push(...t), e.message = JSON.stringify(e.issues, r, 2);
	}), Object.defineProperty(n, "isEmpty", {
		configurable: !0,
		enumerable: !1,
		get() {
			return this.issues.length === 0;
		}
	}));
}, void 0, { Parent: Error }), go = /* @__PURE__ */ et(G), _o = /* @__PURE__ */ tt(G), vo = /* @__PURE__ */ nt(G), yo = /* @__PURE__ */ it(G), bo = /* @__PURE__ */ ut(G), xo = /* @__PURE__ */ dt(G), So = /* @__PURE__ */ ft(G), Co = /* @__PURE__ */ pt(G), wo = /* @__PURE__ */ mt(G), To = /* @__PURE__ */ ht(G), Eo = /* @__PURE__ */ gt(G), Do = /* @__PURE__ */ _t(G);
// ../node_modules/zod/v4/classic/schemas.js
function Oo() {
	k.localeError || A(ui());
}
function ko() {
	k.memoizer || A({ memoizer: si() });
}
var K = /*@__PURE__*/ D("ZodType", (e, t) => (Oo(), M.init(e, t), e.def = t, e.type = t.type, e), {
	check(...e) {
		let t = this.def;
		return this.clone(h(t, { checks: [...t.checks ?? [], ...e.map((e) => typeof e == "function" ? { _zod: {
			check: e,
			def: { check: "custom" },
			onattach: []
		} } : e)] }), { parent: !0 });
	},
	with(...e) {
		return this.check(...e);
	},
	clone(e, t) {
		return v(this, e, t);
	},
	brand() {
		return this;
	},
	register(e, t) {
		return e.add(this, t), this;
	},
	refine(e, t) {
		return this.check(Ws(e, t));
	},
	superRefine(e, t) {
		return this.check(Gs(e, t));
	},
	overwrite(e) {
		return this.check(/* @__PURE__ */ L(e));
	},
	optional() {
		return Es(this);
	},
	exactOptional() {
		return Os(this);
	},
	nullable() {
		return As(this);
	},
	nullish() {
		return Es(As(this));
	},
	nonoptional(e) {
		return Is(this, e);
	},
	array() {
		return X(this);
	},
	or(e) {
		return ps([this, e]);
	},
	and(e) {
		return _s(this, e);
	},
	transform(e) {
		return Bs(this, ws(e));
	},
	default(e) {
		return Ms(this, e);
	},
	prefault(e) {
		return Ps(this, e);
	},
	catch(e) {
		return Rs(this, e);
	},
	pipe(e) {
		return Bs(this, e);
	},
	readonly() {
		return Hs(this);
	},
	describe(e) {
		let t = this.clone();
		return I.add(t, { description: e }), t;
	},
	meta(...e) {
		if (e.length === 0) return I.get(this);
		let t = this.clone();
		return I.add(t, e[0]), t;
	},
	isOptional() {
		return this.safeParse(void 0).success;
	},
	isNullable() {
		return this.safeParse(null).success;
	},
	apply(e, ...t) {
		return t.length === 0 ? e(this) : e(this, ...t);
	},
	get "~standard"() {
		return Ae(this, "~standard", {
			...yn(this),
			jsonSchema: {
				input: Da(this, "input"),
				output: Da(this, "output")
			}
		});
	},
	set "~standard"(e) {
		w(this, "~standard", e);
	},
	parse: function e(t, n) {
		return go(this, t, n, { callee: e });
	},
	parseAsync: async function e(t, n) {
		return await _o(this, t, n, { callee: e });
	},
	safeParse(e, t) {
		return vo(this, e, t);
	},
	async safeParseAsync(e, t) {
		return yo(this, e, t);
	},
	get spa() {
		return this?.safeParseAsync;
	},
	set spa(e) {
		w(this, "spa", e);
	},
	validate(e, t) {
		return st(this, e, t);
	},
	validateAsync(e, t) {
		return lt(this, e, t);
	},
	encode: function e(t, n) {
		return bo(this, t, n, { callee: e });
	},
	decode: function e(t, n) {
		return xo(this, t, n, { callee: e });
	},
	encodeAsync: async function e(t, n) {
		return await So(this, t, n, { callee: e });
	},
	decodeAsync: async function e(t, n) {
		return await Co(this, t, n, { callee: e });
	},
	safeEncode(e, t) {
		return wo(this, e, t);
	},
	safeDecode(e, t) {
		return To(this, e, t);
	},
	async safeEncodeAsync(e, t) {
		return Eo(this, e, t);
	},
	async safeDecodeAsync(e, t) {
		return Do(this, e, t);
	},
	toJSONSchema(e) {
		return Ea(this, {})(e);
	},
	get description() {
		return I.get(this)?.description;
	},
	get _def() {
		return this._zod.def;
	}
}), Ao = /*@__PURE__*/ D("_ZodString", (e, t) => {
	bn.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ba(e, t, n, r);
}, /*@__PURE__*/ je({
	format: (e) => W(e).format ?? null,
	minLength: (e) => W(e).minimum ?? null,
	maxLength: (e) => W(e).maximum ?? null
}, {
	regex(...e) {
		return this.check(/* @__PURE__ */ ta(...e));
	},
	includes(...e) {
		return this.check(/* @__PURE__ */ ia(...e));
	},
	startsWith(...e) {
		return this.check(/* @__PURE__ */ aa(...e));
	},
	endsWith(...e) {
		return this.check(/* @__PURE__ */ oa(...e));
	},
	min(...e) {
		return this.check(/* @__PURE__ */ $i(...e));
	},
	max(...e) {
		return this.check(/* @__PURE__ */ Qi(...e));
	},
	length(...e) {
		return this.check(/* @__PURE__ */ ea(...e));
	},
	nonempty(...e) {
		return this.check(/* @__PURE__ */ $i(1, ...e));
	},
	lowercase(e) {
		return this.check(/* @__PURE__ */ na(e));
	},
	uppercase(e) {
		return this.check(/* @__PURE__ */ ra(e));
	},
	trim() {
		return this.check(/* @__PURE__ */ ca());
	},
	normalize(...e) {
		return this.check(/* @__PURE__ */ sa(...e));
	},
	toLowerCase() {
		return this.check(/* @__PURE__ */ la());
	},
	toUpperCase() {
		return this.check(/* @__PURE__ */ ua());
	},
	slugify() {
		return this.check(/* @__PURE__ */ da());
	}
})), jo = /*@__PURE__*/ D("ZodString", (e, t) => {
	bn.init(e, t), Ao.init(e, t);
}, {
	email(e) {
		return this.check(/* @__PURE__ */ gi(Io, e));
	},
	url(e) {
		return this.check(/* @__PURE__ */ Si(zo, e));
	},
	jwt(e) {
		return this.check(/* @__PURE__ */ Li(es, e));
	},
	emoji(e) {
		return this.check(/* @__PURE__ */ Ci(Bo, e));
	},
	guid(e) {
		return this.check(/* @__PURE__ */ _i(Lo, e));
	},
	uuid(e) {
		return this.check(/* @__PURE__ */ vi(Ro, e));
	},
	uuidv4(e) {
		return this.check(/* @__PURE__ */ yi(Ro, e));
	},
	uuidv6(e) {
		return this.check(/* @__PURE__ */ bi(Ro, e));
	},
	uuidv7(e) {
		return this.check(/* @__PURE__ */ xi(Ro, e));
	},
	nanoid(e) {
		return this.check(/* @__PURE__ */ wi(Vo, e));
	},
	cuid(e) {
		return this.check(/* @__PURE__ */ Ti(Ho, e));
	},
	cuid2(e) {
		return this.check(/* @__PURE__ */ Ei(Uo, e));
	},
	ulid(e) {
		return this.check(/* @__PURE__ */ Di(Wo, e));
	},
	base64(e) {
		return this.check(/* @__PURE__ */ Pi(Zo, e));
	},
	base64url(e) {
		return this.check(/* @__PURE__ */ Fi(Qo, e));
	},
	xid(e) {
		return this.check(/* @__PURE__ */ Oi(Go, e));
	},
	ksuid(e) {
		return this.check(/* @__PURE__ */ ki(Ko, e));
	},
	ipv4(e) {
		return this.check(/* @__PURE__ */ Ai(qo, e));
	},
	ipv6(e) {
		return this.check(/* @__PURE__ */ ji(Jo, e));
	},
	cidrv4(e) {
		return this.check(/* @__PURE__ */ Mi(Yo, e));
	},
	cidrv6(e) {
		return this.check(/* @__PURE__ */ Ni(Xo, e));
	},
	e164(e) {
		return this.check(/* @__PURE__ */ Ii($o, e));
	},
	datetime(e) {
		return this.check(/* @__PURE__ */ Ri(Mo, e));
	},
	date(e) {
		return this.check(/* @__PURE__ */ zi(No, e));
	},
	time(e) {
		return this.check(/* @__PURE__ */ Bi(Po, e));
	},
	duration(e) {
		return this.check(/* @__PURE__ */ Vi(Fo, e));
	}
});
function q(e) {
	return /* @__PURE__ */ hi(jo, e);
}
var J = /*@__PURE__*/ D("ZodStringFormat", (e, t) => {
	N.init(e, t), Ao.init(e, t);
}), Mo = /*@__PURE__*/ D("ZodISODateTime", (e, t) => {
	zn.init(e, t), J.init(e, t);
}), No = /*@__PURE__*/ D("ZodISODate", (e, t) => {
	Bn.init(e, t), J.init(e, t);
}), Po = /*@__PURE__*/ D("ZodISOTime", (e, t) => {
	Vn.init(e, t), J.init(e, t);
}), Fo = /*@__PURE__*/ D("ZodISODuration", (e, t) => {
	Hn.init(e, t), J.init(e, t);
}), Io = /*@__PURE__*/ D("ZodEmail", (e, t) => {
	Cn.init(e, t), J.init(e, t);
}), Lo = /*@__PURE__*/ D("ZodGUID", (e, t) => {
	xn.init(e, t), J.init(e, t);
}), Ro = /*@__PURE__*/ D("ZodUUID", (e, t) => {
	Sn.init(e, t), J.init(e, t);
}), zo = /*@__PURE__*/ D("ZodURL", (e, t) => {
	jn.init(e, t), J.init(e, t);
}), Bo = /*@__PURE__*/ D("ZodEmoji", (e, t) => {
	Mn.init(e, t), J.init(e, t);
}), Vo = /*@__PURE__*/ D("ZodNanoID", (e, t) => {
	Nn.init(e, t), J.init(e, t);
}), Ho = /*@__PURE__*/ D("ZodCUID", (e, t) => {
	Pn.init(e, t), J.init(e, t);
}), Uo = /*@__PURE__*/ D("ZodCUID2", (e, t) => {
	Fn.init(e, t), J.init(e, t);
}), Wo = /*@__PURE__*/ D("ZodULID", (e, t) => {
	In.init(e, t), J.init(e, t);
}), Go = /*@__PURE__*/ D("ZodXID", (e, t) => {
	Ln.init(e, t), J.init(e, t);
}), Ko = /*@__PURE__*/ D("ZodKSUID", (e, t) => {
	Rn.init(e, t), J.init(e, t);
}), qo = /*@__PURE__*/ D("ZodIPv4", (e, t) => {
	Un.init(e, t), J.init(e, t);
}), Jo = /*@__PURE__*/ D("ZodIPv6", (e, t) => {
	Kn.init(e, t), J.init(e, t);
}), Yo = /*@__PURE__*/ D("ZodCIDRv4", (e, t) => {
	qn.init(e, t), J.init(e, t);
}), Xo = /*@__PURE__*/ D("ZodCIDRv6", (e, t) => {
	Yn.init(e, t), J.init(e, t);
}), Zo = /*@__PURE__*/ D("ZodBase64", (e, t) => {
	Qn.init(e, t), J.init(e, t);
}), Qo = /*@__PURE__*/ D("ZodBase64URL", (e, t) => {
	tr.init(e, t), J.init(e, t);
}), $o = /*@__PURE__*/ D("ZodE164", (e, t) => {
	nr.init(e, t), J.init(e, t);
}), es = /*@__PURE__*/ D("ZodJWT", (e, t) => {
	ir.init(e, t), J.init(e, t);
}), ts = /*@__PURE__*/ D("ZodNumber", (e, t) => {
	ar.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Va(e, t, n, r), e.isFinite = !0;
}, /*@__PURE__*/ je({
	minValue: (e) => {
		let { minimum: t, exclusiveMinimum: n } = W(e);
		return Math.max(t ?? -Infinity, n ?? -Infinity);
	},
	maxValue: (e) => {
		let { maximum: t, exclusiveMaximum: n } = W(e);
		return Math.min(t ?? Infinity, n ?? Infinity);
	},
	isInt: (e) => {
		let { isInt: t, multipleOf: n } = W(e);
		return !!t || !!n?.some(Number.isSafeInteger);
	},
	format: (e) => W(e).format ?? null
}, {
	gt(e, t) {
		return this.check(/* @__PURE__ */ Yi(e, t));
	},
	gte(e, t) {
		return this.check(/* @__PURE__ */ Xi(e, t));
	},
	min(e, t) {
		return this.check(/* @__PURE__ */ Xi(e, t));
	},
	lt(e, t) {
		return this.check(/* @__PURE__ */ qi(e, t));
	},
	lte(e, t) {
		return this.check(/* @__PURE__ */ Ji(e, t));
	},
	max(e, t) {
		return this.check(/* @__PURE__ */ Ji(e, t));
	},
	int(e) {
		return this.check(is(e));
	},
	safe(e) {
		return this.check(is(e));
	},
	positive(e) {
		return this.check(/* @__PURE__ */ Yi(0, e));
	},
	nonnegative(e) {
		return this.check(/* @__PURE__ */ Xi(0, e));
	},
	negative(e) {
		return this.check(/* @__PURE__ */ qi(0, e));
	},
	nonpositive(e) {
		return this.check(/* @__PURE__ */ Ji(0, e));
	},
	multipleOf(e, t) {
		return this.check(/* @__PURE__ */ Zi(e, t));
	},
	step(e, t) {
		return this.check(/* @__PURE__ */ Zi(e, t));
	},
	finite() {
		return this;
	}
}));
function ns(e) {
	return /* @__PURE__ */ Hi(ts, e);
}
var rs = /*@__PURE__*/ D("ZodNumberFormat", (e, t) => {
	or.init(e, t), ts.init(e, t);
});
function is(e) {
	return /* @__PURE__ */ Ui(rs, e);
}
var as = /*@__PURE__*/ D("ZodBoolean", (e, t) => {
	sr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ha(e, t, n, r);
});
function Y(e) {
	return /* @__PURE__ */ Wi(as, e);
}
var os = /*@__PURE__*/ D("ZodUnknown", (e, t) => {
	cr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (e, t, n) => void 0;
});
function ss() {
	return /* @__PURE__ */ Gi(os);
}
var cs = /*@__PURE__*/ D("ZodNever", (e, t) => {
	lr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ua(e, t, n, r);
});
function ls(e) {
	return /* @__PURE__ */ Ki(cs, e);
}
var us = /*@__PURE__*/ D("ZodArray", (e, t) => {
	ko(), pr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ja(e, t, n, r), e.element = t.element;
}, {
	min(e, t) {
		return this.check(/* @__PURE__ */ $i(e, t));
	},
	nonempty(e) {
		return this.check(/* @__PURE__ */ $i(1, e));
	},
	max(e, t) {
		return this.check(/* @__PURE__ */ Qi(e, t));
	},
	length(e, t) {
		return this.check(/* @__PURE__ */ ea(e, t));
	},
	unwrap() {
		return this.element;
	}
});
function X(e, t) {
	return /* @__PURE__ */ fa(us, e, t);
}
var ds = /*@__PURE__*/ D("ZodObject", (e, t) => {
	ko(), yr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Xa(e, t, n, r), Ie(e, "shape", (e) => e._zod.def.shape, !1);
}, {
	keyof() {
		return Q(Object.keys(this._zod.def.shape));
	},
	catchall(e) {
		return this.clone(h(this._zod.def, { catchall: e }));
	},
	passthrough() {
		return this.clone(h(this._zod.def, { catchall: ss() }));
	},
	loose() {
		return this.clone(h(this._zod.def, { catchall: ss() }));
	},
	strict() {
		return this.clone(h(this._zod.def, { catchall: ls() }));
	},
	strip() {
		return this.clone(h(this._zod.def, { catchall: void 0 }));
	},
	extend(e) {
		return he(this, e);
	},
	safeExtend(e) {
		return _e(this, e);
	},
	merge(e) {
		return ve(this, e);
	},
	pick(e) {
		return fe(this, e);
	},
	omit(e) {
		return me(this, e);
	},
	partial(...e) {
		return ye(Ts, this, e[0]);
	},
	exactPartial(...e) {
		return ye(Ds, this, e[0], "exactPartial");
	},
	required(...e) {
		return be(Fs, this, e[0]);
	}
});
function Z(e, t) {
	return new ds({
		type: "object",
		shape: e,
		catchall: ls(),
		...y(t)
	});
}
var fs = /*@__PURE__*/ D("ZodUnion", (e, t) => {
	xr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Za(e, t, n, r), e.options = t.options;
});
function ps(e, t) {
	return new fs({
		type: "union",
		options: e,
		...y(t)
	});
}
var ms = /*@__PURE__*/ D("ZodDiscriminatedUnion", (e, t) => {
	fs.init(e, t), Cr.init(e, t);
});
function hs(e, t, n) {
	return new ms({
		type: "union",
		options: t,
		discriminator: e,
		...y(n)
	});
}
var gs = /*@__PURE__*/ D("ZodIntersection", (e, t) => {
	wr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Qa(e, t, n, r);
});
function _s(e, t) {
	return new gs({
		type: "intersection",
		left: e,
		right: t
	});
}
var vs = /*@__PURE__*/ D("ZodRecord", (e, t) => {
	ko(), Dr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => no(e, t, n, r), e.keyType = t.keyType, e.valueType = t.valueType;
});
function ys(e, t, n) {
	return !t || !t._zod ? new vs({
		type: "record",
		keyType: q(),
		valueType: e,
		...y(t)
	}) : new vs({
		type: "record",
		keyType: e,
		valueType: t,
		...y(n)
	});
}
var bs = /*@__PURE__*/ D("ZodEnum", (e, t) => {
	Or.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Wa(e, t, n, r), e.enum = t.entries, e.options = [...e._zod.values];
	let n = new Set(Object.keys(t.entries));
	e.extract = (e, r) => {
		let i = {};
		for (let r of e) if (n.has(r)) i[r] = t.entries[r];
		else throw Error(`Key ${r} not found in enum`);
		return new bs({
			...t,
			checks: [],
			...y(r),
			entries: i
		});
	}, e.exclude = (e, r) => {
		let i = { ...t.entries };
		for (let t of e) if (n.has(t)) delete i[t];
		else throw Error(`Key ${t} not found in enum`);
		return new bs({
			...t,
			checks: [],
			...y(r),
			entries: i
		});
	};
});
function Q(e, t) {
	return new bs({
		type: "enum",
		entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
		...y(t)
	});
}
var xs = /*@__PURE__*/ D("ZodLiteral", (e, t) => {
	kr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ga(e, t, n, r), e.values = new Set(t.values), Object.defineProperty(e, "value", { get() {
		if (t.values.length > 1) throw Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return t.values[0];
	} });
});
function Ss(e, t) {
	return new xs({
		type: "literal",
		values: Array.isArray(e) ? e : [e],
		...y(t)
	});
}
var Cs = /*@__PURE__*/ D("ZodTransform", (e, t) => {
	ko(), Ar.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => qa(e, t, n, r), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new Ue(e.constructor.name);
		n.addIssue = (r) => {
			if (typeof r == "string") n.issues.push(C(r, n.value, t));
			else {
				let t = r;
				t.fatal && (t.continue = !1), t.code ??= "custom", "input" in t || (t.input = n.value), t.inst ??= e, n.issues.push(C(t));
			}
		};
		let i = t.transform(n.value, n);
		return i instanceof Promise ? i.then((e) => (n.value = e, n)) : (n.value = i, n);
	};
});
function ws(e) {
	return new Cs({
		type: "transform",
		transform: e
	});
}
var Ts = /*@__PURE__*/ D("ZodOptional", (e, t) => {
	Mr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => po(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Es(e) {
	return new Ts({
		type: "optional",
		innerType: e
	});
}
var Ds = /*@__PURE__*/ D("ZodExactOptional", (e, t) => {
	Nr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => po(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Os(e) {
	return new Ds({
		type: "optional",
		innerType: e
	});
}
var ks = /*@__PURE__*/ D("ZodNullable", (e, t) => {
	Pr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => ro(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function As(e) {
	return new ks({
		type: "nullable",
		innerType: e
	});
}
var js = /*@__PURE__*/ D("ZodDefault", (e, t) => {
	Fr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => so(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function Ms(e, t) {
	return new js({
		type: "default",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : oe(t);
		}
	});
}
var Ns = /*@__PURE__*/ D("ZodPrefault", (e, t) => {
	Lr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => co(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Ps(e, t) {
	return new Ns({
		type: "prefault",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : oe(t);
		}
	});
}
var Fs = /*@__PURE__*/ D("ZodNonOptional", (e, t) => {
	Rr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => io(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Is(e, t) {
	return new Fs({
		type: "nonoptional",
		innerType: e,
		...y(t)
	});
}
var Ls = /*@__PURE__*/ D("ZodCatch", (e, t) => {
	Vr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => lo(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function Rs(e, t) {
	return new Ls({
		type: "catch",
		innerType: e,
		catchValue: typeof t == "function" ? t : Re(t)
	});
}
var zs = /*@__PURE__*/ D("ZodPipe", (e, t) => {
	Hr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => uo(e, t, n, r), e.in = t.in, e.out = t.out;
});
function Bs(e, t) {
	return new zs({
		type: "pipe",
		in: e,
		out: t
	});
}
var Vs = /*@__PURE__*/ D("ZodReadonly", (e, t) => {
	Wr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => fo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Hs(e) {
	return new Vs({
		type: "readonly",
		innerType: e
	});
}
var Us = /*@__PURE__*/ D("ZodCustom", (e, t) => {
	Kr.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ka(e, t, n, r);
});
function Ws(e, t = {}) {
	return /* @__PURE__ */ pa(Us, e, t);
}
function Gs(e, t) {
	return /* @__PURE__ */ ma(e, t);
}
var Ks = [
	"PreferredBottomOrFlip",
	"PreferredTopOrFlip",
	"PreferredLeftOrFlip",
	"PreferredRightOrFlip",
	"Bottom",
	"Top",
	"Left",
	"Right",
	"Vertical",
	"Horizontal"
], qs = Z({
	by: Q([
		"id",
		"css",
		"text"
	]).describe("How to look the control up when the primary lookup fails"),
	value: q().min(1)
}), Js = Z({
	viewName: q().min(1).optional().describe("Fully qualified view name, e.g. my.app.view.Main. Needed to resolve view-local ids."),
	controlId: q().min(1).optional().describe("View-local control id (global id if no viewName). May be omitted for controls without an id when a fallback is given."),
	fallbacks: X(qs).default([])
}).refine((e) => !!e.controlId || e.fallbacks.length > 0, {
	path: ["controlId"],
	message: "A target needs a controlId or at least one fallback"
}), Ys = hs("type", [Z({
	type: Ss("navigate"),
	hash: q().describe("Router hash to navigate to before showing the step, e.g. \"order/new\"")
})]), Xs = Z({
	source: q().optional().describe("Where the step came from, e.g. \"recording:3\""),
	confidence: ns().min(0).max(1).optional(),
	unresolved: Y().default(!1).describe("True when the target could not be verified"),
	note: q().optional()
}), Zs = Z({
	id: q().min(1),
	title: q().min(1),
	text: q().default("").describe("Markdown subset or an {i18n>key} reference"),
	target: Js.optional().describe("Omit for a centered intro/outro step"),
	placement: Q(Ks).default("PreferredBottomOrFlip"),
	before: X(Ys).default([]),
	meta: Xs.optional()
}), Qs = Z({
	showProgress: Y().default(!0),
	allowSkip: Y().default(!0),
	overlay: Y().default(!0),
	interactive: Y().default(!0),
	waitTimeoutMs: ns().int().min(0).max(6e4).default(5e3)
}).prefault({}), $s = Z({
	schemaVersion: Ss(1),
	id: q().min(1),
	title: q().min(1),
	options: Qs,
	steps: X(Zs).min(1)
}).superRefine((e, t) => {
	let n = /* @__PURE__ */ new Set();
	e.steps.forEach((e, r) => {
		n.has(e.id) && t.addIssue({
			code: "custom",
			path: [
				"steps",
				r,
				"id"
			],
			message: `Duplicate step id "${e.id}"`
		}), n.add(e.id);
	});
}), ec = (e) => e.reduce((e, t) => typeof t == "number" ? `${e}[${t}]` : e ? `${e}.${t}` : String(t), ""), tc = (e) => /^__/.test(e);
function nc(e) {
	let t = $s.safeParse(e);
	if (!t.success) return {
		ok: !1,
		tour: null,
		issues: t.error.issues.map((e) => ({
			path: ec(e.path),
			code: e.code,
			severity: "error",
			message: e.message
		}))
	};
	let n = t.data, r = [];
	return n.steps.forEach((e, t) => {
		e.meta?.unresolved && r.push({
			path: `steps[${t}].target`,
			code: "step.unresolved",
			severity: "warning",
			message: `Step "${e.id}": target could not be verified`
		}), e.target?.controlId && tc(e.target.controlId) && r.push({
			path: `steps[${t}].target.controlId`,
			code: "target.unstableId",
			severity: "warning",
			message: `Step "${e.id}": "${e.target.controlId}" is an auto-generated id and may change between runs`
		});
	}), {
		ok: !0,
		tour: n,
		issues: r
	};
}
// ../srv/lib/parsers/manifest.js
var rc = (e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function ic(e) {
	let t = e.split(/(\{[^}]+\}|\/?:[^:]+:)/).map((e) => {
		if (/^\{[^}]+\}$/.test(e)) {
			let t = e.slice(1, -1);
			return t.startsWith("?") ? "" : t.endsWith("*") ? "(.+)" : "([^/]+)";
		}
		if (/^\/?:[^:]+:$/.test(e)) {
			let t = e.startsWith("/");
			return e.slice(+!!t).startsWith(":?") ? "" : t ? "(?:/([^/]*))?" : "([^/]*)";
		}
		return rc(e);
	});
	return RegExp(`^${t.join("")}/?$`);
}
var ac = (e) => String(e ?? "").replace(/^#/, "").replace(/^\//, "").replace(/\?.*$/, "");
function oc(e, t) {
	let n = ac(t);
	for (let t of e) {
		let e = ic(t.pattern).exec(n);
		if (e) {
			let n = {};
			return t.params.forEach((t, r) => {
				e[r + 1] !== void 0 && e[r + 1] !== "" && (n[t] = e[r + 1]);
			}), {
				route: t,
				args: n
			};
		}
	}
	return null;
}
// ../srv/lib/validate/lint.js
var sc = /^\{[\w.-]+>([^}]+)\}$/, $ = {
	title: 60,
	text: 300,
	steps: 15
}, cc = (e, t) => `${e ?? ""}::${t}`;
function lc(e, t) {
	return t.controlId ? e.controls.filter((e) => e.localId === t.controlId && (!t.viewName || e.viewName === t.viewName) || e.globalId === t.controlId) : [];
}
function uc(e, t) {
	let n = (t.fallbacks ?? []).filter((e) => e.by === "text").map((e) => e.value.trim().toLowerCase());
	return e.controls.filter((e) => (!t.viewName || e.viewName === t.viewName) && [
		e.display,
		e.text,
		e.title
	].some((e) => e && n.includes(e.trim().toLowerCase())));
}
function dc(e, t) {
	let n = new Set(t.viewNames);
	for (let t of [...n]) for (let r of e.views.find((e) => e.viewName === t)?.nestedViews ?? []) n.add(r);
	return e.rootViewName && n.add(e.rootViewName), n;
}
function fc(e, t, { recording: n, startHash: r = "" } = {}) {
	let i = nc(e), a = i.issues.map((e) => ({ ...e })), o = () => {
		let e = {
			error: 0,
			warning: 1,
			info: 2
		};
		return a.sort((t, n) => e[t.severity] - e[n.severity]), {
			issues: a,
			summary: {
				errors: a.filter((e) => e.severity === "error").length,
				warnings: a.filter((e) => e.severity === "warning").length,
				infos: a.filter((e) => e.severity === "info").length
			}
		};
	};
	if (!i.ok) return o();
	let s = i.tour.steps, c = (e, t, n, r, i = "") => a.push({
		path: `steps[${e}]${i}`,
		code: t,
		severity: n,
		message: r,
		stepId: s[e].id
	}), l = /* @__PURE__ */ new Map();
	for (let e of n?.steps ?? []) {
		let t = e.ui5?.localId ? cc(e.ui5.viewName, e.ui5.localId) : null;
		t && !l.has(t) && l.set(t, l.size);
	}
	let u = ac(r), d = -1, f = /* @__PURE__ */ new Map(), p = t.i18nKeys?.length ? new Set(t.i18nKeys) : null;
	return s.forEach((e, n) => {
		for (let r of e.before) u = ac(r.hash), t.routes.length && !oc(t.routes, u) && c(n, "navigate.unknownRoute", "warning", `Step "${e.id}" navigates to "${r.hash}", which matches no route in the manifest`, ".before");
		for (let t of ["title", "text"]) {
			let r = sc.exec(e[t]);
			r && p && !p.has(r[1]) && c(n, "i18n.missingKey", "warning", `Step "${e.id}": i18n key "${r[1]}" does not exist in the i18n bundle`, `.${t}`);
		}
		e.title.length > $.title && c(n, "title.long", "warning", `Step "${e.id}": title has ${e.title.length} characters (recommended: up to ${$.title})`, ".title"), e.text.length > $.text && c(n, "text.long", "warning", `Step "${e.id}": text has ${e.text.length} characters (recommended: up to ${$.text})`, ".text"), e.target && !e.text.trim() && c(n, "text.empty", "info", `Step "${e.id}" has no explanatory text`, ".text");
		let r = e.target;
		if (!r) return;
		let i = lc(t, r), a = ".target";
		if (r.controlId && !i.length) {
			let i = t.controls.filter((e) => e.localId === r.controlId);
			if (i.length) {
				let t = [...new Set(i.map((e) => e.viewName))].join(", ");
				c(n, "target.wrongView", "error", `Step "${e.id}": "${r.controlId}" is not in ${r.viewName ?? "any named view"}; it exists in ${t}`, a);
			} else uc(t, r).length ? c(n, "target.idNotFound", "warning", `Step "${e.id}": id "${r.controlId}" is unknown; the text fallback will be used`, a) : c(n, "target.notFound", "error", `Step "${e.id}": no control "${r.controlId}" exists in the app sources`, a);
		} else r.controlId || (uc(t, r).length ? c(n, "target.noId", "warning", `Step "${e.id}": the control has no id and is found by its text only; give it an id in the view`, a) : c(n, "target.notFound", "error", `Step "${e.id}": no control matches the text fallback`, a));
		let o = i[0];
		o?.template && c(n, "target.template", "warning", `Step "${e.id}": "${o.localId}" lives in a bound aggregation, so its runtime id is not stable`, a);
		let m = t.routes.length ? oc(t.routes, u) : null;
		if (m && (r.viewName || o?.viewName) && i.length && !o?.live) {
			let i = dc(t, m.route), a = r.viewName ?? o.viewName;
			i.has(a) || c(n, "step.wrongRoute", "warning", `Step "${e.id}" targets ${a}, but at route "${u || "(default)"}" the app shows ${[...m.route.viewNames].join(", ")}; add a navigate action`, ".before");
		}
		if (r.controlId) {
			let t = cc(r.viewName ?? o?.viewName, r.controlId);
			f.has(t) ? c(n, "step.duplicateTarget", "warning", `Step "${e.id}" highlights the same control as step "${s[f.get(t)].id}"`, a) : f.set(t, n);
			let i = l.get(t);
			i !== void 0 && (i < d && c(n, "step.order", "warning", `Step "${e.id}" comes in a different order than in the recording`, a), d = Math.max(d, i));
		}
	}), s.length > $.steps && a.push({
		path: "steps",
		code: "tour.long",
		severity: "info",
		message: `The tour has ${s.length} steps; tours of up to ${$.steps} are easier to follow`
	}), o();
}
// ../srv/lib/llm/draft.js
var pc = /\.(Button|ToggleButton|MenuButton|Link|IconTabFilter|SegmentedButtonItem)$/;
function mc(e) {
	if (!e.localId) return {
		...e.viewName ? { viewName: e.viewName } : {},
		fallbacks: e.display ? [{
			by: "text",
			value: e.display
		}] : []
	};
	let t = e.display && (e.text === e.display || e.title === e.display) && pc.test(e.type) ? [{
		by: "text",
		value: e.display
	}] : [];
	return {
		...e.viewName ? { viewName: e.viewName } : {},
		controlId: e.globalId ?? e.localId,
		fallbacks: t
	};
}
// ../shared/live-snippet.mjs
var hc = "tourd/live/TourPlayer";
function gc(e) {
	return JSON.stringify(e).split("<").join("\\u003c").split("\u2028").join("\\u2028").split("\u2029").join("\\u2029");
}
function _c(e) {
	return vc(e, hc, "TourPlayer.js");
}
function vc(e, t, n) {
	let r = e.indexOf("sap.ui.define(");
	if (r < 0) throw Error(`${n} does not start with sap.ui.define(...)`);
	return e.slice(0, r) + `sap.ui.predefine(${JSON.stringify(t)}, ` + e.slice(r + 14);
}
var yc = "if (!window.sap || !window.sap.ui || !sap.ui.require || !sap.ui.predefine) {\n		alert(\"This page does not look like a UI5 app (sap.ui is missing). Open your app first, then run the tour.\");\n		return;\n	}";
function bc({ playerSource: e, tour: t }) {
	return `/* TourD - preview this tour in the running app. Paste into the browser console (F12) of your app. */
(function () {
	"use strict";
	${yc}
	var TOUR = ${gc(t)};
${_c(e)}
	sap.ui.require([${JSON.stringify(hc)}], function (TourPlayer) {
		TourPlayer.start(TOUR, { debug: true });
	});
})();
`;
}
function xc({ origin: e, tourId: t, token: n = "" }) {
	return `/* TourD - loads the saved tour from ${e}. Paste into the browser console (F12) of your app. */
(function () {
	"use strict";
	${yc}
	var BASE = ${JSON.stringify(e)};
	function run() {
		sap.ui.require([${JSON.stringify(hc)}], function (TourPlayer) {
			fetch(BASE + "/live/" + ${JSON.stringify(t)} + "/tour.json"${n ? ` + ${JSON.stringify("?t=" + n)}` : ""})
				.then(function (r) { if (!r.ok) { throw new Error("HTTP " + r.status); } return r.json(); })
				.then(function (tour) { TourPlayer.start(tour, { debug: true }); })
				.catch(function (e) { alert("TourD: could not load the tour (" + e.message + ")"); });
		});
	}
	var s = document.createElement("script");
	s.src = BASE + "/live/player.js";
	s.onload = run;
	s.onerror = function () { alert("TourD: could not load the player from " + BASE + " (blocked by the page's security policy?)"); };
	document.head.appendChild(s);
})();
`;
}
function Sc(e) {
	return "javascript:" + encodeURIComponent(e);
}
// src/editor/describeIssue.ts
function Cc(e, t) {
	let n = /^steps\[(\d+)\](?:\.(.+))?$/.exec(e.path);
	if (!n) return {
		...e,
		message: e.path ? `${e.path}: ${e.message}` : e.message
	};
	let r = Number(n[1]), i = t.steps?.[r], a = `Step ${r + 1}${i?.title ? ` ("${i.title}")` : ""}`;
	return {
		...e,
		stepId: i?.id ?? e.stepId,
		message: `${a}${n[2] ? ` → ${n[2]}` : ""}: ${e.message}`
	};
}
// src/editor/routeHash.ts
function wc(e) {
	return e.replace(/\{\?[^}]*\}/g, "").replace(/:\?[^:]*:/g, "").replace(/:[^:]+:/g, "").replace(/\{[^}]+\}/g, "1").replace(/\/$/, "");
}
// src/markdown.ts
var Tc = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
function Ec(e) {
	let t = [], n = 0;
	for (let r of e.matchAll(Tc)) {
		let i = r.index ?? 0;
		i > n && t.push({
			type: "text",
			text: e.slice(n, i)
		}), r[1] === void 0 ? r[2] === void 0 ? r[3] === void 0 ? t.push({
			type: "link",
			text: r[4],
			href: r[5]
		}) : t.push({
			type: "code",
			text: r[3]
		}) : t.push({
			type: "em",
			text: r[2]
		}) : t.push({
			type: "strong",
			text: r[1]
		}), n = i + r[0].length;
	}
	return n < e.length && t.push({
		type: "text",
		text: e.slice(n)
	}), t;
}
var Dc = /^\s*[-*]\s+/;
function Oc(e) {
	return e.replace(/\r\n?/g, "\n").split(/\n{2,}/).filter((e) => e.trim()).map((e) => {
		let t = e.split("\n");
		return t.every((e) => Dc.test(e)) ? {
			type: "ul",
			items: t.map((e) => Ec(e.replace(Dc, "")))
		} : {
			type: "p",
			lines: t.map(Ec)
		};
	});
}
var kc = ["mocha", "jasmine"], Ac = [
	"none",
	"basic",
	"btp",
	"custom"
], jc = [
	"id",
	"ui5",
	"i18n",
	"text",
	"label",
	"binding"
], Mc = [
	"open",
	"press",
	"enterText",
	"search",
	"select",
	"assert"
], Nc = [
	"url",
	"value",
	"selectedKey",
	"visible",
	"text",
	"toast"
], Pc = q().max(500), Fc = q().min(1).max(200), Ic = Z({
	baseUrl: Pc.describe("Address of the running app (where UI5 is bootstrapped)"),
	framework: Q(kc),
	auth: Q(Ac),
	authSelectors: Z({
		username: Fc,
		password: Fc,
		submit: Fc
	}).optional().describe("Only for auth \"custom\": CSS selectors of the login form"),
	testDir: q().max(200).describe("Folder of the tests, relative to the project root"),
	root: q().max(200).describe("Folder that holds the tests and wdio.conf.js; empty = next to the app folder")
}), Lc = {
	baseUrl: "http://localhost:8080/index.html",
	framework: "mocha",
	auth: "none",
	testDir: "test/e2e",
	root: ""
}, Rc = ys(q(), ss()).describe("The inner object of a wdi5 selector: { id, viewName, controlType, properties, ... }"), zc = Z({
	name: q().min(1).max(80).describe("Name in the generated code, e.g. createBtn"),
	strategy: Q(jc),
	selector: Rc,
	alternatives: X(Z({
		strategy: Q(jc),
		selector: Rc
	})).default([]),
	controlType: q().nullable().default(null),
	viewName: q().nullable().default(null),
	display: q().max(200).nullable().default(null),
	note: q().max(300).optional()
}), Bc = Z({
	type: Q(Nc),
	expected: q().max(500).optional()
}), Vc = Z({
	id: q().min(1).max(40),
	kind: Q(Mc),
	title: q().min(1).max(200),
	enabled: Y().default(!0),
	locator: q().nullable().default(null).describe("Key into plan.locators"),
	value: q().max(500).optional().describe("Text to type"),
	choice: q().max(200).optional().describe("Item to choose in a select"),
	submit: Y().optional().describe("Press Enter after typing"),
	assertion: Bc.optional(),
	hash: q().max(300).optional().describe("For \"open\": the hash of the page to start on"),
	from: Z({
		index: ns().int().nullable().default(null),
		via: q().nullable().default(null),
		confidence: ns().nullable().default(null)
	}).optional().describe("Where in the recording the step comes from"),
	heuristic: Y().optional().describe("An assertion TourD added by itself"),
	noReuse: Y().optional().describe("Do not call a helper of the project for this step"),
	edited: Y().optional().describe("Changed by hand in the step table"),
	note: q().max(300).optional()
});
Z({
	version: Ss(1),
	name: q().min(1).max(200),
	app: Z({
		id: q().nullable().default(null),
		url: q().nullable().default(null)
	}),
	settings: Ic,
	locators: ys(q(), zc),
	steps: X(Vc).max(500)
});
export { Lc as DEFAULT_SETTINGS, bc as buildInlineSnippet, xc as buildLoaderSnippet, Cc as describeIssue, wc as hashFor, fc as lintTour, oc as matchRoute, ac as normalizeHash, Oc as parseMarkdown, e as playerSource, mc as targetFor, Sc as toBookmarklet, nc as validateTour };
