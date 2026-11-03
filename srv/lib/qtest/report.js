// The result of a run as one HTML page with its own styles: attach it to a mail, print it, keep it as evidence.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const COLOR = { passed: '#107e3e', failed: '#bb0000', blocked: '#e9730c', skipped: '#0a6ed1', notrun: '#6a6d70' }
const nl = (s) => esc(s).replace(/\n/g, '<br>')

export function runReportHtml({ run, projectName, items, counts, label }) {
  const done = items.length - (counts.notrun ?? 0)
  const rate = done ? Math.round(((counts.passed ?? 0) / done) * 100) : 0
  const chips = Object.keys(label)
    .map((k) => `<span class="chip" style="--c:${COLOR[k]}"><b>${counts[k] ?? 0}</b> ${esc(label[k])}</span>`)
    .join('')
  const rows = items
    .map((i) => {
      const steps = (i.snapshot?.steps ?? [])
        .map((s, n) => {
          const r = i.steps.find((x) => x.id === s.id)
          return `<tr><td>${n + 1}</td><td>${nl(s.action)}${s.data ? `<div class="muted">Data: ${nl(s.data)}</div>` : ''}</td><td>${nl(s.expected)}</td><td style="color:${COLOR[r?.status ?? 'notrun']}">${esc(label[r?.status ?? 'notrun'])}</td><td>${nl(r?.actual)}</td></tr>`
        })
        .join('')
      return `<section><h3><span class="dot" style="background:${COLOR[i.status]}"></span>${esc(i.caseCode)} ${esc(i.caseTitle)} <small>${esc(label[i.status])}</small></h3>${i.defect ? `<p class="muted">Defect: ${esc(i.defect)}</p>` : ''}${i.actual ? `<p>${nl(i.actual)}</p>` : ''}${steps ? `<table><tr><th>#</th><th>Action</th><th>Expected</th><th>Result</th><th>Actual</th></tr>${steps}</table>` : ''}</section>`
    })
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(run.name)} - test report</title><style>
body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;margin:2rem auto;max-width:960px;padding:0 1rem;color:#1d2d3e}h1{margin:0 0 .25rem}h3{margin:1.5rem 0 .5rem}small{color:#6a6d70;font-weight:400;margin-left:.5rem}
.muted{color:#6a6d70}.chips{display:flex;gap:.5rem;flex-wrap:wrap;margin:1rem 0}.chip{border:1px solid var(--c);color:var(--c);border-radius:999px;padding:.15rem .75rem}
.dot{display:inline-block;width:.7rem;height:.7rem;border-radius:50%;margin-right:.5rem}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #d9d9d9;padding:.35rem .5rem;text-align:left;vertical-align:top}th{background:#f5f6f7}
.rate{font-size:2rem;font-weight:700;color:${rate >= 90 ? '#107e3e' : rate >= 70 ? '#e9730c' : '#bb0000'}}@media print{section{break-inside:avoid}}</style></head><body>
<h1>${esc(run.name)}</h1><div class="muted">${esc(projectName)}${run.build ? ` · build ${esc(run.build)}` : ''}${run.environment ? ` · ${esc(run.environment)}` : ''} · ${esc(run.status)}</div>
<p><span class="rate">${rate}%</span> passed of ${done} executed (${items.length} planned)</p><div class="chips">${chips}</div>${rows}
<p class="muted">Created with QuickTest · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</p></body></html>`
}
