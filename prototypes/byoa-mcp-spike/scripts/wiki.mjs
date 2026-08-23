#!/usr/bin/env node
/**
 * 위키 검증 (docs/vibe_coding_assistant_design.md §3.5).
 *
 *   npm run wiki          # codex, claude 순서로 모두
 *   npm run wiki claude   # 하나만
 *
 * 이 기능은 **하지 않는 것으로 정의된다.** 그래서 재는 것도 대부분 "안 했는가"다.
 *
 *   - 일반론이 아닌가   → `where`가 이 프로젝트의 **실재하는 파일**을 가리키는가
 *   - 평가하지 않았는가 → 권고·판단 표현이 섞이지 않았는가
 *   - 읽을 수 있는가    → 읽는 사람이 쓰는 언어인가
 *   - 고치지 않았는가   → 워킹 트리가 그대로인가
 *
 * 대화가 없으면 위키도 없으므로, **실제 바이브코딩 turn을 한 번 돌려 대화를 만든다.**
 * `mode: "task"`는 그 용도의 검증 장치다 (BYOA_MCP_INTEGRATION_SPIKE.md §1.2).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bridgeConfig, spikeRoot } from "./_shared.mjs";

const { findAdvice } = await import(join(spikeRoot, "apps", "bridge", "dist", "wiki.js"));

const TURN_TIMEOUT_MS = 300_000;
const fixture = join(spikeRoot, "tmp", "wiki-fixture");

const CHEAP = {
  codex: { model: "gpt-5.6-luna", effort: "low" },
  claude: { model: "haiku" },
};

/** 대화를 만드는 씨앗. 설명을 함께 시켜야 전문 용어가 대화에 실린다. */
const SEED = "물건 이름으로 검색하는 기능을 붙여줘. 어떻게 만들었는지 비전공자에게 설명하듯 알려줘.";

/**
 * 빈도 기반 추출이 상위로 올렸던 말들. 하나라도 후보에 오르면 판단이 아니라 세기로
 * 돌아갔다는 뜻이다 (SPIKE_FINDINGS.md §16).
 */
const NOISE = ["wait", "waiting", "getting", "ending", "answer", "yet", "asked", "turn", "app", "panel"];

const requested = parseAgents(process.argv[2]);
const config = await bridgeConfig();

const health = await fetch(`${config.baseUrl}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`bridge에 접속할 수 없습니다 (${config.baseUrl}). 먼저 \`npm run bridge\`를 실행하세요.`);
  process.exit(1);
}
const readiness = (await health.json()).agents;

console.log(`Bridge    : ${config.baseUrl}`);
console.log(`Fixture   : ${fixture}`);

let failed = 0;
for (const agentId of requested) {
  console.log(`\n=== ${agentId} ===`);
  const ready = readiness.find((a) => a.agent === agentId);
  if (!ready?.installed || ready.authenticated === false) {
    console.error(`  실패: ${ready?.message ?? `${agentId}가 준비되지 않았습니다.`}`);
    failed += 1;
    continue;
  }
  console.log(`  버전    : ${ready.version ?? "(unknown)"}`);
  console.log(`  모델    : ${CHEAP[agentId].model}${CHEAP[agentId].effort ? ` (${CHEAP[agentId].effort})` : ""}`);
  failed += (await run(agentId)) ? 0 : 1;
}

if (failed > 0) {
  console.error(`\n${failed}개 agent에서 실패.`);
  process.exit(1);
}
console.log(`\n전 항목 통과 (${requested.join(", ")}).`);

// ---------------------------------------------------------------------------

