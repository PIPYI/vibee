# Vibee 처음 실행 가이드 🐝

이 문서는 코딩이나 터미널 사용이 익숙하지 않은 사람도 Vibee를 설치하고 실행할 수 있도록 순서대로 설명합니다. 처음에는 낯선 단어가 많아 보여도, 아래 명령을 위에서부터 한 줄씩 실행하면 됩니다.

> 예상 준비 시간: 약 15~30분  
> 필요한 것: 인터넷 연결, Git, Node.js, Codex 또는 Claude Code 중 하나

## 시작하기 전에 알아둘 점

### Vibee와 Coding Agent는 다른 프로그램입니다

Vibee는 코드를 직접 작성하는 새로운 AI가 아닙니다. 사용자가 이미 쓰고 있는 **Codex** 또는 **Claude Code**를 연결하여 설계, Wiki, Drift, 구조개선, 구조파악 기능을 제공하는 보조 앱입니다.

따라서 다음 두 프로그램 중 **하나만** 선택해 설치하면 됩니다.

- Codex를 사용한다면: Codex CLI 설치
- Claude Code를 사용한다면: Claude Code CLI 설치
- 둘 다 사용할 필요는 없습니다.

### 터미널이란 무엇인가요?

터미널은 글자로 컴퓨터에 명령을 내리는 프로그램입니다.

- macOS: `터미널` 앱
- Windows: `PowerShell`
- Linux·WSL: `Terminal`

이 문서의 검은 명령 상자 안에 있는 내용을 복사해서 터미널에 붙여 넣고 `Enter`를 누르면 됩니다. 명령 앞에 `$` 같은 기호가 보이더라도 직접 입력하지 않습니다.

### 명령은 어디에서 실행하나요?

Vibee 저장소를 받은 뒤에는 `package.json` 파일이 있는 **`vibee` 폴더**에서 명령을 실행해야 합니다. `apps/bridge`나 `apps/web` 폴더로 들어가지 마세요.

---

## 1. 필요한 프로그램 설치하기

Vibee를 실행하려면 Git, Node.js, Coding Agent가 필요합니다.

| 프로그램 | 하는 일 | 필수 여부 |
| --- | --- | --- |
| Git | Vibee 저장소를 내려받고 변경 이력을 관리합니다. | 필수 |
| Node.js와 npm | Vibee를 설치하고 실행합니다. | 필수 |
| Codex 또는 Claude Code | 프로젝트를 읽고 AI 판단을 수행합니다. | 둘 중 하나 필수 |

Vibee가 지원하는 Node.js 버전은 다음과 같습니다.

- Node.js `20.19.0` 이상
- 또는 Node.js `22.12.0` 이상
- 프로젝트 권장 버전: Node.js 22

### macOS

#### 1-1. Git 설치

터미널을 열고 다음 명령을 실행합니다.

```bash
xcode-select --install
```

설치 창이 나타나면 안내에 따라 완료합니다. 이미 설치되어 있다는 메시지가 나오면 다음 단계로 넘어갑니다.

#### 1-2. Node.js 설치

