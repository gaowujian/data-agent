# Hono.js 与 Deep Agents 联动方式调研

访问日期：2026-07-25  
适用仓库：`data-agent/packages/client`  
本地锁定版本：Hono `4.12.15`、`@hono/node-server` `2.0.0`、`@hono/zod-validator` `0.7.6`、Deep Agents `1.11.1`、LangGraph `1.4.8`

## 结论

最合理的联动不是让 Hono route 直接理解 Deep Agents 的全部生命周期，而是保留一个很薄的边界：

```text
HTTP 请求
  -> Hono：认证、限流/体积限制、Zod 校验、HTTP 状态码
  -> chat runner：选择 Agent、准备 RAG/Skill/请求级上下文
  -> Deep Agent：invoke / streamEvents、tool、middleware、checkpointer/store
  -> chat runner：转换为项目内部事件
  -> Hono：JSON 或 SSE 编码、断连取消、公开错误
```

`createDeepAgent()` 返回的是已经编译好的 LangGraph，因此 Hono 不需要额外的 Agent runtime；普通接口调用 `invoke()`，流式接口消费 `streamEvents(..., { version: "v3" })` 即可。Deep Agents 官方明确说明返回值是 compiled LangGraph，并原生支持 streaming 与 checkpointer（[Deep Agents README](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/README.md#L129-L138)）。

对当前仓库，最小可落地调整顺序是：

1. 把两个流式 route 的 schema 校验移到 `streamSSE()` 之前。
2. 把 Agent `key` 收紧为服务端允许的枚举，未知值返回 400，不再静默降级到 general Agent。
3. 让普通 Data Agent 调用也接收并传递 `AbortSignal`；外部 `fetch` 同样传递该 signal。
4. 下一次继续修改聊天链路时，再把 RAG 准备和 Agent 分派从 `routes/chat.ts` 抽到唯一一个 `agents/chat-runner.ts`。
5. 暂不引入 checkpointer/store；等产品明确要“服务端保存会话”或 HITL 后再加。

## 一、职责边界

### Hono 只负责 transport

Hono route 应负责：

- 认证、租户/用户身份和资源授权；
- 请求体大小限制与 Zod 校验；
- 把 HTTP DTO 转成 runner 输入；
- 把 runner 结果编码为 JSON 或 SSE；
- 把客户端断连转换成 `AbortSignal`；
- 在流尚未开始时返回 HTTP 错误，在流开始后返回稳定的 SSE `error` 事件。

Agent 不应接收 Hono `Context`、直接写 `Response`，也不应知道 SSE event 名称。这样 Agent 可由 Hono、脚本、测试或其他 transport 复用。

### Deep Agents 负责 Agent composition

model、tools、system prompt、middleware、subagents、backend、skills、permissions、checkpointer 和 store 都应在 `agents/` 内由 `createDeepAgent()` 组合。Deep Agents `1.11.1` 的参数和实现确实把这些配置集中在同一个 composition root，并最终原样把 `checkpointer`、`store` 交给底层 `createAgent()`（[参数解构](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/libs/deepagents/src/agent.ts#L220-L238)、[底层组装](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/libs/deepagents/src/agent.ts#L528-L548)）。

### chat runner 只负责应用编排

当前 `routes/chat.ts` 同时承担了 HTTP/SSE、RAG 查询、Skill 解析、Agent 选择、结果后处理。继续扩展时，只需要一个 `agents/chat-runner.ts`，负责：

- 基于已经校验、已经授权的 `agentKey` 做确定性 dispatch；
- 准备 workbook/RAG/Skill 上下文；
- 调用对应 Agent；
- 输出项目内部的 `AsyncIterable<ChatEvent>`。

不要再加一套 `controller -> use-case -> service -> gateway` 转发链；当前规模用一个 runner 已经足够。

## 二、请求校验必须发生在开始 SSE 之前

`@hono/zod-validator` 会在 handler 前执行 `safeParseAsync()`，失败时直接返回 HTTP 400，成功值才交给 handler（[zod-validator `0.7.6` 实现](https://github.com/honojs/middleware/blob/da024821e3d1211f9a280b6cceca78654f99d26b/packages/zod-validator/src/index.ts#L125-L167)）。因此推荐：

```ts
app.post(
  '/chat/stream',
  zValidator('json', chatStreamRequestSchema),
  (c) => {
    const input = c.req.valid('json')
    return streamSSE(c, async (sse) => {
      // 此处只处理运行期流事件
    })
  },
)
```

当前 `/chat/stream` 和 `/chat/stream/v2` 在 `streamSSE()` 回调内部执行 `c.req.json()` 与 schema `parse()`。这意味着 JSON/schema 错误发生时 SSE 响应已经建立，只能以 HTTP 200 + `event:error` 表达；而 `/chat` 使用 `zValidator` 返回 HTTP 400。建议统一为：

- **开始流之前**：非法 JSON、schema 错误、未知 Agent、未授权 file/thread/skill 返回 4xx JSON；
- **开始流之后**：模型、工具、外部服务或序列化失败发送脱敏后的 `event:error`，随后关闭流。

Hono 的 `streamSSE()` 会先设置 `text/event-stream` 等响应头，并在流回调结束或抛错后关闭 writer；一旦进入回调就不适合再改变 HTTP 状态码（[Hono `streamSSE` 实现](https://github.com/honojs/hono/blob/f774f8df49e7ec7e205f15c5076a37132c515ebf/src/helper/streaming/sse.ts#L47-L99)）。

同时应给聊天 JSON 设置合理的 `bodyLimit`，避免把无限消息历史送入内存与模型。Hono 内置的 body-limit middleware 会处理 `Content-Length` 和 chunked body，并在超限时返回 413（[Hono body-limit 实现](https://github.com/honojs/hono/blob/f774f8df49e7ec7e205f15c5076a37132c515ebf/src/middleware/body-limit/index.ts#L25-L95)）。具体大小应按现有 UI 与模型上限测量后确定，不在本次调研中猜一个数。

## 三、普通响应与 SSE 的正确桥接

### 普通 JSON

没有逐 token 展示需求时，runner 直接调用 `agent.invoke(input, config)`，从最终 state 提取结果，再由 Hono 返回 JSON。当前 Data Agent 已采用这个方向；普通 general chat 目前是“启动流再全部收集”，功能正确，但没有必要为了 JSON 响应先走 token 流。

普通请求也要传递 `signal`：

```ts
const result = await agent.invoke(
  { messages },
  { signal: input.signal },
)
```

当前 `/chat` 的 general 路径会传 `c.req.raw.signal`，但 Data Agent 的 `runDataAgent()` 输入没有 signal，浏览器断连后 Data Agent 仍可能继续消耗模型资源。

### SSE

LangGraph `1.4.8` 的 v3 stream 为每条 AI message 提供 `.text`、`.reasoning`、`.usage` 等投影，`run.messages` 是这些 message stream 的异步迭代器（[GraphRunStream `messages`](https://github.com/langchain-ai/langgraphjs/blob/3dccad1391e173eead64f9e2d6dd977fdc345f7d/libs/langgraph-core/src/stream/run-stream.ts#L258-L278)）。当前仓库消费 `run.messages -> message.text` 是与锁定版本一致的用法。

Hono 的 `writeSSE()` 会按 SSE 格式拆分多行 `data`，并 `await` 底层 writer，因此 route 应逐事件 `await sse.writeSSE(...)`，不要无等待地批量写入（[Hono SSE 编码](https://github.com/honojs/hono/blob/f774f8df49e7ec7e205f15c5076a37132c515ebf/src/helper/streaming/sse.ts#L6-L44)）。

建议 Deep Agent 层输出项目内部事件，而不是输出 SSE 字符串：

```ts
type ChatEvent =
  | { type: 'markdown'; data: string }
  | { type: 'download'; data: DownloadArtifact }
  | { type: 'chart'; data: Record<string, unknown> }
```

route 再统一映射为当前前端已消费的 `event:message`。EOF 已经能表示正常完成；除非前端需要携带 usage、finish reason 或支持重连，不必提前增加 `done`、heartbeat、event id 与 replay 机制。

## 四、取消与断连

当前 Node adapter 链路是成立的：

1. `@hono/node-server@2.0.0` 在客户端连接提前关闭时中止底层 Request signal（[close handler](https://github.com/honojs/node-server/blob/58c9355998b3b202bf7eb22b1505a2d4d847c3b0/src/listener.ts#L88-L100)、[Request AbortController](https://github.com/honojs/node-server/blob/58c9355998b3b202bf7eb22b1505a2d4d847c3b0/src/request.ts#L381-L397)）。
2. 当前 route 把 `c.req.raw.signal` 传入 `streamEvents()`。
3. LangGraph 会把调用方 signal 与内部 AbortController 合并，流对象自身也提供 `abort()` 和 `signal`（[signal 合并](https://github.com/langchain-ai/langgraphjs/blob/3dccad1391e173eead64f9e2d6dd977fdc345f7d/libs/langgraph-core/src/pregel/index.ts#L1991-L2038)、[GraphRunStream abort API](https://github.com/langchain-ai/langgraphjs/blob/3dccad1391e173eead64f9e2d6dd977fdc345f7d/libs/langgraph-core/src/stream/run-stream.ts#L341-L357)）。
4. Hono 的 response stream 被取消时会触发 `StreamingApi.abort()`，并支持 `sse.onAbort()` 订阅（[Hono StreamingApi](https://github.com/honojs/hono/blob/f774f8df49e7ec7e205f15c5076a37132c515ebf/src/utils/stream.ts#L21-L43)、[`onAbort`](https://github.com/honojs/hono/blob/f774f8df49e7ec7e205f15c5076a37132c515ebf/src/utils/stream.ts#L82-L95)）。

最小实现继续传 `c.req.raw.signal` 即可。若以后更换 adapter，或要把“response reader 被取消”和“request signal”显式合并，可在 `streamSSE` 内用一个本地 `AbortController` 配合 `sse.onAbort()`，再把合并后的 signal 给 runner。

只把 signal 交给 LangGraph 还不够：自定义 tool/service 中的长耗时 I/O 也必须接收 signal。当前 `searchWeb()` 的 `fetch()` 没有传 signal，所以客户端断连时图执行会被取消，但已发出的 Bocha HTTP 请求未必立即停止。下一次修改该链路时，将 runner signal 透传到 tool 和 `fetch(..., { signal })`。

中止是正常控制流：signal 已 aborted 时不要再发送 `error` 事件。当前流式 route 已有这层判断，应保留。

## 五、流内错误协议

Hono 的 streaming helper 在 callback 抛错后无法把响应改成新的 JSON/HTTP 状态；其可选 `onError` 甚至会直接把 `Error.message` 写入 SSE（[实现](https://github.com/honojs/hono/blob/f774f8df49e7ec7e205f15c5076a37132c515ebf/src/helper/streaming/sse.ts#L47-L67)）。项目应自己捕获并映射为稳定协议：

```json
{
  "code": "AGENT_FAILED",
  "message": "Agent 调用失败",
  "requestId": "..."
}
```

- 服务端日志记录原始 error、cause、agent key、request id；
- 客户端只收到白名单 code 和安全 message；
- 鉴权失败、未知 Agent、非法 fileId 等可预期问题必须在流前返回 4xx；
- AbortError/断连不记录为业务失败，也不写 SSE error。

当前 `publicServiceError()` 除鉴权错误外会把任意 `Error.message` 返回给前端，可能暴露模型供应商、文件路径或内部实现信息。建议只对白名单业务错误公开原文，其他异常使用固定 fallback。

## 六、Agent 选择与 dispatch

顶层 Agent 选择应是**确定性的服务端 dispatch**，不是交给模型猜：

```ts
switch (input.agent) {
  case 'general':
    return runGeneral(input)
  case 'data':
    return runData(input)
  case 'web-research':
    return runWebResearch(input)
}
```

Deep Agents 的 `subagents`/`task` 用于一个 Agent 运行内部的委派，不等价于 HTTP 顶层的授权与路由。Deep Agents 默认自带 `write_todos`、文件系统工具和 `task` subagent 能力（[官方功能列表](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/README.md#L24-L32)）。

当前 `chatStreamRequestSchema` 把 `key` 接成 `unknown` 再转字符串，route 只识别 `data-agent`，其他任意值都会进入 general Agent；`/chat/stream/v2` 又固定走 web research。最小改法是让共享 schema 使用允许值的枚举或 discriminated union，并在 runner 中集中 switch。不要做动态模块加载或通用 Agent registry。

dispatch 前必须先完成认证与资源授权：客户端提供的 `fileId`、`threadId`、skills 和 agent key 都只能是“请求”，不能直接成为权限。服务端应确认当前用户能访问相应文件和会话后，再把真实资源句柄/ID 注入 tool。

## 七、checkpointer、thread 与 store

三者不要混用：

| 能力 | 作用域 | 用途 |
| --- | --- | --- |
| `checkpointer` | 同一个 `thread_id` | 保存图 state、消息、interrupt/checkpoint；短期/线程级记忆 |
| `thread_id` | 一串相关 runs | 定位同一会话的 checkpoint |
| `store` | 跨 thread | 用户偏好、长期知识或 Deep Agents 持久文件等长期记忆 |

LangGraph 官方说明：启用 checkpointer 后，每个 super-step 会保存 checkpoint；调用时必须在 `configurable.thread_id` 中提供 thread id（[Persistence](https://github.com/langchain-ai/langgraphjs/blob/3dccad1391e173eead64f9e2d6dd977fdc345f7d/docs/docs/concepts/persistence.md#L1-L13)）。短期记忆需要 checkpointer + thread id，同一 thread 的后续调用会自动包含原消息历史（[Memory](https://github.com/langchain-ai/langgraphjs/blob/3dccad1391e173eead64f9e2d6dd977fdc345f7d/docs/docs/agents/memory.md#L26-L83)）；store 则用于跨会话数据，并可从 tool 的运行 config 中访问（[long-term memory](https://github.com/langchain-ai/langgraphjs/blob/3dccad1391e173eead64f9e2d6dd977fdc345f7d/docs/docs/agents/memory.md#L89-L167)）。Deep Agents 的公开类型也明确区分 `checkpointer` 与 `store`（[类型定义](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/libs/deepagents/src/types.ts#L592-L605)）。

当前仓库每次请求都由前端提交完整 messages，且未配置 checkpointer/store。这是无服务端会话记忆的无状态模式，现阶段可继续保持。不要为了“以后可能需要”先加内存 saver。

需要服务端记忆时再做以下最小升级：

1. 在 app composition root 创建并复用一个生产级 checkpointer，注入 Agent factory；不要每请求 new 一个 saver。
2. Hono 只接收外部 conversation id，服务端按 `tenant/user + agent + conversation` 生成或映射内部 thread id，避免跨用户碰撞。
3. 启用 checkpointer 后，每轮只提交新增消息；继续提交完整历史会重复追加。
4. 多实例部署使用共享数据库型 saver；`MemorySaver` 只适合本地开发/测试，LangGraph 官方也明确建议生产环境使用数据库持久化（[官方说明](https://github.com/langchain-ai/langgraphjs/blob/3dccad1391e173eead64f9e2d6dd977fdc345f7d/docs/docs/agents/memory.md#L78-L87)）。
5. 只有确有跨 thread 的用户记忆或持久文件需求时再加 store，并按 tenant/user 命名空间隔离。

## 八、依赖注入与测试

当前 `createApp(dependencies)` -> `createChatRoutes(dependencies)` 注入 runner 的做法正确，应该保留。Hono 自带 `app.request()` 便于直接用 Web `Request/Response` 测试 route（[Hono API 实现与示例](https://github.com/honojs/hono/blob/f774f8df49e7ec7e205f15c5076a37132c515ebf/src/hono-base.ts#L481-L511)）。

建议继续注入最窄的行为，而不是注入整个 Hono Context 或创建单实现 interface：

```ts
type ChatRunner = {
  invoke(input: ChatInput & { signal: AbortSignal }): Promise<ChatResult>
  stream(input: ChatInput & { signal: AbortSignal }): AsyncIterable<ChatEvent>
}
```

最少测试覆盖：

- schema/未知 Agent 在开始 SSE 前返回 400；
- runner 收到 `AbortSignal`，取消 response reader 后 signal 变为 aborted；
- runner 抛错时只出现一个脱敏 `error` event；
- 正常 delta 按顺序写出，结束后 stream EOF；
- dispatch 对每个允许的 agent key 只调用对应 runner。

不需要在 route 单测里启动真实模型。Agent/tool 自己用 fake model 或 stub service 测试，route 测试继续注入 fake runner。

## 九、安全与工具权限

Deep Agents 官方安全模型是“LLM 能做它的工具允许做的一切”，明确要求在 tool/sandbox 层实施边界，不能依赖 prompt 自我约束（[Deep Agents Security](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/README.md#L150-L152)）。

`permissions` 只覆盖 Deep Agents 的文件系统 read/write 工具，规则 first-match-wins，而且没有规则命中时默认允许（[权限类型](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/libs/deepagents/src/permissions/types.ts#L1-L40)、[默认允许实现](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/libs/deepagents/src/permissions/enforce.ts#L66-L89)）。因此：

- 当前 general/data Agent 通过 `createSkillPermissions()` 最后 deny `/**`，方向正确；
- 当前 web research Agent 没有传 `permissions`，仅靠 system prompt 要求“不使用文件系统/task/todo”不是安全边界；至少应显式 deny 所有不需要的文件系统读写；
- filesystem permissions 不控制自定义 `web_search`、`edit_xlsx_cell`，这些 tool 必须在自身边界做 schema、授权、次数、范围和超时限制；
- 当前 `edit_xlsx_cell` 把 `fileId` 和 expected version 绑定在服务端闭包中，并限制每轮一次写操作，比让模型传 fileId/version 更安全，应保留；
- 对可能产生不可逆副作用的 tool，再考虑 Deep Agents 的 `interruptOn` / HITL；普通只读搜索不必增加审批流程。

## 十、最小代码骨架

以下只表达边界，不要求照搬类型名；它复用当前 `routes/`、`agents/`、shared schema 和 SSE content block，不新增框架层：

```ts
// routes/chat.ts
export function createChatRoutes(runner: ChatRunner) {
  const app = new Hono()

  app.post('/chat', zValidator('json', chatRequestSchema), async (c) => {
    const input = c.req.valid('json')
    const result = await runner.invoke({ ...input, signal: c.req.raw.signal })
    return c.json(result)
  })

  app.post(
    '/chat/stream',
    zValidator('json', chatStreamRequestSchema),
    (c) => {
      const input = c.req.valid('json')

      return streamSSE(c, async (sse) => {
        const responseAbort = new AbortController()
        sse.onAbort(() => responseAbort.abort())
        const signal = AbortSignal.any([
          c.req.raw.signal,
          responseAbort.signal,
        ])

        try {
          for await (const event of runner.stream({ ...input, signal })) {
            await sse.writeSSE({
              event: 'message',
              data: JSON.stringify(event),
            })
          }
        } catch (error) {
          if (signal.aborted) return
          logAgentError(error)
          await sse.writeSSE({
            event: 'error',
            data: JSON.stringify({
              code: 'AGENT_FAILED',
              message: 'Agent 调用失败',
            }),
          })
        }
      })
    },
  )

  return app
}

// agents/chat-runner.ts
async function* streamDeepAgent(agent: DeepAgent, input: ChatInput) {
  const run = await agent.streamEvents(
    { messages: input.messages },
    {
      version: 'v3',
      signal: input.signal,
      ...(input.threadId && {
        configurable: { thread_id: input.threadId },
      }),
    },
  )

  for await (const message of run.messages) {
    for await (const delta of message.text) {
      if (delta) yield { type: 'markdown' as const, data: delta }
    }
  }
}
```

`AbortSignal.any()` 是当前 Node 20 runtime 的原生能力；如果项目未来要支持不具备该 API 的 runtime，再换成十几行手动 signal bridge，不需要现在引入依赖。

## 当前仓库判断

| 现状 | 判断 | 最小建议 |
| --- | --- | --- |
| `createApp` / `createChatRoutes` 支持 runner 注入 | 正确 | 保留 |
| `/chat` 使用 `zValidator` | 正确 | 流式 route 与其统一 |
| route 将 `c.req.raw.signal` 传给流式 runner | 正确 | 普通 Data Agent 和外部 fetch 补齐 |
| route 自己编码 `message/error` SSE | 正确 | error 增加稳定 code 并脱敏 |
| `run.messages -> message.text` | 与 LangGraph `1.4.8` 一致 | 保留 |
| `key` 接受任意字符串，未知值走 general | 边界过宽 | shared schema 改为允许值枚举 |
| `/chat/stream/v2` 固定创建 Web Research Agent | 选择逻辑分散 | 下次改聊天链路时并入 `chat-runner.ts` |
| 每次请求创建 Agent | 当前可接受 | 不做缓存，测到构建开销再处理 |
| 未配置 checkpointer/store，前端提交完整历史 | 自洽的无状态模式 | 没有服务端记忆需求就不改 |
| `publicServiceError` 公开大部分原始 message | 有泄露风险 | 只公开白名单业务错误 |
| general/data 文件权限 default-deny | 正确 | 保留服务端 Skill allowlist |
| web research 只用 prompt 禁止其他工具 | 不构成安全边界 | 显式 deny 文件系统；custom tool 自行授权 |

## 最终建议

Hono 与 Deep Agents 的联动点只需要两个普通调用接口：`invoke()` 和 `AsyncIterable` stream。Hono 管 HTTP，Deep Agents/LangGraph 管 Agent 运行，二者之间用一个可注入 runner 隔离。当前仓库已经完成大半：SSE 桥接、AbortSignal 转发和 runner 注入都在正确方向；优先修正流前校验、严格 dispatch、取消透传和错误脱敏即可。持久化、统一 registry、replay SSE、复杂分层都等真实需求出现再加。
