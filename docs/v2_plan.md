# Vibee V2 — Runtime Architecture 시각화 고도화 계획

## 0. 문서 상태와 기준선

- 상태: **설계 완료, 구현 착수 전 계획 문서.**
- 선행 문서:
  - `docs/v1_plan.md` — V1 설계
  - `docs/v1_impl.md` — V1 실제 구현 및 검증 결과
- V2는 V1의 모노레포, MCP+Claude Agent SDK 연동, `architecture-view` 스키마/검증기/geometry/SVG 렌더러를 **폐기하지 않고 확장**한다.
- V1에서 확인된 핵심 문제는 렌더링 엔진의 존재 여부가 아니라, AI가 저장소에서 **무엇을 하나의 architecture component로 승격해야 하는지에 대한 의미 계약(semantic authoring contract)이 약했다는 것**이다.
- V2의 목표는 특정 예제 topology를 복제하는 것이 아니라, 프로젝트마다 다른 구조를 유지하면서도 **“실행 중 시스템이 어떻게 구성되고 상호작용하는지”를 한눈에 읽을 수 있는 high-level runtime architecture**를 일관되게 생성하는 것이다.
- 한 번의 repository 분석에서 **하나의 evidence-backed runtime semantic model과 하나의 canonical architecture layout**만 만든다. 그 위에 동일한 semantic identity를 공유하는 두 presentation profile을 렌더링한다.
  - **쉬운 보기(Simple)**: 비전공자 기본 화면. 기술 스택/프레임워크/vendor/package 명칭은 기본 canvas에서 숨기고 역할과 상호작용 중심으로 표현한다.
  - **기술 구조(Technical)**: canonical responsibility, 구현 기술, vendor, source/evidence 등 더 깊은 정보를 보여준다.
- 두 view는 별도 AI 다이어그램이 아니다. 같은 semantic entity와 같은 canonical geometry를 공유하고, label/sublabel/visibility/detail disclosure만 달라진다.
- `reference/archify-main/`에서 차용하는 것은 architecture authoring 패턴, weak exemplar 사용 방식, validation/visual review 규율이다. 코드를 그대로 복사하지 않는다.
- 이 문서는 구현 전에 고정한다. 구현 완료 후 실제 변경점, 테스트 raw 수치, 시각 검증 결과, 계획과의 차이는 `docs/v2_impl.md`에 별도로 기록한다.

---

## 1. 배경과 V1 문제 정의

### 1.1 V1에서 잘 된 것

V1은 아래 파이프라인을 실제로 end-to-end 동작시켰다.

1. 사용자가 프로젝트 경로 입력
2. Claude Agent SDK가 `Read`/`Grep`/`Glob`으로 저장소 탐색
3. AI가 좌표 포함 `ArchitectureViewDocument` 직접 저작
4. MCP `validate_architecture_view`로 schema → geometry → citation 검증
5. 오류 수정 후 `submit_architecture_view`
6. 결정론적 TypeScript SVG 렌더러로 출력
7. React 웹 UI에 표시

또한 다음 기반은 V2에서도 유지할 가치가 있다.

- architecture schema를 단일 source of truth로 유지
- validator와 renderer가 동일한 geometry 계산 공유
- automatic port spread / dogleg routing / route shortening / CJK label width 처리
- source citation 검증
- MCP tool round-trip 기반 AI self-correction
- native repository exploration만 사용하고 별도 Evidence Engine을 도입하지 않는 원칙
- 매 분석을 새 세션으로 시작하는 원칙

### 1.2 V1의 핵심 문제

V1의 Architecture IR은 주로 다음 visual category를 중심으로 설계되었다.

- `frontend`
- `backend`
- `database`
- `cloud`
- `security`
- `messagebus`
- `external`

이 분류는 렌더링 스타일에는 유용하지만, AI에게 **어떤 추상화 수준으로 repository를 읽어야 하는지**를 충분히 설명하지 못했다.

그 결과 AI가 다음처럼 기술/배포 topology 중심의 노드를 생성하는 것이 명세상 자연스러웠다.

- `SvelteKit Web App`
- `Node.js API Server`
- `MongoDB`
- `AWS S3`
- `Google OAuth`

이 결과도 architecture diagram으로는 유효하지만, Vibee가 지향하는 그림은 다음 질문에 더 직접적으로 답해야 한다.

> “이 애플리케이션이 실행될 때 누가 어떤 runtime에 들어오고, 각 runtime 안의 어떤 책임 단위들이 어떤 상태/외부 시스템과 상호작용하는가?”

V2에서는 기술 스택 지도를 만드는 대신 **runtime system map**을 만드는 것을 명시적으로 계약한다.

---

## 2. V2 목표

1. architecture view의 의미를 **high-level runtime architecture**로 명확하게 고정한다.
2. repository의 실제 topology를 보존하면서 actor, runtime boundary, runtime responsibility, state/store, external dependency, runtime interaction 중심으로 시각화한다.
3. 특정 모범 JSON 하나의 노드 수·좌표·행/열·boundary 개수에 과적합하지 않도록 한다.
4. 예제는 topology template이 아니라 **표현 문법과 추상화 수준을 보여주는 weak exemplar**로만 사용한다.
5. discovery 직후 좌표 포함 최종 IR을 바로 쓰지 않고 다음 단계를 분리한다.
   - repository evidence → runtime semantic model
   - runtime semantic model → canonical architecture composition
   - canonical architecture → audience-specific presentation
6. **한 번의 분석에서 semantic model 1개, canonical layout 1개만 생성**한다. 쉬운 보기와 기술 구조를 위해 AI가 서로 다른 graph/layout을 두 번 저작하지 않는다.
7. 같은 semantic identity를 기반으로 한 분석 결과 안에서 두 탭을 제공한다.
   - `쉬운 보기`: 비전공자를 위한 기본 presentation
   - `기술 구조`: 개발자/기술 이해가 필요한 사용자를 위한 상세 presentation
8. 쉬운 보기에서는 framework/library/protocol/vendor/package 이름을 기본 canvas에서 노출하지 않는다. 기술 정보는 semantic model에 보존하고 기술 구조 탭 또는 detail inspector에서 progressive disclosure한다.
9. 두 탭에서 대응되는 semantic entity는 가능한 한 같은 위치를 유지하며, 탭 전환 시 선택된 entity도 유지한다.
10. V2 초기 구현에서는 profile별 **label/sublabel/visibility 차이**를 우선하고, 여러 semantic node를 하나로 합치는 aggressive grouping은 제한한다.
11. V1의 geometry/validator/render 기반을 최대한 재사용한다.
12. schema validation 통과 여부만으로 품질 완료를 선언하지 않고, 실제 브라우저 렌더링과 두 audience view의 visual review를 완료 기준에 넣는다.
13. 서로 다른 topology의 fixture 여러 개에서 같은 visual grammar가 유지되면서도 서로 다른 graph가 생성되는지 검증한다.

