import { Hono } from 'hono'
import type { AgentSkillsResponse } from '@data-agent/shared'
import { listAvailableAgentSkills } from '../services/skill-registry'

export function createSkillsRoutes(): Hono {
  const app = new Hono()

  app.get('/skills', (c) => {
    try {
      const response: AgentSkillsResponse = {
        skills: listAvailableAgentSkills(),
      }
      return c.json(response)
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : 'Skill 列表加载失败',
        },
        500,
      )
    }
  })

  return app
}
