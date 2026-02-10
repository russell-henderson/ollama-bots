# Ollama Character UI

## Run

Open `index.html` in a browser.

## Included Features

- Multi-character management with CRUD, settings, and per-character chat isolation
- Ollama connectivity, model selection, streaming chat, and branch-based conversation management
- Document library with upload/search/delete, parsing (`.txt`, `.md`, `.pdf`, `.docx`), assignment, chunking, preprocessing, and versioning
- Workspace export/import and character package export/import flows
- Ask-all selected characters with side-by-side responses

## Keyboard Shortcuts

- `Ctrl+L`: focus chat input
- `Ctrl+Shift+N`: create new branch
- `Ctrl+K`: quick character switcher
- `Ctrl+Enter`: send current prompt

## Notes

- PDF/DOCX parsing uses runtime CDN module imports (PDF.js and Mammoth).
- Ollama endpoint is expected at `http://localhost:11434`.