---

## 3. 비목표

이번 V2에서 아래 항목은 구현하지 않는다.

- ontology의 Evidence Engine / Semantic Memory / repository indexing core
- deterministic repository topology detector
- 사용자 journey / system flow 전용 별도 시각화
- sequence diagram drill-down
- incremental diff 기반 재분석
- Codex CLI 실제 연동
- 완전 자동 AI vision 기반 screenshot critique loop
- Kubernetes/C4/ArchiMate 등 특정 표준 모델에 대한 완전 준수
- 모든 기술 이름을 자동 판별하는 대규모 framework/vendor 사전
- architecture completeness를 자동으로 증명하는 기능
- 쉬운 보기와 기술 구조를 위해 **서로 다른 semantic graph 또는 서로 다른 AI-authored layout을 생성하는 방식**
- V2 초기 단계에서의 aggressive semantic grouping/aggregation
  - 예: technical의 `auth-service`, `reward-service`, `session-store` 세 노드를 simple에서 임의로 하나의 노드로 합쳐 별도 topology를 만드는 것
  - 필요성은 로드맵에서 별도 평가한다.

V2는 **runtime architecture 의미 추출, canonical composition, audience-specific presentation 품질**에 집중한다.

---

## 4. 핵심 설계 원칙

### 4.1 Architecture의 의미

Vibee에서 `architecture`는 다음을 의미한다.

> **repository의 high-level runtime architecture**  
> 파일/패키지/프레임워크 목록이 아니라, 시스템 실행 중 존재하는 actor, runtime, responsibility, state, external dependency와 그 상호작용을 보여주는 지도.

### 4.2 Semantic identity와 presentation을 분리한다

V2의 핵심 규칙은 다음이다.

> **사실은 하나이고, 표현은 둘이다.**

한 번의 분석에서 AI는 하나의 `RuntimeSemanticDocument`와 하나의 canonical `ArchitectureViewDocument`만 만든다.

그 결과를 다음 두 profile로 투영한다.

- `simple`: 비전공자 기본 보기
- `technical`: 기술 상세 보기

두 profile은 같은 `semanticRef`/`semanticRefs`와 같은 canonical `pos`/`size`를 공유한다. presentation profile은 semantic fact나 topology를 새로 만들지 않는다.

### 4.3 기술 이름보다 실행 책임을 우선한다

semantic model의 canonical identity는 기술 스택이 아니라 실행 책임을 중심으로 잡는다.

좋은 canonical label:

- 여행자 앱 화면
- 탐색·미션 처리
- 인증·보상 처리
- 관리자 작업 처리
- 세션 상태
- 이미지 처리
- 주문 처리
- 작업 실행기
- 권한 정책

구현 기술은 semantic model의 `implementationHints`로 보존한다.

예:

- canonical: `여행자 앱 화면`
  - implementationHints: `Expo Router`, `React Native`
- canonical: `세션 상태`
  - implementationHints: `Zustand`
- canonical: `애플리케이션 데이터`
  - implementationHints: `MongoDB`
- canonical: `이미지 저장소`
  - implementationHints: `AWS S3`

특정 기술 제품이 실제 독립 runtime dependency인 경우 semantic entity로 존재할 수 있다. 그래도 쉬운 보기의 display label은 역할을 우선한다.

예:

- canonical/technical: `Google OAuth`
  - simple: `Google 로그인`
- canonical/technical: `AWS S3`
  - simple: `사진 저장소`
- canonical/technical: `SQS`
  - simple: `백그라운드 작업 전달`

### 4.4 Audience / Presentation Contract

#### Simple profile — 기본 탭

대상은 개발 지식이 없어도 시스템을 이해하려는 사용자다.

규칙:

- framework/library/protocol/vendor/package 이름을 기본 canvas label/sublabel에 노출하지 않는다.
- “무엇으로 구현했는가”보다 “무엇을 하는가”를 표시한다.
- `runtime`, `service`, `state`, `worker` 같은 용어도 더 쉬운 표현이 자연스러우면 display label에서 완화한다.
  - `여행자 앱 런타임` → `여행자 앱`
  - `Authentication Service` → `로그인 처리`
  - `Session State` → `현재 사용자 상태`
  - `Worker` → `백그라운드 작업 처리`
- 기술 정보는 삭제하지 않고 technical view/detail inspector에서 확인 가능해야 한다.
- 구조를 이해하는 데 필요 없는 technical-only sublabel과 low-value edge label은 숨길 수 있다.
- 기술 명칭을 전부 가려도 주요 구조와 상호작용을 이해할 수 있어야 한다.

#### Technical profile — 상세 탭

대상은 개발자 또는 구현 근거를 확인하려는 사용자다.

규칙:

- canonical responsibility label 유지
- `implementationHints` 기반 기술 stack/vendor 표시 가능
- protocol/queue/database/provider 등 구현적으로 의미 있는 정보 표시 가능
- source/evidence inspector 진입점 제공
- simple profile보다 상세한 connection label 허용

### 4.5 Progressive disclosure

main canvas와 detail inspector의 역할을 분리한다.

Simple canvas:

```text
로그인 처리
```

Detail inspector 또는 Technical view:

```text
Authentication / Reward
JWT · Express
src/auth/...
src/rewards/...
```

기술 정보는 정확성을 위해 내부에 보존하지만, 기본 이해 화면을 기술 용어로 오염시키지 않는다.

### 4.6 Runtime boundary를 우선 식별한다

가능한 경우 component보다 먼저 실제 실행 경계를 식별한다.

예:

- 모바일 앱 runtime
- 사용자 웹 runtime
- 관리자 웹 runtime
- 서버 runtime
- background worker runtime
- desktop renderer runtime
- desktop main process runtime

semantic identity에서는 실제 실행 단위/프로세스/클라이언트 환경을 표현한다.

presentation에서는 audience에 따라 label을 다르게 할 수 있다.

예:

- technical: `Traveler App Runtime`
- simple: `여행자 앱`

### 4.7 Actor는 runtime 밖에 둔다

실행 interaction을 시작하는 사용자 또는 외부 행위자가 repository evidence에서 확인되면 actor로 표현한다.

예:

- 여행자
- 관리자
- 운영자
- CLI caller
- 외부 webhook sender

actor는 runtime boundary 내부의 일반 component로 취급하지 않는다.

### 4.8 Connection은 runtime interaction을 표현한다

좋은 connection label:

- 화면 조작
- 로그인 요청
- 위치 조회
- 추천 요청
- 인증 검증
- 상태 저장
- 사진 업로드
- 이벤트 발행
- 이미지 조회
- 작업 실행

피해야 할 label:

- imports
- package dependency
- uses library
- depends on

정적 dependency는 semantic evidence로 사용할 수 있지만, 최종 diagram에는 가능한 한 실행 의미를 표현한다.

