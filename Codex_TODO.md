# Ollama Character UI - Concrete Task Board

Status legend: `[ ]` not started, `[/]` in progress, `[x]` done

## Sprint 0 - Project Setup (P0)

Goal: runnable local app shell with clear module boundaries.

- [x] Create base structure
  - Deliverable: `index.html`, `css/styles.css`, `js/app.js`, `js/ollama.js`, `js/characters.js`, `js/documents.js`, `js/storage.js`, `README.md`
  - DoD: app opens in browser with no JS errors.
- [x] Build 3-panel layout to match reference UI
  - Deliverable: left characters panel, center chat panel, right docs/actions panel.
  - DoD: desktop layout stable and visually aligned to `image_of_ui.png`.
- [x] Establish theme tokens and reusable components
  - Deliverable: CSS variables (background, card, text, accent, border, radius, spacing).
  - DoD: no hardcoded ad-hoc colors in component blocks.

## Sprint 1 - Ollama Chat Core (P0)

Goal: chat with local Ollama model, streaming responses.

- [x] Ollama connectivity service
  - Deliverable: health check + model list from `http://localhost:11434`.
  - DoD: UI shows connection state and graceful error when unavailable.
- [x] Model discovery + selection
  - Deliverable: dropdown with available models (name + metadata where available).
  - DoD: selecting model changes target for next generation.
- [x] Streaming chat implementation
  - Deliverable: incremental assistant message rendering while tokens stream.
  - DoD: user can send prompt and watch streamed response complete successfully.
- [x] Chat UX basics
  - Deliverable: enter-to-send, send button, loading state, auto-scroll.
  - DoD: no duplicate sends; message order preserved.

## Sprint 2 - Character Management (P0)

Goal: independent characters with isolated settings and history.

- [x] Character CRUD
  - Deliverable: create, edit, delete, clone character.
  - DoD: all actions reflected immediately in left panel.
- [x] Character settings form
  - Deliverable: name, system prompt, model, temperature, top-p, top-k, max tokens, context window.
  - DoD: values validate and persist.
- [x] Per-character chat history isolation
  - Deliverable: switching characters swaps active thread/history.
  - DoD: no message leakage between characters.

## Sprint 3 - Persistence Layer (P0)

Goal: state survives reloads.

- [x] Local storage schema for app state
  - Deliverable: versioned keys for characters, settings, conversations.
  - DoD: reload restores selected character and recent histories.
- [x] IndexedDB setup for documents/processed chunks
  - Deliverable: object stores for docs, versions, chunks, associations.
  - DoD: DB initializes with migration/version handling.
- [x] Export/import workspace (baseline)
  - Deliverable: JSON export/import for characters + conversations + doc metadata.
  - DoD: imported workspace reproduces expected state.

## Sprint 4 - Document Library + Assignment (P0)

Goal: central docs + character-specific doc assignment.

- [x] Global library UI
  - Deliverable: upload zone, list with filename/date/size, delete, search by name.
  - DoD: files appear immediately and persist.
- [x] Supported parsing pipeline
  - Deliverable: `.txt`, `.md`, `.pdf`, `.docx` extraction.
  - DoD: extracted text preview available for each uploaded doc.
- [x] Character document assignment
  - Deliverable: assign/unassign central docs to active character.
  - DoD: assignment changes do not delete source files.
- [x] Source/type indicators
  - Deliverable: badges for shared, character-exclusive, active.
  - DoD: indicators update correctly on toggle/assignment.

## Sprint 5 - Context Injection + Preprocessing (P1)

Goal: control how docs are transformed and injected into prompts.

- [x] Chunking strategies
  - Deliverable: paragraph, token-count, section/heading, whole-document.
  - DoD: preview shows deterministic chunk boundaries.
- [x] Per-document preprocessing instructions
  - Deliverable: presets + custom instruction text.
  - DoD: instruction metadata stored and reapplied on reprocess.
- [x] Reprocess without reupload
  - Deliverable: one-click reprocess with changed strategy/options.
  - DoD: new chunk set replaces active set while retaining version history.
- [x] Versioning support
  - Deliverable: upload new doc version, retain old versions, switch active version.
  - DoD: character can pin a specific version.

## Sprint 6 - Conversation Management (P1)

Goal: advanced workflows per character.

- [x] Branching
  - Deliverable: create branch from checkpoint, switch branches.
  - DoD: parent and child branches remain independent.
- [x] Templates/starters
  - Deliverable: save per-character/global starter prompts.
  - DoD: one-click start creates new conversation with starter applied.
- [x] Reset and undo
  - Deliverable: reset-to-system-prompt, undo last user+assistant pair.
  - DoD: operations are reversible where appropriate and do not corrupt history.