function parseAgents(arg) {
  if (!arg || arg === "all") return ["codex", "claude"];
  if (arg === "codex" || arg === "claude") return [arg];
  console.error(`알 수 없는 agent: "${arg}" (codex|claude|all 중 하나)`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { cwd: fixture, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** 인계가 끝난 프로젝트. 위키는 `design.json`을 근거로 쓸 수 있어야 한다. */
function createFixture() {
  rmSync(fixture, { recursive: true, force: true });
  mkdirSync(join(fixture, "src"), { recursive: true });
  mkdirSync(join(fixture, ".project-intel"), { recursive: true });

  writeFileSync(join(fixture, "README.md"), "# 동네 대여\n\n같은 동네 주민끼리 물건을 빌려주는 앱.\n");
  writeFileSync(
    join(fixture, "src", "item.js"),
    `const items = new Map();
let nextId = 1;

export function addItem(ownerId, name) {
  const item = { id: nextId++, ownerId, name, state: "대여 가능" };
  items.set(item.id, item);
  return item;
}

export function listItems() {
  return [...items.values()];
}
`,
  );
  writeFileSync(
    join(fixture, ".project-intel", "design.json"),
    JSON.stringify(
      {
        title: "동네 대여",
        summary: "같은 동네 주민끼리 안 쓰는 물건을 서로 빌려주는 앱.",
        actors: [{ id: "ACTOR-1", name: "주민" }],
        reqs: [
          { id: "REQ-1", name: "빌려줄 물건 올리기", source: "user" },
          { id: "REQ-2", name: "물건 찾아보기", source: "user" },
        ],
        surfaces: [{ id: "SURF-1", name: "물건 목록", shows: ["REQ-2"], source: "ai" }],
        entities: [{ id: "ENT-1", name: "물건", relations: ["ACTOR-1이 소유한다"], states: ["대여 가능"], source: "user" }],
        flows: [
          {
            id: "FLOW-1",
            name: "물건 찾아보기",
            source: "user",
            steps: [
              { actor: "ACTOR-1", surface: "SURF-1", action: "올라온 물건을 훑어본다", entity: "ENT-1" },
              { actor: "ACTOR-1", surface: "SURF-1", action: "원하는 물건을 찾는다", entity: "ENT-1" },
            ],
          },
        ],
        rules: [{ id: "RULE-1", text: "물건은 주인만 내릴 수 있다.", constrains: ["REQ-1"], source: "ai" }],
        decisions: [
          { id: "DEC-1", text: "앱 안에서 돈을 주고받지 않는다.", why: "사용자가 원하지 않았다.", source: "user" },
        ],
      },
      null,
      2,
    ),
  );

  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "spike@example.invalid"]);
  git(["config", "user.name", "BYOA Wiki Fixture"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "Start from the design produced by the requirements interview"]);
}

/** `.project-intel/` 밖이 그대로인지. 위키 turn은 코드를 고치지 않는다. */
function isCodeClean() {
  return git(["status", "--porcelain"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .every((line) => line.includes(".project-intel/"));
}

async function run(agentId) {
  createFixture();
  const observed = { taskId: null, keywords: null, page: null, messages: 0, error: null, reached: new Set() };

  const socket = await connect(observed);
  try {
    // 1) 대화를 만든다. 이것 없이는 위키가 볼 것이 없다.
    process.stdout.write("  대화 만드는 중…\n");
    await turn(socket, observed, () =>
      post("/api/tasks", { agent: agentId, projectPath: fixture, prompt: SEED, ...CHEAP[agentId] }),
    );
    // 씨앗 turn이 만든 코드는 커밋해 둔다. 그래야 이후의 "코드를 건드리지 않았다"가 성립한다.
    git(["add", "-A"]);
    git(["commit", "-q", "--allow-empty", "-m", "Vibe-coded search"]);

    // 2) 후보 키워드 — agent의 판단.
    process.stdout.write("  키워드 고르는 중…\n");
    const started = await turn(socket, observed, () =>
      post("/api/wiki/keywords", { agent: agentId, projectPath: fixture, ...CHEAP[agentId] }),
    );
    observed.messages = started?.messages ?? 0;

    // 3) 첫 후보로 페이지를 만든다. 특정 단어를 못 박지 않는다 — 무엇을 고를지는 agent의 몫이다.
    const term = observed.keywords?.[0]?.term;
    if (term) {
      process.stdout.write(`  "${term}" 페이지 쓰는 중…\n`);
      await turn(socket, observed, () =>
        post("/api/wiki", { agent: agentId, projectPath: fixture, term, ...CHEAP[agentId] }),
      );
    }
  } catch (cause) {
    observed.error = String(cause);
  }
  socket.close();

  return report(observed);
}

async function post(path, body) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function connect(observed) {
  const { WebSocket } = await import(join(spikeRoot, "node_modules", "ws", "index.js")).then((m) => ({
    WebSocket: m.default ?? m,
  }));
  const socket = new WebSocket(`${config.baseUrl.replace("http", "ws")}/events`);
  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
  socket.on("message", (raw) => {
    const { event } = JSON.parse(raw.toString());
    // bridge는 재접속 대비로 지난 이벤트를 새 연결에 즉시 재생한다 (state.ts의 buffer replay).
    // taskId로 걸러내지 않으면 이전 실행의 task.completed가 지금 turn을 조기 종료시킨다 —
    // 실제로 그렇게 SEED turn이 끝나기도 전에 다음 단계로 넘어가 409가 났었다.
    if (!observed.taskId || event.taskId !== observed.taskId) return;
    if (event.type === "mcp.tool.called" && event.source === "bridge-endpoint") observed.reached.add(event.tool);
    if (event.type === "app.wiki.keywords") observed.keywords = event.keywords;
    if (event.type === "app.wiki") observed.page = event.page;
    if (event.type === "task.error") observed.error = event.message;
    if (["task.completed", "task.error", "task.interrupted"].includes(event.type)) {
      setTimeout(() => observed.settle?.(), 600);
    }
  });
  return socket;
}

async function turn(socket, observed, start) {
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), TURN_TIMEOUT_MS);
    observed.settle = () => {
      clearTimeout(timer);
      resolve("done");
    };
  });
  const body = await start();
  if (!body.taskId) return body; // 볼 것이 없어 turn을 돌리지 않은 경우
  observed.taskId = body.taskId;
  if ((await done) === "timeout") throw new Error("turn이 시간 안에 끝나지 않았습니다");
  return body;
}

