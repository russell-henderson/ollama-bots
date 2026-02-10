import { readStorageJSON, STORAGE_KEYS, writeStorageJSON } from "./storage.js";

function byId(id) {
  return document.getElementById(id);
}

function makeDefaultCharacter(id, name, model) {
  return {
    id,
    name,
    systemPrompt: "",
    model,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    maxTokens: 512,
    contextWindow: 4096
  };
}

const defaultCharacters = [
  makeDefaultCharacter("char-luna", "Luna", "llama2"),
  makeDefaultCharacter("char-orion", "Orion", "mistral")
];

let characters = [];
let activeCharacterId = "";
let selectedCharacterIds = new Set();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCharacter(character) {
  const baseline = makeDefaultCharacter(character.id || "", character.name || "Character", character.model || "llama2");
  return {
    ...baseline,
    ...character,
    name: String(character.name || baseline.name).trim() || baseline.name,
    model: String(character.model || baseline.model).trim() || baseline.model,
    systemPrompt: String(character.systemPrompt || ""),
    temperature: clamp(Number(character.temperature), 0, 2) || baseline.temperature,
    topP: clamp(Number(character.topP), 0, 1) || baseline.topP,
    topK: clamp(Math.round(Number(character.topK)), 1, 200) || baseline.topK,
    maxTokens: clamp(Math.round(Number(character.maxTokens)), 1, 8192) || baseline.maxTokens,
    contextWindow: clamp(Math.round(Number(character.contextWindow)), 256, 32768) || baseline.contextWindow
  };
}

function loadState() {
  try {
    const parsed = readStorageJSON(STORAGE_KEYS.characters, null);
    const rawActive = window.localStorage.getItem(STORAGE_KEYS.activeCharacter);
    const parsedSelected = readStorageJSON(STORAGE_KEYS.selectedCharacters, null);
    if (Array.isArray(parsed) && parsed.length) {
      characters = parsed.map(normalizeCharacter).filter((character) => Boolean(character.id));
    }
    if (!characters.length) {
      characters = defaultCharacters.map((character) => ({ ...character }));
    }
    activeCharacterId = rawActive || characters[0].id;
    selectedCharacterIds = Array.isArray(parsedSelected)
      ? new Set(parsedSelected.filter((id) => characters.some((item) => item.id === id)))
      : new Set();
    if (!selectedCharacterIds.size && activeCharacterId) {
      selectedCharacterIds.add(activeCharacterId);
    }
  } catch (error) {
    characters = defaultCharacters.map((character) => ({ ...character }));
    activeCharacterId = characters[0].id;
    selectedCharacterIds = new Set([activeCharacterId]);
    console.error("Failed to load character state:", error);
  }
}

function saveState() {
  writeStorageJSON(STORAGE_KEYS.characters, characters);
  window.localStorage.setItem(STORAGE_KEYS.activeCharacter, activeCharacterId);
  writeStorageJSON(STORAGE_KEYS.selectedCharacters, Array.from(selectedCharacterIds));
}

function initialsFromName(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "?";
  }
  return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join("");
}

function getActiveCharacter() {
  const active = characters.find((character) => character.id === activeCharacterId);
  if (active) {
    return active;
  }
  activeCharacterId = characters[0].id;
  return characters[0];
}

function notifyActiveCharacterChange(character) {
  const label = byId("active-character-label");
  if (label) {
    label.textContent = character.name;
  }
  document.dispatchEvent(
    new CustomEvent("character:active-changed", {
      detail: { character: { ...character } }
    })
  );
  document.dispatchEvent(
    new CustomEvent("character:selection-changed", {
      detail: {
        selectedCharacterIds: Array.from(selectedCharacterIds),
        characters: characters.map((item) => ({ ...item }))
      }
    })
  );
}

