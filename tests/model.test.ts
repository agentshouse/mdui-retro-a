import { describe, expect, it } from 'vitest'
import { COLORS, MAX_NOTE_LENGTH, columnsFor, notesFor, exportBoard, parseImport, validateNote, validateVote, validateReferences, votesFor, votesForNote, type Board, type Column, type Note, type ImportedBoard, type Vote } from '../src/model'

const board: Board = { id: 'b', name: 'Retro', description: 'A team retrospective', isLocked: false, room: 'one', path: 'retros/b/board.md' }
const column: Column = { id: 'c', board_id: 'b', name: 'Went well', description: '', color: 'backlog-blue', index: 0, visible: true, room: 'one', path: 'retros/b/columns/c.md' }
const note: Note = { id: 'n', board_id: 'b', text: 'Shipped together', column_id: 'c', stack_id: '', rank: 1, edited: false, votes: 0, room: 'one', path: 'retros/b/notes/n.md' }
const data = { boards: [board], columns: [column], notes: [note], votes: [] }
const portable = (): ImportedBoard => JSON.parse(exportBoard(data, board))

describe('portable retrospective data', () => {
  it('round-trips board content without Room paths, identities, or fake voters', () => {
    const text = exportBoard(data, board)
    expect(text).not.toContain('retros/b')
    expect(text).not.toContain('"room"')
    expect(text).not.toContain('participants')
    expect(text).not.toContain('author')
    const parsed = parseImport(text)
    expect(parsed.board.name).toBe(board.name)
    expect(parsed.notes[0].votes).toBe(0)
    expect(parsed.notes[0].text).toBe(note.text)
  })
  it('reads donor scrumlr JSON notes and ignores author/participant data', () => {
    const parsed = parseImport(JSON.stringify({
      board: { id: 'b', name: 'Imported' }, columns: [column],
      notes: [{ id: 'n', author: 'someone', text: 'Donor note', position: { column: 'c', stack: null, rank: 2 }, edited: false }],
      participants: [{ id: 'someone', user: { name: 'A person' } }], votings: [{ participants: ['someone'] }],
    }))
    expect(parsed.board).toEqual({ id: 'b', name: 'Imported', description: '', isLocked: false })
    expect(parsed.notes[0]).toEqual({ id: 'n', board_id: 'b', text: 'Donor note', column_id: 'c', stack_id: '', rank: 2, edited: false, votes: 0 })
    expect(parsed).not.toHaveProperty('participants')
  })
  it('allows donor-length notes and rejects longer, blank, non-string notes', () => {
    expect(validateNote({ ...note, text: 'x'.repeat(MAX_NOTE_LENGTH) }).text).toHaveLength(2048)
    for (const text of ['x'.repeat(MAX_NOTE_LENGTH + 1), '  ', 7, null]) {
      expect(() => validateNote({ ...note, text })).toThrow(/Note text/)
    }
  })
  it('requires finite rank, nonnegative integer vote totals, boolean flags, and known colors', () => {
    for (const votes of [-1, 0.5, Infinity, '1']) expect(() => validateNote({ ...note, votes })).toThrow(/Priority votes/)
    expect(() => validateNote({ ...note, rank: NaN })).toThrow(/rank/)
    expect(() => validateNote({ ...note, edited: 'false' })).toThrow(/edited/)
    const input = portable(); input.columns[0].color = 'url(javascript:bad)' as typeof COLORS[number]
    expect(() => parseImport(JSON.stringify(input))).toThrow(/color/)
  })
  it('rejects broken JSON and unsupported versions', () => {
    expect(() => parseImport('{bad')).toThrow(/not valid/)
    expect(() => parseImport(JSON.stringify({ ...portable(), version: 99 }))).toThrow(/version/)
    expect(() => parseImport(JSON.stringify({ ...portable(), format: 'unknown' }))).toThrow(/format/)
  })
  it('rejects unsafe keys, deep nesting, and excessive file size', () => {
    expect(() => parseImport('{"__proto__":{"polluted":true}}')).toThrow(/unsafe/)
    expect(() => parseImport(' '.repeat(5_000_001))).toThrow(/too large/)
    let deep: unknown = null
    for (let i = 0; i < 35; i++) deep = { child: deep }
    expect(() => parseImport(JSON.stringify(deep))).toThrow(/nested too deeply/)
  })
  it('rejects duplicate, cross-board, and dangling references', () => {
    const duplicate = portable(); duplicate.notes.push({ ...duplicate.notes[0] })
    expect(() => validateReferences(duplicate)).toThrow(/duplicate note/)
    const columns = portable(); columns.columns.push({ ...columns.columns[0] })
    expect(() => validateReferences(columns)).toThrow(/duplicate column/)
    const otherBoard = portable(); otherBoard.notes[0].board_id = 'missing'
    expect(() => validateReferences(otherBoard)).toThrow(/different board/)
    const missing = portable(); missing.notes[0].column_id = 'missing'
    expect(() => validateReferences(missing)).toThrow(/missing column/)
  })
  it('validates flat stacks in the same column and rejects cycles or chains', () => {
    const input = portable(); input.notes.push({ ...input.notes[0], id: 'child', stack_id: 'n' })
    expect(validateReferences(input).notes).toHaveLength(2)
    input.notes[0].stack_id = 'child'
    expect(() => validateReferences(input)).toThrow(/root note/)
    input.notes[0].stack_id = 'n'
    expect(() => validateReferences(input)).toThrow(/root note/)
    input.notes[0].stack_id = ''
    input.notes[1].stack_id = 'missing'
    expect(() => validateReferences(input)).toThrow(/root note/)
  })
  it('keeps equal board IDs from other Rooms out of the selected board', () => {
    const combined = { ...data, columns: [column, { ...column, room: 'two' }], notes: [note, { ...note, room: 'two' }] }
    expect(columnsFor(combined, board)).toEqual([column])
    expect(notesFor(combined, board)).toEqual([note])
  })
  it('orders columns by index and notes with descending donor rank', () => {
    const combined = { ...data, columns: [{ ...column, id: 'later', index: 2 }, column], notes: [note, { ...note, id: 'top', rank: 8 }] }
    expect(columnsFor(combined, board).map((row) => row.id)).toEqual(['c', 'later'])
    expect(notesFor(combined, board).map((row) => row.id)).toEqual(['top', 'n'])
  })
})

