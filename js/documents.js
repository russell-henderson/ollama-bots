const DOCUMENT_DB_NAME = "ollama.documents.db";
const DOCUMENT_DB_VERSION = 2;

let documentDb = null;
let dbOpenPromise = null;
let pdfjsLibPromise = null;
let mammothPromise = null;
const DOC_LIBRARY_FILTERS_KEY = "ollama.app.v3.documentLibrary.filters";
const DOC_SCORING_WORKER_TIMEOUT_MS = 1200;

function ensureStore(db, storeName, options) {
  if (!db.objectStoreNames.contains(storeName)) {
    return db.createObjectStore(storeName, options);
  }
  return null;
}

function ensureIndex(store, indexName, keyPath, options) {
  if (!store) {
    return;
  }
  if (!store.indexNames.contains(indexName)) {
    store.createIndex(indexName, keyPath, options);
  }
}

function runMigrations(db, oldVersion) {
  // v1 baseline schema: docs, versions, chunks, associations
  if (oldVersion < 1) {
    const docsStore = ensureStore(db, "docs", { keyPath: "id" });
    ensureIndex(docsStore, "by_name", "name", { unique: false });
    ensureIndex(docsStore, "by_created_at", "createdAt", { unique: false });

    const versionsStore = ensureStore(db, "versions", { keyPath: "id" });
    ensureIndex(versionsStore, "by_doc_id", "docId", { unique: false });
    ensureIndex(versionsStore, "by_doc_and_created_at", ["docId", "createdAt"], { unique: false });

    const chunksStore = ensureStore(db, "chunks", { keyPath: "id" });
    ensureIndex(chunksStore, "by_doc_id", "docId", { unique: false });
    ensureIndex(chunksStore, "by_version_id", "versionId", { unique: false });
    ensureIndex(chunksStore, "by_doc_and_version", ["docId", "versionId"], { unique: false });

    const associationsStore = ensureStore(db, "associations", { keyPath: "id" });
    ensureIndex(associationsStore, "by_character_id", "characterId", { unique: false });
    ensureIndex(associationsStore, "by_doc_id", "docId", { unique: false });
    ensureIndex(associationsStore, "by_character_and_doc", ["characterId", "docId"], { unique: false });
  }

  if (oldVersion < 2) {
    // v2 stores tags/folder directly on docs records; no structural store changes required.
  }
}

function openDocumentsDb() {
  if (dbOpenPromise) {
    return dbOpenPromise;
  }

  dbOpenPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not supported in this browser."));
      return;
    }

    const request = window.indexedDB.open(DOCUMENT_DB_NAME, DOCUMENT_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion || 0;
      runMigrations(db, oldVersion);
    };

    request.onsuccess = () => {
      documentDb = request.result;
      documentDb.onversionchange = () => {
        documentDb.close();
        documentDb = null;
      };
      resolve(documentDb);
    };

    request.onblocked = () => {
      console.warn("IndexedDB upgrade blocked. Close other tabs using this app and retry.");
    };

    request.onerror = () => {
      reject(request.error || new Error("Failed to open IndexedDB."));
    };
  }).catch((error) => {
    dbOpenPromise = null;
    throw error;
  });

  return dbOpenPromise;
}

export function getDocumentsDb() {
  return documentDb;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

function bytesLabel(size) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const unique = Array.from(new Set(list.map((item) => item.toLowerCase())));
  return unique.sort((a, b) => a.localeCompare(b));
}

function normalizeFolder(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function readLibraryFilters() {
  try {
    const raw = window.localStorage.getItem(DOC_LIBRARY_FILTERS_KEY);
    if (!raw) {
      return { search: "", folder: "", tags: [] };
    }
    const parsed = JSON.parse(raw);
    return {
      search: String(parsed && parsed.search ? parsed.search : ""),
      folder: normalizeFolder(parsed && parsed.folder ? parsed.folder : ""),
      tags: normalizeTags(parsed && parsed.tags ? parsed.tags : [])
    };
  } catch (error) {
    console.error("Failed to read document library filters:", error);
    return { search: "", folder: "", tags: [] };
  }
}

function writeLibraryFilters(filters) {
  const payload = {
    search: String(filters && filters.search ? filters.search : ""),
    folder: normalizeFolder(filters && filters.folder ? filters.folder : ""),
    tags: normalizeTags(filters && filters.tags ? filters.tags : [])
  };
  window.localStorage.setItem(DOC_LIBRARY_FILTERS_KEY, JSON.stringify(payload));
}

function dateLabel(iso) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "unknown date";
  }
  return parsed.toLocaleDateString();
}

function makeDocId(name) {
  const slug = String(name || "doc")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const token = Math.random().toString(36).slice(2, 8);
  return `doc-${slug || "file"}-${token}`;
}

function extensionFromName(name) {
  const text = String(name || "");
  const index = text.lastIndexOf(".");
  return index >= 0 ? text.slice(index + 1).toLowerCase() : "";
}

function detectDocType(file) {
  const ext = extensionFromName(file.name);
  if (ext === "txt") return "txt";
  if (ext === "md") return "md";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  return "unknown";
}

function normalizeExtractedText(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function chunkByParagraph(text) {
  return normalizeExtractedText(text)
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function chunkByTokenCount(text, tokenSize) {
  const tokens = normalizeExtractedText(text).split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return [];
  }

  const size = Number.isFinite(tokenSize) ? Math.max(20, Math.round(tokenSize)) : 120;
  const chunks = [];
  for (let index = 0; index < tokens.length; index += size) {
    chunks.push(tokens.slice(index, index + size).join(" "));
  }
  return chunks;
}

function isHeadingLine(line) {
  const text = String(line || "").trim();
  if (!text) {
    return false;
  }
  if (/^#{1,6}\s+/.test(text)) {
    return true;
  }
  return /^[A-Z][A-Z0-9\s-]{2,}:$/.test(text);
}

function chunkBySection(text) {
  const lines = normalizeExtractedText(text).split("\n");
  if (!lines.length) {
    return [];
  }

  const chunks = [];
  let current = [];
  let headingDetected = false;
  lines.forEach((line) => {
    if (isHeadingLine(line)) {
      headingDetected = true;
      if (current.length) {
        const chunk = current.join("\n").trim();
        if (chunk) {
          chunks.push(chunk);
        }
      }
      current = [line.trim()];
      return;
    }
    current.push(line);
  });

  if (current.length) {
    const tail = current.join("\n").trim();
    if (tail) {
      chunks.push(tail);
    }
  }

  return headingDetected ? chunks : chunkByParagraph(text);
}

function chunkWholeDocument(text) {
  const normalized = normalizeExtractedText(text);
  return normalized ? [normalized] : [];
}

function buildChunks(text, strategy, tokenSize) {
  if (strategy === "token") {
    return chunkByTokenCount(text, tokenSize);
  }
  if (strategy === "section") {
    return chunkBySection(text);
  }
  if (strategy === "whole") {
    return chunkWholeDocument(text);
  }
  return chunkByParagraph(text);
}

function previewSnippet(text, maxLen) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLen) {
    return compact;
  }
  return `${compact.slice(0, maxLen)}...`;
}

function applyPresetPreprocessing(text, preset) {
  const source = normalizeExtractedText(text);
  if (!source) {
    return "";
  }
  if (preset === "summarize") {
    const sentences = source.split(/(?<=[.!?])\s+/).filter(Boolean);
    return sentences.slice(0, 8).join(" ");
  }
  if (preset === "bullets") {
    const lines = source
      .split(/\n\s*\n+|\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map((line) => `- ${line.replace(/^[-*]\s*/, "")}`).join("\n");
  }
  if (preset === "qa-clean") {
    return source
      .split("\n")
      .map((line) => line.replace(/^(Q|A)\s*:\s*/i, "").trim())
      .filter(Boolean)
      .join("\n");
  }
  return source;
}

function applyCustomPreprocessing(text, customInstructions) {
  const custom = String(customInstructions || "").trim();
  if (!custom) {
    return text;
  }
  const compact = custom.toLowerCase();
  if (compact.includes("lowercase")) {
    return text.toLowerCase();
  }
  if (compact.includes("uppercase")) {
    return text.toUpperCase();
  }
  if (compact.includes("trim lines")) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
  }
  return text;
}

