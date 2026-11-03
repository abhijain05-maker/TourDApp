# QuickTest - test management for SAPUI5 / CAP apps (tracker)

Fourth app next to the React designer, the player and the SAPUI5 designer. Real SAPUI5, no build step, served by CAP at
`/quicktest/index.html`. Own OData service `/odata/v4/qtest` (`srv/qtest-service.*`, libs in `srv/lib/qtest/`), own tables
(`db/qtest.cds`, namespace `qtest`). It SHARES with the other apps: `tourd.Projects` (the app under test + its uploaded
sources), `tourd.Recordings` (made by the unchanged browser extension), `tourd.TestPlans` (the wdi5 plan behind an
automated test case). Rule: tick `[x]` only after the task is verified; deviations go in the change log at the end.
Docs: `docs/QUICKTEST.md`.

User rules that apply: everything new in SAPUI5; do not change the extension or the React designer; data-driven
(enums, columns, prompts are data), so a new kind/priority/format is one entry.

## Phase 0 - Foundations
- [x] `db/qtest.cds`: Requirements, TestCases, CaseVersions, Coverage, Runs, RunItems (compiles, deploys, migrates)
- [x] `srv/qtest-service.cds` + `.js` (authz, guarded, project cascade on delete via `srv/lib/qtest/service/cleanup.js`)
- [x] `srv/lib/qtest/meta.js` (the UI draws from `qtestMeta()`)

## Phase 1 - Requirements, test cases, traceability
- [x] validate / clean, codes REQ-001 / TC-001 (never reused)
- [x] save / delete / duplicate / bulk; steps as JSON; version history + restore
- [x] coverage links both directions (case page, requirement page, matrix click); derived verification status

## Phase 2 - Upload and download
- [x] xlsx writer + reader, csv, json (round trips tested)
- [x] header aliases of other tools, flat (one row per step) and three-sheet layout, preview before apply
- [x] downloads: test book (xlsx / json / csv), template, wdi5 zip

## Phase 3 - Runs, results, dashboard
- [x] runs from a selection / filter, step results, defect, close / reopen
- [x] import automated results (JUnit, mocha json, mochawesome, wdio json) matched by test case code
- [x] dashboard numbers + run reports (html, xlsx, JUnit)

## Phase 4 - Automation (wdi5)
- [x] test case from a recording (manual steps + plan, step-to-step map)
- [x] attach a recording to a manual case (steps aligned by text)
- [x] steps -> plan without a recording (rules; the AI picks controls by number from the inventory)
- [x] wdi5 zip download; add to project files (the existing apply)

## Phase 5 - AI
- [x] requirements from text; improve requirement
- [x] test cases from requirements (kinds, count, instruction); improve case; review before saving
- [x] every AI action has a rules / manual path (improve needs an AI, said so)
- [ ] run once with a real provider (Gemini / SAP AI Core): only fake models were used so far

## Phase 6 - SAPUI5 app (`app/quicktest/`)
- [x] shell (side nav, theme, Ctrl+K, AI provider choice, recorder pairing), projects, project page with tabs
- [x] dashboard, requirements, test cases, requirement page, case page (steps editor, automation, history), matrix
- [x] runs list, run execution page (keys), import / export dialogs, automation tab, setup tab (upload the app)

## Phase 7 - Tests and docs
- [x] unit: `qtest-bundle`, `qtest-steps`, `qtest-ai`, `service-qtest`; full suite 843 passed (76 files, `--maxWorkers=4`)
- [x] e2e `test/e2e/quicktest.spec.js`: 7 passed against a throwaway server
- [x] `docs/QUICKTEST.md`, README entry

## Phase 8 - Real browser check
- [x] every page, the dialogs, light / dark / narrow checked in headless Chromium with screenshots
- [ ] by the user in their own Chrome with their own Fiori elements app and the real recorder

## Change log
- 2026-11-03: built phases 0-7 and the Chromium check in one session.
  - Deviation: projects are created / deleted through the QuickDev service (`/odata/v4/tour`), not the QuickTest service: a project is the same thing in all apps.
  - Deviation: the Setup tab reads folders / zips with the intake rules in `/designer-ui5/lib/codemirror.js` (loaded on upload only) instead of a copy.
  - Found by the browser test and fixed: matrix clicks (HTML replaced by `core:HTML`), nested bound template warning, empty SegmentedButton selecting its first item, a default run selection that picked "ready" cases and so failed on a project with only drafts.
  - Found and fixed in the libraries: a second "holds" check repeating the typed value in a generated plan; trailing period in a rules-drafted acceptance criterion.