describe('vote records and identity-free exports', () => {
  const author = { kind: 'user' as const, id: 'real-writer', name: 'A writer' }
  const vote: Vote = { id: 'v', board_id: board.id, note_id: note.id, room: board.room, path: 'retros/b/votes/v.md', author }
  it('counts only same-Room same-board vote documents independently of the legacy field', () => {
    const other: Vote = { ...vote, id: 'elsewhere', room: 'two' }
    const current = { ...data, notes: [{ ...note, votes: 10 }], votes: [vote, other] }
    expect(votesFor(current, board)).toEqual([vote])
    expect(votesForNote(current, board, note)).toEqual([vote])
    expect(votesForNote(current, board, { ...note, room: 'two' })).toEqual([])
    expect(current.notes[0].votes).toBe(10)
  })
  it('keeps note and vote attribution out of exports and preserves counts as legacy history on import', () => {
    const current = { ...data, notes: [{ ...note, votes: 2, lastEditedBy: author }], votes: [vote, { ...vote, id: 'v2', path: 'retros/b/votes/v2.md' }] }
    const text = exportBoard(current, board)
    expect(JSON.parse(text).voteTotals).toEqual({ n: 2 })
    expect(text).not.toContain('real-writer')
    expect(text).not.toContain('lastEditedBy')
    expect(text).not.toContain('"author"')
    expect(text).not.toContain('retros/b/votes')
    const imported = parseImport(text)
    expect(imported.notes[0].votes).toBe(4)
    expect(imported).not.toHaveProperty('votes')
    expect(imported.notes[0]).not.toHaveProperty('lastEditedBy')
    const reexport = { boards: [{ ...imported.board, room: 'one', path: board.path }], columns: imported.columns.map((row) => ({ ...row, room: 'one', path: column.path })), notes: imported.notes.map((row) => ({ ...row, room: 'one', path: note.path })), votes: [] }
    expect(parseImport(exportBoard(reexport, reexport.boards[0])).notes[0].votes).toBe(4)
  })
  it('ignores claimed author properties and copied vote documents in an import', () => {
    const input = { ...portable(), votes: [vote], notes: [{ ...note, author, lastEditedBy: author }] }
    const imported = parseImport(JSON.stringify(input))
    expect(imported.notes[0]).not.toHaveProperty('author')
    expect(imported.notes[0]).not.toHaveProperty('lastEditedBy')
    expect(imported).not.toHaveProperty('votes')
  })
  it('rejects invalid, dangling and overflowing exported count maps', () => {
    for (const total of [-1, 0.5, '3', null]) {
      expect(() => parseImport(JSON.stringify({ ...portable(), voteTotals: { n: total } }))).toThrow(/Exported vote total/)
    }
    expect(() => parseImport(JSON.stringify({ ...portable(), voteTotals: { missing: 2 } }))).toThrow(/missing note/)
    expect(() => parseImport(JSON.stringify({ ...portable(), notes: [{ ...note, votes: Number.MAX_SAFE_INTEGER }], voteTotals: { n: 1 } }))).toThrow(/Priority votes/)
  })
  it('validates vote fields and rejects duplicate/cross-board/dangling vote references', () => {
    expect(validateVote(vote)).toEqual({ id: 'v', board_id: 'b', note_id: 'n' })
    expect(() => validateVote({ ...vote, note_id: '' })).toThrow(/Vote note ID/)
    expect(() => validateReferences({ ...portable(), votes: [vote, vote] })).toThrow(/duplicate vote/)
    expect(() => validateReferences({ ...portable(), votes: [{ ...vote, board_id: 'other' }] })).toThrow(/different board/)
    expect(() => validateReferences({ ...portable(), votes: [{ ...vote, note_id: 'missing' }] })).toThrow(/missing note/)
  })
})
