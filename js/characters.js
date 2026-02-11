import { readStorageJSON, STORAGE_KEYS, writeStorageJSON } from "./storage.js";

const DEFAULT_CHARACTER_MODEL = "MartinRizzo/Regent-Dominique:24b";
const LEGACY_DEFAULT_MODEL = "thirdeyeai/DeepSeek-R1-Distill-Qwen-7B-uncensored:Q4_0";
const FORCE_MODEL_MIGRATION_FLAG = "ollama.app.v3.forceModel.regentDominique24b.applied";
const CHARACTER_GROUP_COLLAPSE_KEY = "ollama.app.v3.characterGroups.collapsed";
const UNGROUPED_ID = "";

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
    contextWindow: 4096,
    groupId: UNGROUPED_ID
  };
}

function makeGroup(id, name, order) {
  return { id, name, order };
}

const defaultCharacters = [
  makeDefaultCharacter("char-luna", "Luna", DEFAULT_CHARACTER_MODEL),
  makeDefaultCharacter("char-orion", "Orion", DEFAULT_CHARACTER_MODEL)
];

let characters = [];
let characterGroups = [];
let activeCharacterId = "";
let selectedCharacterIds = new Set();
let collapsedGroupIds = new Set();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function makeGroupId(name) {
  const slug = String(name || "group")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `group-${slug || "general"}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeGroup(group, fallbackOrder) {
  return makeGroup(
    String(group && group.id ? group.id : makeGroupId(group && group.name ? group.name : "group")),
    String(group && group.name ? group.name : "Group").trim() || "Group",
    Number.isFinite(group && group.order) ? Number(group.order) : fallbackOrder
  );
}

function normalizeCharacter(character) {
  const incomingModel = String(character && character.model ? character.model : "").trim();
  const normalizedModel = incomingModel === LEGACY_DEFAULT_MODEL ? DEFAULT_CHARACTER_MODEL : incomingModel;
  const baseline = makeDefaultCharacter(character.id || "", character.name || "Character", normalizedModel || DEFAULT_CHARACTER_MODEL);
  return {
    ...baseline,
    ...character,
    name: String(character.name || baseline.name).trim() || baseline.name,
    model: String(normalizedModel || baseline.model).trim() || baseline.model,
    systemPrompt: String(character.systemPrompt || ""),
    temperature: clamp(Number(character.temperature), 0, 2) || baseline.temperature,
    topP: clamp(Number(character.topP), 0, 1) || baseline.topP,
    topK: clamp(Math.round(Number(character.topK)), 1, 200) || baseline.topK,
    maxTokens: clamp(Math.round(Number(character.maxTokens)), 1, 8192) || baseline.maxTokens,
    contextWindow: clamp(Math.round(Number(character.contextWindow)), 256, 32768) || baseline.contextWindow,
    groupId: String(character.groupId || UNGROUPED_ID)
  };
}

function normalizeCharactersForGroups() {
  const validGroupIds = new Set(characterGroups.map((group) => group.id));
  characters = characters.map((item) => ({
    ...item,
    groupId: validGroupIds.has(item.groupId) ? item.groupId : UNGROUPED_ID
  }));
}

function loadState() {
  try {
    const parsed = readStorageJSON(STORAGE_KEYS.characters, null);
    const parsedGroups = readStorageJSON(STORAGE_KEYS.characterGroups, null);
    const rawActive = window.localStorage.getItem(STORAGE_KEYS.activeCharacter);
    const parsedSelected = readStorageJSON(STORAGE_KEYS.selectedCharacters, null);
    const parsedCollapsed = readStorageJSON(CHARACTER_GROUP_COLLAPSE_KEY, null);
    if (Array.isArray(parsed) && parsed.length) {
      characters = parsed.map(normalizeCharacter).filter((character) => Boolean(character.id));
    }
    if (!characters.length) {
      characters = defaultCharacters.map((character) => ({ ...character }));
    }
    if (window.localStorage.getItem(FORCE_MODEL_MIGRATION_FLAG) !== "1") {
      characters = characters.map((character) => ({
        ...character,
        model: DEFAULT_CHARACTER_MODEL
      }));
      window.localStorage.setItem(FORCE_MODEL_MIGRATION_FLAG, "1");
    }
    characterGroups = Array.isArray(parsedGroups)
      ? parsedGroups.map((group, index) => normalizeGroup(group, index))
      : [];
    characterGroups.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    normalizeCharactersForGroups();
    activeCharacterId = rawActive || characters[0].id;
    selectedCharacterIds = Array.isArray(parsedSelected)
      ? new Set(parsedSelected.filter((id) => characters.some((item) => item.id === id)))
      : new Set();
    collapsedGroupIds = Array.isArray(parsedCollapsed)
      ? new Set(parsedCollapsed.map((id) => String(id || "")))
      : new Set();
    if (!selectedCharacterIds.size && activeCharacterId) {
      selectedCharacterIds.add(activeCharacterId);
    }
  } catch (error) {
    characters = defaultCharacters.map((character) => ({ ...character }));
    characterGroups = [];
    activeCharacterId = characters[0].id;
    selectedCharacterIds = new Set([activeCharacterId]);
    collapsedGroupIds = new Set();
    console.error("Failed to load character state:", error);
  }
}

function saveState() {
  writeStorageJSON(STORAGE_KEYS.characters, characters);
  writeStorageJSON(STORAGE_KEYS.characterGroups, characterGroups);
  window.localStorage.setItem(STORAGE_KEYS.activeCharacter, activeCharacterId);
  writeStorageJSON(STORAGE_KEYS.selectedCharacters, Array.from(selectedCharacterIds));
  writeStorageJSON(CHARACTER_GROUP_COLLAPSE_KEY, Array.from(collapsedGroupIds));
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
  const modelTarget = byId("active-model-target");
  if (modelTarget) {
    modelTarget.textContent = character && character.model ? `(${character.model})` : "(no model selected)";
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
        characters: characters.map((item) => ({ ...item })),
        groups: characterGroups.map((item) => ({ ...item }))
      }
    })
  );
}

function getSortedGroupsForRender() {
  return [...characterGroups].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function getGroupName(groupId) {
  if (!groupId) {
    return "Ungrouped";
  }
  const match = characterGroups.find((group) => group.id === groupId);
  return match ? match.name : "Ungrouped";
}

function renderCharacterCard(character) {
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
  if (character.id === activeCharacterId) {
    const groupSelect = document.createElement("select");
    groupSelect.className = "character-group-select";
    groupSelect.dataset.characterId = character.id;
    const ungroupedOption = document.createElement("option");
    ungroupedOption.value = UNGROUPED_ID;
    ungroupedOption.textContent = "Ungrouped";
    groupSelect.appendChild(ungroupedOption);
    getSortedGroupsForRender().forEach((group) => {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.name;
      groupSelect.appendChild(option);
    });
    groupSelect.value = character.groupId || UNGROUPED_ID;
    card.appendChild(groupSelect);
  }
  return card;
}

function renderCharacterList(listNode) {
  listNode.innerHTML = "";
  const groupBuckets = new Map();
  groupBuckets.set(UNGROUPED_ID, []);
  characters.forEach((character) => {
    const key = character.groupId || UNGROUPED_ID;
    if (!groupBuckets.has(key)) {
      groupBuckets.set(key, []);
    }
    groupBuckets.get(key).push(character);
  });

  const orderedGroupIds = [UNGROUPED_ID, ...getSortedGroupsForRender().map((group) => group.id)];
  orderedGroupIds.forEach((groupId) => {
    const rows = groupBuckets.get(groupId) || [];
    if (!rows.length) {
      return;
    }
    const groupNode = document.createElement("section");
    groupNode.className = "character-group";

    const isCollapsed = collapsedGroupIds.has(groupId);
    const header = document.createElement("button");
    header.type = "button";
    header.className = "group-header";
    header.dataset.groupToggle = groupId;
    header.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    const toggle = document.createElement("span");
    toggle.className = "group-toggle";
    toggle.textContent = isCollapsed ? "▶" : "▼";
    header.appendChild(toggle);
    const name = document.createElement("span");
    name.className = "group-name";
    name.textContent = getGroupName(groupId);
    header.appendChild(name);
    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `(${rows.length})`;
    header.appendChild(count);
    groupNode.appendChild(header);

    const body = document.createElement("div");
    body.className = isCollapsed ? "group-characters collapsed" : "group-characters";
    body.dataset.groupId = groupId;
    rows.forEach((character) => {
      body.appendChild(renderCharacterCard(character));
    });
    groupNode.appendChild(body);
    listNode.appendChild(groupNode);
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
  if (formNode.elements.model instanceof HTMLSelectElement) {
    const known = Array.from(formNode.elements.model.options || []).some((option) => option.value === character.model);
    if (!known && character.model) {
      const option = document.createElement("option");
      option.value = character.model;
      option.textContent = character.model;
      formNode.elements.model.appendChild(option);
    }
  }
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
  const active = getActiveCharacter();
  const next = makeDefaultCharacter(makeId(`character-${nextIndex}`), `Character ${nextIndex}`, DEFAULT_CHARACTER_MODEL);
  next.groupId = active && active.groupId ? active.groupId : UNGROUPED_ID;
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

function moveActiveCharacter(listNode, direction) {
  const index = characters.findIndex((character) => character.id === activeCharacterId);
  if (index < 0) {
    return;
  }
  const current = characters[index];
  const groupId = current.groupId || UNGROUPED_ID;
  const sameGroupIndices = characters
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter((entry) => (entry.item.groupId || UNGROUPED_ID) === groupId)
    .map((entry) => entry.itemIndex);
  const localIndex = sameGroupIndices.indexOf(index);
  const nextLocal = localIndex + direction;
  if (localIndex < 0 || nextLocal < 0 || nextLocal >= sameGroupIndices.length) {
    return;
  }
  const swapIndex = sameGroupIndices[nextLocal];
  const temp = characters[swapIndex];
  characters[swapIndex] = characters[index];
  characters[index] = temp;
  rerender(listNode);
}

function manageGroups(listNode) {
  const action = window.prompt("Group actions: create, rename, delete", "create");
  if (!action) {
    return;
  }
  const normalizedAction = action.trim().toLowerCase();

  if (normalizedAction === "create") {
    const name = window.prompt("New group name:", "General");
    if (!name || !name.trim()) {
      return;
    }
    characterGroups.push(normalizeGroup({ id: makeGroupId(name), name: name.trim(), order: characterGroups.length }, characterGroups.length));
    rerender(listNode);
    return;
  }

  if (normalizedAction === "rename") {
    if (!characterGroups.length) {
      window.alert("No groups available to rename.");
      return;
    }
    const options = characterGroups.map((group, index) => `${index + 1}. ${group.name}`).join("\n");
    const choice = Number(window.prompt(`Rename which group?\n${options}`, "1"));
    if (!Number.isInteger(choice) || choice < 1 || choice > characterGroups.length) {
      return;
    }
    const target = characterGroups[choice - 1];
    const nextName = window.prompt("New group name:", target.name);
    if (!nextName || !nextName.trim()) {
      return;
    }
    target.name = nextName.trim();
    rerender(listNode);
    return;
  }

  if (normalizedAction === "delete") {
    if (!characterGroups.length) {
      window.alert("No groups available to delete.");
      return;
    }
    const options = characterGroups.map((group, index) => `${index + 1}. ${group.name}`).join("\n");
    const choice = Number(window.prompt(`Delete which group?\n${options}`, "1"));
    if (!Number.isInteger(choice) || choice < 1 || choice > characterGroups.length) {
      return;
    }
    const target = characterGroups[choice - 1];
    if (!window.confirm(`Delete group "${target.name}" and move members to Ungrouped?`)) {
      return;
    }
    characterGroups = characterGroups.filter((group) => group.id !== target.id);
    characters = characters.map((character) => (
      character.groupId === target.id ? { ...character, groupId: UNGROUPED_ID } : character
    ));
    rerender(listNode);
  }
}

export function initCharacters() {
  const listNode = byId("character-list");
  const addButton = byId("add-character");
  const editButton = byId("edit-character");
  const cloneButton = byId("clone-character");
  const deleteButton = byId("delete-character");
  const manageGroupsButton = byId("manage-groups");
  const moveUpButton = byId("move-character-up");
  const moveDownButton = byId("move-character-down");
  const modalNode = byId("character-settings-modal");
  const formNode = byId("character-settings-form");
  const cancelButton = byId("settings-cancel");
  const errorNode = byId("settings-error");

  if (!listNode || !addButton || !editButton || !cloneButton || !deleteButton || !manageGroupsButton || !moveUpButton || !moveDownButton || !modalNode || !formNode || !cancelButton || !errorNode) {
    return null;
  }

  loadState();
  rerender(listNode);

  listNode.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const groupToggle = target.closest("[data-group-toggle]");
    if (groupToggle) {
      const groupId = String(groupToggle.getAttribute("data-group-toggle") || "");
      if (collapsedGroupIds.has(groupId)) {
        collapsedGroupIds.delete(groupId);
      } else {
        collapsedGroupIds.add(groupId);
      }
      rerender(listNode);
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
    const active = characters.find((item) => item.id === activeCharacterId);
    const groupId = active ? String(active.groupId || UNGROUPED_ID) : UNGROUPED_ID;
    collapsedGroupIds.delete(groupId);
    rerender(listNode);
  });

  listNode.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    if (!target.classList.contains("character-group-select")) {
      return;
    }
    const characterId = target.getAttribute("data-character-id");
    if (!characterId) {
      return;
    }
    const character = characters.find((item) => item.id === characterId);
    if (!character) {
      return;
    }
    character.groupId = target.value || UNGROUPED_ID;
    rerender(listNode);
  });

  addButton.addEventListener("click", () => createCharacter(listNode, modalNode, formNode, errorNode));
  editButton.addEventListener("click", () => editCharacter(modalNode, formNode, errorNode));
  cloneButton.addEventListener("click", () => cloneCharacter(listNode));
  deleteButton.addEventListener("click", () => deleteCharacter(listNode));
  manageGroupsButton.addEventListener("click", () => manageGroups(listNode));
  moveUpButton.addEventListener("click", () => moveActiveCharacter(listNode, -1));
  moveDownButton.addEventListener("click", () => moveActiveCharacter(listNode, 1));

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

export function setCharacterModel(characterId, modelName) {
  const id = String(characterId || "");
  const nextModel = String(modelName || "").trim();
  if (!id || !nextModel) {
    return false;
  }
  const character = characters.find((item) => item.id === id);
  if (!character) {
    return false;
  }
  if (character.model === nextModel) {
    return true;
  }
  character.model = nextModel;
  saveState();
  if (character.id === activeCharacterId) {
    notifyActiveCharacterChange(character);
  }
  return true;
}
