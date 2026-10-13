import { houseBridge as injectedHouseBridge } from '@agentshouse/app-bridge'
import {
  DEFAULT_COLUMNS, idField, validateBoard, validateColumn, validateNote, validateVote, validateReferences,
  columnsFor, notesFor, votesFor, sameBoard,
  type Board, type BoardFields, type Column, type ColumnFields, type ColumnInput,
  type ImportedBoard, type Note, type NoteFields, type RetroData, type Vote, type Attribution,
} from './model'

// This is the only application module that imports or calls the Runtime.
// The host supplies its connected Runtime client through the bridge.
export type HouseRuntime = Awaited<ReturnType<typeof injectedHouseBridge>['runtime']>
export type HouseRoom = Awaited<ReturnType<HouseRuntime['rooms']>>[number]
export type QueuedWrite = { outcome: 'queued'; identifier: string }
export type BoardPatch = Partial<Omit<BoardFields, 'id'>>
export type ColumnPatch = Partial<Omit<ColumnFields, 'id' | 'board_id'>>
export type NotePatch = Partial<Omit<NoteFields, 'id' | 'board_id'>>
type DraftParts = Parameters<HouseRuntime['roomDraft']['write']>[3]
type Change = { path: string; parts: DraftParts }
type RetroRow = Board | Column | Note | Vote
type Document = { room: string; path: string; type?: string; fields?: Readonly<Record<string, unknown>>; markdown?: string; change?: { author: Attribution | null; time: string } | null }
export type RetroResult = { documents: readonly Document[] }

// Published MD Model has no boolean kind. Store explicit string enums and keep
// booleans in the UI model; never coerce arbitrary strings into truthy values.
const booleanFields = new Set(['isLocked', 'visible', 'edited'])
function storedValue(key: string, value: unknown): unknown {
  return booleanFields.has(key) && typeof value === 'boolean' ? String(value) : value
}
function modelFields(document: Document): Record<string, unknown> {
  const fields = { ...document.fields }
  for (const key of booleanFields) {
    if (!Object.hasOwn(fields, key)) continue
    if (fields[key] !== 'true' && fields[key] !== 'false') throw new Error(`Stored ${key} must be the enum string true or false.`)
    fields[key] = fields[key] === 'true'
  }
  return fields
}

function headAuthor(document: Document): Attribution | null {
  const author = document.change?.author
  if (author === undefined || author === null) return null
  if ((author.kind !== 'user' && author.kind !== 'site') || typeof author.id !== 'string' || !author.id || typeof author.name !== 'string') {
    throw new Error('House returned invalid head-author metadata.')
  }
  return { kind: author.kind, id: author.id, name: author.name }
}

let bridge: ReturnType<typeof injectedHouseBridge> | undefined
let connection: Promise<HouseRuntime> | undefined
export function houseBridge() {
  if (!bridge) { bridge = injectedHouseBridge(); bridge.setTab({ title: 'Retro Board' }) }
  return bridge
}
export function houseRuntime(): Promise<HouseRuntime> {
  connection ??= (async () => houseBridge().runtime)().catch((error: unknown) => { connection = undefined; bridge = undefined; throw error })
  return connection
}
export const retroQuery = {
  types: ['retro_board', 'retro_column', 'retro_note', 'retro_vote'],
  select: { fields: 'all' as const, change: true as const },
  orderBy: [{ by: 'path' as const, direction: 'asc' as const }],
}
export const listRooms = (md: HouseRuntime) => md.rooms()
export const observeRetro = (md: HouseRuntime) => md.observe('query', retroQuery)
export const observeRooms = (md: HouseRuntime) => md.observe('rooms')
export const observeSyncStatus = (md: HouseRuntime) => md.observe('sync-status')
export const observeRoomDrafts = (md: HouseRuntime) => md.observe('room-drafts')
export const observeStorageLoss = (md: HouseRuntime) => md.observe('storage-loss')
export const observeConnectionRefusal = (md: HouseRuntime) => md.observe('connection-refusal')
export const observeServiceMode = (md: HouseRuntime) => md.observe('service-mode')
export const observeQueue = (md: HouseRuntime, room: string) => md.observe('queue', room)

