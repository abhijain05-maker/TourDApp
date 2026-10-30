/* Runs in the extension's own (isolated) world of every frame of a tab that is being recorded. The recorder
 * itself lives in the page's world and can only talk through window.postMessage; this hands those messages to the
 * extension. It does nothing else. */
;(function () {
  'use strict'
  if (window.__tourdBridge) return
  window.__tourdBridge = true
  window.addEventListener('message', function (e) {
    if (e.source !== window) return
    var d = e.data
    if (!d || d.tourd !== 'recorder') return
    try {
      chrome.runtime.sendMessage({ cmd: 'frame-event', data: d })
    } catch (err) {
      /* the extension was reloaded or removed: nothing to tell */
    }
  })
})()
