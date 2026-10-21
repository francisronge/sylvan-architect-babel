import React, { useEffect, useRef } from 'react';

/*
 * Babel's reusable visual building blocks, isolated from the analyses that
 * compose them. Specimens reuse production classes and production styling,
 * but never copy a card's authored words, features, terminals, branches, or
 * complete relation layout. A relation card may combine several primitives;
 * the vocabulary deliberately does not recreate that card.
 */

export type PrimitiveName =
  | 'Movement curve'
  | 'Orthogonal movement'
  | 'Cross-workspace crest'
  | 'Carrier arrow'
  | 'Path states'
  | 'Gap label'
  | 'Coindex'
  | 'Lens emphasis'
  | 'Forest light'
  | 'Rectangular domain'
  | 'Control connector'
  | 'Elliptic domain'
  | 'Predication connector'
  | 'Path-node rings'
  | 'Copy fork'
  | 'Barrier cut'
  | 'Ghosting'
  | 'Correspondence curves'
  | 'Correspondence index'
  | 'Strike'
  | 'Constituent enclosure'
  | 'Gradient enclosure'
  | 'Branch overlay'
  | 'Shared branch'
  | 'Crossed domain ovals'
  | 'Label box'
  | 'Underline'
  | 'Domain bracket'
  | 'Plaque shell'
  | 'Feature vine'
  | 'Cycle badge'
  | 'Feature connectors'
  | 'Dependent-case elbow'
  | 'Accord connector'
  | 'Boxed index'
  | 'Phase arc'
  | 'Transfer arcs'
  | 'Overlay annotation'
  | 'Edge outline'
  | 'Access path'
  | 'Verdict glyph'
  | 'Verdict label'
  | 'Candidate rail'
  | 'Blocking cross'
  | 'Licensed check'
  | 'Intervention path'
  | 'Blocked extraction curve'
  | 'Prominence branches'
  | 'Projection hop'
  | 'Feature annotation'
  | 'Accent annotation'
  | 'Nested association curves'
  | 'Feature notation'
  | 'Ledger frame'
  | 'Covert path'
  | 'Scope domain'
  | 'Ranked scope hulls'
  | 'Variable-binding path'
  | 'Role grid'
  | 'PF plate frame'
  | 'PF plate rows'
  | 'Rewrite arrow'
  | 'Correspondence map'
  | 'Bundle shell'
  | 'Delinking mark'
  | 'State lanes'
  | 'Comparison column layout'
  | 'Anchor badge'
  | 'Anchor rail';

export const visualPrimitiveNames: PrimitiveName[] = [
  'Movement curve',
  'Orthogonal movement',
  'Cross-workspace crest',
  'Carrier arrow',
  'Path states',
  'Gap label',
  'Coindex',
  'Lens emphasis',
  'Forest light',
  'Rectangular domain',
  'Control connector',
  'Elliptic domain',
  'Predication connector',
  'Path-node rings',
  'Copy fork',
  'Barrier cut',
  'Ghosting',
  'Correspondence curves',
  'Correspondence index',
  'Strike',
  'Constituent enclosure',
  'Gradient enclosure',
  'Branch overlay',
  'Shared branch',
  'Crossed domain ovals',
  'Label box',
  'Underline',
  'Domain bracket',
  'Plaque shell',
  'Feature vine',
  'Cycle badge',
  'Feature connectors',
  'Dependent-case elbow',
  'Accord connector',
  'Boxed index',
  'Phase arc',
  'Transfer arcs',
  'Overlay annotation',
  'Edge outline',
  'Access path',
  'Verdict glyph',
  'Verdict label',
  'Candidate rail',
  'Blocking cross',
  'Licensed check',
  'Intervention path',
  'Blocked extraction curve',
  'Prominence branches',
  'Projection hop',
  'Feature annotation',
  'Accent annotation',
  'Nested association curves',
  'Feature notation',
  'Ledger frame',
  'Covert path',
  'Scope domain',
  'Ranked scope hulls',
  'Variable-binding path',
  'Role grid',
  'PF plate frame',
  'PF plate rows',
  'Rewrite arrow',
  'Correspondence map',
  'Bundle shell',
  'Delinking mark',
  'State lanes',
  'Comparison column layout',
  'Anchor badge',
  'Anchor rail'
];

const OPERATOR_AMBER = '#c98a3d';

/*
 * The ranked OperatorVariableBinding palette exactly as production assigns
 * it: rank 0 (widest scope) emerald, rank 1 amber, rank 2 moonstone.
 */
const OPERATOR_PALETTE = ['#10b981', OPERATOR_AMBER, '#e6efeb'];

/*
 * Faithful OperatorVariableBinding geometry: the production
 * operatorVariableScopeHull (padX = max(46, 82 - rank*7), padY = max(44,
 * 82 - rank*6), eight bulged points per label rect, d3.polygonHull, radial
 * expansion max(24, 52 - rank*5)) and operatorVariableScopeEnvelope
 * (curveCatmullRomClosed.alpha(0.66)) were run verbatim over three nested
 * synthetic scope-rect sets, and the production route law routeX =
 * routeEdge + direction * (38 + (scopeCount - rank - 1) * 18) produced the
 * binding paths. Results were uniformly scaled into the 640x360 card.
 */
