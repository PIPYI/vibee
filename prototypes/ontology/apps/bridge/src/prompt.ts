/**
 * turn 프롬프트 (implementation_plan §6.9).
 *
 * spike가 확인한 것: **agent는 MCP를 자발적으로 부르지 않는다**(SPIKE_FINDINGS §6.5).
 * 그래서 무엇을 부를지 명시적으로 지시한다.
 *
 * C9의 evidence-first 제약을 넣되 한 줄을 바꾼다 — CoderMind의 "실재하는 노드만"을 그대로
 * 쓰면 엔진이 못 본 근거를 agent가 **버리게** 된다. 우리는 대신 제안하게 한다.
 */
import type { SemanticWorkSet } from "@onto/protocol";

const EVIDENCE_RULES = [
  "규칙:",
  "1. 경로·심볼·줄번호를 지어내지 마라. 모든 evidenceRefs 는 get_evidence 로 확인한 실재 id여야 한다.",
  "2. 엔진이 인덱싱하지 못한 근거를 발견했다면 **버리지 말고** propose_evidence 로 등록을 요청하라.",
  "   Core 가 검증한 뒤 id 를 발급하며, 발급받은 id 에만 grounding 할 수 있다.",
  "3. 사용자에게 보이는 label 은 파일명·함수명이 아니라 이 순서로 고른다:",
  "   ① Intent 에서 이미 쓴 용어  ② 저장소의 도메인 용어  ③ 네가 복원한 제품 의미",
  "   기술 세부는 Trace View 에서만 노출한다.",
  "4. 새 Concept 를 만들기 전에 get_concept_context 로 재사용 후보를 확인하라.",
  "   같은 의미가 분석마다 새 Concept 가 되면 실패다.",
].join("\n");

/** 첫 분석 — 아직 Semantic Memory가 없다. */
export function buildFullAnalyzePrompt(projectPath: string): string {
  return [
    "이 프로젝트의 의미 구조를 처음으로 만든다.",
    `프로젝트 경로: ${projectPath}`,
    "",
    "순서:",
    "1. get_project_semantic_memory 로 현재 상태를 확인한다 (비어 있을 것이다).",
    "2. get_evidence 로 Evidence Index 를 훑고, **저장소를 직접 탐색하며** 무엇이 중요한지 판단한다.",
    "3. 비전공자가 이해할 수 있는 Concept 와 Claim 을 만든다.",
    "",
    EVIDENCE_RULES,
  ].join("\n");
}

/**
 * 증분 분석 — 두 목록을 **구별해서** 준다 (U1).
 *
 * 뜻이 다르고 지시도 다르다. 섞으면 새 기능 발견을 놓친다.
 */
export function buildIncrementalAnalyzePrompt(projectPath: string, work: SemanticWorkSet): string {
  const affected = [
    ...work.affectedConceptIds.map((id) => `  Concept ${id}`),
    ...work.affectedClaimIds.map((id) => `  Claim ${id}`),
    ...work.affectedScenarioIds.map((id) => `  Scenario ${id}`),
  ];
  const appeared = work.ungroundedAppearedEvidenceIds;

  return [
    "코드가 바뀌었다. 의미를 따라잡아야 한다.",
    `프로젝트 경로: ${projectPath}`,
    "",
    "## 재검토할 기존 의미",
    affected.length > 0
      ? [
          "이것들의 근거가 바뀌었거나 사라졌다. 여전히 참인지 확인하고 갱신하거나 철회하라.",
          ...affected.slice(0, 40),
          affected.length > 40 ? `  ... 외 ${affected.length - 40}개` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "  (없음)",
    "",
    "## 아직 의미가 없는 새 근거",
    appeared.length > 0
      ? [
          "여기 새 기능이 있을 수 있다. get_evidence 로 살펴보고 필요하면 Concept 를 새로 만들라.",
          ...appeared.slice(0, 30).map((id) => `  ${id}`),
          appeared.length > 30 ? `  ... 외 ${appeared.length - 30}개 (전체 ${appeared.length}개)` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "  (없음)",
    "",
    EVIDENCE_RULES,
  ].join("\n");
}

/**
 * §7.3의 비교 arm — 저장소를 직접 탐색하지 않고 미리 만든 Evidence 요약만 준다.
 *
 * **탐색을 금지하지 않는다.** Codex 에 파일 도구를 확실히 끊을 방법이 없으므로,
 * 강제 대신 **탐색했는지를 측정한다.** 탐색했다면 그 자체가 findings 다.
 */
export function buildIndexOnlyPrompt(projectPath: string, bundle: string): string {
  return [
    "아래는 이 프로젝트의 Evidence Index 요약이다. **이것만으로** 의미 구조를 만들어라.",
    `프로젝트 경로: ${projectPath}`,
    "",
    "```",
    bundle,
    "```",
    "",
    EVIDENCE_RULES,
  ].join("\n");
}

/**
 * 세션 미리보기를 사람이 읽을 이름으로 바꾼다.
 *
 * provider 가 주는 미리보기는 "첫 사용자 메시지"인데 우리가 보낸 첫 메시지는 위의 래퍼다.
 * 그대로 보여주면 모든 세션이 똑같아 보여서 고를 수가 없다. 우리가 감쌌으므로 우리가 푼다.
 */
export function describeSession(preview: string): string {
  const text = preview.trim();
  if (!text) return "(빈 대화)";
  if (text.startsWith("이 프로젝트의 의미 구조를 처음으로")) return "전체 분석";
  if (text.startsWith("코드가 바뀌었다")) return "증분 분석";
  if (text.startsWith("아래는 이 프로젝트의 Evidence Index 요약")) return "분석 (index-only arm)";
  return text.replace(/\s+/gu, " ").slice(0, 80);
}
