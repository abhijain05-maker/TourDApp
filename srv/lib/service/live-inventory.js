// The control inventory of a project as every consumer should see it: what the uploaded files contain, plus the
// controls our recorder saw in the running app that no file contains (Fiori elements and other generated UIs).
import cds from '@sap/cds'
import { mapRecording, withLiveControls } from '../recordings/map.js'
import { parseRecording } from '../recordings/index.js'

const { SELECT } = cds.ql

/** @param {object} inventory parsed inventory @param {string} projectID */
export async function inventoryWithLive(inventory, projectID) {
  const { Recordings } = cds.entities('tourd')
  // in the transaction of the caller: SQLite has one connection, a second transaction would wait for the first
  const rows = await SELECT.from(Recordings).columns('raw', 'format').where({ project_ID: projectID })
  let out = inventory
  for (const rec of rows) {
    try {
      out = withLiveControls(out, mapRecording(parseRecording(rec.raw, { format: rec.format }), out))
    } catch {
      /* a recording that cannot be read adds nothing */
    }
  }
  return out
}
