using { qtest } from '../db/qtest';
using { tourd } from '../db/schema';

// QuickTest: requirements, test cases, the links between them, runs and automation (wdi5).
// Like the tour service, the functions return JSON in a LargeString, so a new column or a new kind of number
// needs no change of this file. Writes go through the actions only (the entities are read-only).
@path: '/odata/v4/qtest'
service QTestService {

  @readonly entity Requirements as projection on qtest.Requirements;
  @readonly entity TestCases    as projection on qtest.TestCases excluding { steps };
  @readonly entity Coverage     as projection on qtest.Coverage;
  @readonly entity CaseVersions as projection on qtest.CaseVersions excluding { snapshot };
  @readonly entity Runs         as projection on qtest.Runs;
  @readonly entity RunItems     as projection on qtest.RunItems excluding { snapshot, steps };

  // read only views of what QuickTest shares with the other QuickDev apps
  @readonly entity Projects   as projection on tourd.Projects { ID, name, description, appId, parseStatus, createdAt, modifiedAt };
  @readonly entity TestPlans  as projection on tourd.TestPlans excluding { definition };
  @readonly entity Recordings as projection on tourd.Recordings excluding { raw };

  type ProviderInfo { id : String; label : String; configured : Boolean; model : String; redaction : Boolean; }

  function qtestMeta() returns LargeString;                                  // priorities, kinds, statuses, results: the UI draws from it
  function providers() returns many ProviderInfo;
  function overview() returns LargeString;                                    // every project with its numbers
  function dashboard(projectID : UUID) returns LargeString;
  function listRequirements(projectID : UUID) returns LargeString;
  function listCases(projectID : UUID) returns LargeString;
  function getRequirement(ID : UUID) returns LargeString;
  function getCase(ID : UUID) returns LargeString;
  function caseVersions(caseID : UUID) returns LargeString;
  function getCaseVersion(caseID : UUID, version : Integer) returns LargeString;
  function matrix(projectID : UUID) returns LargeString;

  // requirements and test cases
  action saveRequirement(projectID : UUID, ID : UUID, data : LargeString) returns LargeString;
  action deleteRequirement(ID : UUID) returns Boolean;
  action saveCase(projectID : UUID, ID : UUID, data : LargeString, note : String) returns LargeString;
  action deleteCase(ID : UUID) returns Boolean;
  action duplicateCase(ID : UUID) returns LargeString;
  action restoreCaseVersion(caseID : UUID, version : Integer) returns LargeString;
  action bulk(projectID : UUID, entity : String, ids : many UUID, patch : LargeString) returns Integer;
  action bulkDelete(projectID : UUID, entity : String, ids : many UUID) returns Integer;
  action setCoverage(requirementID : UUID, caseID : UUID, linked : Boolean) returns Boolean;
  action linkCases(requirementID : UUID, caseIDs : many UUID) returns Integer;
  action saveBatch(projectID : UUID, payload : LargeString) returns LargeString;   // review results of the AI, an import

  // upload: mode "preview" says what would happen, "apply" does it
  action importBook(projectID : UUID, filename : String, content : LargeString, encoding : String, as : String, strategy : String, mode : String) returns LargeString;

  // runs
  function listRuns(projectID : UUID) returns LargeString;
  function getRun(runID : UUID) returns LargeString;
  function getRunItem(itemID : UUID) returns LargeString;
  action createRun(projectID : UUID, name : String, build : String, environment : String, note : String, caseIDs : many UUID, filter : LargeString) returns LargeString;
  action updateRun(runID : UUID, name : String, build : String, environment : String, note : String) returns LargeString;
  action closeRun(runID : UUID, reopen : Boolean) returns LargeString;
  action deleteRun(runID : UUID) returns Boolean;
  action addRunCases(runID : UUID, caseIDs : many UUID) returns Integer;
  action removeRunItems(runID : UUID, itemIDs : many UUID) returns Integer;
  action recordResult(itemID : UUID, status : String, steps : LargeString, actual : LargeString, defect : String, duration : Integer) returns LargeString;
  action importResults(projectID : UUID, runID : UUID, name : String, content : LargeString) returns LargeString;

  // automation (wdi5)
  function getAutomation(caseID : UUID) returns LargeString;
  function automationCode(caseID : UUID) returns LargeString;
  action caseFromRecording(projectID : UUID, recordingID : UUID, name : String, requirementIDs : many UUID, settings : LargeString) returns LargeString;
  action attachRecording(caseID : UUID, recordingID : UUID, settings : LargeString) returns LargeString;
  action automateCase(caseID : UUID, provider : String, model : String, settings : LargeString) returns LargeString;
  action automationSettings(caseID : UUID, settings : LargeString) returns LargeString;
  action detachAutomation(caseID : UUID) returns LargeString;

  // AI: proposals only, nothing is stored before the person accepts (saveBatch)
  action aiRequirements(projectID : UUID, text : LargeString, instruction : String, provider : String, model : String) returns LargeString;
  action aiCases(projectID : UUID, requirementIDs : many UUID, kinds : many String, count : Integer, instruction : String, provider : String, model : String) returns LargeString;
  // spends a few tokens: asks the provider for {"ok": true}, so a person sees at once whether the key and the model work
  action testProvider(provider : String, model : String) returns LargeString;
  action aiImprove(projectID : UUID, entity : String, draft : LargeString, instruction : String, provider : String, model : String) returns LargeString;
}