profile에 따라 label을 단순화할 수 있다.

예:

- technical: `POST /auth/session`
- simple: `로그인 요청`

### 4.9 하나의 topology를 강제하지 않는다

V2는 다음 모양 중 어떤 것도 정답 template으로 강제하지 않는다.

- `User → UI → API → DB`
- 3-tier architecture
- 한 줄짜리 horizontal rail
- runtime 2개
- actor 2개
- DB가 항상 오른쪽
- local state가 항상 아래쪽
- boundary 안에 항상 3개 node

대신 다음 invariant만 유지한다.

- 독자가 따라갈 수 있는 **명확한 primary story**가 있어야 한다.
- 하나의 global story가 자연스럽지 않으면 **runtime별 local primary story**를 허용한다.
- side branch는 관련 primary responsibility 근처에 배치한다.
- low-value edge는 제거한다.
- 주요 노드는 기본 6~12개 수준을 권장하되 실제 repository가 더 단순하면 더 적게 허용한다.
- 기술 세부사항은 architecture의 주인공이 아니라 보조 정보다.
- topology는 repository evidence에서만 결정한다.
- simple/technical profile이 topology를 서로 다르게 재발명하지 않는다.

### 4.10 Canonical geometry를 공유한다

두 profile은 기본적으로 같은 `pos`/`size`/route를 사용한다.

목표:

- 탭 전환 시 사용자가 같은 시스템을 보고 있다는 공간적 맥락 유지
- simple ↔ technical 사이 entity 대응을 즉시 이해 가능
- AI가 두 layout을 별도로 생성하면서 생기는 사실/구조 drift 방지
- 토큰 및 correction 비용 억제

simple profile에서 node/edge를 숨기더라도 나머지 shared entity를 profile별로 재배치하지 않는다. 일부 여백이 생기는 것은 V2 MVP에서 허용한다.

---

## 5. Anti-overfitting 전략

### 5.1 하나의 Golden JSON을 topology template으로 사용하지 않는다

V2에서는 “이 JSON처럼 그려라” 방식의 단일 full-diagram exemplar를 기본 prompt에 직접 주입하지 않는다.

단일 완성 예제는 다음 과적합을 유발할 수 있다.

- 노드 수 복제
- runtime 개수 복제
- 좌우 배치 복제
- storage 위치 복제
- main path 길이 복제
- branch 개수 복제
- actor 위치 복제
- boundary 개수 복제

### 5.2 Weak exemplar를 micro-example로 분해한다

에이전트가 읽는 예제는 완성 topology가 아니라 **개별 표현 규칙을 보여주는 작은 예제 여러 개**로 구성한다.

예:

#### `actor-outside-runtime.example.json`

보여주는 것:

- actor는 runtime boundary 바깥에 배치
- actor → entry responsibility connection

보여주지 않는 것:

- 전체 시스템 topology

#### `responsibility-over-technology.example.json`

보여주는 것:

- primary label은 `Order Processing`
- sublabel은 `Express · PostgreSQL`

보여주지 않는 것:

- node 개수/배치

#### `runtime-boundary.example.json`

보여주는 것:

- mobile / server / worker runtime을 별도 boundary로 표현
- runtime마다 내부 responsibility가 다를 수 있음

#### `primary-path-and-branch.example.json`

보여주는 것:

- main interaction path
- 가까운 responsibility에서 side branch 분기

각 micro-example은 2~4개 node 수준으로 유지한다.

### 5.3 Prompt에 anti-copy contract를 명시한다

모델 prompt에는 다음 의미를 반드시 포함한다.

> Examples demonstrate semantic abstraction and visual language, not topology.  
> Do not reproduce example node counts, rows, columns, runtime counts, boundary counts, branch counts, or coordinates.  
> Derive the graph exclusively from repository evidence.

이를 prompt regression test로 고정한다.

### 5.4 서로 다른 topology fixture로 회귀 검증한다

최소 아래 4종 fixture를 유지한다.

1. **single-runtime local-first app**
   - 사용자
   - 모바일/데스크톱 runtime
   - local state/store
   - optional external API

2. **web monolith**
   - browser actor
   - web runtime
   - server runtime
   - database

3. **worker/event system**
   - API/producer
   - queue
   - worker runtime
   - external dependency/store

4. **dual-runtime app**
   - 사용자 앱 runtime
   - 관리자 웹 runtime
   - 서로 다른 local state/service
   - 필요한 경우 shared/external data

같은 prompt와 schema를 사용했을 때 네 fixture가 같은 topology로 붕괴하면 실패로 본다.

---

## 6. V2 파이프라인

V1:

```text
Repository exploration
  → ArchitectureViewDocument(pos 포함)
  → validate
  → submit
  → render
```

V2:

```text
Repository exploration
  → RuntimeSemanticDocument
  → validate/commit semantic model
  → Canonical architecture composition
  → ArchitectureViewDocument
  → validate
  → submit
  → canonical geometry/layout
  → ┌─ Simple presentation
    └─ Technical presentation
  → browser visual review
```

핵심은 세 가지다.

1. **semantic extraction과 visual composition을 분리**한다.
2. **한 번의 분석에서 canonical graph/layout은 하나만 만든다.**
3. simple/technical은 별도 분석 결과가 아니라 **동일 architecture document의 audience projection**이다.

금지되는 흐름:

```text
Semantic
  ├─ AI → Simple Architecture A
  └─ AI → Technical Architecture B
```

허용되는 흐름:

```text
Semantic
  → AI → Canonical Architecture
           │
           ├─ profile=simple
           └─ profile=technical
```

---

## 7. Runtime Semantic Model

### 7.1 목적

`RuntimeSemanticDocument`는 좌표와 audience-specific presentation이 없는 repository 의미 모델이다.

이 단계에서는 “어디에 그릴지”, “쉬운 보기에서는 어떻게 부를지”를 최종 결정하지 않는다.

질문은 다음뿐이다.

- 누가 시스템을 사용/호출하는가?
- 어떤 runtime이 존재하는가?
- 각 runtime 안에 어떤 실행 책임이 있는가?
- 어떤 state/store가 존재하는가?
- 어떤 외부 dependency가 있는가?
- 실제 실행 중 무엇이 무엇과 상호작용하는가?
- 각 판단의 코드 근거는 무엇인가?

### 7.2 신규 공유 타입

`packages/protocol/src/runtime-semantic.ts`

초기 구조:

