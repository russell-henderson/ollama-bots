import { getSelectedModel, initOllama } from "./ollama.js";
import { getCharactersSnapshot, getSelectedCharacterIds, initCharacters, setCharacterModel } from "./characters.js";
import { getCharacterDocumentContext, getCharacterPromptContextBundle, initDocuments } from "./documents.js";
import { initStorage, readStorageJSON, STORAGE_KEYS, writeStorageJSON } from "./storage.js";
import { initWorkspace } from "./workspace.js";
import { AIStatusIndicator } from "./status-indicator.js";
import { formatMessageForCopy } from "./copy-format.js";
import { createPerfTelemetry } from "./telemetry.js";

const OLLAMA_BASE_URL = "http://localhost:11434";
const conversationStateByCharacter = new Map();
const templateState = { global: [], perCharacter: {} };
const pinnedChats = [];
const DRAFT_KEY_PREFIX = "ollama.app.v2.draft";
const AUTO_NAME_FALLBACK = "New Conversation";
const MAX_RENDERED_MESSAGES = 200;
const LOAD_OLDER_BATCH = 100;

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function makeBranchId(characterId) {
  const token = Math.random().toString(36).slice(2, 8);
  return `branch-${characterId}-${Date.now()}-${token}`;
}

function makeCharacterId(baseName) {
  const slug = String(baseName || "character")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `char-${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMessage(message) {
  const metadata = message && typeof message.metadata === "object" && message.metadata
    ? { ...message.metadata }
    : {};
  if (!Array.isArray(metadata.annotations)) {
    metadata.annotations = [];
  }
  if (!Object.prototype.hasOwnProperty.call(metadata, "rating")) {
    metadata.rating = null;
  }
  if (!Object.prototype.hasOwnProperty.call(metadata, "analyticsId")) {
    metadata.analyticsId = "";
  }
  return {
    id: String((message && message.id) || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    role: message && message.role === "assistant" ? "assistant" : "user",
    content: String((message && message.content) || ""),
    time: String((message && message.time) || ""),
    modelTag: String((message && message.modelTag) || ""),
    metadata,
    editHistory: Array.isArray(message && message.editHistory) ? message.editHistory : [],
    currentVersion: Number.isInteger(message && message.currentVersion) ? message.currentVersion : -1
  };
}

function cloneMessages(messages) {
  return messages.map((message) => ({ ...normalizeMessage(message) }));
}

function makeMessage(role, content, time, modelTag, metadata) {
  return normalizeMessage({
    role,
    content,
    time,
    modelTag,
    metadata: metadata || {}
  });
}

function createBranch(characterId, source) {
  const base = source || {};
  return {
    id: base.id || makeBranchId(characterId),
    label: String(base.label || "Main"),
    manualLabel: Boolean(base.manualLabel),
    autoNamed: Boolean(base.autoNamed),
    parentBranchId: base.parentBranchId || "",
    parentMessageIndex: Number.isFinite(base.parentMessageIndex) ? base.parentMessageIndex : 0,
    messages: cloneMessages(Array.isArray(base.messages) ? base.messages : [])
  };
}

function normalizeConversationState(characterId, rawState) {
  if (Array.isArray(rawState)) {
    const branch = createBranch(characterId, {
      label: "Main",
      messages: rawState
    });
    return { activeBranchId: branch.id, branches: [branch] };
  }

  const branches = Array.isArray(rawState && rawState.branches)
    ? rawState.branches.map((branch) => createBranch(characterId, branch))
    : [];

  if (!branches.length) {
    const main = createBranch(characterId, { label: "Main", messages: [] });
    return { activeBranchId: main.id, branches: [main] };
  }

  const activeBranchId = branches.some((branch) => branch.id === rawState.activeBranchId)
    ? rawState.activeBranchId
    : branches[0].id;
  return { activeBranchId, branches };
}

function shortenModelName(model) {
  const raw = String(model || "").trim();
  if (!raw) {
    return "";
  }
  const withoutNamespace = raw.includes("/") ? raw.split("/").pop() : raw;
  if (withoutNamespace.length <= 18) {
    return withoutNamespace;
  }
  return `${withoutNamespace.slice(0, 16)}..`;
}

function appendMessage(logNode, role, text, timeText, modelTag, messageId, options) {
  const article = document.createElement("article");
  article.className = role === "user" ? "message message-user" : "message message-assistant";
  if (messageId) {
    article.dataset.messageId = messageId;
  }

  const body = document.createElement("p");
  body.textContent = text;
  article.appendChild(body);

  const time = document.createElement("time");
  const baseTime = timeText || formatTime(new Date());
  time.textContent = modelTag ? `${baseTime} · ${modelTag}` : baseTime;
  article.appendChild(time);

  const actions = document.createElement("div");
  actions.className = "message-actions";
  const copyConfigs = [
    { mode: "plain", label: "Copy" },
    { mode: "markdown", label: "Markdown" },
    { mode: "code", label: "Code" }
  ];
  copyConfigs.forEach((config) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-action-btn";
    button.dataset.copyMode = config.mode;
    button.textContent = config.label;
    button.addEventListener("click", async () => {
      const ok = await copyMessageByFormat(body.textContent || "", config.mode);
      button.textContent = ok ? "Copied" : "Failed";
      window.setTimeout(() => {
        button.textContent = config.label;
      }, 900);
    });
    actions.appendChild(button);
  });

  if (role === "user" && options && options.enableUserRevision) {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "message-action-btn";
    editButton.textContent = "Edit Turn";
    editButton.addEventListener("click", () => {
      if (typeof options.onEditUser === "function") {
        options.onEditUser();
      }
    });
    actions.appendChild(editButton);

    const regenerateButton = document.createElement("button");
    regenerateButton.type = "button";
    regenerateButton.className = "message-action-btn";
    regenerateButton.textContent = "Regenerate";
    regenerateButton.addEventListener("click", () => {
      if (typeof options.onRegenerateUser === "function") {
        options.onRegenerateUser();
      }
    });
    actions.appendChild(regenerateButton);
  }

  if (role === "assistant" && options && options.enableRating) {
    let currentRating = options.rating === 1 || options.rating === -1 ? options.rating : null;
    const upButton = document.createElement("button");
    upButton.type = "button";
    upButton.className = "message-action-btn message-rating-btn";
    upButton.textContent = "Up";

    const downButton = document.createElement("button");
    downButton.type = "button";
    downButton.className = "message-action-btn message-rating-btn";
    downButton.textContent = "Down";

    const paintRatingState = () => {
      upButton.classList.toggle("rating-active", currentRating === 1);
      downButton.classList.toggle("rating-active", currentRating === -1);
    };

    upButton.addEventListener("click", () => {
      const next = currentRating === 1 ? null : 1;
      if (typeof options.onRate === "function") {
        options.onRate(next);
      }
      currentRating = next;
      paintRatingState();
    });

    downButton.addEventListener("click", () => {
      const next = currentRating === -1 ? null : -1;
      if (typeof options.onRate === "function") {
        options.onRate(next);
      }
      currentRating = next;
      paintRatingState();
    });

    paintRatingState();
    actions.appendChild(upButton);
    actions.appendChild(downButton);
  }

  if (options && options.enableAnnotations) {
    const annotationActions = document.createElement("div");
    annotationActions.className = "message-annotation-actions";
    const actionConfigs = [
      { type: "note", label: "Note" },
      { type: "feedback", label: "Feedback" },
      { type: "bookmark", label: "Bookmark" }
    ];
    actionConfigs.forEach((config) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "message-action-btn";
      button.textContent = config.label;
      button.addEventListener("click", () => {
        const promptLabel = config.type === "bookmark"
          ? "Bookmark label (optional):"
          : `${config.label} text:`;
        const value = window.prompt(promptLabel, "");
        if (value === null) {
          return;
        }
        if (typeof options.onAnnotationAction === "function") {
          options.onAnnotationAction({
            action: "add",
            type: config.type,
            text: String(value || "").trim()
          });
        }
      });
      annotationActions.appendChild(button);
    });
    actions.appendChild(annotationActions);

    const annotationsWrap = document.createElement("div");
    annotationsWrap.className = "message-annotations";
    const annotations = Array.isArray(options.annotations) ? options.annotations : [];
    annotations.forEach((annotation) => {
      const row = document.createElement("div");
      row.className = "message-annotation";
      const label = document.createElement("strong");
      label.textContent = `[${String(annotation.type || "note")}]`;
      row.appendChild(label);
      const textNode = document.createElement("span");
      textNode.textContent = ` ${String(annotation.text || "(empty)")}`;
      row.appendChild(textNode);

      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "message-action-btn";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => {
        const next = window.prompt("Edit annotation:", String(annotation.text || ""));
        if (next === null) {
          return;
        }
        if (typeof options.onAnnotationAction === "function") {
          options.onAnnotationAction({
            action: "edit",
            annotationId: annotation.id,
            text: String(next || "").trim()
          });
        }
      });
      row.appendChild(editButton);

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "message-action-btn";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        if (typeof options.onAnnotationAction === "function") {
          options.onAnnotationAction({
            action: "delete",
            annotationId: annotation.id
          });
        }
      });
      row.appendChild(deleteButton);
      annotationsWrap.appendChild(row);
    });
    article.appendChild(annotationsWrap);
  }

  article.appendChild(actions);

  logNode.appendChild(article);
  logNode.scrollTop = logNode.scrollHeight;
  return { article, body, time };
}

function ensureConversationState(characterId) {
  if (!characterId) {
    return null;
  }
  if (!conversationStateByCharacter.has(characterId)) {
    const main = createBranch(characterId, { label: "Main", messages: [] });
    conversationStateByCharacter.set(characterId, { activeBranchId: main.id, branches: [main] });
  }
  return conversationStateByCharacter.get(characterId);
}

function getActiveBranch(state) {
  if (!state || !state.branches.length) {
    return null;
  }
  const active = state.branches.find((branch) => branch.id === state.activeBranchId);
  if (active) {
    return active;
  }
  state.activeBranchId = state.branches[0].id;
  return state.branches[0];
}

function loadConversationState() {
  const stored = readStorageJSON(STORAGE_KEYS.conversations, {});
  if (!stored || typeof stored !== "object") {
    return;
  }

  Object.keys(stored).forEach((characterId) => {
    const normalized = normalizeConversationState(characterId, stored[characterId]);
    conversationStateByCharacter.set(characterId, normalized);
  });
}

function persistConversationState() {
  const payload = {};
  conversationStateByCharacter.forEach((state, characterId) => {
    payload[characterId] = {
      activeBranchId: state.activeBranchId,
      branches: state.branches.map((branch) => ({
        id: branch.id,
        label: branch.label,
        manualLabel: Boolean(branch.manualLabel),
        autoNamed: Boolean(branch.autoNamed),
        parentBranchId: branch.parentBranchId || "",
        parentMessageIndex: branch.parentMessageIndex || 0,
        messages: cloneMessages(branch.messages)
      }))
    };
  });
  writeStorageJSON(STORAGE_KEYS.conversations, payload);
}

function loadTemplateState() {
  const stored = readStorageJSON(STORAGE_KEYS.chatTemplates, null);
  if (!stored || typeof stored !== "object") {
    return;
  }
  templateState.global = Array.isArray(stored.global)
    ? stored.global.map((item) => ({
        id: String(item.id || ""),
        title: String(item.title || "Starter"),
        content: String(item.content || "")
      }))
    : [];
  templateState.perCharacter = stored.perCharacter && typeof stored.perCharacter === "object"
    ? stored.perCharacter
    : {};
}

function persistTemplateState() {
  writeStorageJSON(STORAGE_KEYS.chatTemplates, templateState);
}

function renderConversation(logNode, messages, options) {
  const startedAt = performance.now();
  logNode.innerHTML = "";
  messages.forEach((message) => {
    appendMessage(
      logNode,
      message.role,
      message.content,
      message.time,
      message.modelTag,
      message.id,
      {
        enableRating: message.role === "assistant",
        enableUserRevision: message.role === "user",
        rating: message && message.metadata ? message.metadata.rating : null,
        enableAnnotations: true,
        annotations: message && message.metadata ? message.metadata.annotations : [],
        onRate: typeof options?.onRate === "function"
          ? (nextRating) => options.onRate(message.id, nextRating)
          : null,
        onAnnotationAction: typeof options?.onAnnotationAction === "function"
          ? (payload) => options.onAnnotationAction(message.id, payload)
          : null,
        onEditUser: typeof options?.onEditUser === "function"
          ? () => options.onEditUser(message.id)
          : null,
        onRegenerateUser: typeof options?.onRegenerateUser === "function"
          ? () => options.onRegenerateUser(message.id)
          : null
      }
    );
  });
  if (options && typeof options.onRenderComplete === "function") {
    options.onRenderComplete(performance.now() - startedAt, messages.length);
  }
}

function renderBranchSelect(selectNode, state) {
  selectNode.innerHTML = "";
  state.branches.forEach((branch, index) => {
    const option = document.createElement("option");
    option.value = branch.id;
    option.textContent = `${index + 1}. ${branch.label || "Untitled Branch"}`;
    selectNode.appendChild(option);
  });
  selectNode.value = state.activeBranchId;
}

function renderTemplateSelect(selectNode, characterId) {
  selectNode.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose starter";
  selectNode.appendChild(placeholder);

  const global = templateState.global || [];
  if (global.length) {
    const group = document.createElement("optgroup");
    group.label = "Global";
    global.forEach((template) => {
      const option = document.createElement("option");
      option.value = `g:${template.id}`;
      option.textContent = template.title;
      group.appendChild(option);
    });
    selectNode.appendChild(group);
  }

  const scoped = templateState.perCharacter && templateState.perCharacter[characterId]
    ? templateState.perCharacter[characterId]
    : [];
  if (scoped.length) {
    const group = document.createElement("optgroup");
    group.label = "Character";
    scoped.forEach((template) => {
      const option = document.createElement("option");
      option.value = `c:${template.id}`;
      option.textContent = template.title;
      group.appendChild(option);
    });
    selectNode.appendChild(group);
  }
}

function getSelectedTemplate(characterId, value) {
  if (!value) {
    return null;
  }
  if (value.startsWith("g:")) {
    const id = value.slice(2);
    return (templateState.global || []).find((item) => item.id === id) || null;
  }
  if (value.startsWith("c:")) {
    const id = value.slice(2);
    const scoped = (templateState.perCharacter && templateState.perCharacter[characterId]) || [];
    return scoped.find((item) => item.id === id) || null;
  }
  return null;
}

function setComposerState(formNode, isLoading) {
  const input = formNode.querySelector("input");
  const sendButton = formNode.querySelector('button[type="submit"]');
  const stopButton = formNode.querySelector("#stop-generation");
  if (!input || !sendButton || !stopButton) {
    return;
  }

  input.disabled = isLoading;
  sendButton.disabled = isLoading;
  stopButton.disabled = !isLoading;
  sendButton.textContent = isLoading ? "..." : ">";
}

function renderAskAllResults(container, entries) {
  container.innerHTML = "";
  if (!entries.length) {
    return;
  }
  entries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "ask-all-card";
    const title = document.createElement("h4");
    title.textContent = `${entry.characterName} (${entry.model || "no model"})`;
    card.appendChild(title);
    const body = document.createElement("p");
    body.textContent = entry.error ? `Error: ${entry.error}` : entry.response;
    card.appendChild(body);
    container.appendChild(card);
  });
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function downloadText(filename, content, type) {
  const blob = new Blob([String(content || "")], { type: type || "text/plain;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function estimateTokenCount(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words * 1.3));
}

function toTitleCase(words) {
  return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}

function isDefaultConversationLabel(label) {
  const normalized = String(label || "").trim().toLowerCase();
  return normalized === "" || normalized === "main" || normalized === "untitled branch" || normalized === "new conversation";
}

function buildAutoConversationTitle(messages) {
  const firstUser = (messages || []).find((message) => message.role === "user" && String(message.content || "").trim());
  if (!firstUser) {
    return AUTO_NAME_FALLBACK;
  }

  const cleaned = String(firstUser.content)
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return AUTO_NAME_FALLBACK;
  }

  const words = cleaned.split(" ").slice(0, 5).map((word) => word.toLowerCase());
  const title = toTitleCase(words).slice(0, 50).trim();
  return title || AUTO_NAME_FALLBACK;
}

async function copyMessageByFormat(text, format) {
  const content = formatMessageForCopy(text, format);

  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch (error) {
    console.error("Copy to clipboard failed:", error);
    return false;
  }
}

function makeDraftStorageKey(characterId, branchId) {
  return `${DRAFT_KEY_PREFIX}.${characterId || "none"}.${branchId || "none"}`;
}

function maybeAutoNameBranch(branch) {
  if (!branch || branch.manualLabel) {
    return false;
  }
  const hasUser = branch.messages.some((message) => message.role === "user" && String(message.content || "").trim());
  const hasAssistant = branch.messages.some((message) => message.role === "assistant" && String(message.content || "").trim());
  if (!hasUser || !hasAssistant) {
    return false;
  }
  if (!isDefaultConversationLabel(branch.label) && !branch.autoNamed) {
    return false;
  }
  const next = buildAutoConversationTitle(branch.messages);
  if (!next) {
    return false;
  }
  branch.label = next;
  branch.autoNamed = true;
  return true;
}

async function fetchWithRetryAndTimeout(url, options, config) {
  const timeoutMs = config && config.timeoutMs ? config.timeoutMs : 45000;
  const retries = config && Number.isInteger(config.retries) ? config.retries : 1;
  const backoffMs = config && config.backoffMs ? config.backoffMs : 500;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      window.clearTimeout(timer);
      return response;
    } catch (error) {
      window.clearTimeout(timer);
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => window.setTimeout(resolve, backoffMs * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error("Request failed after retries.");
}

async function generateCharacterResponse(character, prompt, telemetry) {
  const docs = await getCharacterDocumentContext(character.id).catch(() => []);
  const promptBundle = await getCharacterPromptContextBundle(character.id, {
    tokenBudget: Number(character && character.contextWindow ? character.contextWindow : 4096),
    reserveTokens: 300,
    query: prompt,
    telemetry
  }).catch(() => ({ text: "", usage: null }));
  const promptContext = String(promptBundle && promptBundle.text ? promptBundle.text : "");
  const docHint = docs.length
    ? docs.map((doc) => `${doc.name}${doc.pinnedVersionId ? ` [pinned:${doc.pinnedVersionId}]` : ""}`).join(", ")
    : "none";
  const messages = [];
  if (character.systemPrompt) {
    messages.push({ role: "system", content: character.systemPrompt });
  }
  messages.push({
    role: "system",
    content: `Assigned documents: ${docHint}`
  });
  if (promptContext) {
    messages.push({
      role: "system",
      content: `Use this assigned document context when relevant:\n\n${promptContext}`
    });
  }
  messages.push({ role: "user", content: prompt });

  const response = await fetchWithRetryAndTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: character.model || getSelectedModel(),
      stream: false,
      messages,
      options: {
        temperature: character.temperature,
        top_p: character.topP,
        top_k: character.topK,
        num_ctx: character.contextWindow,
        num_predict: character.maxTokens
      }
    })
  }, { timeoutMs: 60000, retries: 1, backoffMs: 600 });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  return String((payload && payload.message && payload.message.content) || "").trim() || "(No response)";
}

async function streamAssistantReply(logNode, model, messages, abortSignal, preambleMessages, statusHooks) {
  const historyMessages = messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
  const preamble = Array.isArray(preambleMessages) ? preambleMessages : [];
  const outboundMessages = preamble.concat(historyMessages);
  const hooks = statusHooks && typeof statusHooks === "object" ? statusHooks : {};
  if (typeof hooks.onRequestStart === "function") {
    hooks.onRequestStart();
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages: outboundMessages
    }),
    signal: abortSignal
  });

  if (!response.ok || !response.body) {
    throw new Error(`Chat request failed with status ${response.status}`);
  }

  const assistantMessage = appendMessage(logNode, "assistant", "");
  assistantMessage.body.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
  assistantMessage.article.classList.add("thinking");
  const streamStartedAt = performance.now();
  let firstTokenAt = null;
  
  const thinkingTimer = window.setInterval(() => {
    const elapsedSeconds = (performance.now() - streamStartedAt) / 1000;
    assistantMessage.time.textContent = `Thinking (${elapsedSeconds.toFixed(1)}s)`;
  }, 100);

  function stopThinkingState() {
    window.clearInterval(thinkingTimer);
    assistantMessage.article.classList.remove("thinking");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assembled = "";
  let streamedTokenCount = 0;
  let lastTokenAt = null;
  let cadenceSumMs = 0;
  let cadenceSamples = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }

        try {
          const packet = JSON.parse(trimmed);
          const token = packet.message && packet.message.content ? packet.message.content : "";
          if (token) {
            const now = performance.now();
            if (lastTokenAt !== null) {
              const cadence = now - lastTokenAt;
              cadenceSumMs += cadence;
              cadenceSamples += 1;
              if (typeof hooks.onTokenCadence === "function") {
                hooks.onTokenCadence(cadence);
              }
            }
            lastTokenAt = now;
            if (!firstTokenAt) {
              firstTokenAt = now;
              stopThinkingState();
              if (typeof hooks.onFirstToken === "function") {
                hooks.onFirstToken();
              }
            }
            const isAtBottom = (logNode.scrollHeight - logNode.scrollTop - logNode.clientHeight) < 40;
            assembled += token;
            streamedTokenCount += 1;
            if (typeof hooks.onToken === "function") {
              hooks.onToken(streamedTokenCount);
            }
            assistantMessage.body.textContent = assembled;
            if (isAtBottom) {
              logNode.scrollTop = logNode.scrollHeight;
            }
          }
        } catch (error) {
          console.error("Failed to parse stream chunk:", error);
        }
      });
    }
  } catch (error) {
    if (error && error.name === "AbortError") {
      stopThinkingState();
      return {
        text: assembled.trim(),
        aborted: true,
        firstTokenMs: firstTokenAt ? Math.round(firstTokenAt - streamStartedAt) : null,
        tokenCount: streamedTokenCount,
        avgCadenceMs: cadenceSamples ? Math.round(cadenceSumMs / cadenceSamples) : 0
      };
    }
    stopThinkingState();
    throw error;
  }

  if (!assembled.trim()) {
    stopThinkingState();
    assistantMessage.body.textContent = "No response received from model.";
  }

  return {
    text: assembled.trim() || "No response received from model.",
    aborted: false,
    firstTokenMs: firstTokenAt ? Math.round(firstTokenAt - streamStartedAt) : null,
    tokenCount: streamedTokenCount,
    avgCadenceMs: cadenceSamples ? Math.round(cadenceSumMs / cadenceSamples) : 0
  };
}

function initChat() {
  const formNode = document.getElementById("chat-form");
  const inputNode = document.getElementById("chat-input");
  const logNode = document.getElementById("chat-log");
  const branchSelectNode = document.getElementById("branch-select");
  const newBranchButton = document.getElementById("new-branch");
  const templateSelectNode = document.getElementById("template-select");
  const saveTemplateButton = document.getElementById("save-template");
  const applyTemplateButton = document.getElementById("apply-template");
  const undoButton = document.getElementById("undo-turn");
  const resetButton = document.getElementById("reset-chat");
  const conversationLabelNode = document.getElementById("conversation-label");
  const saveConversationLabelButton = document.getElementById("save-conversation-label");
  const askAllButton = document.getElementById("ask-all-characters");
  const quickModelSelect = document.getElementById("quick-model-select");
  const quickModelSizeBadge = document.getElementById("quick-model-size-badge");
  const docsTabButton = document.getElementById("docs-tab-btn");
  const quickActionsTabButton = document.getElementById("quick-actions-tab-btn");
  const docsTabPanel = document.getElementById("docs-tab");
  const quickActionsTabPanel = document.getElementById("quick-actions-tab");
  const openCharactersPanelButton = document.getElementById("open-characters-panel");
  const openDocsPanelButton = document.getElementById("open-docs-panel");
  const mobileDrawerBackdrop = document.getElementById("mobile-drawer-backdrop");
  const charactersPanelNode = document.querySelector(".panel-characters");
  const docsPanelNode = document.querySelector(".panel-docs");
  const askAllResultsNode = document.getElementById("ask-all-results");
  const pinChatButton = document.getElementById("pin-chat");
  const pinnedChatsNode = document.getElementById("pinned-chats");
  const telemetryNode = document.getElementById("chat-telemetry");
  const analyticsDashboardNode = document.getElementById("analytics-dashboard");
  const analyticsSummaryNode = document.getElementById("analytics-summary");
  const refreshAnalyticsButton = document.getElementById("refresh-analytics");
  const analyticsPanel = document.getElementById("analytics-panel");
  const contextPanel = document.getElementById("context-panel");
  const analyticsToggleButton = document.getElementById("analytics-toggle");
  const contextToggleButton = document.getElementById("context-toggle");
  const analyticsBadge = document.getElementById("analytics-badge");
  const contextBadge = document.getElementById("context-badge");
  const contextUsagePanel = document.getElementById("context-usage-panel");
  const contextUsageFill = document.getElementById("context-usage-fill");
  const contextUsageText = document.getElementById("context-usage-text");
  const contextUsageDocs = document.getElementById("context-usage-docs");
  const chatToolsNode = document.getElementById("chat-tools");
  const duplicateConversationButton = document.getElementById("duplicate-conversation");
  const openPromptChainsButton = document.getElementById("open-prompt-chains");
  const openAdvancedExportButton = document.getElementById("open-advanced-export");
  const exportCharacterButton = document.getElementById("export-character");
  const importCharacterButton = document.getElementById("import-character");
  const importCharacterInput = document.getElementById("character-import-input");
  const exportWorkspaceButton = document.getElementById("export-workspace");
  const commandPaletteModal = document.getElementById("command-palette-modal");
  const commandPaletteInput = document.getElementById("command-palette-input");
  const commandPaletteList = document.getElementById("command-palette-list");
  const commandPaletteClose = document.getElementById("command-palette-close");
  const conversationSearchModal = document.getElementById("conversation-search-modal");
  const conversationSearchQuery = document.getElementById("conversation-search-query");
  const conversationSearchCharacter = document.getElementById("conversation-search-character");
  const conversationSearchDocs = document.getElementById("conversation-search-docs");
  const conversationSearchFrom = document.getElementById("conversation-search-from");
  const conversationSearchTo = document.getElementById("conversation-search-to");
  const conversationSearchResults = document.getElementById("conversation-search-results");
  const conversationSearchClose = document.getElementById("conversation-search-close");
  const promptChainModal = document.getElementById("prompt-chain-modal");
  const chainNameInput = document.getElementById("chain-name");
  const chainVarsInput = document.getElementById("chain-vars");
  const chainStepsInput = document.getElementById("chain-steps");
  const chainSaveButton = document.getElementById("chain-save");
  const chainRunButton = document.getElementById("chain-run");
  const chainRetryButton = document.getElementById("chain-retry");
  const chainResumeButton = document.getElementById("chain-resume");
  const chainCloseButton = document.getElementById("chain-close");
  const chainStatusNode = document.getElementById("chain-status");
  const chainProgressNode = document.getElementById("chain-progress");
  const advancedExportModal = document.getElementById("advanced-export-modal");
  const advancedExportProfile = document.getElementById("advanced-export-profile");
  const advancedExportName = document.getElementById("advanced-export-name");
  const exportIncludeMetadata = document.getElementById("export-include-metadata");
  const exportIncludeTime = document.getElementById("export-include-time");
  const exportIncludeRatings = document.getElementById("export-include-ratings");
  const exportIncludeAnnotations = document.getElementById("export-include-annotations");
  const exportIncludeContext = document.getElementById("export-include-context");
  const advancedExportRun = document.getElementById("advanced-export-run");
  const advancedExportClose = document.getElementById("advanced-export-close");
  const advancedExportStatus = document.getElementById("advanced-export-status");
  if (!formNode || !inputNode || !logNode || !branchSelectNode || !newBranchButton || !templateSelectNode || !saveTemplateButton || !applyTemplateButton || !undoButton || !resetButton || !conversationLabelNode || !saveConversationLabelButton || !askAllButton || !quickModelSelect || !quickModelSizeBadge || !docsTabButton || !quickActionsTabButton || !docsTabPanel || !quickActionsTabPanel || !openCharactersPanelButton || !openDocsPanelButton || !mobileDrawerBackdrop || !charactersPanelNode || !docsPanelNode || !askAllResultsNode || !duplicateConversationButton || !openPromptChainsButton || !openAdvancedExportButton || !exportCharacterButton || !importCharacterButton || !importCharacterInput || !pinChatButton || !pinnedChatsNode || !telemetryNode || !analyticsDashboardNode || !analyticsSummaryNode || !refreshAnalyticsButton || !analyticsPanel || !contextPanel || !analyticsToggleButton || !contextToggleButton || !analyticsBadge || !contextBadge || !contextUsagePanel || !contextUsageFill || !contextUsageText || !contextUsageDocs || !chatToolsNode || !exportWorkspaceButton || !commandPaletteModal || !commandPaletteInput || !commandPaletteList || !commandPaletteClose || !conversationSearchModal || !conversationSearchQuery || !conversationSearchCharacter || !conversationSearchDocs || !conversationSearchFrom || !conversationSearchTo || !conversationSearchResults || !conversationSearchClose || !promptChainModal || !chainNameInput || !chainVarsInput || !chainStepsInput || !chainSaveButton || !chainRunButton || !chainRetryButton || !chainResumeButton || !chainCloseButton || !chainStatusNode || !chainProgressNode || !advancedExportModal || !advancedExportProfile || !advancedExportName || !exportIncludeMetadata || !exportIncludeTime || !exportIncludeRatings || !exportIncludeAnnotations || !exportIncludeContext || !advancedExportRun || !advancedExportClose || !advancedExportStatus) {
    return;
  }
  let activeCharacterId = "";
  let isSending = false;
  let activeStreamController = null;
  const perfTelemetry = createPerfTelemetry(180);
  const renderStartByBranch = new Map();
  const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const savedStatusMode = window.localStorage.getItem(STORAGE_KEYS.statusIndicatorMode);
  const initialStatusMode = savedStatusMode === "linear" || savedStatusMode === "orb"
    ? savedStatusMode
    : (prefersReducedMotion ? "linear" : "orb");

  const abortActiveStream = () => {
    if (activeStreamController) {
      activeStreamController.abort();
    }
    if (aiStatus) {
      aiStatus.hide();
    }
  };

  const aiStatus = AIStatusIndicator.create({
    onStop: () => {
      abortActiveStream();
    },
    onModeChange: (mode) => {
      window.localStorage.setItem(STORAGE_KEYS.statusIndicatorMode, mode);
    },
    mode: initialStatusMode
  });
  let draftSaveTimer = null;
  chatToolsNode.open = false;
  loadConversationState();
  loadTemplateState();

  const getActiveDraftKey = () => {
    const state = ensureConversationState(activeCharacterId);
    const branch = getActiveBranch(state);
    return makeDraftStorageKey(activeCharacterId, branch ? branch.id : "");
  };

  const saveDraftNow = () => {
    const key = getActiveDraftKey();
    const value = inputNode.value.trim();
    if (!value) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, value);
  };

  const queueDraftSave = () => {
    if (draftSaveTimer) {
      window.clearTimeout(draftSaveTimer);
    }
    draftSaveTimer = window.setTimeout(() => {
      saveDraftNow();
      draftSaveTimer = null;
    }, 2000);
  };

  const restoreDraft = () => {
    const key = getActiveDraftKey();
    const draft = window.localStorage.getItem(key);
    inputNode.value = draft || "";
  };

  const getRenderStart = (branch) => {
    if (!branch || !branch.id) {
      return 0;
    }
    const maxStart = Math.max(0, branch.messages.length - MAX_RENDERED_MESSAGES);
    const existing = renderStartByBranch.get(branch.id);
    if (!Number.isInteger(existing)) {
      renderStartByBranch.set(branch.id, maxStart);
      return maxStart;
    }
    const clamped = Math.min(Math.max(0, existing), maxStart);
    renderStartByBranch.set(branch.id, clamped);
    return clamped;
  };

  const refreshChatUi = () => {
    const state = ensureConversationState(activeCharacterId);
    const branch = getActiveBranch(state);
    if (!state || !branch) {
      activeBranchRatingStats = { up: 0, down: 0, rated: 0, assistant: 0 };
      renderConversation(logNode, []);
      renderRatingSummary(null, activeBranchRatingStats);
      renderContextUsage(lastContextUsage);
      queueAnalyticsRefresh();
      inputNode.value = "";
      return;
    }
    activeBranchRatingStats = buildBranchRatingStats(branch);
    const renderStart = getRenderStart(branch);
    const visibleMessages = branch.messages.slice(renderStart);
    renderConversation(logNode, visibleMessages, {
      onRate: (messageId, nextRating) => {
        const current = branch.messages.find((item) => item.id === messageId);
        if (!current || current.role !== "assistant") {
          return;
        }
        const prev = current.metadata && (current.metadata.rating === 1 || current.metadata.rating === -1)
          ? current.metadata.rating
          : null;
        const next = nextRating === 1 || nextRating === -1 ? nextRating : null;
        if (prev === next) {
          return;
        }
        current.metadata = { ...(current.metadata || {}), rating: next };
        applyRatingDelta(activeBranchRatingStats, prev, next);
        renderRatingSummary(branch, activeBranchRatingStats);
        persistConversationState();
      },
      onAnnotationAction: (messageId, payload) => {
        const current = branch.messages.find((item) => item.id === messageId);
        if (!current) {
          return;
        }
        if (!Array.isArray(current.metadata.annotations)) {
          current.metadata.annotations = [];
        }
        const action = payload && payload.action ? payload.action : "";
        if (action === "add") {
          current.metadata.annotations.push({
            id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: String(payload.type || "note"),
            text: String(payload.text || ""),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        } else if (action === "edit") {
          const annotationId = String(payload.annotationId || "");
          current.metadata.annotations = current.metadata.annotations.map((annotation) => (
            annotation.id === annotationId
              ? {
                  ...annotation,
                  text: String(payload.text || ""),
                  updatedAt: new Date().toISOString()
                }
              : annotation
          ));
        } else if (action === "delete") {
          const annotationId = String(payload.annotationId || "");
          current.metadata.annotations = current.metadata.annotations.filter((annotation) => annotation.id !== annotationId);
        } else {
          return;
        }
        persistConversationState();
        renderStartByBranch.delete(branch.id);
        refreshChatUi();
      },
      onEditUser: (messageId) => {
        if (isSending) {
          return;
        }
        const messageIndex = branch.messages.findIndex((item) => item.id === messageId);
        if (messageIndex < 0) {
          return;
        }
        const message = branch.messages[messageIndex];
        if (!message || message.role !== "user") {
          return;
        }
        const edited = window.prompt("Edit user message:", String(message.content || ""));
        if (edited === null) {
          return;
        }
        const nextContent = String(edited || "").trim();
        if (!nextContent) {
          return;
        }
        if (!Array.isArray(message.editHistory)) {
          message.editHistory = [];
        }
        message.editHistory.push({
          content: message.content,
          time: message.time,
          editedAt: new Date().toISOString()
        });
        message.currentVersion = Number.isInteger(message.currentVersion) ? message.currentVersion + 1 : 0;
        message.content = nextContent;
        message.time = formatTime(new Date());
        // Truncate dependent turns after edited user turn for branch integrity.
        branch.messages = branch.messages.slice(0, messageIndex + 1);
        persistConversationState();
        renderStartByBranch.delete(branch.id);
        refreshChatUi();
      },
      onRegenerateUser: (messageId) => {
        if (isSending) {
          return;
        }
        const messageIndex = branch.messages.findIndex((item) => item.id === messageId);
        if (messageIndex < 0) {
          return;
        }
        const message = branch.messages[messageIndex];
        if (!message || message.role !== "user") {
          return;
        }
        const prompt = String(message.content || "").trim();
        if (!prompt) {
          return;
        }
        // Drop selected user turn and all descendants, then resubmit same user text.
        branch.messages = branch.messages.slice(0, messageIndex);
        persistConversationState();
        renderStartByBranch.delete(branch.id);
        refreshChatUi();
        inputNode.value = prompt;
        formNode.requestSubmit();
      },
      onRenderComplete: (renderMs, renderedCount) => {
        perfTelemetry.record("chat_render_ms", renderMs);
        perfTelemetry.record("chat_render_count", renderedCount);
      }
    });
    if (renderStart > 0) {
      const loadOlder = document.createElement("button");
      loadOlder.type = "button";
      loadOlder.className = "message-action-btn";
      loadOlder.textContent = `Load ${Math.min(LOAD_OLDER_BATCH, renderStart)} older messages (${renderStart} hidden)`;
      loadOlder.addEventListener("click", () => {
        renderStartByBranch.set(branch.id, Math.max(0, renderStart - LOAD_OLDER_BATCH));
        refreshChatUi();
      });
      logNode.prepend(loadOlder);
    }
    renderRatingSummary(branch, activeBranchRatingStats);
    renderBranchSelect(branchSelectNode, state);
    conversationLabelNode.value = branch.label || "";
    renderTemplateSelect(templateSelectNode, activeCharacterId);
    restoreDraft();
    renderContextUsage(lastContextUsage);
    queueAnalyticsRefresh();
  };

  const renderPinnedChats = () => {
    pinnedChatsNode.innerHTML = "";
    pinnedChats.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "pinned-chat";
      const title = document.createElement("h4");
      title.textContent = `${entry.characterName} - ${entry.branchLabel}`;
      card.appendChild(title);
      const body = document.createElement("p");
      body.textContent = entry.snapshotText || "(empty)";
      card.appendChild(body);
      pinnedChatsNode.appendChild(card);
    });
  };

  const setPanelExpanded = (name, expanded) => {
    const panel = name === "analytics" ? analyticsPanel : contextPanel;
    const toggle = name === "analytics" ? analyticsToggleButton : contextToggleButton;
    panel.classList.toggle("expanded", Boolean(expanded));
    panel.setAttribute("aria-hidden", expanded ? "false" : "true");
    toggle.classList.toggle("active", Boolean(expanded));
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  };

  setPanelExpanded("analytics", false);
  setPanelExpanded("context", false);

  const setDocsTab = (name) => {
    const docsActive = name !== "quick-actions";
    docsTabButton.classList.toggle("active", docsActive);
    quickActionsTabButton.classList.toggle("active", !docsActive);
    docsTabButton.setAttribute("aria-selected", docsActive ? "true" : "false");
    quickActionsTabButton.setAttribute("aria-selected", docsActive ? "false" : "true");
    docsTabPanel.hidden = !docsActive;
    quickActionsTabPanel.hidden = docsActive;
  };
  setDocsTab("documents");

  const syncQuickModelSelect = () => {
    const character = getCharactersSnapshot().find((item) => item.id === activeCharacterId) || null;
    if (!character || !character.model) {
      return;
    }
    const hasOption = Array.from(quickModelSelect.options).some((option) => option.value === character.model);
    if (!hasOption) {
      const option = document.createElement("option");
      option.value = character.model;
      option.textContent = character.model;
      quickModelSelect.appendChild(option);
    }
    quickModelSelect.value = character.model;
    const selectedOption = quickModelSelect.selectedOptions && quickModelSelect.selectedOptions[0]
      ? quickModelSelect.selectedOptions[0]
      : null;
    const optionText = selectedOption ? String(selectedOption.textContent || "") : "";
    const sizeMatch = optionText.match(/\(([^)]+)\)\s*$/);
    quickModelSizeBadge.textContent = sizeMatch ? String(sizeMatch[1] || "size n/a") : "custom";
  };

  const syncMobileBackdrop = () => {
    const drawerOpen = charactersPanelNode.classList.contains("mobile-open") || docsPanelNode.classList.contains("mobile-open");
    mobileDrawerBackdrop.hidden = !drawerOpen;
  };

  const closeMobilePanels = () => {
    charactersPanelNode.classList.remove("mobile-open");
    docsPanelNode.classList.remove("mobile-open");
    syncMobileBackdrop();
  };

  const openMobilePanel = (target) => {
    if (target === "characters") {
      charactersPanelNode.classList.add("mobile-open");
      docsPanelNode.classList.remove("mobile-open");
    } else {
      docsPanelNode.classList.add("mobile-open");
      charactersPanelNode.classList.remove("mobile-open");
    }
    syncMobileBackdrop();
  };

  const setTelemetry = (label, latencyMs, promptText, responseText) => {
    const rounded = Math.round(latencyMs);
    if (label === "Chat") {
      perfTelemetry.record("chat_latency_ms", rounded);
    } else if (label === "Search") {
      perfTelemetry.record("search_latency_ms", rounded);
    } else if (label === "Ask-all") {
      perfTelemetry.record("ask_all_latency_ms", rounded);
    }
    const chatSummary = perfTelemetry.summary("chat_latency_ms");
    const searchSummary = perfTelemetry.summary("search_latency_ms");
    const docWorkerSummary = perfTelemetry.summary("doc_rank_worker_ms");
    const docMainSummary = perfTelemetry.summary("doc_rank_main_ms");
    let docRankP95 = "n/a";
    if (docWorkerSummary.count || docMainSummary.count) {
      const parts = [];
      if (docWorkerSummary.count) {
        parts.push(`w${Math.round(docWorkerSummary.p95)}ms`);
      }
      if (docMainSummary.count) {
        parts.push(`m${Math.round(docMainSummary.p95)}ms`);
      }
      docRankP95 = parts.join("/");
    }
    window.localStorage.setItem("ollama.app.v3.perfSnapshot", JSON.stringify(perfTelemetry.snapshot()));
    telemetryNode.textContent = `${label}: ${rounded}ms | prompt ~${estimateTokenCount(promptText)} tok | response ~${estimateTokenCount(responseText)} tok | p95 chat/search ${Math.round(chatSummary.p95)}/${Math.round(searchSummary.p95)}ms | doc-rank ${docRankP95}`;
  };

  let ratingSummaryNode = document.getElementById("chat-rating-summary");
  if (!ratingSummaryNode) {
    ratingSummaryNode = document.createElement("p");
    ratingSummaryNode.id = "chat-rating-summary";
    ratingSummaryNode.className = "muted";
    telemetryNode.insertAdjacentElement("afterend", ratingSummaryNode);
  }

  const buildBranchRatingStats = (branch) => {
    const stats = { up: 0, down: 0, rated: 0, assistant: 0 };
    if (!branch || !Array.isArray(branch.messages)) {
      return stats;
    }
    branch.messages.forEach((message) => {
      if (message.role !== "assistant") {
        return;
      }
      stats.assistant += 1;
      const rating = message && message.metadata ? message.metadata.rating : null;
      if (rating === 1) {
        stats.up += 1;
        stats.rated += 1;
      } else if (rating === -1) {
        stats.down += 1;
        stats.rated += 1;
      }
    });
    return stats;
  };

  const applyRatingDelta = (stats, previousRating, nextRating) => {
    const value = stats || { up: 0, down: 0, rated: 0, assistant: 0 };
    const prev = previousRating === 1 || previousRating === -1 ? previousRating : null;
    const next = nextRating === 1 || nextRating === -1 ? nextRating : null;
    if (prev === next) {
      return value;
    }
    if (prev === 1) {
      value.up = Math.max(0, value.up - 1);
      value.rated = Math.max(0, value.rated - 1);
    } else if (prev === -1) {
      value.down = Math.max(0, value.down - 1);
      value.rated = Math.max(0, value.rated - 1);
    }
    if (next === 1) {
      value.up += 1;
      value.rated += 1;
    } else if (next === -1) {
      value.down += 1;
      value.rated += 1;
    }
    return value;
  };

  const renderRatingSummary = (branch, stats) => {
    if (!ratingSummaryNode) {
      return;
    }
    const currentStats = stats || buildBranchRatingStats(branch);
    const unrated = Math.max(0, currentStats.assistant - currentStats.rated);
    ratingSummaryNode.textContent = `Ratings: +${currentStats.up} / -${currentStats.down} | rated ${currentStats.rated}/${currentStats.assistant} | unrated ${unrated}`;
  };

  let activeBranchRatingStats = { up: 0, down: 0, rated: 0, assistant: 0 };
  const sessionStartedAt = Date.now();
  let sessionSentTurns = 0;
  let analyticsRefreshTimer = null;
  let lastContextUsage = null;
  let chainRunInFlight = false;
  let activeChainRunState = readStorageJSON(STORAGE_KEYS.promptChainRunState, null);
  let chainDraft = readStorageJSON(STORAGE_KEYS.promptChains, {
    name: "Default Chain",
    varsText: "{\"topic\":\"Q4 planning\"}",
    stepsText: "outline = Create a concise outline for {{topic}}\nsummary = Summarize {{outline}} in 5 bullets"
  });

  const renderContextUsage = (usage) => {
    const data = usage && typeof usage === "object"
      ? usage
      : { budgetTokens: 0, reserveTokens: 0, usedTokens: 0, remainingTokens: 0, docs: [] };
    const usable = Math.max(1, Number(data.budgetTokens || 0) - Number(data.reserveTokens || 0));
    const used = Math.max(0, Number(data.usedTokens || 0));
    const pct = Math.max(0, Math.min(100, Math.round((used / usable) * 100)));
    contextUsageFill.style.width = `${pct}%`;
    contextBadge.textContent = `${pct}%`;
    if (pct > 80) {
      contextBadge.style.background = "rgba(255, 118, 118, 0.24)";
      contextBadge.style.color = "#ffb0b0";
    } else if (pct > 60) {
      contextBadge.style.background = "rgba(255, 210, 111, 0.24)";
      contextBadge.style.color = "#ffd26f";
    } else {
      contextBadge.style.background = "rgba(255, 255, 255, 0.12)";
      contextBadge.style.color = "var(--text-main)";
    }
    contextUsageText.textContent = `Used ${used}/${usable} tokens (${pct}%) | reserve ${Number(data.reserveTokens || 0)} tokens`;
    contextUsageDocs.innerHTML = "";
    const docs = Array.isArray(data.docs) ? data.docs : [];
    if (!docs.length) {
      const empty = document.createElement("div");
      empty.className = "context-usage-doc";
      empty.textContent = "No document context attached.";
      contextUsageDocs.appendChild(empty);
      return;
    }
    docs.slice(0, 8).forEach((doc) => {
      const row = document.createElement("div");
      row.className = "context-usage-doc";
      const pinned = doc.pinned ? " | pinned" : "";
      row.textContent = `${doc.name}: ${doc.usedTokens} tok | ${doc.method}${pinned}`;
      contextUsageDocs.appendChild(row);
    });
  };

  const saveChainDraft = () => {
    chainDraft = {
      name: String(chainNameInput.value || "").trim() || "Default Chain",
      varsText: String(chainVarsInput.value || "").trim() || "{}",
      stepsText: String(chainStepsInput.value || "").trim()
    };
    writeStorageJSON(STORAGE_KEYS.promptChains, chainDraft);
  };

  const loadChainDraft = () => {
    chainNameInput.value = String(chainDraft && chainDraft.name ? chainDraft.name : "Default Chain");
    chainVarsInput.value = String(chainDraft && chainDraft.varsText ? chainDraft.varsText : "{}");
    chainStepsInput.value = String(chainDraft && chainDraft.stepsText ? chainDraft.stepsText : "");
  };

  const parseChainVars = () => {
    const raw = String(chainVarsInput.value || "").trim() || "{}";
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Seed variables must be a JSON object.");
    }
    return parsed;
  };

  const parseChainSteps = () => {
    const lines = String(chainStepsInput.value || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map((line, index) => {
      const match = line.match(/^([a-zA-Z_][\w-]*)\s*=\s*(.+)$/);
      if (match) {
        return { key: match[1], prompt: match[2] };
      }
      return { key: `step${index + 1}`, prompt: line };
    });
  };

  const renderTemplateVars = (template, vars) => {
    return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
      const value = vars && Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : "";
      return String(value || "");
    });
  };

  const setChainStatus = (text) => {
    chainStatusNode.textContent = String(text || "");
  };

  const renderChainProgress = () => {
    chainProgressNode.innerHTML = "";
    const logs = activeChainRunState && Array.isArray(activeChainRunState.logs) ? activeChainRunState.logs : [];
    if (!logs.length) {
      const empty = document.createElement("div");
      empty.className = "doc-row doc-empty";
      empty.textContent = "No chain run yet.";
      chainProgressNode.appendChild(empty);
      return;
    }
    logs.forEach((log, index) => {
      const row = document.createElement("div");
      row.className = "doc-row";
      const stateText = `${index + 1}. ${log.key} - ${log.status}`;
      const left = document.createElement("span");
      left.className = "doc-info";
      const top = document.createElement("span");
      top.textContent = stateText;
      const preview = document.createElement("small");
      preview.className = "doc-badges";
      preview.textContent = String(log.preview || "");
      left.appendChild(top);
      left.appendChild(preview);
      row.appendChild(left);
      chainProgressNode.appendChild(row);
    });
  };

  const persistChainRunState = () => {
    if (activeChainRunState) {
      writeStorageJSON(STORAGE_KEYS.promptChainRunState, activeChainRunState);
    } else {
      window.localStorage.removeItem(STORAGE_KEYS.promptChainRunState);
    }
  };

  const runPromptChain = async (mode) => {
    if (chainRunInFlight) {
      return;
    }
    const chainMode = mode || "run";
    try {
      saveChainDraft();
      const steps = parseChainSteps();
      const seedVars = parseChainVars();
      if (!steps.length) {
        setChainStatus("Add at least one step.");
        return;
      }
      const character = getCharactersSnapshot().find((item) => item.id === activeCharacterId) || null;
      if (!character) {
        setChainStatus("Select an active character before running a chain.");
        return;
      }

      if (chainMode === "run" || !activeChainRunState) {
        activeChainRunState = {
          name: chainDraft.name,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: "running",
          currentIndex: 0,
          logs: [],
          outputs: {},
          steps,
          vars: seedVars
        };
      } else {
        activeChainRunState.steps = steps;
        if (!activeChainRunState.vars || typeof activeChainRunState.vars !== "object") {
          activeChainRunState.vars = seedVars;
        }
        if (!Array.isArray(activeChainRunState.logs)) {
          activeChainRunState.logs = [];
        }
        if (chainMode === "retry_failed") {
          const failedIndex = activeChainRunState.logs.findIndex((log) => log.status === "failed");
          activeChainRunState.currentIndex = failedIndex >= 0 ? failedIndex : activeChainRunState.currentIndex || 0;
        }
      }

      chainRunInFlight = true;
      setChainStatus(`Running chain "${activeChainRunState.name}"...`);
      persistChainRunState();
      renderChainProgress();

      for (let index = activeChainRunState.currentIndex || 0; index < steps.length; index += 1) {
        const step = steps[index];
        const vars = { ...(activeChainRunState.vars || {}), ...(activeChainRunState.outputs || {}) };
        const prompt = renderTemplateVars(step.prompt, vars);
        activeChainRunState.currentIndex = index;
        activeChainRunState.updatedAt = new Date().toISOString();
        if (!activeChainRunState.logs[index]) {
          activeChainRunState.logs[index] = { key: step.key, status: "running", preview: "Running..." };
        } else {
          activeChainRunState.logs[index].status = "running";
          activeChainRunState.logs[index].preview = "Running...";
        }
        persistChainRunState();
        renderChainProgress();

        try {
          const response = await generateCharacterResponse(character, prompt, {
            onMetric: (name, value) => perfTelemetry.record(name, value)
          });
          activeChainRunState.outputs[step.key] = response;
          activeChainRunState.logs[index] = {
            key: step.key,
            status: "done",
            preview: String(response || "").replace(/\s+/g, " ").trim().slice(0, 140)
          };
          persistChainRunState();
          renderChainProgress();
        } catch (error) {
          activeChainRunState.status = "failed";
          activeChainRunState.logs[index] = {
            key: step.key,
            status: "failed",
            preview: String(error && error.message ? error.message : "step failed")
          };
          persistChainRunState();
          renderChainProgress();
          setChainStatus(`Chain failed at step ${index + 1}. Use Retry Failed or Resume.`);
          chainRunInFlight = false;
          return;
        }
      }

      activeChainRunState.status = "completed";
      activeChainRunState.currentIndex = steps.length;
      activeChainRunState.updatedAt = new Date().toISOString();
      persistChainRunState();
      renderChainProgress();
      const outputKeys = Object.keys(activeChainRunState.outputs || {});
      if (outputKeys.length) {
        const last = activeChainRunState.outputs[outputKeys[outputKeys.length - 1]];
        inputNode.value = String(last || "");
      }
      setChainStatus("Chain completed. Last output loaded into composer.");
      chainRunInFlight = false;
    } catch (error) {
      setChainStatus(`Chain error: ${error.message || "unknown error"}`);
      chainRunInFlight = false;
    }
  };

  const sanitizeFileName = (value) => {
    const base = String(value || "conversation-export")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return base || "conversation-export";
  };

  const collectConversationExportData = () => {
    const state = ensureConversationState(activeCharacterId);
    const branch = getActiveBranch(state);
    const character = getCharactersSnapshot().find((item) => item.id === activeCharacterId) || null;
    if (!state || !branch || !character) {
      return null;
    }
    return {
      character,
      branch,
      exportedAt: new Date().toISOString()
    };
  };

  const formatMessageMetadataText = (message, options) => {
    const lines = [];
    if (options.includeTime && message.time) {
      lines.push(`time: ${message.time}`);
    }
    if (options.includeMetadata && message.modelTag) {
      lines.push(`model: ${message.modelTag}`);
    }
    if (options.includeRatings && message.metadata && (message.metadata.rating === 1 || message.metadata.rating === -1)) {
      lines.push(`rating: ${message.metadata.rating === 1 ? "up" : "down"}`);
    }
    if (options.includeAnnotations && message.metadata && Array.isArray(message.metadata.annotations) && message.metadata.annotations.length) {
      const annotationText = message.metadata.annotations
        .map((annotation) => `[${annotation.type}] ${annotation.text}`)
        .join(" | ");
      lines.push(`annotations: ${annotationText}`);
    }
    return lines;
  };

  const buildMarkdownExport = (dataset, options) => {
    const lines = [];
    if (options.includeMetadata) {
      lines.push(`# ${dataset.branch.label || "Conversation"}`);
      lines.push("");
      lines.push(`- Character: ${dataset.character.name}`);
      lines.push(`- Exported: ${dataset.exportedAt}`);
      lines.push(`- Branch ID: ${dataset.branch.id}`);
      lines.push("");
    }
    dataset.branch.messages.forEach((message, index) => {
      lines.push(`## ${index + 1}. ${message.role.toUpperCase()}`);
      const meta = formatMessageMetadataText(message, options);
      meta.forEach((row) => lines.push(`- ${row}`));
      lines.push("");
      lines.push(String(message.content || ""));
      lines.push("");
    });
    if (options.includeContext && lastContextUsage) {
      lines.push("## Context Usage");
      lines.push(`- Used: ${lastContextUsage.usedTokens || 0}`);
      lines.push(`- Budget: ${(lastContextUsage.budgetTokens || 0) - (lastContextUsage.reserveTokens || 0)}`);
      const docs = Array.isArray(lastContextUsage.docs) ? lastContextUsage.docs : [];
      docs.forEach((doc) => {
        lines.push(`- ${doc.name}: ${doc.usedTokens} tok (${doc.method})`);
      });
      lines.push("");
    }
    return lines.join("\n");
  };

  const buildHtmlExport = (dataset, options) => {
    const parts = [];
    parts.push("<!doctype html><html><head><meta charset=\"utf-8\" />");
    parts.push(`<title>${escapeHtml(dataset.branch.label || "Conversation")}</title>`);
    parts.push("<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:980px;margin:20px auto;padding:0 16px;}article{border:1px solid #d9d9d9;border-radius:8px;padding:10px;margin:10px 0;}small{color:#666;}pre{white-space:pre-wrap;word-break:break-word;}</style>");
    parts.push("</head><body>");
    if (options.includeMetadata) {
      parts.push(`<h1>${escapeHtml(dataset.branch.label || "Conversation")}</h1>`);
      parts.push(`<p><strong>Character:</strong> ${escapeHtml(dataset.character.name)}<br/><strong>Exported:</strong> ${escapeHtml(dataset.exportedAt)}<br/><strong>Branch ID:</strong> ${escapeHtml(dataset.branch.id)}</p>`);
    }
    dataset.branch.messages.forEach((message, index) => {
      parts.push("<article>");
      parts.push(`<h3>${index + 1}. ${escapeHtml(String(message.role || ""))}</h3>`);
      const meta = formatMessageMetadataText(message, options);
      if (meta.length) {
        parts.push(`<small>${escapeHtml(meta.join(" | "))}</small>`);
      }
      parts.push(`<pre>${escapeHtml(String(message.content || ""))}</pre>`);
      parts.push("</article>");
    });
    if (options.includeContext && lastContextUsage) {
      parts.push("<section><h2>Context Usage</h2>");
      parts.push(`<p>Used ${escapeHtml(String(lastContextUsage.usedTokens || 0))} of ${escapeHtml(String((lastContextUsage.budgetTokens || 0) - (lastContextUsage.reserveTokens || 0)))} tokens</p>`);
      const docs = Array.isArray(lastContextUsage.docs) ? lastContextUsage.docs : [];
      if (docs.length) {
        parts.push("<ul>");
        docs.forEach((doc) => {
          parts.push(`<li>${escapeHtml(doc.name)}: ${escapeHtml(String(doc.usedTokens || 0))} tok (${escapeHtml(doc.method)})</li>`);
        });
        parts.push("</ul>");
      }
      parts.push("</section>");
    }
    parts.push("</body></html>");
    return parts.join("");
  };

  const runAdvancedExport = () => {
    const dataset = collectConversationExportData();
    if (!dataset) {
      advancedExportStatus.textContent = "Select a character and conversation before export.";
      return;
    }
    const options = {
      includeMetadata: exportIncludeMetadata.checked,
      includeTime: exportIncludeTime.checked,
      includeRatings: exportIncludeRatings.checked,
      includeAnnotations: exportIncludeAnnotations.checked,
      includeContext: exportIncludeContext.checked
    };
    const profile = String(advancedExportProfile.value || "markdown");
    const base = sanitizeFileName(advancedExportName.value || dataset.branch.label || "conversation-export");
    if (profile === "markdown") {
      const markdown = buildMarkdownExport(dataset, options);
      downloadText(`${base}.md`, markdown, "text/markdown;charset=utf-8");
      advancedExportStatus.textContent = "Markdown export complete.";
      return;
    }
    if (profile === "html") {
      const html = buildHtmlExport(dataset, options);
      downloadText(`${base}.html`, html, "text/html;charset=utf-8");
      advancedExportStatus.textContent = "HTML export complete.";
      return;
    }
    const html = buildHtmlExport(dataset, options);
    const printWindow = window.open("", "_blank", "width=980,height=720");
    if (!printWindow) {
      advancedExportStatus.textContent = "Unable to open print window for PDF export.";
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    advancedExportStatus.textContent = "PDF export opened in print dialog.";
  };

  const renderAnalyticsCards = (cards) => {
    analyticsSummaryNode.innerHTML = "";
    cards.forEach((card) => {
      const node = document.createElement("article");
      node.className = "analytics-card";
      const title = document.createElement("strong");
      title.textContent = card.title;
      node.appendChild(title);
      card.lines.forEach((line) => {
        const item = document.createElement("small");
        item.textContent = line;
        node.appendChild(item);
      });
      analyticsSummaryNode.appendChild(node);
    });
  };

  const buildAnalyticsSnapshot = async () => {
    const characters = getCharactersSnapshot();
    const characterById = new Map(characters.map((character) => [character.id, character]));
    const totals = {
      branches: 0,
      messages: 0,
      user: 0,
      assistant: 0,
      rated: 0,
      annotations: 0,
      edited: 0
    };
    const byCharacter = new Map();
    const byModel = new Map();

    conversationStateByCharacter.forEach((state, characterId) => {
      const characterName = characterById.get(characterId) ? characterById.get(characterId).name : characterId;
      if (!byCharacter.has(characterName)) {
        byCharacter.set(characterName, { messages: 0, assistant: 0, user: 0 });
      }
      const charMetrics = byCharacter.get(characterName);
      totals.branches += state.branches.length;
      state.branches.forEach((branch) => {
        branch.messages.forEach((message) => {
          totals.messages += 1;
          charMetrics.messages += 1;
          if (message.role === "assistant") {
            totals.assistant += 1;
            charMetrics.assistant += 1;
            const model = String(message.modelTag || "unknown");
            byModel.set(model, (byModel.get(model) || 0) + 1);
            if (message.metadata && (message.metadata.rating === 1 || message.metadata.rating === -1)) {
              totals.rated += 1;
            }
          } else {
            totals.user += 1;
            charMetrics.user += 1;
            if (Array.isArray(message.editHistory) && message.editHistory.length) {
              totals.edited += 1;
            }
          }
          if (message.metadata && Array.isArray(message.metadata.annotations)) {
            totals.annotations += message.metadata.annotations.length;
          }
        });
      });
    });

    const docsByCharacter = await Promise.all(
      characters.map(async (character) => {
        const docs = await getCharacterDocumentContext(character.id).catch(() => []);
        return { character: character.name, docCount: docs.length };
      })
    );
    const totalAssignedDocs = docsByCharacter.reduce((sum, item) => sum + item.docCount, 0);

    const elapsedMinutes = Math.max(1, Math.round((Date.now() - sessionStartedAt) / 60000));
    const topCharacters = Array.from(byCharacter.entries())
      .sort((a, b) => b[1].messages - a[1].messages)
      .slice(0, 3);
    const topModels = Array.from(byModel.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    return {
      totals,
      elapsedMinutes,
      totalAssignedDocs,
      topCharacters,
      topModels,
      docsByCharacter
    };
  };

  const renderAnalyticsDashboard = async () => {
    const startedAt = performance.now();
    const snapshot = await buildAnalyticsSnapshot();
    analyticsBadge.textContent = `${snapshot.totals.messages} msgs`;
    const cards = [
      {
        title: "Session",
        lines: [
          `Duration: ${snapshot.elapsedMinutes} min`,
          `Turns sent: ${sessionSentTurns}`,
          `Branches: ${snapshot.totals.branches}`
        ]
      },
      {
        title: "Conversation",
        lines: [
          `Messages: ${snapshot.totals.messages}`,
          `User/Assistant: ${snapshot.totals.user}/${snapshot.totals.assistant}`,
          `Edited turns: ${snapshot.totals.edited}`
        ]
      },
      {
        title: "Quality",
        lines: [
          `Rated assistant msgs: ${snapshot.totals.rated}`,
          `Annotations: ${snapshot.totals.annotations}`,
          `Assigned docs: ${snapshot.totalAssignedDocs}`
        ]
      },
      {
        title: "Top Characters",
        lines: snapshot.topCharacters.length
          ? snapshot.topCharacters.map(([name, metrics]) => `${name}: ${metrics.messages} msgs`)
          : ["No activity yet"]
      },
      {
        title: "Top Models",
        lines: snapshot.topModels.length
          ? snapshot.topModels.map(([name, count]) => `${name}: ${count} replies`)
          : ["No assistant replies yet"]
      }
    ];
    renderAnalyticsCards(cards);
    const elapsed = Math.round(performance.now() - startedAt);
    analyticsDashboardNode.dataset.renderMs = String(elapsed);
  };

  const queueAnalyticsRefresh = () => {
    if (analyticsRefreshTimer) {
      window.clearTimeout(analyticsRefreshTimer);
    }
    analyticsRefreshTimer = window.setTimeout(() => {
      analyticsRefreshTimer = null;
      renderAnalyticsDashboard().catch((error) => {
        console.error("Analytics dashboard refresh failed:", error);
      });
    }, 80);
  };

  let paletteSelectionIndex = 0;
  let searchDebounceTimer = null;
  const docCacheByCharacter = new Map();
  let searchResultHits = [];

  const getConversationHits = () => {
    const characters = getCharactersSnapshot();
    const characterById = new Map(characters.map((item) => [item.id, item]));
    const hits = [];
    conversationStateByCharacter.forEach((state, characterId) => {
      const characterName = characterById.get(characterId)
        ? characterById.get(characterId).name
        : characterId;
      state.branches.forEach((branch) => {
        branch.messages.forEach((message, messageIndex) => {
          const content = String(message.content || "").trim();
          if (!content) {
            return;
          }
          hits.push({
            characterId,
            characterName,
            branchId: branch.id,
            branchLabel: branch.label || "Untitled Branch",
            messageId: message.id || "",
            messageIndex,
            role: message.role,
            content,
            time: message.time || ""
          });
        });
      });
    });
    return hits;
  };

  const scoreCommand = (query, command) => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) {
      return 1;
    }
    const title = command.title.toLowerCase();
    const keys = String(command.keywords || "").toLowerCase();
    if (title.startsWith(q)) {
      return 100;
    }
    if (title.includes(q)) {
      return 80;
    }
    if (keys.includes(q)) {
      return 60;
    }
    return 0;
  };

  const renderCommandPalette = () => {
    const commands = [
      {
        id: "focus-composer",
        title: "Focus Composer",
        keywords: "chat input focus",
        run: () => inputNode.focus()
      },
      {
        id: "new-branch",
        title: "New Branch",
        keywords: "conversation branch create",
        run: () => newBranchButton.click()
      },
      {
        id: "search-conversations",
        title: "Search Conversations",
        keywords: "find messages history",
        run: () => openConversationSearch()
      },
      {
        id: "prompt-chains",
        title: "Prompt Chains",
        keywords: "automation chain run",
        run: () => openPromptChainsButton.click()
      },
      {
        id: "advanced-export",
        title: "Advanced Export",
        keywords: "export markdown html pdf",
        run: () => openAdvancedExportButton.click()
      },
      {
        id: "upload-docs",
        title: "Upload Documents",
        keywords: "files docs",
        run: () => {
          const upload = document.getElementById("upload-docs");
          if (upload instanceof HTMLElement) {
            upload.click();
          }
        }
      },
      {
        id: "export-workspace",
        title: "Export Workspace",
        keywords: "backup export",
        run: () => exportWorkspaceButton.click()
      }
    ];
    getCharactersSnapshot().forEach((character) => {
      commands.push({
        id: `switch-${character.id}`,
        title: `Switch Character: ${character.name}`,
        keywords: `character switch ${character.name}`,
        run: () => {
          const card = document.querySelector(`[data-character-id="${character.id}"]`);
          if (card instanceof HTMLElement) {
            card.click();
          }
        }
      });
    });

    const scored = commands
      .map((command) => ({ command, score: scoreCommand(commandPaletteInput.value, command) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title))
      .slice(0, 10);

    if (paletteSelectionIndex >= scored.length) {
      paletteSelectionIndex = Math.max(0, scored.length - 1);
    }
    commandPaletteList.innerHTML = "";
    scored.forEach((entry, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === paletteSelectionIndex ? "command-item active" : "command-item";
      button.textContent = entry.command.title;
      button.addEventListener("click", () => {
        commandPaletteModal.close();
        entry.command.run();
      });
      commandPaletteList.appendChild(button);
    });
    commandPaletteList.dataset.commandIds = JSON.stringify(scored.map((entry) => entry.command.id));
    commandPaletteList.dataset.commandCount = String(scored.length);
    commandPaletteList.dataset.commandQuery = commandPaletteInput.value || "";
    commandPaletteList.dataset.commandIndex = String(paletteSelectionIndex);
    commandPaletteList.dataset.commandPayload = JSON.stringify(scored.map((entry) => ({
      id: entry.command.id,
      title: entry.command.title
    })));
    commandPaletteList._commands = scored.map((entry) => entry.command);
  };

  const openCommandPalette = () => {
    paletteSelectionIndex = 0;
    commandPaletteInput.value = "";
    renderCommandPalette();
    if (typeof commandPaletteModal.showModal === "function") {
      commandPaletteModal.showModal();
      commandPaletteInput.focus();
    }
  };

  const parseTimeToDate = (value) => {
    const now = new Date();
    const candidate = new Date(`${now.toDateString()} ${String(value || "")}`);
    if (!Number.isNaN(candidate.getTime())) {
      return candidate;
    }
    return now;
  };

  const loadCharacterDocs = async (characterId) => {
    if (docCacheByCharacter.has(characterId)) {
      return docCacheByCharacter.get(characterId);
    }
    const docs = await getCharacterDocumentContext(characterId).catch(() => []);
    docCacheByCharacter.set(characterId, docs);
    return docs;
  };

  const renderConversationSearchResults = async () => {
    const query = String(conversationSearchQuery.value || "").trim().toLowerCase();
    const characterId = conversationSearchCharacter.value || "";
    const docsFilter = String(conversationSearchDocs.value || "").trim().toLowerCase();
    const fromValue = conversationSearchFrom.value ? new Date(`${conversationSearchFrom.value}T00:00:00`) : null;
    const toValue = conversationSearchTo.value ? new Date(`${conversationSearchTo.value}T23:59:59`) : null;

    const startedAt = performance.now();
    const baseHits = getConversationHits();
    const filtered = [];
    for (const hit of baseHits) {
      if (characterId && hit.characterId !== characterId) {
        continue;
      }
      if (query && !hit.content.toLowerCase().includes(query)) {
        continue;
      }
      const at = parseTimeToDate(hit.time);
      if (fromValue && at < fromValue) {
        continue;
      }
      if (toValue && at > toValue) {
        continue;
      }
      if (docsFilter) {
        const docs = await loadCharacterDocs(hit.characterId);
        const names = docs.map((doc) => String(doc.name || "").toLowerCase());
        if (!names.some((name) => name.includes(docsFilter))) {
          continue;
        }
      }
      filtered.push(hit);
      if (filtered.length >= 100) {
        break;
      }
    }
    searchResultHits = filtered;
    conversationSearchResults.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "doc-row doc-empty";
      empty.textContent = "No matching messages.";
      conversationSearchResults.appendChild(empty);
      setTelemetry("Search", performance.now() - startedAt, query, "");
      return;
    }

    filtered.slice(0, 50).forEach((hit, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result-item";
      button.dataset.hitIndex = String(index);
      const snippet = hit.content.length > 180 ? `${hit.content.slice(0, 180)}...` : hit.content;
      button.textContent = `[${hit.characterName}] ${hit.branchLabel} - ${snippet}`;
      const meta = document.createElement("small");
      meta.textContent = `${hit.role} | ${hit.time || "no time"}`;
      button.appendChild(meta);
      conversationSearchResults.appendChild(button);
    });
    setTelemetry("Search", performance.now() - startedAt, query, String(filtered.length));
  };

  const openConversationSearch = () => {
    const savedPrefs = readStorageJSON(STORAGE_KEYS.conversationSearchPrefs, {});
    const characters = getCharactersSnapshot();
    conversationSearchCharacter.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All characters";
    conversationSearchCharacter.appendChild(allOption);
    characters.forEach((character) => {
      const option = document.createElement("option");
      option.value = character.id;
      option.textContent = character.name;
      conversationSearchCharacter.appendChild(option);
    });
    conversationSearchQuery.value = String(savedPrefs && savedPrefs.query ? savedPrefs.query : "");
    conversationSearchCharacter.value = String(savedPrefs && savedPrefs.characterId ? savedPrefs.characterId : "");
    conversationSearchDocs.value = String(savedPrefs && savedPrefs.docs ? savedPrefs.docs : "");
    conversationSearchFrom.value = String(savedPrefs && savedPrefs.from ? savedPrefs.from : "");
    conversationSearchTo.value = String(savedPrefs && savedPrefs.to ? savedPrefs.to : "");
    if (typeof conversationSearchModal.showModal === "function") {
      conversationSearchModal.showModal();
      conversationSearchQuery.focus();
      renderConversationSearchResults().catch((error) => {
        console.error("Conversation search failed:", error);
      });
    }
  };

  document.addEventListener("character:active-changed", (event) => {
    const detail = event.detail && event.detail.character ? event.detail.character : null;
    if (!detail || !detail.id) {
      return;
    }

    if (activeCharacterId) {
      saveDraftNow();
    }
    activeCharacterId = detail.id;
    syncQuickModelSelect();
    refreshChatUi();
  });

  branchSelectNode.addEventListener("change", () => {
    const state = ensureConversationState(activeCharacterId);
    if (!state) {
      return;
    }
    saveDraftNow();
    state.activeBranchId = branchSelectNode.value;
    persistConversationState();
    refreshChatUi();
  });

  newBranchButton.addEventListener("click", () => {
    const state = ensureConversationState(activeCharacterId);
    const current = getActiveBranch(state);
    if (!state || !current) {
      return;
    }
    saveDraftNow();
    const branchNumber = state.branches.length + 1;
    const branch = createBranch(activeCharacterId, {
      label: `${current.label || "Branch"}-${branchNumber}`,
      parentBranchId: current.id,
      parentMessageIndex: current.messages.length,
      messages: cloneMessages(current.messages)
    });
    state.branches.push(branch);
    state.activeBranchId = branch.id;
    persistConversationState();
    refreshChatUi();
  });

  saveTemplateButton.addEventListener("click", () => {
    const content = inputNode.value.trim() || window.prompt("Starter content:");
    if (!content) {
      return;
    }
    const title = window.prompt("Starter name:", "New Starter");
    if (!title) {
      return;
    }
    const isGlobal = window.confirm("Save as global starter? Click Cancel for character-only.");
    const template = {
      id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.trim(),
      content: content.trim()
    };
    if (isGlobal) {
      templateState.global.push(template);
    } else {
      if (!templateState.perCharacter[activeCharacterId]) {
        templateState.perCharacter[activeCharacterId] = [];
      }
      templateState.perCharacter[activeCharacterId].push(template);
    }
    persistTemplateState();
    renderTemplateSelect(templateSelectNode, activeCharacterId);
  });

  applyTemplateButton.addEventListener("click", () => {
    const state = ensureConversationState(activeCharacterId);
    const current = getActiveBranch(state);
    const template = getSelectedTemplate(activeCharacterId, templateSelectNode.value);
    if (!state || !template) {
      return;
    }
    saveDraftNow();
    const starterMessage = makeMessage("user", template.content, formatTime(new Date()), "you");
    const branch = createBranch(activeCharacterId, {
      label: `Starter: ${template.title}`,
      parentBranchId: current ? current.id : "",
      parentMessageIndex: 0,
      messages: [starterMessage]
    });
    state.branches.push(branch);
    state.activeBranchId = branch.id;
    persistConversationState();
    refreshChatUi();
  });

  undoButton.addEventListener("click", () => {
    const state = ensureConversationState(activeCharacterId);
    const branch = getActiveBranch(state);
    if (!state || !branch || !branch.messages.length) {
      return;
    }
    let userIndex = -1;
    for (let index = branch.messages.length - 1; index >= 0; index -= 1) {
      if (branch.messages[index].role === "user") {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) {
      return;
    }
    const removeCount = branch.messages[userIndex + 1] && branch.messages[userIndex + 1].role === "assistant" ? 2 : 1;
    branch.messages.splice(userIndex, removeCount);
    persistConversationState();
    refreshChatUi();
  });

  resetButton.addEventListener("click", () => {
    const state = ensureConversationState(activeCharacterId);
    const branch = getActiveBranch(state);
    if (!state || !branch) {
      return;
    }
    const characters = readStorageJSON(STORAGE_KEYS.characters, []);
    const activeCharacter = Array.isArray(characters)
      ? characters.find((item) => item.id === activeCharacterId)
      : null;
    const systemPrompt = activeCharacter && activeCharacter.systemPrompt
      ? String(activeCharacter.systemPrompt).trim()
      : "";
    branch.messages = [];
    if (systemPrompt) {
      branch.messages.push(makeMessage("assistant", `System prompt active: ${systemPrompt}`, formatTime(new Date()), ""));
    }
    persistConversationState();
    refreshChatUi();
  });

  saveConversationLabelButton.addEventListener("click", () => {
    const state = ensureConversationState(activeCharacterId);
    const branch = getActiveBranch(state);
    if (!state || !branch) {
      return;
    }
    branch.label = conversationLabelNode.value.trim() || "Untitled Branch";
    branch.manualLabel = true;
    branch.autoNamed = false;
    persistConversationState();
    refreshChatUi();
  });

  const stopButton = formNode.querySelector("#stop-generation");
  if (stopButton instanceof HTMLButtonElement) {
    stopButton.disabled = true;
    stopButton.addEventListener("click", abortActiveStream);
  }

  inputNode.addEventListener("input", queueDraftSave);
  quickModelSelect.addEventListener("change", () => {
    const nextModel = String(quickModelSelect.value || "").trim();
    if (!activeCharacterId || !nextModel) {
      return;
    }
    setCharacterModel(activeCharacterId, nextModel);
    syncQuickModelSelect();
  });
  document.addEventListener("ollama:models-updated", () => {
    syncQuickModelSelect();
  });
  analyticsToggleButton.addEventListener("click", () => {
    const next = !analyticsPanel.classList.contains("expanded");
    setPanelExpanded("analytics", next);
  });
  contextToggleButton.addEventListener("click", () => {
    const next = !contextPanel.classList.contains("expanded");
    setPanelExpanded("context", next);
  });
  docsTabButton.addEventListener("click", () => {
    setDocsTab("documents");
    closeMobilePanels();
  });
  quickActionsTabButton.addEventListener("click", () => {
    setDocsTab("quick-actions");
    closeMobilePanels();
  });
  openCharactersPanelButton.addEventListener("click", () => {
    openMobilePanel("characters");
  });
  openDocsPanelButton.addEventListener("click", () => {
    openMobilePanel("docs");
  });
  mobileDrawerBackdrop.addEventListener("click", () => {
    closeMobilePanels();
  });
  refreshAnalyticsButton.addEventListener("click", () => {
    renderAnalyticsDashboard().catch((error) => {
      console.error("Analytics manual refresh failed:", error);
    });
  });
  loadChainDraft();
  renderChainProgress();
  if (activeChainRunState && activeChainRunState.status === "failed") {
    setChainStatus("Previous run failed. Use Retry Failed or Resume.");
  }

  openPromptChainsButton.addEventListener("click", () => {
    loadChainDraft();
    renderChainProgress();
    if (typeof promptChainModal.showModal === "function") {
      promptChainModal.showModal();
    }
  });

  chainSaveButton.addEventListener("click", () => {
    saveChainDraft();
    setChainStatus(`Saved chain "${chainDraft.name}".`);
  });

  chainRunButton.addEventListener("click", () => {
    runPromptChain("run").catch((error) => {
      setChainStatus(`Chain run failed: ${error.message || "unknown error"}`);
    });
  });

  chainRetryButton.addEventListener("click", () => {
    runPromptChain("retry_failed").catch((error) => {
      setChainStatus(`Retry failed: ${error.message || "unknown error"}`);
    });
  });

  chainResumeButton.addEventListener("click", () => {
    runPromptChain("resume").catch((error) => {
      setChainStatus(`Resume failed: ${error.message || "unknown error"}`);
    });
  });

  chainCloseButton.addEventListener("click", () => {
    promptChainModal.close();
  });

  openAdvancedExportButton.addEventListener("click", () => {
    const state = ensureConversationState(activeCharacterId);
    const branch = getActiveBranch(state);
    advancedExportName.value = sanitizeFileName(branch && branch.label ? branch.label : "conversation-export");
    advancedExportStatus.textContent = "";
    if (typeof advancedExportModal.showModal === "function") {
      advancedExportModal.showModal();
    }
  });

  advancedExportRun.addEventListener("click", runAdvancedExport);
  advancedExportClose.addEventListener("click", () => {
    advancedExportModal.close();
  });

  commandPaletteInput.addEventListener("input", () => {
    paletteSelectionIndex = 0;
    renderCommandPalette();
  });

  commandPaletteInput.addEventListener("keydown", (event) => {
    const commands = Array.isArray(commandPaletteList._commands) ? commandPaletteList._commands : [];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (commands.length) {
        paletteSelectionIndex = (paletteSelectionIndex + 1) % commands.length;
        renderCommandPalette();
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (commands.length) {
        paletteSelectionIndex = (paletteSelectionIndex - 1 + commands.length) % commands.length;
        renderCommandPalette();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (commands[paletteSelectionIndex]) {
        commandPaletteModal.close();
        commands[paletteSelectionIndex].run();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      commandPaletteModal.close();
    }
  });

  commandPaletteClose.addEventListener("click", () => {
    commandPaletteModal.close();
  });

  const queueSearchRefresh = () => {
    if (searchDebounceTimer) {
      window.clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = window.setTimeout(() => {
      searchDebounceTimer = null;
      writeStorageJSON(STORAGE_KEYS.conversationSearchPrefs, {
        query: conversationSearchQuery.value,
        characterId: conversationSearchCharacter.value,
        docs: conversationSearchDocs.value,
        from: conversationSearchFrom.value,
        to: conversationSearchTo.value
      });
      renderConversationSearchResults().catch((error) => {
        console.error("Conversation search refresh failed:", error);
      });
    }, 120);
  };

  conversationSearchQuery.addEventListener("input", queueSearchRefresh);
  conversationSearchCharacter.addEventListener("change", queueSearchRefresh);
  conversationSearchDocs.addEventListener("input", queueSearchRefresh);
  conversationSearchFrom.addEventListener("change", queueSearchRefresh);
  conversationSearchTo.addEventListener("change", queueSearchRefresh);
  conversationSearchClose.addEventListener("click", () => {
    conversationSearchModal.close();
  });

  conversationSearchResults.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const row = target.closest("[data-hit-index]");
    if (!row) {
      return;
    }
    const index = Number(row.getAttribute("data-hit-index"));
    if (!Number.isInteger(index) || index < 0 || index >= searchResultHits.length) {
      return;
    }
    const hit = searchResultHits[index];
    const card = document.querySelector(`[data-character-id="${hit.characterId}"]`);
    if (card instanceof HTMLElement) {
      card.click();
    }
    const state = ensureConversationState(hit.characterId);
    if (state) {
      state.activeBranchId = hit.branchId;
      persistConversationState();
      if (hit.characterId === activeCharacterId) {
        refreshChatUi();
      }
    }
    conversationSearchModal.close();
    window.setTimeout(() => {
      const node = logNode.querySelector(`[data-message-id="${hit.messageId}"]`);
      if (node instanceof HTMLElement) {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 80);
  });

  askAllButton.addEventListener("click", async () => {
    const prompt = inputNode.value.trim();
    if (!prompt) {
      window.alert("Enter a prompt in chat input before using Ask All.");
      return;
    }
    const selectedIds = new Set(getSelectedCharacterIds());
    const selectedCharacters = getCharactersSnapshot().filter((character) => selectedIds.has(character.id));
    if (!selectedCharacters.length) {
      window.alert("Select at least one character.");
      return;
    }

    renderAskAllResults(
      askAllResultsNode,
      selectedCharacters.map((character) => ({
        characterName: character.name,
        model: character.model,
        response: "Generating...",
        error: ""
      }))
    );

    const startedAt = performance.now();
    const results = await Promise.all(
      selectedCharacters.map(async (character) => {
        try {
          const response = await generateCharacterResponse(character, prompt, {
            onMetric: (name, value) => perfTelemetry.record(name, value)
          });
          return {
            characterId: character.id,
            characterName: character.name,
            model: character.model,
            response,
            error: ""
          };
        } catch (error) {
          return {
            characterId: character.id,
            characterName: character.name,
            model: character.model,
            response: "",
            error: error.message || "Request failed"
          };
        }
      })
    );

    renderAskAllResults(askAllResultsNode, results);
    const totalResponse = results.map((item) => item.response || "").join(" ");
    setTelemetry("Ask-all", performance.now() - startedAt, prompt, totalResponse);
  });

  pinChatButton.addEventListener("click", () => {
    const state = ensureConversationState(activeCharacterId);
    const branch = getActiveBranch(state);
    const character = getCharactersSnapshot().find((item) => item.id === activeCharacterId);
    if (!state || !branch || !character) {
      return;
    }
    const preview = branch.messages
      .slice(-2)
      .map((item) => `${item.role}: ${item.content}`)
      .join("\n")
      .slice(0, 300);
    pinnedChats.push({
      characterId: character.id,
      characterName: character.name,
      branchId: branch.id,
      branchLabel: branch.label || "Branch",
      snapshotText: preview
    });
    while (pinnedChats.length > 3) {
      pinnedChats.shift();
    }
    renderPinnedChats();
  });

  duplicateConversationButton.addEventListener("click", () => {
    const sourceState = ensureConversationState(activeCharacterId);
    const sourceBranch = getActiveBranch(sourceState);
    if (!sourceState || !sourceBranch) {
      return;
    }

    const characters = getCharactersSnapshot().filter((item) => item.id !== activeCharacterId);
    if (!characters.length) {
      window.alert("No target character available.");
      return;
    }

    const options = characters.map((item, index) => `${index + 1}. ${item.name}`).join("\n");
    const choice = window.prompt(`Duplicate active branch to:\n${options}\nEnter number:`, "1");
    const number = Number(choice);
    if (!Number.isInteger(number) || number < 1 || number > characters.length) {
      return;
    }
    const target = characters[number - 1];
    const targetState = ensureConversationState(target.id);
    if (!targetState) {
      return;
    }

    const copy = createBranch(target.id, {
      label: `Copy of ${sourceBranch.label}`,
      parentBranchId: sourceBranch.id,
      parentMessageIndex: sourceBranch.messages.length,
      messages: cloneMessages(sourceBranch.messages)
    });
    targetState.branches.push(copy);
    targetState.activeBranchId = copy.id;
    persistConversationState();
    window.alert(`Conversation duplicated to ${target.name}.`);
  });

  exportCharacterButton.addEventListener("click", async () => {
    const characters = getCharactersSnapshot();
    const character = characters.find((item) => item.id === activeCharacterId);
    if (!character) {
      return;
    }

    const includeChats = window.confirm("Include conversation branches in export?");
    const includeDocs = window.confirm("Include document references in export?");
    const state = ensureConversationState(activeCharacterId);
    const docs = includeDocs ? await getCharacterDocumentContext(activeCharacterId).catch(() => []) : [];
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      character,
      includeChats,
      includeDocs,
      conversationState: includeChats && state
        ? {
            activeBranchId: state.activeBranchId,
            branches: state.branches
          }
        : null,
      documentRefs: docs
    };
    downloadJson(`character-${character.name.replace(/\s+/g, "-").toLowerCase()}.json`, payload);
  });

  importCharacterButton.addEventListener("click", () => {
    importCharacterInput.value = "";
    importCharacterInput.click();
  });

  importCharacterInput.addEventListener("change", async () => {
    const file = importCharacterInput.files && importCharacterInput.files[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload || !payload.character) {
        throw new Error("Invalid character package.");
      }

      const incoming = payload.character;
      const existingCharacters = readStorageJSON(STORAGE_KEYS.characters, []);
      if (!Array.isArray(existingCharacters)) {
        throw new Error("Character storage is invalid.");
      }

      const byId = existingCharacters.find((item) => item.id === incoming.id);
      const byName = existingCharacters.find((item) => item.name === incoming.name);
      let finalCharacter = { ...incoming };
      let mode = "new";

      if (byId || byName) {
        const replace = window.confirm("Character conflict detected. Replace existing character?");
        if (replace) {
          mode = "replace";
        } else {
          const merge = window.confirm("Create as merged copy instead?");
          if (!merge) {
            return;
          }
          mode = "merge";
          finalCharacter.id = makeCharacterId(`${incoming.name}-copy`);
          finalCharacter.name = `${incoming.name} Copy`;
        }
      }

      let nextCharacters = [...existingCharacters];
      if (mode === "replace") {
        nextCharacters = nextCharacters.filter((item) => item.id !== incoming.id && item.name !== incoming.name);
      }
      nextCharacters.push(finalCharacter);
      writeStorageJSON(STORAGE_KEYS.characters, nextCharacters);
      window.localStorage.setItem(STORAGE_KEYS.activeCharacter, finalCharacter.id);

      const selected = readStorageJSON(STORAGE_KEYS.selectedCharacters, []);
      const selectedSet = new Set(Array.isArray(selected) ? selected : []);
      selectedSet.add(finalCharacter.id);
      writeStorageJSON(STORAGE_KEYS.selectedCharacters, Array.from(selectedSet));

      if (payload.includeChats && payload.conversationState) {
        const conversations = readStorageJSON(STORAGE_KEYS.conversations, {});
        const nextConversations = conversations && typeof conversations === "object" ? conversations : {};
        nextConversations[finalCharacter.id] = payload.conversationState;
        writeStorageJSON(STORAGE_KEYS.conversations, nextConversations);
      }

      if (payload.includeDocs && Array.isArray(payload.documentRefs) && payload.documentRefs.length) {
        window.alert("Character imported. Document references were included; unresolved missing docs must be reassigned manually.");
      }
      window.location.reload();
    } catch (error) {
      window.alert(`Import failed: ${error.message || "unknown error"}`);
    }
  });

  formNode.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSending) {
      return;
    }

    const prompt = inputNode.value.trim();
    if (!prompt) {
      return;
    }
    if (!activeCharacterId) {
      appendMessage(logNode, "assistant", "Select a character before sending.");
      return;
    }

    const activeCharacter = getCharactersSnapshot().find((item) => item.id === activeCharacterId) || null;
    const model = activeCharacter && activeCharacter.model
      ? activeCharacter.model
      : getSelectedModel();
    if (!model) {
      appendMessage(logNode, "assistant", "Set a model in Character Settings before sending.");
      return;
    }

    isSending = true;
    setComposerState(formNode, true);
    if (aiStatus) {
      aiStatus.start({ showStop: true });
    }
    const startedAt = performance.now();
    perfTelemetry.markStart("chat_send");
    activeStreamController = new AbortController();

    const state = ensureConversationState(activeCharacterId);
    const branch = getActiveBranch(state);
    if (!state || !branch) {
      isSending = false;
      setComposerState(formNode, false);
      if (aiStatus) {
        aiStatus.hide();
      }
      return;
    }
    const userTime = formatTime(new Date());
    const userTag = "you";
    appendMessage(logNode, "user", prompt, userTime, userTag);
    branch.messages.push(makeMessage("user", prompt, userTime, userTag, { analyticsId: `evt-${Date.now()}` }));
    sessionSentTurns += 1;
    persistConversationState();
    const activeDraftKey = getActiveDraftKey();
    window.localStorage.removeItem(activeDraftKey);
    inputNode.value = "";

    try {
      const character = activeCharacter;
      const assignedDocs = await getCharacterDocumentContext(activeCharacterId).catch(() => []);
      if (aiStatus) {
        aiStatus.setResources(assignedDocs.map((doc) => doc && doc.name).filter(Boolean));
      }
      const docContextBundle = await getCharacterPromptContextBundle(activeCharacterId, {
        tokenBudget: Number(character && character.contextWindow ? character.contextWindow : 4096),
        reserveTokens: 300,
        query: prompt,
        telemetry: {
          onMetric: (name, value) => perfTelemetry.record(name, value)
        }
      }).catch(() => ({ text: "", usage: null }));
      const docContext = String(docContextBundle && docContextBundle.text ? docContextBundle.text : "");
      lastContextUsage = docContextBundle && docContextBundle.usage ? docContextBundle.usage : null;
      renderContextUsage(lastContextUsage);
      const preamble = [];
      if (character && character.systemPrompt) {
        preamble.push({ role: "system", content: character.systemPrompt });
      }
      if (docContext) {
        preamble.push({
          role: "system",
          content: `Use this assigned document context when relevant:\n\n${docContext}`
        });
      }
      const result = await streamAssistantReply(
        logNode,
        model,
        branch.messages,
        activeStreamController.signal,
        preamble,
        aiStatus ? {
          onRequestStart: () => {
            aiStatus.setStage(aiStatus.stages.THINKING);
          },
          onFirstToken: () => {
            aiStatus.setStage(aiStatus.stages.RESPONDING);
          },
          onToken: (count) => {
            aiStatus.setTokenCount(count);
          },
          onTokenCadence: (cadenceMs) => {
            perfTelemetry.record("stream_cadence_ms", cadenceMs);
          }
        } : null
      );
      const assistantText = result.text || "";
      const assistantTag = shortenModelName(model);
      // Replace the transient last streamed bubble timestamp with model tag context.
      const lastMessage = logNode.lastElementChild;
      if (lastMessage) {
        const timeNode = lastMessage.querySelector("time");
        if (timeNode) {
          timeNode.textContent = `${formatTime(new Date())} · ${assistantTag}`;
        }
      }
      branch.messages.push(
        makeMessage("assistant", assistantText, formatTime(new Date()), assistantTag, { analyticsId: `evt-${Date.now()}` })
      );
      maybeAutoNameBranch(branch);
      persistConversationState();
      renderStartByBranch.delete(branch.id);
      refreshChatUi();
      conversationLabelNode.value = branch.label || "";
      if (result.aborted) {
        telemetryNode.textContent = "Generation stopped.";
      } else {
        perfTelemetry.record("send_to_first_token_ms", Number(result.firstTokenMs || 0));
        perfTelemetry.record("stream_token_count", Number(result.tokenCount || 0));
        perfTelemetry.record("stream_avg_cadence_ms", Number(result.avgCadenceMs || 0));
        perfTelemetry.markEnd("chat_send");
        setTelemetry("Chat", performance.now() - startedAt, prompt, assistantText);
        if (result.firstTokenMs !== null && result.firstTokenMs !== undefined) {
          const firstTokenSummary = perfTelemetry.summary("send_to_first_token_ms");
          const cadenceSummary = perfTelemetry.summary("stream_cadence_ms");
          telemetryNode.textContent = `${telemetryNode.textContent} | first token ${result.firstTokenMs}ms (p95 ${Math.round(firstTokenSummary.p95)}ms) | cadence p95 ${Math.round(cadenceSummary.p95)}ms`;
        }
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        telemetryNode.textContent = "Generation stopped.";
      } else {
      const errorText = "Unable to stream response. Verify Ollama is running.";
      appendMessage(logNode, "assistant", errorText);
      branch.messages.push(
        makeMessage("assistant", errorText, formatTime(new Date()), shortenModelName(model), { analyticsId: `evt-${Date.now()}` })
      );
      persistConversationState();
      renderStartByBranch.delete(branch.id);
      refreshChatUi();
      console.error("Streaming chat failed:", error);
      telemetryNode.textContent = `Chat error: ${error.message || "request failed"}`;
      }
    } finally {
      activeStreamController = null;
      isSending = false;
      setComposerState(formNode, false);
      if (aiStatus) {
        aiStatus.hide();
      }
      inputNode.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMobilePanels();
    }
    const accel = event.ctrlKey || event.metaKey;
    if (accel && event.key.toLowerCase() === "l") {
      event.preventDefault();
      inputNode.focus();
      return;
    }
    if (accel && event.shiftKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      newBranchButton.click();
      return;
    }
    if (accel && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommandPalette();
      return;
    }
    if (accel && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openConversationSearch();
      return;
    }
    if (accel && event.key === "Enter") {
      event.preventDefault();
      formNode.requestSubmit();
    }
  });

  queueAnalyticsRefresh();
  syncQuickModelSelect();
}

function initApp() {
  initStorage();
  initDocuments();
  initOllama();
  initChat();
  initCharacters();
  initWorkspace();
}

document.addEventListener("DOMContentLoaded", initApp);
