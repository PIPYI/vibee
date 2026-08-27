# Vibee V2 구현 문서 — Runtime Architecture 시각화 고도화

## 0. 문서 상태

- 상태: **구현 완료, 검증 완료 (일부 항목은 미확인으로 명시).**
- 대응 계획 문서: `docs/v2_plan.md`
- 이 문서는 v1_impl.md와 동일한 원칙을 따른다: 실제로 실행하고 관찰한 것만 "확인됨"으로 적고, 관찰하지 못한 것은 "미확인"으로 명시한다. 과장된 성공 주장을 하지 않는다.
- 구현은 4개의 백그라운드 서브에이전트 단계(Stage 1~3 + fixture 빌드)와, 라이브 테스트 중 발견된 버그 1건에 대한 별도 수정 에이전트로 진행했다. 각 단계 완료 후 오케스트레이터(나)가 직접 `build`/`typecheck`/`test`를 재실행해 서브에이전트의 보고를 검증했다.

---

## 1. 실제 구현된 범위

계획서(§2 목표) 대비 구현 범위:

| 계획 항목 | 상태 |
|---|---|
| RuntimeSemanticDocument 신규 타입/스키마/검증기 | 완료 |
| ArchitectureView V2 스키마 (semanticRole/semanticRefs/presentation/runtime boundary) | 완료 |
| Semantic mapping 검증 (architecture ↔ semantic 상호 참조) | 완료 |
| Audience presentation projection (simple/technical, 순수 함수) | 완료 |
| Renderer의 audience-aware 렌더링, actor/runtime 시각적 구분 | 완료 |
| Weak exemplar 4종 (composition 단계) | 완료 |
| MCP `submit_runtime_semantics` 신규 tool | 완료 |
| Bridge의 semantic revision 저장/연결, 2단계 파이프라인 강제 | 완료 |
| Prompt를 역할별 모듈로 분리 (`prompts/*.ts`) | 완료 |
| 웹 UI: 쉬운 보기/기술 구조 탭, Detail Inspector, 클릭 선택 | 완료 |
| 4종 topology fixture 신규 작성 | 완료 (3종 신규 + 기존 sample-app 1종 재사용) |
| 4개 fixture 전체에 대한 실제 라이브 E2E 실행 | 완료 (§4) |
| 브라우저 실제 시각 검증 (§15) | **미확인** — 브라우저 도구 없음 (§6) |
| Codex 실연동 | 비목표 그대로 스텁 유지 (변경 없음) |
| 로드맵 (a)(b)(c) 사용자 흐름/증분분석/시퀀스 드릴다운 | 계획 문서에만 존재, 미구현 (계획대로) |

---

## 2. 아키텍처 변경 요약

### 2.1 패키지 구조 결정

계획서 §22는 `packages/runtime-semantic`을 별도 워크스페이스로 둘지 `packages/architecture-view`에 합칠지 "구현 시 결정"하도록 열어두었다. **`packages/architecture-view` 내부에 합치는 쪽으로 결정했다** (신규 워크스페이스/빌드 순서 변경 없이 기존 5개 패키지 구조를 그대로 유지). 근거: 이번 라운드에서 semantic model은 architecture 시각화 전용이고(§21 로드맵의 journey/sequence 재사용은 아직 실현되지 않음), 별도 패키지를 만들 실익보다 빌드 그래프 단순성이 더 크다고 판단했다.

### 2.2 스키마 버전

`ArchitectureViewDocument.schemaVersion`을 `1`에서 `2`로 올렸다 (breaking, 마이그레이션 없음 — 라이브 프로덕션 데이터가 없는 내부 개발 도구이므로). `RuntimeSemanticDocument`는 `schemaVersion: 1`로 신규 도입.

### 2.3 신규 타입 (`packages/protocol/src/runtime-semantic.ts`)

`SourceRef`, `ImplementationHint`, `RuntimeActor`, `RuntimeUnit`, `RuntimeResponsibility`, `RuntimeState`, `RuntimeExternal`, `RuntimeInteraction`, `RuntimeSemanticDocument` — 계획서 §7.2 그대로.

### 2.4 ArchitectureView 확장 (`packages/protocol/src/architecture-view.ts`)

