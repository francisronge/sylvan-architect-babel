/**
 * FALLBACK PROTOTYPES — accepted design, disposable cards.
 *
 * The fallback design is accepted (Francis, 2026-08-07) and its dispatcher is
 * production law in replay/relations/fallbackTopology.ts. These cards
 * stay research fixtures for visual judgment only.
 *
 * Demonstrates the production unknown-relation fallback as Orchard cards
 * inside the current Lab, using Babel's own card chrome, palette, typography,
 * and Replay presentation. Everything on the tree is a renderer overlay:
 * `workspaceForest` is never touched, no ghost node is added, and no relation
 * name or node ID is printed on the canvas. Current witnesses carry their
 * authored role labels; Replay retains every authored value and prior witness.
 *
 * The production renderer owns placement, paint, zoom and stage-scoped timing.
 * These cards supply authored records only; no alternate canvas painter is used.
 */
import React, { useEffect, useMemo, useRef } from 'react';

import TreeVisualizer from '../../components/TreeVisualizer';
import { toRendererStages } from './visual-relations-lab-adapter.ts';
import {
  FALLBACK_PROTOTYPE_CARDS,
  type FallbackPrototypeCard
} from './visual-relations-fallback-prototypes-data.ts';

function FallbackPrototypeCardView({ card }: { card: FallbackPrototypeCard }) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [archetype, title] = card.title.split(' · ');
  const rendererStages = useMemo(
    () => toRendererStages(card.derivationStages),
    [card.derivationStages]
  );

  useEffect(() => {
    const host = cardRef.current;
    if (!host) return;

    const fixStandaloneLogoPath = () => {
      host.querySelectorAll<HTMLImageElement>('img[src="/babellogo.png"]').forEach((image) => {
        image.src = '../../public/babellogo.png';
      });
    };

    const observer = new MutationObserver(fixStandaloneLogoPath);
    observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
    fixStandaloneLogoPath();
    return () => {
      observer.disconnect();
    };
  }, [card]);

  return (
    <article
      className="babel-render-card"
      data-lab-case={card.title}
      data-card-state="prototype"
      data-fallback-prototype={card.id}
      ref={cardRef}
    >
      <header className="babel-render-card-header">
        <div>
          <span className="babel-render-archetype">{archetype}. FALLBACK / TOPOLOGY</span>
          <h3>{title}</h3>
        </div>
      </header>
      <div className="babel-render-mount" data-archetype={card.id}>
        <TreeVisualizer
          data={card.data}
          animated
          autoPlay={false}
          initialReplayMoment={{ stageIndex: card.pinnedStageIndex, relationIndex: 0 }}
          derivationStages={rendererStages}
          sentence={card.sentence}
        />
      </div>
    </article>
  );
}

export function FallbackPrototypesSection() {
  return (
    <section
      id="fallback-prototypes"
      className="babel-render-grid babel-fbproto-lane"
      data-fallback-prototypes="accepted-design"
    >
      {FALLBACK_PROTOTYPE_CARDS.map((card) => (
        <React.Fragment key={card.id}>
          <FallbackPrototypeCardView card={card} />
        </React.Fragment>
      ))}
    </section>
  );
}
