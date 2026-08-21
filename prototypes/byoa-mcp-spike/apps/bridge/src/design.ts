/**
 * 설계 산출물(일곱 단위)의 검증과 렌더링.
 *
 * `docs/requirements_flow.md` §4.11의 전제 — **사람용 설명과 harness는 모두 이 데이터에서
 * 렌더된다** — 를 구현하는 층이다. 산문이 원본이고 데이터가 파생물인 것이 아니라 그 반대다.
 *
 * 여기서 모델을 부르지 않는다. 렌더링은 전부 결정론적이다.
 */
import type { DesignDoc } from "@byoa/protocol";

/** 생성된 산출물임을 알리는 표식. 사람이 쓴 파일을 덮어쓰지 않기 위한 근거가 된다. */
export const HARNESS_MARKER = "<!-- byoa:generated -->";

/**
 * id 교차 참조 검증.
 *
 * agent가 존재하지 않는 REQ를 가리키는 SURFACE를 만들어도 스키마 검증은 통과한다. 그러면
 * 화면 목록이 조용히 비게 되므로, **조용히 넘기지 않고** save_design 응답으로 되돌려 준다
 * (SPIKE_FINDINGS.md §8의 "조용한 성공보다 시끄러운 실패").
 */
export function validateDesign(design: DesignDoc): string[] {
  const warnings: string[] = [];
  const actors = new Set(design.actors.map((a) => a.id));
  const reqs = new Set(design.reqs.map((r) => r.id));
  const surfaces = new Set(design.surfaces.map((s) => s.id));
  const entities = new Set(design.entities.map((e) => e.id));
  const rules = new Set(design.rules.map((r) => r.id));

  const check = (where: string, kind: string, id: string | undefined, known: Set<string>): void => {
    if (id && !known.has(id)) warnings.push(`${where}: unknown ${kind} "${id}"`);
  };

  for (const surface of design.surfaces) {
    for (const req of surface.shows) check(`surface ${surface.id}`, "REQ", req, reqs);
  }
  for (const rule of design.rules) {
    for (const req of rule.constrains) check(`rule ${rule.id}`, "REQ", req, reqs);
  }
  for (const flow of design.flows) {
    flow.steps.forEach((step, index) => {
      const where = `flow ${flow.id} step ${index + 1}`;
      check(where, "ACTOR", step.actor, actors);
      check(where, "SURFACE", step.surface, surfaces);
      check(where, "ENTITY", step.entity, entities);
      check(where, "RULE", step.rule, rules);
    });
  }

  return warnings;
}

/**
 * 설계가 얼마나 채워졌는지. §4.10의 "부실한 채로 끝내려 하면 경고만 하고 보내준다"에서
 * 무엇을 경고할지 판단하는 근거가 된다. 막지는 않는다.
 */
export function designGaps(design: DesignDoc): string[] {
  const gaps: string[] = [];
  if (design.actors.length === 0) gaps.push("누가 쓰는지(ACTOR)가 비어 있습니다.");
  if (design.reqs.length === 0) gaps.push("무엇을 할 수 있는지(REQ)가 비어 있습니다.");
  if (design.surfaces.length === 0) gaps.push("화면(SURFACE)이 비어 있습니다.");
  if (design.entities.length === 0) gaps.push("무엇이 저장되는지(ENTITY)가 비어 있습니다.");
  if (design.flows.length === 0) gaps.push("동작 순서(FLOW)가 비어 있습니다.");
  if (design.decisions.length === 0) gaps.push("정해둔 것(DEC)이 비어 있습니다.");

  // 순서가 FLOW의 존재 이유다. 한 단계짜리 FLOW는 순서를 담지 못한다.
  const thin = design.flows.filter((flow) => flow.steps.length < 2);
  if (thin.length > 0) {
    gaps.push(`단계가 하나뿐인 흐름이 ${thin.length}개 있습니다: ${thin.map((f) => f.name).join(", ")}`);
  }

  // 관계가 없는 ENTITY만 있으면 entity relation 다이어그램을 그릴 수 없다.
  if (design.entities.length > 1 && design.entities.every((entity) => entity.relations.length === 0)) {
    gaps.push("저장되는 것들 사이의 관계가 하나도 없습니다.");
  }

  return gaps;
}

// ---------- 렌더링 (docs/requirements_flow.md §5) ----------

