# Readiness: what the project depends on

A CAP project is easy to start and hard to move: the app needs destinations, S/4HANA services (OData V2 or V4), roles, Work Zone content, process automation and BTP service instances, and none of that is written down in one place. Readiness lists it from the files of the project, and people check each item in their system.

It is the second feature of a project (the first is the guided experience: recordings, tours, tests, help). Both share the project and its files: upload the project once in the **Workspace** tab, then switch between **Guided experience** and **Readiness** with the switch under the project banner. It is part of the SAPUI5 designer (`/designer-ui5/`). The React designer does not show it.

## What it does

1. **Scan.** Reads the working copies of the project's files (not the uploaded base) and lists what it finds. It does not connect to any system and sends nothing anywhere.
2. **Checklist.** Every thing is a check with the places it was found, facts, findings from the scan, and steps to verify it. A person answers *Working*, *Not working*, *Not needed* (or leaves *Not checked*), and can write a note, an owner and values (for example which system a destination must point to).
3. **Scan again** after the files change. The list updates, answers stay. A check the scan no longer finds is kept, marked *No longer found*, until someone removes it. The page says when the files changed since the last scan.

## What the scan reads

| Area | From |
| --- | --- |
| Destinations | `mta.yaml` (destination service `init_data`, approuter `destinations`), `xs-app.json` routes, `cds.requires.*.credentials.destination`, code (`destinationName`, `getDestination`) |
| Services & APIs | `cds.requires` in `package.json` / `.cdsrc.json` (all profiles), the imported metadata (`.edmx`), `cds.connect.to(...)` and direct `/sap/opu/odata...` calls in code, the OData data sources of `manifest.json` |
| Authorization | `xs-security.json` (scopes, role templates, role collections, foreign scopes, OAuth), `@requires` / `@restrict` in `.cds`, `user.is(...)`, route scopes in `xs-app.json`, the login strategy per profile |
| Work Zone | `manifest.json` (inbound / outbound navigation intents, `sap.cloud.service`) and one check for the site, content provider and roles |
| Process automation | process definition ids and workflow API calls in code, process automation / workflow services in `mta.yaml` |
| BTP services | resources of `mta.yaml` and the extension descriptors (`.mtaext`) |
| Configuration | `process.env.*` in server code (and whether `mta.yaml` sets it), the database kind per profile |

Files that may hold secrets (`.env`, `default-env.json`, keys) are never read into QuickDev (see `shared/workspace-rules.mjs`).

## What the scan already finds without a system

- a role used in `.cds` that `xs-security.json` does not define
- OData V2 / V4 disagreeing with the imported metadata
- a service the code connects to that `cds.requires` does not know
- a fixed URL instead of a destination; `localhost`; a password in `mta.yaml`
- a UI data source with no route in `xs-app.json`
- an app with navigation intents but no `sap.cloud.service`; two apps with the same intent
- an `existing-service` the deployment does not create; an XSUAA file without an XSUAA instance
- `sqlite` or a mocked login in the production profile

## How the code is organised

```
srv/lib/readiness/                 the scan: pure functions, no database
  index.js                         EXTRACTORS list, scan(files), meta()
  categories.js                    areas, answers, levels (the designer draws itself from this)
  context.js                       what an extractor gets: ctx.add / ctx.signal / ctx.relate, merging of the same thing
  extractors/*.js                  one file per area, plus checks.js (cross checks, run last)
  knowledge/*.js                   what is known about S/4HANA service names and BTP services
srv/lib/service/readiness.js       database glue: reconcile a scan with the answers, summary, actions
db/schema.cds                      ReadinessItems (scan facts + answers), ReadinessScans (history)
app/designer-ui5/util/Readiness.js the store the tabs share (component model "readiness")
app/designer-ui5/view/tab/Readiness.view.xml  Overview;  Checklist.view.xml  Checklist
```

The scan writes facts into `ReadinessItems.data` (JSON), people write `status`, `note`, `owner`, `inputs`. A scan never touches the second group. Items have a stable key, `category:kind:name`.

## Adding a check

1. Write `srv/lib/readiness/extractors/<name>.js`:
   ```js
   export default {
     id: 'my-check',
     phase: 'extract',          // 'check' runs after all extractors and sees everything they found
     run(ctx) {
       for (const f of ctx.find(/\.mydescriptor$/)) {
         const doc = ctx.json(f)   // parsed once; a file that cannot be read is reported, not thrown
         ctx.add({ category: 'config', kind: 'my-thing', name: doc.name, source: { path: f.path },
                   verify: ['Open the cockpit and ...'],
                   signals: [{ level: 'warning', code: 'my-code', message: '...' }] })
       }
     },
   }
   ```
2. Add it to `EXTRACTORS` in `srv/lib/readiness/index.js`.
3. Add a test in `test/unit/readiness-scan.test.js` (the sample project is `test/helpers/readiness-project.js`).

The designer shows the new items, facts, findings, steps and links without a change. A new **area** is one entry in `categories.js` (id, label, icon). A new kind of **input** a person fills in is a `fields` entry on the item. Two extractors that name the same category / kind / name are merged into one item.

## Later: live checks

`ReadinessItems.probe` (JSON `{level, message, at}`) is reserved for the result of a live check, for example calling `$metadata` through a destination. The checklist already shows it next to the findings of the scan, and a live check never overwrites a person's answer. No live check exists yet. Ideas that fit: probing destinations and OData services, reading the role collections of a user, comparing two environments (a scan of a working one against the new one), and an AI helper that explains a finding. They would add to the list, not replace it.

## Limits

- It reads files, not systems. "The service is active" is a person's answer until a live check exists.
- Values that are built at run time (a URL put together in code) cannot be found.
- Which communication scenario holds an S/4HANA API is known for a few standard APIs only (`knowledge/s4.js`); the others get the general steps.
- Destinations that live in BTP only are listed from where the project uses them; where they point to is something a person writes down.
