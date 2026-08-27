# Vibee 🐝

Vibee는 Codex 또는 Claude Code 같은 로컬 Coding Agent를 프로젝트 지식 계층과 연결해주는
연동 앱입니다. 브라우저 화면과 로컬 bridge, Coding Agent가 함께 동작하며, 별도의 클라우드
백엔드나 계정 없이 사용자 컴퓨터 안에서만 실행됩니다.

## 기능

- **설계하기** — 비전공자를 위한 요구사항 인터뷰. 대화로 앱을 설계하고 구조화된 설계
  문서(`design.json`)와 사람이 읽는 설명, agent용 harness(`AGENTS.md`/`CLAUDE.md`)를
  만들어냅니다.
- **설계이탈관리** — 커밋이 프로젝트가 이미 정한 결정(DEC)·규칙(RULE)을 어기지 않았는지
  검토합니다.
- **구조개선** — 파일 비대화, 의미 중복, 방치된 임시 조치 세 가지 관점에서 코드 구조를
  점검합니다.
- **위키** — 인터뷰 중 나온 용어를 이 프로젝트 기준으로 설명해주는 학습 페이지를
  만듭니다.
- **구조파악** — AI가 코드를 읽고 지금 실행 중인 시스템의 런타임 아키텍처를 SVG
  다이어그램으로 그려줍니다.

## 시작하기

설치부터 실행까지 자세한 안내는 [`startup.md`](./startup.md)를 참고하세요. 요약하면:

```bash
cd app
npm install
npm run build
npm run bridge   # 터미널 1
npm run web      # 터미널 2
```

Codex를 쓴다면 최초 한 번 `npm run mcp:register`로 MCP 서버를 등록해야 합니다.
Claude Code는 별도 등록이 필요 없습니다.

## 구조

- `app/apps/bridge` — HTTP API + WebSocket + Coding Agent adapter를 갖는 로컬 서버
- `app/apps/web` — 브라우저 화면 (React)
- `app/packages/mcp-server` — Coding Agent가 앱에 도달하는 MCP tool을 노출하는 stdio 서버
- `app/packages/protocol` — 위 세 층이 공유하는 타입
- `app/packages/system-map` — "구조파악" 기능의 검증·레이아웃·SVG 렌더링 로직

## 라이선스

[GNU General Public License v3.0](./LICENSE)