function renderCharacterList(listNode) {
  listNode.innerHTML = "";
  characters.forEach((character) => {
    const card = document.createElement("div");
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.className = character.id === activeCharacterId ? "character-card active" : "character-card";
    card.dataset.characterId = character.id;

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initialsFromName(character.name);
    card.appendChild(avatar);

    const metaWrap = document.createElement("span");

    const name = document.createElement("span");
    name.className = "character-name";
    name.textContent = character.name;
    metaWrap.appendChild(name);

    const model = document.createElement("span");
    model.className = "character-model";
    model.textContent = character.model || "model not set";
    metaWrap.appendChild(model);

    const select = document.createElement("label");
    select.className = "character-select";
    const selectInput = document.createElement("input");
    selectInput.type = "checkbox";
    selectInput.className = "character-select-toggle";
    selectInput.dataset.characterId = character.id;
    selectInput.checked = selectedCharacterIds.has(character.id);
    select.appendChild(selectInput);
    const selectText = document.createElement("span");
    selectText.textContent = "Select";
    select.appendChild(selectText);
    metaWrap.appendChild(select);

    card.appendChild(metaWrap);
    listNode.appendChild(card);
  });
}

function rerender(listNode) {
  renderCharacterList(listNode);
  const active = getActiveCharacter();
  notifyActiveCharacterChange(active);
  saveState();
}

function makeId(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const token = Math.random().toString(36).slice(2, 8);
  return `char-${slug || "character"}-${token}`;
}

function openSettingsModal(modalNode, formNode, errorNode, character) {
  formNode.dataset.characterId = character.id;
  formNode.elements.name.value = character.name;
  formNode.elements.model.value = character.model;
  formNode.elements.systemPrompt.value = character.systemPrompt;
  formNode.elements.temperature.value = String(character.temperature);
  formNode.elements.topP.value = String(character.topP);
  formNode.elements.topK.value = String(character.topK);
  formNode.elements.maxTokens.value = String(character.maxTokens);
  formNode.elements.contextWindow.value = String(character.contextWindow);
  errorNode.textContent = "";
  if (typeof modalNode.showModal === "function") {
    modalNode.showModal();
  }
}

function validateSettings(fields) {
  if (!fields.name.trim()) {
    return "Name is required.";
  }
  if (!fields.model.trim()) {
    return "Model is required.";
  }
  if (Number.isNaN(fields.temperature) || fields.temperature < 0 || fields.temperature > 2) {
    return "Temperature must be between 0 and 2.";
  }
  if (Number.isNaN(fields.topP) || fields.topP < 0 || fields.topP > 1) {
    return "Top-p must be between 0 and 1.";
  }
  if (!Number.isInteger(fields.topK) || fields.topK < 1 || fields.topK > 200) {
    return "Top-k must be an integer between 1 and 200.";
  }
  if (!Number.isInteger(fields.maxTokens) || fields.maxTokens < 1 || fields.maxTokens > 8192) {
    return "Max tokens must be an integer between 1 and 8192.";
  }
  if (!Number.isInteger(fields.contextWindow) || fields.contextWindow < 256 || fields.contextWindow > 32768) {
    return "Context window must be an integer between 256 and 32768.";
  }
  return "";
}

function saveSettingsFromForm(formNode, errorNode, listNode) {
  const id = formNode.dataset.characterId || "";
  const character = characters.find((item) => item.id === id);
  if (!character) {
    errorNode.textContent = "Could not find the selected character.";
    return false;
  }

  const candidate = {
    name: String(formNode.elements.name.value || ""),
    model: String(formNode.elements.model.value || ""),
    systemPrompt: String(formNode.elements.systemPrompt.value || ""),
    temperature: Number(formNode.elements.temperature.value),
    topP: Number(formNode.elements.topP.value),
    topK: Number(formNode.elements.topK.value),
    maxTokens: Number(formNode.elements.maxTokens.value),
    contextWindow: Number(formNode.elements.contextWindow.value)
  };

  const validationError = validateSettings(candidate);
  if (validationError) {
    errorNode.textContent = validationError;
    return false;
  }

  character.name = candidate.name.trim();
  character.model = candidate.model.trim();
  character.systemPrompt = candidate.systemPrompt.trim();
  character.temperature = candidate.temperature;
  character.topP = candidate.topP;
  character.topK = candidate.topK;
  character.maxTokens = candidate.maxTokens;
  character.contextWindow = candidate.contextWindow;
  rerender(listNode);
  return true;
}

