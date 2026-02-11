function percentile(values, p) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

export function createPerfTelemetry(maxSamples) {
  const sampleCap = Number.isFinite(maxSamples) ? Math.max(20, Math.floor(maxSamples)) : 160;
  const metrics = new Map();
  const marks = new Map();

  const push = (name, value) => {
    if (!Number.isFinite(value)) {
      return;
    }
    const key = String(name || "metric");
    if (!metrics.has(key)) {
      metrics.set(key, []);
    }
    const list = metrics.get(key);
    list.push(value);
    if (list.length > sampleCap) {
      list.splice(0, list.length - sampleCap);
    }
  };

  return {
    markStart(name) {
      marks.set(String(name || "mark"), performance.now());
    },
    markEnd(name) {
      const key = String(name || "mark");
      if (!marks.has(key)) {
        return 0;
      }
      const delta = performance.now() - marks.get(key);
      marks.delete(key);
      push(`${key}_ms`, delta);
      return delta;
    },
    record(name, value) {
      push(name, value);
    },
    summary(name) {
      const list = metrics.get(String(name || "metric")) || [];
      if (!list.length) {
        return { count: 0, avg: 0, p50: 0, p95: 0, latest: 0 };
      }
      const sum = list.reduce((acc, value) => acc + value, 0);
      return {
        count: list.length,
        avg: sum / list.length,
        p50: percentile(list, 50),
        p95: percentile(list, 95),
        latest: list[list.length - 1]
      };
    },
    snapshot() {
      const output = {};
      metrics.forEach((_, key) => {
        output[key] = this.summary(key);
      });
      return output;
    }
  };
}
