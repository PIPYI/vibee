/**
 * JSON Schema **한 벌** (implementation_plan §5 · §6.1 · A6).
 *
 * Validator ①이 ajv로 이것을 돌린다. 타입과 schema가 두 곳에 흩어지면 한쪽만 고쳐지므로
 * 여기 한 곳에만 둔다. 브라우저 번들이 import 해도 안전하도록 Node 내장 모듈을 쓰지 않는다.
 *
 * ## 왜 draft-07 인가
 *
 * ajv 8의 기본 export가 draft-07이다. 2020-12를 쓰려면 `ajv/dist/2020`을 따로 물어야 하는데,
 * 우리가 쓰는 키워드(`enum` · `required` · `additionalProperties` · `minItems`)는 두 draft에서
 * 같으므로 얻는 것이 없다.
 *
 * ## 두 가지를 일부러 schema에서 뺐다
 *
 * 1. **`maxItems`를 넣지 않는다** (§6.7). 정보량 초과는 warning이지 거절 사유가 아니다.
 * 2. **`createdAtVersion` / `updatedAtVersion`을 required로 두지 않는다.** 버전은 agent가 아니라
 *    Core가 찍는다 (I1 — 의미는 AI, 측정은 Core). agent가 보내오면 Core가 덮어쓴다.
 */

/** 자유 문자열이지만 비어 있으면 안 되는 것들에 공통으로 쓴다. */
const nonEmptyString = { type: "string", minLength: 1 } as const;
const stringArray = { type: "array", items: { type: "string" } } as const;
const evidenceRefs = { type: "array", items: nonEmptyString } as const;
const confidence = { type: "number", minimum: 0, maximum: 1 } as const;
const version = { type: "integer", minimum: 0 } as const;

const sourceRange = {
  type: "object",
  additionalProperties: false,
  required: ["startLine"],
  properties: {
    startLine: { type: "integer", minimum: 1 },
    endLine: { type: "integer", minimum: 1 },
  },
} as const;

const entityRef = {
  type: "object",
  required: ["kind"],
  oneOf: [
    {
      additionalProperties: false,
      required: ["kind", "filePath"],
      properties: { kind: { const: "file" }, filePath: nonEmptyString },
    },
    {
      additionalProperties: false,
      required: ["kind", "symbolId"],
      properties: { kind: { const: "symbol" }, symbolId: nonEmptyString },
    },
    {
      additionalProperties: false,
      required: ["kind", "routeKey"],
      properties: { kind: { const: "route" }, routeKey: nonEmptyString },
    },
    {
      additionalProperties: false,
      required: ["kind", "modelKey"],
      properties: { kind: { const: "model" }, modelKey: nonEmptyString },
    },
  ],
} as const;

const concept = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "evidenceRefs", "status"],
  properties: {
    id: nonEmptyString,
    name: nonEmptyString,
    description: { type: "string" },
    aliases: stringArray,
    // §6 I3 — 전역 node type이 아니다. 검색·레이아웃 보조일 뿐이고 틀려도 의미는 유효하다.
    hints: stringArray,
    evidenceRefs,
    intentRefs: stringArray,
    confidence,
    status: { enum: ["active", "uncertain", "deprecated", "needs_review"] },
    createdAtVersion: version,
    updatedAtVersion: version,
  },
} as const;

const claim = {
  type: "object",
  additionalProperties: false,
  required: ["id", "subjectConceptId", "predicate", "object", "evidenceRefs", "status"],
  properties: {
    id: nonEmptyString,
    subjectConceptId: nonEmptyString,
    // §8 I3 — enum이 아니다. 고정 vocabulary로 정규화하는 순간 의미가 깎인다.
    predicate: nonEmptyString,
    object: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["conceptId"],
          properties: { conceptId: nonEmptyString },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["value"],
          properties: { value: { type: "string" } },
        },
      ],
    },
    description: { type: "string" },
    semanticHint: { type: "string" },
    evidenceRefs,
    intentRefs: stringArray,
    confidence,
    status: { enum: ["active", "uncertain", "contradicted", "needs_review"] },
    createdAtVersion: version,
    updatedAtVersion: version,
  },
} as const;

