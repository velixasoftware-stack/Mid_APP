// Per-test "Remarks" text as printed on the report. Plain text keeps its line
// breaks; text that looks like a table - every non-empty line split by tabs
// (pasted from Excel) or by "|" (typed) - renders as a real table, first row
// as the heading.

function splitRow(line) {
  const cells = line.includes('\t') ? line.split('\t') : line.split('|');
  // "| a | b |" style: drop the empty edge cells the outer pipes produce.
  if (!line.includes('\t')) {
    if (cells.length && cells[0].trim() === '') cells.shift();
    if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  }
  return cells.map((c) => c.trim());
}

// Returns rows (array of cell arrays) when the text is a table, else null.
export function parseRemarksTable(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2 || !lines.every((l) => l.includes('\t') || l.includes('|'))) return null;
  const rows = lines
    .map(splitRow)
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c))); // skip "---|---" separator lines
  return rows.length >= 2 && rows[0].length >= 2 ? rows : null;
}

export function RemarksContent({ text }) {
  const rows = parseRemarksTable(text);
  if (!rows) return <p className="remarks-text">{text}</p>;
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')];
  return (
    <table className="remarks-table">
      <thead><tr>{pad(rows[0]).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.slice(1).map((r, ri) => (
          <tr key={ri}>{pad(r).map((c, i) => <td key={i}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

// The "Remarks" block under a test on the report - nothing at all when empty.
export function ReportRemarks({ text }) {
  if (!text || !text.trim()) return null;
  return (
    <div className="report-remarks">
      <strong>Remarks</strong>
      <RemarksContent text={text} />
    </div>
  );
}
