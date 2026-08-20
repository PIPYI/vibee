semantic project graph를 생성하기 위한 
3단계

```
실제 코드
   ↓
**Implementation Evidence**
   ↓
**Semantic Lifting**
   ↓
Node 후보 생성
   ↓
비전공자 관점으로 압축
   ↓
Semantic Project Graph
   ↕
코드 변경과 계속 동기화
```

좀 더 `Implementation Evidence → Semantic Lifting` 사이를 세부적으로 보면

```
**Implementation Evidence**
        ↓
Code Parsing
        ↓
CodeUnit IR
        ↓
Context Assembly
        ↓
Semantic Feature Extraction
        ↓
Validation / Retry
        ↓
Semantic Candidates
```

코드의 함수나 파일에서 이 코드가 어떤 의미를 가지고 무슨 역할을 하는지를 먼저 알아야함. 바로 코드끼리 연결해서 시각화 하는게 아니기 때문.

```
Repository

     ↓

1. Semantic Lifting
   함수/클래스 → 의미 feature

     ↓

2. Semantic Structure Reorganization
   feature들을 기능적 hierarchy로 재구성

     ↓

3. Artifact Grounding
   의미 구조 ↔ 실제 코드
   + dependency 연결
```


# semantic project graph 생성 구조

```
Repository
      │
      ▼
┌─────────────────────────────┐
│ 1. Language Analysis        │
│                             │
│ AST / parser                │
│ functions / classes         │
│ components / routes / DB    │
└─────────────┬───────────────┘
              │
              ▼
         CodeUnit IR
              │
      ┌───────┴────────┐
      │                │
      ▼                ▼
Implementation       Semantic
Relations            Lifting
calls/imports          │
reads/writes           ▼
routes...        Semantic Candidates
      │                │
      │                ▼
      │         Candidate Validation
      │                │
      │                ▼
      │       Product-level Compression
      │                │
      └───────┬────────┘
              ▼
     Semantic Project Graph
              │
      ┌───────┴─────────┐
      ▼                 ▼
Semantic Node       Relation
      ↕
Implementation References
```

## schematic lifting 
```
코드를 잘 자른다
      ↓
충분한 문맥과 함께 LLM에 준다
      ↓
출력 형태를 매우 강하게 제한한다
      ↓
프로그램이 결과를 검증한다
      ↓
잘못되면 다시 요청한다
      ↓
낮은 의미를 다시 높은 의미로 압축한다
      ↓
실제 코드와 연결을 유지한다
```

## CodeUnit IR
언어 중립적인(py뿐만 아니라 ts,tsx,js 다 가능하게) 중간 표현층을 두기.