function preprocessText(text, preset, customInstructions) {
  const presetApplied = applyPresetPreprocessing(text, preset);
  return applyCustomPreprocessing(presetApplied, customInstructions);
}

function makeVersionId(docId) {
  const stamp = Date.now();
  const token = Math.random().toString(36).slice(2, 7);
  return `ver-${docId}-${stamp}-${token}`;
}

async function getPdfjsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
  }
  return pdfjsLibPromise;
}

async function getMammoth() {
  if (!mammothPromise) {
    mammothPromise = import("https://esm.sh/mammoth@1.8.0");
  }
  return mammothPromise;
}

async function extractTextFromPdf(file) {
  const pdfjs = await getPdfjsLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data: bytes });
  const pdf = await task.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    pages.push(text);
  }
  return normalizeExtractedText(pages.join("\n\n"));
}

async function extractTextFromDocx(file) {
  const mammothModule = await getMammoth();
  const mammoth = mammothModule.default || mammothModule;
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return normalizeExtractedText(result.value);
}

async function extractTextFromFile(file) {
  const type = detectDocType(file);
  if (type === "txt" || type === "md") {
    return {
      docType: type,
      extractedText: normalizeExtractedText(await file.text()),
      parseStatus: "parsed",
      parseError: ""
    };
  }
  if (type === "pdf") {
    try {
      return {
        docType: type,
        extractedText: await extractTextFromPdf(file),
        parseStatus: "parsed",
        parseError: ""
      };
    } catch (error) {
      return {
        docType: type,
        extractedText: "",
        parseStatus: "error",
        parseError: `PDF parse failed: ${error.message || "unknown error"}`
      };
    }
  }
  if (type === "docx") {
    try {
      return {
        docType: type,
        extractedText: await extractTextFromDocx(file),
        parseStatus: "parsed",
        parseError: ""
      };
    } catch (error) {
      return {
        docType: type,
        extractedText: "",
        parseStatus: "error",
        parseError: `DOCX parse failed: ${error.message || "unknown error"}`
      };
    }
  }

  return {
    docType: type,
    extractedText: "",
    parseStatus: "error",
    parseError: "Unsupported file type. Use .txt, .md, .pdf, or .docx."
  };
}

async function listDocuments() {
  const db = await openDocumentsDb();
  const transaction = db.transaction(["docs"], "readonly");
  const store = transaction.objectStore("docs");
  const records = await requestToPromise(store.getAll());
  return (Array.isArray(records) ? records : []).map(normalizeDocumentRecord);
}

async function getDocumentById(docId) {
  const db = await openDocumentsDb();
  const transaction = db.transaction(["docs"], "readonly");
  const store = transaction.objectStore("docs");
  const doc = await requestToPromise(store.get(docId));
  return doc ? normalizeDocumentRecord(doc) : null;
}

async function patchDocument(docId, patch) {
  const existing = await getDocumentById(docId);
  if (!existing) {
    return null;
  }
  const db = await openDocumentsDb();
  const transaction = db.transaction(["docs"], "readwrite");
  const store = transaction.objectStore("docs");
  const merged = {
    ...existing,
    ...patch,
    tags: normalizeTags((patch && Object.prototype.hasOwnProperty.call(patch, "tags")) ? patch.tags : existing.tags),
    folder: normalizeFolder((patch && Object.prototype.hasOwnProperty.call(patch, "folder")) ? patch.folder : existing.folder),
    updatedAt: new Date().toISOString()
  };
  store.put(merged);
  await transactionDone(transaction);
  return normalizeDocumentRecord(merged);
}

function normalizeDocumentRecord(doc) {
  const record = { ...(doc || {}) };
  record.tags = normalizeTags(record.tags);
  record.folder = normalizeFolder(record.folder);
  return record;
}

async function addDocumentsFromFiles(files) {
  const incoming = Array.from(files || []);
  if (!incoming.length) {
    return;
  }

  const parsedEntries = await Promise.all(
    incoming.map(async (file) => {
      const parsed = await extractTextFromFile(file);
      const now = new Date().toISOString();
      return {
        id: makeDocId(file.name),
        name: file.name,
        size: Number(file.size || 0),
        mimeType: String(file.type || ""),
        createdAt: now,
        updatedAt: now,
        docType: parsed.docType,
        extractedText: parsed.extractedText,
        preprocessPreset: "none",
        preprocessCustom: "",
        processedText: parsed.extractedText,
        tags: [],
        folder: "",
        activeVersionId: "",
        lastChunkStrategy: "paragraph",
        lastTokenSize: 120,
        parseStatus: parsed.parseStatus,
        parseError: parsed.parseError
      };
    })
  );

  const db = await openDocumentsDb();
  const transaction = db.transaction(["docs"], "readwrite");
  const store = transaction.objectStore("docs");
  parsedEntries.forEach((entry) => store.put(entry));

  await transactionDone(transaction);
}

async function deleteDocument(docId) {
  const db = await openDocumentsDb();
  const transaction = db.transaction(["docs", "versions", "chunks", "associations"], "readwrite");
  transaction.objectStore("docs").delete(docId);

  const versionStore = transaction.objectStore("versions");
  const chunkStore = transaction.objectStore("chunks");
  const assocStore = transaction.objectStore("associations");
  const byDocVersion = versionStore.index("by_doc_id");
  const byDocChunk = chunkStore.index("by_doc_id");
  const byDocAssoc = assocStore.index("by_doc_id");

  const versions = await requestToPromise(byDocVersion.getAll());
  const chunks = await requestToPromise(byDocChunk.getAll());
  const associations = await requestToPromise(byDocAssoc.getAll());

  (versions || []).forEach((item) => versionStore.delete(item.id));
  (chunks || []).forEach((item) => chunkStore.delete(item.id));
  (associations || []).forEach((item) => assocStore.delete(item.id));

  await transactionDone(transaction);
}

async function listAssignmentsForCharacter(characterId) {
  if (!characterId) {
    return [];
  }
  const db = await openDocumentsDb();
  const transaction = db.transaction(["associations"], "readonly");
  const store = transaction.objectStore("associations");
  const index = store.index("by_character_id");
  const records = await requestToPromise(index.getAll(characterId));
  return Array.isArray(records) ? records : [];
}

async function listAllAssignments() {
  const db = await openDocumentsDb();
  const transaction = db.transaction(["associations"], "readonly");
  const store = transaction.objectStore("associations");
  const records = await requestToPromise(store.getAll());
  return Array.isArray(records) ? records : [];
}

async function assignDocumentToCharacter(characterId, docId) {
  if (!characterId || !docId) {
    return;
  }
  const db = await openDocumentsDb();
  const transaction = db.transaction(["associations"], "readwrite");
  const store = transaction.objectStore("associations");
  const index = store.index("by_character_and_doc");
  const existing = await requestToPromise(index.get([characterId, docId]));
  if (!existing) {
    store.put({
      id: `assoc-${characterId}-${docId}`,
      characterId,
      docId,
      createdAt: new Date().toISOString()
    });
  }
  await transactionDone(transaction);
}

async function unassignDocumentFromCharacter(characterId, docId) {
  if (!characterId || !docId) {
    return;
  }
  const db = await openDocumentsDb();
  const transaction = db.transaction(["associations"], "readwrite");
  const store = transaction.objectStore("associations");
  const index = store.index("by_character_and_doc");
  const existing = await requestToPromise(index.get([characterId, docId]));
  if (existing && existing.id) {
    store.delete(existing.id);
  }
  await transactionDone(transaction);
}