const OPERATOR_ENVELOPES = [
  'M403.5,160.1C397.8,139.1,383.9,118.4,372.3,98.3C360.4,77.5,350.8,49.4,332.6,37.4C315.6,26.4,291.4,28.8,268.7,25.8C238.9,21.8,203.5,17.4,171.9,18C142.5,18.6,112.1,24.1,85.2,28.2C64.0,31.5,36.3,27.7,25.4,39.5C15.4,50.3,18.7,74.3,18,91.9C17.3,109.6,17.8,127.4,21.1,145.3C24.7,165.5,32.2,186.3,40.4,206.2C49.2,227.4,57.9,249.2,73.0,268.2C92.3,292.6,124.4,321.8,151.7,333.2C170.8,341.2,189.3,340.6,210.6,342C240.4,344.0,280.6,342.3,309.9,338.7C330.2,336.3,350.6,337.9,365.3,327.9C382.1,316.4,393.9,288.7,400.8,268.1C406.6,250.7,407.2,232.4,407.7,214.5C408.2,196.4,408.3,178.0,403.5,160.1',
  'M396.4,156.9C389.8,135.6,378.2,106.5,360.7,94.5C344.7,83.4,321.0,85.9,298.5,83.4C267.5,79.8,226.0,76.4,195.5,79.0C174.3,80.9,148.0,78.8,137.3,90.3C127.7,100.7,130.5,123.5,129.7,140.3C128.8,157.5,128.1,173.3,132.2,192.3C140.3,230.2,165.3,306.8,195.5,326.3C211.4,336.5,232.5,334.4,250.8,335.9C268.1,337.4,285.2,337.3,302.5,335.7C320.7,334.0,342.5,335.4,357.3,325.7C374.9,314.1,388.2,285.1,395.4,264.0C401.3,246.6,401.9,228.5,402.0,210.7C402.2,192.8,401.9,174.5,396.4,156.9',
  'M388.7,156.5C381.3,135.7,368.0,106.9,350.2,95.9C334.4,86.3,310.6,88.4,291.0,88.8C271.6,89.2,243.8,87.1,233.1,98.1C223.9,107.5,225.9,126.4,224.6,144.1C222.0,179.3,230.1,242.3,235.3,277.2C237.8,294.4,235.0,312.8,244.0,321.8C253.8,331.6,278.3,330.1,295.5,330.3C312.9,330.6,333.4,331.8,347.9,323.2C366.0,312.5,381.1,283.1,388.8,261.9C395.0,244.8,395.9,226.8,395.9,209.2C395.9,191.6,394.8,173.7,388.7,156.5'
];

/* Per-rank domain parameters exactly as the production renderer sets them inline. */
const OPERATOR_DOMAIN_PARAMS = [
  { fillOpacity: 0.12, strokeOpacity: 0.88, strokeWidth: 3, dash: '10 9' },
  { fillOpacity: 0.105, strokeOpacity: 0.88, strokeWidth: 3, dash: '10 9' },
  { fillOpacity: 0.105, strokeOpacity: 0.78, strokeWidth: 3.2, dash: '12 8' }
];

const primitiveSlug = (name: PrimitiveName) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const WIDE_SPECIMENS = new Set<PrimitiveName>([
  'Ranked scope hulls',
  'Nested association curves',
  'Ledger frame',
  'Role grid',
  'PF plate frame',
  'Delinking mark'
]);

const specimenViewBox = (name: PrimitiveName) => {
  if (name === 'Correspondence map') return '0 0 380 200';
  return WIDE_SPECIMENS.has(name) ? '0 0 640 360' : '0 0 320 180';
};

/* Inline terminal-label typography shared by the label-treatment specimens. */
const terminalLabelStyle: React.CSSProperties = {
  fontFamily: 'Quicksand, sans-serif',
  fontStyle: 'italic',
  paintOrder: 'stroke',
  stroke: '#020806',
  strokeWidth: 5
};

/*
 * The identity forest-light canvas exactly as production paints it:
 * screen-composited beams from one light source per identity family and
 * six elliptical dapple fragments per occurrence, with the production
 * gradient stops, layer widths, and alphas.
 */
function ForestLightSpecimen() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'screen';
    const visualScale = 1;
    const source = { x: width * 0.78, y: Math.max(24, height * 0.12) };
    const sites = [
      { x: width * 0.2, y: height * 0.66 },
      { x: width * 0.5, y: height * 0.74 },
      { x: width * 0.76, y: height * 0.62 }
    ];
    const drawBeam = (site: { x: number; y: number }, occurrenceIndex: number) => {
      const dx = site.x - source.x;
      const dy = site.y - source.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length;
      const ny = dx / length;
      const gradient = context.createLinearGradient(source.x, source.y, site.x, site.y);
      gradient.addColorStop(0, 'rgba(236,253,245,0.30)');
      gradient.addColorStop(0.36, 'rgba(167,243,208,0.15)');
      gradient.addColorStop(1, 'rgba(34,197,94,0.04)');
      const layers: Array<[number, number]> = [[82, 0.12], [54, 0.16], [30, 0.22]];
      layers.forEach(([layerWidth, alpha]) => {
        const beamWidth = layerWidth * visualScale;
        const sourceHalf = beamWidth * 0.18;
        const targetHalf = beamWidth * (1.05 + occurrenceIndex * 0.08);
        context.globalAlpha = alpha;
        context.fillStyle = gradient;
        context.beginPath();
        context.moveTo(source.x + nx * sourceHalf, source.y + ny * sourceHalf);
        context.lineTo(site.x + nx * targetHalf, site.y + ny * targetHalf);
        context.lineTo(site.x - nx * targetHalf, site.y - ny * targetHalf);
        context.lineTo(source.x - nx * sourceHalf, source.y - ny * sourceHalf);
        context.closePath();
        context.fill();
      });
      context.globalAlpha = 1;
    };
    const dappleFragments: Array<[number, number, number, number, number, number]> = [
      [-36, -20, 28, 10, -18, 0.30],
      [-10, -34, 18, 7, -34, 0.28],
      [24, -14, 34, 12, -22, 0.34],
      [42, 16, 20, 8, -28, 0.24],
      [-26, 20, 26, 9, -15, 0.26],
      [8, 24, 19, 7, -30, 0.22]
    ];
    const drawDapple = (site: { x: number; y: number }, occurrenceIndex: number) => {
      dappleFragments.forEach(([x, y, rx, ry, angleDeg, alpha]) => {
        context.save();
        context.translate(
          site.x + (x + (occurrenceIndex - 1) * 8) * visualScale,
          site.y + (y - occurrenceIndex * 3) * visualScale
        );
        context.rotate((angleDeg * Math.PI) / 180);
        context.scale(1, ry / rx);
        const radial = context.createRadialGradient(0, 0, 0, 0, 0, rx * visualScale);
        radial.addColorStop(0, `rgba(236,253,245,${alpha})`);
        radial.addColorStop(0.55, `rgba(167,243,208,${alpha * 0.55})`);
        radial.addColorStop(1, 'rgba(16,185,129,0)');
        context.fillStyle = radial;
        context.beginPath();
        context.arc(0, 0, rx * visualScale, 0, Math.PI * 2);
        context.fill();
        context.restore();
      });
    };
    sites.forEach((site, occurrenceIndex) => {
      drawBeam(site, occurrenceIndex);
      drawDapple(site, occurrenceIndex);
    });
  }, []);
  return (
    <div style={{ position: 'relative', aspectRatio: '16 / 9' }}>
      <canvas
        ref={canvasRef}
        className="babel-forest-light-canvas"
        width={640}
        height={360}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          mixBlendMode: 'screen',
          opacity: 1,
          transition: 'opacity 180ms ease',
          zIndex: 2
        }}
      />
    </div>
  );
}

