# QuickDev: run it locally, use SAP AI Core, deploy to BTP (HANA)

One file to keep next to you. Part A runs the app on a laptop with SQLite. Part B connects SAP AI Core (SAP AI Launchpad,
Orchestration service). Part C deploys to SAP BTP Cloud Foundry with SAP HANA Cloud and a login (XSUAA).
Commands are for a terminal in the project folder; on Windows use PowerShell or Git Bash.

> The product is shown as **QuickDev**. Folder, package and variable names still say `tourd` (for example `TOURD_ALLOWED_HOSTS`).
> That is on purpose: they are names of code, not of the product.

## What runs where

| | Local (your laptop) | Production (BTP) |
| --- | --- | --- |
| Server | `cds watch` / `cds-serve` on port **4044** | Node.js app `quickdev-srv` on Cloud Foundry |
| Database | **SQLite** file `db.sqlite` | **SAP HANA Cloud** (HDI container, service `hana`) |
| Login | none (only `localhost` is answered) | **XSUAA** through an application router; roles Viewer / Editor |
| AI | `AICORE_SERVICE_KEY` in `.env` | service binding `aicore` (nothing to copy) |
| Designers | `/designer/` (React, needs a build) and `/designer-ui5/` (SAPUI5, no build) | the same two, served by the server |
| Browser extension | address `http://localhost:4044` | address of the **server** route (see C.9) |

Which database is used is decided by the profile: the default profile uses SQLite, the `production` profile (set by Cloud
Foundry) uses HANA and XSUAA. See `cds` in `package.json`.

---

## Part A: local run with SQLite

### A.1 Before you leave this laptop: put everything into git

Files that are **not** in git on purpose: `.env` (secrets), `db.sqlite` (your projects), `node_modules`, `app/designer/`
(built React designer), `extension/recorder.js` and friends (built), `gen/`. They are created on the new laptop.

```bash
git status                       # see what is new or changed
git add -A
git commit -m "QuickDev: SAPUI5 designer, rebrand, BTP deployment files, guide"
git push
```

Your own data (projects, tours) lives in `db.sqlite`. To take it along, copy that one file (stop the server first) and put
it into the project folder of the new laptop before the first start. Everything else can be made again.

### A.2 Prerequisites on the office laptop

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | **24** (22.12 or newer works; the SQLite store uses `node:sqlite`) | `node -v` |
| npm | comes with Node | `npm -v` |
| Git | any | `git --version` |
| Chrome or Edge | recent (the extension needs 116+) | |
| Internet access to | `registry.npmjs.org` (packages) and `ui5.sap.com` (SAPUI5 is loaded from there) | |

Behind a company proxy: `npm config set proxy http://proxy:8080` and `npm config set https-proxy http://proxy:8080`
(your IT knows the address). If the company replaces certificates, also set `NODE_EXTRA_CA_CERTS` to the company
certificate file. Nothing else needs to be installed to run locally (no Java, no Docker).

### A.3 Install and start

```bash
git clone <your-repository-url> quickdev
cd quickdev

npm install                       # server and tools
npm --prefix designer install     # the React designer
npm run build:designer            # React designer -> app/designer  (needed once, and after changing designer/src)
npm run build:player              # the tour player
npm run build:extension           # the browser extension (recorder, player, help) -> extension/

npm run dev                       # server on http://localhost:4044, creates db.sqlite on the first start
```

Open:

* SAPUI5 designer: http://localhost:4044/designer-ui5/index.html (no build needed, needs internet for SAPUI5)
* React designer: http://localhost:4044/designer/
* Health: http://localhost:4044/health

`npm run dev` first runs `scripts/db-deploy.mjs`. It creates `db.sqlite`, and when the data model changes it **migrates and
keeps the data** (a `.bak` copy of the old file is made first).

### A.4 Load the browser extension

1. Open `chrome://extensions` (or `edge://extensions`), switch **Developer mode** on.
2. **Load unpacked** and choose the `extension` folder of the project (after `npm run build:extension`).
3. In the designer click **Browser extension** (top bar), enter a name, **Create token**, copy it (shown once).
4. Click the extension, open its settings (gear), enter the address `http://localhost:4044` and paste the token.

After you change the extension's files or rebuild it: click the reload icon on its card at `chrome://extensions`.

### A.5 Commands you will use