async function reprocessDocument(doc, options) {
  if (!doc || !doc.id) {
    return { versionId: "", chunkCount: 0 };
  }

  const strategy = options && options.strategy ? options.strategy : "paragraph";
  const tokenSize = Number(options && options.tokenSize ? options.tokenSize : 120);
  const preset = options && options.preset ? options.preset : "none";
  const custom = options && options.custom ? options.custom : "";
  const processedText = preprocessText(doc.extractedText || "", preset, custom);
  const chunks = buildChunks(processedText, strategy, tokenSize);
  const versionId = makeVersionId(doc.id);
  const now = new Date().toISOString();

  const db = await openDocumentsDb();
  const transaction = db.transaction(["docs", "versions", "chunks"], "readwrite");
  const docsStore = transaction.objectStore("docs");
  const versionsStore = transaction.objectStore("versions");
  const chunksStore = transaction.objectStore("chunks");

  versionsStore.put({
    id: versionId,
    docId: doc.id,
    strategy,
    tokenSize,
    preset,
    customInstructions: custom,
    textSnapshot: processedText,
    chunkCount: chunks.length,
    createdAt: now
  });

  chunks.forEach((chunkText, index) => {
    chunksStore.put({
      id: `chunk-${versionId}-${index}`,
      docId: doc.id,
      versionId,
      order: index,
      text: chunkText,
      createdAt: now
    });
  });

  docsStore.put({
    ...doc,
    preprocessPreset: preset,
    preprocessCustom: custom,
    processedText,
    activeVersionId: versionId,
    lastChunkStrategy: strategy,
    lastTokenSize: tokenSize,
    updatedAt: now
  });

  await transactionDone(transaction);
  return { versionId, chunkCount: chunks.length };
}

async function listVersionsForDoc(docId) {
  if (!docId) {
    return [];
  }
  const db = await openDocumentsDb();
  const transaction = db.transaction(["versions"], "readonly");
  const store = transaction.objectStore("versions");
  const index = store.index("by_doc_id");
  const records = await requestToPromise(index.getAll(docId));
  return (Array.isArray(records) ? records : []).sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
}

async function listChunksForVersion(versionId) {
  if (!versionId) {
    return [];
  }
  const db = await openDocumentsDb();
  const transaction = db.transaction(["chunks"], "readonly");
  const store = transaction.objectStore("chunks");
  const index = store.index("by_version_id");
  const records = await requestToPromise(index.getAll(versionId));
  return (Array.isArray(records) ? records : []).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

async function setActiveVersionForDoc(docId, versionId) {
  if (!docId || !versionId) {
    return null;
  }
  const db = await openDocumentsDb();
  const transaction = db.transaction(["docs", "versions"], "readwrite");
  const docsStore = transaction.objectStore("docs");
  const versionsStore = transaction.objectStore("versions");
  const doc = await requestToPromise(docsStore.get(docId));
  const version = await requestToPromise(versionsStore.get(versionId));
  if (!doc || !version || version.docId !== docId) {
    await transactionDone(transaction);
    return null;
  }

  docsStore.put({
    ...doc,
    activeVersionId: versionId,
    processedText: String(version.textSnapshot || doc.processedText || doc.extractedText || ""),
    lastChunkStrategy: String(version.strategy || doc.lastChunkStrategy || "paragraph"),
    lastTokenSize: Number(version.tokenSize || doc.lastTokenSize || 120),
    preprocessPreset: String(version.preset || doc.preprocessPreset || "none"),
    preprocessCustom: String(version.customInstructions || doc.preprocessCustom || ""),
    updatedAt: new Date().toISOString()
  });

  await transactionDone(transaction);
  return version;
}

async function uploadDocumentVersion(doc, file) {
  if (!doc || !doc.id || !file) {
    return { versionId: "", chunkCount: 0 };
  }
  const parsed = await extractTextFromFile(file);
  if (parsed.parseStatus !== "parsed") {
    throw new Error(parsed.parseError || "Failed to parse uploaded version.");
  }

  const preset = doc.preprocessPreset || "none";
  const custom = doc.preprocessCustom || "";
  const strategy = doc.lastChunkStrategy || "paragraph";
  const tokenSize = Number(doc.lastTokenSize || 120);
  const processedText = preprocessText(parsed.extractedText, preset, custom);
  const chunks = buildChunks(processedText, strategy, tokenSize);
  const versionId = makeVersionId(doc.id);
  const now = new Date().toISOString();

  const db = await openDocumentsDb();
  const transaction = db.transaction(["docs", "versions", "chunks"], "readwrite");
  const docsStore = transaction.objectStore("docs");
  const versionsStore = transaction.objectStore("versions");
  const chunksStore = transaction.objectStore("chunks");

  versionsStore.put({
    id: versionId,
    docId: doc.id,
    strategy,
    tokenSize,
    preset,
    customInstructions: custom,
    textSnapshot: processedText,
    chunkCount: chunks.length,
    source: "upload",
    createdAt: now
  });

  chunks.forEach((chunkText, index) => {
    chunksStore.put({
      id: `chunk-${versionId}-${index}`,
      docId: doc.id,
      versionId,
      order: index,
      text: chunkText,
      createdAt: now
    });
  });

  docsStore.put({
    ...doc,
    size: Number(file.size || doc.size || 0),
    mimeType: String(file.type || doc.mimeType || ""),
    docType: parsed.docType,
    extractedText: parsed.extractedText,
    parseStatus: parsed.parseStatus,
    parseError: parsed.parseError,
    processedText,
    activeVersionId: versionId,
    lastChunkStrategy: strategy,
    lastTokenSize: tokenSize,
    updatedAt: now
  });

  await transactionDone(transaction);
  return { versionId, chunkCount: chunks.length };
}

async function pinAssociationVersion(characterId, docId, versionId) {
  if (!characterId || !docId) {
    return;
  }
  const db = await openDocumentsDb();
  const transaction = db.transaction(["associations"], "readwrite");
  const store = transaction.objectStore("associations");
  const index = store.index("by_character_and_doc");
  const existing = await requestToPromise(index.get([characterId, docId]));
  if (existing && existing.id) {
    store.put({
      ...existing,
      pinnedVersionId: versionId || "",
      updatedAt: new Date().toISOString()
    });
  }
  await transactionDone(transaction);
}

function filterDocuments(records, query, folderQuery, selectedTags) {
  const term = String(query || "").trim().toLowerCase();
  const folderTerm = normalizeFolder(folderQuery).toLowerCase();
  const tags = Array.isArray(selectedTags) ? selectedTags : [];
  const sorted = [...records].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return sorted.filter((item) => {
    const nameMatch = !term || String(item.name || "").toLowerCase().includes(term);
    const folderValue = String(item.folder || "").toLowerCase();
    const folderMatch = !folderTerm || folderValue === folderTerm || folderValue.startsWith(`${folderTerm}/`);
    const itemTags = normalizeTags(item.tags);
    const tagsMatch = !tags.length || tags.every((tag) => itemTags.includes(tag));
    return nameMatch && folderMatch && tagsMatch;
  });
}

function buildBadgeText(docId, assignedDocIds, assignmentCounts) {
  const count = assignmentCounts.get(docId) || 0;
  const badges = [];
  if (assignedDocIds.has(docId)) {
    badges.push("active");
  }
  badges.push(count > 1 ? "shared" : "character-exclusive");
  return badges.join(" | ");
}

function buildFolderTree(records) {
  const root = { name: "", path: "", count: 0, children: new Map() };
  const docs = Array.isArray(records) ? records : [];

  docs.forEach((doc) => {
    root.count += 1;
    const folder = normalizeFolder(doc && doc.folder);
    if (!folder) {
      return;
    }
    const parts = folder.split("/").filter(Boolean);
    let current = root;
    let path = "";
    parts.forEach((part) => {
      path = path ? `${path}/${part}` : part;
      if (!current.children.has(part)) {
        current.children.set(part, { name: part, path, count: 0, children: new Map() });
      }
      current = current.children.get(part);
      current.count += 1;
    });
  });

  return root;
}

function sortFolderChildren(node) {
  const entries = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
  entries.forEach((item) => sortFolderChildren(item));
  node.children = entries;
  return node;
}

function renderFolderTree(container, records, selectedFolder, collapsedPaths) {
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const normalizedSelected = normalizeFolder(selectedFolder);
  const tree = sortFolderChildren(buildFolderTree(records));

  const rootRow = document.createElement("div");
  rootRow.className = normalizedSelected ? "folder-tree-row" : "folder-tree-row active";
  const spacer = document.createElement("span");
  spacer.className = "folder-tree-spacer";
  rootRow.appendChild(spacer);
  const rootSelect = document.createElement("button");
  rootSelect.type = "button";
  rootSelect.className = "folder-tree-select";
  rootSelect.dataset.folderPath = "";
  rootSelect.textContent = `Root (${tree.count})`;
  rootRow.appendChild(rootSelect);
  container.appendChild(rootRow);

  const renderNode = (node, depth) => {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const isCollapsed = collapsedPaths.has(node.path);
    const row = document.createElement("div");
    row.className = node.path === normalizedSelected ? "folder-tree-row active" : "folder-tree-row";
    row.style.paddingLeft = `${4 + (depth * 14)}px`;

    if (hasChildren) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "folder-tree-toggle";
      toggle.dataset.togglePath = node.path;
      toggle.textContent = isCollapsed ? "+" : "-";
      row.appendChild(toggle);
    } else {
      const nodeSpacer = document.createElement("span");
      nodeSpacer.className = "folder-tree-spacer";
      row.appendChild(nodeSpacer);
    }

    const select = document.createElement("button");
    select.type = "button";
    select.className = "folder-tree-select";
    select.dataset.folderPath = node.path;
    select.textContent = `${node.name} (${node.count})`;
    row.appendChild(select);
    container.appendChild(row);

    if (!isCollapsed && hasChildren) {
      node.children.forEach((child) => renderNode(child, depth + 1));
    }
  };

  tree.children.forEach((node) => renderNode(node, 0));
}

