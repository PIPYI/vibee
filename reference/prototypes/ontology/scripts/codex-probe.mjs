#!/usr/bin/env node
/**
 * Codex app-server 의 승인 정책 지원 형태를 **확정한다.**
 *
 * spike 가 배운 것: `AskForApproval` 의 타입 정의는 그대로인데 **값의 의미가** 바뀐 적이
 * 두 번 있었고, 타입 검사로는 잡히지 않았다(Finding 1·4). 이번에는 granular 가
 * `experimentalApi` capability 를 요구하기 시작했다.
 *
 * 그래서 추측하지 않고 **실제로 물어본다.** 이 스크립트는:
 *   1. codex 버전을 기록하고
 *   2. `app-server generate-ts` 로 프로토콜 스키마를 받아 관련 심볼을 찾고
 *   3. initialize 의 capability 형태를 후보별로 실제 시도해 어느 것이 통하는지 본다
 *
 * 출력을 그대로 붙여 넣으면 어느 형태가 맞는지 한 번에 알 수 있다.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { cliSpawnOptions } from "./_shared.mjs";

const CANDIDATES = [
  { label: "A: capabilities.experimentalApi = true", params: { capabilities: { experimentalApi: true } } },
  { label: "B: experimentalApi = true (최상위)", params: { experimentalApi: true } },
  { label: "C: capabilities.experimental = true", params: { capabilities: { experimental: true } } },
  { label: "D: clientCapabilities.experimentalApi = true", params: { clientCapabilities: { experimentalApi: true } } },
];

const GRANULAR = {
  granular: {
    sandbox_approval: false,
    rules: false,
    skill_approval: false,
    request_permissions: false,
    mcp_elicitations: true,
  },
};

// --- 1. 버전 -----------------------------------------------------------------
const version = spawnSync("codex", ["--version"], { encoding: "utf8", ...cliSpawnOptions() });
console.log("codex --version");
console.log(`  ${(version.stdout ?? version.stderr ?? "").trim() || "(실패)"}`);
console.log("");

// --- 2. 프로토콜 스키마 -------------------------------------------------------
// `generate-ts` 는 --out <DIR> 를 요구한다. 임시 디렉터리에 뽑아 **직접 읽는다** —
// 추측하는 것보다 스키마를 보는 편이 언제나 빠르다.
console.log("app-server generate-ts — 실제 타입 정의");
const outDir = mkdtempSync(join(tmpdir(), "codex-schema-"));
const schema = spawnSync("codex", ["app-server", "generate-ts", "--out", outDir], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  ...cliSpawnOptions(),
});

if (schema.status !== 0) {
  console.log(`  (실패: ${(schema.stderr ?? "").trim().slice(0, 300)})`);
} else {
  const files = collectFiles(outDir);
  console.log(`  ${files.length}개 파일 생성됨: ${outDir}`);
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  for (const symbol of [
    "ThreadStartParams",
    "ThreadStartResponse",
    "ThreadStartResult",
    "TurnStartParams",
    "TurnStartResponse",
    "UserInput",
    "InitializeParams",
    "InitializeCapabilities",
    "AskForApproval",
  ]) {
    printDeclaration(source, symbol);
  }
  // 이름을 몰라도 찾을 수 있게: thread/turn 관련 응답 타입을 전부 훑는다.
  const responseNames = [
    ...new Set(
      (source.match(/export type (\w*(?:Thread|Turn)\w*(?:Response|Result))\b/gu) ?? []).map(
        (line) => line.replace("export type ", ""),
      ),
    ),
  ];
  console.log(`  (thread/turn 관련 응답 타입: ${responseNames.join(", ") || "없음"})`);
}
console.log("");

// --- 3. 실제 시도 -------------------------------------------------------------
console.log("initialize capability 형태별 시도");
for (const candidate of CANDIDATES) {
  const outcome = await tryCandidate(candidate.params);
  console.log(`  ${candidate.label}`);
  console.log(`    initialize  : ${outcome.initialize}`);
  console.log(`    thread/start: ${outcome.threadStart}`);
}

// 대조군 — granular 없이도 되는지 (되면 그것은 MCP 승인을 어떻게 다루는지 별도 확인 필요)
const baseline = await tryCandidate({}, { skipGranular: true });
console.log("  대조군: capability 없음 + 승인 정책 생략");
console.log(`    initialize  : ${baseline.initialize}`);
console.log(`    thread/start: ${baseline.threadStart}`);

// --- 4. turn/start 의 input 모양 ----------------------------------------------
// `invalid type: map, expected a sequence` 가 여기서 났다. 후보를 실제로 시도한다.
console.log("");
console.log("turn/start 의 input 모양");
const INPUT_SHAPES = [
  { label: "1: { text }", value: { text: "ping" } },
  { label: "2: [{ type: 'text', text }]", value: [{ type: "text", text: "ping" }] },
  { label: "3: [{ text }]", value: [{ text: "ping" }] },
  { label: "4: 'ping' (문자열)", value: "ping" },
];
for (const shape of INPUT_SHAPES) {
  const outcome = await tryTurn(shape.value);
  console.log(`  ${shape.label}`);
  console.log(`    turn/start: ${outcome}`);
}

process.exit(0);

/** 응답 어디에 threadId 가 있는지 모른다. 후보를 훑고, 없으면 그 사실을 그대로 알린다. */
function extractThreadId(result) {
  if (!result || typeof result !== "object") return undefined;
  return (
    result.threadId ??
    result.thread_id ??
    result.id ??
    result.thread?.id ??
    result.thread?.threadId ??
    undefined
  );
}

function collectFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) found.push(...collectFiles(absolute));
    else if (entry.endsWith(".ts")) found.push(absolute);
  }
  return found;
}

/** 심볼의 선언 블록을 통째로 출력한다. 한 줄 grep 으로는 모양을 알 수 없다. */
function printDeclaration(source, symbol) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^\\s*(export\\s+)?(type|interface)\\s+${symbol}\\b`).test(line),
  );
  if (start === -1) {
    console.log(`  ${symbol}: (없음)`);
    return;
  }
  console.log(`  ${symbol}:`);
  let depth = 0;
  for (let index = start; index < Math.min(lines.length, start + 60); index += 1) {
    const line = lines[index];
    console.log(`    ${line}`);
    depth += (line.match(/[{[]/g) ?? []).length - (line.match(/[}\]]/g) ?? []).length;
    if (index > start && depth <= 0) break;
    if (index === start && !line.includes("{") && !line.includes("[") && line.includes(";")) break;
  }
}

// -----------------------------------------------------------------------------

/** initialize → thread/start 까지 성공시킨 뒤 turn/start 의 input 모양만 바꿔 시험한다. */
async function tryTurn(inputValue) {
  const outcome = await tryCandidate(
    { capabilities: { experimentalApi: true } },
    { turnInput: inputValue },
  );
  return outcome.turnStart ?? "(시도 안 함)";
}

async function tryCandidate(extraParams, options = {}) {
  return new Promise((resolve) => {
    const child = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      ...cliSpawnOptions(),
    });

    const result = { initialize: "(응답 없음)", threadStart: "(시도 안 함)", turnStart: "(시도 안 함)" };
    const pending = new Map();
    let nextId = 1;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // 이미 죽었다.
      }
      resolve(result);
    };

    const timer = setTimeout(finish, 20_000);
    child.stderr.on("data", () => undefined);
    child.on("error", (error) => {
      result.initialize = `spawn 실패: ${error.message}`;
      clearTimeout(timer);
      finish();
    });

    const call = (method, params) =>
      new Promise((res) => {
        const id = nextId++;
        pending.set(id, res);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });

    createInterface({ input: child.stdout }).on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let message;
      try {
        message = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (message.id !== undefined && message.method === undefined) {
        const resolver = pending.get(Number(message.id));
        if (resolver) {
          pending.delete(Number(message.id));
          resolver(message.error ? { error: message.error } : { result: message.result });
        }
      }
    });

    void (async () => {
      const init = await call("initialize", {
        clientInfo: { name: "onto-probe", version: "0.1.0" },
        ...extraParams,
      });
      result.initialize = init.error ? `거부: ${init.error.message}` : "성공";
      if (init.error) {
        clearTimeout(timer);
        finish();
        return;
      }
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);

      const start = await call("thread/start", {
        cwd: process.cwd(),
        ...(options.skipGranular ? {} : { approvalPolicy: GRANULAR }),
        sandboxPolicy: { type: "workspaceWrite", writableRoots: [process.cwd()] },
      });
      result.threadStart = start.error
        ? `거부: ${start.error.message}`
        : `성공 — raw result: ${JSON.stringify(start.result)}`;

      if (!start.error && options.turnInput !== undefined) {
        const threadId = extractThreadId(start.result);
        const turn = await call("turn/start", {
          threadId,
          input: options.turnInput,
          cwd: process.cwd(),
          approvalPolicy: GRANULAR,
        });
        result.turnStart = turn.error
          ? `거부: ${turn.error.message} (보낸 threadId: ${JSON.stringify(threadId)})`
          : "성공";
      }

      clearTimeout(timer);
      finish();
    })();
  });
}
