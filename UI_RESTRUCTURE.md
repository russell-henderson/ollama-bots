# UI Restructure Status

This file tracks what shipped from the UI restructuring plan.

## Summary

All five UI phases are now implemented in the current app:

- Phase 1: Header removal + model/status relocation
- Phase 2: Collapsible analytics/context panels
- Phase 3: Compact character groups/cards
- Phase 4: Documents panel organization + progressive disclosure
- Phase 5: Mobile drawer behavior for side panels

## Implemented Mapping

### Phase 1

- Removed global top header from `index.html`.
- Added sidebar compact status footer:
  - `#ollama-connection-state`
  - `#ollama-model-summary`
- Added/kept character-level model selection in settings (`#settings-model`).
- Added chat-header model picker (`#quick-model-select`) with size badge.

### Phase 2

- Added header pills:
  - `#analytics-toggle`, `#analytics-badge`
  - `#context-toggle`, `#context-badge`
- Added collapsible wrappers:
  - `#analytics-panel`
  - `#context-panel`
- Wired toggle state and badge updates in `js/app.js`.

### Phase 3

- Implemented collapsible character groups with persisted collapse state.
- Compact card spacing and group headers.
- Auto-expand active character group on switch.

### Phase 4

- Converted docs pane to tabs:
  - `#docs-tab-btn` + `#docs-tab`
  - `#quick-actions-tab-btn` + `#quick-actions-tab`
- Moved quick actions to dedicated tab.
- Added progressive disclosure for preview/chunk controls with `<details>`.

### Phase 5

- Added mobile side drawer controls:
  - `#open-characters-panel`
  - `#open-docs-panel`
  - `#mobile-drawer-backdrop`
- Added drawer open/close logic and `Esc` close path.

## Notes

- The original proposal suggested a modal-only doc preview; current implementation uses an in-panel collapsed disclosure to preserve existing workflows with less risk.
- Desktop remains 3-panel; mobile behavior is drawer-based.

## Verification

```powershell
node --check js/app.js
node --check js/characters.js
node --check js/documents.js
node --check js/ollama.js
```
