// Phone support for every data table in the app, without touching each screen:
// copies each column heading onto its body cells as data-label, so on narrow
// screens the CSS (see "Phone layout" in styles.css) can show every row as a
// small labelled card instead of a table that needs sideways scrolling.
//
// Opt-outs: the result-entry table, remarks tables and the printed report
// keep their own layouts; any table can also opt out with class="no-stack".
const SKIP = '.result-table, .remarks-table, .no-stack, .report-sheet table';

function labelTable(table) {
  if (table.matches(SKIP)) return;
  const heads = [...table.querySelectorAll(':scope > thead > tr:last-child > th')].map((th) => th.textContent.trim());
  if (heads.length === 0) return;
  table.classList.add('rt-stack');
  for (const tr of table.querySelectorAll(':scope > tbody > tr')) {
    let col = 0;
    for (const td of tr.children) {
      const span = Number(td.getAttribute('colspan') || 1);
      if (span > 1) td.classList.add('rt-full');
      else if (heads[col] && td.dataset.label !== heads[col]) td.dataset.label = heads[col];
      col += span;
    }
  }
}

let scheduled = false;
function labelAll() {
  scheduled = false;
  document.querySelectorAll('table').forEach(labelTable);
}

export function startResponsiveTables() {
  labelAll();
  // Screens render and re-render tables all the time - re-label after each
  // batch of DOM changes, at most once per animation frame.
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(labelAll);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
