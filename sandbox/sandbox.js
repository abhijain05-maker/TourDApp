/*!
 * TourD sandbox runtime (module "tourd/sandbox"): starts the generated copy of the app, plays tours with
 * the real TourPlayer and talks to the designer (the parent window) through postMessage.
 *
 * Designer -> sandbox   { tourd: "designer", type, ... }
 *   loadTour {tour, index}   play (or restart) a tour, beginning at step `index`
 *   goToStep {index}         show another step of the running tour
 *   navigate {hash}          open another page of the app (router hash, e.g. "order/1")
 *   pick {on}                switch click-to-pick on/off
 *   stop                     end the tour
 * Sandbox -> designer   { tourd: "sandbox", type, ... }
 *   ready {version, routes}  tourStarted  stepChanged {index, id, via}  tourEnded {kind}
 *   pickResult {...}  pickCancelled  error {message}
 */
sap.ui.define(
	[
		"sap/ui/core/Component",
		"sap/ui/core/ComponentContainer",
		"sap/ui/core/Element",
		"tourd/TourPlayer"
	],
	function (Component, ComponentContainer, Element, TourPlayer) {
		"use strict";

		var cfg = window.__TOURD__;
		var component = null;
		var session = null;
		var restarting = false;
		var picking = false;
		var box = null;

		// ------------------------------------------------------------ messaging

		function send(type, payload) {
			var msg = Object.assign({}, payload, { tourd: "sandbox", type: type });
			window.parent.postMessage(msg, cfg.parentOrigin);
		}

		function status(text) {
			var el = document.getElementById("tourd-status");
			if (!el) {
				return;
			}
			el.textContent = text || "";
			el.style.display = text ? "block" : "none";
		}

		function fail(message) {
			send("error", { message: String(message) });
		}

		window.addEventListener("error", function (e) {
			fail(e.message || "Script error");
		});
		window.addEventListener("unhandledrejection", function (e) {
			fail((e.reason && e.reason.message) || e.reason || "Unhandled promise rejection");
		});

		// ------------------------------------------------------------ tour

		function onPlayerEvent(type, payload) {
			if (type === "stepChanged") {
				send("stepChanged", {
					index: payload.index,
					id: payload.step.id,
					via: payload.via
				});
			} else if (type === "started") {
				send("tourStarted", {});
			} else if (type === "error") {
				fail("Step " + ((payload && payload.index) + 1) + ": " + (payload && payload.message));
			} else if (type === "completed" || type === "skipped" || type === "stopped") {
				if (!restarting) {
					send("tourEnded", { kind: type });
				}
			}
		}

		function loadTour(tour, index) {
			restarting = true;
			return TourPlayer.start(tour, {
				component: component,
				debug: true,
				startIndex: index,
				onEvent: onPlayerEvent
			}).then(
				function (s) {
					session = s;
					restarting = false;
				},
				function (e) {
					restarting = false;
					fail(e && e.message ? e.message : e);
				}
			);
		}

		// ------------------------------------------------------------ click to pick

		function viewOf(control) {
			for (var p = control.getParent(); p; p = p.getParent()) {
				if (p.isA && p.isA("sap.ui.core.mvc.View")) {
					return p;
				}
			}
			return null;
		}

		function isStable(localId) {
			return !!localId && localId.indexOf("__") !== 0 && localId.indexOf("-__") < 0;
		}

		function textOf(control) {
			var t = "";
			["getText", "getTitle", "getLabel", "getValue", "getPlaceholder"].some(function (m) {
				if (typeof control[m] === "function") {
					var v = control[m]();
					if (typeof v === "string" && v.trim()) {
						t = v.trim();
						return true;
					}
				}
				return false;
			});
			return t.length > 60 ? "" : t;
		}

		function controlAt(x, y) {
			var dom = document.elementFromPoint(x, y);
			var root = dom && dom.closest ? dom.closest("[data-sap-ui]") : null;
			return root
				? Element.getElementById
					? Element.getElementById(root.id)
					: Element.registry.get(root.id)
				: null;
		}

		/** The clicked control, or - when it has no usable id - the nearest parent that has one. */
		function describe(control) {
			var clicked = control.getMetadata().getName();
			var hops = 0;
			for (var c = control; c; c = c.getParent(), hops++) {
				var view = c.isA("sap.ui.core.mvc.View") ? null : viewOf(c);
				if (!view) {
					continue;
				}
				var prefix = view.getId() + "--";
				if (c.getId().indexOf(prefix) === 0) {
					var local = c.getId().slice(prefix.length);
					if (isStable(local)) {
						return {
							viewName: view.getViewName(),
							controlId: local,
							controlType: c.getMetadata().getName(),
							text: textOf(c),
							clicked: clicked,
							viaParent: hops > 0
						};
					}
				}
			}
			return {
				viewName: null,
				controlId: null,
				controlType: clicked,
				text: textOf(control),
				clicked: clicked,
				viaParent: false
			};
		}

		function ensureBox() {
			if (!box) {
				box = document.createElement("div");
				box.style.cssText =
					"position:fixed;z-index:2147483000;pointer-events:none;border:2px solid #0a6ed1;background:rgba(10,110,209,.12);border-radius:3px;display:none;";
				box.innerHTML =
					'<span style="position:absolute;left:-2px;bottom:100%;margin-bottom:2px;background:#0a6ed1;color:#fff;font:12px sans-serif;padding:2px 6px;border-radius:3px;white-space:nowrap"></span>';
				document.body.appendChild(box);
			}
			return box;
		}

		function onMove(e) {
			var control = controlAt(e.clientX, e.clientY);
			var b = ensureBox();
			var dom = control && control.getDomRef && control.getDomRef();
			if (!dom) {
				b.style.display = "none";
				return;
			}
			var info = describe(control);
			var r = dom.getBoundingClientRect();
			b.style.cssText +=
				";display:block;left:" +
				r.left +
				"px;top:" +
				r.top +
				"px;width:" +
				r.width +
				"px;height:" +
				r.height +
				"px";
			b.firstChild.textContent =
				(info.controlId || "no stable id") + " · " + info.controlType.split(".").pop();
		}

		function swallow(e) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
		}

		function onClick(e) {
			swallow(e);
			var control = controlAt(e.clientX, e.clientY);
			if (!control) {
				return;
			}
			var result = describe(control);
			setPicking(false);
			send("pickResult", result);
		}

		function onKey(e) {
			if (e.key === "Escape") {
				swallow(e);
				setPicking(false);
				send("pickCancelled", {});
			}
		}

		function setPicking(on) {
			if (on === picking) {
				return;
			}
			picking = on;
			var opts = true;
			var action = on ? "addEventListener" : "removeEventListener";
			document[action]("mousemove", onMove, opts);
			document[action]("click", onClick, opts);
			document[action]("keydown", onKey, opts);
			["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart"].forEach(function (n) {
				document[action](n, swallow, opts);
			});
			document.documentElement.classList.toggle("tourd-picking", on);
			if (!on && box) {
				box.style.display = "none";
			}
		}

		// ------------------------------------------------------------ commands from the designer

		window.addEventListener("message", function (e) {
			var m = e.data;
			if (e.source !== window.parent || !m || m.tourd !== "designer") {
				return;
			}
			try {
				if (m.type === "loadTour") {
					loadTour(m.tour, m.index);
				} else if (m.type === "goToStep") {
					if (session) {
						session.goTo(m.index);
					}
				} else if (m.type === "navigate") {
					if (component && component.getRouter()) {
						component
							.getRouter()
							.getHashChanger()
							.setHash(String(m.hash || ""));
					}
				} else if (m.type === "pick") {
					setPicking(!!m.on);
				} else if (m.type === "stop") {
					TourPlayer.stop();
				}
			} catch (err) {
				fail(err.message);
			}
		});

		// ------------------------------------------------------------ start the app

		status("Starting the app…");
		Component.create({ name: cfg.appId, id: "tourdSandbox", manifest: true }).then(
			function (c) {
				component = c;
				new ComponentContainer({ component: c, height: "100%" }).placeAt("content");
				status("");
				send("ready", { version: sap.ui.version });
			},
			function (e) {
				var message = "The app could not be started: " + ((e && e.message) || e);
				status(message);
				fail(message);
			}
		);
	}
);