```ts
type SourceRef = {
  path: string;
  line?: number;
  endLine?: number;
  label?: string;
};

type ImplementationHint = {
  label: string;
  kind?: "framework" | "library" | "protocol" | "vendor" | "database" | "queue" | "runtime" | "other";
};

type RuntimeActor = {
  id: string;
  label: string;
  sources?: SourceRef[];
};

type RuntimeUnit = {
  id: string;
  label: string;
  kind:
    | "mobile"
    | "web"
    | "desktop-renderer"
    | "desktop-main"
    | "server"
    | "worker"
    | "cli"
    | "embedded"
    | "other";
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

type RuntimeResponsibility = {
  id: string;
  runtimeId: string;
  label: string;
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

type RuntimeState = {
  id: string;
  runtimeId?: string;
  label: string;
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

type RuntimeExternal = {
  id: string;
  label: string;
  kind?: "api" | "auth" | "storage" | "database" | "queue" | "service" | "other";
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

type RuntimeInteraction = {
  id: string;
  from: string;
  to: string;
  label: string;
  kind?:
    | "user-action"
    | "request"
    | "event"
    | "auth"
    | "state-read"
    | "state-write"
    | "other";
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

type RuntimeSemanticDocument = {
  title: string;
  repository?: {
    url?: string;
    revision?: string;
  };
  actors: RuntimeActor[];
  runtimes: RuntimeUnit[];
  responsibilities: RuntimeResponsibility[];
  states: RuntimeState[];
  externals: RuntimeExternal[];
  interactions: RuntimeInteraction[];
};
```

정확한 enum은 fixture 검토 후 최소 범위로 확정한다.

### 7.3 Semantic model 규칙

- 모든 responsibility는 원칙적으로 하나의 `runtimeId`를 가져야 한다.
- actor는 runtime에 속하지 않는다.
- state는 runtime-local 또는 shared/external일 수 있다.
- framework/library 이름만으로 responsibility를 만들지 않는다.
- `label`은 canonical semantic identity이며 역할 중심이어야 한다.
- `implementationHints`는 사실 보존용이다. simple view에서 자동 노출되지 않는다.
- interaction은 static import 관계가 아니라 runtime 의미를 표현한다.
- 모든 중요한 semantic entity에는 source citation을 요구한다.
- 근거가 약한 추정은 생성하지 않는다.
- simple/technical presentation 차이 때문에 semantic entity를 중복 생성하지 않는다.

---

## 8. Semantic Validation

신규 패키지 또는 `architecture-view` 내부 별도 모듈:

```text
packages/runtime-semantic/
  schemas/runtime-semantic.schema.json
  src/validator.ts
  src/citation.ts
```

또는 V2 구현 복잡도를 줄이기 위해 `packages/architecture-view`에 semantic schema/validator를 함께 둘 수 있다. 최종 구조는 구현 시 결정하되 schema source-of-truth 원칙은 유지한다.

검증 단계:

1. schema
2. referential integrity
3. runtime containment integrity
4. interaction endpoint integrity
5. citation validation
6. semantic warnings

예상 diagnostic:

- `RESPONSIBILITY_WITHOUT_RUNTIME`
- `UNKNOWN_RUNTIME_REF`
- `UNKNOWN_INTERACTION_ENDPOINT`
- `ACTOR_WRAPPED_BY_RUNTIME`
- `MISSING_PRIMARY_SOURCE`
- `EMPTY_INTERACTION_LABEL`
- `ORPHAN_RUNTIME`
- `UNCONNECTED_PRIMARY_ENTITY`

“이 label이 기술명인지” 같은 의미 판별을 hard-coded framework dictionary로 엄격 검증하지 않는다. 해당 문제는 schema 구조와 prompt contract로 우선 방지한다.

---

## 9. MCP 변경

V1 tool:

- `validate_architecture_view`
- `submit_architecture_view`

V2 tool:

- `submit_runtime_semantics`
- `validate_architecture_view`
- `submit_architecture_view`

### 9.1 `submit_runtime_semantics`

입력:

```ts
{
  taskId,
  document: RuntimeSemanticDocument
}
```

동작:

1. schema 검증
2. referential integrity 검증
3. citation 검증
4. error가 있으면 commit하지 않고 diagnostics 반환
5. 통과하면 bridge task state에 immutable semantic revision으로 저장
6. `semanticRevision` 반환

MCP 서버 자체는 계속 stateless로 유지하고 상태 저장은 bridge가 담당한다.

### 9.2 Architecture tool과 semantic revision 연결

`validate_architecture_view`와 `submit_architecture_view`는 V2에서 `semanticRevision`을 받는다.

검증 시 architecture node/connection이 semantic model의 entity/interactions와 연결되는지 확인한다.

목표:

- 최종 diagram이 semantic extraction과 무관하게 새 topology를 환각하는 것 방지
- 의미 추출과 visual composition 사이 추적 가능성 확보

---

## 10. ArchitectureView V2 스키마

V1의 visual `type`은 renderer styling을 위해 유지한다.

```ts
type ComponentType =
  | "frontend"
  | "backend"
  | "database"
  | "cloud"
  | "security"
  | "messagebus"
  | "external";

type ArchitectureAudience = "simple" | "technical";

type PresentationOverride = {
  label?: string;
  sublabel?: string | null;
  visibility?: "show" | "hide";
};

type AudiencePresentation = {
  simple?: PresentationOverride;
  technical?: PresentationOverride;
};
```

component는 canonical geometry와 semantic mapping을 공유하고 presentation만 profile별로 override한다.

```ts
components[]: {
  id,
  type,
  semanticRole: "actor" | "responsibility" | "state" | "external",
  semanticRefs: string[],       // V2에서는 원칙적으로 length=1
  label,                        // canonical/technical default label
  sublabel?,                    // canonical implementation summary
  presentation?: {
    simple?: {
      label?,
      sublabel?: string | null,
      visibility?: "show" | "hide"
    },
    technical?: {
      label?,
      sublabel?: string | null,
      visibility?: "show" | "hide"
    }
  },
  pos,
  size,
  sources?
}
```

`semanticRefs`를 배열로 두는 이유는 향후 semantic grouping을 지원하기 위한 확장성 때문이다. **V2 MVP에서는 특별한 근거가 없는 한 정확히 1개의 semantic identity만 참조한다.**

boundary:

```ts
boundaries[]: {
  id?,
  kind: "runtime" | "region" | "security-group",
  semanticRefs?: string[],
  label,
  presentation?: AudiencePresentation,
  wraps,
  pad?
}
```

connection:

```ts
connections[]: {
  id?,
  from,
  to,
  semanticRefs?: string[],
  label?,
  presentation?: AudiencePresentation,
  variant?
}
```

document-level profile metadata:

```ts
presentation?: {
  defaultAudience: "simple",
  availableAudiences: ["simple", "technical"]
}
```

### 10.1 핵심 규칙

