import { createDeepAgent, StateBackend } from 'deepagents'
import { createChatModel } from './llm'
import { createPreloadedSkillMiddleware } from './preloaded-skill-middleware'
import {
  createSkillPermissions,
  createSkillsBackend,
  type ResolvedAgentSkills,
} from '../services/skill-registry'

export type AgentChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type GeneralAgentStreamInput = {
  messages: AgentChatMessage[]
  skills: ResolvedAgentSkills
  signal: AbortSignal
}

export type GeneralAgentStreamRunner = (
  input: GeneralAgentStreamInput,
) => AsyncIterable<string>

function createGeneralAgent(skills: ResolvedAgentSkills) {
  const skillSection = skills.instructions
    ? `\n\n以下是本轮已由服务端完整加载的 Skill 正文，直接遵循其指令：\n${skills.instructions}\n不要重新读取 SKILL.md；仅当正文明确要求同一 Skill 目录中的其他支持文件时，才可读取该文件。`
    : ''
  return createDeepAgent({
    model: createChatModel(),
    systemPrompt: {
      prefix: `你是通用中文助手，请直接、准确地回答用户的问题。${skillSection}`,
      base: null,
    },
    backend: skills.names.length > 0 ? createSkillsBackend() : new StateBackend(),
    skills: skills.sources,
    permissions: createSkillPermissions(skills.names),
    middleware: createPreloadedSkillMiddleware(skills),
  })
}

export const streamGeneralAgent: GeneralAgentStreamRunner = async function* ({
  messages,
  skills,
  signal,
}) {
  const agent = createGeneralAgent(skills)
  const run = await agent.streamEvents(
    { messages },
    { version: 'v3', signal },
  )

  for await (const message of run.messages) {
    for await (const delta of message.text) {
      if (delta) yield delta
    }
  }
}
