/*
 * @Author: Andrew q
 * @Date: 2026-04-29 17:43:29
 * @LastEditors: Andrew Q
 * @LastEditTime: 2026-07-25 01:18:42
 * @Description:index
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import type {
  DataAgentRunner,
  DataAgentStreamRunner,
} from "./agents/data-agent";
import { runDataAgent, streamDataAgent } from "./agents/data-agent";
import type {
  AgentChatMessage,
  GeneralAgentStreamRunner,
} from "./agents/general-agent";
import { streamGeneralAgent } from "./agents/general-agent";
import { createChatModel } from "./agents/llm";
import {
  listAvailableAgentSkills,
  resolveAgentSkills,
  UnknownAgentSkillsError,
} from "./services/skill-registry";
import {
  createPendingFileRecord,
  getFileRecord,
  retrieveTopChunksByQuery,
  runIngestExcelJob,
} from "./services/file-ingest";
import {
  getStoredArtifact,
  getWorkbookRecord,
  storeUploadedWorkbook,
  toWorkbookFileResponse,
} from "./services/workbook-store";
import { EXCEL_MAX_FILE_BYTES } from "./tools/excel";
import {
  DATA_AGENT_KEY,
  deepChatRequestSchema,
  resolveDeepChatRagFields,
  selectedAgentSkillsSchema,
  type AgentSkillsResponse,
  type ChatStreamContent,
  type DeepChatMessage,
  type DeepChatResponse,
  type WorkbookFileResponse,
} from "@data-agent/shared";

import { createAgent } from "./agents-v2";

const RAG_TOP_K = 6;
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type AppDependencies = {
  dataAgentRunner?: DataAgentRunner;
  dataAgentStreamRunner?: DataAgentStreamRunner;
  generalAgentStreamRunner?: GeneralAgentStreamRunner;
};

type ChatStreamRequest = {
  key?: string;
  fileId: string;
  message: string;
  messages: AgentChatMessage[];
  includeEchartDemo: boolean;
  skills: string[];
};

const toLangChainMessages = (messages: DeepChatMessage[]) => {
  const normalized = messages
    .filter((message) => message.text?.trim())
    .map((message) => {
      const role =
        message.role === "ai" ? "assistant" : (message.role ?? "user");
      return [role, message.text?.trim() ?? ""] as [string, string];
    });
  return normalized.length > 0
    ? normalized
    : ([["user", "你好"]] as [string, string][]);
};

const getTextContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "text" in item) {
        const text = (item as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | undefined {
  if (isRecord(value) && "text" in value) return readText(value.text);
  const text = getTextContent(value).trim();
  return text || undefined;
}

function toChatStreamMessages(value: unknown): AgentChatMessage[] {
  if (!Array.isArray(value)) return [];

  const messages: AgentChatMessage[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const content = readText(item.content) ?? readText(item.text);
    if (!content) continue;

    const role =
      item.role === "assistant" || item.role === "system"
        ? item.role
        : item.role === "ai"
          ? "assistant"
          : "user";
    messages.push({ role, content });
  }
  return messages;
}

function parseChatStreamRequest(value: unknown): ChatStreamRequest {
  const body = isRecord(value) ? value : {};
  const parsedSkills = selectedAgentSkillsSchema.safeParse(body.skills);
  if (!parsedSkills.success) {
    throw new Error(
      parsedSkills.error.issues[0]?.message ?? "skills 参数不合法",
    );
  }
  const messages = toChatStreamMessages(body.messages);
  const message =
    readText(body.message) ??
    readText(body.prompt) ??
    messages[messages.length - 1]?.content ??
    "";

  return {
    key: readText(body.key),
    fileId: readText(body.fileId) ?? "",
    message,
    messages:
      messages.length > 0
        ? messages
        : message
          ? [{ role: "user", content: message }]
          : [],
    includeEchartDemo: body.includeEchartDemo === true,
    skills: parsedSkills.data,
  };
}

function toDeepChatMessages(messages: AgentChatMessage[]): DeepChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    text: message.content,
  }));
}

const writeContentBlock = async (
  sse: SSEStreamingApi,
  block: ChatStreamContent,
): Promise<void> => {
  await sse.writeSSE({ event: "message", data: JSON.stringify(block) });
};

const writeMarkdownDelta = async (
  sse: SSEStreamingApi,
  delta: string,
): Promise<void> => {
  if (!delta) return;
  await writeContentBlock(sse, { type: "markdown", data: delta });
};

async function streamTextToSse(
  sse: SSEStreamingApi,
  stream: AsyncIterable<string>,
  signal: AbortSignal,
): Promise<void> {
  for await (const delta of stream) {
    if (signal.aborted) return;
    await writeMarkdownDelta(sse, delta);
  }
}

async function collectStreamText(
  stream: AsyncIterable<string>,
): Promise<string> {
  let text = "";
  for await (const delta of stream) {
    text += delta;
  }
  return text;
}

async function writeSseError(
  sse: SSEStreamingApi,
  message: string,
): Promise<void> {
  await sse.writeSSE({ event: "error", data: JSON.stringify({ message }) });
}

const DEMO_ECHART_OPTION = {
  title: { text: "示例：流式后的 chart 块", left: "center" },
  tooltip: { trigger: "axis" },
  xAxis: { type: "category", data: ["Q1", "Q2", "Q3", "Q4"] },
  yAxis: { type: "value", name: "数值" },
  series: [
    {
      type: "bar",
      name: "销量",
      data: [32, 58, 45, 71],
      itemStyle: { color: "#0052d9" },
    },
  ],
} as const;

const writeChartBlock = async (sse: SSEStreamingApi): Promise<void> => {
  await writeContentBlock(sse, { type: "chart", data: DEMO_ECHART_OPTION });
};

function fileResponse(fileId: string): WorkbookFileResponse | undefined {
  const workbook = getWorkbookRecord(fileId);
  const index = getFileRecord(fileId);
  if (workbook) {
    return toWorkbookFileResponse(workbook, {
      status: index?.status ?? "pending",
      error: index?.error,
    });
  }
  if (!index) return undefined;
  return {
    fileId,
    fileName: index.fileName ?? "upload.xls",
    status: "ready",
    sheetNames: [],
    sheets: [],
    indexStatus: index.status,
    indexError: index.error,
  };
}

async function getOptionalRagContext(
  fileId: string,
  question: string,
): Promise<string | undefined> {
  if (getFileRecord(fileId)?.status !== "completed") return undefined;
  try {
    const snippets = await retrieveTopChunksByQuery(
      fileId,
      question,
      RAG_TOP_K,
    );
    return snippets.length > 0 ? snippets.join("\n---\n") : undefined;
  } catch {
    return undefined;
  }
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "modified.xlsx";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function publicServiceError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (
    status === 401 ||
    /\b401\b|MODEL_AUTHENTICATION|authentication|unauthorized/i.test(message)
  ) {
    return "模型服务鉴权失败，请检查 SILICONFLOW_API_KEY 是否有效并重启后端服务";
  }
  return message;
}

export function createApp(dependencies: AppDependencies = {}): Hono {
  const app = new Hono();
  const executeDataAgent = dependencies.dataAgentRunner ?? runDataAgent;
  const executeDataAgentStream =
    dependencies.dataAgentStreamRunner ?? streamDataAgent;
  const executeGeneralAgentStream =
    dependencies.generalAgentStreamRunner ?? streamGeneralAgent;

  app.use(
    "*",
    cors({
      origin: ["http://localhost:5173"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Accept"],
    }),
  );

  app.get("/api/files/:fileId", (c) => {
    const response = fileResponse(c.req.param("fileId"));
    return response
      ? c.json(response)
      : c.json({ error: "未找到该 fileId" }, 404);
  });

  app.get("/api/skills", (c) => {
    try {
      const response: AgentSkillsResponse = {
        skills: listAvailableAgentSkills(),
      };
      return c.json(response);
    } catch (error) {
      return c.json(
        { error: publicServiceError(error, "Skill 列表加载失败") },
        500,
      );
    }
  });

  app.post("/api/files", async (c) => {
    let fileId: string | undefined;
    try {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return c.json({ error: "请使用 multipart 字段名 file 上传文件" }, 400);
      }

      const fileName = file.name?.trim() || "upload.xlsx";
      const lower = fileName.toLowerCase();
      if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
        return c.json({ error: "仅支持 .xlsx 或 .xls 文件" }, 400);
      }
      if (file.size > EXCEL_MAX_FILE_BYTES) {
        const mb = Math.floor(EXCEL_MAX_FILE_BYTES / (1024 * 1024));
        return c.json({ error: `文件过大，单文件不超过 ${mb}MB` }, 400);
      }

      fileId = randomUUID();
      const buffer = Buffer.from(await file.arrayBuffer());
      createPendingFileRecord(fileId, fileName);
      if (lower.endsWith(".xlsx")) {
        storeUploadedWorkbook(fileId, buffer, fileName);
      }

      void runIngestExcelJob(fileId, buffer, fileName, 0).catch(
        () => undefined,
      );
      const response = fileResponse(fileId);
      if (!response) throw new Error("上传记录创建失败");
      return c.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "文件上传失败";
      return c.json({ error: message, ...(fileId ? { fileId } : {}) }, 400);
    }
  });

  app.get("/api/artifacts/:artifactId/download", (c) => {
    const artifact = getStoredArtifact(c.req.param("artifactId"));
    if (!artifact) return c.json({ error: "下载产物不存在或已失效" }, 404);
    return c.body(new Uint8Array(artifact.buffer), 200, {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": contentDisposition(artifact.fileName),
      "Cache-Control": "no-store",
      "Content-Length": String(artifact.buffer.byteLength),
    });
  });

  app.post(
    "/api/chat",
    zValidator("json", deepChatRequestSchema),
    async (c) => {
      try {
        const body = c.req.valid("json");
        const skills = await resolveAgentSkills(body.skills);
        const rag = resolveDeepChatRagFields(body);
        if (rag && getWorkbookRecord(rag.fileId)) {
          const result = await executeDataAgent({
            fileId: rag.fileId,
            messages: body.messages,
            question: rag.message,
            ragContext: await getOptionalRagContext(rag.fileId, rag.message),
            skills,
          });
          return c.json({ text: result.text } satisfies DeepChatResponse);
        }

        const model = createChatModel();
        if (rag) {
          const index = getFileRecord(rag.fileId);
          if (!index)
            return c.json({ error: "未找到该 fileId，请先上传文件" }, 404);
          if (index.status !== "completed") {
            return c.json(
              { error: index.error || "文件仍在建立索引，请稍后再试" },
              409,
            );
          }
          const snippets = await retrieveTopChunksByQuery(
            rag.fileId,
            rag.message,
            RAG_TOP_K,
          );
          const prompt = `已知信息：${snippets.join("\n---\n") || "（暂无匹配片段）"}，请回答：${rag.message}`;
          if (skills.names.length > 0) {
            const text = await collectStreamText(
              executeGeneralAgentStream({
                messages: [
                  ...toChatStreamMessages(body.messages),
                  { role: "user", content: prompt },
                ],
                skills,
                signal: c.req.raw.signal,
              }),
            );
            return c.json({
              text: text || "模型没有返回文本内容。",
            } satisfies DeepChatResponse);
          }
          const result = await model.invoke([["user", prompt]]);
          return c.json({
            text: getTextContent(result.content) || "模型没有返回文本内容。",
          } satisfies DeepChatResponse);
        }

        if (skills.names.length > 0) {
          const text = await collectStreamText(
            executeGeneralAgentStream({
              messages: toChatStreamMessages(body.messages),
              skills,
              signal: c.req.raw.signal,
            }),
          );
          return c.json({
            text: text || "模型没有返回文本内容。",
          } satisfies DeepChatResponse);
        }

        const result = await model.invoke(toLangChainMessages(body.messages));
        return c.json({
          text: getTextContent(result.content) || "模型没有返回文本内容。",
        } satisfies DeepChatResponse);
      } catch (error) {
        const message = publicServiceError(error, "LLM 调用失败");
        return c.json(
          { error: message },
          error instanceof UnknownAgentSkillsError ? 400 : 500,
        );
      }
    },
  );

  app.post("/api/chat/stream", (c) => {
    const signal = c.req.raw.signal;

    return streamSSE(c, async (sse) => {
      let agentKey: string | undefined;
      try {
        const request = parseChatStreamRequest(await c.req.json<unknown>());
        agentKey = request.key;
        const skills = await resolveAgentSkills(request.skills);

        if (request.key === DATA_AGENT_KEY) {
          const dataAgent = executeDataAgentStream({
            fileId: request.fileId,
            messages: toDeepChatMessages(request.messages),
            question: request.message,
            ragContext: await getOptionalRagContext(
              request.fileId,
              request.message,
            ),
            skills,
            signal,
          });
          await streamTextToSse(sse, dataAgent.text, signal);
          if (signal.aborted) return;

          const result = dataAgent.getResult();
          if (result.artifact) {
            await writeContentBlock(sse, {
              type: "download",
              data: result.artifact,
            });
          }
          if (result.committedWorkbook) {
            const workbook = getWorkbookRecord(request.fileId);
            if (workbook) {
              void runIngestExcelJob(
                request.fileId,
                result.committedWorkbook.buffer,
                workbook.fileName,
                result.artifact?.version ?? workbook.currentVersion,
              ).catch(() => undefined);
            }
          }
          return;
        }

        await streamTextToSse(
          sse,
          executeGeneralAgentStream({
            messages: request.messages,
            skills,
            signal,
          }),
          signal,
        );
        if (request.includeEchartDemo && !signal.aborted) {
          await writeChartBlock(sse);
        }
      } catch (error) {
        if (signal.aborted) return;
        const fallback =
          agentKey === DATA_AGENT_KEY
            ? "Data Agent 调用失败"
            : "通用 Agent 调用失败";
        await writeSseError(sse, publicServiceError(error, fallback));
      }
    });
  });

  app.post("/api/chat/stream/v2", (c) => {
    const signal = c.req.raw.signal;

    return streamSSE(c, async (sse) => {
      try {
        const request = parseChatStreamRequest(await c.req.json<unknown>());
        if (!request.messages.length) {
          await writeSseError(sse, "请提供至少一条非空消息");
          return;
        }
        if (!process.env.BOCHA_API_KEY?.trim()) {
          await writeSseError(sse, "服务端未配置 BOCHA_API_KEY");
          return;
        }

        const agent = createAgent();
        const run = await agent.streamEvents(
          { messages: request.messages },
          { version: "v3", signal },
        );
        let hasText = false;

        for await (const message of run.messages) {
          for await (const delta of message.text) {
            if (signal.aborted) return;
            if (!delta) continue;
            hasText = true;
            await writeMarkdownDelta(sse, delta);
          }
        }

        if (!hasText && !signal.aborted) {
          await writeMarkdownDelta(sse, "Agent 没有返回可展示的文本。");
        }
      } catch (error) {
        if (signal.aborted) return;
        await writeSseError(
          sse,
          publicServiceError(error, "联网研究 Agent 调用失败"),
        );
      }
    });
  });

  return app;
}

const app = createApp();
export default app;
