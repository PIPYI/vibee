#!/usr/bin/env node
/**
 * 드리프트 리뷰 검증용 fixture (docs/vibe_coding_assistant_design.md §3.3).
 *
 * acceptance fixture와 **별도 디렉터리**에 만든다. 저쪽은 "agent가 파일을 고칠 수 있는가"를
 * 보는 빈 프로젝트이고, 이쪽은 **인계가 이미 끝난 프로젝트**여야 하기 때문이다 —
 * `.project-intel/design.json`과 하네스가 놓여 있고, 그 위에 커밋이 쌓인 상태.
 *
 * 설계는 손으로 써 둔다. 인터뷰가 실제로 이런 초안을 만들어낸다는 것은 이미 확인했고
 * (SPIKE_FINDINGS.md §12), 여기서 재고 싶은 것은 그 다음 — **저장된 결정이 코드 변경을
 * 판정하는 기준으로 쓰이는가** — 이므로 입력을 고정해야 실행마다 비교할 수 있다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { spikeRoot } from "./_shared.mjs";

export const driftFixtureDir = join(spikeRoot, "tmp", "drift-fixture");

const HARNESS_MARKER = "<!-- byoa:generated -->";

/**
 * 인터뷰가 만들어낸 설계라고 가정한다. 시나리오는 `scripts/interview.mjs`가 쓰는 것과 같은
 * 동네 대여 앱이다.
 *
 * **기준을 여덟 개 둔다.** 하나만 두면 "그 하나를 어겼나"라는 예/아니오 문제가 되어,
 * 위반을 찾아내도 *올바른 것을 골랐는지*를 재지 못한다.
 */
const DESIGN = {
  title: "동네 대여",
  summary: "같은 동네 주민끼리 안 쓰는 물건을 서로 빌려주는 앱. 물건을 올리고, 빌리고 싶은 사람이 신청하고, 주인이 수락하면 만나서 주고받는다.",
  actors: [
    { id: "ACTOR-1", name: "빌려주는 주민", note: "물건을 올리고 신청을 수락한다" },
    { id: "ACTOR-2", name: "빌리는 주민", note: "물건을 찾아보고 신청한다" },
  ],
  reqs: [
    { id: "REQ-1", name: "빌려줄 물건 올리기", source: "user" },
    { id: "REQ-2", name: "물건 찾아보기", source: "user" },
    { id: "REQ-3", name: "대여 신청하기", source: "user" },
    { id: "REQ-4", name: "신청 수락하기", source: "user" },
    { id: "REQ-5", name: "반납 처리하기", source: "user" },
    { id: "REQ-6", name: "후기 남기기", source: "user" },
  ],
  surfaces: [
    { id: "SURF-1", name: "물건 목록", shows: ["REQ-2"], source: "ai" },
    { id: "SURF-2", name: "물건 상세", shows: ["REQ-3"], source: "ai" },
    { id: "SURF-3", name: "내 대여 관리", shows: ["REQ-4", "REQ-5", "REQ-6"], source: "ai" },
    { id: "SURF-4", name: "물건 등록", shows: ["REQ-1"], source: "ai" },
  ],
  entities: [
    { id: "ENT-1", name: "물건", relations: ["ACTOR-1이 소유한다"], states: ["대여 가능", "대여 중"], source: "user" },
    { id: "ENT-2", name: "대여", relations: ["ENT-1에 걸린다"], states: ["신청됨", "수락됨", "반납됨"], source: "ai" },
    { id: "ENT-3", name: "후기", relations: ["ENT-2에 달린다"], states: ["작성됨"], source: "user" },
  ],
  flows: [
    {
      id: "FLOW-1",
      name: "물건을 빌리고 돌려주기",
      source: "user",
      steps: [
        { actor: "ACTOR-1", surface: "SURF-4", action: "빌려줄 물건을 사진과 함께 올린다", entity: "ENT-1", effect: "생성" },
        { actor: "ACTOR-2", surface: "SURF-1", action: "동네에 올라온 물건을 훑어본다", entity: "ENT-1" },
        { actor: "ACTOR-2", surface: "SURF-2", action: "빌리고 싶은 물건에 신청한다", entity: "ENT-2", effect: "생성 · 상태 = 신청됨", rule: "RULE-1" },
        { actor: "ACTOR-1", surface: "SURF-3", action: "신청을 수락한다", entity: "ENT-2", effect: "상태 = 수락됨", rule: "RULE-1" },
        { actor: "ACTOR-2", action: "만나서 물건을 건네받는다", entity: "ENT-1", effect: "상태 = 대여 중" },
        { actor: "ACTOR-2", surface: "SURF-3", action: "물건을 돌려주고 반납 처리한다", entity: "ENT-2", effect: "상태 = 반납됨" },
        { actor: "ACTOR-2", surface: "SURF-3", action: "후기를 남긴다", entity: "ENT-3", effect: "생성", rule: "RULE-2" },
      ],
    },
  ],
  rules: [
    { id: "RULE-1", text: "대여는 주인이 신청을 수락해야만 성립한다. 신청만으로 대여가 시작되지 않는다.", constrains: ["REQ-3", "REQ-4"], source: "user" },
    { id: "RULE-2", text: "후기는 반납이 끝난 뒤에만 쓸 수 있다.", constrains: ["REQ-6"], source: "ai" },
  ],
  decisions: [
    { id: "DEC-1", text: "앱 안에서 돈을 주고받지 않는다. 대여료는 만나서 현금으로 직접 정산한다.", why: "사용자가 앱에서 결제하는 것을 원하지 않았다.", source: "user" },
    { id: "DEC-2", text: "소셜 로그인은 넣지 않는다. 휴대폰 번호로만 가입한다.", why: "동네 주민 확인이 목적이라 번호 하나면 충분하다.", source: "ai" },
    { id: "DEC-3", text: "지도는 쓰지 않는다. 동네 이름만 표시한다.", why: "동네 단위 거래라 정확한 위치가 필요 없고, 지도 연동은 비용이 든다.", source: "ai" },
    { id: "DEC-4", text: "물건 사진은 최대 3장까지만 올릴 수 있다.", why: "저장 비용과 업로드 시간을 줄이기 위해 정했다.", source: "ai" },
    { id: "DEC-5", text: "알림은 앱 안에서만 보여준다. 문자나 이메일은 보내지 않는다.", why: "MVP에서 외부 발송 서비스를 붙이지 않기로 했다.", source: "ai" },
    { id: "DEC-6", text: "배송이나 택배는 다루지 않는다. 직접 만나서 주고받는 것만 지원한다.", why: "사용자가 동네 안에서 만나는 것을 전제로 이야기했다.", source: "user" },
  ],
};