- `semanticRole=actor` component는 `kind=runtime` boundary 내부에 들어갈 수 없다.
- `semanticRole=responsibility`는 대응하는 semantic responsibility와 연결되어야 한다.
- runtime boundary는 semantic runtime과 연결되어야 한다.
- state/external node도 semantic model과 연결되어야 한다.
- architecture connection은 가능한 경우 semantic interaction을 참조한다.
- simple/technical 모두 같은 component `id`, semantic refs, geometry를 공유한다.
- presentation override는 semantic topology를 변경할 수 없다.
- simple profile에서 framework/library/protocol/vendor/package 기술 정보는 기본적으로 숨긴다.
- technical profile은 canonical `label`/`sublabel`을 그대로 사용할 수 있다.
- V2 MVP에서는 profile별 grouping을 금지한다. `semanticRefs.length > 1`은 schema상 허용하더라도 production authoring prompt에서는 생성하지 않도록 한다.
- profile별 `visibility=hide`는 허용하지만, 다른 shared node의 좌표를 다시 계산하지 않는다.

### 10.2 Display label 규칙

Simple label은 아래 우선순위를 따른다.

1. 사용자가 이해할 수 있는 역할/행동
2. 도메인 용어
3. 시스템 기능
4. 기술 제품명은 마지막 수단

예:

| Canonical / Technical | Simple |
|---|---|
| `Authentication Service` | `로그인 처리` |
| `Session State` | `현재 사용자 상태` |
| `AWS S3` | `사진 저장소` |
| `SQS` | `백그라운드 작업 전달` |
| `Admin Web Runtime` | `관리자 웹` |
| `POST /api/photos` | `사진 업로드` |

---

## 11. Composition 단계

Semantic model이 확정된 뒤 AI는 **하나의 canonical `ArchitectureViewDocument`**를 저작한다.

이 단계의 prompt는 repository 전체를 다시 해석하는 것이 아니라 **확정된 semantic model을 어떻게 읽기 좋은 다이어그램으로 배치할지**에 집중한다.

AI는 별도의 simple layout과 technical layout을 만들지 않는다.

### 11.1 Composition invariants

- 실제 runtime boundary를 먼저 배치한다.
- actor는 boundary 외부에 둔다.
- 가장 중요한 user/runtime interaction이 한눈에 보이게 한다.
- 하나의 global primary path가 자연스럽지 않으면 runtime별 local primary path를 사용한다.
- 다른 runtime 사이 interaction은 boundary 사이 연결로 표현한다.
- state/store는 해당 responsibility 또는 runtime 근처에 둔다.
- external dependency는 관계된 runtime 바깥에 둔다.
- supporting detail 때문에 primary path가 흐려지면 생략한다.
- 동일 의미를 component와 card에 중복하지 않는다.
- cards는 V2 기본값에서 생성하지 않는다.
- legend는 필요한 경우에만 표시한다.
- canonical node/edge/boundary에 `semanticRefs`를 부여한다.
- simple display label은 역할 중심으로 작성하고 기술 용어를 피한다.
- technical display는 canonical label과 implementation detail을 보존한다.

### 11.2 좌표 정책

V2에서는 V1처럼 AI가 canonical `pos`/`size`를 한 번 저작하는 방식을 유지한다.

이유:

- project-specific free-form topology 보존
- V1 geometry/validator/renderer 재사용
- auto-layout template으로 인한 새로운 topology bias 방지
- simple/technical 사이 공간적 일관성 유지

profile별 재-layout은 하지 않는다.

simple profile에서 일부 technical-only element가 숨겨져 공간이 비더라도 V2 MVP에서는 허용한다. 먼저 동일 geometry의 장점을 검증한 후 향후 필요하면 constrained compaction을 별도 버전에서 검토한다.

### 11.3 Presentation projection

canonical architecture가 확정된 후 renderer/UI는 audience profile에 따라 다음만 바꾼다.

- `label`
- `sublabel`
- `visibility`
- connection label
- detail inspector의 정보량
- legend/cards 노출 정도

다음은 바꾸지 않는다.

- semantic identity
- node/component id
- boundary membership
- connection endpoints
- canonical `pos`/`size`
- routing의 기본 topology

---

## 12. Prompt 구조

`apps/bridge/src/prompt.ts`를 하나의 거대 instruction으로 유지하지 않고 역할별 텍스트를 분리한다.

예:

```text
apps/bridge/src/prompts/
  runtime-semantic-contract.ts
  runtime-semantic-examples.ts
  architecture-composition-contract.ts
  audience-presentation-contract.ts
  architecture-schema.ts
  correction-contract.ts
```

### 12.1 Semantic extraction prompt

포함해야 할 내용:

- runtime architecture 정의
- actor/runtime/responsibility/state/external/interaction 정의
- 기술명보다 responsibility 우선
- `implementationHints`에 기술 사실 보존
- 근거 없는 추정 금지
- source citation 필수
- geometry/좌표를 생각하지 말 것
- simple/technical을 위해 semantic entity를 중복 생성하지 말 것
- micro-example은 semantic abstraction 참고용이며 topology 복사 금지

### 12.2 Composition prompt

포함해야 할 내용:

- 입력 semantic model을 source of truth로 사용
- repository를 다시 topology 관점으로 재발명하지 말 것
- canonical graph/layout은 정확히 하나만 저작
- clear primary story
- runtime boundary 우선
- actor outside
- responsibility primary label
- low-value edge 제거
- cards default off
- weak exemplar topology 복사 금지
- 모든 visual entity를 semantic identity와 연결

### 12.3 Audience presentation prompt

같은 composition 단계에서 profile metadata를 함께 저작하게 한다. 별도의 두 번째 repository 분석을 호출하지 않는다.

포함해야 할 내용:

- `simple`은 default audience
- simple label은 역할/행동 중심
- framework/library/protocol/vendor/package 이름을 simple canvas에서 숨김
- technical은 canonical label과 implementation detail 유지
- presentation은 semantic topology/geometry를 바꾸지 못함
- profile별 grouping 금지(V2 MVP)
- 필요하면 simple에서 low-value technical element를 `visibility=hide`할 수 있음
- shared element의 위치는 동일하게 유지

### 12.4 Prompt regression test

아래 의미가 prompt에 항상 존재하는지 테스트한다.

- `runtime architecture`
- `responsibility`
- implementation detail은 semantic model에 보존
- examples are not topology templates
- node/boundary/coordinate 복사 금지
- repository evidence only
- actor outside runtime
- semantic model source of truth
- exactly one canonical architecture/layout
- simple/technical share semantic identity and geometry
- simple hides technical jargon by default
- no profile-specific topology generation

---

## 13. Weak Exemplar 구성

신규 디렉토리:

```text
packages/architecture-view/examples/runtime/
  actor-outside-runtime.json
  responsibility-over-technology.json
  runtime-boundary.json
  primary-path-and-branch.json
```

각 예제는 가능한 한 작게 유지한다.

### 13.1 예제가 가르쳐야 하는 것

- 필드 shape
- label/sublabel 역할
- actor placement
- boundary semantics
- connection label style
- main path vs branch 표현

### 13.2 예제가 가르치면 안 되는 것

- 전체 node count
- 전체 runtime count
- 고정 horizontal layout
- fixed x/y coordinates
- storage는 항상 아래
- external은 항상 오른쪽
- actor는 항상 하나
- runtime은 항상 둘
- DB는 항상 마지막 node

