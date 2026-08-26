# Vibee V1 — AI 아키텍처 시각화 (archify 패턴 + MCP/AI 연동) MVP

## 0. 문서 상태와 기준선

- 상태: 설계 완료, 구현 착수.
- 대상: vibee 저장소 루트에 신규로 만드는 모노레포 전체(`packages/*`, `apps/*`).
- 문서 역할: 구현 착수 전 계획을 고정한다. 구현이 끝나면 `docs/v1_impl.md`에 실제 구현 내용·스모크테스트 raw 수치·미결정 사항을 별도로 기록한다(이 문서를 사후에 고쳐쓰지 않는다).

## 1. 배경

비전공자가 프로젝트 디렉토리 경로만 입력하면 AI가 그 코드베이스를 분석해 "1) 아키텍처, 2) 사용자/시스템 흐름" 두 축으로 시각화해주는 도구를 만든다. `reference/`에 두 참고 자료가 있다.

**archify** (`reference/archify-main/`): 오픈소스 시각화 툴. 조사 결과 핵심 발견은 archify 자체에는 AI/LLM 호출 코드가 전혀 없다는 것이다. archify는 "Claude Agent Skill"이며, `SKILL.md`라는 프롬프트가 host 에이전트(예: Claude Code)에게 "저장소를 직접 읽고, 좌표까지 포함한 작은 JSON IR을 손으로 저작하고, 스키마+geometry로 검증받고, 결정론적 SVG로 렌더링하라"고 지시하는 구조다. "중요도" 판단도 알고리즘이 아니라 "6~12개 핵심 컴포넌트로 큐레이션하라"는 프롬프트 규율이며, 증분 분석도 없다(매번 전체 재저작).

**ontology 프로토타입** (`reference/prototypes/ontology/`, `reference/prototypes/docs/v1~v8`): 이전에 실제로 작업했던, MCP 서버 + Claude Agent SDK/Codex CLI 이중 오케스트레이션 + React 프론트엔드를 갖춘 훨씬 정교한 프로토타입. v7 문서가 이미 "Architecture 뷰에 archify 패턴을 도입"하는 작업을 설계·구현했고, v8 문서가 그 구현의 렌더러/검증기 품질 결함을 진단했다(중심-대-중심 직선이라 화살촉이 파묻힘, z-order 오류, 포트 분산 없음, CJK 라벨 폭 오추정, 테마 없음 등). 실제 코드(`packages/architecture-view/src/{render,geometry}.ts`, 340/762줄)를 확인한 결과 이 결함들은 이미 수정되어 있었다 — v8 문서가 지목한 156줄짜리 미수정 버전이 아니라 이미 개선된 버전이 존재한다.

**원칙(사용자 지시)**: ontology 프로토타입의 core 구조(Evidence Engine, Semantic Memory 등)는 절대 가져오지 않는다. 가져올 것은 두 가지 패턴뿐이다 — (1) MCP+AI 연동 방식, (2) 사용자/시스템 흐름 시각화 방법론. archify에서는 5종 시각화 중 architecture 시각화만 가져온다. `reference/`의 코드는 패턴만 차용하고 그대로 복사하지 않는다.

이번 라운드는 MVP 스코프다. 아키텍처 시각화 파이프라인(AI 저작 IR + 검증기 + 렌더러)과 최소 MCP+AI 연동만 실제로 동작하게 만들고, 사용자/시스템 흐름 시각화·증분 분석 토큰 절감·시퀀스 다이어그램 드릴다운은 설계 문서로만 로드맵에 남긴다(§7). AI 백엔드는 Claude Agent SDK를 실제로 완성하고 Codex CLI는 같은 인터페이스의 스텁으로만 둔다. 새 프로젝트는 vibee 저장소 루트에 완전히 새로운 모노레포로 만든다.

## 2. 목표

