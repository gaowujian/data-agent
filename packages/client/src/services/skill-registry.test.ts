import { describe, expect, it } from 'vitest'
import {
  listAvailableAgentSkills,
  resolveAgentSkills,
  UnknownAgentSkillsError,
} from './skill-registry'

describe('agent skill registry', () => {
  it('加载前端选中的 data-analysis Skill 正文', async () => {
    expect(listAvailableAgentSkills()).toContainEqual({
      name: 'data-analysis',
      description:
        '分析表格或业务数据中的趋势、异常和可执行建议；当用户要求数据解读、指标分析或结论摘要时使用。',
    })

    await expect(resolveAgentSkills(['data-analysis'])).resolves.toMatchObject({
      names: ['data-analysis'],
      sources: ['/data-analysis/'],
      instructions: expect.stringContaining('# 数据分析'),
    })
  })

  it('拒绝未在项目 Skill 目录中的名称', async () => {
    await expect(resolveAgentSkills(['not-installed'])).rejects.toBeInstanceOf(
      UnknownAgentSkillsError,
    )
  })
})
