namespace tourd;

using { cuid, managed } from '@sap/cds/common';

/** A UI5 app we generate tours for. `inventory` is derived JSON (see srv/lib/context/inventory.js). */
entity Projects : cuid, managed {
  name        : String(120) not null;
  description : String(500);
  ui5Version  : String(20) default '1.120';
  appId       : String(200);
  inventory   : LargeString;
  parseStatus : String(20) default 'empty'; // empty | ok | warnings
  skipped     : LargeString;                // JSON: files that were left out of the import and why
  sources     : Composition of many Sources on sources.project = $self;
  recordings  : Composition of many Recordings on recordings.project = $self;
  tours       : Composition of many Tours on tours.project = $self;
  jobs        : Composition of many GenerationJobs on jobs.project = $self;
  testPlans   : Composition of many TestPlans on testPlans.project = $self;
  helpSets    : Composition of many HelpSets on helpSets.project = $self;
}

/**
 * A file of the project (the workspace). `content` is the working copy, `base` what was uploaded; the difference is
 * what TourD and the user changed. Binary files hold base64. A removed file stays (deleted) so it can be restored
 * and exported as a deletion.
 */
entity Sources : cuid, managed {
  project  : Association to Projects not null;
  path     : String(500) not null;
  kind     : String(20) not null;           // view | fragment | controller | manifest | i18n | other
  content  : LargeString;
  base     : LargeString;                   // null: the file was added in TourD
  binary   : Boolean default false;
  size     : Integer default 0;             // bytes of the working copy
  hash     : String(64);                    // SHA-256 of the working copy
  baseHash : String(64);                    // SHA-256 of the uploaded copy
  origin   : String(20) default 'upload';   // upload | created | generated
  edited   : Boolean default false;         // changed by hand (generators leave such a file alone)
  deleted  : Boolean default false;
}

/** A recorded flow as uploaded (raw), plus the mapping summary at import time. */
entity Recordings : cuid, managed {
  project : Association to Projects not null;
  name    : String(200);
  format  : String(30) not null;
  raw     : LargeString not null;
  summary : LargeString; // JSON: steps / mapped / unmapped
  purpose : String(10) default 'both'; // tour | test | both: what it was recorded for
}

/** A tour. `definition` is the validated tour JSON (shared/tour-schema.mjs). */
entity Tours : cuid, managed {
  project    : Association to Projects not null;
  recording  : Association to Recordings;
  name       : String(200) not null;
  definition : LargeString not null;
  version    : Integer default 1;
  generator  : String(30);  // rules | gemini | sap-ai-core | manual
  model      : String(100);
  versions   : Composition of many TourVersions on versions.tour = $self;
}

/** The wdi5 tests of a recording as a plan (shared/wdi5-plan.mjs): steps, locators and the settings of the generated project. */
entity TestPlans : cuid, managed {
  project    : Association to Projects not null;
  recording  : Association to Recordings;
  name       : String(200) not null;
  definition : LargeString not null;
  version    : Integer default 1;
  generator  : String(30);  // rules | manual
}

/** The help of an app: topics bound to controls (shared/help-schema.mjs). `definition` is the validated help JSON. */
entity HelpSets : cuid, managed {
  project    : Association to Projects not null;
  name       : String(200) not null;
  definition : LargeString not null;
  version    : Integer default 1;
  generator  : String(30);  // extension | designer | ai
}

/** Append-only history: every save writes one row. */
entity TourVersions : cuid, managed {
  tour       : Association to Tours not null;
  version    : Integer not null;
  definition : LargeString not null;
  note       : String(200);
}

/** One tour generation run; the designer polls it. */
entity GenerationJobs : cuid, managed {
  project   : Association to Projects not null;
  recording : Association to Recordings;
  tour      : Association to Tours;
  provider  : String(30);
  model     : String(100);
  status    : String(20) default 'queued'; // queued | running | done | failed
  stage     : String(30);                  // context | generate | validate | repair | save
  error     : LargeString;
  report    : LargeString;                 // JSON: counts, notes
}

/** A paired browser extension. It proves itself with a secret token; only the hash of the token is stored. */
entity ExtensionTokens : cuid, managed {
  name       : String(120) not null;
  prefix     : String(16);           // the first characters of the token, to recognise it in the list
  tokenHash  : String(64) not null;  // SHA-256 of the token
  lastUsedAt : Timestamp;
  revoked    : Boolean default false;
}
