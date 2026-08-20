# A. graph 설계 개요

내부에 하나의 project graph만 존재하고 사용자는 그 그래프를 여러 관점으로 볼 수 있게 하기

## 핵심 구조

```
코드
 ↓
우리 툴이 의미를 추출
 ↓
Semantic Project Graph
 = Node + Relation
 ↓
그 위에
 ├ 서비스 지도
 ├ 사용자 흐름
 └ 정보 흐름(데이터 관점)
    같은 필터를 씌움
 ↓
화면에 그래프로 렌더링
```

```
             실제 Repository
                    │
                    ▼
        Implementation Analysis
     AST / imports / calls / DB / routes
                    │
                    ▼
             Semantic Lifting
                    │
                    ▼
           Semantic Candidates
                    │
           의미 압축 / 병합
                    │
                    ▼
       ┌────────────────────────┐
       │ Semantic Project Graph │
       │                        │
       │ Node + Relation        │
       │ + Group                │
       │ + implementation refs  │
       │ + confidence           │
       └───────────┬────────────┘
                   │
       ┌───────────┴────────────┐
       ▼                        ▼
 localhost Viewer             MCP
       │                        │
       ▼                        ▼
   비전공자                  Claude/Codex
```

Project Graph : 내부의 구조화된 데이터
Graph View : 사용자가 실제로 보는 시각화 화면

## 작동 핵심 구조
semantic project graph를 생성하기 위한 
3단계

```
실제 코드
   ↓
Implementation Evidence
   ↓
Semantic Lifting
   ↓
Node 후보 생성
   ↓
비전공자 관점으로 압축
   ↓
Semantic Project Graph
   ↕
코드 변경과 계속 동기화
```

# B. 내부 핵심 구성 요소
## 1.노드(Node)
노드란 서비스 안에 존재하거나 일어나는 의미 있는 것

**노드 생성 기준**
	비전공자가 서비스의 구조·동작·변경 영향을 이해하는 데 독립적인 의미를 가지는 개념만 Node로 만든다.
**노드 표현 기준**
	명사와 동사로만 한다.
**노드 분류 기준**
	 그래프에서 맡는 역할로 분류한다.

|타입|의미|Instagram 예|
|---|---|---|
|**사람 Actor**|누가 사용하는가|사용자, 관리자|
|**화면 Surface**|사람이 보고 상호작용하는 곳|피드, 프로필, 게시물 작성 화면|
|**행동 Action**|사람 또는 시스템이 하는 일|게시물 올리기, 좋아요 누르기, 피드 구성하기|
|**정보 Information**|서비스가 가지고 사용하는 것|게시물, 계정, 팔로우 관계, 댓글|
|**외부 External**|프로젝트 밖의 서비스|사진 저장소, 결제 서비스, Google 로그인|
|**규칙 Rule**|중요한 조건/제약|비공개 계정은 승인 후 팔로우|

명사 => Actor, Surface, Information
동사 => Action
Rule = 서비스 동작을 이해하는 데 중요한 사용자/제품 수준의 조건이나 정책

**Implementation Grounding**.
이렇게 Semantic node (의미론적 노드)를 만들었으면 그 노드가 실제 코드 어디에서 나온건지는 내부적으로 가지고 있어야한다. 
	- 사용자에게는 보여주지 않음.
	- 이게 있어야지 나중에 뭐를 수정했을때 코드 어디가 영향받는지 분석할 수 있고 codex/claude에게 실제 파일들을 전달할 수 있음. 
	- feature <-> file/function 가 되어서 코드단에서 상위 구조를 탐색할 수 있음
=> 즉 사람에게는 Semantic Graph, Agent에게는 Semantic Graph + Implementation Grounding. 을 준다.

### a.기준
- 1. **비전공자가 이름을 보고 무엇인지 이해할 수 있는가?**
- 2. **이것만 따로 설명하거나 수정할 가치가 있는가?**
- 3. **없어지거나 바뀌었을 때 서비스의 동작을 설명하는 데 의미 있는 변화가 생기는가?**
- 4. **다른 중요한 요소와 의미 있는 관계를 가지는가?**

Action에는 속성을 추가해서 사용자 행동/시스템 행동 을 구분.
(actor = user, actor = system)

사용자 행동 예: 좋아요 누르기, 댓글 작성, 게시물 올리기, 팔로우 요청
시스템 행동 예: 피드에 보여줄 게시물 선택, 알림 만들기, 추천 사용자 선택

### b.구분

Group / Area (map에서만 쓰는 단위)
= **탐색을 위한** 큰 분류
= 계정 / 콘텐츠 / 소셜 / 탐색

Feature
= 사용자가 하나의 기능이라고 인식하는 **의미 단위**
= 게시물 작성 / 팔로우 / 댓글 / 프로필 수정

Semantic Node
= Feature를 설명하기 위해 실제 그래프를 구성하는 요소
= 게시물 작성 화면 / 사진 선택 / 게시물 등록 / 게시물 정보