export function readRetro(result: RetroResult): RetroData {
  const data: RetroData = { boards: [], columns: [], notes: [], votes: [] }
  const identities = new Set<string>()
  for (const document of result.documents) {
    const location = { room: idField(document.room, 'Room'), path: idField(document.path, 'Document path') }
    let row: RetroRow
    if (document.type === 'retro_board') {
      row = { ...validateBoard(modelFields(document)), ...location }; data.boards.push(row)
    } else if (document.type === 'retro_column') {
      row = { ...validateColumn(modelFields(document)), ...location }; data.columns.push(row)
    } else if (document.type === 'retro_note') {
      row = { ...validateNote(modelFields(document)), ...location, lastEditedBy: headAuthor(document) }; data.notes.push(row)
    } else if (document.type === 'retro_vote') {
      row = { ...validateVote(modelFields(document)), ...location, author: headAuthor(document) }; data.votes.push(row)
    } else {
      throw new Error(`Unsupported retrospective document type at ${document.path}.`)
    }
    const key = `${document.room}\0${document.type}\0${row.id}`
    if (identities.has(key)) throw new Error('This Room contains duplicate retrospective IDs. Resolve them in House.')
    identities.add(key)
  }
  const boards = new Set(data.boards.map((board) => `${board.room}\0${board.id}`))
  for (const row of [...data.columns, ...data.notes, ...data.votes]) {
    if (!boards.has(`${row.room}\0${row.board_id}`)) throw new Error(`Retrospective item ${row.path} refers to a missing board. Restore the board or resolve the item in House.`)
  }
  for (const board of data.boards) {
    validateReferences({ board, columns: columnsFor(data, board), notes: notesFor(data, board), votes: votesFor(data, board) })
  }
  return data
}

export class HouseWriteError extends Error {
  readonly details: unknown
  constructor(message: string, details: unknown) {
    super(message, { cause: details }); this.name = 'HouseWriteError'; this.details = details
  }
}
function refused(message: string, details: unknown = null): never { throw new HouseWriteError(message, details) }

/** Save is local queuing. Only the Runtime's observations establish synchronization. */
async function queueChanges(md: HouseRuntime, room: string, changes: Change[]): Promise<QueuedWrite> {
  idField(room, 'Room')
  if (!changes.length) return refused('There are no changes to save.')
  if (new Set(changes.map((change) => change.path)).size !== changes.length) return refused('A grouped change contains the same document twice.')
  // Preflight every path before writing any drafts. Never discard or overwrite a draft.
  for (const change of changes) {
    const existing = await md.roomDraft.read(room, change.path)
    if (existing) refused('This item has an unfinished House draft. Resolve it in House before editing it again.', existing)
  }
  const drafts = []
  for (const change of changes) {
    // Null is an atomic “there was no draft” precondition, including across tabs.
    const written = await md.roomDraft.write(room, change.path, null, change.parts)
    if (written.outcome !== 'written' || !written.roomDraft) {
      refused('A House draft changed in another tab. Reload and review before retrying. Any prepared drafts have been kept.', written)
    }
    drafts.push({ path: change.path, revision: written.roomDraft.revision })
  }
  const saved = await md.save(room, drafts)
  if (saved.outcome !== 'saved') refused(`House did not queue this change: ${saved.code}. Your Room drafts have been kept.`, saved)
  return { outcome: 'queued', identifier: saved.identifier }
}
function identity(prefix: string): string { return `${prefix}-${crypto.randomUUID()}` }
function boardPath(boardId: string): string { return `retros/${boardId}/board.md` }
function columnPath(boardId: string, id: string): string { return `retros/${boardId}/columns/${id}.md` }
function notePath(boardId: string, id: string): string { return `retros/${boardId}/notes/${id}.md` }
function votePath(boardId: string, id: string): string { return `retros/${boardId}/votes/${id}.md` }
/** Only declared portable fields ever enter creation, comparison, or field bases. */
function rowFields(row: RetroRow): Record<string, unknown> {
  if ('note_id' in row) return validateVote(row)
  if ('column_id' in row) return validateNote(row)
  if ('board_id' in row) return validateColumn(row)
  return validateBoard(row)
}
function creation(type: string, row: RetroRow): Change {
  const path = row.path
  const fields = rowFields(row)
  return { path, parts: { creation: { type, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, storedValue(key, value)])), sections: {} } } }
}
function fieldChange(row: RetroRow, patch: Readonly<Record<string, unknown>>): Change {
  const old = rowFields(row)
  return { path: row.path, parts: { fields: Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, {
    value: storedValue(key, value), base: Object.hasOwn(old, key) ? { value: storedValue(key, old[key]) } : null,
  }])) } }
}
function checkPatch(patch: object, allowed: readonly string[]): void {
  const keys = Object.keys(patch)
  if (!keys.length || keys.some((key) => !allowed.includes(key) || (patch as Record<string, unknown>)[key] === undefined)) {
    refused('This edit contains missing or unsupported fields.')
  }
}
const boardKeys = ['name', 'description', 'isLocked']
const columnKeys = ['name', 'description', 'color', 'index', 'visible']
const noteKeys = ['text', 'column_id', 'stack_id', 'rank', 'edited', 'votes']

