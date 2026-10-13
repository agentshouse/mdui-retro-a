import { describe, expect, it, vi } from 'vitest'
import {
  addVote, createBoard, createColumn, createNote, deleteBoard, deleteColumn, deleteNote, groupNotes, importBoard,
  listRooms, moveNote, observeConnectionRefusal, observeQueue, observeRetro, observeRoomDrafts, observeRooms,
  observeServiceMode, observeStorageLoss, observeSyncStatus, readRetro, reorderColumns, reorderNotes, retroQuery, unstackNote,
  updateBoard, updateColumn, updateNote, type HouseRuntime, type RetroResult,
} from '../src/house'
import { exportBoard, parseImport, type Board, type Column, type Note, type RetroData, type Vote, type Attribution } from '../src/model'

const board: Board = { id: 'b', name: 'Retro', description: '', isLocked: false, room: 'r', path: 'retros/b/board.md' }
const column: Column = { id: 'c', board_id: 'b', name: 'Went well', description: '', color: 'backlog-blue', index: 0, visible: true, room: 'r', path: 'retros/b/columns/c.md' }
const otherColumn: Column = { ...column, id: 'd', name: 'Try next', index: 1, path: 'retros/b/columns/d.md' }
const note: Note = { id: 'n', board_id: 'b', text: 'Shipped', column_id: 'c', stack_id: '', rank: 1, edited: false, votes: 0, room: 'r', path: 'retros/b/notes/n.md', lastEditedBy: null }
const child: Note = { ...note, id: 'child', text: 'With tests', stack_id: note.id, rank: 2, path: 'retros/b/notes/child.md' }
const data: RetroData = { boards: [board], columns: [column, otherColumn], notes: [note, child], votes: [] }
function document(row: Board | Column | Note | Vote, author?: Attribution | null): RetroResult['documents'][number] {
  const { room, path, ...modelFields } = row
  const fields = Object.fromEntries(Object.entries(modelFields).filter(([key]) => !['lastEditedBy', 'author'].includes(key)).map(([key, value]) => [key, ['isLocked', 'visible', 'edited'].includes(key) ? String(value) : value]))
  return { room, path, type: 'note_id' in row ? 'retro_vote' : 'column_id' in row ? 'retro_note' : 'board_id' in row ? 'retro_column' : 'retro_board', fields, ...(author === undefined ? {} : { change: { author, time: '2026-10-11T01:00:00Z' } }), markdown: `---\n${JSON.stringify(fields)}\n---\n\nExact original text at ${path}.\n` }
}
const documents = [...data.boards, ...data.columns, ...data.notes].map((row) => document(row))
function mockRuntime(options: { documents?: RetroResult['documents']; existingPath?: string; writeFailAt?: number; saveResult?: unknown } = {}) {
  const query = vi.fn(async (_query: unknown) => ({ documents: options.documents ?? documents }))
  const read = vi.fn(async (_room: string, path: string) => path === options.existingPath ? { revision: 'existing', parts: { fields: {} } } : null)
  const write = vi.fn(async (_room: string, _path: string, _revision: string | null, _parts: unknown) => {
    const number = write.mock.calls.length
    return number === options.writeFailAt ? { outcome: 'stale', current: { revision: 'other-tab' } } : { outcome: 'written', roomDraft: { revision: `draft-${number}` } }
  })
  const save = vi.fn(async () => options.saveResult ?? { outcome: 'saved', identifier: 'batch-1' })
  const observe = vi.fn(async () => ({ current: () => null, subscribe: () => () => {}, close() {} }))
  const rooms = vi.fn(async () => [{ locator: 'r', name: 'Retros' }])
  const md = { query, roomDraft: { read, write }, save, observe, rooms } as unknown as HouseRuntime
  return { md, query, read, write, save, observe, rooms }
}

