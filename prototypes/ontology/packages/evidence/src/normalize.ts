/**
 * 정규화 토큰 지문 (implementation_plan §6.2 T1, §6.5 S1).
 *
 * 이 파일이 하는 일 하나: **어떤 변경이 의미 변화인가**를 결정한다.
 *
 * - `rawHash`가 다르고 지문이 같으면 → `cosmetic`. dirty가 아니다.
 * - 지문이 다르면 → `modified`. dirty다.
 *
 * 그리고 agent-origin evidence의 **identity와 relocation도** 이 지문으로 한다. 바이트 해시를
 * 쓰면 prettier 한 번에 evidence id가 바뀌어 Grounding을 복구할 수조차 없다.
 *
 * ## 오차 방향을 정직하게
 *
 * - 지역 변수 이름만 바꿔도 토큰이 달라져 `modified`가 된다 → **거짓 양성.** 불필요한
 *   재검토일 뿐이므로 안전한 방향이다.
 * - 불변식을 설명하는 **주석만** 바뀌면 `code` 프로파일은 그것을 버리므로 `cosmetic`이 된다
 *   → **거짓 음성.** 위험한 방향이다. 그래서 `prose` 프로파일이 있다.
 */
import ts from "typescript";

import type { NormalizationProfile } from "@onto/protocol";

/** 토큰 구분자. 소스에 나타날 수 없는 문자여야 `a b`와 `ab`가 구별된다. */
const SEP = "\u0001";

/** 세미콜론은 ASI 때문에 순수한 스타일이다. 항상 버린다. */
function isDroppedPunctuation(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.SemicolonToken;
}

function isClosingBracket(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.CloseParenToken ||
    kind === ts.SyntaxKind.CloseBracketToken ||
    kind === ts.SyntaxKind.CloseBraceToken
  );
}

/**
 * `code` 프로파일 — 코드의 의미만 남긴다.
 *
 * 버리는 것: 공백 · 줄바꿈 · 주석 · 세미콜론 · **후행 콤마**
 * 정규화: 따옴표 스타일 (`'x'`와 `"x"`가 같은 토큰이 된다)
 * 남기는 것: 식별자 · 키워드 · 리터럴 **값** · 연산자 · 구조적 구두점
 */
/**
 * 위치까지 함께 나르는 정규화 토큰.
 *
 * relocation(§6.5 S1 ②)이 **같은 토큰 길이의 창**을 밀려면 두 가지가 필요하다 — 정규화된
 * 토큰 값(그래야 따옴표 스타일이 창을 어긋내지 않는다)과 원문에서의 위치(그래야 창을 다시
 * 줄 범위로 바꿀 수 있다).
 *
 * **지문 파이프라인과 같은 함수에서 나온다.** 세미콜론·후행 콤마를 여기서만 남기면 창 길이가
 * 지문의 토큰 수와 어긋나 relocation 이 조용히 실패한다 — 실제로 그렇게 한 번 틀렸다.
 */
export type NormalizedToken = {
  /** 지문에 들어가는 값. `id:` / `str:` / `num:` 접두사가 붙는다 */
  norm: string;
  start: number;
  end: number;
  isIdentifier: boolean;
};