const canonicalScenario = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "type", "anchorConceptIds", "status"],
  properties: {
    id: nonEmptyString,
    name: nonEmptyString,
    type: { enum: ["user", "system"] },
    goal: { type: "string" },
    anchorConceptIds: { type: "array", items: nonEmptyString },
    status: { enum: ["active", "uncertain", "deprecated"] },
    createdAtVersion: version,
    updatedAtVersion: version,
  },
} as const;

const groundingUpdate = {
  type: "object",
  required: ["target", "evidenceRefs"],
  oneOf: [
    {
      additionalProperties: false,
      required: ["target", "conceptId", "evidenceRefs"],
      properties: {
        target: { const: "concept" },
        conceptId: nonEmptyString,
        evidenceRefs,
        confidence,
      },
    },
    {
      additionalProperties: false,
      required: ["target", "claimId", "evidenceRefs"],
      properties: {
        target: { const: "claim" },
        claimId: nonEmptyString,
        evidenceRefs,
        confidence,
      },
    },
  ],
} as const;

/**
 * `submit_semantic_patch`의 payload (§16 · R3).
 *
 * `base*Version`이 **required**인 것이 중요하다 — 빠뜨리면 stale write 차단(⓪)이 통째로
 * 무력화되는데, schema가 없으면 그 사실이 조용히 지나간다.
 */
export const SEMANTIC_PATCH_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "onto://schemas/semantic-patch.json",
  title: "SemanticPatch",
  type: "object",
  additionalProperties: false,
  required: ["baseAnalysisVersion", "baseSemanticVersion"],
  properties: {
    baseAnalysisVersion: version,
    baseSemanticVersion: version,
    addedConcepts: { type: "array", items: concept },
    updatedConcepts: { type: "array", items: concept },
    removedConceptIds: { type: "array", items: nonEmptyString },
    addedClaims: { type: "array", items: claim },
    updatedClaims: { type: "array", items: claim },
    removedClaimIds: { type: "array", items: nonEmptyString },
    addedScenarios: { type: "array", items: canonicalScenario },
    updatedScenarios: { type: "array", items: canonicalScenario },
    removedScenarioIds: { type: "array", items: nonEmptyString },
    groundingUpdates: { type: "array", items: groundingUpdate },
  },
} as const;

// ---------------------------------------------------------------------------
// View IR (§6.6~§6.8, §22, §28~§33)
// ---------------------------------------------------------------------------

/**
 * `submit_view_ir`의 `overview` payload (§22).
 *
 * **`maxItems`가 없다** (§6.7) — 정보량 초과는 `view-validator`의 soft budget이 warning으로
 * 다루지, schema가 거절하지 않는다.
 */
export const OVERVIEW_IR_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "onto://schemas/overview-ir.json",
  title: "OverviewIR",
  type: "object",
  additionalProperties: false,
  required: ["title", "areas"],
  properties: {
    title: nonEmptyString,
    areas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "items"],
        properties: {
          id: nonEmptyString,
          label: nonEmptyString,
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label"],
              properties: {
                id: nonEmptyString,
                label: nonEmptyString,
                conceptRefs: stringArray,
                scenarioRefs: stringArray,
              },
            },
          },
        },
      },
    },
    importantConnections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to"],
        properties: {
          from: nonEmptyString,
          to: nonEmptyString,
          label: { type: "string" },
        },
      },
    },
  },
} as const;

const scenarioParticipant = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label"],
  properties: {
    id: nonEmptyString,
    label: nonEmptyString,
    conceptRefs: stringArray,
    // Renderer의 lane 배치 힌트일 뿐이다 — semantic correctness가 이것에 의존하지 않는다.
    layoutHint: { type: "string" },
  },
} as const;

const scenarioStep = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "conceptRefs", "evidenceRefs"],
  properties: {
    id: nonEmptyString,
    label: nonEmptyString,
    participantId: { type: "string" },
    conceptRefs: stringArray,
    claimRefs: stringArray,
    // acceptance 15 — 비어 있으면 안 된다. 그 판단은 schema가 아니라 view-validator가 한다.
    evidenceRefs,
    confidence,
  },
} as const;

const scenarioTransition = {
  type: "object",
  additionalProperties: false,
  required: ["fromStepId", "toStepId", "evidenceRefs"],
  properties: {
    fromStepId: nonEmptyString,
    toStepId: nonEmptyString,
    condition: { type: "string" },
    // back edge인가 (R5). true면 view-validator가 condition을 요구한다.
    loop: { type: "boolean" },
    // schema2 §5 — 없으면 "call"과 같다. loop와 다른 축이므로 같이 있어도 된다.
    kind: { enum: ["call", "return"] },
    evidenceRefs,
    confidence,
  },
} as const;

