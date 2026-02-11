/*
Usage:
  node tests/perf-thresholds.test.js
  node tests/perf-thresholds.test.js ./perf-snapshot.json

Expected JSON shape (assistant perf snapshot):
{
  "send_to_first_token_ms": { "p95": 3200 },
  "search_latency_ms": { "p95": 120 },
  "stream_cadence_ms": { "p95": 180 },
  "chat_render_ms": { "p95": 14 }
}
*/

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_THRESHOLDS = {
  send_to_first_token_ms: 4000,
  search_latency_ms: 150,
  stream_cadence_ms: 300,
  chat_render_ms: 16
};

function readInput(argPath) {
  if (!argPath) {
    return {};
  }
  const fullPath = path.resolve(process.cwd(), argPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Snapshot not found: ${fullPath}`);
  }
  const raw = fs.readFileSync(fullPath, "utf8");
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function metricP95(snapshot, key) {
  const record = snapshot[key];
  if (!record || typeof record !== "object") {
    return null;
  }
  const value = Number(record.p95);
  return Number.isFinite(value) ? value : null;
}

function run() {
  const inputPath = process.argv[2] || "";
  const snapshot = readInput(inputPath);
  const failures = [];
  Object.keys(DEFAULT_THRESHOLDS).forEach((key) => {
    const limit = DEFAULT_THRESHOLDS[key];
    const value = metricP95(snapshot, key);
    if (value === null) {
      return;
    }
    if (value > limit) {
      failures.push(`${key} p95 ${value}ms > ${limit}ms`);
    }
  });

  if (!Object.keys(snapshot).length) {
    process.stdout.write("No snapshot provided; perf threshold test skipped.\n");
    process.exit(0);
  }
  if (failures.length) {
    process.stderr.write(`Perf regression detected:\n- ${failures.join("\n- ")}\n`);
    process.exit(1);
  }
  process.stdout.write("Perf thresholds passed.\n");
}

try {
  run();
} catch (error) {
  process.stderr.write(`Perf threshold test failed: ${error.message || "unknown error"}\n`);
  process.exit(1);
}