function scanCode(text: string): NormalizedToken[] {
  // skipTrivia = true → 공백과 주석을 건너뛴다.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, text);
  const tokens: NormalizedToken[] = [];
  /** 콤마는 다음 토큰을 보고 나서 결정한다 — 닫는 괄호가 오면 후행 콤마다. */
  let pendingComma: { start: number; end: number } | null = null;

  for (;;) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;

    if (pendingComma) {
      // 닫는 괄호 앞의 콤마는 스타일이다. 그 외의 콤마는 구조를 나른다.
      if (!isClosingBracket(kind)) {
        tokens.push({ norm: ",", ...pendingComma, isIdentifier: false });
      }
      pendingComma = null;
    }

    if (isDroppedPunctuation(kind)) continue;

    const start = scanner.getTokenStart();
    const end = scanner.getTokenEnd();

    if (kind === ts.SyntaxKind.CommaToken) {
      pendingComma = { start, end };
      continue;
    }

    switch (kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        // getTokenValue()는 따옴표를 벗긴 값이다. 따옴표 스타일이 지문에서 사라진다.
        tokens.push({ norm: `str:${scanner.getTokenValue()}`, start, end, isIdentifier: false });
        break;
      case ts.SyntaxKind.NumericLiteral:
      case ts.SyntaxKind.BigIntLiteral:
        tokens.push({ norm: `num:${scanner.getTokenValue()}`, start, end, isIdentifier: false });
        break;
      case ts.SyntaxKind.Identifier:
      case ts.SyntaxKind.PrivateIdentifier:
        tokens.push({ norm: `id:${scanner.getTokenText()}`, start, end, isIdentifier: true });
        break;
      default:
        tokens.push({ norm: scanner.getTokenText(), start, end, isIdentifier: false });
        break;
    }
  }

  // 파일 끝의 후행 콤마.
  if (pendingComma) tokens.push({ norm: ",", ...pendingComma, isIdentifier: false });
  return tokens;
}

/**
 * `code` 프로파일 — 코드의 의미만 남긴다.
 *
 * 버리는 것: 공백 · 줄바꿈 · 주석 · 세미콜론 · **후행 콤마**
 * 정규화: 따옴표 스타일 (`'x'`와 `"x"`가 같은 토큰이 된다)
 * 남기는 것: 식별자 · 키워드 · 리터럴 **값** · 연산자 · 구조적 구두점
 */
function tokenizeCode(text: string): string[] {
  return scanCode(text).map((token) => token.norm);
}

/**
 * 낱말 단위 prose 토큰.
 *
 * `tokenizeProse`는 지문을 위해 **압축된 문자열 하나**를 돌려주지만, 창을 밀려면 낱말마다
 * 위치가 필요하다. 둘은 같은 것을 세지 않는다 — 그래서 일치 판정은 언제나
 * `fingerprintOf(slice, profile)`로 다시 확인한다.
 */
function scanProse(text: string): NormalizedToken[] {
  const tokens: NormalizedToken[] = [];
  const pattern = /\S+/gu;
  for (;;) {
    const match = pattern.exec(text);
    if (!match) break;
    tokens.push({
      norm: match[0],
      start: match.index,
      end: match.index + match[0].length,
      isIdentifier: true,
    });
  }
  return tokens;
}

/** relocation 이 쓰는 위치 있는 토큰열 (§6.5 S1). */
export function positionedTokens(text: string, profile: NormalizationProfile): NormalizedToken[] {
  return profile === "prose" ? scanProse(text) : scanCode(text);
}

/**
 * `prose` 프로파일 — 주석 · 문서 · 설정 텍스트를 **보존**하고 공백만 압축한다.
 *
 * 엔진이 모델링하지 못하는 정책이 주석·설정에 적혀 있는 경우가 많고, `propose_evidence`가
 * 정확히 그런 곳을 가리킨다. 거기에 `code`를 쓰면 주석 변경을 `cosmetic`으로 **놓친다.**
 */
function tokenizeProse(text: string): string[] {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  return collapsed.length === 0 ? [] : [collapsed];
}

export function normalizeTokens(text: string, profile: NormalizationProfile): string[] {
  return profile === "prose" ? tokenizeProse(text) : tokenizeCode(text);
}

/** 정규화 토큰열을 지문 계산의 입력 문자열로 만든다. */
export function normalizedText(text: string, profile: NormalizationProfile): string {
  return normalizeTokens(text, profile).join(SEP);
}

/** TypeScript/JavaScript로 파싱되는 확장자. 그 외는 `prose`가 기본이다. */
const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export function isCodeFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return CODE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Core가 extent의 성격을 보고 정하는 기본 프로파일 (§6.5 R2). 제안자가 덮어쓸 수 있다.
 */
export function defaultProfileFor(filePath: string): NormalizationProfile {
  return isCodeFile(filePath) ? "code" : "prose";
}
