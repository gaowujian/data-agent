import { describe, expect, it } from 'vitest'
import { createApp } from './index'

describe('app routes', () => {
  it('mounts resource routes and sends regular chat through the agent runner', async () => {
    const app = createApp({
      generalAgentStreamRunner: async function* () {
        yield 'agent response'
      },
    })

    const chatResponse = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', text: 'hello' }],
      }),
    })
    expect(chatResponse.status).toBe(200)
    await expect(chatResponse.json()).resolves.toEqual({
      text: 'agent response',
    })

    const fileResponse = await app.request('/api/files/missing')
    expect(fileResponse.status).toBe(404)
  })
})