function report(observed) {
  const page = observed.page;
  const keywords = observed.keywords ?? [];
  const slug = page ? page.term.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "") : "";
  const advice = page ? findAdvice(page.oneLine, page.inThisProject) : [];

  const checks = [
    ["turn이 오류 없이 끝났다", () => !observed.error || observed.error],
    ["대화를 읽었다", () => observed.messages > 0 || "읽어온 대화가 없습니다"],
    ["get_wiki_transcript — bridge 도달 증거", () => observed.reached.has("get_wiki_transcript") || "도달하지 않음"],
    ["후보 키워드가 나왔다", () => keywords.length > 0 || "후보가 비어 있습니다"],
    // 빈도로 뽑던 시절의 노이즈가 다시 올라오면 판단이 아니라 세기로 돌아간 것이다.
    [
      "노이즈를 고르지 않았다",
      () => {
        const bad = keywords.filter((k) => NOISE.includes(k.term.toLowerCase()));
        return bad.length === 0 || `노이즈: ${bad.map((k) => k.term).join(", ")}`;
      },
    ],
    ["get_wiki_context — bridge 도달 증거", () => observed.reached.has("get_wiki_context") || "도달하지 않음"],
    ["페이지가 저장되었다", () => page !== null || "페이지가 오지 않았습니다"],
    // 근거가 비면 일반론이다. 검색으로 얻을 수 있는 것을 우리가 만들 이유가 없다.
    ["근거를 댔다", () => (page?.where?.length ?? 0) > 0 || "where가 비어 있습니다"],
    [
      "근거가 실재한다",
      () => {
        const real = (page?.where ?? []).filter(
          (where) => existsSync(join(fixture, where)) || /^(REQ|FLOW|DEC|RULE|ENT|ACTOR|SURF)-/.test(where),
        );
        return real.length > 0 || `실재하지 않는 근거: ${(page?.where ?? []).join(", ")}`;
      },
    ],
    // 순수 학습용이다. 프롬프트만으로는 지켜지지 않아서 저장할 때 거른다.
    ["평가하지 않았다", () => advice.length === 0 || advice.join(" / ")],
    // 비전공자에게 설명하는 페이지가 읽히지 않는 언어면 존재 이유가 없다.
    [
      "읽는 사람의 언어로 썼다",
      () => /[가-힣]/.test(`${page?.oneLine ?? ""}${page?.inThisProject ?? ""}`) || "한글이 하나도 없습니다",
    ],
    ["마크다운으로도 나갔다", () => existsSync(join(fixture, ".project-intel", "wiki", `${slug}.md`)) || `${slug}.md 없음`],
    ["위키가 코드를 건드리지 않았다", () => isCodeClean() || "워킹 트리에 코드 변경이 있습니다"],
  ];

  console.log(`  후보 ${keywords.length}개: ${keywords.map((k) => k.term).join(", ") || "없음"}`);
  let ok = true;
  for (const [label, check] of checks) {
    const result = check();
    if (result === true) console.log(`  [PASS] ${label}`);
    else {
      console.log(`  [FAIL] ${label} — ${result}`);
      ok = false;
    }
  }
  if (page) console.log(`         "${page.term}" — ${page.oneLine.slice(0, 80)}…`);
  return ok;
}