1. 이 문서를 구현 착수 전 첫 산출물로 남긴다.
2. 사용자가 프로젝트 경로를 입력하면: AI가 자기 자신의 Read/Grep/Glob 도구로 저장소를 탐색 → 6~12개 컴포넌트짜리 좌표 포함 JSON IR을 직접 저작 → MCP `validate_architecture_view`/`submit_architecture_view` 도구로 검증·제출 → 결정론적 TS 렌더러가 SVG로 그림 → 웹 UI에 표시한다.
3. 구현 완료 후 `docs/v1_impl.md`에 실제 구현 내용·스모크테스트 raw 수치·미결정 사항을 정리한 구현 문서를 버전명과 함께 작성한다(과장 없이).

## 3. 비목표 (이번 라운드에서 명시적으로 제외)

- **결정론적 사전 분석 엔진 없음.** ontology의 `indexProject`/`detectRepositoryTopology`/Evidence Engine 전체를 가져오지 않는다. AI의 native Read/Grep/Glob이 탐색의 100%를 담당하고, bridge는 프로젝트 경로 확인과 best-effort git revision 조회만 한다.
- **완전성(completeness) 검증 레이어 없음.** 위 항목에 의존하므로 자동 제외. 스키마 → geometry → citation 3단 검증만 한다.
- **연결(connection)에 수동 side/route/via 필드 없음.** AI는 `from/to/label/variant`만 쓰고, 앵커링·라우팅은 렌더러가 전부 자동 계산한다.
- 사용자/시스템 흐름 시각화, 증분 diff 기반 토큰 절감, 시퀀스 다이어그램 드릴다운 — 설계만 문서에 남기고 구현하지 않는다(§7).
- Codex CLI 실제 연동 — 인터페이스만 정의, 구현은 스텁.

## 4. 설계

### 4.1 모노레포 구조 (vibee 루트, npm workspaces, `@vibee/*`)

```
vibee/
  package.json, tsconfig.base.json
  docs/v1_plan.md, docs/v1_impl.md (구현 후)
  fixtures/sample-app/            # 신규 작성 소형 프론트+백엔드+DB 픽스처 (스모크테스트용, 복사 아님)
  packages/
    protocol/                      # @vibee/protocol — ArchitectureView* 타입, AgentEvent/TaskMode 등 공유 타입
    architecture-view/              # @vibee/architecture-view — schema, geometry, validator, render, citation
    mcp-server/                     # @vibee/mcp-server — stdio MCP 서버 (validate/submit 두 tool만)
  apps/
    bridge/                        # @vibee/bridge — Express+WS, Claude/Codex adapter, prompt, orchestration
    web/                           # @vibee/web — React+Vite, 프로젝트 선택 → 분석 진행 → 다이어그램 뷰
```

### 4.2 Architecture-view IR — 스키마가 유일한 source of truth

`packages/architecture-view/schemas/architecture-view.schema.json`이 유일한 정의처다. `packages/protocol/src/architecture-view.ts`의 TS 타입은 이 스키마와 손으로 동기화하되, 프롬프트에 임베드되는 스키마 텍스트와 ajv가 검증에 쓰는 스키마는 반드시 같은 파일을 읽는 같은 함수(`architectureViewSchemaText()`)에서 나와야 한다 — 이를 테스트로 강제한다(§5). 필드 구성은 archify 스키마를 참고하되 `fromSide/toSide/route/via/labelAt` 등 수동 라우팅 필드는 제외한다:

```ts
components[]: { id, type: frontend|backend|database|cloud|security|messagebus|external, label, sublabel?,
                 pos:[x,y], size:[w,h], sources?: {path,line?,endLine?,label?}[] (≤3) }
boundaries[]: { kind: region|security-group, label, wraps: string[], pad? }
connections[]: { id?, from, to, label?, variant?: default|emphasis|security|dashed }
cards[]: { dot?, title, items: string[] } (≤4)
title, viewBox?: [w,h], repository?: {url?, revision?}
components.length: 1~12
```

