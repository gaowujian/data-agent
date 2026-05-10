import * as XLSX from 'xlsx'

/** 单文件最大体积（字节） */
export const EXCEL_MAX_FILE_BYTES = 10 * 1024 * 1024

/** 默认每个 sheet 最多返回的数据行数（不含表头逻辑行），防止超大表撑爆响应 */
export const EXCEL_DEFAULT_MAX_ROWS = 5000

export type ParsedExcelSheet = {
  /** 工作表名称 */
  name: string
  /** 首行作为列名的对象数组，便于前端展示或交给 LLM */
  rows: Record<string, unknown>[]
  /** 是否因 maxRows 被截断 */
  truncated: boolean
  /** 截断前的数据行数 */
  totalRowCount: number
}

export type ParsedExcelResult = {
  fileName: string | undefined
  sheetNames: string[]
  sheets: ParsedExcelSheet[]
}

function assertAllowedExcelName(fileName: string) {
  const lower = fileName.toLowerCase()
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
    throw new Error('仅支持 .xlsx 或 .xls 文件')
  }
}

/**
 * 从二进制缓冲区解析 Excel，默认只解析第一个工作表；可配置多表与行数上限。
 */
export function parseExcelBuffer(
  buffer: Buffer,
  options: {
    fileName?: string
    /** 仅当 allSheets 为 false 时生效，指定要解析的 sheet 下标，默认 0 */
    sheetIndex?: number
    /** 为 true 时解析全部 sheet（注意响应体积） */
    allSheets?: boolean
    maxRowsPerSheet?: number
  } = {},
): ParsedExcelResult {
  const {
    fileName,
    sheetIndex = 0,
    allSheets = false,
    maxRowsPerSheet = EXCEL_DEFAULT_MAX_ROWS,
  } = options

  if (buffer.length === 0) {
    throw new Error('文件为空')
  }
  if (buffer.length > EXCEL_MAX_FILE_BYTES) {
    throw new Error(`文件超过 ${Math.floor(EXCEL_MAX_FILE_BYTES / 1024 / 1024)}MB 限制`)
  }
  if (fileName) {
    assertAllowedExcelName(fileName)
  }

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  } catch {
    throw new Error('无法解析 Excel 文件，请确认文件未损坏且格式正确')
  }

  if (workbook.SheetNames.length === 0) {
    throw new Error('工作簿中没有工作表')
  }

  const indices = allSheets
    ? workbook.SheetNames.map((_, i) => i)
    : [Math.min(Math.max(0, sheetIndex), workbook.SheetNames.length - 1)]

  const sheets: ParsedExcelSheet[] = []

  for (const idx of indices) {
    const name = workbook.SheetNames[idx]
    const worksheet = workbook.Sheets[name]
    if (!worksheet) continue

    // 第一行作为对象键，空单元格为 null
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: null,
      raw: false,
    })

    const totalRowCount = rows.length
    const truncated = totalRowCount > maxRowsPerSheet
    const capped = truncated ? rows.slice(0, maxRowsPerSheet) : rows

    sheets.push({
      name,
      rows: capped,
      truncated,
      totalRowCount,
    })
  }

  return {
    fileName,
    sheetNames: workbook.SheetNames,
    sheets,
  }
}