| What | Command |
| --- | --- |
| Start the server (restarts on changes) | `npm run dev` |
| Start like production, without watching | `npm start` |
| Rebuild the React designer | `npm run build:designer` (then restart `npm run dev`) |
| Rebuild the SAPUI5 designer's editor bundles | `npm run build:ui5-editor` (only after changing `designer/ui5-editor/`) |
| Rebuild the extension / player | `npm run build:extension` / `npm run build:player` |
| Unit tests | `npx vitest run --maxWorkers=4` |
| Browser tests | `npm run e2e` (builds first, uses a throwaway database `db.e2e.sqlite`) |
| Start with an empty database | stop the server, then `TOURD_DB_RESET=1 node scripts/db-deploy.mjs` (PowerShell: `$env:TOURD_DB_RESET=1; node scripts/db-deploy.mjs`); the old file is saved as `.bak` |
| Use another database file | `TOURD_DB_FILE=other.sqlite` |
| Format source | `npm run format` |
| Compile the data model for HANA (check only) | `npx cds compile db --to hdbtable --dest gen-check` |

Traps on Windows: `cds watch` can leave an old process on port 4044 after a rebuild; if the server seems to run old code,
stop all `node` processes of this project and start `npm run dev` once. Start **one** watcher only.

---

## Part B: SAP AI Core (Generative AI Hub, Orchestration service)

QuickDev talks to SAP AI Core through the **Orchestration service** with the SAP Cloud SDK for AI
(`@sap-ai-sdk/orchestration`, see `srv/lib/llm/sap-ai-core.js`). The service key (locally) or the service binding (on BTP)
gives the credentials; the model name and the resource group choose what is called. Without any of this, the **Rules**
generator still works and needs no AI.

### B.1 What must exist in SAP AI Core

1. A BTP subaccount with an **SAP AI Core** service instance, plan **extended** (the Generative AI Hub needs it), and **SAP AI Launchpad** if you want to look at it.
2. In SAP AI Launchpad: your AI Core connection and a **resource group** (often `default`).
3. In that resource group a **running deployment of the scenario `orchestration`**. Check under *Generative AI Hub > Orchestration*, or *ML Operations > Deployments*: a deployment with scenario `orchestration` and status **Running**. If there is none: *ML Operations > Configurations > Create* with scenario `orchestration`, executable `orchestration`, then *Create deployment* from that configuration. (Menu names change a little between Launchpad versions.)
4. A **model** you may use. Look in *Generative AI Hub > Model Library* and write the model name exactly as it is shown (for example `gpt-4o`). Models differ per region and contract.

### B.2 Get the service key

SAP BTP cockpit > your subaccount > *Instances and Subscriptions* > the AI Core instance > *Service Keys* > **Create**, then
open the key and copy the JSON. Put it on **one line**:

```bash
node -e "console.log(JSON.stringify(require('./aicore-key.json')))"
```

Delete `aicore-key.json` afterwards. The key is a secret: it never goes into git or into a chat.

### B.3 Configure the app (`.env`)

Copy `.env.example` to `.env` (the file is ignored by git) and fill in:

```ini
TOURD_LLM_PROVIDER=sap-ai-core
AICORE_SERVICE_KEY='{"clientid":"...","clientsecret":"...","url":"...","serviceurls":{"AI_API_URL":"..."}}'
AICORE_MODEL=gpt-4o
AICORE_RESOURCE_GROUP=default
```

Keep the single quotes around the JSON. Restart the server (`npm run dev`).

### B.4 Check that it works

* In the designer open a project > **Tours** > **Generate tour**: the list "Created by" shows **SAP Generative AI Hub**
  without "(not configured on the server)". Or: `curl http://localhost:4044/odata/v4/tour/providers()`.
* Generate a tour with it. The first call can take a minute.

| Message | Meaning |
| --- | --- |
| SAP AI Core rejected the credentials | wrong or expired service key; make a new one (B.2) |
| SAP AI Core found no deployment for this model/resource group | no running `orchestration` deployment in that resource group, or `AICORE_RESOURCE_GROUP` is wrong (B.1 step 3) |
| No model chosen for SAP Generative AI Hub | set `AICORE_MODEL` or type the model into the Generate dialog |
| rate limit reached | wait and try again, or use a model with more quota |
| (400, response format) | some models do not support structured output; QuickDev retries once without it by itself |

