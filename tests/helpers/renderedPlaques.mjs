/** Runs in the page after painted readiness. Check every basic plaque shell,
 * including PF and theta plates, against other visible plaques and syntax. */
export function inspectRenderedPlaques() {
  const svg = document.querySelector('svg[data-babel-tree]');
  if (!svg) throw Error('No rendered tree for plaque inspection.');
  const visible = element => {
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const tree = [...svg.children].find(element => element.tagName.toLowerCase() === 'g');
  const inverse = tree?.getScreenCTM()?.inverse();
  if (!inverse) throw Error('No tree coordinate transform for plaque inspection.');
  const rect = element => {
    const box = element.getBoundingClientRect();
    const a = new DOMPoint(box.left, box.top).matrixTransform(inverse);
    const b = new DOMPoint(box.right, box.bottom).matrixTransform(inverse);
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  };
  const intersects = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1
    && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
  const shells = [...svg.querySelectorAll('.babel-feature-plaque-shell,.babel-pf-plate-shell,.vr-plaque,.babel-theta-grid-shell')]
    .filter(visible).map(element => ({ className: element.getAttribute('class'),
      owner: element.closest('[data-vr-owner-refs]')?.getAttribute('data-vr-owner-refs') ?? '',
      text: element.parentElement.textContent, box: rect(element) }));
  const labels = [...svg.querySelectorAll('.category-label,.terminal-label')].filter(visible)
    .map(element => ({ text: element.textContent, box: rect(element) }));
  return { shells,
    plaquePairs: shells.flatMap((a, index) => shells.slice(index + 1).filter(b => intersects(a.box, b.box)).map(b => ({ a, b }))),
    labels: shells.flatMap(shell => labels.filter(label => intersects(shell.box, label.box)).map(label => ({ shell, label }))) };
}
