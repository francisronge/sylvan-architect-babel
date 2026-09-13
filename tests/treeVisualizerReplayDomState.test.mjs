import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  analysisVerdictCompoundOrigin,
  analysisVerdictInitialLocalScale,
  planAnalysisVerdictRows
} from '../replay/relations/overlayGeometry.ts';

const sourceUrl = new URL('../components/TreeVisualizer.tsx', import.meta.url);
const stylesUrl = new URL('../styles.css', import.meta.url);
const atlasUrl = new URL('../docs/design/babel-visual-relations-research.production-only-audit.html', import.meta.url);

test('the Binding outline cannot inherit the opaque SVG default fill over syntax', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const ellipse = source.match(/layer\.append\('ellipse'\)\s*\.attr\('class', 'babel-binding-domain'\)([\s\S]*?);/u);
  assert(ellipse, 'the production Binding ellipse must be present');
  assert.match(ellipse[1], /\.attr\('fill', 'none'\)/u);
});

test('TreeVisualizer exposes the exact Replay relation state used by painting', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.equal(
    source.match(/const playedRelationIndices =/gu)?.length,
    1,
    'played relation state must have one owner'
  );
  assert.match(
    source,
    /currentReplayKind === 'relation'[\s\S]*?replayRelationIdentity/u,
    'the active identity must come from the current relation moment'
  );
  assert.match(
    source,
    /stageIndex === activeDerivationFrameIndex[\s\S]*?played\.add\(relationIndex\)/u,
    'played identities must be collected for the exact active authored stage'
  );
  assert.match(source, /data-babel-replay-kind=\{currentReplayKind \|\| undefined\}/u);
  assert.match(
    source,
    /data-babel-active-relation-stage-index=\{activeRelationMoment\?\.stageIndex\}/u
  );
  assert.match(
    source,
    /data-babel-active-relation-index=\{activeRelationMoment\?\.relationIndex\}/u
  );
  assert.match(
    source,
    /data-babel-played-relation-indices=\{playedRelationIndicesAttribute\}/u
  );
  assert.match(
    source,
    /planItemOwnsRelationMoment\([\s\S]*?planItem,[\s\S]*?focusedRelationMoment\.stageIndex,[\s\S]*?focusedRelationMoment\.relationIndex/u,
    'painting must consume the effective relation focus while preserving the authored Replay identity'
  );
  assert.match(
    source,
    /playedRelationIndices\.has\(ref\.relationIndex\)/u,
    'painting must consume the same played relation set exposed to the Atlas'
  );
});