[Node.js 공식 다운로드 페이지](https://nodejs.org/en/download)에서 Node.js 22 LTS를 설치하는 방법이 가장 간단합니다.

설치 후 터미널을 완전히 닫았다가 다시 열고 확인합니다.

```bash
git --version
node --version
npm --version
```

세 명령 모두 버전 번호를 보여주면 정상입니다.

### Windows

#### 1-1. PowerShell 열기

시작 메뉴에서 `PowerShell`을 검색해 실행합니다. 아래 명령은 PowerShell에 한 줄씩 입력합니다.

#### 1-2. Git과 Node.js 설치

```powershell
winget install --id Git.Git -e --source winget
winget install --id OpenJS.NodeJS.LTS -e --source winget
```

설치가 끝나면 PowerShell을 완전히 닫았다가 다시 열고 확인합니다.

```powershell
git --version
node --version
npm --version
```

> `npm.ps1 cannot be loaded`라는 오류가 나오면 PowerShell 대신 `명령 프롬프트`를 사용하거나, 명령에서 `npm` 대신 `npm.cmd`를 입력하세요.

### Linux 또는 Windows WSL

Ubuntu·Debian 기준으로 다음 명령을 실행합니다.

```bash
sudo apt update
sudo apt install -y git curl build-essential
```

배포판의 기본 Node.js는 너무 오래된 경우가 많습니다. [nvm 공식 설치 안내](https://github.com/nvm-sh/nvm)를 따라 nvm을 설치한 뒤 다음 명령을 실행하는 것을 권장합니다.

```bash
nvm install 22
nvm use 22
```

설치가 끝나면 확인합니다.

```bash
git --version
node --version
npm --version
```

> WSL을 사용한다면 Git, Node.js, Coding Agent와 Vibee 저장소를 모두 WSL 안에 설치하세요. Windows에 설치한 Node.js와 WSL의 Node.js를 섞어 쓰지 않는 것이 중요합니다.

---

## 2. Coding Agent 하나 선택해 설치하기

### 선택 A: Codex 사용

#### macOS·Linux·WSL

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

#### Windows

```powershell
npm install -g @openai/codex
codex
```

처음 `codex`를 실행하면 로그인 안내가 나타납니다. `Sign in with ChatGPT` 등 사용할 로그인 방식을 선택하고 브라우저에서 인증을 완료합니다.

설치 확인:

```bash
codex --version
```

Codex 화면이 계속 열려 있다면 `Ctrl+C`를 눌러 터미널로 돌아와도 됩니다.

자세한 내용은 [공식 OpenAI Codex CLI 안내](https://learn.chatgpt.com/docs/codex/cli)를 참고하세요.

### 선택 B: Claude Code 사용

#### macOS·Linux·WSL

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

#### Windows PowerShell

```powershell
irm https://claude.ai/install.ps1 | iex
claude
```

처음 `claude`를 실행하면 로그인 안내가 나타납니다. 안내에 따라 Claude 계정 또는 Anthropic Console 계정으로 인증합니다.

설치 확인:

```bash
claude --version
```

Claude Code 화면이 계속 열려 있다면 `Ctrl+C`를 눌러 터미널로 돌아와도 됩니다.

Claude Code는 Claude Pro·Max·Team·Enterprise 또는 Console 계정 등이 필요하며, 무료 Claude.ai 요금제에는 포함되지 않습니다.

자세한 내용은 [Claude Code 공식 설치 안내](https://code.claude.com/docs/en/setup)를 참고하세요.

---

## 3. Vibee 내려받기

Vibee를 설치할 위치로 이동한 뒤 다음 명령을 한 줄씩 실행합니다. 위치를 잘 모르겠다면 macOS·Linux는 홈 폴더, Windows는 사용자 폴더에서 그대로 실행해도 됩니다.

```bash
git clone https://github.com/PIPYI/vibee.git
cd vibee
```

현재 위치가 맞는지 확인하고 싶다면 다음 명령을 실행합니다.

macOS·Linux·WSL:

```bash
pwd
```

Windows PowerShell:

```powershell
Get-Location
```

마지막 폴더 이름이 `vibee`이면 정상입니다.

### ZIP으로 내려받은 경우

GitHub에서 ZIP 파일을 내려받았다면 압축을 푼 뒤, `package.json` 파일이 보이는 Vibee 최상위 폴더에서 터미널을 열어야 합니다.

다만 Drift와 구조개선 일부 기능은 Git 커밋 기록을 사용하므로 가능하면 위의 `git clone` 방식을 권장합니다.

---

## 4. Vibee 설치 및 빌드하기

`vibee` 폴더에서 다음 명령을 한 줄씩 실행합니다.

```bash
npm ci
npm run build
```

각 명령의 뜻은 다음과 같습니다.

- `npm ci`: Vibee에 필요한 프로그램 묶음을 정확한 버전으로 설치합니다.
- `npm run build`: 사람이 작성한 소스 코드를 실제 실행 가능한 형태로 준비합니다.

처음 실행할 때는 몇 분 정도 걸릴 수 있습니다. 경고가 조금 표시되더라도 마지막에 오류 없이 터미널 입력 줄이 다시 나타나면 완료된 것입니다.

### Codex 사용자만: MCP 등록

Codex를 선택한 사람은 빌드 후 최초 한 번 다음 명령을 실행해야 합니다.

```bash
npm run mcp:register
codex mcp list
```

목록에 `vci-app`이 보이면 정상입니다. `vci-app`은 현재 Vibee 내부에서 사용하는 MCP 연결 이름입니다.

MCP는 Codex가 Vibee의 설계 정보와 분석 도구를 사용할 수 있게 연결해 주는 통로입니다. 한 번 등록하면 Vibee를 실행할 때마다 다시 등록할 필요가 없습니다.

Claude Code 사용자는 이 단계를 건너뜁니다. Vibee가 Claude Code를 실행할 때 필요한 연결 정보를 자동으로 전달합니다.

---

## 5. Vibee 실행하기

Vibee는 **브릿지**와 **웹 화면**을 동시에 실행해야 합니다. 따라서 터미널 창을 두 개 사용합니다.

- 터미널 1: Coding Agent와 Vibee를 연결하는 브릿지
- 터미널 2: 브라우저에 보여줄 웹 화면

두 터미널 모두 `vibee` 폴더에서 명령을 실행해야 합니다.

### 터미널 1 — 브릿지 실행

첫 번째 터미널에서:

```bash
cd vibee
npm run bridge
```

이미 `vibee` 폴더 안에 있다면 `cd vibee`는 생략합니다.

정상적으로 실행되면 다음과 비슷한 메시지가 나타납니다.

```text
[vci-bridge] listening on http://127.0.0.1:44120
[vci-bridge] events:   ws://127.0.0.1:44120/events
```

이 터미널은 종료하지 말고 그대로 둡니다.

### 터미널 2 — 웹 화면 실행

새 터미널 창을 하나 더 열고:

```bash
cd vibee
npm run web
```

정상적으로 실행되면 브라우저에서 다음 주소를 엽니다.

[http://127.0.0.1:5273/](http://127.0.0.1:5273/)

이 터미널도 Vibee를 사용하는 동안 그대로 둡니다.

> `cd vibee`에서 “폴더를 찾을 수 없다”는 메시지가 나오면 Vibee를 내려받은 위치가 현재 터미널 위치와 다른 것입니다. 파일 탐색기나 Finder에서 `vibee` 폴더를 찾은 뒤 해당 폴더에서 터미널을 여는 방법이 가장 쉽습니다.

### Vibee 종료하기

터미널 1과 터미널 2에서 각각 `Ctrl+C`를 누릅니다.

Codex용 MCP 등록은 그대로 유지되므로 다음 실행 때 다시 등록하지 않아도 됩니다.

---

## 6. Vibee에서 첫 프로젝트 연결하기

웹 화면이 열리면 다음 순서로 진행합니다.

1. Coding Agent에서 설치한 `Codex` 또는 `Claude Code`를 선택합니다.
2. 사용할 모델이 표시되는지 확인합니다.
3. 작업할 프로젝트의 **절대 경로**를 입력합니다.
4. 새 프로젝트라면 설계 인터뷰를 시작합니다.
5. 코드가 이미 있는 프로젝트라면 필요한 분석 기능을 선택합니다.

### 절대 경로란 무엇인가요?

절대 경로는 프로젝트 폴더의 전체 주소입니다.

```text
# macOS
/Users/myname/Projects/my-app

# Linux·WSL
/home/myname/projects/my-app

# Windows
C:\Users\myname\Projects\my-app
```

Finder나 파일 탐색기에서 프로젝트 폴더를 만든 뒤 그 경로를 복사하는 방법이 가장 쉽습니다.

### 새로운 앱을 만들고 싶다면

비어 있는 새 폴더를 준비하고 그 절대 경로를 입력합니다. Vibee가 새 프로젝트로 인식하면 `인터뷰 시작` 버튼을 보여줍니다.

인터뷰에서는 어떤 사용자가 앱을 쓰는지, 필요한 기능과 화면은 무엇인지 차례로 질문합니다. 답을 잘못 입력해도 설계 초안을 확인하면서 자연어로 정정할 수 있습니다.

인터뷰가 끝나면 Vibee가 다음 파일을 프로젝트 폴더에 만듭니다.

- `app_design.md`: 사람이 읽을 수 있는 설계도
- `design.json`: Vibee가 이후 기능에서 사용하는 구조화된 설계 정보
- `AGENTS.md` 또는 `CLAUDE.md`: Coding Agent가 읽는 프로젝트 지침

이후 실제 앱 구현과 수정은 Codex 또는 Claude Code에서 이어갑니다.

### 이미 코드가 있는 프로젝트를 살펴보고 싶다면

기존 프로젝트 폴더의 절대 경로를 입력합니다. 별도로 파일을 업로드할 필요는 없습니다.

- 구조개선: 비대해진 파일, 중복 로직, 방치된 임시 조치를 점검합니다.
- 구조파악: 현재 프로젝트의 시스템 구조를 시각화합니다.
- 위키: 해당 프로젝트에서 나눈 Coding Agent 대화가 있을 때 사용할 수 있습니다.
- Drift: Vibee 설계 인터뷰를 거친 프로젝트에서만 사용할 수 있습니다.

---

## 7. 다음에 다시 실행할 때

처음 설치와 빌드를 끝냈다면 다음부터는 터미널 두 개에서 아래 명령만 실행하면 됩니다.

터미널 1:

```bash
cd vibee
npm run bridge
```

터미널 2:

```bash
cd vibee
npm run web
```

브라우저에서 [http://127.0.0.1:5273/](http://127.0.0.1:5273/)을 엽니다.

## 8. Vibee 업데이트하기

두 터미널에서 실행 중인 Vibee를 `Ctrl+C`로 종료한 뒤, `vibee` 폴더에서 다음 명령을 실행합니다.

```bash
git pull
npm ci
npm run build
```

저장소 폴더 위치가 바뀌지 않았다면 Codex MCP를 다시 등록할 필요가 없습니다. 폴더를 다른 위치로 옮겼다면 다음 명령을 다시 실행합니다.

```bash
npm run mcp:register
```

---

## 9. 문제가 생겼을 때

오류가 발생해도 처음부터 다시 설치할 필요는 없습니다. 아래에서 화면에 나온 메시지와 비슷한 항목을 찾으세요.

### `git`, `node`, `npm`, `codex`, `claude` 명령을 찾을 수 없다고 나옵니다

프로그램 설치 후 기존 터미널이 새 경로를 아직 모르는 경우가 많습니다.

1. 열려 있는 터미널을 모두 닫습니다.
2. 새 터미널을 엽니다.
3. 해당 명령의 버전을 다시 확인합니다.

```bash
git --version
node --version
npm --version
codex --version
claude --version
```

사용하지 않는 Coding Agent의 명령은 실패해도 괜찮습니다.

### Coding Agent가 `설치 안 됨`으로 표시됩니다

Vibee 브릿지를 실행한 터미널에서 선택한 Agent가 보이는지 확인합니다.

macOS·Linux·WSL:

```bash
command -v codex
command -v claude
```

Windows PowerShell:

```powershell
Get-Command codex
Get-Command claude
```

CLI를 설치하거나 로그인한 뒤 브릿지를 `Ctrl+C`로 종료하고 `npm run bridge`로 다시 실행합니다.

### 모델 목록이 비어 있습니다

선택한 Coding Agent를 터미널에서 직접 한 번 실행하고 로그인을 완료합니다.

```bash
codex
# 또는
claude
```

로그인 후 브릿지를 다시 시작합니다.

### Codex에서 질문이나 결과가 Vibee 화면으로 돌아오지 않습니다

Codex용 MCP 연결을 갱신합니다. `vibee` 폴더에서:

```bash
npm run mcp:unregister
npm run mcp:register
codex mcp list
```

목록에 `vci-app`이 하나만 표시되는지 확인한 뒤 Codex와 브릿지를 다시 시작합니다.

### Node.js 버전 오류가 나타납니다

다음과 비슷한 오류는 Node.js가 너무 오래되었다는 뜻입니다.

```text
Node ...에서는 현재 Vite를 실행할 수 없습니다
```

현재 버전을 확인합니다.

```bash
node --version
```

Node.js `20.19.0` 이상 또는 `22.12.0` 이상이 필요합니다. 가능하면 Node.js 22를 설치하세요.

nvm 사용자라면 `vibee` 폴더에서 다음 명령을 실행합니다.

```bash
nvm install
nvm use
```

### `dist/index.js`를 찾을 수 없다고 나옵니다

빌드가 끝나지 않았거나 업데이트 후 다시 빌드하지 않은 상태입니다.

```bash
npm ci
npm run build
```

그다음 브릿지를 다시 실행합니다.

### 브라우저에서 Vibee 화면이 열리지 않습니다

다음 항목을 순서대로 확인합니다.

1. 터미널 2에서 `npm run web`이 계속 실행 중인지 확인합니다.
2. 주소가 `http://127.0.0.1:5273/`인지 확인합니다.
3. 브라우저를 새로고침합니다.
4. 그래도 안 되면 웹 터미널의 오류 메시지를 확인합니다.

WSL에서는 먼저 Windows 브라우저에서 같은 주소를 사용합니다. 연결되지 않으면 Ubuntu 터미널에서 `hostname -I`로 주소를 확인한 뒤 `http://<WSL-IP>:5273/`을 사용합니다.

### 44120 포트를 이미 사용 중이라고 나옵니다

다른 프로그램이 Vibee 브릿지의 기본 포트를 사용하고 있다는 뜻입니다. 브릿지와 웹이 같은 새 포트를 보도록 설정합니다.

macOS·Linux·WSL의 터미널 1:

```bash
VCI_BRIDGE_PORT=44121 npm run bridge
```

터미널 2:

```bash
BRIDGE_URL=http://127.0.0.1:44121 npm run web
```

Windows PowerShell의 터미널 1:

```powershell
$env:VCI_BRIDGE_PORT="44121"
npm run bridge
```

터미널 2:

```powershell
$env:BRIDGE_URL="http://127.0.0.1:44121"
npm run web
```

`VCI_BRIDGE_PORT`는 현재 구현에서 사용하는 내부 환경 변수 이름입니다. 제품명은 Vibee지만 이 변수명은 그대로 입력해야 합니다.

### npm 설치 중 권한 오류가 발생합니다

macOS·Linux에서 `sudo npm install -g ...`를 사용하지 마세요. Node.js를 nvm으로 설치하면 사용자 폴더에 전역 패키지가 설치되어 권한 문제를 줄일 수 있습니다.

---

## 10. 자주 나오는 용어

| 용어 | 쉬운 설명 |
| --- | --- |
| 저장소(repository) | Vibee의 코드와 문서가 들어 있는 GitHub 프로젝트 폴더입니다. |
| CLI | 버튼 대신 터미널 명령으로 사용하는 프로그램입니다. |
| Node.js | Vibee를 실행하는 데 필요한 기본 실행 환경입니다. |
| npm | Node.js 프로그램을 설치하고 실행하는 도구입니다. |
| 빌드(build) | 소스 코드를 컴퓨터가 실행할 수 있는 형태로 준비하는 과정입니다. |
| 브릿지(bridge) | Vibee 웹 화면과 Codex·Claude Code 사이를 연결하는 로컬 프로그램입니다. |
| MCP | Coding Agent가 Vibee의 정보와 도구를 사용할 수 있게 연결하는 규약입니다. |
| 절대 경로 | `/Users/.../my-app`처럼 폴더의 전체 주소입니다. |
| 포트(port) | 컴퓨터 안에서 프로그램이 서로 연결될 때 사용하는 번호입니다. |

## 공식 참고 문서

- [Vibee GitHub 저장소](https://github.com/PIPYI/vibee)
- [OpenAI Codex CLI](https://learn.chatgpt.com/docs/codex/cli)
- [OpenAI Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)
- [Claude Code 설치](https://code.claude.com/docs/en/setup)
- [Node.js 다운로드](https://nodejs.org/en/download)
- [Git 다운로드](https://git-scm.com/downloads)
- [nvm](https://github.com/nvm-sh/nvm)