### 13.3 Full example의 위치

완성된 showcase architecture JSON은 renderer regression 및 문서 예제로 유지할 수 있지만 **기본 agent authoring prompt의 few-shot input으로는 사용하지 않는다.**

---

## 14. Renderer 변경

V1 renderer를 기반으로 확장한다.

### 14.1 Audience-aware renderer

렌더러 인터페이스 예:

```ts
renderArchitecture(
  document: ArchitectureViewDocument,
  options: {
    audience: "simple" | "technical";
    theme: "light" | "dark";
    selectedSemanticRef?: string;
  }
): string
```

renderer는 canonical node/geometry를 수정하지 않고 profile override를 적용한다.

적용 순서:

1. base canonical field
2. audience override
3. `visibility`
4. theme/style
5. render

### 14.2 Actor

`semanticRole=actor`는 기존 external 스타일을 그대로 쓰지 않고 actor로 쉽게 식별되는 visual treatment를 적용한다.

요구:

- runtime boundary 밖에서 잘 읽힘
- 일반 service/component와 시각적으로 구분
- 별도 거대한 icon library는 도입하지 않음
- simple/technical 모두 같은 위치 유지

### 14.3 Runtime boundary

`kind=runtime`은 일반 `region`보다 의미가 명확하게 드러나도록 처리한다.

예:

- technical: `Traveler App Runtime`
- simple: `여행자 앱`

runtime 구현 기술은 semantic `implementationHints`에 보존하며 simple boundary label에는 넣지 않는다.

### 14.4 Simple profile

기본 렌더링 규칙:

- audience default = `simple`
- framework/library/vendor/protocol/package sublabel 숨김
- 쉬운 display label 사용
- technical-only legend 숨김
- cards 기본 off
- 불필요한 technical edge label 숨김 가능
- `visibility=hide`인 요소/연결은 렌더하지 않음
- 숨겨진 요소 때문에 빈 공간이 생겨도 다른 entity를 profile별로 이동하지 않음

### 14.5 Technical profile

- canonical label 사용
- implementation sublabel 허용
- provider/database/queue/protocol 이름 표시 가능
- source/evidence detail 진입점 노출
- legend가 의미 있으면 표시

### 14.6 Web UI — 두 탭

`ArchitectureView` 상단에 같은 분석 결과를 전환하는 탭을 둔다.

```text
[ 쉬운 보기 ] [ 기술 구조 ]
```

기본 선택은 `쉬운 보기`.

중요한 UX 규칙:

- 탭 전환은 새 분석을 실행하지 않는다.
- 탭 전환은 새 architecture document를 요청하지 않는다.
- 동일 document에 `audience` 옵션만 바꿔 즉시 재렌더링한다.
- 선택된 semantic entity가 있으면 탭 전환 후에도 유지한다.
- 대응 node가 다른 profile에서 hidden이면 inspector selection은 유지하되 canvas selection만 표시하지 않을 수 있다.
- 동일 semantic entity는 가능한 한 동일한 화면 위치에서 보인다.

### 14.7 Detail Inspector

component/boundary/connection 클릭 시 semantic identity를 기준으로 상세 정보를 보여준다.

Simple에서 클릭:

```text
로그인 처리

역할
사용자의 로그인 상태를 확인합니다.

[기술 구조에서 보기]
```

Technical에서 클릭:

```text
Authentication

Implementation
JWT · Express

Sources
src/auth/...
```

`기술 구조에서 보기` 액션은 같은 semantic entity를 선택한 채 technical tab으로 전환한다.

### 14.8 Cards / Legend

- cards: 기본 off
- simple legend: 기본 off
- technical legend: 실제로 타입/표현 구분에 도움이 될 때만 표시
- primary diagram의 세로 공간을 cards/legend가 과도하게 차지하지 않게 한다.

---

## 15. Visual Review

V1에서는 SVG 문자열 구조 검증은 했지만 브라우저에서 실제 시각 품질을 확인하지 못했다.

V2 완료 기준에는 **simple과 technical 두 profile 모두 실제 visual review**를 포함한다.

### 15.1 브라우저 스모크 테스트

각 대표 fixture에 대해:

1. 웹 앱 실행
2. 분석 1회 수행
3. `쉬운 보기` 렌더
4. `기술 구조` 렌더
5. 같은 entity가 탭 전환 후 동일 위치/선택 상태를 유지하는지 확인
6. light/dark 각각 확인
7. profile별 screenshot 저장
8. 아래 checklist로 직접 검토

### 15.2 공통 Visual checklist

- actor가 runtime 안에 들어가 보이지 않는가?
- runtime boundary가 실제로 그룹으로 인지되는가?
- 어떤 runtime이 몇 개인지 빠르게 파악 가능한가?
- primary interaction story가 눈에 보이는가?
- edge가 무관한 component를 관통하지 않는가?
- arrow head가 box 아래에 묻히지 않는가?
- label overlap이 없는가?
- boundary label과 component가 충돌하지 않는가?
- local state / external dependency 위치가 의미적으로 납득되는가?
- cards/legend가 diagram보다 더 큰 비중을 차지하지 않는가?
- 서로 다른 fixture가 같은 topology template처럼 보이지 않는가?

### 15.3 Simple profile checklist

- framework/library/protocol/vendor/package 이름이 기본 canvas에 노출되지 않는가?
- 기술 스택 이름을 가려도 시스템 구조를 이해할 수 있는가?
- primary label이 “무엇을 하는가”를 설명하는가?
- `runtime`, `service`, `state`, `worker` 같은 기술 용어가 불필요하게 남지 않았는가?
- 기술적인 edge label이 쉬운 표현으로 바뀌었거나 숨겨졌는가?
- 비전공자에게 필요 없는 legend가 보이지 않는가?

### 15.4 Technical profile checklist

- canonical semantic identity가 보존되는가?
- implementation hints가 정확한 semantic entity에 연결되는가?
- source/evidence inspector로 들어갈 수 있는가?
- simple에서 보던 entity와 위치/선택 대응이 자연스러운가?

### 15.5 Cross-profile consistency checklist

- 두 탭의 node id/semantic refs가 같은가?
- 두 탭 사이 connection endpoint가 바뀌지 않는가?
- profile 전환 때문에 새 topology가 생성되지 않는가?
- shared node가 크게 이동하지 않는가?
- 선택한 entity가 탭 전환 후에도 같은 semantic identity를 가리키는가?
- simple에서 hidden 처리된 detail이 technical에서 올바르게 복구되는가?

### 15.6 자동 AI screenshot critique

이번 V2에서는 비목표다.

먼저 수동 visual review를 완료 기준으로 고정하고, 추후 반복 비용이 커질 때 AI vision critique loop를 별도 버전에서 검토한다.

---

## 16. 테스트 계획