async function currentBoard(md: HouseRuntime, board: Board, allowLocked = false, markdown = false) {
  const documents = await md.query({ ...retroQuery, rooms: [board.room], select: { fields: 'all', change: true, ...(markdown ? { markdown: true as const } : {}) } })
  const data = readRetro(documents)
  const current = data.boards.find((row) => row.room === board.room && row.path === board.path && row.id === board.id)
  if (!current) return refused('This board no longer exists at its opened location. Reload before editing.', board)
  if (!allowLocked && (board.isLocked || current.isLocked)) return refused('This board is locked. Unlock it before changing its columns or notes.', current)
  const columns = columnsFor(data, current)
  const notes = notesFor(data, current)
  const votes = votesFor(data, current)
  validateReferences({ board: current, columns, notes, votes })
  return { board: current, columns, notes, votes, documents }
}
function member<T extends Column | Note>(board: Board, row: T, rows: readonly T[]): T {
  if (!sameBoard(row, board)) return refused('This item belongs to a different board or Room.', row)
  const current = rows.find((item) => item.room === row.room && item.path === row.path && item.id === row.id)
  if (!current) return refused('This item has moved or was deleted. Reload before editing.', row)
  return current
}
function sameFields(row: RetroRow, current: Document): boolean {
  const fields = rowFields(row)
  return Object.entries(fields).every(([key, value]) => current.fields?.[key] === storedValue(key, value))
    // Missing optional stack_id has a distinct field base from an empty string.
    && (!('column_id' in row) || current.fields?.stack_id === row.stack_id)
}
function removeChange(row: RetroRow, documents: RetroResult): Change {
  const current = documents.documents.find((document) => document.room === row.room && document.path === row.path)
  if (!current || typeof current.markdown !== 'string' || !sameFields(row, current)) {
    return refused('An item changed since you opened it. Reload and review it before deleting.', current ?? null)
  }
  return { path: row.path, parts: { removal: { base: current.markdown } } }
}
function exactMembers<T extends Column | Note | Vote>(opened: readonly T[], current: readonly T[]): void {
  if (opened.length !== current.length || current.some((row) => !opened.some((old) => old.path === row.path && old.room === row.room && old.id === row.id))) {
    refused('This board has added, moved, or removed items. Reload and review them before deleting.', current)
  }
}

