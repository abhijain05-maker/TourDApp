/* TourD replay - runs the steps of a wdi5 test plan in the page that is open, so the plan can be tried before the
 * generated tests are run on a machine. It uses UI5's own record/replay API (sap/ui/test/RecordReplay), the one wdi5
 * itself is built on, so a selector means here what it means in the generated test. Plain script, no dependencies; it
 * leaves window.__tourdReplay with run(plan, options) and stop(). */
;(function () {
  'use strict'
  var root = window
  if (root.__tourdReplay && root.__tourdReplay.stop) root.__tourdReplay.stop()

  var VERSION = '0.1.0'
  var state = { running: false, cancelled: false, box: null }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms)
    })
  }

  function load(module) {
    return new Promise(function (resolve, reject) {
      root.sap.ui.require([module], resolve, reject)
    })
  }

  function controlOf(dom) {
    var node = dom && dom.closest ? dom.closest('[data-sap-ui]') : null
    var id = node && node.getAttribute('data-sap-ui')
    if (!id) return null
    var Element = root.sap.ui.require('sap/ui/core/Element')
    if (Element && Element.getElementById) return Element.getElementById(id)
    return root.sap.ui.getCore().byId(id)
  }

  function mark(dom) {
    if (!state.box) {
      state.box = root.document.createElement('div')
      state.box.setAttribute('data-tourd-ui', '')
      state.box.style.cssText =
        'position:fixed;z-index:2147483000;pointer-events:none;border:2px solid #e9730c;background:rgba(233,115,12,.14);border-radius:3px;transition:all .15s;'
      root.document.body.appendChild(state.box)
    }
    if (!dom) {
      state.box.style.display = 'none'
      return
    }
    if (dom.scrollIntoView) dom.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    var r = dom.getBoundingClientRect()
    state.box.style.display = 'block'
    state.box.style.left = r.left + 'px'
    state.box.style.top = r.top + 'px'
    state.box.style.width = r.width + 'px'
    state.box.style.height = r.height + 'px'
  }

  function unmark() {
    if (state.box && state.box.parentNode) state.box.parentNode.removeChild(state.box)
    state.box = null
  }

  function pressEnter(dom) {
    var input =
      (dom.matches && dom.matches('input,textarea') ? dom : dom.querySelector('input,textarea')) ||
      dom
    ;['keydown', 'keypress', 'keyup'].forEach(function (type) {
      input.dispatchEvent(
        new root.KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
  }

  /** Retries a check for a few seconds, like wdio's expect does. */
  function eventually(check, ms) {
    var deadline = Date.now() + (ms || 5000)
    function attempt() {
      return Promise.resolve(check()).then(function (ok) {
        if (ok || Date.now() > deadline) return ok
        return sleep(150).then(attempt)
      })
    }
    return attempt()
  }

  function describeSelector(selector) {
    if (selector.id)
      return (
        'the control "' + selector.id + '"' + (selector.viewName ? ' in ' + selector.viewName : '')
      )
    return 'the control ' + JSON.stringify(selector)
  }

  /** Runs one enabled step; resolves with a message for a pass, throws for a failure. */
  function runStep(RR, plan, step, ctx) {
    if (step.kind !== 'assert') ctx.since = Date.now() // (the toasts of an action are those shown after it began)
    var locator = step.locator ? plan.locators[step.locator] : null
    var selector = locator && locator.selector
    var idle = function () {
      return RR.waitForUI5({ timeout: 15000 }).catch(function () {
        return RR.waitForUI5()
      })
    }
    // A control that is drawn a moment after the page is stable (a list that fills when data arrives) is looked for
    // again for a few seconds, like a person would wait for it; the last answer is the error if it never comes.
    var find = function () {
      var lastError = null
      return eventually(function () {
        return RR.findDOMElementByControlSelector({ selector: selector }).then(
          function (dom) {
            return dom || false
          },
          function (e) {
            lastError = e
            return false
          },
        )
      }, 8000).then(function (dom) {
        if (dom) return dom
        throw lastError || new Error('Not found: ' + describeSelector(selector))
      })
    }
    var act = function (dom, options) {
      mark(dom)
      return sleep(ctx.pause)
        .then(function () {
          // A press goes to the control that was just found. interactWithControl looks the selector up again, and for
          // rows of a list that differ only in what they show it can land on another row (it ticked the first item
          // again instead of the second): the element found here is the one the selector means.
          var control = options.interactionType === RR.InteractionType.Press ? controlOf(dom) : null
          if (!control)
            return RR.interactWithControl(Object.assign({ selector: selector }, options))
          return load('sap/ui/test/actions/Press').then(function (Press) {
            new Press().executeOn(control)
          })
        })
        .then(idle)
    }

    if (step.kind === 'open') {
      if (step.hash)
        root.location.hash =
          step.hash.charAt(0) === '#' ? step.hash : '#/' + step.hash.replace(/^\//, '')
      return idle().then(function () {
        return 'the app is open'
      })
    }
    if (step.kind === 'press')
      return idle()
        .then(find)
        .then(function (dom) {
          return act(dom, { interactionType: RR.InteractionType.Press })
        })
        .then(function () {
          return 'pressed'
        })
    if (step.kind === 'enterText' || step.kind === 'search')
      return idle()
        .then(find)
        .then(function (dom) {
          return act(dom, {
            interactionType: RR.InteractionType.EnterText,
            enterText: step.value || '',
          }).then(function () {
            if (step.submit || step.kind === 'search') pressEnter(dom)
            return idle()
          })
        })
        .then(function () {
          return 'typed "' + (step.value || '') + '"'
        })
    if (step.kind === 'select')
      return idle()
        .then(find)
        .then(function (dom) {
          mark(dom)
          var control = controlOf(dom)
          if (!control || !control.open)
            throw new Error('This control cannot be opened: ' + describeSelector(selector))
          control.open()
          return sleep(ctx.pause)
            .then(idle)
            .then(function () {
              var item = {
                controlType: 'sap.ui.core.Item',
                properties: { text: step.choice },
                ancestor: selector,
              }
              return RR.findDOMElementByControlSelector({ selector: item }).then(
                function (itemDom) {
                  if (!itemDom) throw new Error('The select has no item "' + step.choice + '"')
                  mark(itemDom)
                  return RR.interactWithControl({
                    selector: item,
                    interactionType: RR.InteractionType.Press,
                  })
                },
              )
            })
            .then(idle)
        })
        .then(function () {
          return 'chose "' + step.choice + '"'
        })
    if (step.kind === 'assert') return assertStep(RR, plan, step, selector, idle, ctx)
    return Promise.resolve('nothing to do')
  }

  function assertStep(RR, plan, step, selector, idle, ctx) {
    var a = step.assertion || {}
    if (a.type === 'toast')
      // A toast is gone after about three seconds, and the press that shows it ends by waiting for UI5 to be idle, which
      // can outlast it. So the toasts are written down while the replay runs (see hookToasts) and this reads that list;
      // the page is looked at too, for a toast that is there right now.
      return eventually(function () {
        var want = String(a.expected || '')
        var seen = ctx.toasts.filter(function (t) {
          return t.at >= ctx.since
        })
        var el = root.document.querySelector('.sapMMessageToast')
        var now = el ? el.textContent.replace(/\s+/g, ' ').trim() : null
        ctx.last = seen.length ? seen[seen.length - 1].text : now
        return (
          now === want ||
          seen.some(function (t) {
            return t.text === want
          })
        )
      }, 8000).then(function (ok) {
        if (!ok)
          throw new Error(
            ctx.last == null
              ? 'No message toast was shown (expected "' + a.expected + '")'
              : 'The message is "' + ctx.last + '", it should be "' + a.expected + '"',
          )
        return 'the message was shown'
      })
    if (a.type === 'url')
      return idle().then(function () {
        return eventually(function () {
          var href = root.location.href
          return a.expected
            ? href.indexOf('#/' + String(a.expected).replace(/^#?\/?/, '')) >= 0
            : /^[^#]*#?\/?$/.test(href)
        }).then(function (ok) {
          if (!ok)
            throw new Error(
              'The address is ' +
                root.location.href +
                (a.expected ? ', it should contain #/' + a.expected : ', it should have no page'),
            )
          return 'the address is right'
        })
      })
    var getter = {
      value: 'getValue',
      selectedKey: 'getSelectedKey',
      visible: 'getVisible',
      text: 'getText',
    }[a.type]
    return idle().then(function () {
      return RR.findDOMElementByControlSelector({ selector: selector }).then(function (dom) {
        if (!dom) throw new Error('Not found: ' + describeSelector(selector))
        mark(dom)
        var control = controlOf(dom)
        return eventually(function () {
          var got = control && control[getter] ? control[getter]() : undefined
          return a.type === 'visible' ? got === true : got === a.expected
        }).then(function (ok) {
          var got = control && control[getter] ? control[getter]() : undefined
          if (!ok)
            throw new Error(
              a.type === 'visible'
                ? 'The control is not visible'
                : 'It is "' + got + '", it should be "' + a.expected + '"',
            )
          return 'checked'
        })
      })
    })
  }

  /** Writes down the message toasts the page shows while the replay runs (text and time). */
  function hookToasts(ctx) {
    return load('sap/m/MessageToast').then(
      function (MT) {
        var original = MT.show
        var hooked = function (message) {
          var text = String(message).replace(/\s+/g, ' ').trim()
          ctx.toasts.push({ text: text, at: Date.now() })
          return original.apply(this, arguments)
        }
        MT.show = hooked
        ctx.unhook = function () {
          if (MT.show === hooked) MT.show = original
        }
      },
      function () {
        /* no MessageToast in this app: the page is still looked at */
      },
    )
  }

  /**
   * @param {object} plan a test plan (shared/wdi5-plan.mjs)
   * @param {{pause?: number}} [options] pause: milliseconds to show each control before acting on it
   * @returns {Promise<{results: object[], passed: number, failed: number, skipped: number}>}
   */
  function run(plan, options) {
    if (!root.sap || !root.sap.ui) return Promise.reject(new Error('This page does not use UI5.'))
    if (state.running) return Promise.reject(new Error('A replay is running already.'))
    state.running = true
    state.cancelled = false
    var ctx = {
      pause: (options && options.pause) != null ? options.pause : 350,
      toasts: [],
      since: 0,
      unhook: null,
    }
    var results = []
    return load('sap/ui/test/RecordReplay')
      .then(function (RR) {
        return hookToasts(ctx).then(function () {
          return RR
        })
      })
      .then(function (RR) {
        var chain = Promise.resolve()
        var failed = false
        plan.steps.forEach(function (step) {
          chain = chain.then(function () {
            var item = { id: step.id, title: step.title, kind: step.kind }
            results.push(item)
            if (!step.enabled) {
              item.status = 'skipped'
              item.message = 'switched off'
              return
            }
            if (failed || state.cancelled) {
              item.status = 'not-run'
              item.message = state.cancelled ? 'stopped' : 'an earlier step failed'
              return
            }
            return runStep(RR, plan, step, ctx).then(
              function (message) {
                item.status = 'passed'
                item.message = message
              },
              function (e) {
                failed = true
                item.status = 'failed'
                item.message = String((e && e.message) || e)
              },
            )
          })
        })
        return chain
      })
      .then(
        function () {
          return summary(results)
        },
        function (e) {
          throw e
        },
      )
      .finally(function () {
        state.running = false
        if (ctx.unhook) ctx.unhook()
        unmark()
      })
  }

  function summary(results) {
    var count = function (s) {
      return results.filter(function (r) {
        return r.status === s
      }).length
    }
    return {
      results: results,
      passed: count('passed'),
      failed: count('failed'),
      skipped: count('skipped') + count('not-run'),
    }
  }

  root.__tourdReplay = {
    version: VERSION,
    run: run,
    stop: function () {
      state.cancelled = true
      unmark()
    },
    isRunning: function () {
      return state.running
    },
  }
})()
