<!--
 * @Author: Andrew Q
 * @Date: 2026-07-18 13:40:35
 * @LastEditors: Andrew Q
 * @LastEditTime: 2026-07-25 00:56:09
 * @Description: chat
-->
<template>
  <div class="chat-panel" @keydown.capture="handleSkillKeydown">
    <TdChatbot
      ref="chatRef"
      :default-messages="initialMessages"
      :message-props="messageProps"
      :sender-props="senderProps"
      :chat-service-config="chatServiceConfig"
      @message-change="handleMessageChange"
    >
      <!-- 自定义chat区 -->
      <template #sender-textarea>
        <CustomSender
          ref="customSenderRef"
          @input-change="handleInputChange"
          @mention-change="handleMentionChange"
        />
      </template>
      <!-- 自定义header区 -->
      <template #sender-header>
        <CustomSenderHeader
          ref="customSenderHeaderRef"
          :skills="props.skills"
          :is-open="isSkillMenuOpen"
          :query="skillQuery"
          @skill-select="selectSkill"
          @mention-close="closeMention"
        />
      </template>
      <template #sender-inner-header>
        <div class="sender-attachments">
          <TdAttachments
            v-if="files.length"
            :items="files"
            overflow="scrollX"
            @remove="handleAttachmentRemove"
          />
          <!-- <p v-if="activeFile" class="sender-file-status">
            已上传 {{ activeFile.fileName }}，已绑定 Data Agent；
            {{ formatIndexStatus(activeFile.indexStatus) }}
          </p>
          <ul v-if="activeFile?.sheets.length" class="sender-sheet-summary">
            <li v-for="sheet in activeFile.sheets" :key="sheet.name">
              {{ formatSheetSummary(sheet) }}
            </li>
          </ul>
          <p v-if="uploadError || chatError" class="sender-error" role="alert">
            {{ uploadError || chatError }}
          </p> -->
        </div>
      </template>
      <!-- 自定义操作区 左侧 -->
      <!-- <template #sender-input-prefix>
        <el-select-v2 style="width: 150px" v-model="model" :options="options" />
      </template> -->
      <!-- 自定义底部操作区 -->
      <template #sender-footer-prefix>
        <div class="custom-sender">
          <el-select-v2
            style="width: 150px"
            v-model="model"
            :options="options"
          />
        </div>
      </template>
      <!-- 自定义底部操作区 右侧 -->
      <template #sender-actions>
        <el-button
          circle
          :disabled="isUploading"
          @click="handleUpload"
          :icon="Upload"
        />
        <el-button
          :disabled="query.length === 0 || isUploading || isSending"
          type="primary"
          @click="handleSend"
          circle
          :icon="Position"
        />
      </template>
      <!-- 自定义渲染 -->
      <template v-for="msg in messages" :key="msg.id">
        <template
          v-for="(item, index) in msg.content ?? []"
          :key="`${msg.id}-${index}`"
        >
          <div
            v-if="isDownloadContent(item)"
            :slot="getMessageContentSlot(msg.id, item.type, index)"
          >
            <SpreadsheetDownloadCard :artifact="item.data" />
          </div>
        </template>
      </template>
    </TdChatbot>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, useTemplateRef } from "vue";
import {
  Attachments as TdAttachments,
  Chatbot as TdChatbot,
  type AIMessageContent,
  type ChatRequestParams,
  type ChatMessagesData,
  type ChatServiceConfig,
  type SSEChunkData,
  type TdChatMessageConfigItem,
  type TdChatbotApi,
} from "@tdesign-vue-next/chat";
import {
  DATA_AGENT_KEY,
  chatStreamContentSchema,
  downloadArtifactSchema,
  type AgentSkill,
  type DownloadArtifact,
  type WorkbookFileResponse,
  type WorkbookSheetSummary,
} from "@data-agent/shared";

import { Upload, Position } from "@element-plus/icons-vue";

