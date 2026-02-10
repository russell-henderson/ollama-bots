const DOCUMENT_DB_NAME = "ollama.documents.db";
const DOCUMENT_DB_VERSION = 1;

let documentDb = null;
let dbOpenPromise = null;
let pdfjsLibPromise = null;
let mammothPromise = null;

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
  return Array.isArray(records) ? records : [];
}

async function getDocumentById(docId) {
  const db = await openDocumentsDb();
  const transaction = db.transaction(["docs"], "readonly");
  const store = transaction.objectStore("docs");
  const doc = await requestToPromise(store.get(docId));
  return doc || null;
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
    updatedAt: new Date().toISOString()
  };
  store.put(merged);
  await transactionDone(transaction);
  return merged;
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

function filterDocuments(records, query) {
  const term = String(query || "").trim().toLowerCase();
  const sorted = [...records].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  if (!term) {
    return sorted;
  }
  return sorted.filter((item) => String(item.name || "").toLowerCase().includes(term));
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

function renderDocuments(listNode, records, searchText) {
  const assignedDocIds = arguments[3] instanceof Set ? arguments[3] : new Set();
  const assignmentCounts = arguments[4] instanceof Map ? arguments[4] : new Map();
  const filtered = filterDocuments(records, searchText);
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
    badges.textContent = buildBadgeText(doc.id, assignedDocIds, assignmentCounts);
    info.appendChild(badges);

    row.appendChild(info);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "doc-delete";
    remove.textContent = "Delete";

    const assign = document.createElement("button");
    assign.type = "button";
    assign.className = "doc-assign";
    assign.textContent = assignedDocIds.has(doc.id) ? "Unassign" : "Assign";

    const actions = document.createElement("span");
    actions.className = "doc-actions";
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
    badges.textContent = `${buildBadgeText(doc.id, assigned, assignmentCounts)}${pinned}`;
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
  const characterListNode = document.getElementById("character-docs-list");
  if (!listNode || !uploadButton || !fileInput || !searchInput || !dropzone || !previewNode || !characterListNode || !chunkPreviewNode || !chunkStrategyNode || !tokenSizeNode || !preprocessPresetNode || !preprocessCustomNode || !reprocessButton || !reprocessStatusNode || !uploadVersionButton || !versionFileInput || !versionSelect || !activateVersionButton) {
    return;
  }

  let allDocs = [];
  let activeDocId = "";
  let activeCharacterId = "";
  let assignedDocIds = new Set();
  let assignmentCounts = new Map();
  let assignmentMap = new Map();
  let activeVersions = [];
  const getActiveDoc = () => allDocs.find((item) => item.id === activeDocId) || null;

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
    const allAssignments = await listAllAssignments();
    assignmentCounts = new Map();
    allAssignments.forEach((item) => {
      const current = assignmentCounts.get(item.docId) || 0;
      assignmentCounts.set(item.docId, current + 1);
    });

    const assignments = await listAssignmentsForCharacter(activeCharacterId);
    assignedDocIds = new Set(assignments.map((item) => item.docId));
    assignmentMap = new Map(assignments.map((item) => [item.docId, item]));
    renderDocuments(listNode, allDocs, searchInput.value, assignedDocIds, assignmentCounts);
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
    renderDocuments(listNode, allDocs, searchInput.value, assignedDocIds, assignmentCounts);
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
      docsStore.put(item);
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

export async function getCharacterPromptContext(characterId, maxChars) {
  if (!characterId) {
    return "";
  }

  const perDocLimit = 1600;
  const totalLimit = Number.isFinite(maxChars) ? Math.max(1000, Math.floor(maxChars)) : 7000;
  const db = await openDocumentsDb();
  const transaction = db.transaction(["associations", "docs", "versions"], "readonly");
  const assocStore = transaction.objectStore("associations");
  const assocIndex = assocStore.index("by_character_id");
  const docsStore = transaction.objectStore("docs");
  const versionsStore = transaction.objectStore("versions");
  const assignments = await requestToPromise(assocIndex.getAll(characterId));
  const rows = Array.isArray(assignments) ? assignments : [];

  const sections = [];
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
    const snippet = trimForPrompt(sourceText, perDocLimit);
    if (!snippet) {
      continue;
    }
    sections.push(`Document: ${doc.name}\n${snippet}`);
  }

  const joined = sections.join("\n\n---\n\n");
  return trimForPrompt(joined, totalLimit);
}

export function initDocuments() {
  openDocumentsDb()
    .then(() => initLibraryUi())
    .catch((error) => {
      console.error("Documents DB initialization failed:", error);
    });
  return null;
}
