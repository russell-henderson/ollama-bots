export function stripMarkdown(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, "").replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .trim();
}

export function extractCodeBlocks(text) {
  const matches = String(text || "").match(/```[\s\S]*?```/g) || [];
  if (!matches.length) {
    return "";
  }
  return matches
    .map((block) => block.replace(/```[^\n]*\n?/g, "").replace(/```/g, "").trim())
    .join("\n\n")
    .trim();
}

export function formatMessageForCopy(text, format) {
  const value = String(text || "");
  if (format === "plain") {
    return stripMarkdown(value);
  }
  if (format === "code") {
    return extractCodeBlocks(value);
  }
  return value;
}
