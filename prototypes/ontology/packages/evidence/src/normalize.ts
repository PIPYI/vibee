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
const SEP = "";

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
function tokenizeCode(text: string): string[] {
  // skipTrivia = true → 공백과 주석을 건너뛴다.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, text);
  const tokens: string[] = [];
  /** 콤마는 다음 토큰을 보고 나서 결정한다 — 닫는 괄호가 오면 후행 콤마다. */
  let pendingComma = false;

  for (;;) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;

    if (pendingComma) {
      // 닫는 괄호 앞의 콤마는 스타일이다. 그 외의 콤마는 구조를 나른다.
      if (!isClosingBracket(kind)) tokens.push(",");
      pendingComma = false;
    }

    if (isDroppedPunctuation(kind)) continue;

    if (kind === ts.SyntaxKind.CommaToken) {
      pendingComma = true;
      continue;
    }

    switch (kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        // getTokenValue()는 따옴표를 벗긴 값이다. 따옴표 스타일이 지문에서 사라진다.
        tokens.push(`str:${scanner.getTokenValue()}`);
        break;
      case ts.SyntaxKind.NumericLiteral:
      case ts.SyntaxKind.BigIntLiteral:
        tokens.push(`num:${scanner.getTokenValue()}`);
        break;
      case ts.SyntaxKind.Identifier:
      case ts.SyntaxKind.PrivateIdentifier:
        tokens.push(`id:${scanner.getTokenText()}`);
        break;
      default:
        tokens.push(scanner.getTokenText());
        break;
    }
  }

  // 파일 끝의 후행 콤마.
  if (pendingComma) tokens.push(",");
  return tokens;
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