### 16.1 Runtime semantic schema

- unknown runtime kind 거부
- responsibility의 unknown `runtimeId` 거부
- interaction의 unknown endpoint 거부
- actor가 runtimeId를 가지는 구조 거부
- source 없는 핵심 responsibility 거부
- 중복 id 거부
- `implementationHints` kind 유효성

### 16.2 Semantic validator

- orphan runtime warning
- unconnected responsibility warning
- citation failure
- invalid state ownership
- interaction endpoint integrity
- semantic entity count sanity warning

### 16.3 ArchitectureView V2

- actor가 runtime boundary에 wrap되면 error
- runtime boundary의 semanticRefs가 runtime을 가리키지 않으면 error
- responsibility node의 semanticRefs 불일치 error
- state/external mapping 검증
- connection semanticRefs 검증
- V1 geometry regression 전체 유지
- simple/technical profile이 같은 `pos`/`size`를 공유하는지 테스트
- audience override가 base topology를 바꿀 수 없는지 테스트
- simple `visibility=hide`가 다른 node 좌표를 변경하지 않는지 테스트

### 16.4 Presentation tests

- simple에서는 technical sublabel이 기본적으로 숨겨짐
- simple label override 적용
- technical은 canonical label/sublabel 복원
- simple에서 `AWS S3` 같은 vendor 명칭을 role label로 치환한 fixture
- connection label profile override
- 탭 전환 전후 semantic selection 유지
- hidden node 선택 시 inspector identity 유지
- default audience가 `simple`
- 같은 analysis result에서 두 profile이 렌더되며 추가 AI 호출이 없는지 확인

### 16.5 Prompt tests

- schema prompt 동일성
- anti-overfit clause 존재
- actor outside clause 존재
- implementation detail 보존 규칙 존재
- semantic model source-of-truth 규칙 존재
- full showcase example이 production authoring prompt에 포함되지 않는지 테스트
- exactly one canonical architecture/layout 규칙 존재
- profile-specific topology 금지 규칙 존재
- simple technical-jargon suppression 규칙 존재
- simple/technical same semantic identity/geometry 규칙 존재

### 16.6 Fixture E2E

최소 4개 fixture:

| Fixture | 기대 topology |
|---|---|
| local-first app | 단일 runtime + local state |
| web monolith | browser/user → web/server → DB |
| worker system | request/producer → queue → worker |
| dual-runtime app | 사용자 runtime + 관리자 runtime |

각 fixture에서 확인:

- repository 분석은 1회
- semantic model submit 1회 이상
- architecture validate 1회 이상
- final architecture submit 정확히 1회
- simple/technical 전환 때문에 추가 architecture 생성 호출 없음
- source citation 존재
- runtime boundary 생성 여부
- actor placement
- canonical technology facts 보존
- simple canvas의 technology jargon 억제
- technical view의 implementation detail 노출
- 두 profile의 semantic ids/geometry 일치
- 탭 전환 선택 상태 유지
- 브라우저 visual review
- 서로 다른 fixture의 node/boundary count와 graph shape가 실제로 다르게 생성되는지 기록

---

## 17. V1 → V2 마이그레이션

### 17.1 유지

- npm workspaces 구조
- `@vibee/protocol`
- `@vibee/architecture-view`
- `@vibee/mcp-server`
- `@vibee/bridge`
- `@vibee/web`
- Claude Agent SDK adapter
- Codex stub
- bridge HTTP/WS 구조
- geometry routing
- SVG renderer 기반
- citation 기반 검증
- validate/submit self-correction loop

### 17.2 변경

- `RuntimeSemanticDocument` 추가
- `implementationHints`를 semantic fact로 보존
- semantic submit tool 추가
- task state에 semantic revision 저장
- ArchitectureView schema에 `semanticRole`, `semanticRefs`, runtime boundary 추가
- `presentation.simple` / `presentation.technical` override 추가
- canonical layout 1개만 생성하는 규칙 추가
- prompt를 semantic extraction / composition / audience presentation으로 분리
- weak micro-exemplar 추가
- cards 기본 off
- actor/runtime visual treatment 추가
- `쉬운 보기` / `기술 구조` 탭 추가
- semantic selection을 두 탭에서 공유
- detail inspector에 progressive disclosure 추가
- browser visual review를 두 profile 모두의 완료 기준에 추가

### 17.3 제거/축소

- architecture 생성 prompt에서 generic component taxonomy만으로 의미를 유도하는 방식
- full architecture example을 topology template처럼 주입하는 방식
- simple view에 기술 stack을 sublabel로 기본 노출하는 방식
- simple/technical용 별도 graph/layout 생성
- “schema 통과 + SVG 문자열 구조 정상 = 시각 품질 완료”라는 암묵적 완료 기준

---

## 18. 실행 흐름

```text
[사용자]
   │ 프로젝트 경로
   ▼
[Web]
   │
   ▼
[Bridge / Claude Agent SDK]
   │
   ├─ Read / Grep / Glob
   │
   ▼
[Runtime Semantic Extraction]
   │
   ├─ actors
   ├─ runtimes
   ├─ responsibilities
   ├─ states
   ├─ externals
   ├─ interactions
   └─ implementationHints
   │
   ▼
[MCP submit_runtime_semantics]
   │
   ├─ schema
   ├─ references
   └─ citations
   │
   ▼
[Committed Semantic Revision]
   │
   ▼
[Canonical Architecture Composition]
   │
   ├─ runtime boundaries
   ├─ actor placement
   ├─ primary story
   ├─ branches
   ├─ canonical pos / size
   ├─ semanticRefs
   └─ audience presentation overrides
   │
   ▼
[MCP validate_architecture_view]
   │
   ├─ schema
   ├─ semantic mapping
   ├─ geometry
   ├─ audience presentation constraints
   └─ citation
   │
   ▼
[MCP submit_architecture_view]
   │
   ▼
[One Canonical Architecture Document]
   │
   ├───────────────┐
   ▼               ▼
[Simple Profile] [Technical Profile]
   │               │
   └───────┬───────┘
           ▼
 [Same geometry / semantic identity]
           │
           ▼
 [Web tabs + shared selection]
           │
           ▼
 [Detail Inspector]
           │
           ▼
 [Browser Visual Review]
```

탭 전환은 위 파이프라인을 다시 실행하지 않는다. committed architecture document에 `audience` 옵션만 변경해 렌더링한다.

---

## 19. 완료 기준

V2는 아래 조건을 모두 만족해야 완료로 본다.

### 코드/테스트

- 전 workspace build 성공
- 전 workspace typecheck 성공
- 모든 unit test 통과
- V1 geometry/render regression test 유지
- Runtime semantic schema/validator test 통과
- Architecture semantic mapping test 통과
- audience presentation test 통과
- prompt regression test 통과

### E2E

서로 다른 topology의 fixture 최소 4개에서 실제 Claude 분석을 실행한다.