/**
 * 사람용 설명 (§5).
 *
 * **목록이 아니라 시나리오로 쓴다.** 목록은 "빠진 것"을 찾게 하지만 시나리오는 "틀린 것"을
 * 찾게 하고, 비전공자에게는 후자가 훨씬 쉽다. FLOW의 단계가 이미 순서 있는 문장이므로
 * 그것을 이어 붙이면 시나리오가 된다 — 여기서 모델을 부를 필요가 없다.
 *
 * DEC도 함께 섞는다. 사용자가 "어? 이건 되는 줄 알았는데"라고 반응하는 지점이 곧
 * 지금 잡아야 할 오해다.
 */
export function renderNarrative(design: DesignDoc): string {
  const out: string[] = [`# ${design.title}`, "", design.summary, ""];
  const nameOf = lookup(design);

  if (design.actors.length > 0) {
    out.push("## 누가 쓰나요", "");
    for (const actor of design.actors) {
      out.push(`- **${actor.name}**${actor.note ? ` — ${actor.note}` : ""}`);
    }
    out.push("");
  }

  if (design.flows.length > 0) {
    out.push("## 이렇게 동작합니다", "");
    for (const flow of design.flows) {
      out.push(`### ${flow.name}${flow.source === "ai" ? " *(제가 정했습니다)*" : ""}`, "");
      // 단계를 한 문단으로 이어 붙인다. 번호 목록으로 두면 다시 "목록"이 되어 버린다.
      // agent가 쓰는 단계 문장에는 마침표가 없을 때가 많아 그대로 이으면 한 덩어리가 된다.
      out.push(flow.steps.map((step) => asSentence(step.action)).join(" "), "");

      const applied = uniq(flow.steps.map((step) => step.rule).filter(isString));
      if (applied.length > 0) {
        out.push(...applied.map((id) => `> ${nameOf.rule(id)}`), "");
      }
    }
  }

  if (design.surfaces.length > 0) {
    // 기능은 추상적이지만 화면은 구체적이라 머릿속에 앱을 그려볼 수 있다 (§4.7).
    out.push("## 화면", "");
    for (const surface of design.surfaces) {
      const reqs = surface.shows.map((id) => nameOf.req(id)).filter(Boolean);
      // REQ 이름은 "사진을 올린다"처럼 서술형이라 조사를 붙이면 문장이 깨진다. 그대로 나열한다.
      const detail = surface.note ?? reqs.join(" · ");
      out.push(`- **${surface.name}**${detail ? ` — ${detail}` : ""}${aiMark(surface.source)}`);
    }
    out.push("");
  }

  const userDecisions = design.decisions.filter((d) => d.source === "user");
  const aiDecisions = design.decisions.filter((d) => d.source === "ai");

  if (userDecisions.length > 0) {
    out.push("## 이렇게 하기로 했습니다", "");
    for (const decision of userDecisions) out.push(`- ${decision.text} — ${decision.why}`);
    out.push("");
  }

  if (aiDecisions.length > 0) {
    // §4.8 — AI가 채운 것은 반드시 표시한다. 사용자가 고칠 수 있어야 하기 때문이다.
    out.push("## 제가 대신 정한 것", "", "말씀하지 않으신 부분입니다. 다르면 알려주세요.", "");
    for (const decision of aiDecisions) out.push(`- ${decision.text} — ${decision.why}`);
    out.push("");
  }

  return out.join("\n").trimEnd() + "\n";
}

/**
 * 에이전트용 설계도 `app_design.md` (§5, §6).
 *
 * 에이전트가 유스케이스 · entity relation · flow · activity · state · sequence를 도출할 수
 * 있어야 하므로 일곱 단위를 id와 함께 그대로 싣는다. 사람용과 달리 산문으로 풀지 않는다.
 */