function createCharacter(listNode, modalNode, formNode, errorNode) {
  const nextIndex = characters.length + 1;
  const next = makeDefaultCharacter(makeId(`character-${nextIndex}`), `Character ${nextIndex}`, "llama2");
  characters.push(next);
  activeCharacterId = next.id;
  selectedCharacterIds.add(next.id);
  rerender(listNode);
  openSettingsModal(modalNode, formNode, errorNode, next);
}

function editCharacter(modalNode, formNode, errorNode) {
  const active = getActiveCharacter();
  openSettingsModal(modalNode, formNode, errorNode, active);
}

function cloneCharacter(listNode) {
  const active = getActiveCharacter();
  const clone = {
    ...active,
    id: makeId(`${active.name} clone`),
    name: `${active.name} Copy`
  };
  characters.push(clone);
  activeCharacterId = clone.id;
  selectedCharacterIds.add(clone.id);
  rerender(listNode);
}

function deleteCharacter(listNode) {
  const active = getActiveCharacter();
  if (characters.length === 1) {
    window.alert("At least one character must remain.");
    return;
  }
  if (!window.confirm(`Delete character "${active.name}"?`)) {
    return;
  }

  const index = characters.findIndex((character) => character.id === active.id);
  if (index < 0) {
    return;
  }

  characters.splice(index, 1);
  selectedCharacterIds.delete(active.id);
  const fallback = characters[Math.max(0, index - 1)] || characters[0];
  activeCharacterId = fallback.id;
  if (!selectedCharacterIds.size && fallback) {
    selectedCharacterIds.add(fallback.id);
  }
  rerender(listNode);
}

export function initCharacters() {
  const listNode = byId("character-list");
  const addButton = byId("add-character");
  const editButton = byId("edit-character");
  const cloneButton = byId("clone-character");
  const deleteButton = byId("delete-character");
  const modalNode = byId("character-settings-modal");
  const formNode = byId("character-settings-form");
  const cancelButton = byId("settings-cancel");
  const errorNode = byId("settings-error");

  if (!listNode || !addButton || !editButton || !cloneButton || !deleteButton || !modalNode || !formNode || !cancelButton || !errorNode) {
    return null;
  }

  loadState();
  rerender(listNode);

  listNode.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.classList.contains("character-select-toggle")) {
      const id = target.getAttribute("data-character-id");
      if (!id) {
        return;
      }
      const input = target;
      if (input instanceof HTMLInputElement && input.checked) {
        selectedCharacterIds.add(id);
      } else {
        selectedCharacterIds.delete(id);
      }
      if (!selectedCharacterIds.size && activeCharacterId) {
        selectedCharacterIds.add(activeCharacterId);
      }
      saveState();
      notifyActiveCharacterChange(getActiveCharacter());
      return;
    }
    const card = target.closest("[data-character-id]");
    if (!card) {
      return;
    }

    activeCharacterId = card.getAttribute("data-character-id") || activeCharacterId;
    rerender(listNode);
  });

  addButton.addEventListener("click", () => createCharacter(listNode, modalNode, formNode, errorNode));
  editButton.addEventListener("click", () => editCharacter(modalNode, formNode, errorNode));
  cloneButton.addEventListener("click", () => cloneCharacter(listNode));
  deleteButton.addEventListener("click", () => deleteCharacter(listNode));

  cancelButton.addEventListener("click", () => {
    modalNode.close();
  });

  formNode.addEventListener("submit", (event) => {
    event.preventDefault();
    if (saveSettingsFromForm(formNode, errorNode, listNode)) {
      modalNode.close();
    }
  });

  return null;
}

export function getCharactersSnapshot() {
  return characters.map((item) => ({ ...item }));
}

export function getSelectedCharacterIds() {
  return Array.from(selectedCharacterIds);
}