describe('House observation boundary', () => {
  it('reads one document per board, column and note, without faking invalid data', () => {
    expect(readRetro({ documents })).toEqual(data)
    expect(() => readRetro({ documents: [{ ...documents[0], fields: {} }] })).toThrow(/Board ID/)
    expect(() => readRetro({ documents: [documents[0], documents[0]] })).toThrow(/duplicate/)
    expect(() => readRetro({ documents: [{ ...documents[0], type: 'unknown' }] })).toThrow(/Unsupported/)
    expect(retroQuery.select).toEqual({ fields: 'all', change: true })
  })
  it('fails visibly on orphaned documents and corrupt stack references', () => {
    expect(() => readRetro({ documents: [document(column)] })).toThrow(/missing board/)
    expect(() => readRetro({ documents: [document(board), document(note)] })).toThrow(/missing column/)
    expect(() => readRetro({ documents: [document(board), document(column), document(child)] })).toThrow(/root note/)
    expect(() => readRetro({ documents: [{ ...document(board), fields: { ...document(board).fields, isLocked: 'yes' } }] })).toThrow(/enum string/)
  })
  it('exposes the exact observed Runtime topics and room-scoped queue', async () => {
    const mock = mockRuntime()
    await observeRetro(mock.md); await observeRooms(mock.md); await observeSyncStatus(mock.md)
    await observeRoomDrafts(mock.md); await observeStorageLoss(mock.md); await observeConnectionRefusal(mock.md)
    await observeServiceMode(mock.md); await observeQueue(mock.md, 'r'); await listRooms(mock.md)
    expect(mock.observe.mock.calls).toEqual([
      ['query', retroQuery], ['rooms'], ['sync-status'], ['room-drafts'], ['storage-loss'], ['connection-refusal'], ['service-mode'], ['queue', 'r'],
    ])
    expect(mock.rooms).toHaveBeenCalledOnce()
  })
})

describe('Room drafts and local queue semantics', () => {
  it('creates a board and columns in one save and reports queued, not synchronized', async () => {
    const mock = mockRuntime()
    const result = await createBoard(mock.md, 'r', 'New retro')
    expect(result).toMatchObject({ outcome: 'queued', identifier: 'batch-1', board: { name: 'New retro', room: 'r' } })
    expect(mock.write).toHaveBeenCalledTimes(4)
    expect(mock.save).toHaveBeenCalledOnce()
    const calls = mock.write.mock.calls
    expect(calls.every((call) => call[2] === null)).toBe(true)
    expect(calls[0][3]).toMatchObject({ creation: { type: 'retro_board', fields: { name: 'New retro', isLocked: 'false' } } })
    expect(calls[1][3]).toMatchObject({ creation: { type: 'retro_column', fields: { board_id: result.board.id } } })
  })
  it('preserves all existing drafts by preflighting the whole group', async () => {
    const mock = mockRuntime({ existingPath: child.path })
    await expect(deleteBoard(mock.md, board, data)).rejects.toThrow(/unfinished House draft/)
    expect(mock.write).not.toHaveBeenCalled()
    expect(mock.save).not.toHaveBeenCalled()
  })
  it('uses null draft revision and stops on a cross-tab draft race without saving', async () => {
    const mock = mockRuntime({ writeFailAt: 2 })
    await expect(createBoard(mock.md, 'r', 'New retro')).rejects.toThrow(/another tab/)
    expect(mock.write).toHaveBeenCalledTimes(2)
    expect(mock.write.mock.calls[0][2]).toBeNull()
    expect(mock.save).not.toHaveBeenCalled()
  })
  it.each(['changed-underneath', 'stale', 'invalid-field'])('preserves drafts on a %s save refusal', async (rule) => {
    const mock = mockRuntime({ saveResult: { outcome: 'refused', rule, fields: ['text'] } })
    await expect(updateNote(mock.md, board, note, { text: 'Edited' })).rejects.toThrow(/drafts have been kept/)
    expect(mock.write).toHaveBeenCalledOnce()
    expect(mock.save).toHaveBeenCalledOnce()
    expect(mock.md.roomDraft).not.toHaveProperty('discard')
  })
  it('uses exact field bases for edits and marks edited note text', async () => {
    const mock = mockRuntime()
    await updateNote(mock.md, board, note, { text: 'Edited', votes: 3 })
    expect(mock.write.mock.calls[0][3]).toEqual({ fields: {
      text: { value: 'Edited', base: { value: 'Shipped' } },
      votes: { value: 3, base: { value: 0 } }, edited: { value: 'true', base: { value: 'false' } },
    } })
  })
  it('distinguishes absent stack fields from present empty strings', async () => {
    const withoutStack = { ...note }; delete withoutStack.stack_id
    const mock = mockRuntime({ documents: [document(board), document(column), document(withoutStack)] })
    await unstackNote(mock.md, board, withoutStack)
    expect(mock.write.mock.calls[0][3]).toEqual({ fields: { stack_id: { value: '', base: null } } })
  })
  it('never turns a transport failure into fake local data or success', async () => {
    const mock = mockRuntime(); mock.query.mockRejectedValueOnce(new Error('port closed'))
    await expect(createNote(mock.md, board, column, 'New')).rejects.toThrow('port closed')
    expect(mock.write).not.toHaveBeenCalled()
  })
})

