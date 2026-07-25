import { posix as pathPosix } from 'node:path'
import {
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
  type Unzipped,
} from 'fflate'
import { SaxesParser, type SaxesTagNS } from 'saxes'
import type { SpreadsheetCellEdit } from '@data-agent/shared'

const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
const MAX_ZIP_ENTRIES = 10_000
const MAX_EXCEL_ROW = 1_048_576
const MAX_EXCEL_COLUMN = 16_384
const OFFICE_DOCUMENT_RELATIONSHIP = '/officeDocument'
const WORKSHEET_RELATIONSHIP = '/worksheet'

type CellCoordinate = {
  address: string
  column: number
  row: number
}

type CellRange = {
  start: CellCoordinate
  end: CellCoordinate
}

type Relationship = {
  id: string
  type: string
  target: string
  targetMode?: string
}

type WorksheetDescriptor = {
  name: string
  partPath: string
}

type PackageDescriptor = {
  entries: Unzipped
  workbookPath: string
  sheets: WorksheetDescriptor[]
}

type XmlNodeSpan = {
  name: string
  local: string
  openStart: number
  openEnd: number
  closeStart: number
  end: number
  selfClosing: boolean
}

type OpenXmlNode = Omit<XmlNodeSpan, 'closeStart' | 'end'> & {
  tag: SaxesTagNS
  closeStart?: number
  end?: number
}

type RowSpan = {
  row: number
  span: OpenXmlNode
  cells: Array<{ coordinate: CellCoordinate; span: OpenXmlNode }>
}

type FormulaInfo = {
  cellAddress: string
  type?: string
  sharedIndex?: string
  ref?: string
}

type WorksheetScan = {
  sheetData?: OpenXmlNode
  dimension?: { span: OpenXmlNode; ref?: string }
  rows: RowSpan[]
  targetCell?: OpenXmlNode
  targetValueChildren: XmlNodeSpan[]
  formulae: FormulaInfo[]
  mergeRefs: string[]
  protected: boolean
}

export type XlsxPackageInfo = {
  sheetNames: string[]
}

export type XlsxEditResult = {
  buffer: Buffer
  sheetNames: string[]
  changedPartPath: string
}

function attribute(tag: SaxesTagNS, name: string): string | undefined {
  for (const item of Object.values(tag.attributes)) {
    if (item.name === name || item.local === name) return item.value
  }
  return undefined
}

function parseXml(xml: string, onOpen: (tag: SaxesTagNS) => void): void {
  let parseError: Error | undefined
  const parser = new SaxesParser({ xmlns: true, position: true })
  parser.on('opentag', onOpen)
  parser.on('doctype', () => {
    parseError = new Error('XLSX XML 不允许包含 DOCTYPE')
  })
  parser.on('error', (error) => {
    parseError = error
  })
  parser.write(xml).close()
  if (parseError) throw parseError
}

function decodeXml(bytes: Uint8Array, partPath: string): string {
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff)
  ) {
    throw new Error(`暂不支持 UTF-16 编码的 XLSX XML：${partPath}`)
  }
  const xml = strFromU8(bytes)
  const declaration = xml.slice(0, 200)
  const encoding = /encoding\s*=\s*["']([^"']+)["']/i.exec(declaration)?.[1]
  if (encoding && !/^utf-?8$/i.test(encoding)) {
    throw new Error(`暂不支持 ${encoding} 编码的 XLSX XML：${partPath}`)
  }
  const roundTrip = strToU8(xml)
  if (!bytesEqual(roundTrip, bytes)) {
    throw new Error(`无法无损解码 XLSX XML：${partPath}`)
  }
  return xml
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let i = 0; i < left.byteLength; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