export async function createBoard(md: HouseRuntime, room: string, name: string, columns: readonly ColumnInput[] = DEFAULT_COLUMNS, description = ''): Promise<QueuedWrite & { board: Board }> {
  idField(room, 'Room')
  const board: Board = { ...validateBoard({ id: identity('board'), name, description, isLocked: false }), room, path: '' }
  board.path = boardPath(board.id)
  const rows = columns.map((input, index): Column => {
    const fields = validateColumn({ id: identity('column'), board_id: board.id, name: input.name, description: input.description ?? '', color: input.color ?? 'backlog-blue', index: input.index ?? index, visible: input.visible ?? true })
    return { ...fields, room, path: columnPath(board.id, fields.id) }
  })
  const queued = await queueChanges(md, room, [creation('retro_board', board), ...rows.map((row) => creation('retro_column', row))])
  return { ...queued, board }
}
export async function updateBoard(md: HouseRuntime, board: Board, patch: BoardPatch): Promise<QueuedWrite> {
  checkPatch(patch, boardKeys)
  validateBoard({ ...board, ...patch })
  await currentBoard(md, board, true)
  return queueChanges(md, board.room, [fieldChange(board, patch)])
}
export async function createColumn(md: HouseRuntime, board: Board, input: ColumnInput): Promise<QueuedWrite & { column: Column }> {
  const current = await currentBoard(md, board)
  const fields = validateColumn({ id: identity('column'), board_id: board.id, name: input.name, description: input.description ?? '', color: input.color ?? 'backlog-blue', index: input.index ?? Math.max(-1, ...current.columns.map((column) => column.index)) + 1, visible: input.visible ?? true })
  const column: Column = { ...fields, room: board.room, path: columnPath(board.id, fields.id) }
  return { ...await queueChanges(md, board.room, [creation('retro_column', column)]), column }
}
export async function updateColumn(md: HouseRuntime, board: Board, column: Column, patch: ColumnPatch): Promise<QueuedWrite> {
  checkPatch(patch, columnKeys); validateColumn({ ...column, ...patch })
  const current = await currentBoard(md, board); member(board, column, current.columns)
  return queueChanges(md, board.room, [fieldChange(column, patch)])
}
/** Reindex the caller's complete ordered column snapshot in a single Room save. */
export async function reorderColumns(md: HouseRuntime, board: Board, columns: readonly Column[]): Promise<QueuedWrite> {
  const current = await currentBoard(md, board)
  exactMembers(columns, current.columns)
  const changes: Change[] = []
  columns.forEach((column, index) => {
    member(board, column, current.columns)
    if (column.index !== index) changes.push(fieldChange(column, { index }))
  })
  if (!changes.length) return refused('The columns are already in this order.')
  return queueChanges(md, board.room, changes)
}
/** Position bases come from the opened drag snapshot, never a freshly rebased row. */
function assertPosition(opened: Note, current: Note): void {
  if (opened.column_id !== current.column_id || opened.stack_id !== current.stack_id || opened.rank !== current.rank) {
    refused('A note moved or changed grouping during this gesture. Reload and try again.', current)
  }
}
function positionPatch(note: Note, patch: NotePatch): NotePatch {
  return { column_id: note.column_id, stack_id: note.stack_id ?? '', rank: note.rank, ...patch }
}
/** Reorder every root in this column; child ranks and stack membership are kept. */
export async function reorderNotes(md: HouseRuntime, board: Board, column: Column, notes: readonly Note[]): Promise<QueuedWrite> {
  const current = await currentBoard(md, board)
  member(board, column, current.columns)
  const roots = current.notes.filter((note) => note.column_id === column.id && !note.stack_id)
  exactMembers(notes, roots)
  for (const note of notes) {
    const row = member(board, note, roots)
    if (note.column_id !== column.id || note.stack_id) refused('Only root notes from this column can be reordered.')
    assertPosition(note, row)
  }
  if (notes.every((note, index) => note.rank === notes.length - index)) return refused('The notes are already in this order.')
  // Guard column/stack as well as rank, including unchanged rows. A cross-tab move
  // after preflight must be refused by exact stored bases rather than rebased.
  return queueChanges(md, board.room, notes.map((note, index) => fieldChange(note, positionPatch(note, { rank: notes.length - index }))))
}