describe('stale references and retrospective operations', () => {
  it('creates a note with a new ID, numeric zero votes, and a higher donor rank', async () => {
    const mock = mockRuntime(); const result = await createNote(mock.md, board, column, 'Fresh note')
    expect(result.note).toMatchObject({ text: 'Fresh note', column_id: 'c', board_id: 'b', rank: 3, votes: 0, stack_id: '' })
    expect(result.note.id).not.toBe(note.id)
    expect(mock.write.mock.calls[0][3]).toMatchObject({ creation: { type: 'retro_note' } })
  })
  it('creates and updates columns and updates board fields with bases', async () => {
    const mock = mockRuntime(); const created = await createColumn(mock.md, board, { name: 'Actions' })
    expect(created.column).toMatchObject({ index: 2, color: 'backlog-blue', visible: true })
    await updateColumn(mock.md, board, column, { name: 'Successes' })
    expect(mock.write.mock.calls[1][3]).toEqual({ fields: { name: { value: 'Successes', base: { value: 'Went well' } } } })
    await updateBoard(mock.md, board, { isLocked: true })
    expect(mock.write.mock.calls[2][3]).toEqual({ fields: { isLocked: { value: 'true', base: { value: 'false' } } } })
  })
  it('refuses a currently locked board, even if the displayed board was unlocked', async () => {
    const mock = mockRuntime({ documents: [document({ ...board, isLocked: true }), ...documents.slice(1)] })
    await expect(createNote(mock.md, board, column, 'No')).rejects.toThrow(/locked/)
    expect(mock.write).not.toHaveBeenCalled()
    await updateBoard(mock.md, { ...board, isLocked: true }, { isLocked: false })
    expect(mock.write).toHaveBeenCalledOnce()
  })
  it('rejects foreign or deleted columns before writing a note', async () => {
    const mock = mockRuntime()
    await expect(createNote(mock.md, board, { ...column, room: 'other' }, 'No')).rejects.toThrow(/different board/)
    await expect(createNote(mock.md, board, { ...column, id: 'missing' }, 'No')).rejects.toThrow(/deleted/)
    expect(mock.write).not.toHaveBeenCalled()
  })
  it('rejects unknown patch keys and invalid values', async () => {
    const mock = mockRuntime()
    await expect(updateNote(mock.md, board, note, { author: 'fake' } as never)).rejects.toThrow(/unsupported/)
    await expect(updateNote(mock.md, board, note, { votes: -2 })).rejects.toThrow(/Priority votes/)
    await expect(updateNote(mock.md, board, note, { stack_id: note.id })).rejects.toThrow(/root note/)
    await expect(updateNote(mock.md, board, note, { column_id: 'missing' })).rejects.toThrow(/missing column/)
    expect(mock.write).not.toHaveBeenCalled()
  })
  it('moves a stack as one grouped save and rejects an unseen new child', async () => {
    const mock = mockRuntime()
    await moveNote(mock.md, board, note, otherColumn, data.notes)
    expect(mock.write).toHaveBeenCalledTimes(2)
    expect(mock.save).toHaveBeenCalledOnce()
    expect(mock.write.mock.calls[0][3]).toMatchObject({ fields: { column_id: { value: otherColumn.id, base: { value: column.id } }, stack_id: { value: '' } } })
    expect(mock.write.mock.calls[1][3]).toEqual({ fields: { column_id: { value: otherColumn.id, base: { value: column.id } }, stack_id: { value: note.id, base: { value: note.id } }, rank: { value: child.rank, base: { value: child.rank } } } })
    const stale = mockRuntime()
    await expect(moveNote(stale.md, board, note, otherColumn, [note])).rejects.toThrow(/added, moved, or removed/)
    expect(stale.write).not.toHaveBeenCalled()
  })
  it('reorders the full column snapshot using exact previous index bases in one save', async () => {
    const mock = mockRuntime()
    await reorderColumns(mock.md, board, [otherColumn, column])
    expect(mock.write.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      [otherColumn.path, { fields: { index: { value: 0, base: { value: 1 } } } }],
      [column.path, { fields: { index: { value: 1, base: { value: 0 } } } }],
    ])
    expect(mock.save).toHaveBeenCalledOnce()
  })
  it('refuses incomplete or duplicate column ordering snapshots before any write', async () => {
    const mock = mockRuntime()
    await expect(reorderColumns(mock.md, board, [column])).rejects.toThrow(/added, moved, or removed/)
    await expect(reorderColumns(mock.md, board, [column, column])).rejects.toThrow(/added, moved, or removed/)
    expect(mock.write).not.toHaveBeenCalled()
  })
  it('reorders only roots with high ranks first and leaves stack children untouched', async () => {
    const second: Note = { ...note, id: 'second', path: 'retros/b/notes/second.md', rank: 10 }
    const mock = mockRuntime({ documents: [...documents, document(second)] })
    await reorderNotes(mock.md, board, column, [note, second])
    expect(mock.write.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      [note.path, { fields: { rank: { value: 2, base: { value: 1 } }, column_id: { value: 'c', base: { value: 'c' } }, stack_id: { value: '', base: { value: '' } } } }],
      [second.path, { fields: { rank: { value: 1, base: { value: 10 } }, column_id: { value: 'c', base: { value: 'c' } }, stack_id: { value: '', base: { value: '' } } } }],
    ])
    expect(mock.save).toHaveBeenCalledOnce()
  })
  it('refuses unseen root membership or children in the root ordering snapshot', async () => {
    const second: Note = { ...note, id: 'second', path: 'retros/b/notes/second.md', rank: 10 }
    const mock = mockRuntime({ documents: [...documents, document(second)] })
    await expect(reorderNotes(mock.md, board, column, [note])).rejects.toThrow(/added, moved, or removed/)
    await expect(reorderNotes(mock.md, board, column, [note, child])).rejects.toThrow(/added, moved, or removed/)
    await expect(reorderNotes(mock.md, board, otherColumn, [note, second])).rejects.toThrow(/added, moved, or removed/)
    expect(mock.write).not.toHaveBeenCalled()
  })
  it('groups roots in one column and allows an individual child to be unstacked', async () => {
    const second: Note = { ...note, id: 'second', path: 'retros/b/notes/second.md', rank: 3 }
    const mock = mockRuntime({ documents: [...documents, document(second)] })
    await groupNotes(mock.md, board, note, [second])
    expect(mock.write.mock.calls[0][3]).toEqual({ fields: { stack_id: { value: note.id, base: { value: '' } }, column_id: { value: 'c', base: { value: 'c' } }, rank: { value: note.rank, base: { value: second.rank } } } })
    await unstackNote(mock.md, board, child)
    expect(mock.write.mock.calls[2][3]).toEqual({ fields: { stack_id: { value: '', base: { value: note.id } } } })
  })
})

