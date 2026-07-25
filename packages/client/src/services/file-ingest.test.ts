import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createXlsxFixture } from '../test/xlsx-fixture'

const embeddingControl = vi.hoisted(() => {
  const pending: Array<{
    texts: string[]
    resolve: (vectors: number[][]) => void
  }> = []
  return { pending }
})

vi.mock('./embeddings', () => ({
  embedTexts: (texts: string[]) =>
    new Promise<number[][]>((resolve) => {
      embeddingControl.pending.push({ texts, resolve })
    }),
}))

import {
  clearFileIngestStoreForTests,
  createPendingFileRecord,
  getFileRecord,
  runIngestExcelJob,
} from './file-ingest'

describe('file ingest versioning', () => {
  beforeEach(() => {
    clearFileIngestStoreForTests()
    embeddingControl.pending.length = 0
  })

  it('过期索引任务完成后不覆盖较新版本', async () => {
    createPendingFileRecord('file-1', 'book.xlsx')
    const buffer = createXlsxFixture()
    const version0 = runIngestExcelJob('file-1', buffer, 'book.xlsx', 0)
    expect(embeddingControl.pending).toHaveLength(1)
    const version1 = runIngestExcelJob('file-1', buffer, 'book.xlsx', 1)
    expect(embeddingControl.pending).toHaveLength(2)

    const newer = embeddingControl.pending[1]
    newer.resolve(newer.texts.map(() => [1, 0]))
    await version1
    const older = embeddingControl.pending[0]
    older.resolve(older.texts.map(() => [0, 1]))
    await version0

    const record = getFileRecord('file-1')
    expect(record?.status).toBe('completed')
    expect(record?.indexedVersion).toBe(1)
    expect(record?.chunks?.[0]?.vector).toEqual([1, 0])
  })
})