```
[콘텐츠]                 ← Group

   [게시물 작성]          ← Feature

       │
       ├ [게시물 작성 화면] ← Node
       ├ [사진 선택]       ← Node
       ├ [게시물 등록]      ← Node
       └ [게시물 정보]      ← Node
```


## 2.관계(Relationship)
두 Node 사이의 의미를 비전공자가 이해할 수 있는 제한된 관계 어휘로 표현한다.

| Relation  | 의미                 | 예                |
| --------- | ------------------ | ---------------- |
| **실행한다**  | 누가 행동을 함           | 사용자 → 좋아요 누르기    |
| **보여준다**  | 화면이 정보를 표시         | 피드 화면 → 게시물      |
| **사용한다**  | 행동이 정보/외부 요소를 이용   | 피드 구성 → 팔로우 관계   |
| **변경한다**  | 행동이 정보를 만들거나 수정    | 좋아요 누르기 → 좋아요 정보 |
| **발생시킨다** | 하나의 행동이 다른 행동을 일으킴 | 좋아요 누르기 → 알림 만들기 |
| **제한한다**  | 규칙이 어떤 행동을 제어      | 비공개 규칙 → 팔로우 승인  |

ex)
```
<사용자> : node
    │
  실행한다 : relationship
    ↓
<좋아요 누르기> : node(정확히는 action node가 됨)
    │
 변경한다 : relationship
    ↓
<좋아요 정보> : node
```


Relation에는 source/target 조건을 걸기. 무분별한 관계생성을 방지하기 위함.

ex)
실행한다
Actor → Action 만 허용.

사용한다
Action → Information
Action → External 만 허용.

### 구분
코드 의존성도 함께 관리해야한다. 그래야지 에이전트가 특정 노드에서 의존성을 따라가거나 영향 범위를 탐색할 수 있음.

내부에 둘 Implementation Relation 과 사용자에게 보여줄 Semantic Relation을 구분한다.
영향도 판단할떄는 Implementation Relation을 확인해서 하고 사람한테 보여줄때는 저걸 사람언어로 번역해서 보여주기.

실제:
```
LikeButton
  calls
likeService
  writes
likes table
  calls
NotificationService
```
사용자:
```
[좋아요 누르기]
      │
   변경한다
      ▼
[좋아요 정보]

[좋아요 누르기]
      │
  발생시킨다
      ▼
[알림 만들기]
```


# C. 내부 비핵심 구성 요소
## MAP구성 (화면구성 기능)

### 그룹(Group/Area)
그룹은 Group은 Node 또는 하위 의미 묶음을 탐색하기 쉽게 정리하는 UI상의 분류
	그룹은 project graph의 핵심 의미 데이터라기 보다는 그래프를 보기 편하게 정리하기 위한 보조 정보로 보면 된다.
	
원칙: 같은 사용자 목적을 위해 자주 함께 사용되는 것들을 묶는다. (사용자 입장에서 같은 목적을 수행하는지에 집중)

ex) 
로그인
로그아웃
프로필 보기
프로필 수정
게시물 작성
게시물 삭제
좋아요 누르기
댓글 작성
팔로우
언팔로우

가 너무 많으니깐 
계정]
 ├ 로그인
 ├ 로그아웃
 ├ 프로필 보기
 └ 프로필 수정

콘텐츠]
 ├ 게시물 작성
 └ 게시물 삭제

소셜]
 ├ 좋아요
 ├ 댓글
 ├ 팔로우
 └ 언팔로우
이런식으로 줄이는거 

### 계층(level)
사용자에게 어느 깊이까지 보여줄 것인가.
Level은 데이터 타입이 아니라 사용자가 보고 있는 추상화의 깊이
```
level0 - 서비스
Instagram

level1 - 큰 영역
계정
콘텐츠
관계
탐색
알림

level2 - 사용자가 아는 개념
관계
 ├ 팔로우
 ├ 좋아요
 ├ 댓글
 └ 차단

level3 - 실제 동작
팔로우
 ├ 팔로우 요청
 ├ 요청 승인
 ├ 언팔로우
 └ 팔로우 상태 확인

level4 - 구현
FollowButton
follow API
follow service
follow table
...

```

### 탭
서비스 지도 : 무엇으로 구성되어 있나?
/ 사용자 흐름 : 사용자가 무엇을 하나?
/ 정보 흐름 : 정보가 어디에서 와서 어디로 가나?

으로 탭을 구성.

사용자가 특정 노드를 선택하면 '관련된 것만 보기', '영향 범위 보기'가 별도의 focus mode로 동작하게 하기.


## 가설

- Node가 정확히 6종류여야 하는가?
- Relation이 정확히 현재 6종류여야 하는가?
- Feature가 별도 객체인가?
- Group에는 Node만 들어가는가?
- Level을 항상 0~4로 유지하는가?
- Information의 범위는 어디까지인가?