- `ArchitectureSemanticRole = "actor" | "responsibility" | "state" | "external"`
- `ArchitectureAudience = "simple" | "technical"`
- `PresentationOverride`, `AudiencePresentation`
- component: `semanticRole`(필수), `semanticRefs: string[]`(필수, minItems 1, 최대 개수 제한 없음 — "정확히 1개" 규칙은 스키마 강제가 아니라 프롬프트/검증기 관례로 둠, §21(f) 향후 grouping 확장성 확보)
- boundary: `kind`에 `"runtime"` 추가, `id?`/`semanticRefs?`/`presentation?`
- connection: `semanticRefs?`/`presentation?`
- document: `presentation?: {defaultAudience, availableAudiences}`

### 2.5 새 검증 스테이지

- `packages/architecture-view/src/runtime-semantic-validator.ts` — schema → 참조 무결성/containment/경고 → citation. 진단 코드: `RESPONSIBILITY_WITHOUT_RUNTIME`, `UNKNOWN_RUNTIME_REF`, `UNKNOWN_INTERACTION_ENDPOINT`, `MISSING_PRIMARY_SOURCE`, `EMPTY_INTERACTION_LABEL`, `ORPHAN_RUNTIME`(warning), `UNCONNECTED_PRIMARY_ENTITY`(warning), `DUPLICATE_ID`(계획에 없었으나 §16.1 "중복 id 거부" 테스트 요구를 충족하기 위해 추가).
- `packages/architecture-view/src/semantic-mapping.ts` — architecture ↔ semantic 상호 참조 검증. `ACTOR_WRAPPED_BY_RUNTIME` 포함.
- `packages/architecture-view/src/presentation.ts` — `applyAudiencePresentation()` 순수 함수. 토폴로지/좌표는 절대 변경하지 않고 label/sublabel/visibility만 오버라이드.

### 2.6 Renderer 변경

`renderArchitectureViewSvg(doc, {audience, theme, selectedSemanticRef})`:
- actor: `av-component--actor` 클래스 (dashed pill 모양)
- `kind:"runtime"` boundary: `kind-runtime` 클래스 (굵은 실선 + "RUNTIME · " 배지)
- 선택 하이라이트: `av-selected` 클래스
- `data-component-id`/`data-boundary-id`/`data-connection-id`/`data-semantic-refs`/`data-sources` 속성 추가 (웹 UI의 클릭 선택 및 Detail Inspector가 사용)
- `visibility:"hide"`인 요소는 **그리지 않지만 geometry 계산에는 포함** — 두 프로필이 같은 좌표를 공유한다는 계획 §14.6/§10.1 원칙을 지키기 위함

### 2.7 MCP 서버

3번째 tool `submit_runtime_semantics` 추가. 기존 두 tool(`validate_architecture_view`/`submit_architecture_view`)의 입력에 `semanticRevision`(number)을 최상위 필드로 평탄하게(flat) 병합 — 기존 두 tool의 기존 컨벤션(문서 필드를 그대로 최상위에 둠)과 일관되게 하기 위한 선택. 모든 신규 zod 스키마는 V1과 동일하게 "형태는 갖추되 관대함"(optional + passthrough) 원칙을 유지했다.

### 2.8 Bridge

- `state.ts`: `MAX_RUNTIME_SEMANTIC_ATTEMPTS = 4`(신규, 기존 `MAX_ARCHITECTURE_VIEW_ATTEMPTS = 6`과 별도 카운터), semantic revision을 taskId별 불변 순차 리스트로 저장.
- `/internal/submit-runtime-semantics` 신규 라우트.
- `/internal/validate-architecture-view`, `/internal/submit-architecture-view`: `semanticRevision`이 없거나 해당 task에 커밋된 적 없는 값이면 `architecture-view/missing-semantic-revision` 에러로 즉시 거부 — 2단계 파이프라인을 HTTP 레이어에서 강제.
- `GET /api/architecture-view` 응답이 **`{document, svg, meta}`에서 `{document, svgByAudience: {simple, technical}, meta}`로 변경** (breaking). 탭 전환 시 재분석/재요청 없이 두 SVG 문자열을 그대로 재사용한다.
- Prompt를 `apps/bridge/src/prompts/{architecture-schema,runtime-semantic-contract,runtime-semantic-examples,architecture-composition-contract,audience-presentation-contract,correction-contract}.ts`로 분리, `prompt.ts`가 조립.

### 2.9 웹 앱

