/**
 * 위키 대화 준비 (docs/vibe_coding_assistant_design.md §3.5).
 *
 * **어느 말이 키워드인지는 여기서 정하지 않는다.** 처음에는 빈도로 뽑았는데 실제 대화에
 * 돌리니 `wait` · `getting` · `turn` 같은 것이 상위를 차지했다. 빈도는 낯섦과 반대 방향이다
 * — 가장 자주 나오는 말이 가장 익숙한 말이다. "비전공자가 모를 만한 말"은 판단이므로
 * agent가 고른다 (SPIKE_FINDINGS.md §16).
 *
 * 여기 남는 것은 판단이 아닌 일뿐이다 — 걷어내기, 자르기, 세기.
 */
import type { TranscriptMessage, WikiPage, WikiTranscript } from "@vci/protocol";

import { unwrapUserText } from "./prompt.js";

/** agent에게 넘길 대화의 상한. 대화가 길어져도 한 turn의 비용이 폭발하지 않게 한다. */
const MAX_TRANSCRIPT_CHARS = 40_000;
/** 한 발화가 통째로 길면 자른다. 로그를 붙여넣은 경우가 대부분이다. */
const MAX_MESSAGE_CHARS = 1_200;

/**
 * agent가 읽을 수 있게 대화를 다듬는다.
 *
 * 코드 블록은 통째로 버린다. 거기에는 식별자와 로그가 가득해서, 남겨 두면 그것이 대화의
 * 대부분을 차지하고 정작 사람이 들은 말이 묻힌다. 우리가 씌운 래퍼는 **벗기되 안에 든
 * 사용자의 말은 남긴다** — 인터뷰 답변이 래퍼 가운데에 들어가 있어서, 통째로 버리면
 * 사용자가 한 말이 하나도 남지 않는다.
 *
 * 최근 것을 남긴다. 지금 궁금한 말은 방금 오간 말이다.
 */
export function condenseTranscript(messages: TranscriptMessage[]): WikiTranscript {
  const usable: TranscriptMessage[] = [];
  for (const message of messages) {
    const text = stripCode(unwrapUserText(message.text)).replace(/\s+/g, " ").trim();
    if (!text) continue;
    usable.push({ role: message.role, text: text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text });
  }

  const kept: TranscriptMessage[] = [];
  let size = 0;
  for (let i = usable.length - 1; i >= 0; i -= 1) {
    const message = usable[i];
    if (!message) continue;
    if (size + message.text.length > MAX_TRANSCRIPT_CHARS) break;
    size += message.text.length;
    kept.unshift(message);
  }

  return { messages: kept, skipped: usable.length - kept.length };
}

/**
 * 그 말이 대화에 몇 번 나왔는지.
 *
 * agent에게 맡기지 않는다 — 세는 일은 모델이 잘 못하고, 여기서는 정확할 필요가 있다.
 */
export function countOccurrences(messages: TranscriptMessage[], term: string): number {
  const needle = term.toLowerCase();
  let count = 0;
  for (const message of messages) {
    const haystack = stripCode(unwrapUserText(message.text)).toLowerCase();
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      count += 1;
      from = at + needle.length;
    }
  }
  return count;
}

/** 그 말이 실제로 오간 대목들. 위키 turn이 "무엇을 가리키는 말인지" 아는 유일한 근거다. */
export function findMentions(messages: TranscriptMessage[], term: string, limit = 12): string[] {
  const needle = term.toLowerCase();
  const found: string[] = [];
  for (const message of messages) {
    for (const sentence of stripCode(unwrapUserText(message.text)).split(/(?<=[.!?。…])\s+|\n+/)) {
      if (!sentence.toLowerCase().includes(needle)) continue;
      const sample = trimSample(sentence);
      if (sample && !found.includes(sample)) found.push(sample);
      if (found.length >= limit) return found;
    }
  }
  return found;
}

/** 코드 블록과 인라인 코드를 들어낸다. */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
}

function trimSample(sentence: string): string {
  const one = sentence.replace(/\s+/g, " ").trim();
  return one.length > 160 ? `${one.slice(0, 160)}…` : one;
}

/**
 * 권고·평가로 읽히는 표현.
 *
 * 이 페이지는 순수 학습용이다. 그런데 **프롬프트만으로는 지켜지지 않는다** — 금지를 세 번
 * 적어 둔 프롬프트에서도 haiku가 "실제 서비스로 만들 때는 데이터베이스로 바꿔야 합니다"를
 * 붙였다 (SPIKE_FINDINGS.md §16). 모델에게 맡길 수 없으므로 저장할 때 본다.
 *
 * **거절하지 않고 경고를 되돌린다.** 판단이 아니라 신호이고, 문장 검사는 반드시 새기 때문이다.
 * agent는 경고를 받고 다시 쓸 수 있다.
 */
const ADVICE_PATTERNS: Array<[RegExp, string]> = [
  [/(바꿔야|고쳐야|바꾸는 게|교체해야|사용해야|써야)\s*(합니다|한다|좋습니다|좋다)?/g, "무엇을 해야 한다는 권고"],
  [/(권장|추천|개선|보완이 필요|주의가 필요|고려해)/g, "권장·개선 제안"],
  [/(문제가 있|위험|취약|비효율|적절하지 않|충분하지 않|한계가 있)/g, "평가"],
  [/(실제 서비스|프로덕션|real (app|service|users)|production)[^.]{0,40}(에서는|에선|when|would)/gi, "'실제로는 이렇지 않다'는 암시"],
  [/\b(should|must|recommend|better to|instead of|consider)\b/gi, "영문 권고 표현"],
];

/** 페이지 본문에서 권고로 읽히는 대목을 찾는다. 비어 있으면 통과다. */
export function findAdvice(...texts: string[]): string[] {
  const hits: string[] = [];
  for (const text of texts) {
    for (const [pattern, label] of ADVICE_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const at = match.index ?? 0;
        const around = text.slice(Math.max(0, at - 40), at + match[0].length + 40).replace(/\s+/g, " ").trim();
        const note = `${label}: "…${around}…"`;
        if (!hits.includes(note)) hits.push(note);
      }
    }
  }
  return hits;
}

/**
 * 페이지를 마크다운으로도 내보낸다 (LLM 없이).
 *
 * JSON만 두면 우리 화면에서만 읽힌다. `.md`를 같이 두면 이미 있는 도구가 그대로 동작한다 —
 * Obsidian, GitHub, 에디터 미리보기, 노션 임포트. `related`는 `[[..]]`로 써서 백링크를 쓰는
 * 도구에서 그래프가 저절로 생기게 한다. 우리가 커넥터를 만들 이유가 없어진다.
 *
 * JSON이 원본이고 이쪽이 파생물이다 (`design.json` → `app_design.md`와 같은 관계).
 */
export function renderWikiMarkdown(page: WikiPage): string {
  const out = [`# ${page.term}`, "", page.oneLine, "", page.inThisProject, ""];
  if (page.where.length > 0) {
    out.push("## 이 프로젝트에서", "");
    for (const where of page.where) out.push(`- \`${where}\``);
    out.push("");
  }
  if (page.related.length > 0) {
    out.push("## 함께 보기", "", page.related.map((term) => `[[${term}]]`).join(" · "), "");
  }
  out.push("---", "", `<!-- vci:generated ${page.createdAt} -->`);
  return out.join("\n");
}