function renderDocuments(listNode, records, searchText, folderFilter, selectedTags, assignedDocIds, assignmentCounts, selectedDocIds) {
  const assigned = assignedDocIds instanceof Set ? assignedDocIds : new Set();
  const counts = assignmentCounts instanceof Map ? assignmentCounts : new Map();
  const selected = selectedDocIds instanceof Set ? selectedDocIds : new Set();
  const effectiveFolderFilter = typeof folderFilter === "string" ? folderFilter : "";
  const effectiveSelectedTags = Array.isArray(selectedTags) ? selectedTags : [];
  const filtered = filterDocuments(records, searchText, effectiveFolderFilter, effectiveSelectedTags);
  listNode.innerHTML = "";

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "doc-row doc-empty";
    empty.textContent = "No documents in library.";
    listNode.appendChild(empty);
    return;
  }

  filtered.forEach((doc) => {
    const row = document.createElement("div");
    row.className = "doc-row";
    row.dataset.docId = doc.id;

    const meta = document.createElement("span");
    const parseTag = doc.parseStatus === "parsed" ? "ready" : "parse error";
    meta.textContent = `${doc.name} (${bytesLabel(Number(doc.size || 0))}) - ${dateLabel(doc.createdAt)} - ${parseTag}`;

    const info = document.createElement("span");
    info.className = "doc-info";
    info.appendChild(meta);

    const badges = document.createElement("small");
    badges.className = "doc-badges";
    const tagsLabel = normalizeTags(doc.tags).slice(0, 4).join(", ");
    const folderLabel = doc.folder ? `folder:${doc.folder}` : "folder:root";
    badges.textContent = `${buildBadgeText(doc.id, assigned, counts)} | ${folderLabel}${tagsLabel ? ` | tags:${tagsLabel}` : ""}`;
    info.appendChild(badges);

    row.appendChild(info);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "doc-delete";
    remove.textContent = "Delete";

    const assign = document.createElement("button");
    assign.type = "button";
    assign.className = "doc-assign";
    assign.textContent = assigned.has(doc.id) ? "Unassign" : "Assign";

    const selectWrap = document.createElement("label");
    selectWrap.className = "doc-select";
    const selectInput = document.createElement("input");
    selectInput.type = "checkbox";
    selectInput.className = "doc-select-toggle";
    selectInput.dataset.docId = doc.id;
    selectInput.checked = selected.has(doc.id);
    const selectText = document.createElement("span");
    selectText.textContent = "Select";
    selectWrap.appendChild(selectInput);
    selectWrap.appendChild(selectText);

    const actions = document.createElement("span");
    actions.className = "doc-actions";
    actions.appendChild(selectWrap);
    actions.appendChild(assign);
    actions.appendChild(remove);
    row.appendChild(actions);

    listNode.appendChild(row);
  });
}

function renderCharacterDocuments(listNode, records, assignedDocIds) {
  const assigned = assignedDocIds instanceof Set ? assignedDocIds : new Set();
  const assignmentCounts = arguments[3] instanceof Map ? arguments[3] : new Map();
  const assignmentMap = arguments[4] instanceof Map ? arguments[4] : new Map();
  const docs = records.filter((item) => assigned.has(item.id));
  listNode.innerHTML = "";

  if (!docs.length) {
    const empty = document.createElement("div");
    empty.className = "doc-row doc-empty";
    empty.textContent = "No docs assigned to active character.";
    listNode.appendChild(empty);
    return;
  }

  docs.forEach((doc) => {
    const row = document.createElement("div");
    row.className = "doc-row";
    row.dataset.docId = doc.id;

    const info = document.createElement("span");
    info.className = "doc-info";
    const meta = document.createElement("span");
    meta.textContent = `${doc.name} (${bytesLabel(Number(doc.size || 0))})`;
    info.appendChild(meta);

    const badges = document.createElement("small");
    badges.className = "doc-badges";
    const assignment = assignmentMap.get(doc.id);
    const pinned = assignment && assignment.pinnedVersionId ? ` | pinned:${assignment.pinnedVersionId}` : "";
    const tagsLabel = normalizeTags(doc.tags).slice(0, 4).join(", ");
    const folderLabel = doc.folder ? `folder:${doc.folder}` : "folder:root";
    badges.textContent = `${buildBadgeText(doc.id, assigned, assignmentCounts)} | ${folderLabel}${tagsLabel ? ` | tags:${tagsLabel}` : ""}${pinned}`;
    info.appendChild(badges);

    row.appendChild(info);

    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "doc-pin";
    pin.textContent = "Pin Active";
    row.appendChild(pin);

    const unassign = document.createElement("button");
    unassign.type = "button";
    unassign.className = "doc-assign";
    unassign.textContent = "Unassign";
    row.appendChild(unassign);

    listNode.appendChild(row);
  });
}

function renderPreview(previewNode, doc) {
  if (!previewNode) {
    return;
  }
  const heading = previewNode.querySelector("h4");
  const body = previewNode.querySelector("p");
  if (!heading || !body) {
    return;
  }

  if (!doc) {
    heading.textContent = "Extracted Preview";
    body.textContent = "Select a document to preview extracted text.";
    return;
  }

  heading.textContent = `Extracted Preview: ${doc.name}`;
  if (doc.parseStatus !== "parsed") {
    body.textContent = doc.parseError || "Extraction was not successful.";
    return;
  }

  body.textContent = doc.extractedText || "(No extractable text found.)";
}

function renderChunkPreview(previewNode, doc, strategy, tokenSize) {
  const heading = previewNode.querySelector("h4");
  const body = previewNode.querySelector("p");
  if (!heading || !body) {
    return;
  }

  if (!doc) {
    heading.textContent = "Chunk Preview";
    body.textContent = "Select a document to preview chunk boundaries.";
    return;
  }

  heading.textContent = `Chunk Preview: ${doc.name}`;
  if (doc.parseStatus !== "parsed") {
    body.textContent = "Cannot chunk this document until parsing succeeds.";
    return;
  }

  const chunks = buildChunks(doc.extractedText || "", strategy, tokenSize);
  if (!chunks.length) {
    body.textContent = "No chunkable text found.";
    return;
  }

  body.textContent = chunks
    .map((chunk, index) => `[${index + 1}] ${chunk.length} chars | ${previewSnippet(chunk, 160)}`)
    .join("\n\n");
}