각 실행에서:

- repository 탐색 확인
- 분석 1회
- `submit_runtime_semantics` 성공
- semantic revision 생성
- `validate_architecture_view` 1회 이상
- `submit_architecture_view` 정확히 1회
- simple/technical 탭 전환 시 추가 AI architecture 생성 없음
- 최종 architecture에 citation 존재
- actor/runtime/responsibility/state/external이 repository 특성에 맞게 선택됨
- 서로 다른 fixture가 동일한 topology template으로 붕괴하지 않음
- simple/technical이 동일 semantic refs와 canonical geometry를 공유함

### Simple profile 품질

최소 4개 fixture에서 확인:

- 기본 탭이 `쉬운 보기`
- framework/library/protocol/vendor/package 이름이 기본 canvas에 노출되지 않음
- 기술 명칭 없이도 주요 구조와 상호작용을 이해할 수 있음
- primary label이 역할/행동 중심임
- 불필요한 technical legend/cards가 숨겨짐

### Technical profile 품질

- canonical responsibility 확인 가능
- implementation hints 확인 가능
- source/evidence inspector 접근 가능
- simple에서 본 entity와 동일 semantic identity로 연결됨

### Cross-profile 품질

- 같은 entity가 두 탭에서 가능한 한 같은 위치
- 탭 전환 후 selection 유지
- connection endpoint/topology 불변
- hidden detail 복구 정상
- profile별 별도 AI layout 없음

### 시각 품질

profile별 screenshot을 브라우저에서 직접 확인한다.

반드시 확인:

- actor / runtime 경계 구분
- primary story 가독성
- label overlap
- arrow routing
- light/dark mode
- cards/legend 과밀 여부
- fixture별 구조적 다양성
- 두 profile 사이 공간적 일관성

결과와 screenshot path, raw 테스트 수치, 실제 모델 사용량, 계획과 달라진 점을 `docs/v2_impl.md`에 기록한다.

---

## 20. 성공 판정의 핵심 질문

V2의 성공 여부는 단순히 “예쁜 SVG가 생성되는가?”로 판단하지 않는다.

각 결과에 대해 다음 질문에 답할 수 있어야 한다.

1. **누가 이 시스템과 상호작용하는가?**
2. **어떤 runtime들이 실제로 존재하는가?**
3. **각 runtime 안에서 어떤 책임들이 협력하는가?**
4. **어떤 상태/저장소/외부 시스템과 통신하는가?**
5. **가장 중요한 실행 흐름이 무엇인가?**
6. **쉬운 보기에서 기술 스택 이름을 몰라도 시스템 구조를 이해할 수 있는가?**
7. **기술 구조 탭에서 구현 기술과 source evidence까지 추적할 수 있는가?**
8. **두 탭이 동일한 semantic identity와 topology를 가리킨다는 것이 사용자에게 자연스럽게 느껴지는가?**
9. **탭을 바꿔도 같은 entity의 위치와 선택 맥락이 유지되는가?**
10. **다른 repository를 넣었을 때 같은 모양을 복사하지 않고 실제 구조에 맞게 달라지는가?**
11. **두 presentation을 위해 분석/architecture 생성 비용이 두 배로 늘어나지 않는가?**

11개 질문에 대체로 “예”라고 답할 수 있을 때 V2의 목표를 달성한 것으로 본다.

---

## 21. 로드맵

V2 이후 후보:

### (a) 사용자/시스템 흐름 시각화

Architecture semantic model과 분리된 `ScenarioIR` 기반 journey view.

### (b) 증분 분석

직전 semantic revision + git diff만으로 semantic model patch.

### (c) Sequence drill-down

architecture interaction의 `semanticRefs`를 기반으로 sequence view 생성.

### (d) 자동 visual critique

headless browser screenshot을 vision-capable model에 전달해 overlap/visual hierarchy 문제를 제한된 correction round로 보정.

### (e) semantic composition cache

repository revision별 semantic model과 canonical architecture를 저장해 presentation만 즉시 재렌더링.

### (f) Simple-view semantic grouping

V2 사용성 검증 후 simple view가 여전히 복잡한 경우에만 도입한다.

예:

```text
Technical:
[Auth Service] [Reward Service] [Session Store]

Simple:
[로그인 · 보상 관리]
```

이 경우 simple presentation node가 여러 `semanticRefs`를 참조하도록 확장한다.

단, grouping이 새로운 사실/topology를 만들지 않도록 다음 제약이 필요하다.

- grouping은 기존 semantic entity 집합만 사용
- 새 interaction을 만들 수 없음
- group 내부 detail은 technical view에서 모두 복구 가능
- canonical technical topology와 추적 가능성 유지
- grouping 전용 검증기와 visual review 필요

### (g) Profile-specific constrained compaction

simple에서 많은 technical-only node를 숨겨 여백이 과도하게 생길 때만 검토한다.

완전한 별도 layout이 아니라 canonical geometry를 기준으로 제한된 compaction만 허용하는 방향을 우선한다.

---

## 22. 핵심 파일 예상

```text
packages/protocol/
  src/runtime-semantic.ts
  src/architecture-view.ts
  src/presentation.ts

packages/architecture-view/
  schemas/architecture-view.schema.json
  examples/runtime/
    actor-outside-runtime.json
    responsibility-over-technology.json
    runtime-boundary.json
    primary-path-and-branch.json
    simple-labeling.json
  src/
    geometry.ts
    validator.ts
    render.ts
    citation.ts
    semantic-mapping.ts
    presentation.ts

packages/runtime-semantic/         # 실제 구현 시 architecture-view 내부 병합 가능
  schemas/runtime-semantic.schema.json
  src/
    validator.ts
    citation.ts

packages/mcp-server/
  src/index.ts

apps/bridge/
  src/
    prompt.ts
    prompts/
      runtime-semantic-contract.ts
      runtime-semantic-examples.ts
      architecture-composition-contract.ts
      audience-presentation-contract.ts
      correction-contract.ts
    state.ts
    store.ts
    agents/claude/adapter.ts

apps/web/
  src/components/
    ArchitectureView.tsx
    ArchitectureAudienceTabs.tsx
    ArchitectureInspector.tsx
    DiagnosticsPanel.tsx
    AnalyzingConsole.tsx

docs/
  v2_plan.md
  v2_impl.md
```

`packages/runtime-semantic`을 별도 workspace로 둘지 `packages/architecture-view`에 포함할지는 구현 전 dependency graph와 파일 규모를 보고 결정한다. 의미 모델이 architecture 이외의 향후 journey/sequence에서도 재사용될 가능성이 확인되면 별도 package를 우선한다.

presentation 관련 코드는 semantic fact를 변경하지 않는 순수 projection layer로 유지한다. `simple`/`technical` 전환은 bridge 재분석 없이 web/renderer 레벨에서 수행하는 것을 기본 원칙으로 한다.
