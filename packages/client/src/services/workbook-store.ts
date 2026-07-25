import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type {
  DownloadArtifact,
  SpreadsheetCellEdit,
  WorkbookFileResponse,
} from '@data-agent/shared'
import { editXlsxCell, inspectXlsxPackage } from './xlsx-ooxml'
import {
  createWorkbookContext,
  type WorkbookContext,
} from './workbook-context'

export type WorkbookRecord = {
  fileId: string
  fileName: string
  originalBuffer: Buffer
  currentBuffer: Buffer
  sheetNames: string[]
  context: WorkbookContext
  currentVersion: number
  createdAt: number
  updatedAt: number
}

export type StoredArtifact = DownloadArtifact & {
  fileId: string
  buffer: Buffer
  createdAt: number
}

export type WorkbookEditCommit = {
  artifact: DownloadArtifact
  buffer: Buffer
  sheetNames: string[]
}

const workbookStore = new Map<string, WorkbookRecord>()
const artifactStore = new Map<string, StoredArtifact>()

function now(): number {
  return Date.now()
}

function normalizedXlsxName(fileName: string): string {
  const safeName = basename(fileName.trim() || 'upload.xlsx')
  return safeName.toLowerCase().endsWith('.xlsx') ? safeName : `${safeName}.xlsx`
}

function artifactFileName(fileName: string, version: number): string {
  const normalized = normalizedXlsxName(fileName)
  const base = normalized.slice(0, -'.xlsx'.length)
  return `${base}-modified-v${version}.xlsx`
}

export function storeUploadedWorkbook(
  fileId: string,
  buffer: Buffer,
  fileName: string,
): WorkbookRecord {
  if (!fileName.toLowerCase().endsWith('.xlsx')) {
    throw new Error('单元格修改功能仅支持 .xlsx 文件')
  }
  const info = inspectXlsxPackage(buffer)
  const context = createWorkbookContext(buffer, fileName)
  const timestamp = now()
  const record: WorkbookRecord = {
    fileId,
    fileName: normalizedXlsxName(fileName),
    originalBuffer: Buffer.from(buffer),
    currentBuffer: Buffer.from(buffer),
    sheetNames: info.sheetNames,
    context,
    currentVersion: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  workbookStore.set(fileId, record)
  return record
}

export function getWorkbookRecord(fileId: string): WorkbookRecord | undefined {
  return workbookStore.get(fileId)
}

export function getStoredArtifact(artifactId: string): StoredArtifact | undefined {
  return artifactStore.get(artifactId)
}

export function commitWorkbookCellEdit(
  fileId: string,
  expectedVersion: number,
  edit: SpreadsheetCellEdit,
): WorkbookEditCommit {
  const record = workbookStore.get(fileId)
  if (!record) throw new Error('未找到可编辑的 XLSX，请重新上传文件')
  if (record.currentVersion !== expectedVersion) {
    throw new Error('文件已被其他请求更新，请基于最新版本重试')
  }

  const result = editXlsxCell(record.currentBuffer, edit)
  const context = createWorkbookContext(result.buffer, record.fileName)
  if (record.currentVersion !== expectedVersion) {
    throw new Error('文件已被其他请求更新，本次修改未提交')
  }

  const version = expectedVersion + 1
  const artifactId = randomUUID()
  const fileName = artifactFileName(record.fileName, version)
  const artifact: StoredArtifact = {
    artifactId,
    fileId,
    fileName,
    downloadUrl: `/api/artifacts/${artifactId}/download`,
    version,
    buffer: Buffer.from(result.buffer),
    createdAt: now(),
  }
  artifactStore.set(artifactId, artifact)
  record.currentBuffer = Buffer.from(result.buffer)
  record.currentVersion = version
  record.sheetNames = result.sheetNames
  record.context = context
  record.updatedAt = artifact.createdAt

  return {
    artifact: {
      artifactId: artifact.artifactId,
      fileName: artifact.fileName,
      downloadUrl: artifact.downloadUrl,
      version: artifact.version,
    },
    buffer: Buffer.from(record.currentBuffer),
    sheetNames: [...record.sheetNames],
  }
}

export function toWorkbookFileResponse(
  record: WorkbookRecord,
  index: {
    status: WorkbookFileResponse['indexStatus']
    error?: string
  },
): WorkbookFileResponse {
  return {
    fileId: record.fileId,
    fileName: record.fileName,
    status: 'ready',
    sheetNames: [...record.sheetNames],
    sheets: record.context.sheets.map((sheet) => ({
      ...sheet,
      headers: [...sheet.headers],
    })),
    indexStatus: index.status,
    indexError: index.error,
  }
}

export function clearWorkbookStoreForTests(): void {
  workbookStore.clear()
  artifactStore.clear()
}
