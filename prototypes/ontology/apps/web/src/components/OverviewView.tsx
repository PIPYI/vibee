/**
 * OverviewView — area → item 트리 (§22). presentation hierarchy이지 Core ontology가 아니다.
 */
import type { OverviewIR } from "@onto/protocol";

export type OverviewItemSelection = { itemId: string; conceptRefs: string[]; scenarioRefs: string[]; label: string };

export function OverviewView({
  ir,
  onSelectItem,
}: {
  ir: OverviewIR;
  onSelectItem: (item: OverviewItemSelection) => void;
}): React.JSX.Element {
  const itemLabelById = new Map<string, string>();
  for (const area of ir.areas) for (const item of area.items) itemLabelById.set(item.id, item.label);

  return (
    <div className="overview-view">
      <h2>{ir.title}</h2>
      <div className="overview-areas">
        {ir.areas.map((area) => (
          <section key={area.id} className="overview-area">
            <h3>{area.label}</h3>
            <ul className="overview-items">
              {area.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="overview-item"
                    onClick={() =>
                      onSelectItem({
                        itemId: item.id,
                        conceptRefs: item.conceptRefs ?? [],
                        scenarioRefs: item.scenarioRefs ?? [],
                        label: item.label,
                      })
                    }
                  >
                    {item.label}
                    {(item.scenarioRefs?.length ?? 0) > 0 && <span className="pill">시나리오 →</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {ir.importantConnections && ir.importantConnections.length > 0 && (
        <section className="overview-connections">
          <h3>중요한 연결</h3>
          <ul>
            {ir.importantConnections.map((connection, index) => (
              <li key={index}>
                {itemLabelById.get(connection.from) ?? connection.from}
                {" → "}
                {itemLabelById.get(connection.to) ?? connection.to}
                {connection.label && <span className="dim"> — {connection.label}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
