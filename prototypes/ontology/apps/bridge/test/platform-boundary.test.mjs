/**
 * Platform 경계 강제.
 *
 * 요구사항: **agent executable resolution 은 platform 계층에서 처리하고, MCP/bridge 는 OS
 * 차이를 알지 않는다.**
 *
 * 주석으로 적어 둔 경계는 지켜지지 않는다. 시험으로 건다.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const BRIDGE_SRC = join(HERE, "..", "src");
const MCP_SRC = join(HERE, "..", "..", "..", "packages", "mcp-server", "src");
const PLATFORM_FILE = join(BRIDGE_SRC, "platform.ts");

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) found.push(...sourceFiles(absolute));
    else if (entry.endsWith(".ts")) found.push(absolute);
  }
  return found;
}

/** 주석과 문자열을 뺀 실제 코드. 주석에서 platform 을 **언급**하는 것은 금지가 아니다. */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1")
    .replace(/`(?:[^`\\]|\\.)*`/gu, "``")
    .replace(/"(?:[^"\\]|\\.)*"/gu, '""')
    .replace(/'(?:[^'\\]|\\.)*'/gu, "''");
}

const OS_MARKERS = [
  "process.platform",
  "os.platform",
  '"win32"',
  "win32",
  "taskkill",
  ".cmd",
  "shell: true",
];

test("process.platform 은 platform.ts 밖에서 쓰이지 않는다", () => {
  const offenders = [];
  for (const file of sourceFiles(BRIDGE_SRC)) {
    if (file === PLATFORM_FILE) continue;
    if (codeOnly(readFileSync(file, "utf8")).includes("process.platform")) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `platform 계층 밖에서 OS 를 보고 있다:\n${offenders.join("\n")}`);
});

test("MCP server 는 OS 를 전혀 알지 않는다", () => {
  const offenders = [];
  for (const file of sourceFiles(MCP_SRC)) {
    const code = codeOnly(readFileSync(file, "utf8"));
    for (const marker of OS_MARKERS) {
      if (code.includes(marker)) offenders.push(`${file}: ${marker}`);
    }
  }
  assert.deepEqual(offenders, [], `MCP server 가 OS 차이를 알고 있다:\n${offenders.join("\n")}`);
});

test("agent 실행 파일 이름은 platform.ts 에만 있다", () => {
  const offenders = [];
  for (const file of sourceFiles(BRIDGE_SRC)) {
    if (file === PLATFORM_FILE) continue;
    const code = codeOnly(readFileSync(file, "utf8"));
    // spawn 에 CLI 이름을 직접 넘기는 것을 막는다. platform 이 준 command 만 써야 한다.
    if (/spawn\w*\(\s*("|')(codex|claude)\1/u.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `platform 을 거치지 않고 CLI 를 직접 띄운다:\n${offenders.join("\n")}`);
});

test("platform.ts 는 실제로 그 경계를 담당한다", () => {
  const code = readFileSync(PLATFORM_FILE, "utf8");
  // 이 시험이 빈 파일에 대해 통과하지 않도록, 담당해야 할 것들이 실제로 있는지 본다.
  for (const symbol of [
    "resolveAgentExecutable",
    "cliSpawnOptions",
    "killTree",
    "probeAgentVersion",
    "onShutdown",
  ]) {
    assert.ok(code.includes(`export function ${symbol}`), `platform.ts 에 ${symbol} 이 없다`);
  }
  assert.ok(code.includes("process.platform"), "platform.ts 가 OS 를 보지 않으면 경계가 무의미하다");
});

test("codeOnly 가 주석·문자열만 지운다 (이 시험 자체의 신뢰성)", () => {
  const sample = `// process.platform\n/* process.platform */\nconst a = "process.platform";\nconst b = process.platform;\n`;
  const stripped = codeOnly(sample);
  assert.equal(stripped.includes("const b = process.platform"), true, "실제 코드는 남아야 한다");
  assert.equal(stripped.split("process.platform").length - 1, 1, "주석·문자열의 것은 지워져야 한다");
});