function PrimitiveDrawing({ name, markerPrefix }: { name: PrimitiveName; markerPrefix: string }) {
  switch (name) {
    case 'Movement curve':
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-movement-arrow`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#34d399" />
            </marker>
          </defs>
          <path className="babel-trajectory-path-shadow" d="M 76 128 Q 150 24 244 52" />
          <path
            className="babel-trajectory-path"
            markerEnd={`url(#${markerPrefix}-movement-arrow)`}
            d="M 76 128 Q 150 24 244 52"
          />
        </>
      );
    case 'Orthogonal movement':
      /*
       * The remnant/roll-up lane routing: down from the source, across the
       * clear lane, up to the target, with the production open chevron.
       */
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-open-arrow`}
              markerWidth="30"
              markerHeight="30"
              refX="19"
              refY="15"
              orient="auto"
              markerUnits="userSpaceOnUse"
              overflow="visible"
            >
              <path className="babel-trajectory-arrowhead" d="M 6 22 L 19 15 L 6 8" />
            </marker>
          </defs>
          <path className="babel-trajectory-path-shadow" d="M 84 48 L 84 140 L 236 140 L 236 76" />
          <path
            className="babel-trajectory-path babel-trajectory-path-roll-up"
            markerEnd={`url(#${markerPrefix}-open-arrow)`}
            d="M 84 48 L 84 140 L 236 140 L 236 76"
          />
        </>
      );
    case 'Cross-workspace crest':
      /* Shell-top to shell-top over the treetops: crest cubic. */
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-open-arrow`}
              markerWidth="30"
              markerHeight="30"
              refX="19"
              refY="15"
              orient="auto"
              markerUnits="userSpaceOnUse"
              overflow="visible"
            >
              <path className="babel-trajectory-arrowhead" d="M 6 22 L 19 15 L 6 8" />
            </marker>
          </defs>
          <path className="babel-trajectory-path-shadow" d="M 84 100 C 84 30, 236 30, 236 100" />
          <path
            className="babel-trajectory-path babel-trajectory-path-sideward"
            markerEnd={`url(#${markerPrefix}-open-arrow)`}
            d="M 84 100 C 84 30, 236 30, 236 100"
          />
        </>
      );
    case 'Carrier arrow':
      /* Isolate the heavy shaft and head; the carrier enclosure is separate. */
      return (
        <>
          <path className="babel-trajectory-path-shadow" d="M 160 148 L 160 96" />
          <path
            className="babel-trajectory-path babel-trajectory-path-smuggling"
            d="M 160 148 L 160 96"
          />
          <path
            className="babel-carrier-arrowhead"
            d="M 136 96 L 160 60 L 184 96 Z"
          />
        </>
      );
    case 'Path states':
      /*
       * The trajectory verdict restyles: licensed keeps the solid emerald
       * stroke; blocked switches to the 9 9 dash and the production reroute
       * (M s Q (ex, depth) e) with the arrowhead removed.
       */
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-movement-arrow`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#34d399" />
            </marker>
          </defs>
          <path
            className="babel-trajectory-path-shadow babel-locality-path-licensed"
            d="M 48 140 Q 92 52 138 46"
          />
          <path
            className="babel-trajectory-path babel-locality-path-licensed"
            markerEnd={`url(#${markerPrefix}-movement-arrow)`}
            d="M 48 140 Q 92 52 138 46"
          />
          <path
            className="babel-trajectory-path-shadow babel-locality-path-failed"
            d="M 186 64 Q 268 158 268 92"
          />
          <path
            className="babel-trajectory-path babel-locality-path-failed"
            d="M 186 64 Q 268 158 268 92"
          />
          <path className="babel-anti-locality-cap-shadow" d="M 254 92 L 282 92" />
          <path className="babel-anti-locality-cap" d="M 254 92 L 282 92" />
        </>
      );
    case 'Gap label':
      /*
       * The two gap notations: the relabeled terminal (babel-gap-notation /
       * babel-moved-from-copy carry the treatment; the visible mark is the
       * substituted trace text) and the standalone parasitic-gap label with
       * its production inline typography.
       */
      return (
        <>
          <text
            className="terminal-label babel-gap-notation"
            x="96"
            y="104"
            textAnchor="middle"
            fontSize="30"
            fontWeight="900"
            fill="#34d399"
            style={terminalLabelStyle}
          >tᵢ</text>
          <text
            className="babel-pg-gap-label"
            x="188"
            y="104"
            style={{
              fill: '#34d399',
              stroke: 'rgba(1, 8, 5, 0.94)',
              strokeWidth: '6px',
              paintOrder: 'stroke',
              fontFamily: '"Crimson Pro", Georgia, serif',
              fontSize: '32px',
              fontStyle: 'italic',
              fontWeight: 700
            }}
          >pgᵢ</text>
        </>
      );
    case 'Coindex':
      return (
        <>
          <text className="babel-binding-index babel-relation-index" x="112" y="103">i</text>
          <text className="babel-binding-index babel-relation-index" x="208" y="103">i</text>
        </>
      );
    case 'Lens emphasis':
      return (
        <g className="babel-render-card" data-lens-active="true">
          <text
            className="terminal-label"
            x="96"
            y="104"
            textAnchor="middle"
            fontSize="34"
            fontWeight="900"
            fill="#34d399"
            opacity="0.62"
            style={terminalLabelStyle}
          >α</text>
          <text
            className="terminal-label babel-lens-node"
            x="160"
            y="104"
            textAnchor="middle"
            fontSize="34"
            fontWeight="900"
            fill="#34d399"
            style={terminalLabelStyle}
          >β</text>
          <text
            className="terminal-label"
            x="224"
            y="104"
            textAnchor="middle"
            fontSize="34"
            fontWeight="900"
            fill="#34d399"
            opacity="0.62"
            style={terminalLabelStyle}
          >γ</text>
        </g>
      );
    case 'Rectangular domain':
      return (
        <rect
          className="babel-control-domain"
          x="62"
          y="42"
          width="196"
          height="100"
          rx="3"
        />
      );
    case 'Control connector':
      /* Production control stroke and marker with enough rise to read cleanly. */
      return (
        <>
          <defs>
            <marker
              className="babel-control-dependency-marker"
              id={`${markerPrefix}-control-arrow`}
              markerWidth="52"
              markerHeight="52"
              refX="43"
              refY="26"
              orient="auto"
              markerUnits="userSpaceOnUse"
              overflow="visible"
            >
              <path d="M 10 9 L 43 26 L 10 43" />
            </marker>
          </defs>
          <path
            className="babel-control-dependency"
            markerEnd={`url(#${markerPrefix}-control-arrow)`}
            d="M 250 148 L 250 118 L 74 118 L 74 42"
          />
        </>
      );
    case 'Elliptic domain':
      return <ellipse className="babel-binding-domain" cx="160" cy="92" rx="105" ry="56" />;
    case 'Predication connector':
      /*
       * The production predication geometry is orthogonal: each dotted path
       * drops from the predicand, runs its own lane (laneY stepped 28 per
       * predicate, source offsets stepped 18), and rises to its predicate.
       */
      return (
        <>
          <path className="babel-predication-path" d="M 160 48 L 160 132 L 84 132 L 84 92" />
        </>
      );
    case 'Path-node rings':
      return (
        <>
          <ellipse className="babel-pg-path-node babel-pg-path-node-primary" cx="117" cy="92" rx="35" ry="24" />
          <rect className="babel-pg-path-node babel-pg-path-node-secondary" x="177" y="68" width="48" height="48" rx="2" />
        </>
      );
    case 'Copy fork':
      return (
        <>
          <path className="babel-pg-copy-branch-shadow" d="M 58 44 Q 94 42, 126 82" />
          <path className="babel-pg-copy-branch" d="M 58 44 Q 94 42, 126 82" />
          <path className="babel-pg-copy-branch-shadow" d="M 126 82 Q 164 88, 208 138" />
          <path className="babel-pg-copy-branch" d="M 126 82 Q 164 88, 208 138" />
          <path className="babel-pg-copy-branch-shadow" d="M 126 82 Q 202 60, 270 124" />
          <path className="babel-pg-copy-branch" d="M 126 82 Q 202 60, 270 124" />
          <circle className="babel-pg-copy-ring-shadow" cx="126" cy="82" r="8.5" />
          <circle className="babel-pg-copy-ring" cx="126" cy="82" r="6" />
        </>
      );
    case 'Barrier cut':
      /* Boundary cuts: -50° slash pairs, shadow first, along the branch. */
      return (
        <>
          <line className="babel-island-barrier-shadow" x1="121.4" y1="138" x2="198.6" y2="46" />
          <line className="babel-island-barrier-cut" x1="121.4" y1="138" x2="198.6" y2="46" />
        </>
      );
    case 'Ghosting':
      return (
        <g>
          {['α', 'β'].map((text, index) => (
            <text
              key={index}
              className="terminal-label babel-ellipsis-ghost-label"
              x={96 + index * 48}
              y="90"
              textAnchor="middle"
              fontSize="27"
              fontWeight="900"
              fill="rgba(209, 250, 229, 0.34)"
              opacity="0.52"
              style={{
                ...terminalLabelStyle,
                stroke: 'rgba(1, 8, 5, 0.54)',
                filter: 'blur(0.25px) drop-shadow(0 0 5px rgba(167, 243, 208, 0.12))'
              }}
            >{text}</text>
          ))}
          {['γ', 'δ'].map((text, index) => (
            <text
              key={`lf-${index}`}
              className="terminal-label babel-lf-ghost-label babel-lf-copy-label"
              x={184 + index * 48}
              y="90"
              textAnchor="middle"
              fontSize="27"
              fontWeight="900"
              fill="rgba(209, 250, 229, 0.38)"
              opacity="0.58"
              style={{
                ...terminalLabelStyle,
                stroke: 'rgba(1, 8, 5, 0.62)',
                filter: 'blur(0.22px)'
              }}
            >{text}</text>
          ))}
        </g>
      );
    case 'Correspondence curves':
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-gapping-arrow`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path className="babel-gapping-arrowhead" d="M 1 1 L 9 5 L 1 9" />
            </marker>
          </defs>
          <path
            className="babel-gapping-correspondence babel-gapping-correspondence-predicate"
            markerEnd={`url(#${markerPrefix}-gapping-arrow)`}
            d="M 72 58 C 72 132 248 132 248 58"
          />
          <path
            className="babel-gapping-correspondence babel-gapping-correspondence-pair"
            markerEnd={`url(#${markerPrefix}-gapping-arrow)`}
            d="M 112 82 C 112 116 208 116 208 82"
          />
        </>
      );
    case 'Correspondence index':
      return (
        <>
          <text className="babel-gapping-index babel-relation-index" x="112" y="104" textAnchor="middle">α</text>
          <text className="babel-gapping-index babel-relation-index" x="208" y="104" textAnchor="middle">=α</text>
        </>
      );
    case 'Strike':
      return (
        <>
          <line className="babel-partial-copy-deletion-strike-shadow" x1="54" y1="72" x2="142" y2="72" />
          <line className="babel-partial-copy-deletion-strike" x1="54" y1="72" x2="142" y2="72" />
          <line className="babel-lf-strike-shadow" x1="178" y1="112" x2="266" y2="112" />
          <line className="babel-lf-strike" x1="178" y1="112" x2="266" y2="112" />
        </>
      );
    case 'Constituent enclosure':
      /* Both stroke-only licences: remnant landing and copy occurrence. */
      return (
        <>
          <rect className="babel-constituent-enclosure babel-enclosure-remnant-landing" x="36" y="40" width="140" height="70" />
          <rect className="babel-constituent-enclosure babel-enclosure-copy-occurrence" x="198" y="84" width="90" height="56" />
        </>
      );
    case 'Gradient enclosure':
      /*
       * The shared carrier/region fill, shown in its square enclosure and
       * rounded region variants without reproducing either analysis.
       */
      return (
        <>
          <defs>
            <linearGradient id={`${markerPrefix}-carrier-gradient`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(16, 185, 129, 0.32)" />
              <stop offset="100%" stopColor="rgba(4, 120, 87, 0.10)" />
            </linearGradient>
          </defs>
          <rect
            className="babel-constituent-enclosure babel-enclosure-carrier-chunk"
            x="30"
            y="42"
            width="126"
            height="76"
            style={{ fill: `url(#${markerPrefix}-carrier-gradient)` }}
          />
          <rect
            className="babel-constituent-enclosure babel-enclosure-carrier-chunk babel-improper-forbidden-region"
            x="178"
            y="68"
            width="112"
            height="70"
            style={{ fill: `url(#${markerPrefix}-carrier-gradient)` }}
          />
        </>
      );
    case 'Branch overlay':
      return (
        <>
          <path className="branch" d="M 160 44 C 148 72, 112 84, 82 116" />
          <path className="branch" d="M 160 44 C 172 72, 208 84, 238 116" />
          <path className="babel-native-branch-overlay" d="M 160 44 C 148 72, 112 84, 82 116" />
          <path className="babel-native-branch-overlay" d="M 160 44 C 172 72, 208 84, 238 116" />
        </>
      );
    case 'Shared branch':
      return (
        <>
          <path className="babel-multidominance-branch-shadow" d="M 90 62 L 160 124" />
          <path className="babel-multidominance-branch" d="M 90 62 L 160 124" />
          <path className="babel-multidominance-branch-shadow" d="M 230 62 L 160 124" />
          <path className="babel-multidominance-branch" d="M 230 62 L 160 124" />
        </>
      );
    case 'Crossed domain ovals':
      /* The crossed serial-predication domains, rotated ∓10 degrees. */
      return (
        <>
          <ellipse
            className="babel-argument-sharing-domain"
            data-argument-domain="1"
            cx="120"
            cy="92"
            rx="88"
            ry="52"
            transform="rotate(-10 120 92)"
          />
          <ellipse
            className="babel-argument-sharing-domain"
            data-argument-domain="2"
            cx="200"
            cy="92"
            rx="88"
            ry="52"
            transform="rotate(10 200 92)"
          />
        </>
      );
    case 'Label box':
      return (
        <g>
          <rect className="babel-argument-sharing-object-box" x="112" y="68" width="96" height="48" rx="4" />
          <text className="babel-argument-sharing-object-label" x="160" y="101">α</text>
        </g>
      );
    case 'Underline':
      return <path className="babel-idiom-chunk-underline" d="M 92 96 H 228" />;
    case 'Domain bracket':
      return <path className="babel-idiom-domain-bracket" d="M 116 44 H 146 V 140 H 116" />;
    case 'Plaque shell':
      /*
       * The shared-feature plaque shell exactly as the accepted Feature
       * Sharing card draws it: the 248x92 babel-feature-plaque-shell at
       * rx 12 inside the accepted plaque group, with no label or value.
       * The compact, CASE/AGREEMENT, and dependent-case state plaques are
       * parameter variations of this shell.
       */
      return (
        <g
          className="babel-feature-plaque babel-shared-feature-plaque"
          data-feature-anchor="shared-feature"
          data-feature-placement="accepted"
        >
          <rect className="babel-feature-plaque-shell" x="36" y="44" width="248" height="92" rx="12" />
        </g>
      );
    case 'Feature vine':
      /*
       * The accepted four-anchor Feature Sharing card (D5, "the three red
       * books"): four bearer vines converge on one shared point, each cubic
       * built with the production featureSharingVinePath control points
       * (c1 at 64% of the vertical span, c2 pulled 16% back toward the
       * bearer at least 22px above the convergence).
       */
      return (
        <>
          <path className="babel-feature-sharing-vine" d="M 72 50 C 72 102.5, 145.9 110, 160 132" />
          <path className="babel-feature-sharing-vine" d="M 131 50 C 131 102.5, 155.4 110, 160 132" />
          <path className="babel-feature-sharing-vine" d="M 189 50 C 189 102.5, 164.6 110, 160 132" />
          <path className="babel-feature-sharing-vine" d="M 248 50 C 248 102.5, 174.1 110, 160 132" />
        </>
      );
    case 'Cycle badge':
      return (
        <g className="babel-agree-cycle-badge" transform="translate(160 92)">
          <circle cx="0" cy="0" r="26" />
          <text className="babel-relation-index" x="0" y="12" textAnchor="middle">C1</text>
        </g>
      );
    case 'Feature connectors':
      /* Directed valuation, solid assignment, and dotted collection styles. */
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-agree-arrow`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto"
            >
              <path className="babel-agree-arrowhead" d="M 0 1 L 9 5 L 0 9 z" />
            </marker>
          </defs>
          <path
            className="babel-agree-directed-path babel-agree-directed-path-multiple"
            markerEnd={`url(#${markerPrefix}-agree-arrow)`}
            d="M 54 46 C 72 88, 94 102, 116 108"
          />
          <path
            className="babel-case-assignment-path"
            markerEnd={`url(#${markerPrefix}-agree-arrow)`}
            d="M 132 108 C 156 102, 172 82, 188 52"
          />
          <path
            className="babel-case-collection-path"
            d="M 204 108 C 228 102, 246 82, 264 52"
          />
        </>
      );
    case 'Dependent-case elbow':
      /*
       * The dependent-Case orthogonal elbow: down then across, filled
       * circular endpoints of radius 9, never an arrowhead.
       */
      return (
        <>
          <path className="babel-dependent-case-elbow" d="M 96.0 48.0 L 96.0 128.0 L 236.0 128.0" />
          <circle className="babel-dependent-case-endpoint" cx="96" cy="48" r="9" />
          <circle className="babel-dependent-case-endpoint" cx="236" cy="128" r="9" />
        </>
      );
    case 'Accord connector':
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-accord-arrow`}
              viewBox="0 0 10 10"
              refX="8.5"
              refY="5"
              markerUnits="userSpaceOnUse"
              markerWidth="18"
              markerHeight="18"
              orient="auto"
            >
              <path className="babel-accord-arrowhead" d="M 0 0 L 10 5 L 0 10 Z" />
            </marker>
          </defs>
          <path
            className="babel-accord-path"
            markerEnd={`url(#${markerPrefix}-accord-arrow)`}
            d="M 74 128 L 74 52 L 246 52 L 246 128"
          />
        </>
      );
    case 'Boxed index':
      return (
        <g>
          <rect className="babel-accord-index-box" x="70" y="96" width="34" height="34" />
          <text className="babel-accord-index babel-relation-index" x="87" y="122" textAnchor="middle">1</text>
        </g>
      );
    case 'Phase arc':
      /* The canonical single-phase treatment uses the production primary variant. */
      return (
        <>
          <path className="babel-phase-arc-shadow babel-phase-arc-shadow-primary" d="M 60.0 140.0 Q 160.0 28.0 260.0 140.0" />
          <path className="babel-phase-arc babel-phase-arc-primary" d="M 60.0 140.0 Q 160.0 28.0 260.0 140.0" />
        </>
      );
    case 'Transfer arcs':
      return (
        <>
          <path className="babel-transfer-phase-arc-shadow" d="M 70 120 Q 160 40 250 120" />
          <path className="babel-transfer-phase-arc" d="M 70 120 Q 160 40 250 120" />
          <path className="babel-transfer-domain-arc-shadow" d="M 110 144 Q 160 96 210 144" />
          <path className="babel-transfer-domain-arc" d="M 110 144 Q 160 96 210 144" />
        </>
      );
    case 'Overlay annotation':
      return <text className="babel-transfer-component-label" x="160" y="102" textAnchor="middle">α</text>;
    case 'Edge outline':
      /*
       * The phase-edge shell outline and its end-anchored label; the right
       * roof outline shares this exact rule.
       */
      return (
        <>
          <rect className="babel-transfer-edge-outline" x="128" y="70" width="116" height="44" />
        </>
      );
    case 'Access path':
      /* Post-transfer access: origin dot, dashed lane, locality arrowhead. */
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-domain-locality-arrow`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path className="babel-domain-locality-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <path className="babel-transfer-access-shadow" d="M 72 132 L 72 60 L 248 60" />
          <path
            className="babel-transfer-access-path"
            markerEnd={`url(#${markerPrefix}-domain-locality-arrow)`}
            d="M 72 132 L 72 60 L 248 60"
          />
          <circle className="babel-transfer-access-origin" cx="72" cy="132" r="8.0" />
        </>
      );
    case 'Verdict glyph':
      return <text className="babel-anti-locality-face" x="160" y="104" textAnchor="middle">☹</text>;
    case 'Candidate rail':
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-domain-locality-arrow`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path className="babel-domain-locality-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <path className="babel-improper-candidate-rail" d="M 280 82 L 280 154 L 58 154" />
          <path
            className="babel-improper-candidate-path babel-improper-candidate-path-licensed"
            markerEnd={`url(#${markerPrefix}-domain-locality-arrow)`}
            d="M 58 154 L 58 52"
          />
          <path
            className="babel-improper-candidate-path babel-improper-candidate-path-blocked"
            markerEnd={`url(#${markerPrefix}-domain-locality-arrow)`}
            d="M 178 154 L 178 70"
          />
          <path
            className="babel-improper-candidate-path babel-improper-candidate-path-blocked"
            markerEnd={`url(#${markerPrefix}-domain-locality-arrow)`}
            d="M 230 154 L 230 94"
          />
          <path
            className="babel-improper-candidate-path babel-improper-candidate-path-blocked"
            markerEnd={`url(#${markerPrefix}-domain-locality-arrow)`}
            d="M 256 154 L 256 106"
          />
        </>
      );
    case 'Blocking cross':
      /* Both production X treatments, isolated as variants of one mark. */
      return (
        <>
          <line className="babel-intervention-x-shadow" x1="58" y1="70" x2="102" y2="114" />
          <line className="babel-intervention-x-shadow" x1="102" y1="70" x2="58" y2="114" />
          <line className="babel-intervention-x-mark" x1="58" y1="70" x2="102" y2="114" />
          <line className="babel-intervention-x-mark" x1="102" y1="70" x2="58" y2="114" />
          <line className="babel-domain-locality-x-shadow" x1="206" y1="75" x2="240" y2="109" />
          <line className="babel-domain-locality-x-shadow" x1="240" y1="75" x2="206" y2="109" />
          <line className="babel-domain-locality-x" x1="206" y1="75" x2="240" y2="109" />
          <line className="babel-domain-locality-x" x1="240" y1="75" x2="206" y2="109" />
        </>
      );
    case 'Licensed check':
      /* The licensed check mark at its production 13-unit proportions. */
      return (
        <g transform="translate(160 92) scale(2)">
          <path className="babel-domain-locality-check-shadow" d="M -13 0 L -3.6 9.4 L 13 -13" />
          <path className="babel-domain-locality-check" d="M -13 0 L -3.6 9.4 L 13 -13" />
        </g>
      );
    case 'Intervention path':
      /* The failed probe search lane and its chevron arrowhead. */
      return (
        <>
          <path className="babel-intervention-search-shadow" d="M 244 48 L 244 110 L 76 110 L 76 64" />
          <path className="babel-intervention-search-path" d="M 244 48 L 244 110 L 76 110 L 76 64" />
          <path className="babel-intervention-arrowhead-shadow" d="M 66.3 87 L 76 64 L 85.7 87" />
          <path className="babel-intervention-arrowhead" d="M 66.3 87 L 76 64 L 85.7 87" />
        </>
      );
    case 'Blocked extraction curve':
      return (
        <>
          <defs>
            <marker
              className="babel-blocked-extraction-marker"
              id={`${markerPrefix}-blocked-extraction-arrow`}
              viewBox="0 0 12 12"
              markerWidth="13"
              markerHeight="13"
              refX="10"
              refY="6"
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 1 1 L 11 6 L 1 11 Z" />
            </marker>
          </defs>
          <path
            className="babel-blocked-extraction-path"
            markerStart={`url(#${markerPrefix}-blocked-extraction-arrow)`}
            markerEnd={`url(#${markerPrefix}-blocked-extraction-arrow)`}
            d="M 236 56 C 216 128, 104 128, 84 56"
          />
        </>
      );
    case 'Verdict label':
      return (
        <text className="babel-analysis-verdict-label" x="160" y="108" textAnchor="middle">
          diagnosis
        </text>
      );
    case 'Prominence branches':
      return (
        <>
          <path className="babel-focus-branch-mask" d="M 160 52 L 92 124" />
          <path className="babel-focus-branch-strong" d="M 160 52 L 92 124" />
          <path className="babel-focus-branch-mask" d="M 160 52 L 228 124" />
          <path className="babel-focus-branch-weak" d="M 160 52 L 228 124" />
        </>
      );
    case 'Projection hop':
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-f-projection-arrow`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="2.2"
              markerHeight="2.2"
              orient="auto"
            >
              <path className="babel-f-projection-arrowhead" d="M 0 0 L 10 5 L 0 10 Z" />
            </marker>
          </defs>
          <path
            className="babel-f-projection-path"
            markerEnd={`url(#${markerPrefix}-f-projection-arrow)`}
            d="M 92 138 C 92 88, 228 88, 228 38"
          />
        </>
      );
    case 'Feature annotation':
      return <text className="babel-f-projection-feature" x="160" y="104" textAnchor="middle">α</text>;
    case 'Accent annotation':
      return <text className="babel-f-projection-accent" x="160" y="104" textAnchor="middle">α*</text>;
    case 'Nested association curves':
      return (
        <>
          <path
            className="babel-strong-npi-path babel-strong-npi-path-outer"
            d="M 90 82 C 42 206, 118 300, 330 300 C 470 300, 520 222, 548 96"
          />
          <path
            className="babel-strong-npi-path babel-strong-npi-path-inner"
            d="M 220 150 C 206 238, 286 264, 390 224"
          />
        </>
      );
    case 'Feature notation':
      return <text className="babel-strong-npi-feature-mark" x="160" y="112" textAnchor="middle">α[β]</text>;
    case 'Ledger frame':
      return (
        <g className="babel-cooper-storage-plaque" data-storage-stage="1">
          <path className="babel-cooper-storage-connector" d="M 60 165 H 126" />
          <path className="babel-cooper-storage-bracket" d="M 158 90 H 140 V 240 H 158" />
          <path className="babel-cooper-storage-bracket" d="M 542 90 H 560 V 240 H 542" />
          <text className="babel-cooper-storage-key" x="190" y="136" textAnchor="start">α:</text>
          <text className="babel-cooper-storage-value" x="390" y="136" textAnchor="start">[β]</text>
          <text className="babel-cooper-storage-key" x="190" y="198" textAnchor="start">γ:</text>
          <text className="babel-cooper-storage-value" x="390" y="198" textAnchor="start">[δ]</text>
        </g>
      );
    case 'Covert path':
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-lf-arrow`}
              markerWidth="34"
              markerHeight="34"
              refX="22"
              refY="17"
              orient="auto"
              markerUnits="userSpaceOnUse"
              overflow="visible"
            >
              <path className="babel-lf-arrowhead" d="M 7 25 L 22 17 L 7 9" />
            </marker>
          </defs>
          <path
            className="babel-lf-path babel-lf-path-qr"
            markerEnd={`url(#${markerPrefix}-lf-arrow)`}
            d="M 80 146 L 80 52 L 240 52 L 240 112"
          />
        </>
      );
    case 'Scope domain':
      return (
        <rect
          className="babel-lf-domain"
          data-lf-domain-kind="scope"
          x="50"
          y="42"
          width="220"
          height="100"
          rx="18"
        />
      );
    case 'Ranked scope hulls':
      return (
        <>
          {OPERATOR_PALETTE.map((color, rank) => (
            <g
              key={rank}
              data-operator-variable-rank={String(rank)}
              data-operator-variable-count="3"
              data-operator-variable-color={color}
            >
              <path
                className="babel-operator-variable-domain"
                d={OPERATOR_ENVELOPES[rank]}
                fill={color}
                fillOpacity={OPERATOR_DOMAIN_PARAMS[rank].fillOpacity}
                stroke={color}
                strokeOpacity={OPERATOR_DOMAIN_PARAMS[rank].strokeOpacity}
                strokeWidth={OPERATOR_DOMAIN_PARAMS[rank].strokeWidth}
                strokeDasharray={OPERATOR_DOMAIN_PARAMS[rank].dash}
                strokeLinejoin="round"
              />
            </g>
          ))}
        </>
      );
    case 'Variable-binding path':
      return (
        <>
          <defs>
            <marker
              id={`${markerPrefix}-operator-arrow`}
              viewBox="0 -5 10 10"
              refX="8.5"
              refY="0"
              markerWidth="11"
              markerHeight="11"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                className="babel-operator-variable-arrowhead"
                d="M 1 -4 L 8.5 0 L 1 4"
                fill="none"
                stroke={OPERATOR_AMBER}
                strokeOpacity="0.92"
                strokeWidth="1.15"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>
          </defs>
          <path
            className="babel-operator-variable-path"
            d="M 252 132 C 294 132, 294 48, 68 48"
            fill="none"
            stroke={OPERATOR_AMBER}
            strokeOpacity="0.9"
            strokeWidth="1.2"
            strokeLinecap="round"
            markerEnd={`url(#${markerPrefix}-operator-arrow)`}
          />
        </>
      );
    case 'Role grid':
      return (
        <g className="babel-theta-grid-plate">
          <rect className="babel-theta-grid-shell" x="100" y="80" width="430" height="150" rx="12" />
          <line className="babel-theta-grid-rule" x1="116" y1="118" x2="514" y2="118" />
          <line className="babel-theta-grid-rule" x1="204" y1="126" x2="204" y2="214" />
          <line className="babel-theta-grid-rule" x1="355" y1="126" x2="355" y2="214" />
        </g>
      );
    case 'PF plate frame':
      return (
        <>
          <rect className="babel-pf-plate-shell" x="38" y="62" width="564" height="206" rx="8" />
          <line className="babel-pf-plate-rule" x1="64" y1="112" x2="576" y2="112" />
        </>
      );
    case 'PF plate rows':
      return (
        <>
          <text className="babel-pf-plate-text" x="62" y="98">α</text>
          <text className="babel-pf-plate-output babel-pf-plate-text babel-pf-plate-text-final" x="214" y="98">β</text>
        </>
      );
    case 'Rewrite arrow':
      return (
        <>
          <text className="babel-pf-plate-arrow" x="92" y="104">→</text>
          <text className="babel-fission-arrow" x="160" y="104">→</text>
          <text className="babel-phrasal-spellout-label" x="218" y="104" style={{ fontSize: '22px', strokeWidth: '3px' }}>⇒</text>
        </>
      );
    case 'Correspondence map':
      return (
        <>
          <rect
            className="babel-pf-correspondence-shell"
            x="25"
            y="25"
            width="330"
            height="150"
            rx="12"
            style={{ strokeWidth: '1.5px' }}
          />
          <line className="babel-pf-correspondence-link" x1="100" y1="83" x2="186" y2="132" style={{ strokeWidth: '1.15px' }} />
          <line className="babel-pf-correspondence-link" x1="280" y1="83" x2="194" y2="132" style={{ strokeWidth: '1.15px' }} />
          <text className="babel-pf-correspondence-source" x="100" y="74" textAnchor="middle" style={{ fontSize: '13px', strokeWidth: '2.5px' }}>α</text>
          <text className="babel-pf-correspondence-source" x="280" y="74" textAnchor="middle" style={{ fontSize: '13px', strokeWidth: '2.5px' }}>β</text>
          <text className="babel-pf-correspondence-exponent" x="190" y="153" textAnchor="middle" style={{ fontSize: '13px', strokeWidth: '2.5px' }}>γ</text>
        </>
      );
    case 'Bundle shell':
      return (
        <g className="babel-fission-bundle">
          <rect className="babel-fission-bundle-shell" x="86" y="36" width="148" height="108" rx="4" />
          <text className="babel-fission-bundle-title" x="102" y="62">α</text>
          <text className="babel-fission-bundle-row" x="102" y="92">[β]</text>
          <text className="babel-fission-bundle-row" x="102" y="116">[γ]</text>
        </g>
      );
    case 'Delinking mark':
      return (
        <>
          <line className="babel-impoverishment-link" x1="320" y1="86" x2="320" y2="238" />
          <line className="babel-impoverishment-cross" x1="292" y1="142" x2="348" y2="162" />
          <line className="babel-impoverishment-cross" x1="292" y1="162" x2="348" y2="182" />
        </>
      );
    case 'State lanes':
      return (
        <>
          <text className="babel-pf-lane-label" x="44" y="76">α</text>
          <text className="babel-pf-lane-expression" x="120" y="76">β · γ</text>
          <text className="babel-pf-lane-label" x="44" y="120">δ</text>
          <text className="babel-pf-lane-expression babel-pf-lane-expression-current" x="120" y="120">[β · γ]</text>
        </>
      );
    case 'Comparison column layout':
      return (
        <>
          <text className="babel-linearization-column-title" x="42" y="50">α</text>
          <text className="babel-linearization-row" x="42" y="84">γ &lt; δ</text>
          <text className="babel-linearization-row" x="42" y="116">δ &lt; ε</text>
          <text className="babel-linearization-column-title" x="188" y="50">β</text>
          <text className="babel-linearization-row babel-linearization-row-current" x="188" y="84">δ &lt; γ</text>
          <text className="babel-linearization-row babel-linearization-row-current" x="188" y="116">ε &lt; δ</text>
        </>
      );
    case 'Anchor badge':
      return (
        <g transform="translate(160 92) scale(3.8)">
          <circle className="babel-anchor-set-badge" cx="0" cy="0" r="7" />
          <text className="babel-anchor-set-badge-number" x="0" y="2.7" textAnchor="middle" fontSize="8">1</text>
        </g>
      );
    case 'Anchor rail':
      return (
        <>
          <line className="babel-anchor-set-stub" x1="88" y1="64" x2="88" y2="116" />
          <line className="babel-anchor-set-stub" x1="160" y1="64" x2="160" y2="116" />
          <line className="babel-anchor-set-stub" x1="232" y1="64" x2="232" y2="116" />
          <line className="babel-anchor-set-rail" x1="88" y1="116" x2="232" y2="116" />
        </>
      );
    case 'Forest light':
      return null;
  }
}

export function PrimitiveSpecimen({
  name,
  markerNamespace = 'vocabulary'
}: {
  name: PrimitiveName;
  markerNamespace?: string;
  key?: React.Key;
}) {
  const markerPrefix = `${markerNamespace}-${primitiveSlug(name)}`;
  return (
    <article className="babel-vocabulary-specimen" data-production-primitive={primitiveSlug(name)}>
      <h3>{name}</h3>
      {name === 'Forest light' ? (
        <ForestLightSpecimen />
      ) : (
        <svg viewBox={specimenViewBox(name)} role="img" aria-label={`${name} primitive`}>
          <PrimitiveDrawing name={name} markerPrefix={markerPrefix} />
        </svg>
      )}
    </article>
  );
}

export function VisualVocabulary() {
  return (
    <div className="babel-vocabulary-grid">
      {visualPrimitiveNames.map((name) => <PrimitiveSpecimen key={name} name={name} />)}
    </div>
  );
}
