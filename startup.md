# VCI 앱 설치 및 실행 가이드

이 문서는 개발 환경이 전혀 준비되지 않은 사용자가 저장소를 내려받아 VCI 앱을 실행하는 과정을 설명합니다.

VCI 앱은 로컬에서 다음 세 요소를 함께 실행합니다.

- `bridge`: Codex 또는 Claude Code와 웹 화면을 연결합니다.
- `web`: 브라우저에서 사용하는 화면입니다.
- Coding Agent: Codex CLI 또는 Claude Code CLI입니다. **둘 중 하나만 설치해도 됩니다.**

## 1. 공통 요구 사항

| 프로그램 | 필수 여부 | 권장 버전·용도 |
| --- | --- | --- |
| Git | 필수 | 저장소 다운로드, 변경 이력 확인, 복구 지점 관리 |
| Node.js와 npm | 필수 | Node.js 22 권장. 최소 `20.19` 이상 또는 `22.12` 이상 |
| Codex CLI | 선택 | 기본 Coding Agent. Claude Code를 쓰지 않는다면 필수 |
| Claude Code CLI | 선택 | 대체 Coding Agent. Codex를 쓰지 않는다면 필수 |

설치 후에는 새 터미널을 열고 다음 명령으로 확인합니다.

```bash
git --version
node --version
npm --version
codex --version    # Codex를 설치한 경우
claude --version   # Claude Code를 설치한 경우
```

Node.js가 `20.10`처럼 지원 범위보다 낮으면 앱이 실행되지 않습니다. 가능하면 프로젝트의 `.nvmrc`와 같은 Node.js 22를 사용하세요.

## 2. macOS 설치

### Git 설치

터미널에서 다음 명령을 실행하고 macOS의 설치 안내를 완료합니다.

```bash
xcode-select --install
```

이미 설치되어 있다는 메시지가 나오면 그대로 넘어가면 됩니다.

### Node.js 설치