describe('grouped deletion and imports', () => {
  it('queries exact Markdown and removes a board, columns and notes in one batch', async () => {
    const mock = mockRuntime(); await deleteBoard(mock.md, board, data)
    expect(mock.query.mock.calls[0][0]).toMatchObject({ rooms: ['r'], select: { fields: 'all', markdown: true } })
    expect(mock.write).toHaveBeenCalledTimes(5)
    expect(mock.save).toHaveBeenCalledOnce()
    mock.write.mock.calls.forEach((call) => expect(call[3]).toEqual({ removal: { base: documents.find((document) => document.path === call[1])!.markdown } }))
  })
  it('deletes a column with its notes and deletes a stack with its children', async () => {
    const columnMock = mockRuntime(); await deleteColumn(columnMock.md, board, column, data)
    expect(columnMock.write.mock.calls.map((call) => call[1])).toEqual([column.path, child.path, note.path])
    expect(columnMock.save).toHaveBeenCalledOnce()
    const noteMock = mockRuntime(); await deleteNote(noteMock.md, board, note, data)
    expect(noteMock.write.mock.calls.map((call) => call[1])).toEqual([note.path, child.path])
  })
  it('refuses changed content, missing Markdown, and a new child before any deletion draft', async () => {
    const changed = mockRuntime({ documents: documents.map((doc) => doc.path === child.path ? document({ ...child, text: 'Changed' }) : doc) })
    await expect(deleteBoard(changed.md, board, data)).rejects.toThrow(/changed since/)
    expect(changed.write).not.toHaveBeenCalled()
    const noMarkdown = mockRuntime({ documents: documents.map((doc) => ({ ...doc, markdown: undefined })) })
    await expect(deleteBoard(noMarkdown.md, board, data)).rejects.toThrow(/changed since/)
    const extra = mockRuntime({ documents: [...documents, document({ ...child, id: 'new', path: 'retros/b/notes/new.md' })] })
    await expect(deleteColumn(extra.md, board, column, data)).rejects.toThrow(/added, moved, or removed/)
    expect(extra.write).not.toHaveBeenCalled()
  })
  it('remaps every imported ID, column, and stack relationship in one batch', async () => {
    const mock = mockRuntime(); const input = parseImport(exportBoard(data, board))
    const result = await importBoard(mock.md, 'new-room', input)
    expect(result.board.room).toBe('new-room')
    expect(result.board.id).not.toBe(board.id)
    expect(mock.write).toHaveBeenCalledTimes(5)
    expect(mock.save).toHaveBeenCalledOnce()
    const creations = mock.write.mock.calls.map((call) => (call[3] as { creation: { fields: Record<string, unknown> } }).creation.fields)
    expect(creations[3].column_id).toBe(creations[1].id)
    expect(creations[4].column_id).toBe(creations[1].id)
    // Export retains donor rank order, so child is before its root in this input.
    const newRoot = creations.find((fields) => fields.text === note.text)!
    const newChild = creations.find((fields) => fields.text === child.text)!
    expect(newChild.stack_id).toBe(newRoot.id)
    expect(creations.slice(1).every((fields) => fields.board_id === result.board.id)).toBe(true)
    expect(mock.write.mock.calls.every((call) => call[0] === 'new-room')).toBe(true)
  })
})

