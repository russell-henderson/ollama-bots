# AI Status Indicator

## Purpose

Expose model processing state during generation with clear visual transitions and cancel control.

## Implemented Stages

1. `receiving`
2. `thinking`
3. `resources`
4. `responding`

Each stage updates orb/linear visuals plus status text detail.

## Current Behavior

- Starts on send.
- Transitions to `thinking` while waiting for first token.
- Uses `resources` visuals when assigned docs are present.
- Transitions to `responding` on first token.
- Tracks token count and cadence metrics.
- `Stop` button aborts active stream and resets indicator.
- Reduced-motion linear mode is supported and persisted.

## Files

- Component logic: `js/status-indicator.js`
- Integration hooks: `js/app.js`
- Styles/animations: `css/styles.css`
- Related telemetry: `js/telemetry.js`

## Telemetry Hooks

- `send_to_first_token_ms`
- `stream_cadence_ms`
- `stream_avg_cadence_ms`
- `stream_token_count`

## Verification Checklist

- Send starts indicator immediately.
- Stop aborts request and hides indicator.
- First token switches to responding.
- Token counter increases monotonically.
- Indicator does not get stuck after errors/cancel.
