import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// JSX를 DOM 없이 직접 렌더할 필요는 없다. 이 계약 테스트는 세 message kind가 각각
// 다른 marker를 고르고 self-message까지 같은 lookup을 쓰는지를 source 수준에서 고정한다.
const SOURCE_PATH = fileURLToPath(new URL("../src/components/SequenceView.tsx", import.meta.url));
const source = readFileSync(SOURCE_PATH, "utf8");

test("SequenceView는 call·return·event에 서로 다른 marker를 배정한다", () => {
  assert.match(source, /call:\s*"url\(#seq-arrow\)"/u);
  assert.match(source, /return:\s*"url\(#seq-arrow-return\)"/u);
  assert.match(source, /event:\s*"url\(#seq-arrow-event\)"/u);
  assert.match(source, /id="seq-arrow-return"[\s\S]*?<path d="M1,1 L8\.5,5 L1,9"/u, "return은 열린 V marker다");
  assert.match(source, /id="seq-arrow-event"[\s\S]*?<circle cx="5" cy="5" r="3"/u, "event는 속 빈 원 marker다");
  assert.match(source, /markerEnd=\{MARKER_BY_KIND\[message\.kind\]\}/u);
});

test("SequenceView는 세 kind의 한국어 범례와 call-return 묶음을 표시한다", () => {
  assert.match(source, /sequence-call-return-pair/u);
  assert.match(source, /호출\(call\)/u);
  assert.match(source, /반환\(return\)/u);
  assert.match(source, /이벤트\(event\)/u);
});
