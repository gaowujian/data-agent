# HonoJS 服务端目录规范：GitHub 实证调研

访问日期：2026-07-25

## 结论

Hono **没有强制或统一的服务端目录规范**。官方将 Hono 定义为灵活、无固定意见的框架；明确给出的架构建议主要是：

1. 小应用可以只有 `src/index.ts`。
2. 应用变大后，按资源或业务域拆成多个 Hono 子应用，并在入口通过 `app.route()` 组合。
3. 默认让 handler 紧邻路由定义，以保留路径参数等类型推断；不要机械照搬 Rails 风格 `controllers/`。
4. 只有业务逻辑、外部服务或数据访问需要复用/独立测试时，再拆 `services/`、`model/`、`db/` 等目录。

因此，`routes/`、`middleware/`、`services/`、`db/` 是 GitHub 项目中常见且合理的约定，但不是 Hono 官方标准；目录应随规模增长，而不是一次性搭满分层。

## 官方明确说明了什么

| 结论 | 一手证据 | 访问日期 |
| --- | --- | --- |
| Hono 很灵活，应用可以自行组织 | [Hono Best Practices 开头](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/guides/best-practices.md#L1-L4) | 2026-07-25 |
| 默认不建议 Rails 风格 Controller，因为会使路径参数类型推断复杂；确需拆 handler 时可用 `factory.createHandlers()` | [Controller 与 `createHandlers()` 建议](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/guides/best-practices.md#L6-L64) | 2026-07-25 |
| 大应用按资源拆 `authors.ts`、`books.ts`，由 `index.ts` 用 `app.route()` 挂载 | [Building a larger application](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/guides/best-practices.md#L66-L113) | 2026-07-25 |
| 使用 Hono RPC 时，应链式定义和组合路由，并从组合结果导出 `AppType` | [Using RPC with larger applications](https://github.com/honojs/website/blob/3048a3680d48fbc7dfd7cd1dd312f409036d4518/docs/guides/rpc.md#L697-L740) | 2026-07-25 |
| Hono 作者明确称框架是 un-opinionated，不打算在官方文档规定详细企业目录 | [honojs/hono issue #4121 的维护者回应](https://github.com/honojs/hono/issues/4121#issuecomment-2890327495) | 2026-07-25 |

## 官方仓库呈现的规模递进

### 1. 最小项目：单入口

官方 `create-hono` 从 `honojs/starter` 拉取模板；当前 Node.js starter 只有一个 `src/index.ts`，同一文件创建 Hono app 并调用 Node adapter 启动服务，没有预建 `routes/`、`controllers/` 或 `services/`。

```text
src/
└── index.ts
```

来源：[`create-hono` 的模板来源代码](https://github.com/honojs/create-hono/blob/9574c10a9f17f93478b7e6390dab887182b323ea/src/index.ts#L21-L47)、[Node.js starter 目录树](https://github.com/honojs/starter/tree/1e20b5289ab5a9a93c0c46a193b248058f00b629/templates/nodejs)、[Node.js starter 入口](https://github.com/honojs/starter/blob/1e20b5289ab5a9a93c0c46a193b248058f00b629/templates/nodejs/src/index.ts#L1-L15)。访问日期：2026-07-25。

这表达的是“最小可运行骨架”，不是大型项目应保持单文件。

### 2. 小型业务 API：按真实职责平铺

官方 blog 示例采用：

```text
src/
├── index.ts       # 根 app、中间件、子路由挂载
├── api.ts         # API 路由与边界处理
├── model.ts       # KV 数据访问和领域数据类型
└── bindings.ts    # Cloudflare 运行时绑定类型
```

来源：[blog 示例目录树](https://github.com/honojs/examples/tree/3b0b62875a0e1265763fea1c6388866d5697ef81/blog/src)、[根入口与 `app.route()`](https://github.com/honojs/examples/blob/3b0b62875a0e1265763fea1c6388866d5697ef81/blog/src/index.ts#L1-L25)、[API 路由](https://github.com/honojs/examples/blob/3b0b62875a0e1265763fea1c6388866d5697ef81/blog/src/api.ts)、[数据逻辑](https://github.com/honojs/examples/blob/3b0b62875a0e1265763fea1c6388866d5697ef81/blog/src/model.ts)。访问日期：2026-07-25。

官方 basic 示例仍只有 `index.ts` 和 `index.test.ts`，说明官方示例本身也按规模选择结构，而非执行统一目录模板：[basic/src](https://github.com/honojs/examples/tree/3b0b62875a0e1265763fea1c6388866d5697ef81/basic/src)。访问日期：2026-07-25。

## 活跃真实项目对照

以下项目均在调研时未归档，且所核验提交距访问日较近。它们用于观察社区实践，不代表官方规范。

### Kaneo：大型产品按业务域纵向切片

核验提交：[90d8b695，2026-07-21](https://github.com/usekaneo/kaneo/tree/90d8b6952e89e396ae41ccb58884b808d7152877/apps/api/src)。访问日期：2026-07-25。

```text
apps/api/src/
├── index.ts
├── auth.ts
├── database/
├── events/
├── storage/
├── plugins/
├── project/
│   ├── index.ts
│   └── controllers/
├── task/
│   ├── index.ts
│   └── controllers/
└── workspace/
    ├── index.ts
    └── controllers/
```

- 根 `index.ts` 统一挂载大量业务子应用：[业务路由组合](https://github.com/usekaneo/kaneo/blob/90d8b6952e89e396ae41ccb58884b808d7152877/apps/api/src/index.ts#L530-L571)。
- 每个业务域的 `index.ts` 定义 Hono 路由、校验和权限，再调用同域 controller；例如 [task 路由](https://github.com/usekaneo/kaneo/blob/90d8b6952e89e396ae41ccb58884b808d7152877/apps/api/src/task/index.ts#L1-L95) 和 [create-task 业务逻辑](https://github.com/usekaneo/kaneo/blob/90d8b6952e89e396ae41ccb58884b808d7152877/apps/api/src/task/controllers/create-task.ts)。
- `database/`、`storage/`、`events/` 是跨域基础设施，复杂插件则在 `plugins/<provider>/` 内聚自己的事件、服务和 webhook。

观察：这是大型产品的 feature-first 结构。它使用了 `controllers/`，但这是项目在业务量足够大后作出的选择，不是 Hono 要求。

### SonicJS：框架级项目采用分层核心 + 内聚插件

核验提交：[64e525c，2026-07-24](https://github.com/SonicJs-Org/sonicjs/tree/64e525ce7d9089895e5e9252b876d33f3f622abf/packages/core/src)。访问日期：2026-07-25。

```text
packages/core/src/
├── app.ts
├── index.ts
├── routes/
├── middleware/
├── services/
├── db/
├── adapters/
├── schemas/
├── templates/
└── plugins/
    └── core-plugins/<plugin>/
        ├── index.ts
        ├── routes/
        └── services/
```

- `app.ts` 是应用工厂和 composition root，从独立的 `routes/`、`middleware/`、`services/` 与插件导入能力：[应用工厂导入区](https://github.com/SonicJs-Org/sonicjs/blob/64e525ce7d9089895e5e9252b876d33f3f622abf/packages/core/src/app.ts#L1-L79)。
- 核心路由在根 `routes/` 分层；独立插件把自己的路由和服务放在插件目录内部，避免所有模块都塞进全局 `routes/`、`services/`。
- 根 app 仍通过 `app.route()` 组合各子应用：[核心路由挂载](https://github.com/SonicJs-Org/sonicjs/blob/64e525ce7d9089895e5e9252b876d33f3f622abf/packages/core/src/app.ts#L617-L678)。

观察：只有当系统同时是框架、插件平台且有多种运行时适配时，`adapters/`、插件注册表等层级才值得存在。

### Emailflare：中型服务按 HTTP、业务和基础设施分层

核验提交：[1fef955，2026-06-29](https://github.com/0xdps/emailflare/tree/1fef95577fff9ed8e7ec07f217ac24d468392e80/services/backend/src)。访问日期：2026-07-25。

```text
services/backend/src/
├── index.ts
├── env.ts
├── db.ts
├── routes/
├── middleware/
├── services/
└── lib/
```

- `index.ts` 配置全局中间件、鉴权边界、子路由、错误处理与 Node 启动：[入口组合](https://github.com/0xdps/emailflare/blob/1fef95577fff9ed8e7ec07f217ac24d468392e80/services/backend/src/index.ts#L1-L164)。
- `routes/domains.ts` 负责 HTTP 路由、Zod 校验、状态码与编排；外部 Cloudflare API 访问放在 `services/cloudflare.ts`：[domains route](https://github.com/0xdps/emailflare/blob/1fef95577fff9ed8e7ec07f217ac24d468392e80/services/backend/src/routes/domains.ts)、[Cloudflare service](https://github.com/0xdps/emailflare/blob/1fef95577fff9ed8e7ec07f217ac24d468392e80/services/backend/src/services/cloudflare.ts)。
- 可复用认证逻辑放在 [`middleware/auth.ts`](https://github.com/0xdps/emailflare/blob/1fef95577fff9ed8e7ec07f217ac24d468392e80/services/backend/src/middleware/auth.ts)，环境校验集中在 [`env.ts`](https://github.com/0xdps/emailflare/blob/1fef95577fff9ed8e7ec07f217ac24d468392e80/services/backend/src/env.ts)。

观察：这是多数中型 Hono API 可直接借鉴的最少分层，不需要额外 controller/repository/use-case 套娃。

### Web Archive：小型服务采用 `api + model + middleware`

核验提交：[c8c89b7，2026-04-27](https://github.com/Ray-D-Song/web-archive/tree/c8c89b7df933cd0145854bf66243710f3e61d17a/packages/server/src)。访问日期：2026-07-25。

```text
packages/server/src/
├── server.ts
├── api/
├── model/
├── middleware/
├── constants/
├── sql/
└── utils/
```

- `server.ts` 只创建根 app、建立鉴权边界并挂载资源子路由：[server.ts](https://github.com/Ray-D-Song/web-archive/blob/c8c89b7df933cd0145854bf66243710f3e61d17a/packages/server/src/server.ts#L1-L46)。
- `api/pages.ts` 处理请求校验和响应，`model/page.ts` 执行 D1 数据操作：[pages API](https://github.com/Ray-D-Song/web-archive/blob/c8c89b7df933cd0145854bf66243710f3e61d17a/packages/server/src/api/pages.ts)、[page model](https://github.com/Ray-D-Song/web-archive/blob/c8c89b7df933cd0145854bf66243710f3e61d17a/packages/server/src/model/page.ts)。

观察：`api/` 与 `routes/` 只是命名差异；真正重要的是根入口负责组合、route 负责 HTTP 边界、数据访问有明确归属。

## 从证据中归纳出的常见约定

| 约定 | 证据级别 | 适用条件 |
| --- | --- | --- |
| `index.ts` / `app.ts` 作为 composition root | 官方示例和社区项目共同出现 | 所有规模 |
| 每个资源/业务域导出一个 Hono 子应用，用 `app.route()` 挂载 | **官方明确推荐** | 两组以上路由时 |
| handler 与 route 定义保持在一起 | **官方默认推荐** | 能维持可读性时 |
| `middleware/` 存放可复用的横切逻辑 | 社区惯例 | 鉴权、日志、CORS、trace 等被复用时 |
| `services/` 存放外部系统访问或跨路由业务能力 | 社区惯例 | 逻辑被多个 route 调用或需要独立测试时 |
| `model/` / `db/` 存放数据访问，迁移与运行时代码分开 | 官方示例 + 社区惯例 | 接入数据库或 KV 后 |
| `env.ts` / `bindings.ts` 集中运行时配置和类型 | 官方示例 + 社区惯例 | 有环境变量、Cloudflare binding 等时 |
| 大型项目改用 `feature/<domain>/` 纵向切片 | 社区惯例 | 全局 `routes/`、`services/` 已难以导航时 |
| `controllers/`、`repositories/`、`use-cases/` 全套分层 | 非官方要求 | 只有确有复杂业务和多实现替换需求时再加 |

## 推荐的目录模板

### 小型 API

```text
src/
├── index.ts
├── users.ts
└── posts.ts
```

直接遵循官方 larger application 示例；无需先建空目录。

### 中型 Node.js API

```text
src/
├── index.ts             # 创建 app、全局中间件、挂载 routes
├── server.ts            # @hono/node-server 启动与关闭
├── routes/
│   ├── users.ts
│   └── posts.ts
├── middleware/          # 只放复用的横切逻辑
├── services/            # 外部服务、跨路由业务逻辑
├── db/                  # client、schema、查询
└── config.ts            # 环境变量读取与校验
```

这是对当前 `data-agent/packages/client` 最合适的规模：现有 `server.ts`、`agents/`、`tools/`、`services/`、`db/` 可以保留，只需在 `index.ts` 继续膨胀时新增 `routes/`，按 chat/files/skills 等 HTTP 资源拆成 Hono 子应用。没有证据支持为了“规范”再增加 controller、repository、use-case 三层。

### 大型或插件化系统

```text
src/
├── app.ts
├── server.ts
├── infrastructure/
└── modules/
    ├── users/
    │   ├── routes.ts
    │   ├── service.ts
    │   └── schema.ts
    └── billing/
        ├── routes.ts
        ├── service.ts
        └── schema.ts
```

当全局 `routes/` 和 `services/` 已经难以对应时，再迁移为业务域纵向切片；不要从第一天就采用大型模板。

## 最终判断

如果问题是“哪个目录结构才符合 Hono 规范”，答案是：**没有唯一结构**。最接近官方规范的原则是“保持最小、按资源拆 Hono 子应用、在入口组合、保住类型推断”。社区普遍增加 `middleware/`、`services/`、`db/`，但是否增加应由真实复杂度决定。
