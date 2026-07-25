import { parseExcelBuffer } from '../tools/excel'
import { chunkParsedExcelToTexts } from './excel-chunk'
import { embedTexts } from './embeddings'

export type FileIngestStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type VectorChunk = {
  text: string
  /** 与 text 对应的嵌入向量 */
  vector: number[]
}

export type FileIngestRecord = {
  fileId: string
  status: FileIngestStatus
  fileName?: string
  error?: string
  /** 仅在 completed 时有值 */
  chunks?: VectorChunk[]
  /** 当前已请求建立索引的工作簿版本 */
  requestedVersion: number
  /** chunks 对应的工作簿版本 */
  indexedVersion?: number
  createdAt: number
  updatedAt: number
}

const store = new Map<string, FileIngestRecord>()

function now() {
  return Date.now()
}

export function createPendingFileRecord(
  fileId: string,
  fileName?: string,
): FileIngestRecord {
  const t = now()
  const rec: FileIngestRecord = {
    fileId,
    status: 'pending',
    fileName,
    requestedVersion: 0,
    createdAt: t,
    updatedAt: t,
  }
  store.set(fileId, rec)
  return rec
}

export function getFileRecord(fileId: string): FileIngestRecord | undefined {
  return store.get(fileId)
}

function touch(rec: FileIngestRecord) {
  rec.updatedAt = now()
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

/**
 * 按与 query 的向量相似度取 topK 段文本（仅 completed 任务有效）。
 */
export async function retrieveTopChunksByQuery(
  fileId: string,
  query: string,
  topK: number,
): Promise<string[]> {
  const rec = store.get(fileId)
  if (rec?.status !== 'completed' || !rec.chunks?.length) return []

  const [qVec] = await embedTexts([query])
  const scored = rec.chunks.map((c) => ({
    text: c.text,
    score: cosineSimilarity(qVec, c.vector),
  }))
  scored.sort((x, y) => y.score - x.score)
  return scored.slice(0, topK).map((s) => s.text)
}

export async function runIngestExcelJob(
  fileId: string,
  buffer: Buffer,
  fileName?: string,
  version = 0,
): Promise<void> {
  const rec = store.get(fileId)
  if (!rec) {
    throw new Error('内部错误：记录不存在')
  }

  if (version < rec.requestedVersion) return
  rec.requestedVersion = version
  rec.status = 'processing'
  rec.error = undefined
  touch(rec)

  try {
    const parsed = parseExcelBuffer(buffer, {
      fileName,
      allSheets: true,
    })
    const texts = chunkParsedExcelToTexts(parsed)
    if (texts.length === 0) {
      throw new Error('解析结果为空，无法建立向量索引')
    }

    const vectors = await embedTexts(texts)
    if (vectors.length !== texts.length) {
      throw new Error('向量化结果条数与文本块不一致')
    }

    if (rec.requestedVersion !== version) return
    rec.chunks = texts.map((text, i) => ({ text, vector: vectors[i] }))
    rec.status = 'completed'
    rec.indexedVersion = version
    rec.error = undefined
    touch(rec)
  } catch (e) {
    if (rec.requestedVersion !== version) return
    rec.status = 'failed'
    rec.chunks = undefined
    rec.indexedVersion = undefined
    rec.error = e instanceof Error ? e.message : '文件处理失败'
    touch(rec)
    throw e instanceof Error ? e : new Error(String(e))
  }
}

export function clearFileIngestStoreForTests(): void {
  store.clear()
}
