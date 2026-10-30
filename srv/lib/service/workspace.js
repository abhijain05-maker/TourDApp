// The project's files as a workspace: read, edit, add, rename, remove and put back, with every file knowing
// what it looked like when it was uploaded. Handlers are registered on TourService (see tour-service.js).
//
// How a file is stored:  content = the working copy, base = the uploaded copy. To save space base stays empty
// while the two are the same (baseHash === hash); it is filled in the moment the file is first changed.
import cds from '@sap/cds'
import { LIMITS, byteSize, exclusionReason, normalizeSourcePath, sha256 } from './sources.js'
import { classifySource } from '../context/inventory.js'

const { SELECT, INSERT, UPDATE, DELETE } = cds.ql
const uuid = () => cds.utils.uuid()

/** Kinds the parsers read: changing one of these changes the inventory. */
const PARSED = new Set(['view', 'fragment', 'controller', 'manifest', 'i18n'])

export const statusOf = (r) =>
  r.deleted ? 'deleted' : !r.baseHash ? 'added' : r.hash !== r.baseHash ? 'modified' : 'unchanged'

/** The uploaded copy of a file (null for a file that was added in TourD). */
export const baseOf = (r) => r.base ?? (r.baseHash && r.baseHash === r.hash ? r.content : null)

export const info = (r) => ({
  ID: r.ID,
  path: r.path,
  kind: r.kind,
  status: statusOf(r),
  size: r.size ?? 0,
  binary: !!r.binary,
  edited: !!r.edited,
  hash: r.hash,
})

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** Fills in what files from before the workspace do not have yet (hash, size, the uploaded copy). */
export async function backfillWorkspace(batch = 200) {
  const { Sources } = cds.entities('tourd')
  let done = 0
  for (;;) {
    const rows = await SELECT.from(Sources)
      .columns('ID', 'content', 'binary')
      .where({ hash: null })
      .limit(batch)
    if (!rows.length) return done
    for (const r of rows) {
      const content = r.content ?? ''
      const hash = sha256(content)
      await UPDATE(Sources)
        .set({ hash, baseHash: hash, size: byteSize(content, !!r.binary), origin: 'upload' })
        .where({ ID: r.ID })
    }
    done += rows.length
  }
}

/**
 * @param {object} srv the TourService
 * @param {{project: Function, rebuildInventory: Function, guarded: Function}} deps helpers of the service
 */