const writer: Attribution = { kind: 'user', id: 'user-one', name: 'First writer' }
const siteWriter: Attribution = { kind: 'site', id: 'site-one', name: 'Review site' }
const vote: Vote = { id: 'v', board_id: 'b', note_id: note.id, room: 'r', path: 'retros/b/votes/v.md', author: writer }
const childVote: Vote = { ...vote, id: 'v-child', note_id: child.id, path: 'retros/b/votes/v-child.md', author: null }
const votedData: RetroData = { ...data, votes: [vote, childVote] }
const votedDocuments = [...documents, document(vote, writer), document(childVote, null)]

describe('Provider head attribution', () => {
  it('reads confirmed head metadata as last editor, never original creator or current user', () => {
    const attributed = documents.map((doc) => doc.path === note.path ? document(note, writer) : doc)
    const result = readRetro({ documents: [...attributed, document(vote, siteWriter)] })
    expect(result.notes.find((row) => row.id === note.id)?.lastEditedBy).toEqual(writer)
    expect(result.votes[0].author).toEqual(siteWriter)
    expect(result.notes[0]).not.toHaveProperty('creator')
    expect(result).not.toHaveProperty('currentUser')
    expect(retroQuery.select.change).toBe(true)
  })
  it('keeps absent, pending and Provider-originated attribution explicitly unknown', () => {
    const result = readRetro({ documents: [
      ...documents.map((doc) => doc.path === note.path ? { ...doc, change: null } : doc),
      document(vote), document(childVote, null),
    ] })
    expect(result.notes.every((row) => row.lastEditedBy === null)).toBe(true)
    expect(result.votes.every((row) => row.author === null)).toBe(true)
  })
  it('does not infer authors from document fields or neighboring attribution', () => {
    const claimed = document(note)
    claimed.fields = { ...claimed.fields, author: writer, lastEditedBy: writer }
    const result = readRetro({ documents: [
      ...documents.filter((doc) => doc.path !== note.path), claimed, document(vote, writer),
    ] })
    expect(result.notes.find((row) => row.id === note.id)?.lastEditedBy).toBeNull()
    expect(result.votes[0].author).toEqual(writer)
  })
  it('does not put authors in creations, edits, field bases, or deletion comparisons', async () => {
    const opened: Note = { ...note, lastEditedBy: writer }
    const mock = mockRuntime({ documents: documents.map((doc) => doc.path === note.path ? document(note, siteWriter) : doc) })
    await updateNote(mock.md, board, opened, { text: 'Edited again' })
    const edit = mock.write.mock.calls[0][3]
    expect(edit).toEqual({ fields: { text: { value: 'Edited again', base: { value: note.text } }, edited: { value: 'true', base: { value: 'false' } } } })
    await deleteNote(mock.md, board, opened, { ...data, notes: [opened, child] })
    expect(mock.write.mock.calls[1][3]).toEqual({ removal: { base: document(note, siteWriter).markdown } })
    expect(JSON.stringify(mock.write.mock.calls)).not.toContain('lastEditedBy')
    expect(JSON.stringify(mock.write.mock.calls)).not.toContain('user-one')
    const created = mockRuntime()
    const result = await createNote(created.md, board, column, 'New note')
    expect(result.note.lastEditedBy).toBeNull()
    expect(JSON.stringify(created.write.mock.calls)).not.toContain('lastEditedBy')
    await expect(updateNote(mock.md, board, opened, { lastEditedBy: siteWriter } as never)).rejects.toThrow(/unsupported/)
  })
})