export async function createNote(md: HouseRuntime, board: Board, column: Column, text: string): Promise<QueuedWrite & { note: Note }> {
  const current = await currentBoard(md, board); member(board, column, current.columns)
  const fields = validateNote({ id: identity('note'), board_id: board.id, text, column_id: column.id, stack_id: '', rank: Math.max(0, ...current.notes.filter((note) => note.column_id === column.id).map((note) => note.rank)) + 1, edited: false, votes: 0 })
  const note: Note = { ...fields, room: board.room, path: notePath(board.id, fields.id), lastEditedBy: null }
  return { ...await queueChanges(md, board.room, [creation('retro_note', note)]), note }
}
/** Each explicit click adds one immutable vote. Current-user identity is unavailable. */
export async function addVote(md: HouseRuntime, board: Board, note: Note): Promise<QueuedWrite & { vote: Vote }> {
  const current = await currentBoard(md, board)
  member(board, note, current.notes)
  const fields = validateVote({ id: identity('vote'), board_id: board.id, note_id: note.id })
  const vote: Vote = { ...fields, room: board.room, path: votePath(board.id, fields.id), author: null }
  return { ...await queueChanges(md, board.room, [creation('retro_vote', vote)]), vote }
}
async function updateNotes(md: HouseRuntime, board: Board, updates: { note: Note; patch: NotePatch }[]): Promise<QueuedWrite> {
  const current = await currentBoard(md, board)
  const next = new Map(current.notes.map((note) => [note.id, note]))
  for (const { note, patch } of updates) {
    checkPatch(patch, noteKeys)
    const row = member(board, note, current.notes)
    validateNote({ ...note, ...patch })
    next.set(note.id, { ...row, ...patch })
  }
  validateReferences({ board: current.board, columns: current.columns, notes: [...next.values()] })
  return queueChanges(md, board.room, updates.map(({ note, patch }) => fieldChange(note, patch)))
}
export async function updateNote(md: HouseRuntime, board: Board, note: Note, patch: NotePatch): Promise<QueuedWrite> {
  const changes = { ...patch, ...(patch.text !== undefined ? { edited: true } : {}) }
  return updateNotes(md, board, [{ note, patch: changes }])
}
/** Move a root and children together; optional complete order places a drag drop. */
export async function moveNote(md: HouseRuntime, board: Board, note: Note, column: Column, notes: readonly Note[], orderedRoots?: readonly Note[]): Promise<QueuedWrite> {
  const current = await currentBoard(md, board)
  member(board, column, current.columns)
  assertPosition(note, member(board, note, current.notes))
  const children = note.stack_id ? [] : notes.filter((row) => sameBoard(row, board) && row.stack_id === note.id)
  const currentChildren = note.stack_id ? [] : current.notes.filter((row) => row.stack_id === note.id)
  exactMembers(children, currentChildren)
  for (const child of children) assertPosition(child, member(board, child, currentChildren))
  if (!orderedRoots) {
    const rank = Math.max(0, ...current.notes.filter((row) => row.column_id === column.id).map((row) => row.rank)) + 1
    return updateNotes(md, board, [
      { note, patch: positionPatch(note, { column_id: column.id, stack_id: '', rank }) },
      ...children.map((child) => ({ note: child, patch: positionPatch(child, { column_id: column.id }) })),
    ])
  }
  if (note.stack_id) return refused('A dragged root order cannot contain a stack child.')
  const targetRoots = current.notes.filter((row) => row.column_id === column.id && !row.stack_id && row.id !== note.id)
  exactMembers(orderedRoots.filter((row) => row.id !== note.id), targetRoots)
  if (orderedRoots.filter((row) => row.id === note.id).length !== 1 || new Set(orderedRoots.map((row) => row.id)).size !== orderedRoots.length) return refused('The drag order must contain each root exactly once.')
  for (const row of orderedRoots) {
    assertPosition(row, member(board, row, current.notes))
    if (row.stack_id || (row.id !== note.id && row.column_id !== column.id)) return refused('The drag order contains a note from another column or stack.')
  }
  return updateNotes(md, board, [
    ...orderedRoots.map((row, index) => ({ note: row, patch: positionPatch(row, { column_id: column.id, stack_id: '', rank: orderedRoots.length - index }) })),
    ...children.map((child) => ({ note: child, patch: positionPatch(child, { column_id: column.id }) })),
  ])
}
/** Drop onto a root in either column; flatten the selected stack in one Save. */
export async function groupNotes(md: HouseRuntime, board: Board, parent: Note, notes: readonly Note[]): Promise<QueuedWrite> {
  const current = await currentBoard(md, board)
  const root = member(board, parent, current.notes)
  assertPosition(parent, root)
  if (parent.stack_id || root.stack_id) return refused('The stack target must be a root note.')
  if (!notes.length) return refused('Select at least one note to group.')
  const updates = new Map<string, { note: Note; patch: NotePatch }>()
  for (const note of notes) {
    assertPosition(note, member(board, note, current.notes))
    if (note.id === parent.id) return refused('A note cannot be grouped beneath itself.')
    updates.set(note.id, { note, patch: positionPatch(note, { stack_id: parent.id, column_id: parent.column_id, rank: parent.rank }) })
    const children = current.notes.filter((child) => child.stack_id === note.id)
    for (const child of children) {
      const opened = notes.find((row) => row.id === child.id && row.path === child.path && row.room === child.room)
      if (!opened) return refused('Select the notes in this stack too, then group again.')
      assertPosition(opened, child)
      updates.set(child.id, { note: opened, patch: positionPatch(opened, { stack_id: parent.id, column_id: parent.column_id, rank: parent.rank }) })
    }
  }
  if (!updates.size) return refused('Select another note to group with this one.')
  // The target's unchanged position is an explicit base guard in the same Save.
  // This is not an author/identity probe; it makes this grouping conditional on
  // the target remaining a root in the destination column after preflight.
  updates.set(parent.id, { note: parent, patch: positionPatch(parent, {}) })
  return updateNotes(md, board, [...updates.values()])
}