- [x] Conversation labeling
  - Deliverable: rename conversations for quick navigation.
  - DoD: labels persist and appear in lists/search.

## Sprint 7 - Quick Actions + Multi-Character (P1)

Goal: compare behaviors across characters/models.

- [x] Ask all selected characters
  - Deliverable: send one prompt to multiple characters and display responses side-by-side/tabs.
  - DoD: each response uses that character's own config and docs.
- [x] Duplicate conversation to another character
  - Deliverable: copy history and continue with different model/persona.
  - DoD: source conversation remains unchanged.
- [x] Character export/import package
  - Deliverable: export one character with optional chats/docs; import with merge/replace flow.
  - DoD: dependency conflicts are surfaced and handled.

## Sprint 8 - Multi-Window Chat + UX Hardening (P2)

Goal: productivity and reliability improvements.

- [x] Pin side chats
  - Deliverable: up to 2-3 concurrent chat panes.
  - DoD: each pane preserves independent context.
- [x] Keyboard shortcuts
  - Deliverable: quick switcher, new conversation, focus input, send.
  - DoD: shortcuts documented and conflict-safe.
- [x] Resilience and observability
  - Deliverable: retry patterns, timeout handling, basic latency/tokens telemetry.
  - DoD: failures are actionable and do not break app state.
- [x] Responsive pass
  - Deliverable: desktop-first + tablet support.
  - DoD: no blocking layout breakpoints on common tablet widths.

## Cross-Cutting Test Checklist

- [x] Ollama disconnected behavior tested
- [x] At least 3-4 models tested
- [x] Persistence tested via reload/reopen
- [x] Document assignment persistence tested
- [x] Streaming and cancel/interrupt behavior tested
- [x] Large doc upload tested (performance baseline)
- [x] Export/import round-trip verified

## Milestone Gates

- [x] **Gate A (MVP):** Sprints 0-4 complete
  - Result: multi-character chat + docs assign/persist + Ollama streaming works.
- [x] **Gate B (Advanced Core):** Sprints 5-7 complete
  - Result: preprocessing/versioning + branching + ask-all + portability complete.
- [x] **Gate C (Polish):** Sprint 8 complete
  - Result: multi-chat panes + shortcuts + resilience + responsive hardening.

## Immediate Next Actions

- [x] Implement Sprint 0 task 1 (scaffold files)
- [x] Implement Sprint 0 task 2 (3-panel layout)
- [x] Implement Sprint 0 task 3 (theme tokens + reusable component styling)
- [x] Implement Sprint 1 task 1 (Ollama connectivity + model list)
- [x] Implement Sprint 1 task 2 (model discovery + selection UI)
- [x] Implement Sprint 1 task 3 (streaming chat implementation)
- [x] Implement Sprint 1 task 4 (chat UX basics)
- [x] Implement Sprint 2 task 1 (character CRUD)
- [x] Implement Sprint 2 task 2 (character settings form)
- [x] Implement Sprint 2 task 3 (per-character chat history isolation)
- [x] Implement Sprint 3 task 1 (local storage schema for app state)
- [x] Implement Sprint 3 task 2 (IndexedDB setup for documents/chunks)
- [x] Implement Sprint 3 task 3 (export/import workspace baseline)
- [x] Implement Sprint 4 task 1 (global document library UI)
- [x] Implement Sprint 4 task 2 (supported parsing pipeline)
- [x] Implement Sprint 4 task 3 (character document assignment)
- [x] Implement Sprint 4 task 4 (source/type indicators)
- [x] Implement Sprint 5 task 1 (chunking strategies)
- [x] Implement Sprint 5 task 2 (per-document preprocessing instructions)
- [x] Implement Sprint 5 task 3 (reprocess without reupload)
- [x] Implement Sprint 5 task 4 (versioning support)
- [x] Implement Sprint 6 task 1 (conversation branching)
- [x] Implement Sprint 6 task 2 (templates/starters)
- [x] Implement Sprint 6 task 3 (reset and undo)
- [x] Implement Sprint 6 task 4 (conversation labeling)
- [x] Implement Sprint 7 task 1 (ask all selected characters)
- [x] Implement Sprint 7 task 2 (duplicate conversation to another character)
- [x] Implement Sprint 7 task 3 (character export/import package)
- [x] Implement Sprint 8 task 1 (pin side chats)
- [x] Implement Sprint 8 task 2 (keyboard shortcuts)
- [x] Implement Sprint 8 task 3 (resilience and observability)
- [x] Implement Sprint 8 task 4 (responsive pass)