describe('one document per explicit vote', () => {
  it('creates only a vote document and waits for Provider metadata without identity probes', async () => {
    const mock = mockRuntime({ documents: votedDocuments })
    const result = await addVote(mock.md, board, note)
    expect(result).toMatchObject({ outcome: 'queued', identifier: 'batch-1', vote: { board_id: board.id, note_id: note.id, room: board.room, author: null } })
    expect(mock.write).toHaveBeenCalledOnce()
    expect(mock.write.mock.calls[0][1]).toBe(result.vote.path)
    expect(mock.write.mock.calls[0][3]).toEqual({ creation: { type: 'retro_vote', fields: { id: result.vote.id, board_id: board.id, note_id: note.id }, sections: {} } })
    expect(mock.query).toHaveBeenCalledOnce()
    expect(mock.query.mock.calls[0][0]).toMatchObject({ rooms: [board.room], select: { fields: 'all', change: true } })
    expect(mock.observe).not.toHaveBeenCalled()
    expect(mock.save).toHaveBeenCalledOnce()
  })
  it('uses distinct immutable documents for repeated explicit votes, even with the same head author', async () => {
    const mock = mockRuntime({ documents: votedDocuments })
    const first = await addVote(mock.md, board, note)
    const second = await addVote(mock.md, board, note)
    expect(first.vote.id).not.toBe(second.vote.id)
    expect(first.vote.path).not.toBe(second.vote.path)
    expect(mock.write).toHaveBeenCalledTimes(2)
    expect(mock.save).toHaveBeenCalledTimes(2)
    expect(mock.write.mock.calls.every((call) => call[1].includes('/votes/'))).toBe(true)
  })
  it('checks locks and same-Room note membership before creating votes', async () => {
    const mock = mockRuntime()
    await expect(addVote(mock.md, board, { ...note, room: 'another-room' })).rejects.toThrow(/different board/)
    await expect(addVote(mock.md, board, { ...note, id: 'missing' })).rejects.toThrow(/deleted/)
    const locked = mockRuntime({ documents: [document({ ...board, isLocked: true }), ...documents.slice(1)] })
    await expect(addVote(locked.md, board, note)).rejects.toThrow(/locked/)
    expect(mock.write).not.toHaveBeenCalled()
    expect(locked.write).not.toHaveBeenCalled()
  })
  it('validates vote IDs, board references and note references without deduplicating people', () => {
    expect(() => readRetro({ documents: [...documents, document(vote, writer), document({ ...childVote, author: writer }, writer)] })).not.toThrow()
    expect(() => readRetro({ documents: [...documents, document({ ...vote, board_id: 'missing' })] })).toThrow(/missing board/)
    expect(() => readRetro({ documents: [...documents, document({ ...vote, note_id: 'missing' })] })).toThrow(/missing note/)
    expect(() => readRetro({ documents: [...documents, document(vote), document(vote)] })).toThrow(/duplicate/)
    expect(() => readRetro({ documents: [...documents, { ...document(vote), fields: { board_id: 'b', note_id: 'n' } }] })).toThrow(/Vote ID/)
  })
  it.each(['board', 'column', 'note'] as const)('cascades %s deletion to real vote documents in the same batch', async (target) => {
    const mock = mockRuntime({ documents: votedDocuments })
    if (target === 'board') await deleteBoard(mock.md, board, votedData)
    if (target === 'column') await deleteColumn(mock.md, board, column, votedData)
    if (target === 'note') await deleteNote(mock.md, board, note, votedData)
    expect(mock.save).toHaveBeenCalledOnce()
    const paths = mock.write.mock.calls.map((call) => call[1])
    expect(paths).toContain(vote.path)
    expect(paths).toContain(childVote.path)
    for (const row of [vote, childVote]) {
      const write = mock.write.mock.calls.find((call) => call[1] === row.path)!
      expect(write[3]).toEqual({ removal: { base: votedDocuments.find((doc) => doc.path === row.path)!.markdown } })
    }
  })
  it('refuses unseen new votes before preparing any cascade removal draft', async () => {
    const mock = mockRuntime({ documents: votedDocuments })
    await expect(deleteBoard(mock.md, board, data)).rejects.toThrow(/added, moved, or removed/)
    await expect(deleteColumn(mock.md, board, column, data)).rejects.toThrow(/added, moved, or removed/)
    await expect(deleteNote(mock.md, board, note, data)).rejects.toThrow(/added, moved, or removed/)
    expect(mock.write).not.toHaveBeenCalled()
  })
  it('preserves a vote draft and refuses stale vote fields or missing Markdown', async () => {
    const existing = mockRuntime({ documents: votedDocuments, existingPath: vote.path })
    await expect(deleteBoard(existing.md, board, votedData)).rejects.toThrow(/unfinished House draft/)
    expect(existing.write).not.toHaveBeenCalled()
    const changed = mockRuntime({ documents: votedDocuments.map((doc) => doc.path === vote.path ? document({ ...vote, note_id: child.id }, writer) : doc) })
    await expect(deleteBoard(changed.md, board, votedData)).rejects.toThrow(/changed since/)
    expect(changed.write).not.toHaveBeenCalled()
    const noMarkdown = mockRuntime({ documents: votedDocuments.map((doc) => doc.path === vote.path ? { ...doc, markdown: undefined } : doc) })
    await expect(deleteBoard(noMarkdown.md, board, votedData)).rejects.toThrow(/changed since/)
    expect(noMarkdown.write).not.toHaveBeenCalled()
  })
  it('imports only legacy numeric totals, never copied vote docs or attribution', async () => {
    const attributed = { ...votedData, notes: [{ ...note, lastEditedBy: writer }, child] }
    const portable = parseImport(exportBoard(attributed, board))
    expect(portable.notes.find((row) => row.id === note.id)?.votes).toBe(1)
    const input = { ...portable, votes: [vote], notes: portable.notes.map((row) => ({ ...row, lastEditedBy: writer, author: writer })) }
    const mock = mockRuntime()
    await importBoard(mock.md, 'import-room', input)
    expect(mock.write).toHaveBeenCalledTimes(5)
    const serialized = JSON.stringify(mock.write.mock.calls)
    expect(serialized).not.toContain('retro_vote')
    expect(serialized).not.toContain('lastEditedBy')
    expect(serialized).not.toContain('user-one')
    expect(serialized).not.toContain('author')
  })
})