export async function unstackNote(md: HouseRuntime, board: Board, note: Note): Promise<QueuedWrite> {
  return updateNote(md, board, note, { stack_id: '' })
}

export async function deleteNote(md: HouseRuntime, board: Board, note: Note, data: RetroData): Promise<QueuedWrite> {
  const current = await currentBoard(md, board, false, true); member(board, note, current.notes)
  const children = notesFor(data, board).filter((row) => row.stack_id === note.id)
  exactMembers(children, current.notes.filter((row) => row.stack_id === note.id))
  const noteIds = new Set([note.id, ...children.map((child) => child.id)])
  const votes = votesFor(data, board).filter((vote) => noteIds.has(vote.note_id))
  exactMembers(votes, current.votes.filter((vote) => noteIds.has(vote.note_id)))
  return queueChanges(md, board.room, [note, ...children, ...votes].map((row) => removeChange(row, current.documents)))
}
export async function deleteColumn(md: HouseRuntime, board: Board, column: Column, data: RetroData): Promise<QueuedWrite> {
  const current = await currentBoard(md, board, false, true); member(board, column, current.columns)
  const notes = notesFor(data, board).filter((note) => note.column_id === column.id)
  exactMembers(notes, current.notes.filter((note) => note.column_id === column.id))
  const noteIds = new Set(notes.map((note) => note.id))
  const votes = votesFor(data, board).filter((vote) => noteIds.has(vote.note_id))
  exactMembers(votes, current.votes.filter((vote) => noteIds.has(vote.note_id)))
  return queueChanges(md, board.room, [column, ...notes, ...votes].map((row) => removeChange(row, current.documents)))
}
export async function deleteBoard(md: HouseRuntime, board: Board, data: RetroData): Promise<QueuedWrite> {
  const current = await currentBoard(md, board, true, true)
  const columns = columnsFor(data, board); const notes = notesFor(data, board)
  const votes = votesFor(data, board)
  exactMembers(columns, current.columns); exactMembers(notes, current.notes); exactMembers(votes, current.votes)
  return queueChanges(md, board.room, [board, ...columns, ...notes, ...votes].map((row) => removeChange(row, current.documents)))
}
/** Import never reuses source IDs or paths, and is saved as one Room change batch. */
export async function importBoard(md: HouseRuntime, room: string, input: ImportedBoard): Promise<QueuedWrite & { board: Board }> {
  idField(room, 'Room')
  const source = validateReferences({ board: validateBoard(input.board), columns: input.columns.map(validateColumn), notes: input.notes.map(validateNote) })
  const boardId = identity('board')
  const board: Board = { ...source.board, id: boardId, room, path: boardPath(boardId) }
  const columnIds = new Map(source.columns.map((column) => [column.id, identity('column')]))
  const noteIds = new Map(source.notes.map((note) => [note.id, identity('note')]))
  const columns: Column[] = source.columns.map((row) => {
    const id = columnIds.get(row.id)!
    return { ...row, id, board_id: boardId, room, path: columnPath(boardId, id) }
  })
  const notes: Note[] = source.notes.map((row) => {
    const id = noteIds.get(row.id)!
    return { ...row, id, board_id: boardId, column_id: columnIds.get(row.column_id)!, stack_id: row.stack_id ? noteIds.get(row.stack_id)! : '', room, path: notePath(boardId, id), lastEditedBy: null }
  })
  const queued = await queueChanges(md, room, [creation('retro_board', board), ...columns.map((row) => creation('retro_column', row)), ...notes.map((row) => creation('retro_note', row))])
  return { ...queued, board }
}

