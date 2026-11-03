namespace qtest;

using { cuid, managed } from '@sap/cds/common';
using { tourd.Projects, tourd.TestPlans, tourd.Recordings } from './schema';

// QuickTest: requirements, manual and automated test cases, the links between them, and test runs.
// The application under test is a tourd.Projects row (its uploaded sources give the controls, its recordings the flows).
// Nothing here is a composition of Projects, so the other apps' service does not see these tables; deleting a project
// removes them through a handler (srv/qtest-service.js, deleteProjectData).

/** What the application must do. `acceptance` holds one criterion per line. */
entity Requirements : cuid, managed {
  project     : Association to Projects not null;
  code        : String(20) not null;        // REQ-001, unique within the project
  seq         : Integer not null;           // the number in the code
  title       : String(300) not null;
  description : LargeString;
  acceptance  : LargeString;
  priority    : String(10) default 'medium';
  kind        : String(20) default 'functional';
  status      : String(15) default 'draft';
  tags        : String(300);                // comma separated
  source      : String(300);                // where it comes from: a ticket, a document, a person
  owner       : String(120);
  origin      : String(10) default 'manual'; // manual | ai | import
}

/**
 * A test case. `steps` is JSON: [{id, action, data, expected, auto: [plan step ids]}]. A case with a `plan` is
 * automated: the plan (tourd.TestPlans) renders to wdi5; `auto` says which plan steps belong to which manual step.
 */
entity TestCases : cuid, managed {
  project       : Association to Projects not null;
  code          : String(20) not null;      // TC-001, unique within the project
  seq           : Integer not null;
  title         : String(300) not null;
  objective     : LargeString;
  preconditions : LargeString;
  steps         : LargeString;
  priority      : String(10) default 'medium';
  kind          : String(20) default 'functional';
  status        : String(15) default 'draft';
  tags          : String(300);
  owner         : String(120);
  automation    : String(12) default 'manual'; // manual | candidate | automated
  plan          : Association to TestPlans;
  recording     : Association to Recordings;
  origin        : String(10) default 'manual'; // manual | ai | recording | import
  version       : Integer default 1;
  lastResult    : String(10);               // result of the newest run item
  lastRunAt     : Timestamp;
}

/** Append-only history of a test case: every save writes one row. */
entity CaseVersions : cuid, managed {
  testCase : Association to TestCases not null;
  version  : Integer not null;
  snapshot : LargeString not null;           // JSON: the case as saved
  note     : String(200);
}

/** A requirement is verified by a test case. */
entity Coverage : cuid, managed {
  project     : Association to Projects not null;
  requirement : Association to Requirements not null;
  testCase    : Association to TestCases not null;
  origin      : String(10) default 'manual'; // manual | ai | import
}

/** One round of testing: a release, a sprint, a regression pass. */
entity Runs : cuid, managed {
  project     : Association to Projects not null;
  name        : String(200) not null;
  build       : String(100);                // the version under test
  environment : String(100);
  note        : String(1000);
  status      : String(10) default 'open';  // open | closed
  closedAt    : Timestamp;
}

/** A test case inside a run. `snapshot` keeps the case as it was, so editing the case later does not rewrite history. */
entity RunItems : cuid, managed {
  run        : Association to Runs not null;
  testCase   : Association to TestCases;
  caseCode   : String(20);
  caseTitle  : String(300);
  snapshot   : LargeString;                 // JSON: {code, title, preconditions, steps}
  status     : String(10) default 'notrun'; // notrun | passed | failed | blocked | skipped
  steps      : LargeString;                 // JSON: [{id, status, actual, note}]
  actual     : LargeString;
  defect     : String(300);
  executedBy : String(120);
  executedAt : Timestamp;
  duration   : Integer;                     // seconds
  source     : String(10) default 'manual'; // manual | wdi5
}
