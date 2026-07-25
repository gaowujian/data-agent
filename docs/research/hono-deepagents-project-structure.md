# Hono.js + Deep Agents 项目目录组织调研

访问日期：2026-07-25  
适用仓库：`data-agent/packages/client`  
核验版本：Hono `4.12.15`、Deep Agents `1.11.1`（见当前 [`package.json`](../../packages/client/package.json)；Deep Agents 版本也与官方 [`deepagents@1.11.1` 包定义](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/libs/deepagents/package.json#L1-L8)一致）。

## 结论

没有一套由 Hono 或 Deep Agents 强制规定的目录模板。对当前仓库，合理结构不是再增加 `controller/use-case/repository/adapter` 四层，而是守住六个真实边界：

1. `index.ts` / `server.ts`：应用组合与 Node.js 启动。
2. `routes/`：HTTP、校验、状态码、SSE 和中止信号。
3. `agents/`：Deep Agent 创建、模型配置、Agent 选择与运行编排。
4. `tools/`：**只放真正注册给模型调用的 Agent Tool**。
5. `services/`：Excel 解析、工作簿处理、RAG、外部 API 调用等普通应用能力。
6. `packages/shared`：前后端共享的 Zod 请求/响应契约。

因此，`excel.ts` 与 `web-search.ts` **不应继续放在同一个 `tools/` 目录**。`web-search.ts` 通过 LangChain `tool()` 创建工具并被传入 `createDeepAgent({ tools: [...] })`，属于 Agent Tool；`excel.ts` 是被服务代码直接调用的解析库，属于普通 service/codec。Deep Agents 官方类型把 `tools` 明确定义为“Agent 可访问的工具”，官方研究 Agent 示例也把 `internetSearch` 作为工具传给 `tools` 数组（[参数定义](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/libs/deepagents/src/types.ts#L525-L551)、[官方研究示例](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/examples/research/research-agent.ts#L199-L209)）。

## 一手资料明确支持的事实

### Hono：按资源组合路由，不要求企业分层

**官方事实：** Hono 官方称框架非常灵活，应用可以自行组织；同时默认建议 handler 紧邻路由定义，避免为模仿 Rails 而机械创建 controller，因为那会使路径参数类型推断复杂（[Hono Best Practices](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/guides/best-practices.md#L1-L43)）。应用变大后，官方建议按资源拆出 Hono 子应用，再由入口用 `app.route()` 挂载（[Building a larger application](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/guides/best-practices.md#L66-L113)）。

**仓库建议：** 当前 `routes/chat.ts`、`routes/files.ts`、`routes/skills.ts` 与 `index.ts` 的组织已经符合这条建议，应保留；没有必要再在每个 route 后面增加一一对应的 controller。

### Hono：校验与 SSE 属于 HTTP 边界

**官方事实：** Hono Validator 作为 middleware 在 handler 前校验输入，handler 通过 `c.req.valid()` 读取已经校验的数据；官方也推荐结合 Zod 等第三方 validator（[Validation](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/guides/validation.md#L1-L51)、[Zod Validator Middleware](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/guides/validation.md#L165-L233)）。`streamSSE()` 是 Hono 的 SSE 响应 helper；流回调抛错时，全局 `onError` 无法覆盖已经开始的响应（[Streaming Helper](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/helpers/streaming.md#L63-L83)、[streaming error handling](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/helpers/streaming.md#L86-L123)）。

**仓库建议：** Zod validator、HTTP 状态码、SSE event 编码、断连处理和“流已开始后的错误事件”继续留在 `routes/`。Agent 不应返回 Hono `Context`、`Response` 或直接写 SSE。

### Deep Agents：`createDeepAgent` 是 Agent composition root

**官方事实：** Deep Agents 将 `createDeepAgent` 定义为创建生产型 Agent 的主入口，并在一个配置对象中组合 model、tools、middleware、subagents、backend、interrupt、memory、skills 等能力（[官方实现说明与参数解构](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/libs/deepagents/src/agent.ts#L159-L238)）。`CreateDeepAgentParams` 进一步区分了 Agent tools、middleware、subagents、checkpointer/store、filesystem backend、skills 和 stream transformers（[官方类型定义](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/libs/deepagents/src/types.ts#L525-L678)）。

**仓库建议：** 每类 Agent 的 `createDeepAgent()` 组装、prompt、可用 tools、middleware、skills/backend 权限应集中在 `agents/`，不要让 Hono route 自己逐项拼 Agent 配置，也不要绕开 Deep Agents 再造一套 Agent 生命周期。

### Deep Agents：backend 不是泛化的“所有基础设施”

**官方事实：** Deep Agents 的 `backend` 参数明确用于 filesystem operations；可接收 backend 实例或基于 state/store 创建 backend 的工厂（[backend 参数定义](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/libs/deepagents/src/types.ts#L594-L605)）。官方 `StateBackend` 示例说明其中的文件随会话结束而丢失，并把它传入 `createDeepAgent`（[StateBackend 示例](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/examples/backends/state-backend.ts#L35-L54)）。

**仓库建议：** Bocha HTTP 客户端、embedding provider、数据库访问不应因为名称叫“backend”就塞进 Deep Agents backend。它们仍是普通外部服务适配器；只有 Agent 文件系统语义才使用 Deep Agents `backend`。

### Deep Agents：流来自 Agent，传输格式由 Hono 负责

**官方事实：** Deep Agents 官方示例通过 Agent 的 `stream()` 消费 token，并能区分主 Agent 与 subagent namespace（[token streaming 示例](https://github.com/langchain-ai/deepagentsjs/blob/60e32118b0ba24ea7ef636476a9a96add9d1a99b/examples/streaming/tokens.ts#L11-L65)）。Hono 官方则提供 `streamSSE()` 将服务端事件写入 HTTP 响应（[Hono SSE helper](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/helpers/streaming.md#L63-L83)）。

**仓库建议：** `agents/` 输出框架事件或项目内部的 `AsyncIterable`；`routes/` 把这些内容编码成稳定的 SSE 协议。两层之间不要互相依赖具体实现。

## 当前仓库职责盘点

| 当前文件 | 实际职责 | 判断 |
| --- | --- | --- |
| [`src/index.ts`](../../packages/client/src/index.ts) | 创建 Hono、全局 middleware、挂载子路由 | 保留，属于 HTTP composition root |
| [`src/server.ts`](../../packages/client/src/server.ts) | 使用 `@hono/node-server` 启动进程 | 保留，属于 Node runtime adapter；官方确认 Hono 在 Node.js 上通过该 adapter 运行（[Node.js guide](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/getting-started/nodejs.md#L1-L5)） |
| [`routes/*.ts`](../../packages/client/src/routes) | HTTP 资源子应用 | 保留；与 Hono `app.route()` 组合建议一致 |
| [`routes/chat.ts`](../../packages/client/src/routes/chat.ts) | HTTP/SSE、DTO 转换、RAG 查询、Agent 选择、错误映射 | 边界开始混合；下一次修改聊天链路时抽出 Agent 运行编排即可 |
| [`agents/*.ts`](../../packages/client/src/agents) | Deep Agent 创建、prompt、模型、skill middleware、运行 | 方向正确 |
| [`tools/web-search.ts`](../../packages/client/src/tools/web-search.ts) | LangChain `tool()` 包装，直接传给 Web Research Agent | 保留在 `tools/` |
| [`tools/excel.ts`](../../packages/client/src/tools/excel.ts) | Excel 二进制解析与限制 | 移到 `services/excel-parser.ts`；它不是模型工具 |
| [`tools/xlsx-ooxml.ts`](../../packages/client/src/tools/xlsx-ooxml.ts) | XLSX/OOXML 检查和单元格编辑底层实现 | 移到 `services/xlsx-ooxml.ts`；它是工作簿 codec，不是模型工具 |
| [`services/bocha.ts`](../../packages/client/src/services/bocha.ts) | 外部搜索 API client、响应校验 | 保留；`tools/web-search.ts` 只负责 Agent Tool schema 与适配 |
| [`services/file-ingest.ts`](../../packages/client/src/services/file-ingest.ts) | 文件解析、切块、embedding 的应用流程 | 保留；这是 application service |
| [`services/workbook-*.ts`](../../packages/client/src/services) | 工作簿上下文、存储和提交 | 保留；文件数量继续增加后再建 `services/workbook/` 子目录 |
| [`db/`](../../packages/client/src/db) | 数据访问 | 保留；出现真实查询后按资源拆，不先加 repository interface |

## 当前阶段推荐目录

这是在现有结构上做最少整理后的目标，不是一次性重构任务：

```text
packages/client/src/
├── index.ts                         # 创建 Hono、全局 middleware、挂载 routes
├── server.ts                        # Node.js 启动与关闭
├── config.ts                        # 环境变量读取和校验
├── routes/                          # HTTP transport
│   ├── chat.ts                      # 校验、状态码、SSE、abort、公开错误
│   ├── files.ts
│   └── skills.ts
├── agents/                          # Deep Agents orchestration
│   ├── chat-runner.ts               # 需要拆 chat.ts 时再加：Agent 选择与运行
│   ├── data-agent.ts
│   ├── general-agent.ts
│   ├── web-research-agent.ts
│   ├── llm.ts
│   └── preloaded-skill-middleware.ts
├── tools/                           # 只放模型可调用工具
│   └── web-search.ts
├── services/                        # 普通应用能力和外部适配
│   ├── bocha.ts
│   ├── embeddings.ts
│   ├── excel-parser.ts              # 原 tools/excel.ts
│   ├── xlsx-ooxml.ts                # 原 tools/xlsx-ooxml.ts
│   ├── excel-chunk.ts
│   ├── file-ingest.ts
│   ├── skill-registry.ts
│   ├── workbook-context.ts
│   └── workbook-store.ts
├── db/
└── test/
```

`chat-runner.ts` 是唯一建议的可选新增层：只有在继续修改 331 行的 `routes/chat.ts` 时再抽。它负责“本次该跑 data/general/web-research 哪个 Agent、怎样准备 RAG context、怎样返回内部流”；`routes/chat.ts` 仍负责 HTTP/SSE。不要同时创建 `chat-controller.ts`、`chat-service.ts`、`chat-use-case.ts` 三个只互相转发的文件。

## 最小迁移映射

| 现状 | 建议 | 时机 |
| --- | --- | --- |
| `tools/excel.ts` | `services/excel-parser.ts` | 现在即可；只改 import 路径 |
| `tools/xlsx-ooxml.ts` | `services/xlsx-ooxml.ts` | 现在即可；只改 import 路径 |
| `tools/web-search.ts` | 保持不动 | 它确实是 Agent Tool |
| `services/bocha.ts` | 保持不动 | Agent Tool 的外部 API 实现与 Tool schema 分离是合理的 |
| `routes/chat.ts` 中 Agent 分派/RAG 准备 | 有下一次聊天链路修改时抽到 `agents/chat-runner.ts` | 避免纯目录重构 |
| `services/workbook-*.ts` 等 | 暂时保持平铺 | 同一职责文件明显继续增加、导航变差时再建 `services/workbook/` |

## Contracts、domain、application、infrastructure 如何区分

这些是职责标签，不必现在都变成物理目录：

| 边界 | 当前归属 | 允许依赖 | 不应承担 |
| --- | --- | --- | --- |
| Contracts | `packages/shared/src` | Zod、纯 TypeScript | Hono、Deep Agents、Node `Buffer`、数据库、DOM |
| HTTP transport | `index.ts`、`server.ts`、`routes/` | shared contracts、agents/services | prompt、模型选择、Excel 解析算法 |
| Agent orchestration | `agents/` | Deep Agents、Agent tools、services、shared types | Hono `Context`、SSE wire format |
| Agent tools | `tools/` | tool schema、最薄的 service 调用 | 大段 API client、文件存储、业务工作流 |
| Domain/application services | `services/` | 纯逻辑、工作流、外部适配 | Hono response、模型可见 tool metadata |
| Infrastructure | 当前的 `services/bocha.ts`、`services/embeddings.ts`、`db/` | fetch/SDK/数据库 | HTTP route 或 Agent prompt |

跨端请求/响应契约继续以 `packages/shared` 的 Zod schema 为事实来源；route 在入口校验后再交给 Agent/application 层。这与 Hono 官方“middleware 校验、handler 读取 validated value”的边界一致（[Validation](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/guides/validation.md#L17-L51)），但把 schema 放在 workspace `shared` 包是本仓库的 monorepo 选择，不是 Hono 强制规则。

## 不建议现在增加的结构

- 不建与每个 route 一一对应的 `controllers/`；Hono 官方默认建议 handler 紧邻 route。
- 不建只有一个实现的 `IWebSearchProvider`、factory、repository interface。
- 不建通用 `agent-registry`；当前 Agent 数量和选择逻辑尚不足以抵消间接层成本。
- 不把所有外部服务都叫 Deep Agents `backend`；该参数有明确的文件系统语义。
- 不按“未来可能增长”提前把每个业务拆成 `domain/application/infrastructure/interface` 四层。

满足以下任一真实条件后再升级为 feature-first 结构：全局 `services/` 已难以导航；一个领域同时拥有多条 route、多个 Agent/tool、持久化和大量测试；或同一外部能力出现两个可替换实现。届时可把工作簿相关代码收进 `modules/workbook/`，而不是继续扩大全局目录。

## 最终判断

Hono 负责 HTTP composition 和 transport，Deep Agents 负责 Agent composition 和 lifecycle；两者的交界是一组普通、可测试的输入输出，而不是彼此穿透的框架对象。当前仓库已经有正确骨架，最值得做的只有：把非 Agent Tool 的 Excel/OOXML 代码移出 `tools/`，并在下一次改聊天链路时把 Agent 分派从 `routes/chat.ts` 抽到一个 `agents/chat-runner.ts`。其余分层暂时没有必要。