export function renderAppDesign(design: DesignDoc): string {
  const out: string[] = [
    HARNESS_MARKER,
    `# ${design.title} — 설계`,
    "",
    "> 요구사항 인터뷰로 자동 생성되었습니다. 사람이 직접 고치지 마세요.",
    "> 바꿔야 할 것이 있으면 앱에서 인터뷰를 이어가세요.",
    "",
    design.summary,
    "",
    "## ACTOR — 누가 쓰는가",
    "",
  ];

  for (const actor of design.actors) {
    out.push(`- \`${actor.id}\` **${actor.name}**${actor.note ? ` — ${actor.note}` : ""}`);
  }

  out.push("", "## REQ — 무엇을 할 수 있는가", "");
  for (const req of design.reqs) {
    out.push(`- \`${req.id}\` ${req.name}${req.note ? ` — ${req.note}` : ""}`);
  }

  out.push("", "## SURFACE — 어디서 하는가", "");
  for (const surface of design.surfaces) {
    const shows = surface.shows.length > 0 ? ` → ${surface.shows.join(", ")}` : "";
    out.push(`- \`${surface.id}\` ${surface.name}${shows}`);
    if (surface.note) out.push(`  - ${surface.note}`);
  }

  out.push("", "## ENTITY — 무엇이 저장되는가", "");
  for (const entity of design.entities) {
    out.push(`- \`${entity.id}\` **${entity.name}**`);
    for (const relation of entity.relations) out.push(`  - 관계: ${relation}`);
    if (entity.states.length > 0) out.push(`  - 상태: ${entity.states.join(" → ")}`);
  }

  out.push("", "## FLOW — 단계의 순서", "");
  for (const flow of design.flows) {
    out.push(`### \`${flow.id}\` ${flow.name}`, "");
    flow.steps.forEach((step, index) => {
      const parts = [
        step.actor ? `누가: ${step.actor}` : null,
        step.surface ? `어디서: ${step.surface}` : null,
        step.entity ? `무엇에: ${step.entity}` : null,
        step.effect ? `결과: ${step.effect}` : null,
        step.rule ? `규칙: ${step.rule}` : null,
      ].filter(isString);
      out.push(`${index + 1}. ${step.action}`);
      if (parts.length > 0) out.push(`   - ${parts.join(" · ")}`);
    });
    out.push("");
  }

  out.push("## RULE — 조건 · 제약", "");
  for (const rule of design.rules) {
    const constrains = rule.constrains.length > 0 ? ` (${rule.constrains.join(", ")})` : "";
    out.push(`- \`${rule.id}\` ${rule.text}${constrains}`);
  }

  // 출처를 남기는 유일한 절이다. 다른 단위와 달리 DEC은 출처에 따라 **구속력이 다르다** —
  // 사용자가 말한 결정은 조용히 뒤집으면 안 되고, AI 기본값은 막혔을 때 되물을 수 있다.
  // 나머지 단위의 출처는 `.project-intel/design.json`에 그대로 남는다 (§7).
  out.push(
    "",
    "## DEC — 왜 그렇게 정했는가",
    "",
    "`[사용자 결정]`은 사용자가 직접 말한 것입니다. 뒤집지 마세요.",
    "`[AI 기본값]`은 인터뷰에서 정해지지 않아 대신 채운 것입니다. 더 나은 판단이 있으면",
    "바꿔도 되지만, 멈춰서 묻지 말고 **바꾼 것을 끝나고 함께 알려주세요.**",
    "",
  );
  for (const decision of design.decisions) {
    const origin = decision.source === "user" ? "[사용자 결정]" : "[AI 기본값]";
    out.push(`- \`${decision.id}\` ${origin} ${decision.text}`);
    out.push(`  - 이유: ${decision.why}`);
  }

  return out.join("\n").trimEnd() + "\n";
}

function lookup(design: DesignDoc) {
  const reqs = new Map(design.reqs.map((r) => [r.id, r.name]));
  const rules = new Map(design.rules.map((r) => [r.id, r.text]));
  return {
    req: (id: string) => reqs.get(id) ?? "",
    rule: (id: string) => rules.get(id) ?? id,
  };
}

/** AI가 채운 항목 표시 (§4.8). 사용자가 무엇을 검토해야 하는지 알 수 있어야 한다. */
function aiMark(source: string): string {
  return source === "ai" ? " *(제가 정했습니다)*" : "";
}

/** 문장 끝에 종결 부호가 없으면 붙인다. 없으면 이어 붙였을 때 한 덩어리가 된다. */
function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…。]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ---------- harness (docs/requirements_flow.md §6) ----------

/** §6 — 규칙이 많아지면 오히려 무시된다. "하지 말 것"은 이 수를 넘기지 않는다. */
const MAX_AVOID = 5;

