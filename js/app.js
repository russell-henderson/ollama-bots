import { getSelectedModel, initOllama } from "./ollama.js";
import { getCharactersSnapshot, getSelectedCharacterIds, initCharacters } from "./characters.js";
import { getCharacterDocumentContext, getCharacterPromptContext, initDocuments } from "./documents.js";
import { initStorage, readStorageJSON, STORAGE_KEYS, writeStorageJSON } from "./storage.js";
import { initWorkspace } from "./workspace.js";

const OLLAMA_BASE_URL = "http://localhost:11434";
const conversationStateByCharacter = new Map();
const templateState = { global: [], perCharacter: {} };
const pinnedChats = [];

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
  return {
    role: message && message.role === "assistant" ? "assistant" : "user",
    content: String((message && message.content) || ""),
    time: String((message && message.time) || ""),
    modelTag: String((message && message.modelTag) || "")
  };
}

function cloneMessages(messages) {
  return messages.map((message) => ({ ...normalizeMessage(message) }));
}

function createBranch(characterId, source) {
  const base = source || {};
  return {
    id: base.id || makeBranchId(characterId),
    label: String(base.label || "Main"),
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

function appendMessage(logNode, role, text, timeText, modelTag) {
  const article = document.createElement("article");
  article.className = role === "user" ? "message message-user" : "message message-assistant";

  const body = document.createElement("p");
  body.textContent = text;
  article.appendChild(body);

  const time = document.createElement("time");
  const baseTime = timeText || formatTime(new Date());
  time.textContent = modelTag ? `${baseTime} · ${modelTag}` : baseTime;
  article.appendChild(time);

  logNode.appendChild(article);
  logNode.scrollTop = logNode.scrollHeight;
  return { article, body };
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

function renderConversation(logNode, messages) {
  logNode.innerHTML = "";
  messages.forEach((message) => {
    appendMessage(logNode, message.role, message.content, message.time, message.modelTag);
  });
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

function estimateTokenCount(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words * 1.3));
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

async function generateCharacterResponse(character, prompt) {
  const docs = await getCharacterDocumentContext(character.id).catch(() => []);
  const promptContext = await getCharacterPromptContext(character.id).catch(() => "");
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

async function streamAssistantReply(logNode, model, messages, abortSignal, preambleMessages) {
  const historyMessages = messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
  const preamble = Array.isArray(preambleMessages) ? preambleMessages : [];
  const outboundMessages = preamble.concat(historyMessages);

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

  const assistantMessage = appendMessage(logNode, "assistant", "Thinking...");
  assistantMessage.article.classList.add("thinking");
  const streamStartedAt = performance.now();
  let firstTokenAt = null;
  const thinkingTimer = window.setInterval(() => {
    const elapsedSeconds = (performance.now() - streamStartedAt) / 1000;
    assistantMessage.body.textContent = `Thinking... ${elapsedSeconds.toFixed(1)}s`;
  }, 120);
  function stopThinkingState() {
    window.clearInterval(thinkingTimer);
    assistantMessage.article.classList.remove("thinking");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assembled = "";

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
            if (!firstTokenAt) {
              firstTokenAt = performance.now();
              stopThinkingState();
            }
            assembled += token;
            assistantMessage.body.textContent = assembled;
            logNode.scrollTop = logNode.scrollHeight;
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
        firstTokenMs: firstTokenAt ? Math.round(firstTokenAt - streamStartedAt) : null
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
    firstTokenMs: firstTokenAt ? Math.round(firstTokenAt - streamStartedAt) : null
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
  const askAllResultsNode = document.getElementById("ask-all-results");
  const pinChatButton = document.getElementById("pin-chat");
  const pinnedChatsNode = document.getElementById("pinned-chats");
  const telemetryNode = document.getElementById("chat-telemetry");
  const chatToolsNode = document.getElementById("chat-tools");
  const duplicateConversationButton = document.getElementById("duplicate-conversation");
  const exportCharacterButton = document.getElementById("export-character");
  const importCharacterButton = document.getElementById("import-character");
  const importCharacterInput = document.getElementById("character-import-input");
  if (!formNode || !inputNode || !logNode || !branchSelectNode || !newBranchButton || !templateSelectNode || !saveTemplateButton || !applyTemplateButton || !undoButton || !resetButton || !conversationLabelNode || !saveConversationLabelButton || !askAllButton || !askAllResultsNode || !duplicateConversationButton || !exportCharacterButton || !importCharacterButton || !importCharacterInput || !pinChatButton || !pinnedChatsNode || !telemetryNode || !chatToolsNode) {
    return;
  }

  let activeCharacterId = "";
  let isSending = false;
  let activeStreamController = null;
  chatToolsNode.open = false;
  loadConversationState();
  loadTemplateState();

  const refreshChatUi = () => {
    const state = ensureConversationState(activeCharacterId);
    const branch = getActiveBranch(state);
    if (!state || !branch) {
      renderConversation(logNode, []);
      return;
    }
    renderConversation(logNode, branch.messages);
    renderBranchSelect(branchSelectNode, state);
    conversationLabelNode.value = branch.label || "";
    renderTemplateSelect(templateSelectNode, activeCharacterId);
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

  const setTelemetry = (label, latencyMs, promptText, responseText) => {
    telemetryNode.textContent = `${label}: ${Math.round(latencyMs)}ms | prompt ~${estimateTokenCount(promptText)} tok | response ~${estimateTokenCount(responseText)} tok`;
  };

  document.addEventListener("character:active-changed", (event) => {
    const detail = event.detail && event.detail.character ? event.detail.character : null;
    if (!detail || !detail.id) {
      return;
    }

    activeCharacterId = detail.id;
    refreshChatUi();
  });

  branchSelectNode.addEventListener("change", () => {
    const state = ensureConversationState(activeCharacterId);
    if (!state) {
      return;
    }
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
    const starterMessage = {
      role: "user",
      content: template.content,
      time: formatTime(new Date())
    };
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
      branch.messages.push({
        role: "assistant",
        content: `System prompt active: ${systemPrompt}`,
        time: formatTime(new Date())
      });
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
    persistConversationState();
    refreshChatUi();
  });

  const stopButton = formNode.querySelector("#stop-generation");
  if (stopButton instanceof HTMLButtonElement) {
    stopButton.disabled = true;
    stopButton.addEventListener("click", () => {
      if (activeStreamController) {
        activeStreamController.abort();
      }
    });
  }

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
          const response = await generateCharacterResponse(character, prompt);
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

    const model = getSelectedModel();
    if (!model) {
      appendMessage(logNode, "assistant", "Select an Ollama model before sending.");
      return;
    }

    isSending = true;
    setComposerState(formNode, true);
    const startedAt = performance.now();
    activeStreamController = new AbortController();

    const state = ensureConversationState(activeCharacterId);
    const branch = getActiveBranch(state);
    if (!state || !branch) {
      isSending = false;
      setComposerState(formNode, false);
      return;
    }
    const userTime = formatTime(new Date());
    const userTag = "you";
    appendMessage(logNode, "user", prompt, userTime, userTag);
    branch.messages.push({ role: "user", content: prompt, time: userTime, modelTag: userTag });
    persistConversationState();
    inputNode.value = "";

    try {
      const character = getCharactersSnapshot().find((item) => item.id === activeCharacterId) || null;
      const docContext = await getCharacterPromptContext(activeCharacterId).catch(() => "");
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
        preamble
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
      branch.messages.push({
        role: "assistant",
        content: assistantText,
        time: formatTime(new Date()),
        modelTag: assistantTag
      });
      persistConversationState();
      if (result.aborted) {
        telemetryNode.textContent = "Generation stopped.";
      } else {
        setTelemetry("Chat", performance.now() - startedAt, prompt, assistantText);
        if (result.firstTokenMs !== null && result.firstTokenMs !== undefined) {
          telemetryNode.textContent = `${telemetryNode.textContent} | first token ${result.firstTokenMs}ms`;
        }
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        telemetryNode.textContent = "Generation stopped.";
      } else {
      const errorText = "Unable to stream response. Verify Ollama is running.";
      appendMessage(logNode, "assistant", errorText);
      branch.messages.push({
        role: "assistant",
        content: errorText,
        time: formatTime(new Date()),
        modelTag: shortenModelName(model)
      });
      persistConversationState();
      console.error("Streaming chat failed:", error);
      telemetryNode.textContent = `Chat error: ${error.message || "request failed"}`;
      }
    } finally {
      activeStreamController = null;
      isSending = false;
      setComposerState(formNode, false);
      inputNode.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      inputNode.focus();
      return;
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      newBranchButton.click();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      const characters = getCharactersSnapshot();
      const options = characters.map((item, index) => `${index + 1}. ${item.name}`).join("\n");
      const choice = window.prompt(`Switch active character:\n${options}\nEnter number:`, "1");
      const number = Number(choice);
      if (Number.isInteger(number) && number >= 1 && number <= characters.length) {
        const target = characters[number - 1];
        const card = document.querySelector(`[data-character-id="${target.id}"]`);
        if (card instanceof HTMLElement) {
          card.click();
        }
      }
      return;
    }
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      formNode.requestSubmit();
    }
  });
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
