# Readiness (`docs/READINESS.md`)

A second feature next to the guided experience, in the SAPUI5 designer only (`app/designer-ui5/`). The React designer, the
player and the browser extension are untouched. The server changes are additions: two tables, seven handlers, new files.

Rule as in PLAN.md: tick `[x]` only after the task is verified.

- [x] 0 Design: two features share one project and one upload (the Workspace); the scan is pure code that never talks to a system; people answer, a scan never overwrites an answer; areas, answers and checks are data, so the designer needs no change for a new one
- [x] 1 Scan engine `srv/lib/readiness/`: context with merging, 8 extractors (BTP services, destinations, services and APIs, authorization, Work Zone, process automation, configuration, cross checks), knowledge tables; `test/unit/readiness-scan.test.js` (25)
- [x] 2 Data and service: `ReadinessItems`, `ReadinessScans`; actions `scanReadiness`, `checkReadiness`, `addReadinessItem`, `removeReadinessItem`; functions `readinessMeta`, `readinessSummary`, `readinessScanReport`; reconcile keeps answers, hides what is gone; `test/unit/service-readiness.test.js` (13)
- [x] 3 Designer: feature switch and readiness tiles on the project page, Overview tab (ring, areas, what changed), Checklist tab (areas, search, filters, quick answers, detail with steps, notes, links, source link into the Workspace, add / remove), `ProgressRing` control, store `util/Readiness.js`, light / dark, narrow window
- [x] 4 Browser tests `test/e2e/readiness-ui5.spec.js` (4) against a throwaway server; `designer-ui5.spec.js` (7) still green
- [x] 5 Docs: `docs/READINESS.md`
- [ ] 6 Live checks (reserved: `ReadinessItems.probe`): probe a destination and an OData `$metadata`, role collections of a user, compare two environments, AI explanation of a finding. Not started; needs a decision on credentials and where probes run (Cloud Connector)
- [ ] 7 Deployment: the new tables migrate on SQLite (`npm run dev`) and HANA (HDI); not tried on Cloud Foundry
- [ ] 8 Real projects: scan the user's own CAP projects, tune what is missing or noisy (the sample project is made up)

## Change log

- 2026-11-02 Phases 0-5 built and driven in Chrome (Playwright against a throwaway server). The browser tests found two bugs that are fixed: the "no scan yet" answer (204 without a body) broke the first load of a new project, and a row kept an older copy of a check after an answer was saved (fields shown empty after a scan). Unit suite 793 passed (72 files); designer-ui5 spec 7 passed; React designer specs run against the same server pass (two of them need a server without AI keys: a throwaway server that reads `.env` makes them fail, as before).
