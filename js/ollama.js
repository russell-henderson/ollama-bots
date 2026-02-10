const OLLAMA_BASE_URL = "http://localhost:11434";
let selectedModel = "";
const EXCLUDED_MODEL_PATTERNS = [/qwen/i];
const PREFERRED_MODEL_ORDER = [
  "huihui_ai/Hermes-3-Llama-3.2-abliterated:3b",
  "mdq100/Gemma3-Instruct-Abliterated:12b"
];

function byId(id) {
  return document.getElementById(id);
}

function formatModelLine(model) {
  const name = model.name || "unknown";
  const size = model.details && model.details.parameter_size ? model.details.parameter_size : "size n/a";
  return `${name} (${size})`;
}

function shouldExcludeModel(name) {
  const text = String(name || "");
  return EXCLUDED_MODEL_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeModels(models) {
  const filtered = models.filter((model) => !shouldExcludeModel(model && model.name));
  const rank = (name) => {
    const idx = PREFERRED_MODEL_ORDER.indexOf(String(name || ""));
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };

  return filtered.sort((a, b) => {
    const byRank = rank(a && a.name) - rank(b && b.name);
    if (byRank !== 0) {
      return byRank;
    }
    return String(a && a.name || "").localeCompare(String(b && b.name || ""));
  });
}

function syncActiveTarget(targetNode) {
  if (!targetNode) {
    return;
  }

  targetNode.textContent = selectedModel ? `(${selectedModel})` : "(no model selected)";
}

function populateModelSelect(selectNode, models, targetNode) {
  selectNode.innerHTML = "";
  if (!models.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No models loaded";
    selectNode.appendChild(option);
    selectNode.disabled = true;
    selectedModel = "";
    syncActiveTarget(targetNode);
    return;
  }

  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.name || "";
    option.textContent = formatModelLine(model);
    selectNode.appendChild(option);
  });

  const names = models.map((model) => model.name);
  if (!names.includes(selectedModel)) {
    const preferred = PREFERRED_MODEL_ORDER.find((name) => names.includes(name));
    selectedModel = preferred || names[0] || "";
  }

  selectNode.value = selectedModel;
  selectNode.disabled = false;
  syncActiveTarget(targetNode);
}

function renderModels(listNode, models, emptyLabel) {
  if (!listNode) {
    return;
  }
  listNode.innerHTML = "";
  if (!models.length) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = emptyLabel || "No local models found.";
    listNode.appendChild(emptyItem);
    return;
  }

  models.forEach((model) => {
    const item = document.createElement("li");
    item.textContent = formatModelLine(model);
    listNode.appendChild(item);
  });
}

function setStatus(stateNode, summaryNode, errorNode, nextState) {
  stateNode.dataset.state = nextState.state;
  stateNode.textContent = nextState.label;
  summaryNode.textContent = nextState.summary;

  if (nextState.error) {
    errorNode.classList.add("has-error");
    errorNode.textContent = nextState.error;
  } else {
    errorNode.classList.remove("has-error");
    errorNode.textContent = "";
  }
}

async function checkOllama() {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
    method: "GET"
  });
  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const models = Array.isArray(payload.models) ? payload.models : [];
  return normalizeModels(models);
}

export function initOllama() {
  const stateNode = byId("ollama-connection-state");
  const summaryNode = byId("ollama-model-summary");
  const errorNode = byId("ollama-error");
  const retryButton = byId("ollama-retry");
  const modelSelect = byId("ollama-model-select");
  const activeModelTarget = byId("active-model-target");

  if (!stateNode || !summaryNode || !errorNode || !retryButton || !modelSelect) {
    return null;
  }

  async function refreshStatus() {
    setStatus(stateNode, summaryNode, errorNode, {
      state: "checking",
      label: "Checking Ollama...",
      summary: "Models: --",
      error: ""
    });

    try {
      const models = await checkOllama();
      populateModelSelect(modelSelect, models, activeModelTarget);
      setStatus(stateNode, summaryNode, errorNode, {
        state: "online",
        label: "Ollama connected",
        summary: `Models: ${models.length}`,
        error: ""
      });
    } catch (error) {
      populateModelSelect(modelSelect, [], activeModelTarget);
      setStatus(stateNode, summaryNode, errorNode, {
        state: "offline",
        label: "Ollama unavailable",
        summary: "Models: 0",
        error: `Could not reach ${OLLAMA_BASE_URL}. Start Ollama and retry.`
      });
      // Keep a console trace for local debugging without breaking UI flow.
      console.error("Ollama connectivity failed:", error);
    }
  }

  modelSelect.addEventListener("change", () => {
    selectedModel = modelSelect.value;
    syncActiveTarget(activeModelTarget);
  });

  retryButton.addEventListener("click", refreshStatus);
  refreshStatus();
  return null;
}

export function getSelectedModel() {
  return selectedModel;
}