Behind a company proxy the server needs the proxy too: set `HTTPS_PROXY` and `HTTP_PROXY` in the environment before
`npm run dev` (and `NODE_EXTRA_CA_CERTS` for company certificates).

### B.5 What is sent, and how to limit it

Generating sends the control list, the recording steps and **source files** to the model. Comments and secret-looking values
are removed first. Typed values of a recording are never sent. Switches in `.env`:

* `TOURD_REDACT=1` (default) removes comments and secrets; `0` sends files unchanged (do not do that with company code).
* `TOURD_DISABLE_AI=1` turns all AI off; `TOURD_DISABLED_PROVIDERS=gemini` switches single providers off.
* `TOURD_TOKEN_BUDGET=60000` limits how much source code goes into a prompt.

---

## Part C: deploy to SAP BTP (Cloud Foundry, SAP HANA Cloud)

### C.1 What gets deployed

```
browser ──> quickdev (application router, login with XSUAA) ──> quickdev-srv (CAP server) ──> SAP HANA Cloud (HDI container)
extension ─────────────────────────────────────────────────────> quickdev-srv (own route, pairing token instead of login)
                                                                  quickdev-srv ──> SAP AI Core (orchestration, service binding)
```

Files in this repository for it: `mta.yaml` (the whole app), `xs-security.json` (roles), `approuter/` (login),
`deploy/prod.mtaext.example` (your own values), `scripts/build-cf.mjs` (build of the server bundle in `gen/`).

> **Status, honestly:** the server code for production (XSUAA login, roles, HANA profile, health check, pairing tokens, origin check
> for a router) was written and unit-tested earlier. The model compiles to HANA tables (checked). The files `mta.yaml`,
> `xs-security.json` and `approuter/` were written for this guide and have **not been deployed yet**: expect to fix a
> detail or two on the first run. The hints in C.11 cover the likely ones.

### C.2 Prerequisites in BTP

* A subaccount with **Cloud Foundry environment** and a space.
* **SAP HANA Cloud**: a running instance, and the Cloud Foundry space **mapped** to it (HANA Cloud Central > your instance > *Manage Configuration* / instance mapping, add the org and space). Its *Allowed connections* must permit BTP.
* Entitlements for the subaccount (cockpit > *Entitlements*): `SAP HANA Schemas & HDI Containers` plan `hdi-shared`, `Authorization and Trust Management` plan `application`, `SAP AI Core` plan `extended`, and Cloud Foundry runtime memory (about 1 GB is enough).
* Roles for you: Space Developer in the space; Security Administrator or similar to assign role collections.
* A Node.js buildpack that offers **Node 24** (HDI deployer needs it): `cf buildpacks` and look at `nodejs_buildpack`; ask the platform team if it is older.

### C.3 Tools on the laptop

```bash
cf --version                       # Cloud Foundry CLI v8
cf install-plugin multiapps        # adds `cf deploy`
npm install -g mbt                 # Cloud MTA Build Tool
mbt --version
```

### C.4 Log in

```bash
cf login -a https://api.cf.<region>.hana.ondemand.com   # the API endpoint is in the cockpit, subaccount overview
cf target -o <org> -s <space>
```

### C.5 Your own values

```bash
cp deploy/prod.mtaext.example deploy/prod.mtaext
```

Edit `deploy/prod.mtaext`: `AICORE_MODEL` and `AICORE_RESOURCE_GROUP` (as in B.1). If you already have an AI Core instance in
this space, change the resource `quickdev-aicore` in `mta.yaml` to `type: org.cloudfoundry.existing-service` with
`parameters: { service-name: <your instance> }` (a comment in the file shows it). If the AI Core instance is in **another**
subaccount, use a user-provided service holding its service key instead and name it `quickdev-aicore`.

Host names are `<org>-<space>-quickdev` and `<org>-<space>-quickdev-srv`. If your org or space name contains spaces or
capital letters, or the name is too long, change the two `host:` lines and the two names in `TOURD_ALLOWED_HOSTS` in `mta.yaml`
to something valid.

### C.6 Build

```bash
npm ci
npm --prefix designer ci
mbt build -t gen --mtar quickdev.mtar
```

`mbt` runs `npm run build:cf` for you (designer, player, extension, then `cds build --production` into `gen/srv` and `gen/db`).
Result: `gen/quickdev.mtar`.

