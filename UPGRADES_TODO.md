# Ollama Character UI - Performance and Execution Upgrade Board

Status legend: `[ ]` not started, `[/]` in progress, `[x]` done
Priority legend: `P0` critical, `P1` high, `P2` medium
Effort legend: `S` <= 0.5 day, `M` 1-2 days, `L` 3+ days

## Mission
Ship upgrade features from `ADDITIONS.md`, `INDICATORS.md`, and `STATUS.md` with strict performance budgets, clear sequencing, and production-safe rollout controls.

## Success Metrics (Must Hold)

- [ ] `P0` Chat send-to-first-token (P50) <= 1.5s and (P95) <= 4.0s for local model baseline.
- [ ] `P0` Streaming UI frame drops <= 3% during response rendering.
- [ ] `P0` No data loss across reload/import/migration scenarios.
- [ ] `P0` Search interaction latency <= 150ms for 10k messages local index.
- [ ] `P0` Context builder always stays within model context limit with >= 300 token safety margin.
- [ ] `P1` New UI flows keyboard-accessible and pass baseline accessibility checks.

## Non-Negotiable Guardrails

- [ ] Add feature flags for each major capability before release.
- [ ] Add abort-safe generation path for every streaming workflow.
- [ ] Prevent main-thread blocking work over 16ms in hot paths.
- [ ] Use incremental indexing and lazy rendering for large datasets.
- [ ] Gate all storage schema changes behind migrations + rollback compatibility.

## Phase 1 - Foundation and Quick Wins (P0)

- [/] `P0/S` Copy formatting options (plain/markdown/code-only)
  - Action: add deterministic copy transformers with escaping safety.
  - Acceptance: multiline/code cases copy correctly and match expected snapshot outputs.
- [x] `P0/S` Auto-save per-character drafts
  - Action: debounce save (2s), key by character + conversation, clear on send.
  - Acceptance: refresh restores draft; send removes draft.
- [x] `P0/S` Conversation auto-naming
  - Action: generate title after first complete exchange, preserve manual rename.
  - Acceptance: no overwrite after user-set label.
- [x] `P0/M` Metadata migration baseline
  - Action: version bump + migrations for tags, ratings, annotations, analytics IDs, status metadata.
  - Acceptance: old exports/imports open without loss or corruption.

## Phase 1A - AI Processing Status Indicator (P0)

- [x] `P0/M` Build indicator component shell
  - Action: orb UI + label + detail + stop button mount in chat header/body.
  - Acceptance: zero layout jump when toggled.
- [x] `P0/M` Implement state machine
  - Action: `receiving -> thinking -> resources? -> responding -> complete|error|aborted`.
  - Acceptance: no stuck classes/timers after cancel, retry, or error.
- [x] `P0/S` Stage 1: Receiving
  - Action: blue quick pulse on send.
  - Acceptance: appears within same interaction frame as send event.
- [x] `P0/S` Stage 2: Thinking
  - Action: purple rings + elapsed timer (100ms updates), >5s warning color.
  - Acceptance: timer accuracy within +/-100ms.
- [x] `P0/M` Stage 3: Reviewing resources
  - Action: amber state, rotate doc icons, cycle filenames every 2s.
  - Acceptance: handles 0/1/3/10+ docs and truncation rules.
- [x] `P0/S` Stage 4: Responding
  - Action: green streaming effect + token counter on first token.
  - Acceptance: token counter monotonic and resets on complete.
- [x] `P0/M` Integration and control
  - Action: connect to streaming parser and abort controller.
  - Acceptance: Stop always cancels request and clears indicator state.
- [x] `P1/S` Reduced-motion fallback
  - Action: linear variant via feature flag.
  - Acceptance: selectable mode with equivalent status semantics.

## Phase 2 - Organization and Discovery (P1)

- [x] `P1/L` Document tags and folders
  - Action: tags, folder tree, filter chips, bulk edit.
  - Acceptance: combined folder+tag filtering with persistence.
- [x] `P1/M` Character grouping and ordering
  - Action: CRUD groups, drag/drop move, persistent sort order.
  - Acceptance: reload preserves hierarchy and ordering.
- [x] `P1/L` Conversation search
  - Action: local index + filters (character/date/docs) + jump-to-hit.
  - Acceptance: accurate snippets; <=150ms query latency target.
- [x] `P1/M` Command palette
  - Action: Ctrl/Cmd+K, fuzzy matching, keyboard navigation.
  - Acceptance: top 10 commands fully mouse-free.

## Phase 3 - Quality Feedback Loop (P1)

- [x] `P1/M` Message ratings
  - Action: thumbs up/down, editable feedback state, persistence.
  - Acceptance: aggregate stats update incrementally.
- [x] `P1/M` Inline annotations
  - Action: add/edit/delete note/feedback/bookmark.
  - Acceptance: annotations export with conversation metadata.
- [x] `P1/M` Message edit and regenerate
  - Action: edit user turn, truncate dependent turns, regenerate safely.
  - Acceptance: no branch/history corruption in replay flows.
- [x] `P1/L` Usage analytics dashboard
  - Action: session, character, model, document metrics.
  - Acceptance: dashboard render <=300ms after data load for typical workspace.