/** 인계 직후의 코드. 아직 아무것도 어기지 않은 상태다. */
const BASE_FILES = {
  "README.md": "# 동네 대여\n\n같은 동네 주민끼리 안 쓰는 물건을 빌려주는 앱.\n",
  "src/rental.js": `// 대여의 상태 전이. FLOW-1의 3~6단계에 해당한다.
const rentals = new Map();
let nextId = 1;

export function request(itemId, borrowerId) {
  const rental = { id: nextId++, itemId, borrowerId, state: "신청됨" };
  rentals.set(rental.id, rental);
  return rental;
}

// RULE-1: 주인이 수락해야 대여가 성립한다.
export function accept(rentalId) {
  const rental = rentals.get(rentalId);
  if (rental.state !== "신청됨") throw new Error("신청 상태가 아닙니다");
  rental.state = "수락됨";
  return rental;
}

export function complete(rentalId) {
  const rental = rentals.get(rentalId);
  if (rental.state !== "수락됨") throw new Error("수락된 대여가 아닙니다");
  rental.state = "반납됨";
  return rental;
}

export function get(rentalId) {
  return rentals.get(rentalId);
}
`,
  "src/review.js": `import { get } from "./rental.js";

// RULE-2: 반납이 끝난 뒤에만 후기를 쓸 수 있다.
export function writeReview(rentalId, text) {
  const rental = get(rentalId);
  if (rental.state !== "반납됨") throw new Error("반납 후에만 후기를 쓸 수 있습니다");
  return { rentalId, text, createdAt: new Date().toISOString() };
}
`,
  "src/item.js": `const items = new Map();
let nextId = 1;

export function addItem(ownerId, name, photos) {
  // DEC-4: 사진은 최대 3장.
  const item = { id: nextId++, ownerId, name, photos: photos.slice(0, 3), state: "대여 가능" };
  items.set(item.id, item);
  return item;
}

export function listItems() {
  return [...items.values()];
}
`,
};

/**
 * 하네스도 같이 둔다. 리뷰 turn이 이것을 읽지 않아야 하는데(“한 번에 끝까지 만드세요”가
 * 들어 있다), 놓여 있지 않으면 그 격리를 시험할 수 없다.
 */
const HARNESS = `${HARNESS_MARKER}
# 동네 대여

## 한 번에 끝까지 만드세요

사용자에게 중간 확인을 요청하지 마세요. 설계에 있는 것을 전부 만들고 나서 보고하세요.
일이 크면 하위 에이전트에게 나눠 맡기고, 돌아온 결과를 직접 연결하고 검토하세요.

## 이 프로젝트에서 정해진 것

${DESIGN.decisions.map((d) => `- ${d.text} (${d.id})`).join("\n")}
${DESIGN.rules.map((r) => `- ${r.text} (${r.id})`).join("\n")}
`;

