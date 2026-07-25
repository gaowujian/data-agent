# Data Agent 仓库协作指南

## 适用范围

本文件适用于整个仓库。若子目录后续增加更具体的 `AGENTS.md`，以距离目标文件最近的规则为准。

## 项目概览

本项目是基于 pnpm workspace 的 TypeScript monorepo，使用 ESM。各包职责如下：

| 包 | 职责 | 核心技术 |
| --- | --- | --- |
| `packages/client` | 服务端、Agent 编排、文件处理与 API | Hono、`deepagents`（核心 Agent 框架）、LangChain、Zod |
| `packages/web` | 浏览器端界面 | Vue 3、`@tdesign-vue-next/chat`（核心交互组件）、Vue Router、Vite |
| `packages/shared` | 前后端共享的 schema、类型和纯逻辑 | TypeScript、Zod |

依赖方向必须保持为 `web -> shared <- client`：

- `client` 和 `web` 可以依赖 `@data-agent/shared`。
- `client` 与 `web` 不得互相导入。
- `shared` 不得依赖 `client`、`web`、Node.js 专属 API 或浏览器 DOM API。
- 跨端请求/响应契约优先在 `shared` 中用 Zod 定义，再通过 `z.infer` 导出类型；不要在前后端重复声明同一结构。

## 仓库结构

```text
packages/
├── client/
│   └── src/
│       ├── index.ts       # Hono 应用与 API 路由
│       ├── server.ts      # Node.js 生产启动入口
│       ├── agents/        # Agent 与模型编排
│       ├── tools/         # Agent/业务工具
│       ├── services/      # 文件、向量化等服务
│       └── db/            # 数据访问
├── web/
│   └── src/
│       ├── main.ts        # Vue 应用入口
│       ├── router/        # 路由
│       ├── views/         # 页面
│       └── components/    # 可复用组件
└── shared/
    └── src/
        ├── index.ts       # 公共导出入口
        └── chat.ts        # 对话契约与类型
```

## 包管理与常用命令

- 仅使用仓库声明的 `pnpm@10.33.2`，不要生成 npm 或 Yarn 锁文件。
- 安装依赖：`pnpm install`。
- 本地同时启动服务端和前端：`pnpm dev`。
- 单独启动服务端：`pnpm dev:client`，默认监听 `http://localhost:3001`。
- 单独启动前端：`pnpm dev:web`，默认监听 `http://localhost:5173`，并将 `/api` 代理到服务端。
- 全仓类型检查：`pnpm check-types`。
- 构建应用包：`pnpm build`。
- 包级检查：`pnpm --filter @data-agent/client check-types`、`pnpm --filter @data-agent/web check-types`、`pnpm --filter @data-agent/shared check-types`。

新增依赖时必须加到实际使用它的包，不要无故加到根目录：

```bash
pnpm --filter @data-agent/client add <package>
pnpm --filter @data-agent/web add <package>
pnpm --filter @data-agent/shared add <package>
```

内部包依赖使用 `workspace:*`。多包共用的工具链版本优先维护在 `pnpm-workspace.yaml` 的 `catalog` 中。CI 安装使用 `pnpm install --frozen-lockfile`。

注意：当前 `@data-agent/client` 的 `build` 脚本引用 `packages/client/tsconfig.build.json`，但该文件尚不存在。在补齐构建配置并实际执行前，不要声称 `pnpm build` 已通过。

## TypeScript 通用约定

- 保持严格类型检查；不要使用 `any`、`@ts-ignore` 或非必要类型断言绕过问题。
- 对类型导入使用 `import type`，保持 `verbatimModuleSyntax` 兼容。
- 公共函数、API 边界和错误分支应有明确类型；对 `unknown` 先收窄再使用。
- 遵循目标文件现有格式，不要为功能修改顺带格式化无关代码。
- 不引入未使用的变量、参数或导出；各包已启用相关 TypeScript 检查。

## 第三方包 API 核验规则

- 禁止凭记忆、相似框架经验或示例代码臆造第三方 API，包括导出名、组件名、props、events、slots、函数参数和返回类型。
- 开发前先确认目标包在当前 `package.json` 和 `pnpm-lock.yaml` 中锁定的版本，再检查该安装版本的 `package.json#exports`、随包发布的 `.d.ts` 类型声明及仓库现有用法。
- 确认实际 API 与 TypeScript 类型后，再查询对应版本的官方文档，核对语义、约束和推荐用法；不要直接照搬其他版本示例。
- 若官方文档与本地安装版本的类型声明不一致，以当前锁定版本的实际导出和类型检查结果为准，并明确记录版本差异。
- 无法从本地类型或官方文档确认的能力不得自行补造；应先说明缺失信息或提出可验证的替代方案。