import { fetchWorkbookFile, uploadSpreadsheet } from "../common/api";
import SpreadsheetDownloadCard from "../../../components/SpreadsheetDownloadCard.vue";
import CustomSender from "./components/custom-sender-textarea.vue";
import CustomSenderHeader from "./components/custom-sender-header.vue";

type DownloadMessageContent = {
  type: "download";
  data: DownloadArtifact;
};

declare global {
  interface AIContentTypeOverrides {
    download: DownloadMessageContent;
  }
}

type StreamRequestMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type UploadedAttachment = {
  name: string;
  size: number;
  type: string;
  raw: File;
  status: "success";
};

type ChatbotSenderProps = NonNullable<
  InstanceType<typeof TdChatbot>["$props"]["senderProps"]
>;

const props = withDefaults(
  defineProps<{
    skills?: AgentSkill[];
  }>(),
  {
    skills: () => [],
  },
);

const emit = defineEmits<{
  "skill-select": [skill: AgentSkill];
}>();

const initialMessages: ChatMessagesData[] = [];
const messages = shallowRef<ChatMessagesData[]>([]);
const activeFile = shallowRef<WorkbookFileResponse>();
const files = ref<UploadedAttachment[]>([]);
const isUploading = ref(false);
const isSending = ref(false);
const uploadError = ref("");
const chatError = ref("");
const INDEX_STATUS_POLL_INTERVAL_MS = 1500;
let indexStatusPollTimer: ReturnType<typeof setTimeout> | undefined;

const chatRef = useTemplateRef<TdChatbotApi>("chatRef");
const customSenderRef = useTemplateRef<{
  insertSkill: (skill: AgentSkill) => void;
  closeMention: () => void;
  clearInput: () => void;
  getSelectedSkillNames: () => string[];
}>("customSenderRef");

const customSenderHeaderRef = useTemplateRef<{
  handleKeydown: (event: KeyboardEvent) => void;
}>("customSenderHeaderRef");

const query = ref("");
const skillQuery = ref("");
const isSkillMenuOpen = ref(false);

const handleInputChange = (value: string) => {
  query.value = value;
};

const handleMentionChange = (payload: { isOpen: boolean; query: string }) => {
  isSkillMenuOpen.value = payload.isOpen;
  skillQuery.value = payload.query;
};

const selectSkill = (skill: AgentSkill) => {
  customSenderRef.value?.insertSkill(skill);
  emit("skill-select", skill);
};

const closeMention = () => {
  customSenderRef.value?.closeMention();
};

const handleSkillKeydown = (event: KeyboardEvent) => {
  customSenderHeaderRef.value?.handleKeydown(event);
};

const handleMessageChange = (event: CustomEvent<ChatMessagesData[]>) => {
  messages.value = [...event.detail];
};

const handleCustomSenderSend = (prompt: string, skills: string[]) => {
  const chatbot = chatRef.value;
  if (!chatbot) return;

  chatError.value = "";
  isSending.value = true;
  void chatbot
    .sendUserMessage({
      prompt,
      skills,
    })
    .catch((error: unknown) => {
      isSending.value = false;
      chatError.value = toErrorMessage(error, "发送消息失败");
    });
};

const model = ref("deepseek-ai/DeepSeek-V4-Flash");
const options = ref([
  {
    label: "DeepSeek-V4-Flash",
    value: "deepseek-ai/DeepSeek-V4-Flash",
  },
  {
    label: "模型2",
    value: "model2",
  },
]);

// 消息属性配置
const messageProps = (msg: ChatMessagesData): TdChatMessageConfigItem => {
  const { role, content } = msg;
  const thinking = content?.find((item) => item.type === "thinking");
  if (role === "user") {
    return {
      variant: "base",
      placement: "right",
      avatar: "",
    };
  }
  if (role === "assistant") {
    return {
      placement: "left",
      actions: ["replay", "copy", "good", "bad"],
      handleActions: {
        good: async ({ message, active }) => {
          console.log("点赞", message, active);
        },
        bad: async ({ message, active }) => {
          console.log("点踩", message, active);
        },
        replay: ({ message, active }) => {
          console.log("自定义重新回复", message, active);
          chatRef.value?.regenerate();
        },
        searchItem: ({ content, event }) => {
          event.preventDefault();
          console.log("点击搜索条目", content);
        },
        suggestion: ({ content }) => {
          console.log("点击建议问题", content);
          chatRef.value?.addPrompt(content.prompt);
        },
      },
      chatContentProps: {
        thinking: {
          maxHeight: 100,
          layout: "block",
          collapsed: thinking?.status === "complete",
        },
      },
    };
  }
  return {};
};

const toSkillNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((skill): skill is string => typeof skill === "string");
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function formatIndexStatus(
  status: WorkbookFileResponse["indexStatus"],
): string {
  if (status === "completed") return "工作簿概要和详细索引已完成。";
  if (status === "failed") return "工作簿概要已完成，详细索引失败。";
  if (status === "processing") return "工作簿概要已完成，详细索引处理中。";
  return "工作簿概要已完成，等待建立详细索引。";
}

function formatSheetSummary(sheet: WorkbookSheetSummary): string {
  const visibleHeaders = sheet.headers.slice(0, 8).join("、");
  const headerSuffix =
    sheet.headers.length > 8 || sheet.headersTruncated ? "…" : "";
  const headers = visibleHeaders
    ? `；字段：${visibleHeaders}${headerSuffix}`
    : "";
  return `${sheet.name}：${sheet.rowCount} 行数据，${sheet.columnCount} 列${headers}`;
}

function isIndexing(status: WorkbookFileResponse["indexStatus"]): boolean {
  return status === "pending" || status === "processing";
}

function clearIndexStatusPolling(): void {
  if (indexStatusPollTimer !== undefined) {
    clearTimeout(indexStatusPollTimer);
    indexStatusPollTimer = undefined;
  }
}

function startIndexStatusPolling(file: WorkbookFileResponse): void {
  clearIndexStatusPolling();
  if (!isIndexing(file.indexStatus)) return;

  const refresh = async (): Promise<void> => {
    try {
      const latestFile = await fetchWorkbookFile(file.fileId);
      if (activeFile.value?.fileId !== file.fileId) return;

      activeFile.value = latestFile;
      if (isIndexing(latestFile.indexStatus)) {
        indexStatusPollTimer = setTimeout(() => {
          void refresh();
        }, INDEX_STATUS_POLL_INTERVAL_MS);
      }
    } catch {
      // 文件已上传成功；短暂的状态查询失败不应覆盖当前文件或中断对话。
      if (activeFile.value?.fileId === file.fileId) {
        indexStatusPollTimer = setTimeout(() => {
          void refresh();
        }, INDEX_STATUS_POLL_INTERVAL_MS);
      }
    }
  };

  indexStatusPollTimer = setTimeout(() => {
    void refresh();
  }, INDEX_STATUS_POLL_INTERVAL_MS);
}

function getMessageText(message: ChatMessagesData): string {
  const parts: string[] = [];
  for (const content of message.content ?? []) {
    if (content.type === "text" || content.type === "markdown") {
      parts.push(content.data);
    }
  }
  return parts.join("\n").trim();
}

function toStreamRequestMessages(prompt: string): StreamRequestMessage[] {
  const history: StreamRequestMessage[] = [];
  for (const message of messages.value) {
    const content = getMessageText(message);
    if (content) {
      history.push({
        role: message.role,
        content,
      });
    }
  }

  const lastMessage = history[history.length - 1];
  if (
    !lastMessage ||
    lastMessage.role !== "user" ||
    lastMessage.content !== prompt
  ) {
    history.push({ role: "user", content: prompt });
  }
  return history;
}

function isDownloadContent(
  content: unknown,
): content is DownloadMessageContent {
  return (
    isRecord(content) &&
    content.type === "download" &&
    downloadArtifactSchema.safeParse(content.data).success
  );
}

function getMessageContentSlot(
  messageId: string,
  contentType: string,
  index: number,
): string {
  return [messageId, contentType, index].join("-");
}

