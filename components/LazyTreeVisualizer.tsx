import React, { useEffect, useState } from 'react';
import LoadingMark from './LoadingMark';
import { ViewFailure } from './ViewErrorBoundary';

// Replay construction, relation drawing and D3 are most of the app's code, and
// the first screen never shows a tree. App loads them as a separate chunk,
// starting right after its first render, so the first screen arrives sooner and
// the chunk is usually ready before an analysis is. Once loaded, the tree
// mounts synchronously, exactly as a static import would.
type AsyncTreeVisualizerModule = typeof import('./AsyncTreeVisualizer');
type AsyncTreeVisualizer = AsyncTreeVisualizerModule['default'];
type TreeVisualizerProps = React.ComponentProps<AsyncTreeVisualizer>;

let loaded: AsyncTreeVisualizer | null = null;
let loading: Promise<AsyncTreeVisualizer> | null = null;

export const preloadTreeVisualizer = (): Promise<AsyncTreeVisualizer> => {
  loading ??= import('./AsyncTreeVisualizer').then(
    module => (loaded = module.default),
    error => { loading = null; throw error; }
  );
  return loading;
};

const LazyTreeVisualizer: React.FC<TreeVisualizerProps> = (props) => {
  const [view, setView] = useState<{ component: AsyncTreeVisualizer | null; error?: unknown }>(() => ({ component: loaded }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (view.component) return;
    let current = true;
    preloadTreeVisualizer().then(
      component => { if (current) setView({ component }); },
      error => { if (current) setView({ component: null, error }); }
    );
    return () => { current = false; };
  }, [view.component, attempt]);
  if (view.component) return <view.component {...props} />;
  if (view.error) return <ViewFailure error={view.error} title="Could not load the tree view."
    onRetry={() => { setView({ component: null }); setAttempt(value => value + 1); }} />;
  // The status AsyncTreeVisualizer shows while it prepares, so loading the chunk
  // reads as the start of that same wait.
  return <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-emerald-200">
    <div role="status" aria-label="Loading">
      <div className="babel-preparation-mark"><LoadingMark compact /></div>
    </div>
  </div>;
};

export default LazyTreeVisualizer;
