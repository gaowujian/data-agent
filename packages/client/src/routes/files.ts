import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import type { WorkbookFileResponse } from '@data-agent/shared'
import {
  createPendingFileRecord,
  getFileRecord,
  runIngestExcelJob,
} from '../services/file-ingest'
import {
  getStoredArtifact,
  getWorkbookRecord,
  storeUploadedWorkbook,
  toWorkbookFileResponse,
} from '../services/workbook-store'
import { EXCEL_MAX_FILE_BYTES } from '../services/excel-parser'

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function fileResponse(fileId: string): WorkbookFileResponse | undefined {
  const workbook = getWorkbookRecord(fileId)
  const index = getFileRecord(fileId)
  if (workbook) {
    return toWorkbookFileResponse(workbook, {
      status: index?.status ?? 'pending',
      error: index?.error,
    })
  }
  if (!index) return undefined
  return {
    fileId,
    fileName: index.fileName ?? 'upload.xls',
    status: 'ready',
    sheetNames: [],
    sheets: [],
    indexStatus: index.status,
    indexError: index.error,
  }
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'modified.xlsx'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export function createFilesRoutes(): Hono {
  const app = new Hono()

  app.get('/files/:fileId', (c) => {
    const response = fileResponse(c.req.param('fileId'))
    return response
      ? c.json(response)
      : c.json({ error: '未找到该 fileId' }, 404)
  })

  app.post('/files', async (c) => {
    let fileId: string | undefined
    try {
      const form = await c.req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return c.json({ error: '请使用 multipart 字段名 file 上传文件' }, 400)
      }

      const fileName = file.name?.trim() || 'upload.xlsx'
      const lower = fileName.toLowerCase()
      if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
        return c.json({ error: '仅支持 .xlsx 或 .xls 文件' }, 400)
      }
      if (file.size > EXCEL_MAX_FILE_BYTES) {
        const mb = Math.floor(EXCEL_MAX_FILE_BYTES / (1024 * 1024))
        return c.json({ error: `文件过大，单文件不超过 ${mb}MB` }, 400)
      }

      fileId = randomUUID()
      const buffer = Buffer.from(await file.arrayBuffer())
      createPendingFileRecord(fileId, fileName)
      if (lower.endsWith('.xlsx')) {
        storeUploadedWorkbook(fileId, buffer, fileName)
      }

      void runIngestExcelJob(fileId, buffer, fileName, 0).catch(() => undefined)
      const response = fileResponse(fileId)
      if (!response) throw new Error('上传记录创建失败')
      return c.json(response)
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件上传失败'
      return c.json({ error: message, ...(fileId ? { fileId } : {}) }, 400)
    }
  })

  app.get('/artifacts/:artifactId/download', (c) => {
    const artifact = getStoredArtifact(c.req.param('artifactId'))
    if (!artifact) return c.json({ error: '下载产物不存在或已失效' }, 404)
    return c.body(new Uint8Array(artifact.buffer), 200, {
      'Content-Type': XLSX_MIME,
      'Content-Disposition': contentDisposition(artifact.fileName),
      'Cache-Control': 'no-store',
      'Content-Length': String(artifact.buffer.byteLength),
    })
  })

  return app
}
