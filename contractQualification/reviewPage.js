const embeddedJson = (value) => JSON.stringify(value)
  .replace(/&/gu, '\\u0026')
  .replace(/</gu, '\\u003c')
  .replace(/>/gu, '\\u003e')
  .replace(/\u2028/gu, '\\u2028')
  .replace(/\u2029/gu, '\\u2029');

export const buildQualificationReviewHtml = (reviewData) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
  <title>Babel qualification review</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #050b09;
      --surface: #08120f;
      --surface-2: #0b1915;
      --line: #173b31;
      --line-strong: #236b56;
      --text: #dff5ec;
      --muted: #8caf9f;
      --emerald: #42d9a4;
      --amber: #efbd6b;
      --red: #ff8f8f;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; color: var(--text); background: var(--bg); font: 14px/1.5 system-ui, sans-serif; }
    button, select { font: inherit; }
    button { color: inherit; }
    .app { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 100vh; }
    .review-controls { display: flex; min-width: 0; min-height: 48px; gap: 8px; align-items: center; overflow-x: auto; padding: 7px 10px; border-bottom: 1px solid var(--line); background: var(--surface); }
    .select { min-width: 0; height: 34px; padding: 0 30px 0 10px; border: 1px solid var(--line-strong); border-radius: 0; background: var(--surface-2); color: var(--text); }
    .attempt-select { width: min(340px, 34vw); }
    .view-select { width: 150px; }
    .status { display: inline-flex; width: max-content; margin-top: 8px; padding: 2px 7px; border: 1px solid var(--line-strong); color: var(--emerald); font: 700 10px/1.5 ui-monospace, monospace; text-transform: uppercase; }
    .review-controls .status { flex: 0 0 auto; margin: 0; }
    .status.repaired { color: var(--amber); border-color: #72552a; }
    .status.failed { color: var(--red); border-color: #703737; }
    main { min-width: 0; min-height: 0; padding: 20px 22px 36px; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--muted); font: 12px/1.5 ui-monospace, monospace; }
    .content { min-height: 0; }
    .control { min-height: 34px; padding: 6px 10px; border: 1px solid var(--line-strong); background: var(--surface-2); cursor: pointer; }
    .control:hover:not(:disabled) { border-color: var(--emerald); }
    .control:disabled { opacity: .4; cursor: default; }
    .analysis-switch { display: flex; flex: 0 0 auto; gap: 6px; }
    .analysis-switch .active { color: var(--emerald); border-color: var(--emerald); }
    .frame-count { flex: 0 0 auto; color: var(--muted); font: 12px/1 ui-monospace, monospace; white-space: nowrap; }
    .stage-title { min-width: 90px; flex: 1 1 auto; overflow: hidden; color: var(--muted); font: 11px/1.4 ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
    .frame-scrubber { width: clamp(140px, 22vw, 320px); flex: 0 0 auto; accent-color: var(--emerald); cursor: pointer; }
    .replay-view { width: 100%; height: 100%; }
    .capture { display: grid; width: 100%; height: 100%; min-height: 0; place-items: center; overflow: hidden; background: #020705; }
    .capture img { display: block; width: 100%; height: 100%; object-fit: contain; }
    .empty { padding: 28px; color: var(--muted); text-align: center; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(90px, 150px)); gap: 8px; margin-bottom: 18px; }
    .metric { padding: 12px; border-left: 2px solid var(--line-strong); background: var(--surface); }
    .metric strong, .metric span { display: block; }
    .metric strong { font-size: 20px; }
    .metric span { color: var(--muted); font-size: 11px; text-transform: uppercase; }
    .metric.t1 { border-color: #4bdca9; }
    .metric.t2 { border-color: #efbd6b; }
    .metric.t3 { border-color: #ff8f8f; }
    pre { margin: 0; max-width: 100%; overflow: auto; padding: 16px; border: 1px solid var(--line); background: var(--surface); color: #cce9df; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .failure { padding: 18px; border-left: 3px solid var(--red); background: var(--surface); }
    .failure strong { display: block; margin-bottom: 6px; color: var(--red); }
    .caption { margin: 0 0 10px; color: var(--muted); }
    .replay-mode { height: 100vh; overflow: hidden; }
    .replay-mode .app { height: 100vh; min-height: 0; }
    .replay-mode main { overflow: hidden; padding: 0; }
    .replay-mode .content { height: 100%; }
    @media (max-width: 860px) {
      .attempt-select { width: min(260px, 48vw); }
      .stage-title, .review-controls .status { display: none; }
      main { padding: 16px; }
      .replay-mode main { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header id="review-controls" class="review-controls"></header>
    <main>
      <section id="content" class="content"></section>
    </main>
  </div>
  <script id="review-data" type="application/json">${embeddedJson(reviewData)}</script>
  <script>
    const data = JSON.parse(document.getElementById('review-data').textContent);
    const tabs = ['Replay', 'Raw response', 'Normalized record', 'Diagnostics', 'Tier coverage', 'Receipt'];
    const state = { attempt: 0, analysis: 0, frame: 0, tab: 'Replay' };
    const pretty = (value) => JSON.stringify(value, null, 2);
    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const statusFor = (attempt) => {
      if (attempt.outcome.status === 'failed') return { label: 'Failed', className: 'failed' };
      const repaired = (attempt.receipt.ingress?.repairDiagnostics || []).length > 0;
      return repaired
        ? { label: 'Valid after repair', className: 'repaired' }
        : { label: 'Valid', className: '' };
    };
    const currentAttempt = () => data.attempts[state.attempt];
    const currentAnalysis = () => currentAttempt().analyses[state.analysis] || null;
    const setAttempt = (index) => {
      state.attempt = index;
      state.analysis = 0;
      state.frame = 0;
      state.tab = currentAttempt().analyses.length > 0 ? 'Replay' : 'Diagnostics';
      render();
    };
    const renderAnalysisSwitch = (attempt) => attempt.analyses.length > 1
      ? '<div class="analysis-switch">' + attempt.analyses.map((_, index) =>
          '<button class="control ' + (index === state.analysis ? 'active' : '') + '" data-analysis="' + index + '">Parse ' + (index + 1) + '</button>'
        ).join('') + '</div>'
      : '';
    const renderControls = () => {
      const attempt = currentAttempt();
      const analysis = currentAnalysis();
      const status = statusFor(attempt);
      const frames = analysis?.evidence.replay.frames || [];
      const frame = frames[state.frame] || null;
      document.getElementById('review-controls').innerHTML =
        '<select id="attempt-select" class="select attempt-select" aria-label="Attempt">' +
        data.attempts.map((item, index) => '<option value="' + index + '" ' + (index === state.attempt ? 'selected' : '') + '>' +
          escapeHtml(item.sentence) + '</option>').join('') + '</select>' +
        '<select id="view-select" class="select view-select" aria-label="View">' +
        tabs.map((tab) => '<option value="' + tab + '" ' + (tab === state.tab ? 'selected' : '') +
          (tab === 'Replay' && attempt.analyses.length === 0 ? ' disabled' : '') + '>' + tab + '</option>').join('') + '</select>' +
        renderAnalysisSwitch(attempt) +
        (state.tab === 'Replay' && analysis
          ? '<button class="control" id="prev-frame" ' + (state.frame === 0 ? 'disabled' : '') + '>Prev</button>' +
            '<input id="frame-scrubber" class="frame-scrubber" type="range" min="0" max="' + (frames.length - 1) +
            '" value="' + state.frame + '" step="1" aria-label="Replay frame">' +
            '<button class="control" id="next-frame" ' + (state.frame >= frames.length - 1 ? 'disabled' : '') + '>Next</button>' +
            '<span class="frame-count">' + (state.frame + 1) + ' / ' + frames.length + '</span>' +
            '<span class="stage-title" title="' + escapeHtml(frame?.replayProgressLabel || frame?.operation) + '">' +
            escapeHtml(frame?.replayProgressLabel || frame?.operation) + '</span>'
          : '<span class="stage-title">' + escapeHtml(attempt.attemptId) + ' · ' + escapeHtml(attempt.framework) +
            ' · ' + escapeHtml(attempt.model.label) + '</span>') +
        '<span class="status ' + status.className + '">' + status.label + '</span>';
      document.getElementById('attempt-select').addEventListener('change', (event) => setAttempt(Number(event.target.value)));
      document.getElementById('view-select').addEventListener('change', (event) => {
        state.tab = event.target.value;
        render();
      });
      document.querySelectorAll('[data-analysis]').forEach((button) => {
        button.addEventListener('click', () => {
          state.analysis = Number(button.dataset.analysis);
          state.frame = 0;
          render();
        });
      });
      document.getElementById('prev-frame')?.addEventListener('click', () => { state.frame -= 1; render(); });
      document.getElementById('next-frame')?.addEventListener('click', () => { state.frame += 1; render(); });
      document.getElementById('frame-scrubber')?.addEventListener('input', (event) => {
        state.frame = Number(event.target.value);
        render();
      });
    };
    const renderReplay = () => {
      const attempt = currentAttempt();
      const analysis = currentAnalysis();
      if (!analysis) {
        return '<div class="failure"><strong>No Replay was compiled.</strong>The response failed during ' +
          escapeHtml(attempt.outcome.phase || 'processing') + '. Its raw bytes and diagnostics remain available in the other tabs.</div>';
      }
      const capture = analysis.capture || { available: false, frames: [] };
      const image = capture.available && capture.frames[state.frame]
        ? '<img src="' + escapeHtml(capture.frames[state.frame]) + '" alt="Rendered Replay frame ' + (state.frame + 1) + '">'
        : '<div class="empty">Visual capture has not been generated. The compiled frame evidence remains inspectable.</div>';
      return '<div class="replay-view"><div class="capture">' + image + '</div></div>';
    };
    const renderTierCoverage = () => {
      const analysis = currentAnalysis();
      if (!analysis) return '<div class="empty">No renderer dispatch occurred because no normalized analysis was produced.</div>';
      const counts = analysis.evidence.renderer.tierCounts;
      return '<div class="summary">' +
        '<div class="metric t1"><strong>' + counts.tier1 + '</strong><span>Tier 1 claims</span></div>' +
        '<div class="metric t2"><strong>' + counts.tier2 + '</strong><span>Tier 2 claims</span></div>' +
        '<div class="metric t3"><strong>' + counts.tier3 + '</strong><span>Tier 3 claims</span></div></div>' +
        '<pre>' + escapeHtml(pretty(analysis.evidence.renderer)) + '</pre>';
    };
    const renderContent = () => {
      const attempt = currentAttempt();
      const analysis = currentAnalysis();
      let html = '';
      if (state.tab === 'Replay') html = renderReplay();
      if (state.tab === 'Raw response') {
        const raw = attempt.rawOutput;
        const content = raw.encoding === 'utf8' ? raw.text : raw.base64;
        html = '<p class="caption">Exact saved bytes. Encoding: ' + escapeHtml(raw.encoding) +
          '. SHA-256: ' + escapeHtml(raw.sha256) + '</p><pre>' + escapeHtml(content) + '</pre>';
      }
      if (state.tab === 'Normalized record') html = attempt.normalizedRecord
        ? '<pre>' + escapeHtml(pretty(attempt.normalizedRecord)) + '</pre>'
        : '<div class="empty">No normalized record was produced.</div>';
      if (state.tab === 'Diagnostics') html = '<pre>' + escapeHtml(pretty({
        ingress: attempt.receipt.ingress,
        outcome: attempt.outcome,
        renderer: analysis ? {
          diagnostics: analysis.evidence.renderer.diagnostics,
          unregistered: analysis.evidence.renderer.unregistered
        } : null
      })) + '</pre>';
      if (state.tab === 'Tier coverage') html = renderTierCoverage();
      if (state.tab === 'Receipt') html = '<pre>' + escapeHtml(pretty(attempt.receipt)) + '</pre>';
      document.getElementById('content').innerHTML = html;
    };
    const render = () => {
      document.body.classList.toggle('replay-mode', state.tab === 'Replay');
      renderControls();
      renderContent();
    };
    window.addEventListener('keydown', (event) => {
      if (state.tab !== 'Replay' || !currentAnalysis()) return;
      const count = currentAnalysis().evidence.replay.frames.length;
      if (event.key === 'ArrowLeft' && state.frame > 0) { state.frame -= 1; render(); }
      if (event.key === 'ArrowRight' && state.frame < count - 1) { state.frame += 1; render(); }
    });
    render();
  </script>
</body>
</html>`;