function initLibraryUi() {
  const listNode = document.getElementById("docs-library-list");
  const uploadButton = document.getElementById("upload-docs");
  const fileInput = document.getElementById("docs-file-input");
  const searchInput = document.getElementById("doc-search");
  const folderFilterInput = document.getElementById("doc-folder-filter");
  const tagFiltersNode = document.getElementById("doc-tag-filters");
  const folderTreeNode = document.getElementById("doc-folder-tree");
  const dropzone = document.getElementById("upload-dropzone");
  const previewNode = document.getElementById("doc-preview");
  const chunkPreviewNode = document.getElementById("chunk-preview");
  const chunkStrategyNode = document.getElementById("chunk-strategy");
  const tokenSizeNode = document.getElementById("chunk-token-size");
  const preprocessPresetNode = document.getElementById("preprocess-preset");
  const preprocessCustomNode = document.getElementById("preprocess-custom");
  const reprocessButton = document.getElementById("reprocess-doc");
  const reprocessStatusNode = document.getElementById("reprocess-status");
  const uploadVersionButton = document.getElementById("upload-doc-version");
  const versionFileInput = document.getElementById("doc-version-file-input");
  const versionSelect = document.getElementById("doc-version-select");
  const activateVersionButton = document.getElementById("activate-doc-version");
  const docFolderInput = document.getElementById("doc-folder-input");
  const docTagsInput = document.getElementById("doc-tags-input");
  const saveDocMetaButton = document.getElementById("save-doc-meta");
  const bulkDocFolderInput = document.getElementById("bulk-doc-folder-input");
  const bulkDocTagsInput = document.getElementById("bulk-doc-tags-input");
  const bulkDocMode = document.getElementById("bulk-doc-mode");
  const applyBulkDocMetaButton = document.getElementById("apply-bulk-doc-meta");
  const clearBulkDocSelectionButton = document.getElementById("clear-bulk-doc-selection");
  const characterListNode = document.getElementById("character-docs-list");
  if (!listNode || !uploadButton || !fileInput || !searchInput || !folderFilterInput || !tagFiltersNode || !folderTreeNode || !dropzone || !previewNode || !characterListNode || !chunkPreviewNode || !chunkStrategyNode || !tokenSizeNode || !preprocessPresetNode || !preprocessCustomNode || !reprocessButton || !reprocessStatusNode || !uploadVersionButton || !versionFileInput || !versionSelect || !activateVersionButton || !docFolderInput || !docTagsInput || !saveDocMetaButton || !bulkDocFolderInput || !bulkDocTagsInput || !bulkDocMode || !applyBulkDocMetaButton || !clearBulkDocSelectionButton) {
    return;
  }

  let allDocs = [];
  let activeDocId = "";
  let activeCharacterId = "";
  let assignedDocIds = new Set();
  let assignmentCounts = new Map();
  let assignmentMap = new Map();
  let activeVersions = [];
  const savedFilters = readLibraryFilters();
  let selectedTagFilters = new Set(savedFilters.tags);
  searchInput.value = savedFilters.search;
  folderFilterInput.value = savedFilters.folder;
  let selectedDocIds = new Set();
  let collapsedFolderPaths = new Set();
  let filterRenderTimer = null;
  const getActiveDoc = () => allDocs.find((item) => item.id === activeDocId) || null;
  const persistFilters = () => {
    writeLibraryFilters({
      search: searchInput.value,
      folder: folderFilterInput.value,
      tags: Array.from(selectedTagFilters)
    });
  };

  const renderTagFilters = () => {
    const available = Array.from(
      new Set(
        allDocs.flatMap((doc) => normalizeTags(doc.tags))
      )
    ).sort((a, b) => a.localeCompare(b));
    tagFiltersNode.innerHTML = "";
    if (!available.length) {
      return;
    }
    available.forEach((tag) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = selectedTagFilters.has(tag) ? "doc-tag-chip active" : "doc-tag-chip";
      chip.textContent = tag;
      chip.dataset.tag = tag;
      tagFiltersNode.appendChild(chip);
    });
  };

  const renderFilteredDocuments = () => {
    renderDocuments(
      listNode,
      allDocs,
      searchInput.value,
      folderFilterInput.value,
      Array.from(selectedTagFilters),
      assignedDocIds,
      assignmentCounts,
      selectedDocIds
    );
    renderFolderTree(folderTreeNode, allDocs, folderFilterInput.value, collapsedFolderPaths);
  };

  const scheduleFilterRender = () => {
    if (filterRenderTimer) {
      window.clearTimeout(filterRenderTimer);
    }
    filterRenderTimer = window.setTimeout(() => {
      filterRenderTimer = null;
      renderFilteredDocuments();
    }, 120);
  };

  const syncDocMetaEditor = (doc) => {
    if (!doc) {
      docFolderInput.value = "";
      docTagsInput.value = "";
      return;
    }
    docFolderInput.value = doc.folder || "";
    docTagsInput.value = normalizeTags(doc.tags).join(", ");
  };

  const syncPreprocessControls = (doc) => {
    if (!doc) {
      preprocessPresetNode.value = "none";
      preprocessCustomNode.value = "";
      return;
    }
    preprocessPresetNode.value = doc.preprocessPreset || "none";
    preprocessCustomNode.value = doc.preprocessCustom || "";
  };

  const persistPreprocessMetadata = async () => {
    const active = getActiveDoc();
    if (!active) {
      return;
    }
    const updated = await patchDocument(active.id, {
      preprocessPreset: preprocessPresetNode.value || "none",
      preprocessCustom: preprocessCustomNode.value || ""
    });
    if (updated) {
      const index = allDocs.findIndex((item) => item.id === updated.id);
      if (index >= 0) {
        allDocs[index] = updated;
      }
      renderChunkPreview(chunkPreviewNode, updated, chunkStrategyNode.value, Number(tokenSizeNode.value));
    }
  };

  const refresh = async () => {
    allDocs = await listDocuments();
    selectedDocIds = new Set(Array.from(selectedDocIds).filter((docId) => allDocs.some((item) => item.id === docId)));
    const allAssignments = await listAllAssignments();
    assignmentCounts = new Map();
    allAssignments.forEach((item) => {
      const current = assignmentCounts.get(item.docId) || 0;
      assignmentCounts.set(item.docId, current + 1);
    });

    const assignments = await listAssignmentsForCharacter(activeCharacterId);
    assignedDocIds = new Set(assignments.map((item) => item.docId));
    assignmentMap = new Map(assignments.map((item) => [item.docId, item]));
    renderDocuments(
      listNode,
      allDocs,
      searchInput.value,
      folderFilterInput.value,
      Array.from(selectedTagFilters),
      assignedDocIds,
      assignmentCounts,
      selectedDocIds
    );
    renderFolderTree(folderTreeNode, allDocs, folderFilterInput.value, collapsedFolderPaths);
    renderCharacterDocuments(characterListNode, allDocs, assignedDocIds, assignmentCounts, assignmentMap);
    const active = getActiveDoc();
    activeVersions = active ? await listVersionsForDoc(active.id) : [];
    versionSelect.innerHTML = "";
    if (!activeVersions.length) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "No versions yet";
      versionSelect.appendChild(emptyOption);
    } else {
      activeVersions.forEach((version) => {
        const option = document.createElement("option");
        option.value = version.id;
        option.textContent = `${version.id} (${version.chunkCount || 0} chunks)`;
        versionSelect.appendChild(option);
      });
      const selected = active && active.activeVersionId ? active.activeVersionId : activeVersions[0].id;
      versionSelect.value = selected;
    }
    syncPreprocessControls(active);
    syncDocMetaEditor(active);
    renderTagFilters();
    renderPreview(previewNode, active);
    const previewDoc = active
      ? {
          ...active,
          extractedText: preprocessText(
            active.extractedText || "",
            preprocessPresetNode.value || "none",
            preprocessCustomNode.value || ""
          )
        }
      : null;
    renderChunkPreview(chunkPreviewNode, previewDoc, chunkStrategyNode.value, Number(tokenSizeNode.value));
    reprocessStatusNode.textContent = active && active.activeVersionId
      ? `Active version: ${active.activeVersionId}`
      : "";

    const rows = listNode.querySelectorAll("[data-doc-id]");
    rows.forEach((row) => {
      const isActive = row.getAttribute("data-doc-id") === activeDocId;
      row.classList.toggle("is-active", isActive);
    });
  };

  document.addEventListener("character:active-changed", async (event) => {
    const detail = event.detail && event.detail.character ? event.detail.character : null;
    activeCharacterId = detail && detail.id ? detail.id : "";
    await refresh();
  });

  uploadButton.addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    if (!fileInput.files || !fileInput.files.length) {
      return;
    }
    await addDocumentsFromFiles(fileInput.files);
    await refresh();
  });

  listNode.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.classList.contains("doc-select-toggle")) {
      const docId = target.getAttribute("data-doc-id");
      if (!docId) {
        return;
      }
      const input = target;
      if (input instanceof HTMLInputElement && input.checked) {
        selectedDocIds.add(docId);
      } else {
        selectedDocIds.delete(docId);
      }
      return;
    }

    const row = target.closest("[data-doc-id]");
    const rowId = row ? row.getAttribute("data-doc-id") : "";

    if (target.classList.contains("doc-delete")) {
      if (!rowId) {
        return;
      }
      await deleteDocument(rowId);
      if (activeDocId === rowId) {
        activeDocId = "";
      }
      await refresh();
      return;
    }

    if (target.classList.contains("doc-assign")) {
      if (!activeCharacterId || !rowId) {
        return;
      }
      if (assignedDocIds.has(rowId)) {
        await unassignDocumentFromCharacter(activeCharacterId, rowId);
      } else {
        await assignDocumentToCharacter(activeCharacterId, rowId);
      }
      await refresh();
      return;
    }

    if (!rowId) {
      return;
    }

    activeDocId = rowId;
    await refresh();
  });

  searchInput.addEventListener("input", () => {
    persistFilters();
    scheduleFilterRender();
  });

  folderFilterInput.addEventListener("input", () => {
    persistFilters();
    scheduleFilterRender();
  });

  folderTreeNode.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const togglePath = target.getAttribute("data-toggle-path");
    if (togglePath) {
      if (collapsedFolderPaths.has(togglePath)) {
        collapsedFolderPaths.delete(togglePath);
      } else {
        collapsedFolderPaths.add(togglePath);
      }
      renderFolderTree(folderTreeNode, allDocs, folderFilterInput.value, collapsedFolderPaths);
      return;
    }

    const selectPath = target.getAttribute("data-folder-path");
    if (selectPath !== null) {
      folderFilterInput.value = selectPath;
      persistFilters();
      renderFilteredDocuments();
    }
  });

  tagFiltersNode.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const tag = String(target.getAttribute("data-tag") || "").trim().toLowerCase();
    if (!tag) {
      return;
    }
    if (selectedTagFilters.has(tag)) {
      selectedTagFilters.delete(tag);
    } else {
      selectedTagFilters.add(tag);
    }
    persistFilters();
    renderTagFilters();
    scheduleFilterRender();
  });

  saveDocMetaButton.addEventListener("click", async () => {
    const active = getActiveDoc();
    if (!active) {
      reprocessStatusNode.textContent = "Select a document before saving tags/folder.";
      return;
    }
    const updated = await patchDocument(active.id, {
      folder: normalizeFolder(docFolderInput.value),
      tags: normalizeTags(docTagsInput.value)
    });
    if (!updated) {
      reprocessStatusNode.textContent = "Failed to update document metadata.";
      return;
    }
    const index = allDocs.findIndex((item) => item.id === updated.id);
    if (index >= 0) {
      allDocs[index] = updated;
    }
    reprocessStatusNode.textContent = `Saved tags/folder for ${updated.name}.`;
    renderTagFilters();
    renderDocuments(
      listNode,
      allDocs,
      searchInput.value,
      folderFilterInput.value,
      Array.from(selectedTagFilters),
      assignedDocIds,
      assignmentCounts,
      selectedDocIds
    );
    renderFolderTree(folderTreeNode, allDocs, folderFilterInput.value, collapsedFolderPaths);
    renderCharacterDocuments(characterListNode, allDocs, assignedDocIds, assignmentCounts, assignmentMap);
  });

  applyBulkDocMetaButton.addEventListener("click", async () => {
    const docIds = Array.from(selectedDocIds);
    if (!docIds.length) {
      reprocessStatusNode.textContent = "Select one or more docs before bulk update.";
      return;
    }
    const folderValue = normalizeFolder(bulkDocFolderInput.value);
    const incomingTags = normalizeTags(bulkDocTagsInput.value);
    const mode = bulkDocMode.value === "replace" ? "replace" : "append";

    const updates = docIds.map(async (docId) => {
      const doc = allDocs.find((item) => item.id === docId);
      if (!doc) {
        return null;
      }
      const tags = mode === "replace"
        ? incomingTags
        : normalizeTags([...(doc.tags || []), ...incomingTags]);
      const patch = { tags };
      if (folderValue) {
        patch.folder = folderValue;
      }
      return patchDocument(docId, patch);
    });

    await Promise.all(updates);
    reprocessStatusNode.textContent = `Bulk updated ${docIds.length} document(s).`;
    await refresh();
  });

  clearBulkDocSelectionButton.addEventListener("click", () => {
    selectedDocIds = new Set();
    renderDocuments(
      listNode,
      allDocs,
      searchInput.value,
      folderFilterInput.value,
      Array.from(selectedTagFilters),
      assignedDocIds,
      assignmentCounts,
      selectedDocIds
    );
  });

  chunkStrategyNode.addEventListener("change", () => {
    const active = getActiveDoc();
    const previewDoc = active
      ? {
          ...active,
          extractedText: preprocessText(
            active.extractedText || "",
            preprocessPresetNode.value || "none",
            preprocessCustomNode.value || ""
          )
        }
      : null;
    renderChunkPreview(chunkPreviewNode, previewDoc, chunkStrategyNode.value, Number(tokenSizeNode.value));
  });

  tokenSizeNode.addEventListener("input", () => {
    const active = getActiveDoc();
    const previewDoc = active
      ? {
          ...active,
          extractedText: preprocessText(
            active.extractedText || "",
            preprocessPresetNode.value || "none",
            preprocessCustomNode.value || ""
          )
        }
      : null;
    renderChunkPreview(chunkPreviewNode, previewDoc, chunkStrategyNode.value, Number(tokenSizeNode.value));
  });

  preprocessPresetNode.addEventListener("change", () => {
    persistPreprocessMetadata().catch((error) => {
      console.error("Failed to save preprocess preset:", error);
    });
  });

  preprocessCustomNode.addEventListener("change", () => {
    persistPreprocessMetadata().catch((error) => {
      console.error("Failed to save preprocess instructions:", error);
    });
  });

  reprocessButton.addEventListener("click", async () => {
    const active = getActiveDoc();
    if (!active) {
      reprocessStatusNode.textContent = "Select a document before reprocessing.";
      return;
    }
    if (active.parseStatus !== "parsed") {
      reprocessStatusNode.textContent = "Cannot reprocess: parsing failed for this document.";
      return;
    }

    const result = await reprocessDocument(active, {
      strategy: chunkStrategyNode.value,
      tokenSize: Number(tokenSizeNode.value),
      preset: preprocessPresetNode.value || "none",
      custom: preprocessCustomNode.value || ""
    });
    reprocessStatusNode.textContent = `Reprocessed ${result.chunkCount} chunks. Active version: ${result.versionId}`;
    await refresh();
  });

  uploadVersionButton.addEventListener("click", () => {
    versionFileInput.value = "";
    versionFileInput.click();
  });

  versionFileInput.addEventListener("change", async () => {
    const active = getActiveDoc();
    const file = versionFileInput.files && versionFileInput.files[0];
    if (!active || !file) {
      return;
    }
    try {
      const result = await uploadDocumentVersion(active, file);
      reprocessStatusNode.textContent = `Uploaded new version ${result.versionId} (${result.chunkCount} chunks).`;
      await refresh();
    } catch (error) {
      reprocessStatusNode.textContent = `Version upload failed: ${error.message || "unknown error"}`;
    }
  });

  activateVersionButton.addEventListener("click", async () => {
    const active = getActiveDoc();
    const versionId = versionSelect.value;
    if (!active || !versionId) {
      return;
    }
    const version = await setActiveVersionForDoc(active.id, versionId);
    if (version) {
      reprocessStatusNode.textContent = `Active version switched to ${version.id}.`;
      await refresh();
    }
  });

  dropzone.addEventListener("click", () => uploadButton.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      uploadButton.click();
    }
  });

  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
  });

  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    const files = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : null;
    if (!files || !files.length) {
      return;
    }
    await addDocumentsFromFiles(files);
    await refresh();
  });

  characterListNode.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const row = target.closest("[data-doc-id]");
    const rowId = row ? row.getAttribute("data-doc-id") : "";
    if (!activeCharacterId || !rowId) {
      return;
    }

    if (target.classList.contains("doc-assign")) {
      await unassignDocumentFromCharacter(activeCharacterId, rowId);
      await refresh();
      return;
    }

    if (target.classList.contains("doc-pin")) {
      const active = getActiveDoc();
      const versionId = active ? active.activeVersionId || "" : "";
      await pinAssociationVersion(activeCharacterId, rowId, versionId);
      await refresh();
    }
  });

  refresh().catch((error) => {
    console.error("Failed to load document library:", error);
  });
}