/** Notes are typed into their actual business-document Room Draft, entirely locally. */
export async function openNoteDraft(md: HouseRuntime, board: Board, target: {column: Column} | {note: Note}) {
  const note = 'note' in target ? target.note : undefined;
  const column = 'column' in target ? target.column : undefined;
  const scope = `${board.room}/${board.id}/${column?.id ?? note?.id}`;
  const state = await md.presentation.read();
  const pointers = state && typeof state === 'object' && 'noteDrafts' in state ? (state as {noteDrafts: Record<string, string>}).noteDrafts : {};
  const pointed = !note && typeof pointers?.[scope] === 'string' ? pointers[scope] : '';
  const openedPath = note?.path ?? pointed;
  let draft = openedPath ? await md.roomDraft.read(board.room, openedPath) : null;
  // A saved creation can later have its own edit draft. That is no longer the
  // column's new-note form; leave it intact and allocate the next note path.
  if (!note && draft && !draft.parts.creation) draft = null;
  const current = await currentBoard(md, board, true);
  const id = note?.id ?? identity('note');
  const path = note?.path ?? draft?.path ?? notePath(board.id, id);
  const initialFields: Record<string, unknown> = {id, board_id: board.id, column_id: column?.id ?? note?.column_id, text: '', stack_id: '', rank: Math.max(0, ...current.notes.filter(row => row.column_id === column?.id).map(row => row.rank)) + 1, edited: 'false', votes: 0};
  type Draft = NonNullable<typeof draft>;
  function textOf(value: Draft | null): string {
    const creation = value?.parts.creation;
    if (!note && creation) {
      if (!('fields' in creation) || creation.type !== 'retro_note' || creation.fields.board_id !== board.id || creation.fields.column_id !== column?.id) throw new Error('The note draft does not belong to this column. It has been kept.');
      return String(creation.fields.text ?? '');
    }
    return String(value?.parts.fields?.text?.value ?? note?.text ?? '');
  }
  let persisted = textOf(draft);
  let pending: string | undefined;
  let serial = Promise.resolve();
  const listeners = new Set<(text: string) => void>();
  const text = () => pending ?? persisted;
  const redraw = () => {for (const listener of listeners) listener(text());};
  const observation = await md.observe('room-drafts');
  const accept = (values: readonly Draft[]) => {
    const next = values.find(value => value.room === board.room && value.path === path);
    if (!next) return;
    draft = next; persisted = textOf(next); redraw();
  };
  accept(observation.current());
  const unsubscribe = observation.subscribe(accept);
  const write = (value: string) => {
    pending = value;
    const next = serial.then(async () => {
      let latest = await md.roomDraft.read(board.room, path);
      for (;;) {
        const input = pending ?? value;
        let parts: DraftParts;
        if (note) {
          parts = {...latest?.parts, fields: {...latest?.parts.fields, text: {value: input, base: {value: note.text}}, edited: {value: 'true', base: {value: String(note.edited)}}}};
        } else {
          textOf(latest);
          const creation = latest?.parts.creation;
          const fields = creation && 'fields' in creation ? creation.fields : initialFields;
          parts = {...latest?.parts, creation: {type: 'retro_note', fields: {...fields, text: input}, sections: {}}};
        }
        const result = await md.roomDraft.write(board.room, path, latest?.revision ?? null, parts);
        if (result.outcome === 'stale') {latest = result.current; continue;}
        if (!result.roomDraft) throw new Error('The local note draft is unavailable.');
        draft = result.roomDraft; persisted = textOf(draft);
        if (pending === input) pending = undefined;
        redraw();
        if (!note) {
          const value = await md.presentation.read();
          const base = value && typeof value === 'object' ? value as Record<string, unknown> : {};
          const held = base.noteDrafts && typeof base.noteDrafts === 'object' ? base.noteDrafts as Record<string, string> : {};
          await md.presentation.write({...base, noteDrafts: {...held, [scope]: path}});
        }
        return;
      }
    });
    serial = next.catch(() => undefined);
    return next;
  };
  return {
    text,
    write,
    subscribe(listener: (value: string) => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    close() {unsubscribe(); observation.close();},
    async save(value: string): Promise<QueuedWrite> {
      await write(value);
      const latest = await md.roomDraft.read(board.room, path);
      if (!latest) throw new Error('This note draft was already saved in another tab.');
      const fresh = await currentBoard(md, {...board, isLocked: false});
      if (note) {
        const visible = member(board, note, fresh.notes);
        validateNote({...visible, text: textOf(latest), edited: true});
      } else {
        if (!column) throw new Error('The note column is missing.');
        member(board, column, fresh.columns);
        const creation = latest.parts.creation;
        if (!creation || !('fields' in creation)) throw new Error('The note creation draft is missing.');
        validateNote(modelFields({room: board.room, path, fields: creation.fields}));
      }
      const result = await md.save(board.room, [{path, revision: latest.revision}]);
      if (result.outcome !== 'saved') throw new Error(`House did not queue the note: ${result.code}. Its Room Draft is kept.`);
      return {outcome: 'queued', identifier: result.identifier};
    },
  };
}
export type NoteDraftSession = Awaited<ReturnType<typeof openNoteDraft>>;
