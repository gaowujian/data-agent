/*
 * @Author: Andrew Q
 * @Date: 2026-07-18 21:45:16
 * @LastEditors: Andrew Q
 * @LastEditTime: 2026-07-22 10:59:58
 * @Description: api
 */
import {
  agentSkillsResponseSchema,
  workbookFileResponseSchema,
  type AgentSkill,
  type WorkbookFileResponse,
} from '@data-agent/shared'

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function readErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('error' in value)) return undefined
  const error = (value as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? error : undefined
}

export async function fetchAgentSkills(): Promise<AgentSkill[]> {
  const response = await fetch('/api/skills')
  const payload = await readJson(response)

  if (!response.ok) {
    throw new Error(readErrorMessage(payload) ?? 'Skill 列表加载失败')
  }

  const parsed = agentSkillsResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Skill 列表响应格式不合法')
  }

  return parsed.data.skills
}

export async function uploadSpreadsheet(
  file: File,
): Promise<WorkbookFileResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('/api/files', {
    method: 'POST',
    body: formData,
  })
  const payload = await readJson(response)

  if (!response.ok) {
    throw new Error(readErrorMessage(payload) ?? '文件上传失败')
  }

  const parsed = workbookFileResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('文件上传响应格式不合法')
  }

  return parsed.data
}

export async function fetchWorkbookFile(
  fileId: string,
): Promise<WorkbookFileResponse> {
  const response = await fetch(`/api/files/${encodeURIComponent(fileId)}`)
  const payload = await readJson(response)

  if (!response.ok) {
    throw new Error(readErrorMessage(payload) ?? '文件状态查询失败')
  }

  const parsed = workbookFileResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('文件状态响应格式不合法')
  }

  return parsed.data
}
