// The tables of QuickTest hold no foreign key to the project (so the other apps' service does not see them): deleting
// a project removes them here. Called by the tour service before it deletes the project.
import cds from '@sap/cds'

const { SELECT, DELETE } = cds.ql

export async function deleteProjectData(projectID) {
  const { Requirements, TestCases, Coverage, CaseVersions, Runs, RunItems } = cds.entities('qtest')
  const runs = (await SELECT.from(Runs).columns('ID').where({ project_ID: projectID })).map((r) => r.ID)
  const cases = (await SELECT.from(TestCases).columns('ID').where({ project_ID: projectID })).map((c) => c.ID)
  if (runs.length) await DELETE.from(RunItems).where({ run_ID: { in: runs } })
  if (cases.length) await DELETE.from(CaseVersions).where({ testCase_ID: { in: cases } })
  await DELETE.from(Coverage).where({ project_ID: projectID })
  await DELETE.from(Runs).where({ project_ID: projectID })
  await DELETE.from(TestCases).where({ project_ID: projectID })
  await DELETE.from(Requirements).where({ project_ID: projectID })
}
