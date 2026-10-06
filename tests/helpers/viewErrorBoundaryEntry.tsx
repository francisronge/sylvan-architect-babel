import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ViewErrorBoundary, { useViewErrorHandler } from '../../components/ViewErrorBoundary';
import { guardViewCallback } from '../../components/viewErrorHandling.ts';

const original = Object.freeze({ sentence: 'The original analysis', id: 'preserved' });
let cleanupCount = 0;
let tickCount = 0;

function Probe({ fault }: { fault: string }) {
  const reportError = useViewErrorHandler();
  useLayoutEffect(() => {
    if (fault === 'effect') throw new Error('Simulated D3 effect failure');
  }, [fault]);
  useEffect(() => {
    const interval = window.setInterval(() => { tickCount++; document.body.dataset.ticks = String(tickCount); }, 10);
    return () => { window.clearInterval(interval); document.body.dataset.cleanups = String(++cleanupCount); };
  }, []);
  useEffect(() => {
    if (fault !== 'deferred') return;
    const frame = requestAnimationFrame(guardViewCallback(() => { throw new Error('Simulated deferred drawing failure'); }, reportError));
    return () => cancelAnimationFrame(frame);
  }, [fault, reportError]);
  if (fault === 'render') throw new Error('Simulated <script>render failure</script>');
  return <p data-testid="ready">Rendered analysis</p>;
}

function Harness() {
  const [fault, setFault] = useState('none');
  const [analysis, setAnalysis] = useState(0);
  const [draft, setDraft] = useState('Unsaved work');
  return <>
    <h1>Surrounding controls</h1>
    <input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
    <pre data-testid="original">{JSON.stringify(original)}</pre>
    {['render', 'effect', 'deferred'].map(kind => <button key={kind} onClick={() => setFault(kind)}>Fail {kind}</button>)}
    <button onClick={() => setFault('none')}>Stop simulated fault</button>
    <button onClick={() => { setFault('none'); setAnalysis(value => value + 1); }}>Switch analysis</button>
    <ViewErrorBoundary resetKey={analysis}><Probe fault={fault} /></ViewErrorBoundary>
  </>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
