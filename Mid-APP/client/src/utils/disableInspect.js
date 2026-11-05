// Best-effort deterrent against casually opening DevTools / right-click
// "Inspect" to poke at the DOM. A determined user can still reach DevTools
// through the browser's own menu, so this is not a security boundary -
// just friction for everyday users.
export function installInspectGuard() {
  const blockContextMenu = (e) => e.preventDefault();

  const blockDevToolsKeys = (e) => {
    const key = e.key;
    if (key === 'F12') { e.preventDefault(); return; }
    if (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(key)) { e.preventDefault(); return; }
    if (e.ctrlKey && (key === 'U' || key === 'u')) { e.preventDefault(); return; }
  };

  document.addEventListener('contextmenu', blockContextMenu);
  document.addEventListener('keydown', blockDevToolsKeys);

  return () => {
    document.removeEventListener('contextmenu', blockContextMenu);
    document.removeEventListener('keydown', blockDevToolsKeys);
  };
}
