# Ollama Character UI Presentation

## Product Summary

Ollama Character UI is a local-first workspace for running multiple AI personas with shared document context, advanced conversation workflows, and exportable state.

## What Is Demonstrably Working

- Streaming chat with stop/abort control and status indicator stages.
- Per-character model and generation settings.
- Visible model picker in chat header with model size badge.
- Document library with parse/chunk/preprocess/version flows.
- Character-doc assignment and context budget visualization.
- Conversation branching, templates, auto-naming, search, and command palette.
- Prompt chains and advanced exports (Markdown/HTML/PDF).
- Workspace and character import/export.

## UI State

- Top global header removed.
- Sidebar shows compact Ollama status.
- Analytics/context are collapsible via header pills.
- Characters use compact grouped cards with collapse support.
- Documents panel uses tabbed organization with progressive disclosure.
- Mobile supports drawer-style side panels with backdrop and escape close.

## Performance and Reliability

- Chat rendering capped for long threads.
- Filter/search rendering debounced.
- Context relevance ranking offloaded to worker with fallback.
- Telemetry includes latency, first-token, and streaming cadence metrics.

## Suggested Demo Flow

1. Switch character and model from header picker.
2. Send prompt with assigned documents and watch status indicator stages.
3. Show context usage badge/panel and analytics toggle.
4. Run `Ask All Characters` from Quick Actions.
5. Demonstrate branch/edit/regenerate.
6. Export workspace and re-import.
