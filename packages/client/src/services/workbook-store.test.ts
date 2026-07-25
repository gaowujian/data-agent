import { beforeEach, describe, expect, it } from 'vitest'
import { createXlsxFixture } from '../test/xlsx-fixture'
import {
  clearWorkbookStoreForTests,
  commitWorkbookCellEdit,
  getStoredArtifact,
  getWorkbookRecord,
  storeUploadedWorkbook,
  toWorkbookFileResponse,
} from './workbook-store'

describe('workbook store', () => {
  beforeEach(clearWorkbookStoreForTests)

  it('连续修改基于最新版本且旧产物保持不可变', () => {
    storeUploadedWorkbook('file-1', createXlsxFixture(), 'book.xlsx')
    const first = commitWorkbookCellEdit('file-1', 0, {
      sheetName: 'Data',
      cellAddress: 'A1',
      valueKind: 'text',
      value: 'v1',
    })
    const firstBytes = Buffer.from(getStoredArtifact(first.artifact.artifactId)?.buffer ?? [])
    const second = commitWorkbookCellEdit('file-1', 1, {
      sheetName: 'Data',
      cellAddress: 'C3',
      valueKind: 'number',
      value: 10,
    })

    expect(first.artifact.fileName).toBe('book-modified-v1.xlsx')
    expect(second.artifact.fileName).toBe('book-modified-v2.xlsx')
    expect(getWorkbookRecord('file-1')?.currentVersion).toBe(2)
    expect(getStoredArtifact(first.artifact.artifactId)?.buffer).toEqual(firstBytes)
  })

  it('通过期望版本阻止并发覆盖', () => {
    storeUploadedWorkbook('file-1', createXlsxFixture(), 'book.xlsx')
    commitWorkbookCellEdit('file-1', 0, {
      sheetName: 'Data',
      cellAddress: 'A1',
      valueKind: 'text',
      value: 'first',
    })
    expect(() =>
      commitWorkbookCellEdit('file-1', 0, {
        sheetName: 'Data',
        cellAddress: 'A1',
        valueKind: 'text',
        value: 'stale',
      }),
    ).toThrow(/最新版本/)
  })

  it('上传响应返回已解析的工作表名称', () => {
    const record = storeUploadedWorkbook(
      'file-1',
      createXlsxFixture(),
      'book.xlsx',
    )

    const response = toWorkbookFileResponse(record, { status: 'pending' })

    expect(response).toMatchObject({
      fileId: 'file-1',
      sheetNames: ['Data', 'Other'],
    })
    expect(response.sheets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Data',
          rowCount: expect.any(Number),
          columnCount: expect.any(Number),
        }),
      ]),
    )

    response.sheets[0]?.headers.push('不应回写到内存记录')
    expect(record.context.sheets[0]?.headers).not.toContain(
      '不应回写到内存记录',
    )
  })
})