- `ArchitectureAudienceTabs.tsx`(신규), `ArchitectureInspector.tsx`(신규).
- 오디언스/선택 상태는 `ArchitectureView.tsx`의 로컬 state로 둠 — `App.tsx`의 phase machine이 `viewing`을 벗어나면 컴포넌트 자체가 언마운트되므로 "새 분석 시 초기화"가 별도 배선 없이 자연히 보장됨.
- SVG는 `dangerouslySetInnerHTML`로 마운트된 후 delegated click handler로 `data-component-id` 등을 감지해 선택 처리, `av-selected` 클래스를 client-side로 토글(서버가 굽는 `selectedSemanticRef`는 최초 렌더에는 못 쓰므로).
- `@vibee/architecture-view`는 `node:fs`를 쓰는 `schema.ts`를 배럴로 재노출하므로 **웹 앱에서 절대 import하지 않음** — presentation 오버라이드 로직은 웹 앱 내부에 몇 줄로 재구현.

---

## 3. 실제 발견하고 고친 버그 — Citation 검증의 git-revision 문제

### 3.1 증상

`fixtures/local-notes-cli`에 대한 첫 라이브 실행에서 AI가 `submit_runtime_semantics`를 3회(1차 재현 시) 호출했지만 매번 "파일이 revision d60f629...에 존재하지 않는다"는 citation 오류를 받았고, 결국 커밋 없이 턴을 종료했다. 방금 AI가 Read 도구로 직접 읽은 파일이 "존재하지 않는다"고 거부되는 명백히 잘못된 결과였다.

### 3.2 근본 원인

`resolveGitRevision(projectPath)`는 `git -C <projectPath> rev-parse HEAD`를 실행한다. vibee 저장소는 이번 세션 도중(정확히는 이전 V1 세션 종료 직후, 사용자가 별도로) 실제 git 저장소가 되었고 `"first commit"` 하나만 존재하는데, 이 커밋은 이번 세션에서 Stage 4가 새로 추가한 `fixtures/local-notes-cli` 등을 포함하지 않는다(untracked). `fixtures/local-notes-cli`는 vibee 저장소의 하위 디렉터리이므로 `resolveGitRevision`은 이 오래된 커밋 해시를 반환했고, 이 값이 `checkCitations`/`checkRuntimeSemanticCitations`에 `revision`으로 전달되어 **작업 디렉터리가 아니라 그 오래된 git 커밋 내용**을 기준으로 citation을 검사했다.

설계적 결함은 더 근본적이다: AI의 저장소 탐색은 항상 Read/Grep/Glob으로 **살아있는 작업 디렉터리**를 읽는데, citation 검증만 **과거의 고정된 git revision**을 기준으로 하면 두 소스가 어긋난다. 이는 V1부터 있던 설계였지만(“작업 트리가 분석 도중 바뀌어도 안전하게”라는 의도), V1 세션 당시 vibee가 git 저장소가 아니었기 때문에 이 분기가 한 번도 실제로 타지 않아 드러나지 않았던 잠재 결함이었다.

### 3.3 수정

`checkCitations`(citation.ts)와 `checkRuntimeSemanticCitations`(runtime-semantic-validator.ts)가 **항상** 작업 디렉터리 기준(`checkWorkingTreeSource`)으로만 검증하도록 변경했다. git revision 기반 검증 경로(`checkGitSource`)는 이 수정으로 완전히 미사용이 되어 삭제했고, `CitationContext`/`ValidateContext`/`RuntimeSemanticValidateContext`에서 `revision`/`gitRevision` 필드도 제거했다. `repository.revision`/`meta.gitRevision`은 **표시용 메타데이터로는 그대로 유지** — 어떤 revision에서 분석했는지 기록하는 용도로만 쓰고, citation 검증의 신뢰 기준으로는 더 이상 쓰지 않는다.

### 3.4 검증

- 회귀 테스트 3건 추가 (citation.test.ts, runtime-semantic-validator.test.ts, validator.test.ts): 실제 작업 디렉터리 파일을 인용하되 `revision`을 무관/존재하지 않는 해시로 지정해도 진단이 0건이어야 함을 확인.
- 수정 담당 에이전트가 실제 빌드된 bridge에 대해 `POST /internal/submit-runtime-semantics`를 직접 호출해 `{"diagnostics":[],"semanticRevision":2}` 응답을 받아 수정을 라이브로 확인.
- 오케스트레이터(나)가 `fixtures/local-notes-cli`에 대해 **동일한 라이브 E2E를 재실행**해 실제로 커밋까지 성공함을 재확인했다 (§4.2).

