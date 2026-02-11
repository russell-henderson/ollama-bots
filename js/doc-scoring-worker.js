function normalizeTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const unique = Array.from(new Set(list.map((item) => item.toLowerCase())));
  return unique.sort((a, b) => a.localeCompare(b));
}

function relevanceScore(candidate, terms) {
  if (!Array.isArray(terms) || !terms.length) {
    return 0;
  }
  const haystacks = [
    String(candidate && candidate.name ? candidate.name : "").toLowerCase(),
    String(candidate && candidate.folder ? candidate.folder : "").toLowerCase(),
    normalizeTags(candidate && candidate.tags).join(" "),
    String(candidate && candidate.sourceSnippet ? candidate.sourceSnippet : "").toLowerCase()
  ];
  let score = 0;
  terms.forEach((term) => {
    if (haystacks.some((value) => value.includes(term))) {
      score += 1;
    }
  });
  return score;
}

self.onmessage = (event) => {
  const payload = event && event.data ? event.data : {};
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const terms = Array.isArray(payload.terms) ? payload.terms : [];

  const scored = candidates.map((candidate, index) => {
    const pinnedBoost = candidate && candidate.pinned ? 100 : 0;
    return {
      index,
      score: pinnedBoost + relevanceScore(candidate, terms),
      recencyStamp: Number(candidate && candidate.recencyStamp ? candidate.recencyStamp : 0),
      name: String(candidate && candidate.name ? candidate.name : "")
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.recencyStamp !== a.recencyStamp) {
      return b.recencyStamp - a.recencyStamp;
    }
    return a.name.localeCompare(b.name);
  });

  self.postMessage({
    ranked: scored.map((item) => ({ index: item.index, score: item.score }))
  });
};