## Phase 4 - Context Intelligence (P1)

- [x] `P1/L` Smart context windowing
  - Action: deterministic token budgeter (system, pinned docs, recency, relevance, summary fallback).
  - Acceptance: payload never exceeds limit; >=300 token reserve.
- [x] `P1/M` Context usage visualization
  - Action: per-response token bar + doc/chunk attribution panel.
  - Acceptance: values match actual request payload metadata.

## Phase 5 - Automation and Export (P2)

- [x] `P2/L` Prompt chains
  - Action: chain editor, templated variables, run progress, retry/resume.
  - Acceptance: step outputs are available as variables in subsequent steps.
- [x] `P2/M` Advanced exports (Markdown/PDF/HTML)
  - Action: export profile selector with metadata toggles.
  - Acceptance: deterministic ordering and valid output files.

## Performance Workstream (Parallel)

- [x] `P0/M` Virtualize long chat rendering and cap DOM nodes.
- [x] `P0/M` Debounce expensive filters/search updates.
- [x] `P0/M` Move indexing/chunk scoring off main thread where possible. (Doc relevance scoring now runs in `doc-scoring-worker.js` with timeout fallback.)
- [x] `P0/S` Add lightweight perf telemetry (render time, search latency, token streaming cadence).
- [x] `P0/S` Add regression thresholds in CI for key timings.

## Testing and Release Gates

- [ ] `P0` Migration tests: forward/backward compatibility for all new schema fields.
- [ ] `P0` E2E: send/stream/cancel, status indicator transitions, edit-regenerate integrity.
- [ ] `P0` E2E: search indexing and jump-to-message correctness.
- [ ] `P1` Load tests: 10k messages, 500 docs, multi-character switching.
- [ ] `P1` Accessibility: keyboard nav, focus states, screen-reader labels, reduced-motion mode.
- [ ] `P0` Gate A: Phase 1 + Phase 1A complete with no P0 defects.
- [ ] `P1` Gate B: Phase 2 + Phase 3 complete with latency targets met.
- [ ] `P1` Gate C: Phase 4 stable and verified against context limits.
- [ ] `P2` Gate D: Phase 5 shipped behind flags, then promoted.

## Immediate Action Queue (Next 10 Tasks -> File-by-File)

- [x] 1. Status indicator component shell + CSS primitives
  - Files: `index.html`, `css/styles.css`, `js/app.js`
  - Actions: add indicator container markup, base orb styles, mount/show-hide hook.
- [x] 2. Status state machine + timer lifecycle cleanup
  - Files: `js/status-indicator.js` (new), `js/app.js`
  - Actions: implement stage enum, transitions, `reset()`, timer/interval cleanup on every exit path.
- [x] 3. First-token transition + streaming token counter
  - Files: `js/ollama.js`, `js/status-indicator.js`, `js/app.js`
  - Actions: detect first streamed token, switch to responding stage, increment displayed token count.
- [x] 4. Stop button abort controller + UI reset
  - Files: `js/ollama.js`, `js/app.js`, `js/status-indicator.js`
  - Actions: wire stop click to active `AbortController`, clear pending UI state and classes.
- [x] 5. Reduced-motion linear fallback flag
  - Files: `css/styles.css`, `js/app.js`, `js/storage.js`
  - Actions: add feature flag + persisted preference, linear status mode, `prefers-reduced-motion` handling.
- [x] 6. Metadata migration scaffolding for new fields
  - Files: `js/storage.js`, `js/workspace.js`
  - Actions: bump schema version, add migration transforms for tags/ratings/annotations/analytics/status metadata.
- [x] 7. Copy modes with snapshot tests
  - Files: `js/app.js`, `tests/copy-format.test.js` (new)
  - Actions: implement plain/markdown/code copy transformers and snapshot coverage for edge cases.
- [x] 8. Draft autosave restore/clear behavior
  - Files: `js/app.js`, `js/storage.js`
  - Actions: debounce save, restore on conversation load, clear on successful send.
- [x] 9. Perf telemetry hooks (send->first-token, stream cadence)
  - Files: `js/ollama.js`, `js/app.js`, `js/telemetry.js` (new)
  - Actions: record timing marks and rolling metrics with lightweight in-memory aggregation.
- [ ] 10. E2E status transitions + abort safety
  - Files: `tests/e2e/status-indicator.spec.js` (new), `tests/e2e/chat-streaming.spec.js` (update)
  - Actions: validate receiving/thinking/responding transitions and stop-button cancellation behavior.

## Definition of Done For This Queue

- [ ] All 10 tasks merged behind feature flags.
- [ ] No console errors during send/stream/cancel flows.
- [ ] Existing chat flows remain backward compatible.
- [ ] New tests pass locally and in CI.
## Dependency Order

- [ ] Complete Phase 1 and Phase 1A before large indexing/search features.
- [ ] Complete ratings/annotations before analytics final UX.
- [x] Complete smart context windowing before context visualization.
- [ ] Complete performance workstream checkpoints before releasing Phase 3+ broadly.
- [ ] Keep Prompt Chains and Advanced Exports behind flags until stability targets are met.