describe('drag snapshot persistence',()=>{
  const target:Note={...note,id:'target',path:'retros/b/notes/target.md',column_id:otherColumn.id,rank:7,text:'Target'}
  const following:Note={...target,id:'following',path:'retros/b/notes/following.md',rank:2,text:'Following'}
  const withTargets=[...documents,document(target),document(following)]
  it('groups a complete stack across columns in one guarded save',async()=>{
    const mock=mockRuntime({documents:withTargets})
    await groupNotes(mock.md,board,target,[note,child])
    expect(mock.save).toHaveBeenCalledOnce()
    expect(mock.write).toHaveBeenCalledTimes(3)
    expect(mock.write.mock.calls[0][3]).toEqual({fields:{column_id:{value:'d',base:{value:'c'}},stack_id:{value:'target',base:{value:''}},rank:{value:7,base:{value:1}}}})
    expect(mock.write.mock.calls[1][3]).toEqual({fields:{column_id:{value:'d',base:{value:'c'}},stack_id:{value:'target',base:{value:'n'}},rank:{value:7,base:{value:2}}}})
    expect(mock.write.mock.calls[2][1]).toBe(target.path)
    expect(mock.write.mock.calls[2][3]).toEqual({fields:{column_id:{value:'d',base:{value:'d'}},stack_id:{value:'',base:{value:''}},rank:{value:7,base:{value:7}}}})
    expect(JSON.stringify(mock.write.mock.calls)).not.toMatch(/lastEditedBy|author|votes/)
  })
  it('inserts a moved root and children at a specific cross-column position atomically',async()=>{
    const mock=mockRuntime({documents:withTargets})
    await moveNote(mock.md,board,note,otherColumn,[note,child,target,following],[target,note,following])
    expect(mock.save).toHaveBeenCalledOnce()
    expect(mock.write.mock.calls.map(call=>call[1])).toEqual([target.path,note.path,following.path,child.path])
    expect(mock.write.mock.calls[1][3]).toEqual({fields:{column_id:{value:'d',base:{value:'c'}},stack_id:{value:'',base:{value:''}},rank:{value:2,base:{value:1}}}})
    expect(mock.write.mock.calls[3][3]).toMatchObject({fields:{column_id:{value:'d',base:{value:'c'}},stack_id:{value:'n',base:{value:'n'}}}})
  })
  it('refuses target/source movements instead of adopting fresh positions as bases',async()=>{
    for(const changed of [{...target,rank:8},{...target,column_id:column.id},{...note,rank:10}]){
      const mock=mockRuntime({documents:withTargets.map(doc=>doc.path===changed.path?document(changed):doc)})
      await expect(groupNotes(mock.md,board,target,[note,child])).rejects.toThrow(/moved or changed grouping/)
      expect(mock.write).not.toHaveBeenCalled()
    }
  })
  it('refuses an unobserved child or destination root before preparing a drag batch',async()=>{
    const group=mockRuntime({documents:withTargets})
    await expect(groupNotes(group.md,board,target,[note])).rejects.toThrow(/Select the notes in this stack/)
    expect(group.write).not.toHaveBeenCalled()
    const move=mockRuntime({documents:withTargets})
    await expect(moveNote(move.md,board,note,otherColumn,[note,child],[note,target])).rejects.toThrow(/added, moved, or removed/)
    expect(move.write).not.toHaveBeenCalled()
  })
  it('preserves an existing target draft and reports a refused group save without clearing drafts',async()=>{
    const pending=mockRuntime({documents:withTargets,existingPath:target.path})
    await expect(groupNotes(pending.md,board,target,[note,child])).rejects.toThrow(/unfinished House draft/)
    expect(pending.write).not.toHaveBeenCalled()
    const refused=mockRuntime({documents:withTargets,saveResult:{outcome:'refused',code:'base-mismatch', retryable: false}})
    await expect(groupNotes(refused.md,board,target,[note,child])).rejects.toThrow(/base-mismatch.*drafts have been kept/)
    expect(refused.save).toHaveBeenCalledOnce()
    expect(refused.write).toHaveBeenCalledTimes(3)
  })
  it('refuses a changed rank in an ordering snapshot before any reordering draft',async()=>{
    const second={...note,id:'second',path:'retros/b/notes/second.md',rank:3}
    const mock=mockRuntime({documents:[...documents,document({...second,rank:9})]})
    await expect(reorderNotes(mock.md,board,column,[note,second])).rejects.toThrow(/moved or changed grouping/)
    expect(mock.write).not.toHaveBeenCalled()
  })
})