function toStreamMessageContent(chunk: SSEChunkData): AIMessageContent {
  const parsed = chatStreamContentSchema.safeParse(chunk.data);
  if (!parsed.success) {
    const message =
      isRecord(chunk.data) && typeof chunk.data.message === "string"
        ? chunk.data.message
        : "";
    return { type: "text", data: message };
  }

  switch (parsed.data.type) {
    case "markdown":
    case "download":
      return parsed.data;
    case "chart":
      return { type: "text", data: "" };
  }
  return { type: "text", data: "" };
}

const chatServiceConfig: ChatServiceConfig = {
  endpoint: "/api/chat/stream/v2",
  stream: true,
  onMessage: toStreamMessageContent,
  onRequest: (innerParams: ChatRequestParams) => {
    const prompt =
      typeof innerParams.prompt === "string" ? innerParams.prompt : "";
    const file = activeFile.value;
    return {
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: file ? DATA_AGENT_KEY : undefined,
        fileId: file?.fileId,
        messages: toStreamRequestMessages(prompt),
        skills: toSkillNames(innerParams.skills),
      }),
    };
  },
  onComplete: () => {
    isSending.value = false;
  },
  onError: (error) => {
    isSending.value = false;
    chatError.value = toErrorMessage(error, "对话请求失败");
  },
  onAbort: async () => {
    isSending.value = false;
  },
};

const handleUpload = () => {
  chatRef.value?.selectFile();
};

async function uploadSelectedFile(file: File): Promise<void> {
  if (!file.name.toLocaleLowerCase().endsWith(".xlsx")) {
    uploadError.value = "当前文件读取、修改和下载仅支持 .xlsx 文件";
    return;
  }

  isUploading.value = true;
  uploadError.value = "";
  try {
    const uploadedFile = await uploadSpreadsheet(file);
    activeFile.value = uploadedFile;
    startIndexStatusPolling(uploadedFile);
    files.value = [
      {
        name: file.name,
        size: file.size,
        type: file.type,
        raw: file,
        status: "success",
      },
    ];
  } catch (error) {
    uploadError.value = toErrorMessage(error, "文件上传失败");
  } finally {
    isUploading.value = false;
  }
}

const handleAttachmentRemove = () => {
  clearIndexStatusPolling();
  files.value = [];
  activeFile.value = undefined;
  uploadError.value = "";
};

onBeforeUnmount(clearIndexStatusPolling);

function getSelectedFile(value: unknown): File | undefined {
  if (value instanceof File) return value;
  if (!isRecord(value) || !(value.raw instanceof File)) return undefined;
  return value.raw;
}

const onFileSelect: NonNullable<ChatbotSenderProps["onFileSelect"]> = (
  event,
) => {
  const file = getSelectedFile(event.detail[0]);
  if (!file) return;
  void uploadSelectedFile(file);
};

const senderProps = {
  placeholder: "",
  uploadProps: {
    multiple: false,
    accept: ".xlsx",
  },
  onFileSelect,
} satisfies ChatbotSenderProps;

const handleSend = () => {
  const value = query.value.trim();
  if (!value || isUploading.value || isSending.value) return;

  const skills = customSenderRef.value?.getSelectedSkillNames() ?? [];
  handleCustomSenderSend(value, skills);
  customSenderRef.value?.clearInput();
  query.value = "";
};
</script>
<style scoped>
.chat-panel {
  width: 100%;
  height: 100%;
  padding: 10px;
  box-sizing: border-box;

  font-size: 12px;

  .custom-sender {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sender-attachments {
    min-height: 0;
  }

  .sender-file-status,
  .sender-error {
    margin: 6px 0 0;
    font-size: 12px;
  }

  .sender-file-status {
    color: #0052d9;
  }

  .sender-sheet-summary {
    padding-left: 18px;
    margin: 4px 0 0;
    color: #4e5969;
    line-height: 20px;
  }

  .sender-error {
    color: #d54941;
  }
}
</style>
