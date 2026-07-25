import { createMiddleware } from 'langchain'
import type { ResolvedAgentSkills } from '../services/skill-registry'

export function createPreloadedSkillMiddleware(skills: ResolvedAgentSkills) {
  if (!skills.instructions) return []

  const selectedNames = skills.names.join('、')
  return [
    createMiddleware({
      name: 'PreloadedSkillInstructions',
      wrapModelCall: (request, handler) =>
        handler({
          ...request,
          systemMessage: request.systemMessage.concat(`
## 本轮 Skill 执行约束

已由服务端加载 ${selectedNames} 的完整 SKILL.md 正文，它位于本系统提示的前文，直接遵循即可。
上文 Skills System 的渐进加载说明不适用于本轮：不要调用 read_file、ls、glob 或 grep 重新读取 SKILL.md，也不要把工具调用写成普通文本。
只有当已加载的 Skill 正文明确要求同一 Skill 目录中的其他支持文件时，才可读取该支持文件。`),
        }),
    }),
  ]
}