export async function exportDocumentMetadata() {
  const db = await openDocumentsDb();
  const transaction = db.transaction(["docs"], "readonly");
  const store = transaction.objectStore("docs");
  const records = await requestToPromise(store.getAll());
  return (Array.isArray(records) ? records : []).map((item) => ({
    id: item.id,
    name: item.name,
    size: Number(item.size || 0),
    mimeType: String(item.mimeType || ""),
    docType: String(item.docType || ""),
    extractedText: String(item.extractedText || ""),
    preprocessPreset: String(item.preprocessPreset || "none"),
    preprocessCustom: String(item.preprocessCustom || ""),
    processedText: String(item.processedText || ""),
    tags: normalizeTags(item.tags),
    folder: normalizeFolder(item.folder),
    activeVersionId: String(item.activeVersionId || ""),
    lastChunkStrategy: String(item.lastChunkStrategy || "paragraph"),
    lastTokenSize: Number(item.lastTokenSize || 120),
    parseStatus: String(item.parseStatus || ""),
    parseError: String(item.parseError || ""),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
}

export async function exportDocumentState() {
  const db = await openDocumentsDb();
  const transaction = db.transaction(["docs", "versions", "chunks", "associations"], "readonly");
  const docs = await requestToPromise(transaction.objectStore("docs").getAll());
  const versions = await requestToPromise(transaction.objectStore("versions").getAll());
  const chunks = await requestToPromise(transaction.objectStore("chunks").getAll());
  const associations = await requestToPromise(transaction.objectStore("associations").getAll());
  return {
    docs: Array.isArray(docs) ? docs : [],
    versions: Array.isArray(versions) ? versions : [],
    chunks: Array.isArray(chunks) ? chunks : [],
    associations: Array.isArray(associations) ? associations : []
  };
}

export async function importDocumentMetadata(metadata) {
  const db = await openDocumentsDb();
  const isStateObject = metadata && typeof metadata === "object" && !Array.isArray(metadata);
  const docs = isStateObject ? (Array.isArray(metadata.docs) ? metadata.docs : []) : (Array.isArray(metadata) ? metadata : []);
  const versions = isStateObject ? (Array.isArray(metadata.versions) ? metadata.versions : []) : [];
  const chunks = isStateObject ? (Array.isArray(metadata.chunks) ? metadata.chunks : []) : [];
  const associations = isStateObject ? (Array.isArray(metadata.associations) ? metadata.associations : []) : [];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["docs", "versions", "chunks", "associations"], "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Failed to import document metadata."));

    const assocStore = transaction.objectStore("associations");
    const chunkStore = transaction.objectStore("chunks");
    const versionStore = transaction.objectStore("versions");
    assocStore.clear();
    chunkStore.clear();
    versionStore.clear();

    const docsStore = transaction.objectStore("docs");
    docsStore.clear();

    docs.forEach((item) => {
      if (!item || !item.id) {
        return;
      }
      docsStore.put(normalizeDocumentRecord(item));
    });

    versions.forEach((item) => {
      if (!item || !item.id) {
        return;
      }
      versionStore.put(item);
    });

    chunks.forEach((item) => {
      if (!item || !item.id) {
        return;
      }
      chunkStore.put(item);
    });

    associations.forEach((item) => {
      if (!item || !item.id) {
        return;
      }
      assocStore.put(item);
    });
  });
}