---

## 4. 라이브 E2E 실행 결과 (실제 Claude Agent SDK, 4개 fixture 전부)

각 fixture당 1회씩, 실제 `POST /api/architecture-view` → WS 이벤트 스트림 → `GET /api/architecture-view`로 실행했다. Claude 자격증명이 이 샌드박스에 이미 존재해 실제 모델 호출이 이루어졌다 (모델은 기본값, 명시적으로 지정하지 않음).

### 4.1 `fixtures/sample-app` (web monolith)

- 탐색 파일: 6개
- Tool 호출: `submit_runtime_semantics`×2 → `validate_architecture_view`×4 → `submit_architecture_view`×1 → 커밋 성공
- 토큰: input 20 / output 27,128 / cache-read 324,162 / cache-write 57,108
- 결과 topology: actor 1(User) → responsibility 2(정적 서빙, Notes API) + responsibility 1(Notes UI) → state 1(SQLite) / runtime boundary 2개(브라우저, 서버)
- 확인된 V2 목표: `presentation.simple.label`이 canonical label과 다름 (예: canonical `"Notes REST API"` → simple `"Notes Service"`, canonical `"Notes SQLite Database"` → simple `"Notes Storage"`) — 기술명 대신 역할명을 노출한다는 목표가 실제로 동작함.

### 4.2 `fixtures/local-notes-cli` (single-runtime local-first)

- 최초 실행: §3의 버그로 커밋 실패(diagnostics만 반복 수신, 3회 시도 후 포기) — 수정 전 상태로 기록.
- 수정 후 재실행: 탐색 4개, `submit_runtime_semantics`×1 → `validate_architecture_view`×2 → `submit_architecture_view`×1 → 커밋 성공
- 토큰: input 14 / output 16,371 / cache-read 183,551 / cache-write 16,022
- 결과 topology: actor 1(CLI User), runtime boundary 1개(Notes CLI Process)가 responsibility 3개 + state 1개를 감쌈, external 1개(GitHub Zen API, simple에서는 노출 안 됨). sample-app과 boundary 개수·actor 배치가 명백히 다름.

### 4.3 `fixtures/dual-app` (dual-runtime)

- 탐색 파일: 10개
- Tool 호출: `submit_runtime_semantics`×1 → `validate_architecture_view`×1 → `submit_architecture_view`×1 → 커밋 성공 (가장 적은 왕복 횟수)
- 토큰: input 16 / output 14,002 / cache-read 188,961 / cache-write 32,116
- 결과 topology: runtime boundary **4개**(user-web, user-server, admin-web, admin-server), actor **2명**(User, Admin), 두 서버 responsibility가 공유 state 노드(`compDb`, listings DB)로 수렴 — 계획 §5.4가 요구한 "두 개의 독립 런타임 + 공유 데이터" 패턴이 정확히 재현됨.

### 4.4 `fixtures/task-queue-app` (worker/event)

- 탐색 파일: 5개
- Tool 호출: `submit_runtime_semantics`×1 → `validate_architecture_view`×3 → `submit_architecture_view`×1 → 커밋 성공
- 토큰: input 16 / output 16,425 / cache-read 204,036 / cache-write 35,271
- 결과 topology: runtime boundary 2개(producer, worker), actor 1명, state 1개(job queue), external 1개(results file) — producer→queue, worker→queue, worker→external의 producer/consumer 패턴이 명확히 드러남.

### 4.5 4개 fixture 종합 평가

| Fixture | Runtime boundary 수 | Actor 수 | 주요 state/external |
|---|---|---|---|
| sample-app | 2 | 1 | DB 1개 |
| local-notes-cli | 1 | 1 | DB 1개 + external 1개 |
| dual-app | 4 | 2 | 공유 DB 1개 |
| task-queue-app | 2 | 1 | Queue 1개 + external 1개 |

