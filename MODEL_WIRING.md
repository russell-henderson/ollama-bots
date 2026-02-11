# Model Wiring Reference

This document describes how models are discovered, filtered, ordered, and applied in the UI.

## Source of Truth

- Runtime model discovery: `GET http://localhost:11434/api/tags`
- UI wiring module: `js/ollama.js`
- Character model persistence: `js/characters.js`
- Chat send path resolution: `js/app.js`

## Current Selection Controls

- Chat header dropdown: `#quick-model-select`
- Character settings dropdown: `#settings-model`
- Active character model label: `#active-model-target`
- Model size badge: `#quick-model-size-badge`

Both dropdowns are populated from the same Ollama tags payload.

## Allowlist and Ordering

`js/ollama.js` uses:

- `FORCE_INCLUDED_MODELS` to bypass generic exclusion patterns.
- `PREFERRED_MODEL_ORDER` to pin top ordering for key models.
- `EXCLUDED_MODEL_PATTERNS` for broad filtering (currently includes `/qwen/i`), with allowlist override.

Explicitly wired models include:

- `MartinRizzo/Regent-Dominique:24b`
- `thirdeyeai/DeepSeek-R1-Distill-Qwen-7B-uncensored:Q4_0`
- `hirdeyeai/DeepSeek-R1-Distill-Qwen-7B-uncensored:Q4_0`
- `wizard-vicuna-uncensored:7b`
- `dolphin-phi:2.7b`

Both `thirdeyeai` and `hirdeyeai` spellings are intentionally included for compatibility.

## Runtime Sync Behavior

1. `initOllama()` fetches tags and populates both dropdowns.
2. `ollama:models-updated` event is dispatched after each refresh attempt.
3. `initChat()` listens for this event and re-syncs the header dropdown and size badge for the active character.
4. Selecting a model in header updates active character model via `setCharacterModel(...)`.

## Generation Resolution

On send, model resolution order is:

1. Active character model (`character.model`)
2. Fallback selected model from ollama module (`getSelectedModel()`)

If neither exists, send is blocked with a user-facing error.

## Troubleshooting

- Model not visible:
  - Confirm `api/tags` returns it.
  - Check `EXCLUDED_MODEL_PATTERNS` and ensure model is in `FORCE_INCLUDED_MODELS`.
- Wrong model used:
  - Verify active character in left panel.
  - Verify `#quick-model-select` value after character switch.
- Size badge shows `custom`:
  - Option text did not include trailing `(size)` metadata from tags response.

## Verification Commands

```powershell
node --check js/ollama.js
node --check js/app.js
node --check js/characters.js
```
