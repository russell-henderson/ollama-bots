import { exportDocumentState, importDocumentMetadata } from "./documents.js";
import { STORAGE_KEYS } from "./storage.js";

function byId(id) {
  return document.getElementById(id);
}

function readRawKey(key, fallbackValue) {
  const value = window.localStorage.getItem(key);
  return value === null ? fallbackValue : value;
}

function fileTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

async function exportWorkspace() {
  const documentState = await exportDocumentState().catch(() => ({
    docs: [],
    versions: [],
    chunks: [],
    associations: []
  }));
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    data: {
      characters: readRawKey(STORAGE_KEYS.characters, "[]"),
      activeCharacter: readRawKey(STORAGE_KEYS.activeCharacter, ""),
      conversations: readRawKey(STORAGE_KEYS.conversations, "{}"),
      chatTemplates: readRawKey(STORAGE_KEYS.chatTemplates, "{\"global\":[],\"perCharacter\":{}}"),
      documentState
    }
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ollama-workspace-${fileTimestamp()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

async function importWorkspaceFile(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (!payload || !payload.data) {
    throw new Error("Invalid workspace file: missing data payload.");
  }

  const characters = typeof payload.data.characters === "string" ? payload.data.characters : "[]";
  const activeCharacter = typeof payload.data.activeCharacter === "string" ? payload.data.activeCharacter : "";
  const conversations = typeof payload.data.conversations === "string" ? payload.data.conversations : "{}";
  const chatTemplates = typeof payload.data.chatTemplates === "string" ? payload.data.chatTemplates : "{\"global\":[],\"perCharacter\":{}}";
  const documentState = payload.data.documentState && typeof payload.data.documentState === "object"
    ? payload.data.documentState
    : (Array.isArray(payload.data.documentMetadata) ? payload.data.documentMetadata : []);

  window.localStorage.setItem(STORAGE_KEYS.characters, characters);
  window.localStorage.setItem(STORAGE_KEYS.activeCharacter, activeCharacter);
  window.localStorage.setItem(STORAGE_KEYS.conversations, conversations);
  window.localStorage.setItem(STORAGE_KEYS.chatTemplates, chatTemplates);

  await importDocumentMetadata(documentState);
}

export function initWorkspace() {
  const exportButton = byId("export-workspace");
  const importButton = byId("import-workspace");
  const fileInput = byId("workspace-import-input");
  if (!exportButton || !importButton || !fileInput) {
    return null;
  }

  exportButton.addEventListener("click", async () => {
    try {
      await exportWorkspace();
    } catch (error) {
      console.error("Workspace export failed:", error);
      window.alert("Workspace export failed.");
    }
  });

  importButton.addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      return;
    }

    try {
      await importWorkspaceFile(file);
      window.location.reload();
    } catch (error) {
      console.error("Workspace import failed:", error);
      window.alert("Workspace import failed. Verify JSON format.");
    }
  });

  return null;
}
