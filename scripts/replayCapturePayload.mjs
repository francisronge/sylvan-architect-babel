// Validation observes the original payload. It never deletes nodes or rewrites
// visible IDs to make an invalid capture look renderable.
export function assertReplayCapturePayload(payload, index) {
  const fail = message => { throw new Error(`Frame ${index + 1}: ${message}`); };
  if (!payload || typeof payload !== 'object') fail('missing Replay payload');
  if (!payload.replayCanvasData || typeof payload.replayCanvasData !== 'object') fail('missing replayCanvasData');
  if (!String(payload.operation || '').trim()) fail('missing Replay operation');
  const visible = payload.replayVisibleNodeIds;
  if (!Array.isArray(visible) || !visible.length || visible.some(id => typeof id !== 'string' || !id.trim())) {
    fail('replayVisibleNodeIds must be a nonempty string array');
  }
  if (new Set(visible).size !== visible.length) fail('duplicate visible occurrence IDs');
  const byId = new Map();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.id) {
      const instances = byId.get(node.id) || [];
      instances.push(node); byId.set(node.id, instances);
    }
    node.children?.forEach(visit);
  };
  visit(payload.replayCanvasData);
  for (const id of visible) {
    const instances = byId.get(id);
    if (!instances) fail(`visible occurrence ${id} is absent from the canvas`);
    const painted = instances.filter(node => node.replayLayoutOnly !== true);
    if (!painted.length) fail(`visible occurrence ${id} is layout-only`);
    if (painted.length > 1) fail(`visible occurrence ${id} appears more than once in the canvas`);
  }
}