function unzipWorkbook(buffer: Buffer): Unzipped {
  let totalBytes = 0
  let entryCount = 0
  let entries: Unzipped
  try {
    entries = unzipSync(buffer, {
      filter(file) {
        entryCount += 1
        totalBytes += file.originalSize
        if (entryCount > MAX_ZIP_ENTRIES || totalBytes > MAX_UNCOMPRESSED_BYTES) {
          throw new Error('XLSX 解压后体积或文件数超过安全限制')
        }
        return true
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法解压 XLSX'
    throw new Error(`无法读取 XLSX 压缩包：${message}`)
  }

  const names = Object.keys(entries)
  if (
    names.some(
      (name) =>
        name.toLowerCase().startsWith('_xmlsignatures/') ||
        name.toLowerCase().endsWith('origin.sigs'),
    )
  ) {
    throw new Error('暂不支持修改带数字签名的 XLSX，修改会使原签名失效')
  }
  return entries
}

function requireEntry(entries: Unzipped, partPath: string): Uint8Array {
  const entry = entries[partPath]
  if (!entry) throw new Error(`XLSX 缺少必要部件：${partPath}`)
  return entry
}

function parseRelationships(xml: string): Relationship[] {
  const relationships: Relationship[] = []
  parseXml(xml, (tag) => {
    if (tag.local !== 'Relationship') return
    const id = attribute(tag, 'Id')
    const type = attribute(tag, 'Type')
    const target = attribute(tag, 'Target')
    if (!id || !type || !target) return
    relationships.push({
      id,
      type,
      target,
      targetMode: attribute(tag, 'TargetMode'),
    })
  })
  return relationships
}

function resolvePartPath(ownerPart: string, target: string): string {
  if (target.startsWith('/')) return pathPosix.normalize(target).replace(/^\/+/, '')
  const resolved = pathPosix.normalize(pathPosix.join(pathPosix.dirname(ownerPart), target))
  if (resolved === '..' || resolved.startsWith('../')) {
    throw new Error('XLSX relationship 指向了包外路径')
  }
  return resolved
}

function relationshipPartPath(ownerPart: string): string {
  return pathPosix.join(
    pathPosix.dirname(ownerPart),
    '_rels',
    `${pathPosix.basename(ownerPart)}.rels`,
  )
}

function describePackage(buffer: Buffer): PackageDescriptor {
  const entries = unzipWorkbook(buffer)
  requireEntry(entries, '[Content_Types].xml')
  const rootRelationships = parseRelationships(
    decodeXml(requireEntry(entries, '_rels/.rels'), '_rels/.rels'),
  )
  const workbookRelationship = rootRelationships.find(
    (item) => item.type.endsWith(OFFICE_DOCUMENT_RELATIONSHIP) && !item.targetMode,
  )
  if (!workbookRelationship) throw new Error('XLSX 未找到 workbook relationship')

  const workbookPath = resolvePartPath('', workbookRelationship.target)
  const workbookXml = decodeXml(requireEntry(entries, workbookPath), workbookPath)
  const workbookRelationshipsPath = relationshipPartPath(workbookPath)
  const workbookRelationships = parseRelationships(
    decodeXml(
      requireEntry(entries, workbookRelationshipsPath),
      workbookRelationshipsPath,
    ),
  )
  const relationshipById = new Map(
    workbookRelationships.map((item) => [item.id, item]),
  )

  const sheets: WorksheetDescriptor[] = []
  parseXml(workbookXml, (tag) => {
    if (tag.local !== 'sheet') return
    const name = attribute(tag, 'name')
    const relationshipId = attribute(tag, 'id')
    if (!name || !relationshipId) return
    const relationship = relationshipById.get(relationshipId)
    if (
      !relationship ||
      relationship.targetMode ||
      !relationship.type.endsWith(WORKSHEET_RELATIONSHIP)
    ) {
      return
    }
    sheets.push({
      name,
      partPath: resolvePartPath(workbookPath, relationship.target),
    })
  })
  if (sheets.length === 0) throw new Error('XLSX 中没有可编辑的 worksheet')
  return { entries, workbookPath, sheets }
}

function columnNumber(columnName: string): number {
  let value = 0
  for (const char of columnName) {
    value = value * 26 + char.charCodeAt(0) - 64
  }
  return value
}

function columnName(column: number): string {
  let value = column
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function parseCellAddress(value: string): CellCoordinate {
  const match = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/.exec(value.trim())
  if (!match) throw new Error(`无效的单元格地址：${value}`)
  const column = columnNumber(match[1].toUpperCase())
  const row = Number(match[2])
  if (column > MAX_EXCEL_COLUMN || row > MAX_EXCEL_ROW) {
    throw new Error(`单元格地址超出 Excel 范围：${value}`)
  }
  return {
    address: `${columnName(column)}${row}`,
    column,
    row,
  }
}

function parseCellRange(value: string): CellRange | undefined {
  const parts = value.trim().split(':')
  if (parts.length > 2 || parts.length === 0) return undefined
  try {
    const first = parseCellAddress(parts[0])
    const second = parseCellAddress(parts[1] ?? parts[0])
    return {
      start: {
        address: `${columnName(Math.min(first.column, second.column))}${Math.min(first.row, second.row)}`,
        column: Math.min(first.column, second.column),
        row: Math.min(first.row, second.row),
      },
      end: {
        address: `${columnName(Math.max(first.column, second.column))}${Math.max(first.row, second.row)}`,
        column: Math.max(first.column, second.column),
        row: Math.max(first.row, second.row),
      },
    }
  } catch {
    return undefined
  }
}

function contains(range: CellRange, cell: CellCoordinate): boolean {
  return (
    cell.column >= range.start.column &&
    cell.column <= range.end.column &&
    cell.row >= range.start.row &&
    cell.row <= range.end.row
  )
}

function completedSpan(node: OpenXmlNode): XmlNodeSpan {
  if (node.closeStart === undefined || node.end === undefined) {
    throw new Error(`XML 节点未完整关闭：${node.name}`)
  }
  return {
    name: node.name,
    local: node.local,
    openStart: node.openStart,
    openEnd: node.openEnd,
    closeStart: node.closeStart,
    end: node.end,
    selfClosing: node.selfClosing,
  }
}

function scanWorksheet(xml: string, target: CellCoordinate): WorksheetScan {
  const scan: WorksheetScan = {
    rows: [],
    targetValueChildren: [],
    formulae: [],
    mergeRefs: [],
    protected: false,
  }
  const stack: OpenXmlNode[] = []
  let parseError: Error | undefined
  const parser = new SaxesParser({ xmlns: true, position: true })

  parser.on('opentag', (tag) => {
    const openEnd = parser.position
    const openStart = xml.lastIndexOf('<', openEnd - 1)
    if (openStart < 0) {
      parseError = new Error(`无法定位 XML 节点：${tag.name}`)
      return
    }
    const parent = stack[stack.length - 1]
    const node: OpenXmlNode = {
      name: tag.name,
      local: tag.local,
      openStart,
      openEnd,
      selfClosing: tag.isSelfClosing,
      tag,
    }
    stack.push(node)

    if (tag.local === 'sheetData') scan.sheetData = node
    if (tag.local === 'dimension') {
      scan.dimension = { span: node, ref: attribute(tag, 'ref') }
    }
    if (tag.local === 'sheetProtection') scan.protected = true
    if (tag.local === 'mergeCell') {
      const ref = attribute(tag, 'ref')
      if (ref) scan.mergeRefs.push(ref)
    }
    if (tag.local === 'row') {
      const row = Number(attribute(tag, 'r'))
      if (Number.isInteger(row) && row > 0) {
        scan.rows.push({ row, span: node, cells: [] })
      }
    }
    if (tag.local === 'c') {
      const rawAddress = attribute(tag, 'r')
      if (!rawAddress) return
      let coordinate: CellCoordinate
      try {
        coordinate = parseCellAddress(rawAddress)
      } catch {
        return
      }
      const row = [...scan.rows].reverse().find((item) => item.span === parent)
      row?.cells.push({ coordinate, span: node })
      if (coordinate.address === target.address) scan.targetCell = node
    }
    if (tag.local === 'f' && parent?.local === 'c') {
      const rawAddress = attribute(parent.tag, 'r')
      if (!rawAddress) return
      scan.formulae.push({
        cellAddress: rawAddress.toUpperCase(),
        type: attribute(tag, 't'),
        sharedIndex: attribute(tag, 'si'),
        ref: attribute(tag, 'ref'),
      })
    }
  })

  parser.on('closetag', (tag) => {
    const node = stack.pop()
    if (!node) {
      parseError = new Error(`XML 关闭节点无对应开始节点：${tag.name}`)
      return
    }
    node.end = parser.position
    node.closeStart = tag.isSelfClosing
      ? node.openEnd
      : xml.lastIndexOf('</', node.end - 1)
    if (node.closeStart < node.openEnd && !tag.isSelfClosing) {
      parseError = new Error(`无法定位 XML 关闭节点：${tag.name}`)
      return
    }
    const parent = stack[stack.length - 1]
    if (
      parent === scan.targetCell &&
      (node.local === 'f' || node.local === 'v' || node.local === 'is')
    ) {
      scan.targetValueChildren.push(completedSpan(node))
    }
  })
  parser.on('doctype', () => {
    parseError = new Error('XLSX worksheet XML 不允许包含 DOCTYPE')
  })
  parser.on('error', (error) => {
    parseError = error
  })
  parser.write(xml).close()
  if (parseError) throw parseError
  return scan
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', '&quot;')
}

function replaceAttribute(
  openingTag: string,
  name: string,
  value: string | undefined,
): string {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(["'])[^"']*\\1`)
  const withoutExisting = openingTag.replace(pattern, '')
  if (value === undefined) return withoutExisting
  return withoutExisting.replace(/\s*\/?>(?=$)/, (ending) => {
    const close = ending.trimStart()
    return ` ${name}="${escapeXmlAttribute(value)}"${close}`
  })
}

function assertSafeFormula(formula: string): string {
  if (!formula.startsWith('=') || formula.length < 2) {
    throw new Error('公式必须以 = 开头')
  }
  if (formula.length > 8192) throw new Error('公式长度超过 Excel 限制')
  if (
    /\[[^\]]+\.xls[xmb]?\][^!]*!/i.test(formula) ||
    /(?:https?|ftp|file):/i.test(formula)
  ) {
    throw new Error('公式不允许引用外部工作簿、URL 或文件')
  }
  if (/\b(?:WEBSERVICE|HYPERLINK|RTD|DDE|CALL|REGISTER\.ID)\s*\(/i.test(formula)) {
    throw new Error('公式包含不允许的外部数据函数')
  }
  if (/\|[^!]*!/.test(formula)) throw new Error('公式不允许使用 DDE 外部数据引用')
  return formula.slice(1)
}

function cellPayload(edit: SpreadsheetCellEdit): { type?: string; xml: string } {
  switch (edit.valueKind) {
    case 'blank':
      return { xml: '' }
    case 'text':
      return {
        type: 'inlineStr',
        xml: `<is><t xml:space="preserve">${escapeXmlText(String(edit.value))}</t></is>`,
      }
    case 'number':
      if (typeof edit.value !== 'number' || !Number.isFinite(edit.value)) {
        throw new Error('写入数字必须是有限数值')
      }
      return { type: 'n', xml: `<v>${edit.value}</v>` }
    case 'boolean':
      if (typeof edit.value !== 'boolean') throw new Error('写入布尔值类型错误')
      return { type: 'b', xml: `<v>${edit.value ? 1 : 0}</v>` }
    case 'formula':
      if (typeof edit.value !== 'string') throw new Error('公式必须是字符串')
      return { xml: `<f>${escapeXmlText(assertSafeFormula(edit.value))}</f>` }
  }
}

function assertEditableTarget(scan: WorksheetScan, target: CellCoordinate): void {
  if (scan.protected) throw new Error('目标 worksheet 已受保护，拒绝修改')
  for (const ref of scan.mergeRefs) {
    const range = parseCellRange(ref)
    if (range && contains(range, target) && range.start.address !== target.address) {
      throw new Error('目标单元格位于合并区域内且不是左上角单元格')
    }
  }
  const sharedRanges = new Map<string, string>()
  for (const formula of scan.formulae) {
    if (formula.type === 'shared' && formula.sharedIndex && formula.ref) {
      sharedRanges.set(formula.sharedIndex, formula.ref)
    }
  }
  for (const formula of scan.formulae) {
    const protectedRef = formula.ref ??
      (formula.sharedIndex ? sharedRanges.get(formula.sharedIndex) : undefined)
    const protectedRange = protectedRef ? parseCellRange(protectedRef) : undefined
    const isComplex =
      formula.type === 'shared' ||
      formula.type === 'array' ||
      formula.type === 'dataTable'
    if (
      isComplex &&
      (formula.cellAddress === target.address ||
        (protectedRange && contains(protectedRange, target)))
    ) {
      throw new Error('目标单元格属于共享公式、数组公式或数据表，拒绝破坏其结构')
    }
  }
}

type XmlPatch = { start: number; end: number; replacement: string }

function applyPatches(xml: string, patches: XmlPatch[]): string {
  const ordered = [...patches].sort((left, right) => right.start - left.start)
  let result = xml
  let lastStart = xml.length + 1
  for (const patch of ordered) {
    if (patch.start < 0 || patch.end < patch.start || patch.end > result.length) {
      throw new Error('内部错误：XML 修改范围无效')
    }
    if (patch.end > lastStart) throw new Error('内部错误：XML 修改范围重叠')
    result = result.slice(0, patch.start) + patch.replacement + result.slice(patch.end)
    lastStart = patch.start
  }
  return result
}

function removeRanges(source: string, ranges: XmlPatch[]): string {
  return applyPatches(source, ranges)
}

function buildExistingCell(
  xml: string,
  scan: WorksheetScan,
  payload: { type?: string; xml: string },
): XmlPatch {
  const targetCell = scan.targetCell
  if (!targetCell) throw new Error('内部错误：目标单元格不存在')
  const span = completedSpan(targetCell)
  let openingTag = xml.slice(span.openStart, span.openEnd)
  openingTag = replaceAttribute(openingTag, 't', payload.type)
  openingTag = openingTag.replace(/\/>$/, '>')

  let preservedInner = span.selfClosing ? '' : xml.slice(span.openEnd, span.closeStart)
  if (!span.selfClosing) {
    const localRanges = scan.targetValueChildren.map((child) => ({
      start: child.openStart - span.openEnd,
      end: child.end - span.openEnd,
      replacement: '',
    }))
    preservedInner = removeRanges(preservedInner, localRanges)
  }
  const closingTag = span.selfClosing
    ? `</${span.name}>`
    : xml.slice(span.closeStart, span.end)
  return {
    start: span.openStart,
    end: span.end,
    replacement: `${openingTag}${payload.xml}${preservedInner}${closingTag}`,
  }
}

function buildNewCell(
  scan: WorksheetScan,
  target: CellCoordinate,
  payload: { type?: string; xml: string },
): XmlPatch {
  const sheetData = scan.sheetData ? completedSpan(scan.sheetData) : undefined
  if (!sheetData) throw new Error('目标 worksheet 缺少 sheetData')
  const prefix = scan.sheetData?.name.includes(':')
    ? `${scan.sheetData.name.split(':')[0]}:`
    : ''
  const type = payload.type ? ` t="${payload.type}"` : ''
  const cellXml = `<${prefix}c r="${target.address}"${type}>${payload.xml}</${prefix}c>`
  const row = scan.rows.find((item) => item.row === target.row)
  if (row) {
    const rowSpan = completedSpan(row.span)
    const nextCell = row.cells.find(
      (item) => item.coordinate.column > target.column,
    )
    const insertionPoint = nextCell?.span.openStart ?? rowSpan.closeStart
    return { start: insertionPoint, end: insertionPoint, replacement: cellXml }
  }

  const nextRow = scan.rows.find((item) => item.row > target.row)
  const insertionPoint = nextRow?.span.openStart ?? sheetData.closeStart
  return {
    start: insertionPoint,
    end: insertionPoint,
    replacement: `<${prefix}row r="${target.row}">${cellXml}</${prefix}row>`,
  }
}

function dimensionPatch(
  xml: string,
  scan: WorksheetScan,
  target: CellCoordinate,
): XmlPatch | undefined {
  if (!scan.dimension?.ref) return undefined
  const range = parseCellRange(scan.dimension.ref)
  if (!range || contains(range, target)) return undefined
  const startColumn = Math.min(range.start.column, target.column)
  const startRow = Math.min(range.start.row, target.row)
  const endColumn = Math.max(range.end.column, target.column)
  const endRow = Math.max(range.end.row, target.row)
  const newRef = `${columnName(startColumn)}${startRow}:${columnName(endColumn)}${endRow}`
  const span = completedSpan(scan.dimension.span)
  const openingTag = xml.slice(span.openStart, span.openEnd)
  return {
    start: span.openStart,
    end: span.openEnd,
    replacement: replaceAttribute(openingTag, 'ref', newRef),
  }
}

function editWorksheetXml(
  xml: string,
  target: CellCoordinate,
  edit: SpreadsheetCellEdit,
): string {
  const scan = scanWorksheet(xml, target)
  assertEditableTarget(scan, target)
  const payload = cellPayload(edit)
  const patches: XmlPatch[] = [
    scan.targetCell
      ? buildExistingCell(xml, scan, payload)
      : buildNewCell(scan, target, payload),
  ]
  if (!scan.targetCell) {
    const patch = dimensionPatch(xml, scan, target)
    if (patch) patches.push(patch)
  }
  const result = applyPatches(xml, patches)
  const verification = scanWorksheet(result, target)
  if (!verification.targetCell) throw new Error('修改后未找到目标单元格')
  const targetXml = result.slice(
    verification.targetCell.openStart,
    completedSpan(verification.targetCell).end,
  )
  if (payload.xml && !targetXml.includes(payload.xml)) {
    throw new Error('修改后目标单元格内容校验失败')
  }
  return result
}

function forceWorkbookRecalculation(xml: string): string {
  const calcPrPattern = /<(?:[A-Za-z_][\w.-]*:)?calcPr\b[^>]*\/?\s*>/
  const existing = calcPrPattern.exec(xml)
  if (existing) {
    let openingTag = replaceAttribute(existing[0], 'fullCalcOnLoad', '1')
    openingTag = replaceAttribute(openingTag, 'forceFullCalc', '1')
    return `${xml.slice(0, existing.index)}${openingTag}${xml.slice(existing.index + existing[0].length)}`
  }
  const closing = /<\/(?:[A-Za-z_][\w.-]*:)?workbook\s*>/.exec(xml)
  if (!closing) throw new Error('无法在 workbook.xml 中设置公式重算标记')
  const prefix = closing[0].includes(':')
    ? `${closing[0].slice(2, closing[0].indexOf(':'))}:`
    : ''
  const calcPr = `<${prefix}calcPr fullCalcOnLoad="1" forceFullCalc="1"/>`
  return `${xml.slice(0, closing.index)}${calcPr}${xml.slice(closing.index)}`
}

function worksheetContainsFormula(xml: string): boolean {
  let containsFormula = false
  parseXml(xml, (tag) => {
    if (tag.local === 'f') containsFormula = true
  })
  return containsFormula
}

function assertPackagePartsPreserved(
  before: Unzipped,
  after: Unzipped,
  changedParts: ReadonlyMap<string, Uint8Array>,
): void {
  const beforeNames = Object.keys(before).sort()
  const afterNames = Object.keys(after).sort()
  if (beforeNames.length !== afterNames.length) {
    throw new Error('修改后 XLSX 内部部件数量发生变化')
  }
  for (let i = 0; i < beforeNames.length; i++) {
    if (beforeNames[i] !== afterNames[i]) {
      throw new Error('修改后 XLSX 内部部件名称发生变化')
    }
  }
  for (const name of beforeNames) {
    const expected = changedParts.get(name) ?? before[name]
    if (!bytesEqual(expected, requireEntry(after, name))) {
      throw new Error(`修改后出现非预期部件变化：${name}`)
    }
  }
}

export function inspectXlsxPackage(buffer: Buffer): XlsxPackageInfo {
  const descriptor = describePackage(buffer)
  for (const sheet of descriptor.sheets) requireEntry(descriptor.entries, sheet.partPath)
  return { sheetNames: descriptor.sheets.map((sheet) => sheet.name) }
}

export function editXlsxCell(
  buffer: Buffer,
  edit: SpreadsheetCellEdit,
): XlsxEditResult {
  const descriptor = describePackage(buffer)
  const sheet = descriptor.sheets.find((item) => item.name === edit.sheetName)
  if (!sheet) {
    throw new Error(
      `未找到 worksheet「${edit.sheetName}」，可用 worksheet：${descriptor.sheets
        .map((item) => item.name)
        .join('、')}`,
    )
  }
  const target = parseCellAddress(edit.cellAddress)
  const originalBytes = requireEntry(descriptor.entries, sheet.partPath)
  const originalXml = decodeXml(originalBytes, sheet.partPath)
  const modifiedXml = editWorksheetXml(originalXml, target, {
    ...edit,
    cellAddress: target.address,
  })
  const modifiedBytes = strToU8(modifiedXml)
  const changedParts = new Map<string, Uint8Array>([[sheet.partPath, modifiedBytes]])
  const outputEntries: Unzipped = { ...descriptor.entries, [sheet.partPath]: modifiedBytes }
  const workbookNeedsRecalculation =
    edit.valueKind === 'formula' ||
    descriptor.sheets.some((item) =>
      worksheetContainsFormula(
        item.partPath === sheet.partPath
          ? originalXml
          : decodeXml(
              requireEntry(descriptor.entries, item.partPath),
              item.partPath,
            ),
      ),
    )
  if (workbookNeedsRecalculation) {
    const workbookBytes = requireEntry(descriptor.entries, descriptor.workbookPath)
    const workbookXml = decodeXml(workbookBytes, descriptor.workbookPath)
    const recalculationBytes = strToU8(forceWorkbookRecalculation(workbookXml))
    outputEntries[descriptor.workbookPath] = recalculationBytes
    changedParts.set(descriptor.workbookPath, recalculationBytes)
  }
  const output = Buffer.from(zipSync(outputEntries, { level: 6 }))
  const verifiedEntries = unzipWorkbook(output)
  assertPackagePartsPreserved(descriptor.entries, verifiedEntries, changedParts)
  return {
    buffer: output,
    sheetNames: descriptor.sheets.map((item) => item.name),
    changedPartPath: sheet.partPath,
  }
}
