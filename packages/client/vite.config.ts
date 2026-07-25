/*
 * @Author: Andrew q
 * @Date: 2026-04-29 17:43:28
 * @LastEditors: Andrew q
 * @LastEditTime: 2026-04-29 20:56:56
 * @Description: vite config
 */
import devServer from '@hono/vite-dev-server'
import nodeAdapter from '@hono/vite-dev-server/node'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode === 'development' ? 'dev' : mode, process.cwd(), [
    'SILICONFLOW_',
    'LLM_',
  ])
  for (const name of ['SILICONFLOW_API_KEY', 'LLM_MODEL'] as const) {
    if (!process.env[name] && env[name]) process.env[name] = env[name]
  }

  return {
    plugins: [
      devServer({
        entry: 'src/index.ts',
        adapter: nodeAdapter,
      }),
    ],
    server: {
      port: 3001,
      strictPort: true,
    },
  }
})
