using { tourd } from '../db/schema';

@path: '/odata/v4/tour'
service TourService {

  // Heavy columns (inventory, file content, raw recording, version definitions) are not part of the
  // list projections; read them with the functions below.
  entity Projects       as projection on tourd.Projects excluding { inventory };
  entity Sources as select from tourd.Sources {
    *,
    case
      when deleted = true then 'deleted'
      when baseHash is null then 'added'
      when hash <> baseHash then 'modified'
      else 'unchanged'
    end as status : String(10)
  } excluding { content, base };
  entity Recordings     as projection on tourd.Recordings excluding { raw };
  entity Tours          as projection on tourd.Tours;
  entity TestPlans      as projection on tourd.TestPlans;
  entity HelpSets       as projection on tourd.HelpSets;
  entity TourVersions   as projection on tourd.TourVersions excluding { definition };
  entity GenerationJobs as projection on tourd.GenerationJobs;
  entity ExtensionTokens as projection on tourd.ExtensionTokens excluding { tokenHash };

  type SourceFile { path : String; content : LargeString; binary : Boolean; }
  type Warning    { code : String; message : String; }
  type SkippedFile { path : String; reason : String; expected : Boolean; }

  type ImportResult {
    imported : Integer;
    ignored  : many String;
    skipped  : many SkippedFile;
    complete : Boolean;
    appId    : String;
    views    : Integer;
    controls : Integer;
    warnings : many Warning;
  }

  type RecordingResult {
    ID         : UUID;
    format     : String;
    steps      : Integer;
    actionable : Integer;
    mapped     : Integer;
    unmapped   : Integer;
    skipped    : Integer;
  }

  type LintIssue  { path : String; code : String; severity : String; message : String; stepId : String; }
  type LintResult { errors : Integer; warnings : Integer; infos : Integer; issues : many LintIssue; }
  type ProviderInfo { id : String; label : String; configured : Boolean; model : String; redaction : Boolean; }

  // sources
  action importSources(projectID : UUID, files : many SourceFile, replace : Boolean) returns ImportResult;
  action parseProject(projectID : UUID) returns ImportResult;
  function getInventory(projectID : UUID) returns LargeString;
  function getSourceContent(sourceID : UUID) returns LargeString;

  // the project's files: read, edit, add, rename, remove, put back
  type FileInfo   { ID : UUID; path : String; kind : String; status : String; size : Integer; binary : Boolean; edited : Boolean; hash : String; }
  type FileDetail { ID : UUID; path : String; kind : String; status : String; binary : Boolean; hash : String; content : LargeString; base : LargeString; }
  function getFile(fileID : UUID) returns FileDetail;
  action   saveFile(fileID : UUID, content : LargeString, expectedHash : String) returns FileInfo;
  action   createFile(projectID : UUID, path : String, content : LargeString, binary : Boolean) returns FileInfo;
  action   renameFile(fileID : UUID, path : String) returns FileInfo;
  action   deleteFile(fileID : UUID) returns FileInfo;
  action   revertFile(fileID : UUID) returns FileInfo;
  action   acceptChanges(projectID : UUID, fileIDs : many UUID) returns Integer;
  function getChanges(projectID : UUID) returns many FileInfo;

  // adding a tour to the project's files (the player, the manifest entry, the button, the handler)
  type ApplyNote { code : String; message : String; }
  type ApplyEdit { path : String; action : String; what : String; before : LargeString; after : LargeString; }
  type ApplyPlan { ok : Boolean; blocking : many ApplyNote; notes : many ApplyNote; edits : many ApplyEdit; existing : LargeString; }
  type ApplyResult { applied : Integer; paths : many String; }
  // wdi5 tests: a plan made from a recording, edited as a table, written into the project's files
  action createTestPlan(projectID : UUID, recordingID : UUID, name : String, settings : LargeString) returns TestPlans;
  action saveTestPlan(planID : UUID, definition : LargeString, baseVersion : Integer) returns TestPlans;
  action rebuildTestPlan(planID : UUID) returns TestPlans;
  function capability(scope : String, id : UUID) returns LargeString;
  function dryRunTestPlan(planID : UUID) returns LargeString;
  action previewTestApply(planID : UUID) returns ApplyPlan;
  action applyTestToProject(planID : UUID, paths : many String, accept : Boolean) returns ApplyResult;

  action previewTourApply(tourID : UUID) returns ApplyPlan;
  action applyTourToProject(tourID : UUID, paths : many String, accept : Boolean) returns ApplyResult;

  // recordings
  action importRecording(projectID : UUID, name : String, raw : LargeString, format : String) returns RecordingResult;
  function getRecording(recordingID : UUID) returns LargeString; // mapped against the current inventory

  // tours
  action generateTour(projectID : UUID, recordingID : UUID, provider : String, model : String, title : String) returns GenerationJobs;
  action createTour(projectID : UUID, name : String, definition : LargeString) returns Tours;
  action saveTour(tourID : UUID, definition : LargeString, note : String, autosave : Boolean, baseVersion : Integer) returns Tours;
  action restoreVersion(tourID : UUID, version : Integer) returns Tours;
  action refineStep(tourID : UUID, stepID : String, instruction : String, provider : String, model : String) returns Tours;
  function getTourVersion(tourID : UUID, version : Integer) returns LargeString;
  function lintTour(tourID : UUID) returns LintResult;

  // help: topics bound to controls, authored in the browser extension (or the designer)
  action createHelpSet(projectID : UUID, name : String) returns HelpSets;
  action saveHelpSet(helpID : UUID, definition : LargeString, baseVersion : Integer) returns HelpSets;
  action saveHelpTopic(projectID : UUID, helpID : UUID, topic : LargeString) returns HelpSets;
  action deleteHelpTopic(helpID : UUID, topicID : String) returns HelpSets;
  // adding the help to the project's files (the layer, help.json, the manifest entry, the start in the Component)
  action previewHelpApply(helpID : UUID) returns ApplyPlan;
  action applyHelpToProject(helpID : UUID, paths : many String, accept : Boolean) returns ApplyResult;
  // AI: writes the topic from the control (when there is no text yet) or improves what is written; JSON {title, summary, text, note, generator}
  action improveHelpTopic(projectID : UUID, topic : LargeString, control : LargeString, screen : String, instruction : String, provider : String, model : String) returns LargeString;

  function providers() returns many ProviderInfo;

  // browser extension pairing: the token is shown once, only its hash is kept
  type NewToken { ID : UUID; name : String; token : String; }
  action createExtensionToken(name : String) returns NewToken;
  action revokeExtensionToken(ID : UUID) returns Boolean;
}

// Derived or system-managed data cannot be written directly (handlers in tour-service.js enforce the rest).
annotate TourService.Projects with {
  appId       @readonly;
  parseStatus @readonly;
};
annotate TourService.GenerationJobs with @readonly;
annotate TourService.TourVersions with @readonly;
annotate TourService.HelpSets with @readonly; // written by the actions above only
annotate TourService.ExtensionTokens with @readonly;
