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

const FBPROTO_MAX_REPLAY_CLICKS = 80;
const FBPROTO_MAX_REPLAY_WAITS = 150;
const FBPROTO_DISABLED_GRACE_POLLS = 6;

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

    let cancelled = false;
    let clicks = 0;
    let waits = 0;

    const fixStandaloneLogoPath = () => {
      host.querySelectorAll<HTMLImageElement>('img[src="/babellogo.png"]').forEach((image) => {
        image.src = '../../public/babellogo.png';
      });
    };

    /** Which authored stage the card is currently showing, 0-based. */
    const displayedStageIndex = (): number | null => {
      const match = (host.textContent || '').match(/Derivation Step stage-(\d+)/);
      if (match) return Number(match[1]) - 1;
      const counter = (host.textContent || '').match(/Stage\s+(\d+)\s*\/\s*\d+/);
      return counter ? Number(counter[1]) - 1 : null;
    };

    /** Walk Replay to the deterministic frame this card demonstrates. */
    const advanceToPinnedFrame = () => {
      if (cancelled) return;
      fixStandaloneLogoPath();
      const buttonByLabel = (label: string) =>
        Array.from<HTMLButtonElement>(host.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent?.trim() === label);
      const nextButton = buttonByLabel('Next');
      const stageIndex = displayedStageIndex();

      if (stageIndex !== null && stageIndex > card.pinnedStageIndex) {
        const prevButton = buttonByLabel('Prev');
        if (prevButton && !prevButton.disabled && clicks < FBPROTO_MAX_REPLAY_CLICKS) {
          clicks += 1;
          prevButton.click();
          window.setTimeout(advanceToPinnedFrame, 45);
        }
        return;
      }

      if (nextButton && !nextButton.disabled) {
        if (clicks >= FBPROTO_MAX_REPLAY_CLICKS) return;
        clicks += 1;
        waits = 0;
        nextButton.click();
        window.setTimeout(advanceToPinnedFrame, 45);
        return;
      }

      if (nextButton) {
        if (clicks > 0 || waits >= FBPROTO_DISABLED_GRACE_POLLS) return;
      }

      waits += 1;
      if (waits < FBPROTO_MAX_REPLAY_WAITS) {
        window.setTimeout(advanceToPinnedFrame, 80);
      }
    };

    const observer = new MutationObserver(fixStandaloneLogoPath);
    observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
    const timer = window.setTimeout(advanceToPinnedFrame, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer?.disconnect();
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