### C.7 Deploy

```bash
cf deploy gen/quickdev.mtar -e deploy/prod.mtaext
cf apps                              # quickdev and quickdev-srv should be "started"
cf services                          # quickdev-db, quickdev-auth, quickdev-aicore
```

On the first deploy the HDI container is created and the tables are made (module `quickdev-db-deployer`). Later deploys
**evolve** the tables and keep the data; there is no `db-deploy.mjs` in production.

### C.8 Give people access

Cockpit > *Security* > *Role Collections*: assign **QuickDev Editor** (read and change) or **QuickDev Viewer** (read only) to
people, then they log out and in again. Without one of them the application answers "401 / 403".

### C.9 Open it and pair the extension

* People use the **router** URL: `cf app quickdev` shows `https://<org>-<space>-quickdev.cfapps.<region>.hana.ondemand.com`. It opens the SAPUI5 designer (`/designer/` is the React one).
* The **browser extension** cannot log in, so it uses the **server** URL instead: `https://<org>-<space>-quickdev-srv.cfapps.<region>.hana.ondemand.com`. In the designer: **Browser extension > Create token**, then in the extension settings enter the server URL and the token. The server accepts that route only with a valid token (and only the few calls the extension needs); everything else needs a login.

### C.10 Check

```bash
curl https://<server-url>/health                      # {"status":"UP","db":"UP"}
curl -i https://<server-url>/odata/v4/tour/Projects   # 401: no login, no token
cf logs quickdev-srv --recent
```

Then in the browser: log in, create a project, upload an app, record with the extension, generate a tour with **SAP
Generative AI Hub** (the binding is used automatically; `TOURD_LLM_PROVIDER` is `sap-ai-core`).

### C.11 If something fails

| Symptom | Likely cause and fix |
| --- | --- |
| `mbt build` fails in `npm run build:cf` | read the message; it is the normal build (run `npm run build:cf` alone to see it) |
| deploy: `hana` / `hdi-shared` not found | entitlement missing, or the space is not mapped to HANA Cloud (C.2) |
| `quickdev-db-deployer` fails with Node version | buildpack without Node 24 (C.2) |
| the router shows a login error "redirect URI" | adjust `oauth2-configuration.redirect-uris` in `xs-security.json` to your domain, `cf deploy` again |
| after login: "TourD only answers requests for localhost" | `TOURD_ALLOWED_HOSTS` does not contain the host name; check `cf env quickdev-srv` and the names in `mta.yaml` |
| uploading or saving gives 403 "only accepted from the designer itself" | the page's host is not in `TOURD_ALLOWED_HOSTS` |
| 401 / 403 after login | no role collection assigned (C.8), or log in again |
| the extension says "not paired" | the token was made on another URL or revoked; create a new one and use the **server** URL |
| generation: "no deployment" / "credentials" | see B.4; on BTP check `cf env quickdev-srv` shows an `aicore` binding and that `AICORE_MODEL` / `AICORE_RESOURCE_GROUP` are set |
| the SAPUI5 designer is blank | the browser cannot reach `ui5.sap.com` (company network) |

Keep **one instance** of `quickdev-srv` (the rate limit is per instance; there is no per-user separation of data: everybody
with a role sees all projects).

### C.12 Update and remove

```bash
# after a change: build and deploy again
mbt build -t gen --mtar quickdev.mtar && cf deploy gen/quickdev.mtar -e deploy/prod.mtaext
# remove the application and its services (the HANA data is deleted with the container!)
cf undeploy quickdev --delete-services
```

### C.13 Moving your local data to HANA

There is no automatic copy from `db.sqlite` to HANA. What you can take over by hand: export tours from the tour page
(**Export** / **Copy tour.json**), download projects as zip from the workspace (**Whole project**), and import them again in
the deployed app. For a one-time copy of many projects ask for a small script; it would use the same service calls as the designer.

### C.14 Optional: run the production profile on your laptop against HANA

Useful to test HANA before deploying (needs the HDI container to exist, so after the first deploy):

```bash
cf create-service-key quickdev-db quickdev-db-key
cds bind -2 quickdev-db:quickdev-db-key --on cf       # writes .cdsrc-private.json (not committed)
cds watch --profile hybrid --port 4044
```

Not tried here; use only if the normal deploy is clear to you.