/**
 * agent harness (`AGENTS.md` / `CLAUDE.md`).
 *
 * **규율만 넣는다.** 프로젝트가 무엇인지는 `app_design.md`가 말한다. 여기에 기능 명세를
 * 복사해 넣으면 두 문서가 어긋났을 때 무엇이 맞는지 알 수 없게 된다.
 *
 * 두 파일은 이름과 대상 도구만 다르고 **같은 소스에서 렌더된다** (§6).
 */
export function renderHarness(design: DesignDoc, kind: "AGENTS.md" | "CLAUDE.md"): string {
  const tool = kind === "AGENTS.md" ? "Codex" : "Claude Code";
  const { avoid, constraints } = splitForHarness(design);

  const out: string[] = [
    HARNESS_MARKER,
    `# ${kind}  (요구사항 인터뷰로 자동 생성 — 직접 고치지 마세요)`,
    "",
    `${tool}가 이 프로젝트에서 작업할 때 지켜야 할 규칙입니다.`,
    "바꿔야 할 것이 있으면 파일을 고치지 말고 앱에서 인터뷰를 이어가세요.",
    "",
    "## 작업 전",
    "",
    // harness는 자동 로드되지만 app_design.md는 아무도 읽으라고 하지 않으면 읽히지 않는다.
    // 그래서 harness가 설계로 가는 포인터 역할을 해야 한다 (§6).
    "`app_design.md`를 먼저 읽으세요. 무엇을 만드는지 거기 있습니다.",
    "",
    "## 한 번에 끝까지 만드세요",
    "",
    // 사용자는 중간 과정을 보고 판단할 수 없는 사람이다. 단계마다 확인을 요구하면
    // 답할 수 없는 질문 앞에 세워 두는 것이고, 그러면 그 자리에서 이탈한다.
    "이 프로젝트의 주인은 **한 번 실행하면 동작하는 결과물**을 원합니다.",
    "중간 과정을 보고 판단할 수 있는 사람이 아닙니다.",
    "",
    "- 기능 하나를 만들고 멈춰서 확인받지 마세요. **설계 전체를 끝까지 만드세요.**",
    "- 일이 크면 하위 에이전트에게 나눠 맡기고, 돌아온 결과를 직접 연결하고 검토하세요.",
    "  사용자에게 보고할 것은 조각이 아니라 **연결되어 동작하는 결과물**입니다.",
    "- 설계에 없거나 서로 어긋나는 것을 만나면 **멈추지 말고** 판단해서 진행하세요.",
    "  그렇게 정한 것들을 모아 두었다가 끝나고 한 번에 알려주면 됩니다.",
    '- 다 만들었으면 실제로 실행해 보세요. "동작합니다"는 실행해서 확인한 뒤에만 하는 말입니다.',
    "",
    // 커밋은 **되돌릴 지점**이지 진행 상황 보고가 아니다. 사용자는 되돌리는 법을 모르므로
    // 지점은 촘촘할수록 좋다. 멈추지만 않으면 end-to-end와 충돌하지 않는다.
    "## 커밋은 자주, 멈추지는 말고",
    "",
    "사용자는 되돌리는 법을 모릅니다. 무언가 잘못됐을 때 돌아갈 지점을 남기는 것이",
    "커밋의 목적입니다. 진행 상황을 보고하려는 것이 아닙니다.",
    "",
    "- 의미 있는 단위가 끝날 때마다 **자주 커밋하세요.** 지점이 촘촘할수록 안전합니다.",
    "- 커밋하려고 멈추거나 사용자에게 확인받지 마세요. 그냥 하고 계속 진행하세요.",
    "- 커밋 메시지는 무엇이 달라졌는지 **사용자가 읽고 알아볼 수 있게** 쓰세요.",
    "- **원격 저장소는 없습니다.** `push` 하지 말고, 원격을 추가하지도 마세요.",
    "",
    "## 사용자에게 설명할 때",
    "",
    "코드를 읽지 못하고, 무엇이 잘못됐는지 판단하지 못합니다. 그래서:",
    "",
    "- 무엇을 만들었는지 **동작으로** 설명하세요. 파일 이름과 함수 이름으로 설명하지 마세요.",
    "- 기술 용어를 쓰려면 한 줄 풀이를 붙이세요.",
    "- 새 라이브러리를 추가했다면 왜 필요했는지 한 줄로 알려주세요.",
    "",
    "## 하지 말 것",
    "",
    "사용자는 무엇이 사라졌는지 알아채지 못합니다.",
    "",
    "- 사용자가 만든 파일을 임의로 삭제하지 마세요.",
    "- 폴더 구조를 임의로 재구성하지 마세요.",
  ];

  for (const decision of avoid.slice(0, MAX_AVOID)) {
    out.push(`- ${decision.text} (${decision.id})`);
  }

  if (constraints.length > 0) {
    out.push("", "## 이 프로젝트에서 정해진 것", "");
    out.push("인터뷰에서 나온 결정입니다. 어기면 설계와 코드가 어긋납니다.", "");
    for (const item of constraints) out.push(`- ${item.text} (${item.id})`);
  }

  const overflow = avoid.length - MAX_AVOID;
  if (overflow > 0) {
    // §6 — 규칙이 많아지면 희석된다. 넘치는 것은 설계 문서로 미룬다.
    out.push("", `> 나머지 결정 ${overflow}건은 \`app_design.md\`의 DEC 절에 있습니다.`);
  }

  out.push(
    "",
    "## 코드 규칙",
    "",
    "- 주석은 한글로 쓰세요. 사용자가 나중에 읽습니다.",
    "",
    "---",
    "",
    "이 파일은 권고이지 강제가 아닙니다. 어긋난 것을 실제로 잡아내는 일은 코드가 완성된 뒤",
    "프로젝트 인텔리전스 앱이 담당합니다.",
  );

  return out.join("\n") + "\n";
}