export function registerWorkspace(srv, { project, rebuildInventory, guarded }) {
  const { Sources } = cds.entities('tourd')

  const row = async (req, ID) =>
    (await SELECT.one.from(Sources).where({ ID })) ?? req.reject(404, 'File not found')

  const refresh = async (projectID, kind) => {
    if (PARSED.has(kind)) await rebuildInventory(projectID)
  }

  /** Checks text and size of new content; returns what is stored. */
  const prepare = (req, path, content, binary) => {
    if (typeof content !== 'string') return req.reject(400, 'The file has no content')
    if (binary ? !BASE64.test(content) : content.includes('\u0000'))
      return req.reject(400, binary ? 'The content is not valid base64' : 'This is not a text file')
    const size = byteSize(content, binary)
    const limit = binary ? LIMITS.binaryBytes : LIMITS.fileBytes
    if (size > limit)
      return req.reject(400, `${path} is too large (${size} bytes); the limit is ${limit}`)
    return { size, hash: sha256(content) }
  }

  srv.on('getFile', async (req) => {
    const r = await row(req, req.data.fileID)
    return { ...info(r), content: r.content, base: baseOf(r) }
  })

  srv.on(
    'saveFile',
    guarded(async (req) => {
      const { fileID, content, expectedHash } = req.data
      const r = await row(req, fileID)
      if (r.deleted) return req.reject(409, 'The file was removed. Restore it before changing it.')
      if (expectedHash && expectedHash !== r.hash)
        return req.reject(
          409,
          'The file was changed elsewhere (another tab, or a generator). Reload it to continue.',
        )
      const { size, hash } = prepare(req, r.path, content, r.binary)
      if (hash === r.hash) return info(r)
      const changes = {
        content,
        size,
        hash,
        edited: r.baseHash ? hash !== r.baseHash : true,
      }
      // the uploaded copy is only kept once the file starts to differ from it
      if (r.baseHash && r.base == null) changes.base = r.content
      await UPDATE(Sources).set(changes).where({ ID: fileID })
      await refresh(r.project_ID, r.kind)
      return info({ ...r, ...changes })
    }),
  )

  const insertFile = async (req, projectID, path, content, binary, origin = 'created') => {
    const { size, hash } = prepare(req, path, content, binary)
    const kind = classifySource(path)
    const existing = await SELECT.one
      .from(Sources)
      .columns('ID', 'deleted', 'base', 'baseHash', 'hash', 'content')
      .where({ project_ID: projectID, path })
    if (existing && !existing.deleted) return req.reject(409, `${path} exists already`)
    if (existing) {
      // the path of a removed uploaded file is used again: it is the same file again, now with new content
      const changes = {
        content,
        size,
        hash,
        binary: !!binary,
        kind,
        deleted: false,
        edited: existing.baseHash ? hash !== existing.baseHash : true,
        origin: existing.baseHash ? 'upload' : origin,
      }
      if (existing.baseHash && existing.base == null) changes.base = existing.content
      await UPDATE(Sources).set(changes).where({ ID: existing.ID })
      return { ...(await SELECT.one.from(Sources).where({ ID: existing.ID })) }
    }
    const created = {
      ID: uuid(),
      project_ID: projectID,
      path,
      kind,
      content,
      base: null,
      binary: !!binary,
      size,
      hash,
      baseHash: null,
      origin,
      edited: origin === 'created',
      deleted: false,
    }
    await INSERT.into(Sources).entries(created)
    return created
  }

  srv.on(
    'createFile',
    guarded(async (req) => {
      const { projectID, content = '', binary } = req.data
      await project(req, projectID, ['ID'])
      const path = normalizeSourcePath(req.data.path)
      const why = exclusionReason(path)
      if (why) return req.reject(400, `${path} cannot be added: it is ${why}`)
      const r = await insertFile(req, projectID, path, content, !!binary)
      await refresh(projectID, r.kind)
      return info(r)
    }),
  )

  const removeRow = async (r) => {
    // a file that exists only in TourD has nothing to come back to; an uploaded one is kept, marked as removed
    if (!r.baseHash) {
      await DELETE.from(Sources).where({ ID: r.ID })
      return {
        ID: r.ID,
        path: r.path,
        kind: r.kind,
        status: 'removed',
        size: 0,
        binary: !!r.binary,
        edited: false,
        hash: null,
      }
    }
    const changes = { deleted: true }
    if (r.base == null) changes.base = r.content
    await UPDATE(Sources).set(changes).where({ ID: r.ID })
    return info({ ...r, ...changes })
  }

  // DELETE /Sources(id) behaves like deleteFile
  srv.on('DELETE', srv.entities.Sources, async (req) => {
    const r = await SELECT.one.from(Sources).where({ ID: req.data.ID })
    if (!r) return req.reject(404, 'File not found')
    if (!r.deleted) {
      await removeRow(r)
      await refresh(r.project_ID, r.kind)
    }
    return true
  })

  srv.on('deleteFile', async (req) => {
    const r = await row(req, req.data.fileID)
    if (r.deleted) return info(r)
    const out = await removeRow(r)
    await refresh(r.project_ID, r.kind)
    return out
  })

  srv.on(
    'renameFile',
    guarded(async (req) => {
      const r = await row(req, req.data.fileID)
      if (r.deleted) return req.reject(409, 'The file was removed. Restore it before renaming it.')
      const path = normalizeSourcePath(req.data.path)
      if (path === r.path) return info(r)
      const why = exclusionReason(path)
      if (why) return req.reject(400, `${path} cannot be used: it is ${why}`)
      // a rename is "the old file is gone, a new file is there": that is also how the hand-over describes it
      const moved = await insertFile(req, r.project_ID, path, r.content, !!r.binary)
      await removeRow(r)
      await refresh(r.project_ID, r.kind)
      await refresh(r.project_ID, moved.kind)
      return info(moved)
    }),
  )

  srv.on('revertFile', async (req) => {
    const r = await row(req, req.data.fileID)
    if (!r.baseHash) {
      const out = await removeRow(r)
      await refresh(r.project_ID, r.kind)
      return out
    }
    const back = baseOf(r)
    if (back == null) return req.reject(500, 'The uploaded copy of this file is missing')
    const changes = {
      content: back,
      hash: r.baseHash,
      size: byteSize(back, !!r.binary),
      edited: false,
      deleted: false,
    }
    await UPDATE(Sources).set(changes).where({ ID: r.ID })
    await refresh(r.project_ID, r.kind)
    return info({ ...r, ...changes })
  })

  // The changes become the project: the working copy is the new "as uploaded", a removed file is gone for good.
  // Nothing is lost from the project itself; only the way back to the first upload (and the diff against it).
  // `only` limits it to some files (by id or by path); without it every changed file is accepted.
  const accept = async (projectID, only = {}) => {
    const ids = only.ids?.length ? new Set(only.ids) : null
    const paths = only.paths ? new Set(only.paths) : null
    const rows = await SELECT.from(Sources)
      .columns('ID', 'path', 'kind', 'hash', 'baseHash', 'deleted')
      .where({ project_ID: projectID })
    let accepted = 0
    const kinds = new Set()
    for (const r of rows) {
      if ((ids && !ids.has(r.ID)) || (paths && !paths.has(r.path))) continue
      if (r.deleted) {
        await DELETE.from(Sources).where({ ID: r.ID })
      } else if (!r.baseHash || r.hash !== r.baseHash) {
        await UPDATE(Sources).set({ base: null, baseHash: r.hash, edited: false }).where({ ID: r.ID })
      } else {
        continue
      }
      accepted++
      kinds.add(r.kind)
    }
    for (const kind of kinds) await refresh(projectID, kind)
    return accepted
  }

  srv.on('acceptChanges', async (req) => {
    await project(req, req.data.projectID, ['ID'])
    return accept(req.data.projectID, { ids: req.data.fileIDs })
  })

  /**
   * What a generator does to a project's file: replaces the text of an existing file or adds a new one. The change
   * is an ordinary change of the workspace (status, diff, export). Does not rebuild the inventory: the caller does,
   * once, after the last file.
   */
  const writeFile = async (req, projectID, path, content) => {
    const existing = await SELECT.one.from(Sources).where({ project_ID: projectID, path })
    if (!existing || existing.deleted)
      return insertFile(req, projectID, path, content, false, 'generated')
    const { size, hash } = prepare(req, path, content, existing.binary)
    if (hash === existing.hash) return existing
    const changes = { content, size, hash }
    if (existing.baseHash && existing.base == null) changes.base = existing.content
    await UPDATE(Sources).set(changes).where({ ID: existing.ID })
    return { ...existing, ...changes }
  }

  srv.on('getChanges', async (req) => {
    await project(req, req.data.projectID, ['ID'])
    const rows = await SELECT.from(Sources)
      .columns('ID', 'path', 'kind', 'size', 'binary', 'edited', 'hash', 'baseHash', 'deleted')
      .where({ project_ID: req.data.projectID })
      .orderBy('path')
    return rows.map(info).filter((f) => f.status !== 'unchanged')
  })

  return { writeFile, accept }
}
