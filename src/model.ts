/** Portable retrospective data. Runtime access is deliberately confined to house.ts. */
export const MAX_NOTE_LENGTH = 2048
export const MAX_NAME_LENGTH = 128
export const MAX_DESCRIPTION_LENGTH = 1024
export const COLORS = ['backlog-blue', 'planning-pink', 'poker-purple', 'value-violet', 'goal-green', 'yielding-yellow', 'online-orange'] as const
export type Color = typeof COLORS[number]
export type Location = { room: string; path: string }
/** Provider-recorded head author, never the identity of the current app user. */
export type Attribution = { kind: 'user' | 'site'; id: string; name: string }
export type BoardFields = { id: string; name: string; description: string; isLocked: boolean }
export type ColumnFields = { id: string; board_id: string; name: string; description: string; color: Color; index: number; visible: boolean }
export type NoteFields = { id: string; board_id: string; text: string; column_id: string; stack_id?: string; rank: number; edited: boolean; votes: number }
export type VoteFields = { id: string; board_id: string; note_id: string }
export type Board = BoardFields & Location
export type Column = ColumnFields & Location
export type Note = NoteFields & Location & { lastEditedBy?: Attribution | null }
/** One immutable document per explicit vote. Author arrives from Provider metadata. */
export type Vote = VoteFields & Location & { author?: Attribution | null }
export type RetroData = { boards: Board[]; columns: Column[]; notes: Note[]; votes: Vote[] }
export type ImportedBoard = { board: BoardFields; columns: ColumnFields[]; notes: NoteFields[] }
export type ColumnInput = { name: string; description?: string; color?: Color; index?: number; visible?: boolean }
export const DEFAULT_COLUMNS: ColumnInput[] = [
  { name: 'Went well', description: 'What should we keep doing?', color: 'backlog-blue', index: 0, visible: true },
  { name: 'To improve', description: 'What could be better?', color: 'poker-purple', index: 1, visible: true },
  { name: 'Action items', description: 'What will we try next?', color: 'planning-pink', index: 2, visible: true },
]

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function textField(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) {
    throw new Error(`${label} must be ${empty ? 'text' : 'nonempty text'} of at most ${max} characters.`)
  }
  return value
}
export function idField(value: unknown, label = 'ID'): string {
  return textField(value, label, 256)
}
function booleanField(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`)
  return value
}
function numericField(value: unknown, label: string, integer = false, nonnegative = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || (nonnegative && value < 0)) {
    throw new Error(`${label} must be a finite${nonnegative ? ' nonnegative' : ''}${integer ? ' integer' : ' number'}.`)
  }
  return value
}
function fields(value: unknown, label: string): Record<string, unknown> {
  if (!record(value)) throw new Error(`${label} must be an object.`)
  return value
}
export function validateBoard(value: unknown): BoardFields {
  const row = fields(value, 'Board')
  return {
    id: idField(row.id, 'Board ID'), name: textField(row.name, 'Board name', MAX_NAME_LENGTH),
    description: textField(row.description, 'Board description', MAX_DESCRIPTION_LENGTH, true),
    isLocked: booleanField(row.isLocked, 'Board lock'),
  }
}
export function validateColumn(value: unknown): ColumnFields {
  const row = fields(value, 'Column')
  if (!COLORS.includes(row.color as Color)) throw new Error('Column color is not supported.')
  return {
    id: idField(row.id, 'Column ID'), board_id: idField(row.board_id, 'Column board ID'),
    name: textField(row.name, 'Column name', MAX_NAME_LENGTH),
    description: textField(row.description, 'Column description', MAX_DESCRIPTION_LENGTH, true),
    color: row.color as Color, index: numericField(row.index, 'Column index', true, true),
    visible: booleanField(row.visible, 'Column visibility'),
  }
}
export function validateNote(value: unknown): NoteFields {
  const row = fields(value, 'Note')
  const stack_id = row.stack_id === undefined ? undefined : textField(row.stack_id, 'Note stack ID', 256, true)
  return {
    id: idField(row.id, 'Note ID'), board_id: idField(row.board_id, 'Note board ID'),
    text: textField(row.text, 'Note text', MAX_NOTE_LENGTH), column_id: idField(row.column_id, 'Note column ID'),
    ...(stack_id === undefined ? {} : { stack_id }), rank: numericField(row.rank, 'Note rank'),
    edited: booleanField(row.edited, 'Note edited state'), votes: numericField(row.votes, 'Priority votes', true, true),
  }
}
export function validateVote(value: unknown): VoteFields {
  const row = fields(value, 'Vote')
  return { id: idField(row.id, 'Vote ID'), board_id: idField(row.board_id, 'Vote board ID'), note_id: idField(row.note_id, 'Vote note ID') }
}
export function sameBoard(row: { room: string; board_id: string }, board: Board): boolean {
  return row.room === board.room && row.board_id === board.id
}
export function columnsFor(data: RetroData, board: Board): Column[] {
  return data.columns.filter((column) => sameBoard(column, board)).sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))
}
export function notesFor(data: RetroData, board: Board): Note[] {
  return data.notes.filter((note) => sameBoard(note, board)).sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id))
}
export function notesForColumn(data: RetroData, board: Board, column: Column): Note[] {
  return notesFor(data, board).filter((note) => note.column_id === column.id)
}

export function votesFor(data: RetroData, board: Board): Vote[] {
  return data.votes.filter((vote) => sameBoard(vote, board)).sort((a, b) => a.id.localeCompare(b.id))
}
export function votesForNote(data: RetroData, board: Board, note: Note): Vote[] {
  if (!sameBoard(note, board)) return []
  return votesFor(data, board).filter((vote) => vote.note_id === note.id)
}

/** Flat stacks have one root in the same column. No cycles or cross-board links. */
export function validateReferences<T extends ImportedBoard & { votes?: readonly VoteFields[] }>(value: T): T {
  const columns = new Map<string, ColumnFields>()
  for (const column of value.columns) {
    if (columns.has(column.id)) throw new Error('Board contains duplicate column IDs.')
    if (column.board_id !== value.board.id) throw new Error('Column refers to a different board.')
    columns.set(column.id, column)
  }
  const notes = new Map<string, NoteFields>()
  for (const note of value.notes) {
    if (notes.has(note.id)) throw new Error('Board contains duplicate note IDs.')
    if (note.board_id !== value.board.id) throw new Error('Note refers to a different board.')
    if (!columns.has(note.column_id)) throw new Error('Note refers to a missing column.')
    notes.set(note.id, note)
  }
  for (const note of value.notes) {
    if (!note.stack_id) continue
    const root = notes.get(note.stack_id)
    if (!root || root.id === note.id || root.stack_id || root.column_id !== note.column_id) {
      throw new Error('Note stack must refer to another root note in the same column.')
    }
  }
  const votes = new Set<string>()
  for (const vote of value.votes ?? []) {
    if (votes.has(vote.id)) throw new Error('Board contains duplicate vote IDs.')
    if (vote.board_id !== value.board.id) throw new Error('Vote refers to a different board.')
    if (!notes.has(vote.note_id)) throw new Error('Vote refers to a missing note.')
    votes.add(vote.id)
  }
  return value
}

function safeJson(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error('Imported board JSON is nested too deeply.')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) { value.forEach((item) => safeJson(item, depth + 1)); return }
  if (record(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`Imported board contains an unsafe property: ${key}.`)
      safeJson(item, depth + 1)
    }
    return
  }
  throw new Error('Imported board must contain only JSON values.')
}
/** Accept this app's export and donor scrumlr board exports, without user identities. */
export function parseImport(text: string): ImportedBoard {
  if (text.length > 5_000_000) throw new Error('Imported board is too large (5 MB maximum).')
  let value: unknown
  try { value = JSON.parse(text) } catch (cause) { throw new Error('The file is not valid board JSON.', { cause }) }
  safeJson(value)
  const data = fields(value, 'Imported board')
  if (data.format !== undefined && data.format !== 'house-retro-board') throw new Error('Unsupported board export format.')
  if (data.version !== undefined && data.version !== 1) throw new Error('Unsupported board export version.')
  const boardInput = fields(data.board, 'Imported board details')
  const board = validateBoard({ ...boardInput, name: boardInput.name ?? 'Untitled retrospective', description: boardInput.description ?? '', isLocked: boardInput.isLocked ?? false })
  if (!Array.isArray(data.columns) || !Array.isArray(data.notes)) throw new Error('Imported board requires columns and notes arrays.')
  if (data.columns.length > 100 || data.notes.length > 5000) throw new Error('Imported board exceeds 100 columns or 5,000 notes.')
  const columns = data.columns.map((input) => {
    const row = fields(input, 'Imported column')
    return validateColumn({ ...row, board_id: row.board_id ?? board.id, description: row.description ?? '', visible: row.visible ?? true })
  })
  const voteTotals = data.voteTotals === undefined ? {} : fields(data.voteTotals, 'Exported vote totals')
  for (const total of Object.values(voteTotals)) numericField(total, 'Exported vote total', true, true)
  const notes = data.notes.map((input) => {
    const row = fields(input, 'Imported note')
    const position = row.position === undefined ? {} : fields(row.position, 'Note position')
    return validateNote({
      ...row, board_id: row.board_id ?? board.id, column_id: row.column_id ?? position.column,
      stack_id: row.stack_id ?? position.stack ?? '', rank: row.rank ?? position.rank,
      edited: row.edited ?? false, votes: numericField(row.votes ?? 0, 'Legacy vote total', true, true) + numericField(Object.hasOwn(voteTotals, idField(row.id)) ? voteTotals[idField(row.id)] : 0, 'Exported vote total', true, true),
    })
  })
  const noteIds = new Set(notes.map((note) => note.id))
  if (Object.keys(voteTotals).some((id) => !noteIds.has(id))) throw new Error('Exported vote total refers to a missing note.')
  return validateReferences({ board, columns, notes })
}

export function exportBoard(data: RetroData, board: Board): string {
  const portable = validateReferences({
    board: validateBoard(board), columns: columnsFor(data, board).map(validateColumn), notes: notesFor(data, board).map(validateNote),
  })
  const votes = votesFor(data, board)
  validateReferences({ ...portable, votes: votes.map(validateVote) })
  // Portable totals carry no identities and do not recreate attributed votes.
  const voteTotals: Record<string, number> = Object.create(null) as Record<string, number>
  for (const vote of votes) voteTotals[vote.note_id] = (voteTotals[vote.note_id] ?? 0) + 1
  return JSON.stringify({ format: 'house-retro-board', version: 1, ...portable, ...(votes.length ? { voteTotals } : {}) }, null, 2)
}