/**
 * DEC을 "하지 말 것"과 "정해진 것"으로 나눈다.
 *
 * **원문을 그대로 싣는다.** 명령문으로 바꿔 쓰면 의미가 뒤집힐 위험이 있고, 어느 절에
 * 놓이든 문장 자체가 뜻을 담고 있으므로 분류가 빗나가도 해롭지 않다.
 */
function splitForHarness(design: DesignDoc): {
  avoid: Array<{ id: string; text: string }>;
  constraints: Array<{ id: string; text: string }>;
} {
  const avoid: Array<{ id: string; text: string }> = [];
  const constraints: Array<{ id: string; text: string }> = [];

  for (const decision of design.decisions) {
    (isProhibition(decision.text) ? avoid : constraints).push({ id: decision.id, text: decision.text });
  }
  // RULE은 제약이므로 언제나 "정해진 것"이다.
  for (const rule of design.rules) constraints.push({ id: rule.id, text: rule.text });

  return { avoid, constraints };
}

/** 금지형 서술인지. 한국어 부정 종결을 본다. 빗나가도 문장은 그대로 남는다. */
function isProhibition(text: string): boolean {
  return /(않는다|않습니다|안 한다|없다|없습니다|제외|미룬다|미룹니다|넣지|만들지|하지 않)/.test(text);
}

/**
 * 인계 시 보여줄 첫 프롬프트 제안 (§7).
 *
 * 비전공자는 빈 창을 마주하면 막힌다. 무엇부터 시킬지 문장 하나를 쥐여 준다.
 * 사용자가 직접 말한 REQ를 우선한다 — agent가 채운 것보다 사용자의 의도에 가깝다.
 */
export function suggestFirstPrompt(design: DesignDoc): string {
  // 기능 하나를 지목하면 거기서부터 단계별로 만들게 되고, 사용자는 매 단계 판단을
  // 요구받는다. 답할 수 없는 질문이다. **한 번에 끝까지**를 프롬프트에 못 박는다.
  const name = design.title.trim();
  return (
    `app_design.md를 읽고 ${name ? `"${name}"${objectParticle(name)} ` : ""}처음부터 끝까지 만들어줘. ` +
    `다 만들면 실행해서 동작하는지 확인하고, 무엇을 만들었는지 알려줘.`
  );
}

/** 목적격 조사. 마지막 글자에 받침이 있으면 "을", 없으면 "를". */
function objectParticle(word: string): "을" | "를" {
  const last = word.codePointAt(word.length - 1) ?? 0;
  // 한글 음절 영역이 아니면(영문·숫자로 끝나면) 받침 판정이 불가능하므로 "를"로 둔다.
  if (last < 0xac00 || last > 0xd7a3) return "를";
  return (last - 0xac00) % 28 === 0 ? "를" : "을";
}