### 4.3 `geometry.ts` — archify/v8 교훈을 네이티브 재구현

- `automaticPortSpread`: 같은 (컴포넌트, side)에 모이는 엣지를 상대 노드 좌표순 정렬 후 균등 오프셋 — 같은 쌍 엣지가 겹쳐 그려지는 문제 방지.
- `defaultFromSide/toSide` + side 앵커링 — 중심-대-중심 직선 대신 변에서 출발/도착.
- dogleg 라우팅 후보 생성(h-first/v-first/outer-channel) → `routeClearsComponents`로 필터 — 엣지가 무관한 박스를 가로지르지 않게.
- `shortenRouteEnd(9px)` — 화살촉이 대상 박스 밑에 파묻히는 문제의 직접 수정.
- `roundedPath` — 꺾임에 부드러운 곡선.
- `labelDisplayWidth` — CJK 인지 폭 추정(한글/한자 전각 처리).
- `calculateArchitectureLayout()` 단일 함수를 렌더러와 검증기가 공유한다 — 렌더러와 검증기가 서로 다른 기하를 상상하면 AI의 자가 수정 루프가 수렴하지 않는다.
- 검증 진단은 각각 `{code, severity, message, subject, evidence, supportedFixes}`를 포함해 AI가 원인을 추측하지 않고 고칠 수 있게 한다.

### 4.4 `render.ts` — SVG 렌더러

z-order를 boundary → connection → component → label → legend 순으로 고정, variant별 marker 4개를 담은 `<defs>` 1개만 생성, 인라인 hex 대신 CSS 커스텀 프로퍼티 + `prefers-color-scheme`/`[data-theme]`로 라이트/다크 지원, 실제 사용된 컴포넌트 타입만 범례에 표시, cards는 텍스트 선택 가능한 별도 HTML/React 블록으로 렌더링. 컴포넌트/연결 요소에 `data-component-id`/`data-connection-id`를 심어 향후 클릭 인터랙션(§7-c)의 훅을 마련해둔다.

### 4.5 MCP 서버 + AI 오케스트레이션 (ontology 패턴 차용)

- MCP 서버는 상태를 갖지 않는다. stdio로 뜨고, 모든 tool 호출은 loopback HTTP로 bridge에 위임(`callBridge()` 패턴). 에러는 절대 throw하지 않고 `{error, next_step}` 구조로 반환한다.
- tool은 정확히 두 개: `validate_architecture_view`(검증만, schema→geometry→citation, layout report 포함), `submit_architecture_view`(서버 재검증 후 커밋). 파일 접근용 별도 MCP tool은 만들지 않는다 — native `Read`/`Grep`/`Glob`을 그대로 부여한다.
- bridge 오케스트레이션(Claude Agent SDK `query()`): `mcpServers`에 이 MCP 서버를 stdio로 등록, `strictMcpConfig: true`, `tools: ["Read","Grep","Glob"]`만 부여, `canUseTool` 콜백으로 `mcp__vibee__*` 허용·WebFetch/WebSearch 차단·프로젝트 경로 밖 Write/Edit 차단. 모델 ID는 하드코딩하지 않고 `supportedModels()`로 동적 조회. usage는 최종 `result` 메시지에서만 집계.
- validate+submit 왕복에 하드 캡(6회)을 건다.
- 매 분석은 항상 새 세션이다(`resetSession()` 후 시작, 절대 이전 세션 재개 없음).
- Codex 어댑터는 동일 인터페이스(`AgentAdapter`)를 구현하되 `checkReady()`가 "미구현" 상태를 반환하는 스텁으로 둔다.

### 4.6 웹 앱

경로 입력 → 에이전트/모델 선택 → 분석 시작 → 진행 중 화면(탐색 중인 파일, MCP tool 호출, 토큰 사용량 실시간 표시) → 완료 시 SVG+카드 렌더링, 남은 warning 진단 표시, 다크모드 토글.

## 5. 검증 계획

