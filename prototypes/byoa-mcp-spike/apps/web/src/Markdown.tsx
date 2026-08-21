/**
 * 아주 작은 마크다운 렌더러.
 *
 * bridge의 `renderNarrative`가 내보내는 부분집합만 다룬다 — 제목, 목록, 인용, 굵게, 기울임.
 * 라이브러리를 하나 더 들이지 않으려고 직접 쓴다. 사람용 설명은 bridge에서 한 번만
 * 렌더되고(§5) 여기서는 그것을 보여주기만 하므로 렌더러가 둘로 갈라지지 않는다.
 */
import type { ReactNode } from "react";

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.split("\n");
  let list: string[] = [];
  let quote: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul${blocks.length}`}>
        {list.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push(
      <blockquote key={`bq${blocks.length}`}>
        {quote.map((item, index) => (
          <p key={index}>{inline(item)}</p>
        ))}
      </blockquote>,
    );
    quote = [];
  };
  const flush = () => {
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (line.startsWith("- ")) {
      flushQuote();
      list.push(line.slice(2));
      continue;
    }
    if (line.startsWith("> ")) {
      flushList();
      quote.push(line.slice(2));
      continue;
    }
    flush();

    if (!line.trim()) continue;
    if (line.startsWith("### ")) blocks.push(<h4 key={blocks.length}>{inline(line.slice(4))}</h4>);
    else if (line.startsWith("## ")) blocks.push(<h3 key={blocks.length}>{inline(line.slice(3))}</h3>);
    else if (line.startsWith("# ")) blocks.push(<h2 key={blocks.length}>{inline(line.slice(2))}</h2>);
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();

  return <div className="markdown">{blocks}</div>;
}

/** `**굵게**`와 `*기울임*`만 처리한다. 중첩은 다루지 않는다 — 우리가 그렇게 내보내지 않는다. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) parts.push(<strong key={parts.length}>{match[1]}</strong>);
    else parts.push(<em key={parts.length}>{match[2]}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