## 服务端约定（`packages/client`）

- Hono 应用保持在 `src/index.ts`，生产启动适配放在 `src/server.ts`；业务逻辑不要持续堆积在路由处理函数中。
- API 路径统一使用 `/api` 前缀。输入在边界处通过 Zod/Hono validator 校验，响应契约应与 `shared` 保持一致。
- `deepagents` 是后端核心 Agent 框架，Hono 负责 HTTP、校验和 SSE 接入；Agent 生命周期、工具编排和执行流程应以 `deepagents` 为中心实现。
- Agent 构建和编排放在 `src/agents`，可复用工具放在 `src/tools`，外部服务或数据处理放在 `src/services`。新增 Agent 能力不得绕过 `deepagents` 另建一套核心执行链路。
- 当前主要聊天链路仍由 `src/agents/llm.ts` 直接创建 LangChain `ChatOpenAI`，属于待整合的现有实现，不应作为新增 Agent 功能的架构模板。修改相关链路时应明确整合边界，避免混用两套 Agent 生命周期。
- 使用 `deepagents` 前，必须先检查本地安装包的 exports 和 TypeScript 类型，再查阅 [Deep Agents JavaScript API Reference](https://reference.langchain.com/javascript/deepagents)；不得臆造 API。
- 流式接口使用 SSE。调整事件格式时必须同步检查前端消费者，并保持中止信号、错误事件与响应结束行为正确。
- 为可预期错误返回合适的 HTTP 状态码和稳定的 JSON 错误结构，不要吞掉异常。
- 密钥、令牌和环境相关配置只能来自环境变量并集中校验。不得在源码、日志、示例或提交中写入真实凭据，也不要读取或输出 `.env*` 文件内容。

## 前端约定（`packages/web`）

- 使用 Vue 3 Composition API 和 TypeScript；新增组件优先采用 `<script setup lang="ts">`。
- `@tdesign-vue-next/chat` 是 Web 端聊天界面的核心组件包。新增或修改聊天交互时，优先复用该包的能力，不要重复实现已有组件行为。
- 使用 `@tdesign-vue-next/chat` 前，必须先检查本地安装包的 exports、组件类型、props、events 和 slots 声明，再查阅 [TDesign AI Chat for Vue 3](https://tdesign.tencent.com/vue-next-chat/components/chatbot)；不得按其他 TDesign 包或旧版本经验猜测 API。
- 页面放在 `src/views`，通用组件放在 `src/components`，路由集中维护在 `src/router`。
- 调用后端使用 `/api` 相对路径，复用 Vite 开发代理；不要在业务代码中硬编码本地服务端地址。
- API 数据在渲染前应使用 `shared` 中的契约校验或类型约束，页面内不要重新定义服务端 DTO。
- 保持现有路由和页面行为，除非任务明确要求变更；修改流式聊天或图表协议时同时核对服务端 SSE 输出。
- 样式优先局部作用域，避免无意修改全局组件库样式。新增 UI 库前先确认现有 Element Plus、Vue Element Plus X、TDesign Chat 是否已经覆盖需求。

## 共享包约定（`packages/shared`）

- 只包含跨端可复用、无平台副作用的 schema、类型、常量和纯函数。
- Zod schema 是数据契约的事实来源，类型从 schema 推导，避免 schema 与手写 interface 漂移。
- 新增公共模块后，从 `src/index.ts` 显式导出；注意变更会同时影响服务端和前端。
- 不在共享包中放密钥、服务端配置读取、数据库访问、UI 组件或网络请求。

## 修改与验证流程

1. 修改前先定位受影响的包、入口和共享契约，保持改动小且可审查。
2. 若 API 契约变化，先更新 `shared`，再同步 `client` 与 `web`。
3. 先运行受影响包的 `check-types`，再运行 `pnpm check-types`。
4. 涉及构建配置或发布产物时再运行 `pnpm build`，并单独报告类型检查与构建结果。
5. 涉及运行时交互时，启动相应应用验证实际路由、SSE、上传或页面行为；构建成功不能替代运行时验证。

仓库当前没有配置统一的 lint 或 test 脚本。不要声称已通过 lint/测试；若新增测试设施，应保持范围最小并在根目录脚本中提供一致入口。

## 提交前检查

- 未泄露 `.env*`、API Key、令牌、上传文件或生成数据。
- 未引入跨包反向依赖或重复的请求/响应类型。
- 未提交构建产物、缓存或无关格式化改动。
- 已说明实际执行的检查及未执行或被阻塞的验证。