**단위 테스트**(`node --test`, 패키지별):
- 스키마: 12개 초과 컴포넌트/미지 타입/필수 필드 누락 거부.
- geometry: 포트 분산이 박스 가용 폭을 넘지 않음, 중간 박스가 있으면 우회 경로 선택, CJK 라벨 폭 우선, `shortenRouteEnd` 정확도.
- validator: 진단 코드별 최소 1개씩.
- render: z-order 회귀, `<defs>` 정확히 1개, 범례 미사용 타입 미포함.
- 프롬프트-스키마 동일성 테스트: 임베드 텍스트 재파싱 결과가 ajv 컴파일 스키마와 deep-equal.
- state: 7번째 validate/submit 호출 캡 거부.
- canUseTool: 허용/거부 조건 격리 테스트.

**수동 end-to-end 스모크 테스트**: `fixtures/sample-app` 대상 실제 Claude 모델 분석 → 탐색 이벤트 → validate 1회 이상+submit 정확히 1회 → 렌더된 SVG 품질 확인(≤12박스, 화살촉 위치, 라벨 겹침) → 다크모드 토글 → 재시작 후 결과 유지 확인 → 오류 상황에서 원시 진단 노출 확인.

**완료 기준**: 모든 단위 테스트 통과, 전 워크스페이스 typecheck 클린, 스모크 테스트 1회 end-to-end 관찰 후 raw 수치를 `docs/v1_impl.md`에 기록.

## 6. 핵심 파일

- `packages/architecture-view/schemas/architecture-view.schema.json`
- `packages/architecture-view/src/geometry.ts`, `render.ts`, `validator.ts`, `citation.ts`
- `apps/bridge/src/prompt.ts`, `agents/claude/adapter.ts`, `agents/codex/adapter.ts`
- `packages/mcp-server/src/index.ts`
- `apps/web/src/components/{ProjectPicker,AnalyzingConsole,ArchitectureView,DiagnosticsPanel}.tsx`

## 7. 로드맵 (이번 라운드 구현 대상 아님 — 문서화만)

**(a) 비전공자 관점 사용자/시스템 흐름 시각화**: ontology의 `journeyCanvas.ts` 방법론(목표별 journey 카드, entry→outcome 대표 경로 vs 분기/루프 구분, progressive disclosure) 차용. `ScenarioIR` 형태의 별도 IR + 별도 프롬프트/MCP tool로, architecture-view 파이프라인과 코드 공유 없이 구조적으로 분리한다.

**(b) 증분분석 토큰 절감 — 컨텍스트 누적 문제의 해법**: 어떤 분석도 이전 에이전트 세션을 재개하지 않는다(MVP부터 지키는 규칙). 상태는 대화 기록이 아니라 디스크에 커밋된 버전 있는 IR에만 존재한다. 증분 실행의 프롬프트는 (1) 직전 커밋된 IR + (2) 마지막 커밋 이후 변경된 파일 목록(diff 요약)만으로 재구성한다. "변경 없음" 판정은 IR이 비었는지로 추론하지 않고 `discoveryBaselineVersion` 같은 명시적 스탬프 필드로 계산한다. 제출도 전체 재제출이 아니라 `patch_architecture_view`(RFC6902 JSON Patch) tool로 diff만 보낸다.

**(c) 화살표 클릭 → 시퀀스 다이어그램 드릴다운**: AI가 명시적으로 `sequenceRef`를 부여한 연결만 클릭 가능하게 만든다(휴리스틱 추측 금지). `SequenceIR`은 `{participants, messages: [{order, kind: call|return|event, evidenceRefs}]}` 형태. 반드시 지켜야 할 것: 프롬프트 텍스트와 생성되는 스키마 다이제스트 양쪽에 `call|return|event` 세 값이 반드시 리터럴로 등장해야 하고, 이를 테스트로 강제해야 한다(이전 시도가 이 누락 때문에 return/event를 거의 생성하지 못한 선례가 있음).
