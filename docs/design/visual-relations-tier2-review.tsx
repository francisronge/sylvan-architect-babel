import React from 'react';
import { createRoot } from 'react-dom/client';
import { TIER2_FACET_RECIPES } from '../../replay/relations/tier2FacetRecipes.ts';
import { TIER2_VISUAL_PRIMITIVE_NAMES } from '../../replay/relations/tier2FacetTypes.ts';
import { bindRelationPlanFrame } from '../../replay/relations/geometryBinding.ts';
import { compileRelationRenderPlan } from '../../replay/relations/renderPlanCompiler.ts';
import {
  PrimitiveSpecimen,
  visualPrimitiveNames,
  type PrimitiveName
} from './visual-relations-vocabulary.tsx';

const owningFacet = new Map<string, string>();
TIER2_FACET_RECIPES.forEach((recipe) => {
  recipe.outputs.forEach(({ piece }) => owningFacet.set(piece, recipe.id));
});

const reviewedPieces = new Set(TIER2_VISUAL_PRIMITIVE_NAMES);
const inventoryMatches = visualPrimitiveNames.length === reviewedPieces.size
  && visualPrimitiveNames.every((name) => reviewedPieces.has(name));

const stackingAnchor = { x: 210, y: 60 };
const stackingLeaf = { id: 'same_anchor', label: 'X', word: 'same anchor', children: [] };
const stackingForest = [{ id: 'same_anchor_root', label: 'XP', children: [stackingLeaf] }];
const stackingPlaque = (relation: string, row: string) => ({
  relation,
  anchors: { 'plaque anchor': 'same_anchor' },
  values: { 'plaque rows': row }
});
const stackingPlan = compileRelationRenderPlan([
  {
    statement: 'first plaque',
    stageRecord: 'first plaque',
    relations: [stackingPlaque('UnknownFirstPlaque', 'alpha')],
    workspaceForest: stackingForest
  },
  {
    statement: 'second plaque',
    stageRecord: 'second plaque',
    relations: [stackingPlaque('UnknownSecondPlaque', 'beta')],
    workspaceForest: stackingForest
  }
]);
const stackingPlaques = bindRelationPlanFrame(
  stackingPlan,
  1,
  () => stackingAnchor
).primitives.filter((primitive) => primitive.type === 'plaque');
const stackingNonOverlap = stackingPlaques.length === 2 && (
  stackingPlaques[0].y + stackingPlaques[0].height <= stackingPlaques[1].y
  || stackingPlaques[1].y + stackingPlaques[1].height <= stackingPlaques[0].y
);

function StackingFixture() {
  return (
    <section
      className="tier2-stacking-fixture"
      data-stacking-fixture="true"
      data-non-overlap={String(stackingNonOverlap)}
    >
      <header>
        <div>
          <p>Persistence stress fixture</p>
          <h2>Two independent claims, one stable anchor</h2>
        </div>
        <code>{stackingNonOverlap ? 'bound / non-overlapping' : 'overlap defect'}</code>
      </header>
      <svg viewBox="0 0 396 490" role="img" aria-label="Two persisted Tier-2 plaques stacked at one anchor">
        <circle className="tier2-stacking-anchor" cx={stackingAnchor.x} cy={stackingAnchor.y} r="8" />
        <text className="tier2-stacking-anchor-label" x={stackingAnchor.x} y={stackingAnchor.y - 18}>same anchor</text>
        <line
          className="tier2-stacking-anchor-line"
          x1={stackingAnchor.x}
          y1={stackingAnchor.y + 8}
          x2={stackingAnchor.x}
          y2={stackingPlaques[0]?.y ?? 0}
        />
        {stackingPlaques.map((plaque, index) => (
          <g key={plaque.itemIndex} data-stacking-plaque={index + 1}>
            <rect
              className="babel-feature-plaque-shell"
              x={plaque.x}
              y={plaque.y}
              width={plaque.width}
              height={plaque.height}
              rx="14"
            />
            <text className="babel-feature-plaque-title" x={plaque.x + 18} y={plaque.y + 25}>
              {`PERSISTED CLAIM ${index + 1}`}
            </text>
            <text className="babel-feature-text" x={plaque.x + 18} y={plaque.y + 71}>
              {`[${plaque.rows[0].label}: ${plaque.rows[0].value}]`}
            </text>
          </g>
        ))}
      </svg>
    </section>
  );
}

function PrimitivePair({ name }: { name: PrimitiveName; key?: React.Key }) {
  return (
    <article className="tier2-review-pair" data-primitive={name}>
      <header>
        <h2>{name}</h2>
        <code>{owningFacet.get(name) || 'missing owner'}</code>
      </header>
      <div className="tier2-review-columns">
        <section data-tier="1">
          <span>Tier 1 reference</span>
          <div data-compare-ink="true">
            <PrimitiveSpecimen name={name} markerNamespace="tier1" />
          </div>
        </section>
        <section data-tier="2">
          <span>Tier 2 equivalent</span>
          <div data-compare-ink="true">
            <PrimitiveSpecimen name={name} markerNamespace="tier2" />
          </div>
        </section>
      </div>
    </article>
  );
}

function Tier2VisualReview() {
  return (
    <main>
      <header className="tier2-review-header">
        <p>Provider-free renderer audit</p>
        <h1>Tier 1 / Tier 2 primitive identity</h1>
        <dl>
          <div><dt>Pieces</dt><dd>{visualPrimitiveNames.length}</dd></div>
          <div><dt>Facet recipes</dt><dd>{TIER2_FACET_RECIPES.length}</dd></div>
          <div><dt>Inventory</dt><dd>{inventoryMatches ? 'matched' : 'mismatch'}</dd></div>
        </dl>
      </header>
      <StackingFixture />
      <div className="tier2-review-grid">
        {visualPrimitiveNames.map((name) => <PrimitivePair key={name} name={name} />)}
      </div>
    </main>
  );
}

if (typeof document !== 'undefined') {
  const mount = document.getElementById('babel-tier2-visual-review');
  if (mount) {
    createRoot(mount).render(<Tier2VisualReview />);
    document.documentElement.dataset.tier2ReviewReady = 'true';
  }
}
