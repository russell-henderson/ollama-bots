export const STORAGE_SCHEMA_VERSION = 3;
export const STORAGE_KEYS = {
  schemaVersion: "ollama.app.schema.version",
  characters: "ollama.app.v1.characters",
  activeCharacter: "ollama.app.v1.activeCharacter",
  selectedCharacters: "ollama.app.v1.selectedCharacters",
  conversations: "ollama.app.v1.conversations",
  chatTemplates: "ollama.app.v1.chatTemplates",
  statusIndicatorMode: "ollama.app.v2.statusIndicator.mode",
  characterGroups: "ollama.app.v3.characterGroups",
  documentLibraryFilters: "ollama.app.v3.documentLibrary.filters",
  conversationSearchPrefs: "ollama.app.v3.conversationSearch.prefs",
  promptChains: "ollama.app.v3.promptChains",
  promptChainRunState: "ollama.app.v3.promptChainRunState"
};

export function readStorageJSON(key, fallbackValue) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallbackValue;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to parse localStorage key ${key}:`, error);
    return fallbackValue;
  }
}

export function writeStorageJSON(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function initStorage() {
  const current = Number(window.localStorage.getItem(STORAGE_KEYS.schemaVersion) || 0);
  if (current === STORAGE_SCHEMA_VERSION) {
    return null;
  }

  if (current < 2) {
    migrateToV2();
  }
  if (current < 3) {
    migrateToV3();
  }

  window.localStorage.setItem(STORAGE_KEYS.schemaVersion, String(STORAGE_SCHEMA_VERSION));
  return null;
}

function migrateToV2() {
  const conversations = readStorageJSON(STORAGE_KEYS.conversations, null);
  if (!conversations || typeof conversations !== "object") {
    return;
  }

  const migrated = {};
  Object.keys(conversations).forEach((characterId) => {
    migrated[characterId] = normalizeConversationStateForV2(characterId, conversations[characterId]);
  });

  writeStorageJSON(STORAGE_KEYS.conversations, migrated);
}

function migrateToV3() {
  // v3 adds optional persisted UI metadata (groups and filters) without
  // requiring transforms to existing character or conversation payloads.
}

function normalizeConversationStateForV2(characterId, rawState) {
  if (Array.isArray(rawState)) {
    const id = makeBranchId(characterId);
    return {
      activeBranchId: id,
      branches: [
        {
          id,
          label: "Main",
          manualLabel: false,
          autoNamed: false,
          parentBranchId: "",
          parentMessageIndex: 0,
          messages: rawState.map(normalizeMessageV2)
        }
      ]
    };
  }

  const rawBranches = Array.isArray(rawState && rawState.branches) ? rawState.branches : [];
  const branches = rawBranches.map((branch) => ({
    id: String((branch && branch.id) || makeBranchId(characterId)),
    label: String((branch && branch.label) || "Main"),
    manualLabel: Boolean(branch && branch.manualLabel),
    autoNamed: Boolean(branch && branch.autoNamed),
    parentBranchId: String((branch && branch.parentBranchId) || ""),
    parentMessageIndex: Number.isFinite(branch && branch.parentMessageIndex) ? branch.parentMessageIndex : 0,
    messages: Array.isArray(branch && branch.messages) ? branch.messages.map(normalizeMessageV2) : []
  }));

  if (!branches.length) {
    const id = makeBranchId(characterId);
    return {
      activeBranchId: id,
      branches: [{
        id,
        label: "Main",
        manualLabel: false,
        autoNamed: false,
        parentBranchId: "",
        parentMessageIndex: 0,
        messages: []
      }]
    };
  }

  const activeBranchId = branches.some((branch) => branch.id === rawState.activeBranchId)
    ? rawState.activeBranchId
    : branches[0].id;

  return { activeBranchId, branches };
}

function normalizeMessageV2(message) {
  const role = message && message.role === "assistant" ? "assistant" : "user";
  const content = String((message && message.content) || "");
  const time = String((message && message.time) || "");
  const modelTag = String((message && message.modelTag) || "");
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
    id: String((message && message.id) || makeMessageId()),
    role,
    content,
    time,
    modelTag,
    metadata
  };
}

function makeBranchId(characterId) {
  const token = Math.random().toString(36).slice(2, 8);
  return `branch-${characterId || "char"}-${Date.now()}-${token}`;
}

function makeMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
