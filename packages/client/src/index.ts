import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  createChatRoutes,
  type ChatRoutesDependencies,
} from './routes/chat'
import { createFilesRoutes } from './routes/files'
import { createSkillsRoutes } from './routes/skills'

export type AppDependencies = ChatRoutesDependencies

export function createApp(dependencies: AppDependencies = {}): Hono {
  const app = new Hono()

  app.use(
    '*',
    cors({
      origin: ['http://localhost:5173'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept'],
    }),
  )

  app.route('/api', createFilesRoutes())
  app.route('/api', createSkillsRoutes())
  app.route('/api', createChatRoutes(dependencies))

  return app
}

export default createApp()