4개 fixture 모두 **서로 다른 boundary 개수·actor 수·그래프 모양**을 만들어냈다 — 계획 §5.4/§19의 "동일 topology로 붕괴하지 않는다" 완료 기준을 실제 라이브 실행으로 충족했다. 모든 실행에서 simple/technical 두 SVG가 **추가 AI 호출 없이** 동일 `GET /api/architecture-view` 응답에서 함께 생성되었다(§19 "탭 전환 시 추가 AI 호출 없음" 기준 충족 — 단, 이건 서버 응답 구조상 자동으로 보장되는 것이며 브라우저 탭 클릭으로 직접 관찰한 것은 아니다, §6 참조).

---

## 5. 테스트/빌드 결과 (실측)

전체 워크스페이스 기준, 이 문서 작성 직전 마지막으로 실행한 결과:

- `npm run build --workspaces --if-present`: 5개 워크스페이스 전부 클린 (protocol, architecture-view, mcp-server, bridge, web)
- `npm run typecheck --workspaces --if-present`: 클린, 에러 0건
- `npm run test --workspaces --if-present`: **102/102 통과, 0 실패**
  - `@vibee/protocol`: 4
  - `@vibee/architecture-view`: 62 (citation 3 → 회귀 수정 후 개수 변동 포함, geometry, presentation 6, render, runtime-semantic-schema, runtime-semantic-validator, schema, semantic-mapping, validator 등)
  - `@vibee/mcp-server`: 15
  - `@vibee/bridge`: 21
  - `@vibee/web`: 테스트 스크립트 없음 (V1부터 동일)
- Node.js: v24.13.0
- 주요 의존성 버전: `@anthropic-ai/claude-agent-sdk` ^0.3.246, `express` ^5.2.1, `ws` ^8.21.3 (bridge 기준)

빌드/테스트 실행 후 남은 프로세스나 포트 바인딩 없음을 매 단계 확인했다(`pgrep`/`lsof`). fixture들의 `.vibee/` 라이브 테스트 산출물은 정리해 pristine 상태로 되돌렸다.

---

## 6. 미확인/미결정 (정직하게 명시)

- **브라우저 실제 시각 검증 (계획 §15 전체)**: 이 세션에는 실제 브라우저 도구가 없다. 탭 전환의 시각적 연속성, actor pill 모양/runtime 배지의 실제 가독성, 클릭 선택의 실제 동작, 라벨 겹침, 화살표 라우팅 품질, 라이트/다크 모드 전환 등은 **하나도 실제 브라우저에서 관찰하지 못했다**. Stage 3 에이전트가 수작업으로 만든 문서를 bridge에 직접 심고 `curl`로 API 응답 문자열을 검사해 "숨김/표시가 SVG 문자열 수준에서 맞게 갈린다"는 것까지만 확인했다 — 이는 v1_impl.md가 남긴 것과 동일한 종류의 gap이다.
- **Codex 어댑터**: 계획대로 인터페이스만 유지되는 스텁 그대로, 변경 없음.
- **로드맵 (a)/(b)/(c)/(d)/(e)/(f)/(g)**: 계획 문서(§21)에만 존재, 이번 라운드에 구현하지 않음 — 계획대로.
- **각 fixture 1회씩만 실행**: 모델 비결정성에 따른 반복 안정성은 검증하지 않았다. 예를 들어 dual-app이 항상 3회 왕복(1-1-1)으로 끝난다는 보장은 없다 — 이번 실행에서 그렇게 관찰됐을 뿐이다.
- **citation 버그의 "왜 vibee가 git 저장소가 되었는가"**: 이 세션 내에서 내(오케스트레이터)가 `git init`을 실행한 적이 없고, 서브에이전트들도 git 명령을 실행하지 않도록 명시적으로 지시받았다. 커밋 로그상 "first commit" 하나만 존재하며 타임스탬프가 V1 세션 종료 직후로 보인다 — 사용자가 세션 사이에 직접 초기화했을 것으로 추정하지만, 이는 **추정이지 확인된 사실이 아니다**.
- **`semanticRefs`의 "정확히 1개" 관례가 실제 프롬프트에서 항상 지켜지는가**: 4번의 라이브 실행 모두 각 component가 `semanticRefs` 배열에 정확히 1개만 넣었음을 위 데이터에서 확인했다. 다만 connection은 여러 interaction을 하나로 묶어 참조하는 경우가 실제로 관찰됐다 (예: sample-app의 `connApiUi`는 `["intFetchNotes", "intCreateNote"]` 2개, local-notes-cli의 `userToDispatch`는 3개) — 계획이 component에 한해서만 "정확히 1개" 관례를 명시했고 connection에는 그런 제약을 두지 않았으므로 위반은 아니지만, 스키마 레벨에서 강제되는 규칙이 아니라는 점은 유의해야 한다.
- **presentation.simple이 실제로 "기술 용어 완전 배제"를 항상 만족하는가**: 커밋된 문서를 육안으로 검토했을 때 대체로 잘 지켜졌으나(예: `notePersistence`의 canonical sublabel `node:sqlite`는 technical에만 있고 simple에는 없음), 4개 fixture 전체에 대해 계획 §15.3 체크리스트를 체계적으로 훑어보지는 않았다.