초보자는 [Node.js 공식 다운로드 페이지](https://nodejs.org/en/download)에서 현재 LTS 버전을 설치하는 방법이 가장 간단합니다. Node.js 22 또는 그보다 새로운 LTS 버전을 선택하세요.

nvm을 이미 사용한다면 다음 명령으로 프로젝트 권장 버전을 설치할 수 있습니다.

```bash
cd vibee-app
nvm install
nvm use
```

### Codex CLI 설치

OpenAI 공식 설치 프로그램을 사용합니다.

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

처음 `codex`를 실행하면 브라우저 로그인 화면이 열립니다. `Sign in with ChatGPT` 등 사용할 로그인 방식을 선택하고 인증을 마치세요. 자세한 내용은 [공식 Codex CLI 안내](https://learn.chatgpt.com/docs/codex/cli)를 참고하세요.

Node.js와 npm으로 설치하고 싶다면 다음 방법도 사용할 수 있습니다.

```bash
npm install -g @openai/codex
codex
```

### Claude Code CLI 설치 — 선택 사항

Codex 대신 Claude Code를 사용할 사람만 설치하면 됩니다.

```bash
npm install -g @anthropic-ai/claude-code
claude
```

처음 실행할 때 Claude 계정 또는 Anthropic Console 계정으로 인증합니다. 자세한 지원 환경과 로그인 방식은 [Anthropic의 Claude Code 설치 안내](https://docs.anthropic.com/en/docs/claude-code/getting-started)를 참고하세요.

## 3. Windows 네이티브 설치

Windows에서는 PowerShell 또는 명령 프롬프트를 사용합니다. WSL을 사용할 예정이라면 이 절 대신 다음의 **Windows + WSL** 절을 따르세요.

### Git과 Node.js 설치

PowerShell에서 `winget`으로 설치할 수 있습니다.

```powershell
winget install --id Git.Git -e --source winget
winget install --id OpenJS.NodeJS.LTS -e --source winget
```

설치가 끝나면 **PowerShell을 완전히 닫았다가 다시 열고** 버전을 확인하세요.

```powershell
git --version
node --version
npm --version
```

`npm.ps1 cannot be loaded` 또는 스크립트 실행이 차단되었다는 메시지가 나오면 PowerShell 대신 명령 프롬프트를 사용하거나, PowerShell에서 `npm.cmd`를 사용하면 됩니다.

### Codex CLI 설치

```powershell
npm install -g @openai/codex
codex
```

처음 실행할 때 표시되는 로그인 절차를 완료하세요.

### Claude Code CLI 설치 — 선택 사항

```powershell
npm install -g @anthropic-ai/claude-code
claude
```

Windows 네이티브 Claude Code는 Git for Windows의 Git Bash를 사용합니다. Git이 기본 경로가 아닌 곳에 설치되어 Claude가 찾지 못한다면 다음처럼 경로를 지정할 수 있습니다.

```powershell
$env:CLAUDE_CODE_GIT_BASH_PATH="C:\Program Files\Git\bin\bash.exe"
claude
```

## 4. Windows + WSL 설치

Windows 환경에서는 WSL 2와 Ubuntu를 사용하는 방법도 권장됩니다. **Git, Node.js, Codex/Claude, 저장소를 모두 WSL 내부에 설치**해야 합니다. Windows에 설치한 Node.js와 WSL의 Node.js를 섞어 사용하지 마세요.

### WSL 설치

관리자 PowerShell에서 다음 명령을 실행한 뒤 Windows를 재시작합니다.

```powershell
wsl --install -d Ubuntu
```

재시작 후 Ubuntu 터미널에서 다음 단계를 진행합니다.

### Git과 기본 도구 설치

```bash
sudo apt update
sudo apt install -y git curl build-essential
```

### Node.js 설치

[nvm 공식 저장소](https://github.com/nvm-sh/nvm)의 설치 안내에 따라 nvm을 설치한 다음 다음 명령을 실행합니다.

```bash
nvm install 22
nvm use 22
```

`which node`와 `which npm` 결과는 `/mnt/c/...`가 아닌 WSL의 Linux 경로여야 합니다.

```bash
which node
which npm
node --version
```

### Codex 또는 Claude Code 설치

Codex:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

Claude Code를 사용할 경우:

```bash
npm install -g @anthropic-ai/claude-code
claude
```

## 5. Linux 설치

Ubuntu 또는 Debian 기준입니다. Fedora에서는 `apt` 대신 `dnf`를 사용하세요.

```bash
sudo apt update
sudo apt install -y git curl build-essential
```

배포판 기본 저장소의 Node.js가 너무 오래된 경우가 있으므로, [nvm 공식 저장소](https://github.com/nvm-sh/nvm)의 안내에 따라 nvm을 설치한 후 Node.js 22를 설치하는 것을 권장합니다.

```bash
nvm install 22
nvm use 22
```

Codex:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

Claude Code를 사용할 경우:

```bash
npm install -g @anthropic-ai/claude-code
claude
```

## 6. 저장소 받기와 최초 빌드

모든 플랫폼에서 저장소를 내려받은 뒤 **반드시 `app` 디렉터리에서** npm 명령을 실행합니다.

```bash
git clone https://github.com/PIPYI/vibee-app.git
cd vibee-app
npm ci
npm run build
```

`npm ci`는 프로젝트가 정한 버전대로 의존성을 설치합니다. `npm run build`는 브릿지와 내부 MCP 서버를 포함해 실행에 필요한 파일을 만듭니다.

저장소를 ZIP으로 받은 경우에는 압축을 푼 뒤 그 안의 `app` 디렉터리로 이동하면 됩니다. 다만 일부 기능이 Git 이력을 사용하므로 가능하면 `git clone`을 권장합니다.

## 7. 앱 실행

터미널 두 개를 열고 두 터미널 모두 `vibee-app` 디렉터리로 이동합니다.

### 터미널 1 — 브릿지

```bash
npm run bridge
```

정상 실행 예시:

```text
[vci-bridge] environment: macos/arm64, Node 22.x.x
[vci-bridge] listening on http://127.0.0.1:44120
[vci-bridge] events:   ws://127.0.0.1:44120/events
```

### 터미널 2 — 웹

```bash
npm run web
```

정상 실행되면 브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:5273/
```

WSL에서도 먼저 Windows 브라우저에서 위 주소를 사용하세요. 연결되지 않는 경우 Ubuntu에서 `hostname -I`로 WSL IP를 확인한 뒤 `http://<WSL-IP>:5273/`으로 접속합니다.

### 종료

각 터미널에서 `Ctrl+C`를 누르면 종료됩니다.

## 8. 업데이트 후 다시 실행할 때

코드나 의존성이 바뀐 업데이트를 받은 경우 다음 순서로 갱신합니다.

```bash
cd vibee-app
git pull
npm ci
npm run build
```

그런 다음 터미널 두 개에서 `npm run bridge`와 `npm run web`을 다시 실행합니다.

## 9. 정상 동작 확인

웹 화면에서 다음 항목을 확인합니다.

1. Coding Agent에 `Codex` 또는 `Claude Code`가 `설치 안 됨` 없이 표시됩니다.
2. Model 목록에 선택 가능한 모델이 나타납니다.
3. 실제로 존재하는 프로젝트의 절대 경로를 입력할 수 있습니다.
4. `인터뷰 시작` 버튼을 누르면 질문 또는 작업 결과가 표시됩니다.

프로젝트 경로 예시:

```text
# macOS
/Users/myname/Projects/my-app

# Linux/WSL
/home/myname/projects/my-app

# Windows
C:\Users\myname\Projects\my-app
```

## 10. 문제 해결

### Codex 또는 Claude가 `설치 안 됨`으로 표시되는 경우

앱을 실행한 것과 같은 터미널에서 CLI가 보이는지 확인합니다.

macOS, Linux, WSL:

```bash
command -v codex
command -v claude
codex --version
claude --version
```

Windows PowerShell:

```powershell
Get-Command codex
Get-Command claude
codex --version
claude --version
```

설치 직후라면 터미널을 완전히 닫았다가 다시 열고 브릿지를 재시작하세요. 이 앱은 nvm/fnm/Volta 등 다른 Node.js 버전에 설치된 CLI도 자동 탐색하지만, CLI 자체가 정상 실행되고 로그인되어 있어야 합니다.

### 모델 목록이 나오지 않는 경우

CLI를 직접 한 번 실행해 로그인을 완료합니다.

```bash
codex
# 또는
claude
```

로그인 후 브릿지를 `Ctrl+C`로 종료하고 `npm run bridge`로 다시 시작하세요. 웹은 브릿지가 돌아오면 자동으로 다시 연결합니다.

### `Node ...에서는 현재 Vite를 실행할 수 없습니다` 오류

현재 Node.js 버전이 너무 낮습니다.

```bash
node --version
```

nvm 사용자라면 다음 명령으로 해결할 수 있습니다.

```bash
cd vibee-app
nvm install
nvm use
```

### `dist/index.js`를 찾을 수 없다는 오류

최초 빌드가 빠졌거나 코드를 갱신한 뒤 다시 빌드하지 않은 상태입니다.

```bash
cd vibee-app
npm ci
npm run build
```

### 44120 포트를 이미 사용 중인 경우

브릿지와 웹 프록시가 같은 새 포트를 사용하도록 설정합니다.

macOS, Linux, WSL의 브릿지 터미널:

```bash
VCI_BRIDGE_PORT=44121 npm run bridge
```

웹 터미널:

```bash
BRIDGE_URL=http://127.0.0.1:44121 npm run web
```

Windows PowerShell의 브릿지 터미널:

```powershell
$env:VCI_BRIDGE_PORT="44121"
npm run bridge
```

웹 터미널:

```powershell
$env:BRIDGE_URL="http://127.0.0.1:44121"
npm run web
```

### npm 설치 권한 오류

macOS/Linux에서 `sudo npm install -g ...`를 사용하지 마세요. nvm을 사용하면 사용자 디렉터리에 Node.js와 전역 CLI가 설치되어 권한 문제를 피할 수 있습니다.

## 공식 참고 문서

- [OpenAI Codex CLI](https://learn.chatgpt.com/docs/codex/cli)
- [Claude Code 시작하기](https://docs.anthropic.com/en/docs/claude-code/getting-started)
- [Node.js 다운로드](https://nodejs.org/en/download)
- [Git 다운로드](https://git-scm.com/downloads)
- [nvm](https://github.com/nvm-sh/nvm)