// schema2 §5 — activation/phase 모두 좌표가 아니라 step id 참조로만 표현한다 (A7·A12).
const scenarioActivation = {
  type: "object",
  additionalProperties: false,
  required: ["participantId", "fromStepId", "toStepId", "evidenceRefs"],
  properties: {
    participantId: nonEmptyString,
    fromStepId: nonEmptyString,
    toStepId: nonEmptyString,
    evidenceRefs,
  },
} as const;

const scenarioPhase = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "fromStepId", "toStepId", "evidenceRefs"],
  properties: {
    id: nonEmptyString,
    label: nonEmptyString,
    fromStepId: nonEmptyString,
    toStepId: nonEmptyString,
    evidenceRefs,
  },
} as const;

const scenarioBranch = {
  type: "object",
  additionalProperties: false,
  required: ["sourceStepId", "conditionLabel", "evidenceRefs", "paths"],
  properties: {
    sourceStepId: nonEmptyString,
    conditionLabel: nonEmptyString,
    conceptRefs: stringArray,
    claimRefs: stringArray,
    evidenceRefs,
    paths: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "nextStepId"],
        properties: { label: nonEmptyString, nextStepId: nonEmptyString },
      },
    },
  },
} as const;

const scenarioStateChange = {
  type: "object",
  additionalProperties: false,
  required: ["subjectConceptId", "causedByStepId", "evidenceRefs"],
  properties: {
    subjectConceptId: nonEmptyString,
    from: { type: "string" },
    to: { type: "string" },
    changeKind: { enum: ["create", "update", "delete", "state_transition"] },
    causedByStepId: nonEmptyString,
    evidenceRefs,
  },
} as const;

/**
 * `submit_view_ir`의 `scenario` payload (§28~§33).
 *
 * **좌표 필드가 없다** (A7) — layout은 렌더러가 결정론적으로 계산한다.
 * **DAG를 요구하지 않는다** (R5) — `entryStepId`/`outcomeStepIds`만 요구한다.
 */
export const SCENARIO_IR_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "onto://schemas/scenario-ir.json",
  title: "ScenarioIR",
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "type", "participants", "steps", "transitions", "entryStepId", "outcomeStepIds"],
  properties: {
    id: nonEmptyString,
    name: nonEmptyString,
    type: { enum: ["user", "system"] },
    goal: { type: "string" },
    outcome: { type: "string" },
    participants: { type: "array", items: scenarioParticipant },
    steps: { type: "array", items: scenarioStep },
    transitions: { type: "array", items: scenarioTransition },
    branches: { type: "array", items: scenarioBranch },
    stateChanges: { type: "array", items: scenarioStateChange },
    activations: { type: "array", items: scenarioActivation },
    phases: { type: "array", items: scenarioPhase },
    entryStepId: nonEmptyString,
    outcomeStepIds: { type: "array", items: nonEmptyString },
    evidenceRefs: stringArray,
    confidence,
  },
} as const;

/**
 * `propose_evidence`의 payload (§6.5 R2).
 *
 * **`id`가 없다.** agent는 evidence id를 직접 쓰지 않는다 — Core가 검증한 뒤 발급한다.
 * schema에 `additionalProperties: false`를 두었으므로 `id`를 실어 보내면 여기서 걸린다.
 */
export const EVIDENCE_PROPOSAL_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "onto://schemas/evidence-proposal.json",
  title: "EvidenceProposal",
  type: "object",
  additionalProperties: false,
  required: ["kind", "filePath", "location", "summary"],
  properties: {
    kind: nonEmptyString,
    filePath: nonEmptyString,
    location: sourceRange,
    symbolHint: { type: "string" },
    summary: nonEmptyString,
    confidence,
    normalizationProfile: { enum: ["code", "prose"] },
    graph: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["role", "entity", "label"],
          properties: { role: { const: "entity" }, entity: entityRef, label: nonEmptyString },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["role", "from", "to", "linkKind"],
          properties: {
            role: { const: "link" },
            from: entityRef,
            to: entityRef,
            linkKind: nonEmptyString,
          },
        },
      ],
    },
  },
} as const;