export async function getCharacterDocumentContext(characterId) {
  if (!characterId) {
    return [];
  }
  const db = await openDocumentsDb();
  const transaction = db.transaction(["associations", "docs"], "readonly");
  const assocStore = transaction.objectStore("associations");
  const assocIndex = assocStore.index("by_character_id");
  const docsStore = transaction.objectStore("docs");
  const assignments = await requestToPromise(assocIndex.getAll(characterId));
  const list = Array.isArray(assignments) ? assignments : [];

  const contexts = await Promise.all(
    list.map(async (assignment) => {
      const doc = await requestToPromise(docsStore.get(assignment.docId));
      if (!doc) {
        return null;
      }
      return {
        id: doc.id,
        name: doc.name,
        tags: normalizeTags(doc.tags),
        folder: normalizeFolder(doc.folder),
        pinnedVersionId: assignment.pinnedVersionId || "",
        activeVersionId: doc.activeVersionId || ""
      };
    })
  );

  return contexts.filter(Boolean);
}

function trimForPrompt(text, limit) {
  const value = String(text || "").trim();
  if (!value) {
    return "";
  }
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}...`;
}

function estimateTokenCount(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0, Math.round(words * 1.3));
}

function buildQueryTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3)
    .slice(0, 24);
}

function relevanceScore(doc, sourceText, terms) {
  if (!terms.length) {
    return 0;
  }
  const haystacks = [
    String(doc && doc.name ? doc.name : "").toLowerCase(),
    String(doc && doc.folder ? doc.folder : "").toLowerCase(),
    normalizeTags(doc && doc.tags).join(" "),
    String(sourceText || "").toLowerCase().slice(0, 2400)
  ];
  let score = 0;
  terms.forEach((term) => {
    if (haystacks.some((value) => value.includes(term))) {
      score += 1;
    }
  });
  return score;
}

function reportDocTelemetry(telemetry, name, value) {
  if (!telemetry || typeof telemetry.onMetric !== "function") {
    return;
  }
  telemetry.onMetric(String(name || "metric"), Number(value || 0));
}

async function rankContextEntriesWithWorker(entries, queryTerms, telemetry) {
  if (!("Worker" in window) || !Array.isArray(entries) || entries.length < 6) {
    return null;
  }

  const candidates = entries.map((entry) => ({
    name: String(entry.doc && entry.doc.name ? entry.doc.name : ""),
    folder: String(entry.doc && entry.doc.folder ? entry.doc.folder : ""),
    tags: normalizeTags(entry.doc && entry.doc.tags),
    sourceSnippet: String(entry.sourceText || "").slice(0, 2400),
    recencyStamp: Number(entry.recencyStamp || 0),
    pinned: Boolean(entry.assignment && entry.assignment.pinnedVersionId)
  }));

  let worker = null;
  try {
    worker = new Worker(new URL("./doc-scoring-worker.js", import.meta.url), { type: "module" });
  } catch (error) {
    console.warn("Document scoring worker unavailable, using main thread scoring:", error);
    return null;
  }

  return new Promise((resolve) => {
    const startedAt = performance.now();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      const elapsedMs = performance.now() - startedAt;
      reportDocTelemetry(telemetry, "doc_rank_worker_timeout_ms", elapsedMs);
      worker.terminate();
      resolve(null);
    }, DOC_SCORING_WORKER_TIMEOUT_MS);

    worker.onmessage = (event) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      const ranked = event && event.data && Array.isArray(event.data.ranked) ? event.data.ranked : [];
      const elapsedMs = performance.now() - startedAt;
      reportDocTelemetry(telemetry, "doc_rank_worker_ms", elapsedMs);
      worker.terminate();
      resolve({
        ranked,
        mode: "worker",
        elapsedMs
      });
    };

    worker.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      const elapsedMs = performance.now() - startedAt;
      reportDocTelemetry(telemetry, "doc_rank_worker_error_ms", elapsedMs);
      worker.terminate();
      resolve(null);
    };

    worker.postMessage({
      terms: Array.isArray(queryTerms) ? queryTerms : [],
      candidates
    });
  });
}

async function rankContextEntries(entries, queryTerms, telemetry) {
  reportDocTelemetry(telemetry, "doc_rank_candidate_count", Array.isArray(entries) ? entries.length : 0);
  const workerResult = await rankContextEntriesWithWorker(entries, queryTerms, telemetry);
  const workerRanked = workerResult && Array.isArray(workerResult.ranked) ? workerResult.ranked : [];
  if (workerRanked.length) {
    return {
      entries: workerRanked
        .map((item) => {
        const index = Number(item && item.index);
        if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
          return null;
        }
        return {
          ...entries[index],
          score: Number(item && item.score ? item.score : 0)
        };
      })
        .filter(Boolean),
      rankMode: "worker",
      rankElapsedMs: Number(workerResult.elapsedMs || 0)
    };
  }

  const startedAt = performance.now();
  const ranked = entries
    .map((entry) => {
      const pinnedBoost = entry.assignment.pinnedVersionId ? 100 : 0;
      const relevance = relevanceScore(entry.doc, entry.sourceText, queryTerms);
      return {
        ...entry,
        score: pinnedBoost + relevance
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.recencyStamp !== a.recencyStamp) {
        return b.recencyStamp - a.recencyStamp;
      }
      return String(a.doc.name || "").localeCompare(String(b.doc.name || ""));
    });
  const elapsedMs = performance.now() - startedAt;
  reportDocTelemetry(telemetry, "doc_rank_main_ms", elapsedMs);
  return {
    entries: ranked,
    rankMode: "main",
    rankElapsedMs: elapsedMs
  };
}

function summarizeFallback(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return "";
  }
  const sentences = raw.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (!sentences.length) {
    return trimForPrompt(raw, 420);
  }
  return trimForPrompt(sentences.slice(0, 2).join(" "), 420);
}

export async function getCharacterPromptContextBundle(characterId, options) {
  if (!characterId) {
    return {
      text: "",
      usage: {
        budgetTokens: 0,
        reserveTokens: 0,
        usedTokens: 0,
        remainingTokens: 0,
        docs: []
      }
    };
  }

  const tokenBudget = Number.isFinite(options && options.tokenBudget)
    ? Math.max(600, Math.floor(options.tokenBudget))
    : 4096;
  const reserveTokens = Number.isFinite(options && options.reserveTokens)
    ? Math.max(300, Math.floor(options.reserveTokens))
    : 300;
  const usableTokens = Math.max(200, tokenBudget - reserveTokens);
  const telemetry = options && typeof options.telemetry === "object" ? options.telemetry : null;
  const queryTerms = buildQueryTerms(options && options.query ? options.query : "");
  const db = await openDocumentsDb();
  const transaction = db.transaction(["associations", "docs", "versions"], "readonly");
  const assocStore = transaction.objectStore("associations");
  const assocIndex = assocStore.index("by_character_id");
  const docsStore = transaction.objectStore("docs");
  const versionsStore = transaction.objectStore("versions");
  const assignments = await requestToPromise(assocIndex.getAll(characterId));
  const rows = Array.isArray(assignments) ? assignments : [];

  const entries = [];
  for (const assignment of rows) {
    const doc = await requestToPromise(docsStore.get(assignment.docId));
    if (!doc) {
      continue;
    }

    let sourceText = "";
    const preferredVersionId = assignment.pinnedVersionId || doc.activeVersionId || "";
    if (preferredVersionId) {
      const version = await requestToPromise(versionsStore.get(preferredVersionId));
      sourceText = version && version.textSnapshot ? String(version.textSnapshot) : "";
    }
    if (!sourceText) {
      sourceText = String(doc.processedText || doc.extractedText || "");
    }
    if (!String(sourceText || "").trim()) {
      continue;
    }
    const recencyStamp = Date.parse(String(doc.updatedAt || doc.createdAt || "")) || 0;
    entries.push({
      doc,
      assignment,
      sourceText: String(sourceText || ""),
      recencyStamp
    });
  }

  const rankResult = await rankContextEntries(entries, queryTerms, telemetry);
  const rankedEntries = Array.isArray(rankResult && rankResult.entries) ? rankResult.entries : [];
  if (rankResult && rankResult.rankMode) {
    reportDocTelemetry(telemetry, "doc_rank_elapsed_ms", Number(rankResult.rankElapsedMs || 0));
  }

  const sections = [];
  const docUsages = [];
  let usedTokens = 0;

  for (const entry of rankedEntries) {
    const header = `Document: ${entry.doc.name}`;
    const headerTokens = estimateTokenCount(header) + 1;
    const remainingBefore = usableTokens - usedTokens;
    if (remainingBefore <= headerTokens + 24) {
      break;
    }

    const perDocBudget = Math.max(
      40,
      Math.min(
        Math.floor(usableTokens * 0.45),
        Math.floor((remainingBefore - headerTokens) * 0.9)
      )
    );
    const fullText = String(entry.sourceText || "");
    const fullTokens = estimateTokenCount(fullText);
    let method = "full";
    let selected = fullText;

    if (fullTokens > perDocBudget) {
      const approxChars = Math.max(160, perDocBudget * 4);
      selected = trimForPrompt(fullText, approxChars);
      method = "truncated";
      const truncatedTokens = estimateTokenCount(selected);
      if (truncatedTokens > perDocBudget) {
        selected = summarizeFallback(fullText);
        method = "summary";
      }
    }

    if (!selected) {
      continue;
    }

    const section = `${header}\n${selected}`;
    const sectionTokens = estimateTokenCount(section);
    if (usedTokens + sectionTokens > usableTokens) {
      const fallback = summarizeFallback(fullText);
      if (!fallback) {
        continue;
      }
      const fallbackSection = `${header}\n${fallback}`;
      const fallbackTokens = estimateTokenCount(fallbackSection);
      if (usedTokens + fallbackTokens > usableTokens) {
        continue;
      }
      sections.push(fallbackSection);
      usedTokens += fallbackTokens;
      docUsages.push({
        id: entry.doc.id,
        name: entry.doc.name,
        method: "summary",
        usedTokens: fallbackTokens,
        pinned: Boolean(entry.assignment.pinnedVersionId),
        score: entry.score
      });
      continue;
    }

    sections.push(section);
    usedTokens += sectionTokens;
    docUsages.push({
      id: entry.doc.id,
      name: entry.doc.name,
      method,
      usedTokens: sectionTokens,
      pinned: Boolean(entry.assignment.pinnedVersionId),
      score: entry.score
    });
  }

  return {
    text: sections.join("\n\n---\n\n"),
    usage: {
      budgetTokens: tokenBudget,
      reserveTokens,
      usedTokens,
      remainingTokens: Math.max(0, usableTokens - usedTokens),
      docs: docUsages
    }
  };
}

export async function getCharacterPromptContext(characterId, maxChars) {
  const max = Number.isFinite(maxChars) ? Math.max(1000, Math.floor(maxChars)) : 7000;
  const bundle = await getCharacterPromptContextBundle(characterId, {
    tokenBudget: Math.max(1500, Math.floor(max / 4) + 300),
    reserveTokens: 300
  });
  return trimForPrompt(bundle.text, max);
}

export function initDocuments() {
  openDocumentsDb()
    .then(() => initLibraryUi())
    .catch((error) => {
      console.error("Documents DB initialization failed:", error);
    });
  return null;
}
