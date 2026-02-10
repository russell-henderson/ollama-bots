export const STORAGE_SCHEMA_VERSION = 1;
export const STORAGE_KEYS = {
  schemaVersion: "ollama.app.schema.version",
  characters: "ollama.app.v1.characters",
  activeCharacter: "ollama.app.v1.activeCharacter",
  selectedCharacters: "ollama.app.v1.selectedCharacters",
  conversations: "ollama.app.v1.conversations",
  chatTemplates: "ollama.app.v1.chatTemplates"
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

  // Baseline migration hook for future schema changes.
  window.localStorage.setItem(STORAGE_KEYS.schemaVersion, String(STORAGE_SCHEMA_VERSION));
  return null;
}
