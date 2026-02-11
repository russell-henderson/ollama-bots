# Ollama Character UI

Local-first multi-character workspace for Ollama with document-aware chat, branching, analytics, and export/import.

## Quick Start

1. Start Ollama on `http://localhost:11434`.
2. Open `index.html` in a browser.
3. Select a character, pick a model from the chat header dropdown, and send a message.

## Core Capabilities

- Character system: create/edit/clone/delete, per-character model and generation settings.
- Chat system: streaming, stop/abort, branch workflows, templates, auto-naming, drafts.
- Status indicator: receiving/thinking/resources/responding with reduced-motion fallback.
- Documents: upload/search/filter/tags/folders, assignment, chunking, reprocess, versions, pinning.
- Context intelligence: budgeted context builder with relevance ranking and worker offload.
- Productivity: command palette, conversation search, ratings, annotations, prompt chains.
- Portability: character and workspace export/import, advanced export (Markdown/HTML/PDF).
- Performance: capped chat rendering, debounced filters, telemetry, perf threshold test scaffold.

## Model Selection

- Primary control is in chat header: `#quick-model-select`.
- Character settings also expose model selection (`#settings-model`).
- The selected model is stored per character and used for generation.
- See `MODEL_WIRING.md` for force-include list, ordering, and troubleshooting.

## Keyboard Shortcuts

- `Ctrl+L`: focus chat input
- `Ctrl+Shift+N`: create new branch
- `Ctrl+K`: open command palette
- `Ctrl+Shift+F`: open conversation search
- `Ctrl+Enter`: send current prompt
- `Esc`: close mobile side drawers (on narrow screens)

## Documentation Map

- `UPGRADES_TODO.md`: execution board and release gates.
- `UI_RESTRUCTURE.md`: implemented UI phase status and file mapping.
- `MODEL_WIRING.md`: model pipeline, allowlist/order, and UI sync behavior.
- `STATUS.md`: current implementation snapshot and remaining work.
- `INDICATORS.md`: status-indicator specification and integration points.
- `PRESENTATION.md`: demo-oriented product summary.
- `CHANGELOG.md`: dated record of major shipped changes.

## Notes

- PDF/DOCX parsing uses runtime CDN imports (`pdfjs-dist`, `mammoth`).
- Local persistence uses `localStorage` + `IndexedDB`.
