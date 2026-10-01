import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const sourceFile = fileURLToPath(new URL('../../components/TreeVisualizer.tsx', import.meta.url));
const source = fs.readFileSync(sourceFile, 'utf8');
const check = (piece, selector, sourceToken = selector.replace(/^\./, ''), extras = {}) => {
  const position = source.indexOf(sourceToken);
  assert.ok(position >= 0, `Missing painter evidence for ${selector}: ${sourceToken}`);
  return { piece, selector, minCount: 1, evidence: { file: sourceFile, line: source.slice(0, position).split('\n').length, sourceToken }, ...extras };
};
const genericPath = (piece, style, extras = {}) => check(piece, `.vr-shape-${style}`, 'vr-shape-${primitive.shapeStyle}', extras);
const badge = (piece, style, extras = {}) => check(piece, `.vr-badge-${style}`, 'vr-badge-${primitive.badgeStyle}', extras);
const manual = (piece, reason) => ({ piece, selector: null, manual: reason });
const maps = {
  'movement.carrier': [check('Carrier arrow', '.babel-trajectory-path-smuggling', 'babel-trajectory-path-${primitive.trajectoryKind}', { attribute: { name: 'marker-end', includes: 'babel-carrier-arrow-' } })],
  'gap.notation': [badge('Gap label', 'gap-notation', { textIncludes: 'label' })],
  'identity.occurrences': [check('Forest light', '.babel-forest-light-canvas', 'babel-forest-light-canvas', { kind: 'canvas', note: 'Canvas existence does not prove lit pixels; capture/read visible output.' })],
  'presentation.lens': [check('Lens emphasis', '.terminal-label.babel-lens-node', "classed('babel-lens-node'", { minCount: 2, note: 'This atlas explicitly compiles activeLens:true. Check rendered emphasis as well as the class.' })],
  'control.dependency': [check('Rectangular domain', '.babel-control-domain'), check('Control connector', '.babel-control-dependency'), check('Coindex', '.babel-control-index', 'babel-control-index', { exactCount: 2 })],
  'binding.dependency': [check('Elliptic domain', '.babel-binding-domain')],
  'predication.dependency': [check('Predication connector', '.babel-predication-path')],
  'parasitic-gap.paths': [check('Path-node rings', '.babel-pg-path-node', 'babel-pg-path-node', { minCount: 4 })],
  'parasitic-gap.copy': [check('Copy fork', '.babel-pg-copy-branch')],
  'locality.boundary': [check('Barrier cut', '.babel-island-barrier-cut')],
  'ellipsis.site': [check('Ghosting', '.babel-ellipsis-ghost-label', 'babel-ellipsis-ghost-label', { note: 'Inspect computed opacity and authored silence; the class alone does not establish correct dimming.' })],
  'correspondence.alignment': [genericPath('Correspondence curves', 'gapping-pair'), check('Correspondence index', '.vr-index-badge', 'vr-index-badge', { minCount: 2 })],
  'deletion.site': [check('Strike', '.babel-partial-copy-deletion-strike')],
  'constituent.occurrence': [check('Constituent enclosure', '.babel-constituent-enclosure')],
  'constituent.region': [check('Gradient enclosure', '.babel-constituent-enclosure', 'babel-constituent-enclosure', { note: 'Inspect gradient fill; geometry existence alone does not verify gradient.' })],
  'pair-merge': [check('Branch overlay', '.babel-pair-merge-branch')],
  'multidominance': [check('Shared branch', '.babel-multidominance-branch', 'babel-multidominance-branch', { note: 'The second parent needs the connector; the first parent is already a native branch.' })],
  'argument-sharing': [check('Crossed domain ovals', '.babel-argument-sharing-domain', 'babel-argument-sharing-domain', { minCount: 2 }), check('Label box', '.babel-argument-sharing-object-box')],
  'idiom.chunks': [check('Domain bracket', '.babel-idiom-domain-bracket'), check('Underline', '.babel-idiom-chunk-underline')],
  'plaque.structured': [check('Plaque shell', '.babel-feature-plaque-shell')],
  'feature-sharing': [check('Feature vine', '.babel-feature-sharing-vine', 'babel-feature-sharing-vine', { minCount: 2 })],
  'agreement.cycle': [check('Cycle badge', '.babel-agree-cycle-badge')],
  'feature.dependency': [check('Feature connectors', '.babel-case-assignment-path'), check('Feature connectors', '.babel-case-collection-path')],
  'dependent-case': [check('Dependent-case elbow', '.babel-dependent-case-elbow')],
  'accord': [check('Accord connector', '.babel-accord-path'), check('Boxed index', '.babel-accord-index-box')],
  'phase.domain': [check('Phase arc', '.babel-phase-arc')],
  'transfer.domain': [check('Transfer arcs', '.babel-transfer-phase-arc'), check('Transfer arcs', '.babel-transfer-domain-arc')],
  'domain.annotation': [badge('Overlay annotation', 'phase-edge', { textIncludes: 'label' })],
  'phase.edge': [check('Edge outline', '.babel-transfer-edge-outline')],
  'transfer.access': [check('Access path', '.babel-transfer-access-path')],
  'judgment.verdict': [check('Verdict glyph', '.babel-analysis-judgment'), check('Verdict label', '.babel-analysis-verdict-label')],
  'landing-candidates': [check('Candidate rail', '.babel-improper-candidate-rail')],
  'judgment.blocked': [check('Blocking cross', '.babel-local-judgment[data-judgment-anchor][data-judgment-outcome="blocked"] .babel-domain-locality-x', 'babel-local-judgment', { minCount: 2, note: 'Both visible native cross strokes are required; a font glyph is not the Orchard primitive.' })],
  'judgment.licensed': [check('Licensed check', '.babel-local-judgment[data-judgment-anchor][data-judgment-outcome="licensed"] .babel-domain-locality-check', 'babel-local-judgment', { attribute: { name: 'd', includes: 'M -13.0 0.0 L -3.6 9.4 L 13.0 -13.0' }, note: 'Requires the native stroked check path rather than a font glyph.' })],
  'intervention': [check('Intervention path', '.babel-intervention-search-path')],
  'blocked-extraction': [check('Branch overlay', '.babel-blocked-extraction-adjunct-branch'), check('Blocked extraction curve', '.babel-blocked-extraction-path')],
  'focus.prominence': [check('Prominence branches', '.babel-focus-branch-strong'), check('Prominence branches', '.babel-focus-branch-weak')],
  'focus.projection': [check('Projection hop', '.babel-f-projection-path'), check('Feature annotation', '.babel-f-projection-feature'), check('Accent annotation', '.babel-f-projection-accent')],
  'focus.association': [genericPath('Nested association curves', 'strong-npi')],
  'polarity.licensing': [genericPath('Nested association curves', 'strong-npi')],
  'storage.ledger': [check('Ledger frame', '.babel-cooper-storage-plaque')],
  'scope.movement': [check('Covert path', '.babel-lf-path-qr'), check('Scope domain', '.babel-lf-domain')],
  'operator-binding': [check('Ranked scope hulls', '.babel-operator-variable-domain'), check('Variable-binding path', '.babel-operator-variable-path')],
  'theta-grid': [check('Role grid', '.babel-theta-grid-shell')],
  'pf.structured': [check('PF plate frame', '.babel-pf-plate-shell'), check('PF plate rows', '.babel-pf-plate-text')],
  'pf.rewrite': [check('Rewrite arrow', '.babel-pf-plate-arrow', 'babel-pf-plate-arrow', { textIncludes: '→', note: 'A realization plaque without this arrow is a failed check, even when the plan advertises Rewrite arrow.' })],
  'pf.correspondence': [check('Correspondence map', '.babel-pf-correspondence-shell'), check('Correspondence map', '.babel-pf-correspondence-link')],
  'pf.fission': [check('Bundle shell', '.babel-fission-bundle-shell', 'babel-fission-bundle-shell', { minCount: 3 })],
  'pf.impoverishment': [check('Delinking mark', '.babel-impoverishment-cross', 'babel-impoverishment-cross', { minCount: 2 })],
  'pf.local-dislocation': [check('State lanes', '.babel-pf-lane-expression', 'babel-pf-lane-expression', { minCount: 2, distinctText: true })],
  'pf.linearization': [check('Comparison column layout', '.babel-linearization-column-title', 'babel-linearization-column-title', { minCount: 2 }), check('Comparison column layout', '.babel-linearization-row', 'babel-linearization-row', { minCount: 2 })],
  'organization.large-anchor-set': [check('Anchor badge', '.vr-anchor-set-badge', 'vr-anchor-set-badge', { minCount: 5 }), check('Anchor rail', '.babel-anchor-set-rail')]
};
export function productionDomChecks(recipe, variant, ownedItems) {
  let checks;
  if (recipe === 'movement.path') {
    const kind = variant === 'orthogonal' ? 'roll-up' : variant === 'cross-workspace' ? 'sideward' : 'phrasal';
    const piece = variant === 'orthogonal' ? 'Orthogonal movement' : variant === 'cross-workspace' ? 'Cross-workspace crest' : 'Movement curve';
    checks = [check(piece, `.babel-trajectory-path-${kind}`, 'babel-trajectory-path-${primitive.trajectoryKind}'), manual('Path states', 'This positive fixture authors licensed movement only; inspect path endpoints. Blocked/other outcomes are not exercised by this record.')];
  } else if (['identity.occurrences', 'coreference.coindex'].includes(recipe)) {
    const identity = ownedItems.find(({ item }) => item.kind === 'coindex')?.item;
    assert.equal(identity?.nodeIds?.length, 2, 'The public identity fixture must retain both authored occurrences.');
    checks = [...identity.nodeIds.map(nodeId => check('Coindex',
      recipe === 'coreference.coindex' ? `.babel-binding-index[data-coreference-node=${JSON.stringify(nodeId)}]`
        : `.babel-identity-index[data-identity-anchor=${JSON.stringify(nodeId)}]`,
      recipe === 'coreference.coindex' ? 'data-coreference-node' : 'babel-identity-index',
      { exactCount: 1, textEquals: identity.index, note: `One visible index on exact authored occurrence ${nodeId}; a literal word suffix cannot substitute for the mark.` })),
    ...(maps[recipe] ?? [])];
  } else if (recipe === 'strong-npi') {
    const pairs = ownedItems.find(({ item }) => item.kind === 'undirected-link')?.item.pairs || [];
    checks = pairs.length === 2
      ? [check('Nested association curves', '.babel-strong-npi-path', 'babel-strong-npi-path', { minCount: 2 }), check('Feature notation', '.babel-strong-npi-feature-mark')]
      : [genericPath('Nested association curves', 'strong-npi'), check('Feature notation', '.vr-path-label', 'vr-path-label', { note: 'This fixture supplies one pair and a literal label. It does not exercise the richer two-pair native feature layout.' })];
  } else checks = maps[recipe];
  assert.ok(checks, `Missing DOM-check disposition for ${recipe}`);
  return checks;
}
