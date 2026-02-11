import { formatMessageForCopy } from "../js/copy-format.js";

const fixtures = [
  {
    name: "plain removes markdown emphasis and links",
    input: "## Title\n**Bold** and _italic_ with [link](https://example.com)",
    format: "plain",
    expected: "Title\nBold and italic with link"
  },
  {
    name: "plain strips quote and list markers",
    input: "> quoted line\n- one\n- two",
    format: "plain",
    expected: "quoted line\none\ntwo"
  },
  {
    name: "code extracts one fenced block",
    input: "before\n```js\nconst x = 1;\n```\nafter",
    format: "code",
    expected: "const x = 1;"
  },
  {
    name: "code extracts multiple fenced blocks",
    input: "```js\nconst a = 1;\n```\ntext\n```python\nprint('x')\n```",
    format: "code",
    expected: "const a = 1;\n\nprint('x')"
  },
  {
    name: "code returns empty without fenced blocks",
    input: "no code here",
    format: "code",
    expected: ""
  },
  {
    name: "markdown keeps original content",
    input: "**Keep** `everything` as-is",
    format: "markdown",
    expected: "**Keep** `everything` as-is"
  }
];

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    return;
  }
  throw new Error(`${label}\nExpected:\n${expected}\n\nActual:\n${actual}`);
}

export function runCopyFormatSnapshotTests() {
  fixtures.forEach((fixture) => {
    const actual = formatMessageForCopy(fixture.input, fixture.format);
    assertEqual(actual, fixture.expected, fixture.name);
  });
  return { total: fixtures.length, passed: fixtures.length };
}

if (typeof window !== "undefined") {
  window.runCopyFormatSnapshotTests = runCopyFormatSnapshotTests;
}
