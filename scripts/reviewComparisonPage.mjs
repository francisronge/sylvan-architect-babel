const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

// Captured images share a fixed viewport rather than contributing intrinsic
// grid heights. Switching versions therefore cannot push the tree below it.
export function buildReviewComparisonHtml({ title = 'Babel before and after', before, after }) {
  if (!before || !after) throw new Error('A comparison requires both capture images.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
html,body{margin:0;height:100%;background:#03100a;color:#dff5ec;font:14px system-ui,sans-serif}
main{height:100vh;height:100dvh;display:flex;flex-direction:column;min-width:0}
header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px;flex:0 0 auto;border-bottom:1px solid #173b31}
header span{flex:1;min-width:0;overflow-wrap:anywhere}
button{padding:7px 12px;border:1px solid #236b56;border-radius:4px;background:#0b1915;color:inherit;cursor:pointer}
button[aria-pressed="true"]{background:#19654e}
figure{position:relative;margin:0;flex:1 1 0;min-height:0;min-width:0;overflow:hidden}
figure img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain}
figure img[hidden]{display:none}
</style></head><body><main><header><span>${escapeHtml(title)}</span>
<button type="button" data-variant="before" aria-pressed="false">Before</button>
<button type="button" data-variant="after" aria-pressed="true">After</button></header>
<figure aria-label="Captured Replay comparison">
<img data-comparison-image="before" alt="Before repair" src="${escapeHtml(before)}" hidden>
<img data-comparison-image="after" alt="After repair" src="${escapeHtml(after)}">
</figure></main><script>
document.querySelectorAll('[data-variant]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('[data-comparison-image]').forEach(image=>{image.hidden=image.dataset.comparisonImage!==button.dataset.variant;});
  document.querySelectorAll('[data-variant]').forEach(control=>control.setAttribute('aria-pressed',String(control===button)));
}));
</script></body></html>`;
}

// Serializable browser inspection: loading alone does not prove visibility.
export function inspectComparisonImage() {
  const image = document.querySelector('[data-comparison-image]:not([hidden])');
  const figure = image?.closest('figure');
  if (!image || !figure) return { decoded: false, image: null, figure: null, viewport: null };
  const rectangle = element => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  return { decoded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
    image: rectangle(image), figure: rectangle(figure), viewport: { x: 0, y: 0, width: innerWidth, height: innerHeight },
    variant: image.dataset.comparisonImage, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
}

export function comparisonImageFits(state, tolerance = 2) {
  const finite = box => box && [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.width > 0 && box.height > 0;
  const contains = (outer, inner) => inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance;
  return Boolean(state.decoded && finite(state.image) && finite(state.figure) && finite(state.viewport)
    && contains(state.viewport, state.figure) && contains(state.figure, state.image));
}
