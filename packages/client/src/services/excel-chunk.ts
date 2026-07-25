import type { ParsedExcelResult } from './excel-parser'

/**
 * 单段文本最大字符数（需 ≤ 嵌入侧单条上限，否则易 413 / 超长）。
 * 表格行在边界处切段，检索仍可按块命中。
 */
const CHUNK_MAX_CHARS = 1600

/**
 * 将解析后的 Excel 转为可读文本块，便于向量检索。
 * 每行用 JSON 序列化保留列结构；按字符上限切段。
 */
export function chunkParsedExcelToTexts(result: ParsedExcelResult): string[] {
  const chunks: string[] = []

  for (const sheet of result.sheets) {
    const sheetHeader = `【工作表】${sheet.name}\n`
    let buffer = sheetHeader

    const flush = () => {
      const t = buffer.trimEnd()
      if (t.length > 0) chunks.push(t)
      buffer = sheetHeader
    }

    for (const row of sheet.rows) {
      const line = `${JSON.stringify(row)}\n`
      if (buffer.length + line.length > CHUNK_MAX_CHARS) {
        flush()
        buffer += line
      } else {
        buffer += line
      }
    }
    flush()
  }

  return chunks
}