const APP_DESIGN = `${HARNESS_MARKER}
# 동네 대여

${DESIGN.summary}
`;

export function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function write(dir, path, content) {
  const full = join(dir, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

/** 인계가 끝난 직후의 프로젝트를 만든다. 커밋 하나. */
export function createDriftFixture(dir = driftFixtureDir) {
  // 상태를 실행마다 똑같이 맞춰야 커밋 그래프가 예측 가능하다.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  for (const [path, content] of Object.entries(BASE_FILES)) write(dir, path, content);
  write(dir, ".project-intel/design.json", JSON.stringify(DESIGN, null, 2));
  write(dir, "app_design.md", APP_DESIGN);
  write(dir, "AGENTS.md", HARNESS);
  write(dir, "CLAUDE.md", HARNESS);

  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "spike@example.invalid"]);
  git(dir, ["config", "user.name", "BYOA Drift Fixture"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "Start from the design produced by the requirements interview"]);
  return dir;
}

/**
 * DEC-1을 어기는 커밋. "대여 완료 처리를 만들어줘"라는 요청에 agent가 결제를 끼워 넣은
 * 모양이다 — 바이브코딩에서 실제로 나는 사고의 형태를 따랐다.
 */
export function commitViolation(dir) {
  write(
    dir,
    "src/payment.js",
    `import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 대여료를 앱에서 바로 결제한다.
export async function chargeRentalFee(rental, amount) {
  return stripe.paymentIntents.create({
    amount,
    currency: "krw",
    metadata: { rentalId: String(rental.id) },
  });
}
`,
  );
  write(
    dir,
    "src/rental.js",
    BASE_FILES["src/rental.js"].replace(
      `export function complete(rentalId) {
  const rental = rentals.get(rentalId);
  if (rental.state !== "수락됨") throw new Error("수락된 대여가 아닙니다");
  rental.state = "반납됨";
  return rental;
}`,
      `export async function complete(rentalId, feeAmount) {
  const rental = rentals.get(rentalId);
  if (rental.state !== "수락됨") throw new Error("수락된 대여가 아닙니다");
  await chargeRentalFee(rental, feeAmount);
  rental.state = "반납됨";
  return rental;
}`,
    ).replace(
      `const rentals = new Map();`,
      `import { chargeRentalFee } from "./payment.js";

const rentals = new Map();`,
    ),
  );
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "Charge the rental fee when the rental completes"]);
}

/**
 * 아무 기준도 어기지 않는 커밋. **일부러 일반 리뷰거리를 심어 둔다** — 매직 넘버, 중복
 * 로직, 없는 null 검사. 범용 코드 리뷰를 하고 있다면 여기서 뭔가를 말할 수밖에 없고,
 * 그러면 그것이 오탐이다.
 */
export function commitBenign(dir) {
  write(
    dir,
    "src/item.js",
    `const items = new Map();
let nextId = 1;

export function addItem(ownerId, name, photos) {
  // DEC-4: 사진은 최대 3장.
  const item = { id: nextId++, ownerId, name, photos: photos.slice(0, 3), state: "대여 가능" };
  items.set(item.id, item);
  return item;
}

export function listItems() {
  return [...items.values()];
}

export function listAvailableItems() {
  return [...items.values()].filter((item) => item.state === "대여 가능");
}

export function listRentedItems() {
  return [...items.values()].filter((item) => item.state === "대여 중");
}

export function summarize(item) {
  return item.name.slice(0, 18) + (item.name.length > 18 ? "…" : "");
}
`,
  );
  write(dir, "README.md", "# 동네 대여\n\n같은 동네 주민끼리 안 쓰는 물건을 빌려주는 앱.\n\n## 실행\n\n    node src/index.js\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "Add item list filters and a title helper"]);
}

/** 워킹 트리가 깨끗한지. 리뷰 turn이 파일을 건드렸는지 보는 근거다. */
export function isClean(dir) {
  return git(dir, ["status", "--porcelain"]).trim() === "";
}

export { DESIGN };

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = createDriftFixture();
  console.log(`Drift fixture ready at ${dir}`);
  console.log(`  기준 ${DESIGN.decisions.length + DESIGN.rules.length}개 (DEC ${DESIGN.decisions.length}, RULE ${DESIGN.rules.length})`);
  if (!existsSync(join(dir, ".project-intel", "design.json"))) throw new Error("design.json이 만들어지지 않았습니다");
}