---

## 7. 계획과의 차이 (전체 요약)

- 패키지 구조: `packages/runtime-semantic`을 별도 워크스페이스로 만들지 않고 `packages/architecture-view`에 통합 (§2.1).
- 진단 코드 네이밍: runtime-semantic/semantic-mapping 계층은 계획서에 적힌 `UPPER_SNAKE_CASE` 코드를 그대로 사용 (기존 `architecture-view/kebab-case` 관례와 다름, 계획이 명시한 이름을 존중).
- `DUPLICATE_ID` 진단 코드는 계획 §8에 없었으나 §16.1 테스트 요구사항을 충족하기 위해 추가.
- MCP tool 입력에서 `semanticRevision`을 `{semanticRevision, document}`로 중첩하지 않고 최상위에 평탄하게 병합 — 기존 두 tool의 기존 컨벤션과의 일관성을 우선.
- `MAX_RUNTIME_SEMANTIC_ATTEMPTS = 4`는 계획에 구체적 수치가 없어 자체 결정 (기존 6회 cap보다 작게 — semantic 모델 저작이 좌표/geometry가 없어 더 단순한 저작 표면이라는 판단).
- `GET /api/architecture-view`의 `svg` → `svgByAudience` 변경은 계획에 명시되지 않았지만 §14.6/§18의 "탭 전환 시 재분석 없음" 요구를 만족시키기 위한 구현상 필연적 결정.
- citation 검증에서 git-revision 기반 경로(`checkGitSource`)를 완전히 제거 — 이는 계획에 없던, 라이브 테스트 중 발견한 V1부터의 잠재 결함을 고친 것 (§3).
- 웹 앱은 `@vibee/architecture-view`를 전혀 import하지 않음 (해당 패키지가 `node:fs`를 쓰는 `schema.ts`를 배럴로 재노출하므로 브라우저 번들에 부적합) — presentation 프로젝션 로직을 웹 앱 내부에 소규모로 재구현.

---

## 8. 핵심 파일 (실제 구현 기준)

```
packages/protocol/src/runtime-semantic.ts                (신규)
packages/protocol/src/architecture-view.ts                (확장, schemaVersion 2)
packages/architecture-view/schemas/runtime-semantic.schema.json  (신규)
packages/architecture-view/schemas/architecture-view.schema.json (확장)
packages/architecture-view/src/runtime-semantic-validator.ts     (신규)
packages/architecture-view/src/semantic-mapping.ts               (신규)
packages/architecture-view/src/presentation.ts                   (신규)
packages/architecture-view/src/examples.ts                       (신규)
packages/architecture-view/src/render.ts                         (audience-aware로 확장)
packages/architecture-view/src/citation.ts                       (git-revision 경로 제거, §3)
packages/architecture-view/examples/runtime/*.json                (weak exemplar 4종)
packages/mcp-server/src/index.ts                                  (submit_runtime_semantics 추가)
apps/bridge/src/state.ts                                          (semantic revision 저장)
apps/bridge/src/prompts/*.ts                                      (신규, 역할별 분리)
apps/bridge/src/index.ts                                          (신규 라우트, svgByAudience)
apps/web/src/components/ArchitectureAudienceTabs.tsx              (신규)
apps/web/src/components/ArchitectureInspector.tsx                 (신규)
apps/web/src/components/ArchitectureView.tsx                      (탭/선택/svgByAudience)
fixtures/local-notes-cli/                                         (신규)
fixtures/task-queue-app/                                          (신규)
fixtures/dual-app/                                                (신규)
docs/v2_plan.md
docs/v2_impl.md                                                   (본 문서)
```