test('the Orchard keeps Replay controls fixed while compact details scroll', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const atlas = await readFile(atlasUrl, 'utf8');

  assert.match(source, /data-babel-replay-timeline="true"/u);
  assert.match(source, /data-babel-replay-details="true"/u);
  assert.match(
    atlas,
    /\[data-babel-replay-panel="true"\][\s\S]*?display: flex;[\s\S]*?flex-direction: column;[\s\S]*?overflow: hidden;/u
  );
  assert.match(
    atlas,
    /\[data-babel-replay-timeline="true"\]\s*\{\s*display: none;/u,
    'the compact Orchard panel must not reserve a blank row for its hidden slider'
  );
  assert.match(
    atlas,
    /\[data-babel-replay-details="true"\][\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/u,
    'only the Replay detail body should scroll when its authored data exceeds the fixed panel'
  );
});

test('hovering a rendered relation temporarily drives the Replay relation lens', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const styles = await readFile(stylesUrl, 'utf8');
  const atlas = await readFile(atlasUrl, 'utf8');

  assert.match(
    source,
    /const focusedRelationMoment = activeRelationMoment;[\s\S]*?const interactiveRelationMoment = hoveredRelationMoment \?\? activeRelationMoment/u,
    'hover focus must override mounted emphasis without entering the D3 render state'
  );
  const renderEffect = source.match(
    /useEffect\(\(\) => \{\n    if \(!canvasData[\s\S]*?\n  \}, \[([\s\S]*?)\n  \]\);/u
  );
  assert.ok(renderEffect, 'the D3 render effect must remain inspectable');
  assert.doesNotMatch(
    renderEffect[1],
    /hoveredRelationMoment|interactiveRelationMoment/u,
    'hover must never rebuild or refit the tree, preserving the exact zoom and pan transform'
  );
  assert.match(
    source,
    /\.vr-item\[data-vr-stage-index\]\[data-vr-relation-index\][\s\S]*?relationHost\.dataset\.vrStageIndex[\s\S]*?relationHost\.dataset\.vrRelationIndex/u,
    'hover focus must use the exact relation identity already attached to the rendered mark'
  );
  assert.match(
    source,
    /data-vr-owner-refs[\s\S]*?planItemRelationRefs\(item\)[\s\S]*?ownerRefs\.includes\(focusKey\)/u,
    'hover focus must preserve composed and coalesced relation ownership on mounted marks'
  );
  assert.match(
    source,
    /onPointerMove=\{\(event\) => \{[\s\S]*?focusRelationAtPointerTarget\(event\.target, event\.clientX, event\.clientY\)[\s\S]*?className="w-full h-full overflow-hidden/u,
    'the stable canvas container must own hover delegation while D3 replaces relation groups'
  );
  assert.match(
    source,
    /postRedrawTarget[\s\S]*?document\.elementFromPoint\(pointer\.x, pointer\.y\)[\s\S]*?postRedrawRelationHost/u,
    'post-redraw focus must use the last real pointer position instead of stale CSS hover state'
  );
  assert.match(
    source,
    /onMouseMove=\{\(event\) => \{[\s\S]*?focusRelationAtPointerTarget\(event\.target, event\.clientX, event\.clientY\)[\s\S]*?onMouseLeave=\{\(event\) => \{[\s\S]*?focusRelationAtPointerTarget\(null, event\.clientX, event\.clientY\)/u,
    'mouse hover must share the same stable delegated focus path'
  );
  assert.match(styles, /\.vr-item\s*\{\s*cursor: pointer;\s*pointer-events: visiblePainted;/u);
  assert.match(
    styles,
    /:root\s*\{[\s\S]*?--babel-relation-ink: #34d399;[\s\S]*?\.vr-relation-active\s*\{[\s\S]*?--babel-relation-ink: #6ee7b7;[\s\S]*?opacity: 1 !important;[\s\S]*?drop-shadow/u,
    'every relation family receives the same restrained emerald active-state lift'
  );
  assert.doesNotMatch(
    styles,
    /\.vr-relation-active[^\{]*\{[^}]*(?:brightness|saturate)\(/u,
    'active relations must not be pushed toward white by family-wide brightness multipliers'
  );
  const activePaintRules = Array.from(
    styles.matchAll(/^[ \t]*\.vr-relation-active[^\{]*\{([^}]*)\}/gmu),
    (match) => match[1]
  ).join('\n');
  assert.doesNotMatch(
    activePaintRules,
    /stroke-width\s*:/u,
    'hover and relation-introduction emphasis must not resize paths, outlines, or arrowheads'
  );
  const orchardActivePaintRules = Array.from(
    atlas.matchAll(/^[ \t]*\.vr-relation-active[^\{]*\{([^}]*)\}/gmu),
    (match) => match[1]
  ).join('\n');
  assert.doesNotMatch(
    orchardActivePaintRules,
    /stroke-width\s*:/u,
    'the Orchard hover stylesheet must also keep relation geometry fixed'
  );
  assert.match(
    source,
    /babel-split-antecedence-arrow[\s\S]*?markerUnits', 'userSpaceOnUse'/u,
    'Split Antecedence arrowheads must stay independent of path stroke width'
  );
  assert.match(
    styles,
    /\.babel-split-antecedence-path-shadow\s*\{[\s\S]*?stroke: rgba\(2, 12, 8, 0\.85\);[\s\S]*?stroke-width: 5\.4px;[\s\S]*?pointer-events: none;\s*\}/u,
    'neutral Split Antecedence links must use a dark separation underlay instead of a luminous duplicate'
  );
  assert.match(
    styles,
    /\.babel-split-antecedence-path\s*\{\s*stroke: #34d399;[\s\S]*?\.babel-split-antecedence-arrowhead\s*\{\s*fill: #34d399;[\s\S]*?\.babel-split-antecedence-origin\s*\{[\s\S]*?stroke: #34d399;/u,
    'neutral Split Antecedence marks must use the default Babel emerald'
  );
  assert.doesNotMatch(
    styles,
    /\.babel-split-antecedence-path-shadow\s*\{[^}]*?(?:filter|#48f0bd|opacity: 0\.12)/u,
    'neutral Split Antecedence links must not retain the dedicated blurred halo'
  );
  assert.match(
    source,
    /babel-split-antecedence-arrowhead'[\s\S]*?attr\('fill', '#34d399'\)[\s\S]*?babel-split-antecedence-path-shadow'[\s\S]*?attr\('stroke', 'rgba\(2, 12, 8, 0\.85\)'\)[\s\S]*?attr\('stroke-width', 5\.4\)[\s\S]*?babel-split-antecedence-path'[\s\S]*?attr\('stroke', '#34d399'\)/u,
    'the renderer must mount the same neutral Split Antecedence paint declared by the stylesheet'
  );
  assert.match(
    styles,
    /\.vr-relation-active \.babel-split-antecedence-path\s*\{\s*stroke: var\(--babel-relation-ink\);[\s\S]*?\.vr-relation-active \.babel-split-antecedence-origin\s*\{\s*stroke: var\(--babel-relation-ink\);/u,
    'Split Antecedence must keep its shared relation-stage and hover lift'
  );
  assert.match(
    styles,
    /\.vr-relation-quiet\s*\{\s*opacity: 0\.3 !important;/u,
    'every non-hovered relation receives the same quiet treatment'
  );
  assert.match(
    styles,
    /\.vr-relation-hit-target\s*\{[\s\S]*?stroke-width: 16px;[\s\S]*?pointer-events: stroke;/u,
    'thin relation paths receive a forgiving invisible hit stroke'
  );
  assert.match(
    source,
    /const installRelationHitTargets = \(\) => \{[\s\S]*?relationHost\.matches\('path, line, polyline, rect, circle, ellipse'\)[\s\S]*?path, line, polyline, rect, circle, ellipse[\s\S]*?data-vr-hit-target-installed[\s\S]*?cloneNode\(false\)[\s\S]*?installRelationHitTargets\(\);[\s\S]*?requestAnimationFrame\([\s\S]*?installRelationHitTargets\(\);/u,
    'hit geometry is installed for paths and outline shapes both immediately and after deferred relation drawing'
  );
  assert.match(
    source,
    /babel-pf-plate-shell'[\s\S]*?data-vr-hit-area'[\s\S]*?const isAreaTarget[\s\S]*?style\.setProperty\('fill', isAreaTarget \? 'transparent' : 'none', 'important'\)[\s\S]*?style\.setProperty\('pointer-events', isAreaTarget \? 'all' : 'stroke', 'important'\)/u,
    'the complete PF realization plate surface must resolve to its relation'
  );
  assert.match(
    source,
    /const isFallbackSegment = geometry\.classList\.contains\('vr-fallback-segment'\)[\s\S]*?style\.setProperty\('stroke-width', isFallbackSegment \? '30px' : '16px', 'important'\)/u,
    'fallback connectors must have a wider invisible hit lane without changing their painted stroke'
  );
  assert.match(
    source,
    /hitTarget\.style\.setProperty\('fill'[\s\S]*?hitTarget\.style\.setProperty\('stroke', 'transparent', 'important'\)/u,
    'hit clones must remain non-painting even under relation-family descendant styles'
  );
  assert.match(
    source,
    /const queueAcceptedRelationDraw[\s\S]*?draw\(\);[\s\S]*?decorateRelationElement\(element, item, emphasis\)/u,
    'deferred accepted drawings must receive the identity of the relation that produced them'
  );
  assert.match(
    source,
    /const queueAcceptedRelationDraw[\s\S]*?element\.hasAttribute\('data-vr-stage-index'\)[\s\S]*?decorateRelationElement\(element, item, emphasis\)/u,
    'a composite deferred drawing must preserve relation ownership assigned by its individual paths'
  );
  assert.match(
    source,
    /item\.familyId !== 'pf\.phrasal-spellout'[\s\S]*?item\.familyId !== 'pf\.correspondence'[\s\S]*?queueAcceptedRelationDraw\(item, emphasis/u,
    'Many-to-Many PF Correspondence must expose its deferred plaque as a hoverable relation'
  );
  assert.match(
    source,
    /babel-ellipsis-ghost-label[\s\S]*?\.style\('opacity', '0\.52'\)[\s\S]*?blur\(0\.25px\) drop-shadow/u,
    'ellipsis ghosting must remain authored without blocking the mounted hover glow'
  );
  assert.match(
    styles,
    /\.vr-relation-active\.babel-ellipsis-ghost-label\s*\{[\s\S]*?opacity: 0\.82 !important;[\s\S]*?drop-shadow\(0 0 6px rgba\(52, 211, 153, 0\.5\)\)/u,
    'ellipsis must receive the shared restrained relation hover while remaining ghosted'
  );
  assert.match(
    styles,
    /\.vr-relation-quiet\.babel-partial-copy-deletion-mark\s*\{\s*opacity: 0\.58 !important;/u,
    'focusing the copy enclosure must not erase the distinct deletion strike'
  );
  assert.doesNotMatch(
    source,
    /babel-improper-source-trajectory-hidden/u,
    'Improper Movement must preserve the previously drawn A-bar trajectory'
  );
  assert.match(
    atlas,
    /\.babel-render-card\[data-lens-active="true"\] svg g:has\(> \.vr-item\)[\s\S]*?pointer-events: auto;/u,
    'the Orchard lens must make relation-hosting parent groups genuinely hoverable'
  );
  assert.match(
    atlas,
    /\.babel-render-card\[data-lens-active="true"\] svg \.vr-item[\s\S]*?pointer-events: visiblePainted;[\s\S]*?\.babel-render-card\[data-lens-active="true"\] svg \.vr-relation-hit-target[\s\S]*?pointer-events: stroke;/u,
    'the Orchard lens must override relation-layer pointer suppression for plaques and thin paths alike'
  );
});

test('neutral geometric relation paint is shared while semantic marks retain their notation', async () => {
  const styles = await readFile(stylesUrl, 'utf8');
  const atlas = await readFile(atlasUrl, 'utf8');
  const policyFrom = (source, endPattern) => {
    const policy = source.match(new RegExp(
      `Neutral geometric relations share one ink([\\s\\S]*?)${endPattern}`,
      'u'
    ));
    assert.ok(policy, 'the shared neutral relation-paint policy must remain inspectable');
    return policy[1];
  };
  const stylesPolicy = policyFrom(styles, '\\.loading-overlay');
  const atlasPolicy = policyFrom(
    atlas,
    '\\.babel-render-card\\[data-lens-active="true"\\] \\.terminal-label'
  );
  const normalizedGeometry = [
    'babel-control-dependency',
    'babel-binding-domain',
    'babel-trajectory-path:not(.babel-trajectory-path-shadow)',
    'babel-pg-copy-branch',
    'babel-native-branch-overlay',
    'babel-lf-path',
    'babel-phase-arc',
    'babel-improper-candidate-path',
    'babel-intervention-search-path',
    'babel-multidominance-branch',
    'babel-argument-sharing-domain',
    'babel-strong-npi-path'
  ];
  normalizedGeometry.forEach((className) => {
    assert.ok(stylesPolicy.includes(`.${className}`), `${className} must use shared neutral paint`);
    assert.ok(atlasPolicy.includes(`.${className}`), `${className} must use shared Orchard paint`);
  });
  [stylesPolicy, atlasPolicy].forEach((policy) => {
    assert.match(
      policy,
      /stroke: var\(--babel-relation-ink, #34d399\) !important;[\s\S]*?filter: none;/u,
      'neutral relation geometry must use default emerald without a dedicated glow'
    );
    assert.match(
      policy,
      /\.babel-trajectory-path-shadow[\s\S]*?stroke: rgba\(2, 12, 8, 0\.85\) !important;[\s\S]*?filter: none;/u,
      'movement underlays must remain dark and non-glowing'
    );
    assert.doesNotMatch(
      policy,
      /babel-ellipsis-ghost-label|babel-focus-branch-strong|babel-partial-copy-deletion-strike|babel-impoverishment-cross|babel-feature-plaque-shell|babel-pf-plate-shell|babel-theta-grid-shell/u,
      'semantic state marks and plaque depth must stay outside neutral paint normalization'
    );
  });
  [stylesPolicy, atlasPolicy].forEach((policy) => {
    assert.match(
      policy,
      /\.babel-improper-forbidden-region\s*\{\s*fill: rgba\(52, 211, 153, 0\.075\) !important;/u,
      'the improper-movement diagnostic region must remain a quiet neutral wash'
    );
    assert.match(
      policy,
      /\.babel-argument-sharing-domain\s*\{\s*opacity: 0\.72;[\s\S]*?\.vr-relation-active \.babel-argument-sharing-domain\s*\{\s*opacity: 1;/u,
      'large argument-sharing domains must stay quiet until their relation is active'
    );
    assert.match(
      policy,
      /\.babel-strong-npi-path\s*\{\s*stroke-width: 1\.55px;/u,
      'both Strong-NPI dependencies must carry equal neutral visual weight'
    );
  });
  [styles, atlas].forEach((source) => {
    assert.match(
      source,
      /\.vr-relation-active\s*\{[\s\S]*?--babel-relation-ink: #6ee7b7;[\s\S]*?drop-shadow\(0 0 6px rgba\(52, 211, 153, 0\.5\)\)/u,
      'relation moments and hover must provide the one shared active lift'
    );
    assert.doesNotMatch(
      source,
      /\.vr-relation-active[^\{]*\{[^}]*(?:brightness|saturate)\(/u,
      'relation moments must preserve emerald hue instead of whitening it'
    );
    assert.match(
      source,
      /\.vr-relation-active \.babel-trajectory-path\s*\{\s*filter: none;/u,
      'movement must not stack a family-specific halo on the shared active lift'
    );
  });
});

test('Replay controls keep card-local keyboard stepping', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(source, /tabIndex=\{animated \? 0 : undefined\}/u);
  assert.match(source, /event\.key === 'ArrowLeft'[\s\S]*?handlePrevStep\(\)/u);
  assert.match(source, /event\.key === 'ArrowRight'[\s\S]*?handleNextStep\(\)/u);
});

test('silent indexed witnesses stay sage and dev replay getters track same-length updates', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /!isRenderedReplaySilentTerminalLeaf\(candidate\)[\s\S]*?derivationOperatorVariableIndexByNodeId/u,
    'operator-variable indexing must not recolor a silent witness as pronounced emerald material'
  );
  assert.match(
    source,
    /__BABEL_DEV_GET_REPLAY_STEP_PAYLOAD__[\s\S]*?\}, \[playbackSteps\]\);/u,
    'the dev getter must refresh when Replay content changes without changing step count'
  );
});

test('Replay centres terminal unary children without repositioning structural subtrees', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /const alignReplayUnaryTerminalLeaves =[\s\S]*?const layoutChildren = children\.filter\(\(child\) =>[\s\S]*?!isSyntheticWorkspaceRootNode\(child\)[\s\S]*?if \(layoutChildren\.length !== 1\) return;[\s\S]*?const child = layoutChildren\[0\];/u,
    'unary alignment must inspect the reserved layout topology, including hidden future sisters'
  );
  assert.match(
    source,
    /const child = layoutChildren\[0\];[\s\S]*?replayVisibleNodeIdSet[\s\S]*?!replayVisibleNodeIdSet\.has\(getNodeId\(node\)\)[\s\S]*?!replayVisibleNodeIdSet\.has\(getNodeId\(child\)\)/u,
    'an authored unary child is aligned only after it becomes visible'
  );
  assert.match(
    source,
    /if \(isTerminalLeaf\) \{[\s\S]*?child\.x = node\.x;[\s\S]*?\}/u,
    'terminal leaves stay centred under their preterminals'
  );
  assert.doesNotMatch(
    source,
    /const alignReplayUnaryTerminalLeaves =[\s\S]*?const visibleChildren = children\.filter/u,
    'a temporarily lone visible child must not be mistaken for a genuinely unary child'
  );
  assert.doesNotMatch(
    source,
    /structuralUnaryOffset|unaryDirection|descendant\.x [+-]=/u,
    'Replay must not rewrite structural node coordinates after D3 lays out the tree'
  );
});

test('Replay applies its stage fit without freezing or rewriting tree coordinates', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.doesNotMatch(
    source,
    /ReplayCameraState|replayCameraStateRef|replaySequenceFitNodes|preservedReplayCamera/u,
    'Replay must not preserve a stale sequence camera across frame navigation'
  );
  assert.match(
    source,
    /const fitToRenderedBounds = \(\) => \{[\s\S]*?if \(derivationFrameFitNodes && derivationFrameFitNodes\.length > 0\)[\s\S]*?d3\.min\(derivationFrameFitNodes[\s\S]*?d3\.max\(derivationFrameFitNodes/u,
    'non-Replay rendering retains its complete derivation-frame fit'
  );
  assert.match(
    source,
    /if \(!fitToRenderedBounds\(\) && visibleNodes\.length > 0\)/u,
    'every rendered frame must run the centered fit before falling back'
  );
  assert.doesNotMatch(
    source,
    /ReplayLayoutState|positionsByStep|cachedPositions|releasedNodeIds|node\.x = cached\.x|node\.y = cached\.y/u,
    'frame refitting must never cache, freeze, or rewrite node positions'
  );
  assert.match(
    source,
    /const \[innerWidth, innerHeight\] = stageLayoutSize\s*\?\? treeLayoutSize\(nodeCount, maxDepth, containerWidth, containerHeight\)/u,
    'Replay reserves stage dimensions while Canopy retains its native layout dimensions'
  );
  assert.match(source, /const minNodeX = stageCameraBounds\?\.minX/);
  assert.match(source, /const maxNodeY = stageCameraBounds\?\.maxY/);
});

test('Replay paints only direct visible dominance links', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /const visibleLinks = treeData\.links\(\)\.filter[\s\S]*?replayVisibleNodeIdSet\.has\(getNodeId\(link\.source\)\)[\s\S]*?replayVisibleNodeIdSet\.has\(getNodeId\(link\.target\)\)/u,
    'a branch must always be an actual parent-child edge in the visible tree'
  );
  assert.doesNotMatch(
    source,
    /const visibleLinks = visibleNodes\.flatMap/u,
    'the renderer must never bypass a hidden projection with a fabricated long branch'
  );
});

test('analysis verdicts keep each glyph and label attached to their authored analysis anchor', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const styles = await readFile(stylesUrl, 'utf8');
  const atlas = await readFile(atlasUrl, 'utf8');

  assert.match(
    source,
    /primitive\.type === 'analysis-verdict'[\s\S]*?babel-analysis-verdict[\s\S]*?data-analysis-verdict-anchor', primitive\.analysisNodeId[\s\S]*?\.text\(primitive\.judgment\)[\s\S]*?primitive\.label[\s\S]*?babel-analysis-verdict-label[\s\S]*?\.text\(primitive\.label\)/u,
    'one renderer object must own the authored anchor, judgment, and optional label'
  );
  assert.match(
    source,
    /primitive\.type === 'analysis-verdict'[\s\S]*?babel-analysis-verdict-text[\s\S]*?append\('tspan'\)[\s\S]*?babel-analysis-judgment'[\s\S]*?primitive\.label[\s\S]*?append\('tspan'\)[\s\S]*?babel-analysis-verdict-label'/u,
    'the judgment and label must be inseparable spans in one text compound'
  );
  assert.doesNotMatch(
    source,
    /updateAnalysisVerdictLayout|analysisVerdictCompoundTransform|analysisVerdictLabelOrigin/u,
    'zoom must transform the verdict with the tree instead of re-laying it out in screen space'
  );
  assert.match(
    source,
    /primitive\.type === 'analysis-verdict'[\s\S]*?text-anchor', 'start'/u,
    'the judgment must read as a peripheral label rather than a suffix on the root category'
  );
  assert.match(
    source,
    /const layoutAnalysisVerdicts = \(initialCameraScale: number\) =>[\s\S]*?selectAll<SVGGElement, unknown>\('\.babel-analysis-verdict'\)[\s\S]*?analysisVerdictInitialLocalScale\(initialCameraScale\)[\s\S]*?planAnalysisVerdictRows[\s\S]*?data-analysis-verdict-anchor[\s\S]*?measuredSubtreeRect\(analysisNodeId\)[\s\S]*?desiredY: anchorRect\.y \+ anchorRect\.height \/ 2[\s\S]*?scaledCompoundRect[\s\S]*?analysisVerdictCompoundOrigin\([\s\S]*?treeRect[\s\S]*?scaledCompoundRect[\s\S]*?verdict\.attr\([\s\S]*?'transform'/u,
    'each verdict must use its own subtree anchor and place its complete measured compound outside the tree'
  );
  assert.doesNotMatch(
    source,
    /g\.select<SVGTextElement>\('\.babel-analysis-judgment'\)/u,
    'the renderer must never attach a label to the first global star'
  );
  assert.doesNotMatch(
    source,
    /data-blocked-extraction-verdict-companion|blocked-extraction-label/u,
    'blocked extraction must not own a disconnected verdict companion'
  );
  assert.match(
    styles,
    /\.babel-analysis-verdict-label,\s*\.babel-analysis-judgment\s*\{[\s\S]*?fill: var\(--babel-relation-ink\);[\s\S]*?font-family: "Crimson Pro"[\s\S]*?font-style: italic;[\s\S]*?\.babel-analysis-verdict-label\s*\{[\s\S]*?text-decoration: underline;[\s\S]*?\.babel-analysis-judgment\s*\{[\s\S]*?text-decoration: none;/u,
    'both parts of the analysis verdict must share the accepted typography'
  );
  assert.match(
    styles,
    /\.babel-analysis-judgment\s*\{\s*font-size: 160px;/u,
    'the vocabulary star must retain its authored large-coordinate size'
  );
  assert.match(
    styles,
    /\.babel-analysis-verdict-label\s*\{\s*font-size: 80px;/u,
    'the vocabulary verdict label must retain its authored large-coordinate size'
  );
  assert.match(
    atlas,
    /\.babel-analysis-verdict-label,\s*\.babel-analysis-judgment\s*\{[\s\S]*?fill: var\(--babel-relation-ink\);[\s\S]*?font-family: "Crimson Pro"[\s\S]*?\.babel-analysis-verdict-label\s*\{[\s\S]*?font-size: 80px;[\s\S]*?\.babel-analysis-judgment\s*\{\s*font-size: 160px;\s*text-decoration: none;/u,
    'the standalone production Orchard must carry the same accepted verdict-label treatment'
  );
});

test('analysis verdict geometry keeps the complete compound outside its tree', () => {
  const treeRect = { x: 100, y: 40, width: 240, height: 180 };
  const compoundRect = { x: -2, y: -18, width: 84, height: 36 };
  const origin = analysisVerdictCompoundOrigin(treeRect, compoundRect, 130);
  assert.equal(origin.x + compoundRect.x + compoundRect.width, treeRect.x - 24);
  assert.equal(origin.y + compoundRect.y + compoundRect.height / 2, 130);
  for (const initialCameraScale of [0.05, 0.1, 0.25, 1, 4]) {
    const localScale = analysisVerdictInitialLocalScale(initialCameraScale);
    assert.ok(Math.abs(localScale * initialCameraScale * 160 - 28) < 1e-9);
  }

  const anchors = [
    { analysisNodeId: 'later', desiredY: 110, order: 1 },
    { analysisNodeId: 'earlier', desiredY: 100, order: 0 }
  ];
  const rows = planAnalysisVerdictRows(anchors);
  assert.deepEqual(
    rows.map(({ analysisNodeId, y }) => ({ analysisNodeId, y })),
    [
      { analysisNodeId: 'earlier', y: 100 },
      { analysisNodeId: 'later', y: 290 }
    ],
    'each row keeps its authored anchor identity while close verdicts de-collide'
  );
  assert.deepEqual(
    anchors.map(({ analysisNodeId }) => analysisNodeId),
    ['later', 'earlier'],
    'planning must not mutate authored verdict order'
  );
});

test('structured Replay relation fields suppress only the redundant raw Relations block', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /activeDisplayDetailBlocks = \([\s\S]*?replayDisplayDetailBlocksByStepIndex\.get\(activeStepIndex\)[\s\S]*?\.filter\(\(block\) => !\([\s\S]*?activeReplaySupportLines\.length > 0[\s\S]*?block\.title[\s\S]*?=== 'relations'/u,
    'structured anchor and value fields must replace the duplicate raw Relations summary'
  );
  assert.match(
    source,
    /activeReplaySupportLines\.map\(\(line\)/u,
    'authored values such as the illicit-analysis reason must remain visible'
  );
});

test('deferred PF plates reserve distinct tree and replay-panel regions', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /item\.familyId === 'pf\.fission'[\s\S]*?querySelector<HTMLElement>\('\[data-babel-replay-panel="true"\]'\)[\s\S]*?replayPanelRect\.top - heightPx - 12/u,
    'Fission must avoid the measured replay panel at every viewport width'
  );
  assert.doesNotMatch(
    source,
    /item\.familyId === 'pf\.fission'[\s\S]*?const replayPanelRect = containerWidth < 500/u,
    'Fission panel avoidance must not be limited to compact cards'
  );
  assert.match(
    source,
    /const minimumInitialScale = compactViewport \|\| hasCyclicLinearizationPlate \? 0\.02 : 0\.06/u,
    'the Cyclic Linearization fit must be allowed to honor its reserved plate region'
  );
});

test('Theta assignment uses indices without generic terminal highlighting', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const thetaRenderer = source.match(
    /const scheduleAcceptedThetaGrid =([\s\S]*?)const scheduleAcceptedIntervention =/u
  )?.[1] || '';

  assert.match(thetaRenderer, /babel-theta-terminal-index/u);
  assert.doesNotMatch(thetaRenderer, /markSubtreeLensNodes\(/u);
  assert.doesNotMatch(thetaRenderer, /markPreterminalLensNode\(/u);
});

test('production relation lenses mark only exact preterminal anchors', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /const markPreterminalLensNode = \(nodeId: string, role: string\)[\s\S]*?children\.length !== 1 \|\| !isDisplayTerminalNode\(children\[0\]\)[\s\S]*?\.classed\('babel-lens-node', true\)[\s\S]*?\.attr\('data-lens-role', role\)/u,
    'phrase anchors must not be expanded into invented terminal highlights'
  );
  assert.match(source, /markPreterminalLensNode\(pair\.fromNodeId, 'pair-member'\)/u);
  assert.match(source, /markPreterminalLensNode\(pair\.toNodeId, 'pair-host'\)/u);
  assert.match(source, /markPreterminalLensNode\(primitive\.nodeId, 'idiom-chunk'\)/u);
});

test('production PF realization omits source lenses only for zero realization', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /scheduleAcceptedPfRelation[\s\S]*?finalOutput[\s\S]*?!isNullLike\(finalOutput\)[\s\S]*?markPreterminalLensNode\(nodeId, 'pf-source'\)/u,
    'pronounced PF outputs retain their accepted witness emphasis while an output of zero receives only the plate'
  );
});

test('production movement uses accepted copy labels and rendered terminal endpoints', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /buildMovementCopyTraceIndexByTerminalId\(movementArrows\)[\s\S]*?formatIndexedSurfaceForDisplayValue\(\s*getReplayTerminalSurface\(d\),\s*movedFromCopyTraceIndex\s*\)/u,
    'a wholly silent phrasal source keeps its authored words and gains only its movement-chain index subscript'
  );
  assert.match(
    source,
    /const carriedMovementTraceIndex = resolveTraceIndexFromNodeContext\([\s\S]*?resolveLexicalMovementTraceDisplayIndex\([\s\S]*?return formatIndexedSurfaceForDisplayValue\(fallback, lexicalMovementTraceIndex\)/u,
    'layout synchronization keeps the authored copy words and adds only the chain-index subscript'
  );
  assert.doesNotMatch(
    source,
    /return buildTraceDisplayLabel\(lexicalMovementTraceIndex\)|buildTraceLabel\(movedFromCopyTraceIndex\)/u,
    'occupant-as-authored: Babel never converts a silent lexical copy into a trace glyph'
  );
  assert.match(
    source,
    /\.classed\('babel-moved-from-copy', true\)/u,
    'accepted moved-copy styling must be owned by production'
  );
  assert.match(
    source,
    /if \(trace\) label\.classed\('babel-moved-from-copy', false\)/u,
    'the identity lens must own its trace styling without retaining a second movement class'
  );
  assert.doesNotMatch(
    source,
    /scheduleAcceptedCyclicLinearization[\s\S]*?exactCyclicEdgeWitness[\s\S]*?data-trace-index/u,
    'the ordering overlay must not turn an intermediate movement trace back into authored words'
  );
  assert.match(
    source,
    /primitive\.trajectoryKind === 'head'[\s\S]*?clearMovedCopyClassForAnchors/u,
    'head movement must not apply the phrasal moved-copy treatment to its lower head trace'
  );
  assert.match(
    source,
    /relation === 'FeatureBundle'[\s\S]*?'CASE 1'[\s\S]*?'CASE 2'[\s\S]*?babel-moved-from-copy', false/u,
    'the ordered Case stack must preserve its authored trace presentation rather than add a generic copy mark'
  );
  assert.match(
    source,
    /const measuredTerminalBottom =[\s\S]*?getBoundingClientRect\(\)[\s\S]*?rect\.bottom[\s\S]*?point\.y \+ 6/u,
    'head-sized trajectories must meet the rendered terminal glyph, not a hierarchy offset'
  );
  assert.doesNotMatch(
    source,
    /terminal \? \{ x: terminal\.x, y: terminal\.y \+ 24 \} : null/u
  );
  assert.match(
    source,
    /\.vr-trajectory-head, \.vr-trajectory-lowering[\s\S]*?refineTerminalTrajectory[\s\S]*?measuredTrajectoryTerminalRect[\s\S]*?sourceRect\.y \+ sourceRect\.height \+ 6[\s\S]*?targetRect\.y \+ targetRect\.height \+ 6/u,
    'glyph-sensitive head-sized paths must be rebound after the accepted tree fit'
  );
  assert.match(
    source,
    /babel-operator-variable-domain[\s\S]*?babel-operator-variable-path[\s\S]*?babel-operator-variable-index/u,
    'operator-variable binding must render its semantic domain, path, and shared indices outside movement'
  );
  assert.match(
    source,
    /babel-operator-variable-arrowhead[\s\S]*?M 1 -4 L 8\.5 0 L 1 4[\s\S]*?\.attr\('fill', 'none'\)[\s\S]*?\.attr\('stroke-width', 1\.15\)/u,
    'operator-variable binding must keep its source-like open hairline arrowhead'
  );
  assert.match(
    source,
    /babel-operator-variable-path[\s\S]*?\.attr\('stroke-width', 1\.2\)/u,
    'operator-variable binding must remain visibly thinner than movement'
  );
  assert.match(
    source,
    /measuredSubtreeLabelRects[\s\S]*?labelBelongsToNode\(this, String\(subtreeId\)\)[\s\S]*?polygonHull/u,
    'semantic scope hulls must use exact display ownership for rendered terminals'
  );
  assert.match(source, /\['#10b981', '#c98a3d', '#e6efeb'\]/u);
});

test('production intervention uses the accepted blocked-path diagnostic', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /scheduleAcceptedIntervention[\s\S]*?familyId !== 'intervention\.blocked-path'[\s\S]*?babel-intervention-search-path[\s\S]*?babel-intervention-x-mark[\s\S]*?babel-intervention-arrowhead/u
  );
  assert.match(
    source,
    /scheduleAcceptedIntervention[\s\S]*?root\.insertBefore\(layerNode, root\.firstChild\)/u,
    'the failed diagnostic must remain behind the visible tree occurrences'
  );
});

test('production movement auxiliaries use accepted enclosures and exclusive gap notation', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /acceptedEnclosureRequests[\s\S]*?babel-carrier-gradient[\s\S]*?babel-constituent-enclosure babel-enclosure-\$\{licence\}/u,
    'remnant, carrier, and copy enclosures must share the exact source-backed painter'
  );
  assert.match(source, /babel-pg-gap-label[\s\S]*?data-gap-label-anchor/u,
    'parasitic-gap notation must be a separate relation-owned side label');
  assert.match(
    source,
    /babel-pg-gap-label\[data-gap-label-anchor\][\s\S]*?measuredTerminalSubtreesRect\(\[badge\.attr\('data-gap-label-anchor'\)\]\)/u,
    'the parasitic-gap side label must use the post-fit subtree measurement helper in its own scope'
  );
  assert.doesNotMatch(
    source,
    /babel-pg-gap-label\[data-gap-label-anchor\][\s\S]*?measuredTerminalSubtreeRectNow\(/u,
    'the post-fit parasitic-gap refinement must not call the earlier overlay-local helper'
  );
  assert.match(
    source,
    /trajectory\.across-the-board[\s\S]*?trajectory\.sideward[\s\S]*?\.text\(primitive\.text\)/u,
    'ATB and sideward copy notation retain their accepted authored movement treatment'
  );
});

test('production parasitic gap keeps its semantic copy fork separate from movement', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /babel-pg-copy-fork-layer[\s\S]*?data-copy-fork-role[\s\S]*?'content-input'[\s\S]*?'ordinary-gap-output'[\s\S]*?'parasitic-gap-output'/u,
    'the fork must expose one input and both distinct gap outputs'
  );
  assert.match(
    source,
    /measuredShellBottom\(request\.contentNodeId[\s\S]*?measuredShellTop\(nodeId/u,
    'the fork must run from the filler shell to complete gap shells'
  );
  assert.doesNotMatch(
    source,
    /babel-pg-copy-gate-layer/u,
    'the semantic fork must not be attached to the ordinary movement trajectory'
  );
});

test('production ellipsis content uses the ordinary feature painter', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /primitive\.type === 'plaque'[\s\S]*?primitive\.plaqueStyle === 'feature'/u,
    'ordinary feature plaques remain available for an authored E feature'
  );
});

test('prototype feature plaques use the complete stage placement instead of reallocating on reveal', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /primitive\.plaqueStyle === 'feature'[\s\S]*?replayPlaqueLayout\.get\(primitive\.itemIndex\)/u,
    'feature plaques must use the same stage allocation as the camera'
  );
  assert.doesNotMatch(source, /gutterAllocatorRef|drawGutterLeader|placedFeaturePlaqueRects/u);
});

test('production partial-copy deletion preserves the accepted tree-first composition', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /primitive\.type === 'enclosure'[\s\S]*?planItem\.kind === 'enclosure'[\s\S]*?acceptedEnclosureRequests\.push/u,
    'registered copy relations must own the accepted occurrence enclosures'
  );
  assert.match(
    source,
    /planItem\.familyId === 'copy\.partial-deletion'[\s\S]*?acceptedPartialCopyStrikeRequests\.push/u,
    'partial deletion must strike only the authored deleted subconstituent'
  );
  assert.match(
    source,
    /acceptedCompositionIsTreeFirst[\s\S]*?copy\.multiple-pronunciation[\s\S]*?copy\.partial-deletion[\s\S]*?overlayFitBounds = acceptedCompositionIsTreeFirst[\s\S]*?\? null/u,
    'copy-deletion marks must annotate the accepted tree without resizing it'
  );
  assert.match(
    source,
    /acceptedEnclosureRequests\.length > 0[\s\S]*?deferredAcceptedRelationDraws\.push[\s\S]*?exactScreenTreeLabelRectNow\(nodeId, true\)[\s\S]*?babel-enclosure-\$\{licence\}/u,
    'copy enclosures must bind to the painted subtree in the deferred accepted-mark phase'
  );
  assert.match(
    source,
    /acceptedPartialCopyStrikeRequests\.length > 0[\s\S]*?deferredAcceptedRelationDraws\.push[\s\S]*?measuredTreeLabelRectNow\(nodeId, false\)[\s\S]*?babel-partial-copy-deletion-strike/u,
    'the selective strike must bind to the painted category label'
  );
  assert.match(
    source,
    /planItem\.familyId === 'pf\.vocabulary-insertion'[\s\S]*?targetBelongsToPartialCopy[\s\S]*?markPreterminalLensNode\(vocabularyTarget, 'pf-output'\)[\s\S]*?return/u,
    'Vocabulary Insertion inside the retained lower copy must mark its terminal instead of inventing a plate'
  );
});

test('production sharing relations preserve the accepted source-backed compositions', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /scheduleAcceptedSharingRelation[\s\S]*?multidominance\.shared-node[\s\S]*?babel-multidominance-shared-label[\s\S]*?parentNodeIds\.slice\(0, -1\)[\s\S]*?babel-multidominance-branch/u,
    'multidominance must mark the shared subtree and add only the extra authored mother branches'
  );
  assert.match(
    source,
    /argument-sharing\.domains[\s\S]*?roleLabel[\s\S]*?exactScreenTreeLabelRectForNodeIdsNow[\s\S]*?Math\.SQRT2[\s\S]*?babel-argument-sharing-domain[\s\S]*?babel-argument-sharing-object-box[\s\S]*?\.text\(roleLabel\)/u,
    'argument sharing must use the accepted two containing ovals and authored role token'
  );
  assert.match(
    source,
    /acceptedCompositionIsTreeFirst[\s\S]*?multidominance\.shared-node[\s\S]*?argument-sharing\.domains/u,
    'sharing marks must annotate the accepted tree without changing its fit'
  );
});

test('production phase arcs emphasize only pronounced preterminal edges', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /phaseItem\.phaseEdgeNodeId[\s\S]*?edgeSurface[\s\S]*?!isNullLike\(edgeSurface\)[\s\S]*?isOvertLeafNode\(edgeTerminal[\s\S]*?markPreterminalLensNode\(phaseItem\.phaseEdgeNodeId, 'edge'\)/u,
    'an authored silent phase edge positions the arc but does not receive an invented visible lens mark'
  );
});

test('production Identity uses the accepted occurrence lighting instead of numeric badges', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /markIdentityLensOccurrences[\s\S]*?\.classed\('babel-lens-node', true\)[\s\S]*?trace \? 'trace' : 'pronounced'/u
  );
  assert.match(
    source,
    /candidate\.data as SyntaxNode\)\.silent === true && !trace\) return/u,
    'silent lexical copies stay ghosted without becoming false trace highlights'
  );
  assert.match(
    source,
    /primitive\.type === 'identity-lens'[\s\S]*?markIdentityLensOccurrences\(primitive\.nodeIds\)/u
  );
  assert.match(
    source,
    /identityForestLightFamilies\.push\(\{ occurrencePools, emphasis, item: planItem \}\)/u,
    'forest light must inherit the identity relation moment emphasis'
  );
  assert.match(
    source,
    /const intensity = emphasis === 'quiet' \? 0\.3 : 1/u,
    'persisted forest light must remain visible but quiet during another relation moment'
  );
  const forestLightBlock = source.match(
    /const startIdentityForestLight = \(\) => \{([\s\S]*?)\n    \};\n\n    const installRelationHitTargets/u
  );
  assert.ok(forestLightBlock, 'Forest light implementation block must remain inspectable');
  assert.doesNotMatch(
    forestLightBlock[1],
    /dataset\.lensActive/u,
    'forest light must not disappear merely because the card lens is inactive'
  );
});

test('production accumulated trajectories share one accepted layer and draw head paths first', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /ensureTrajectoryRelationLayer[\s\S]*?babel-trajectory-relation-layer[\s\S]*?trajectoryRelationLayer = layer/u
  );
  assert.match(
    source,
    /sortedTrajectories[\s\S]*?kind === 'head' \? 0 : 1[\s\S]*?orderedPrimitives/u
  );
  assert.match(
    source,
    /relationLayer\.node\(\)\?\.appendChild\(hostNode\)[\s\S]*?canonicalAttributes\(host\.append\('path'\)/u
  );
});

test('production paints the accepted control, binding, coreference, and predication layers', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(source, /ensureControlRelationLayer[\s\S]*?babel-control-relation-layer[\s\S]*?babel-control-dependency-marker/u);
  assert.match(source, /babel-control-domain[\s\S]*?data-control-domain/u);
  assert.match(source, /refineControlRelation[\s\S]*?controllerApproach[\s\S]*?babel-control-index/u);
  assert.match(source, /babel-binding-relation-layer[\s\S]*?babel-binding-domain[\s\S]*?data-binding-anchor/u);
  assert.match(source, /refineBindingRelation[\s\S]*?Math\.SQRT2[\s\S]*?refineBindingIndex/u);
  assert.match(source, /babel-coindex-relation-layer[\s\S]*?data-coreference-anchor/u);
  assert.match(source, /babel-predication-relation-layer[\s\S]*?babel-predication-path/u);
  assert.match(source, /refinePredicationRelation[\s\S]*?lowestAnchor[\s\S]*?laneY/u);
});

test('renderer-owned indices share one emerald annotation class', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const atlas = await readFile(
    new URL('../docs/design/babel-visual-relations-research.production-only-audit.html', import.meta.url),
    'utf8'
  );
  const indexEmitters = [
    'babel-accord-index babel-relation-index',
    'babel-theta-grid-index babel-relation-index',
    'babel-theta-terminal-index babel-relation-index',
    'babel-binding-index babel-relation-index',
    'babel-gapping-index babel-relation-index',
    'babel-control-index babel-relation-index',
    'vr-index-badge babel-relation-index'
  ];

  indexEmitters.forEach((classNames) => {
    assert.ok(source.includes(classNames), `${classNames} must carry relation-owned color`);
  });
  assert.match(
    source,
    /babel-agree-cycle-badge[\s\S]*?append\('text'\)[\s\S]*?babel-relation-index/u,
    'cyclic Agree numerals must carry relation-owned color'
  );
  assert.match(
    styles,
    /\.babel-relation-index\s*\{\s*fill:\s*var\(--emerald-terminal, #10b981\) !important;/u
  );
  assert.match(
    styles,
    /\.babel-agree-cycle-badge circle\s*\{\s*fill: rgba\(6, 78, 55, 0\.86\);[\s\S]*?\.babel-agree-cycle-badge text\.babel-relation-index\s*\{\s*fill: #ecfdf5 !important;/u,
    'cyclic Agree badges must keep a visible emerald interior and light numeral'
  );
  assert.match(
    atlas,
    /\.babel-relation-index\s*\{\s*fill:\s*var\(--emerald\) !important;/u,
    'the standalone Orchard must preserve the renderer-owned index color'
  );
});

test('measurement-dependent accepted relations bind after the painted tree', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /const measureGraphicsElementsInTreeSpace = \([\s\S]*?elements: SVGGraphicsElement\[\][\s\S]*?g\.node\(\)\?\.getCTM\(\)[\s\S]*?element\.getCTM\(\)[\s\S]*?element\.getBBox\(\)/u,
    'label geometry must be measured in tree space from the painted SVG elements'
  );
  assert.match(
    source,
    /const deferredAcceptedRelationDraws: Array<\(\) => void> = \[\][\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?deferredAcceptedRelationDraws\.forEach/u,
    'measurement-dependent accepted marks must wait until the tree has painted'
  );
  assert.match(
    source,
    /const deferredRelationFrame = window\.requestAnimationFrame[\s\S]*?return \(\) => \{[\s\S]*?cancelAnimationFrame\(deferredRelationFrame\)/u,
    'a superseded Replay frame must cancel deferred accepted drawing work'
  );
});
