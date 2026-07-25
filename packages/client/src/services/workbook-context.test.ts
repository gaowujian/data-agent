import { describe, expect, it } from 'vitest'
import { createXlsxFixture } from '../test/xlsx-fixture'
import {
  createWorkbookContext,
  formatWorkbookContextForAgent,
  formatWorkbookSamplesForResponse,
  type WorkbookContext,
} from './workbook-context'

describe('workbook context', () => {
  it('从上传的工作簿生成受限的结构概要和样例上下文', () => {
    const context = createWorkbookContext(createXlsxFixture(), 'report.xlsx')

    expect(context.sheets.map((sheet) => sheet.name)).toEqual(['Data', 'Other'])
    expect(context.sheets[0]).toMatchObject({
      name: 'Data',
      rowCount: 1,
      columnCount: 3,
      headers: ['old', '3'],
    })

    const promptContext = formatWorkbookContextForAgent(context)
    expect(promptContext).toContain('<workbook_context>')
    expect(promptContext).toContain('【工作表】Data')
    expect(promptContext).toContain('</workbook_context>')

    const responseSamples = formatWorkbookSamplesForResponse(context)
    expect(responseSamples).toContain('【工作表】Data 样例数据')
  })

  it('截断超长样例后仍保留唯一且完整的上下文边界', () => {
    const context: WorkbookContext = {
      sheets: [
        {
          name: 'Data',
          rowCount: 1,
          columnCount: 1,
          headers: ['comment'],
          headersTruncated: false,
        },
      ],
      samples: [
        {
          sheetName: 'Data',
          rows: [{ comment: 'x'.repeat(7000) }],
          truncated: false,
        },
      ],
    }

    const promptContext = formatWorkbookContextForAgent(context)
    expect(promptContext).toContain('[工作簿上下文已截断]')
    expect(promptContext.match(/<\/workbook_context>/gu)).toHaveLength(1)
    expect(promptContext.endsWith('</workbook_context>')).toBe(true)
  })
})
