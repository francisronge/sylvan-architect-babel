import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TreeVisualizer from '../../components/TreeVisualizer';
import {
  toRendererStages,
  unregisteredRelationNames,
  validateLabRelations
} from './visual-relations-lab-adapter.ts';
import { SourceGallery } from './visual-relations-source-gallery.tsx';
import { VisualVocabulary } from './visual-relations-vocabulary.tsx';
import { FallbackPrototypesSection } from './visual-relations-fallback-prototypes.tsx';
import { orchardSourceCitations, type OrchardSourceCitation } from '../research/relation-orchard/source-citations.ts';
import { orchardResearchImages, orchardSourcePreviewPath } from '../research/relation-orchard/source-research-images.ts';
import { archivedExampleArchetypes, rawCases, type LabCase } from './visual-relations-lab-cards.ts';

export { archivedExampleArchetypes, rawCases };

/** Replay auto-advance budgets. Clicks walk frames; waits poll for the control. */
const MAX_REPLAY_CLICKS = 400;
const MAX_REPLAY_WAITS = 150;
const DISABLED_GRACE_POLLS = 6;

/**
 * Derived once at module scope. These must keep a stable identity: handing
 * TreeVisualizer a fresh `derivationStages` array on every render restarts its
 * replay, which the lab's auto-advance then chases in a loop.
 */
type LabCaseView = LabCase & {
  rendererStages: ReturnType<typeof toRendererStages>;
  contract: ReturnType<typeof validateLabRelations>;
  unregistered: string[];
};

const allCases: LabCaseView[] = rawCases.map((item) => ({
  ...item,
  rendererStages: toRendererStages(item.derivationStages),
  contract: validateLabRelations(item.derivationStages, item.data),
  unregistered: unregisteredRelationNames(item.derivationStages)
}));

const archetypeCode = (item: LabCaseView) => item.archetype.split('.')[0];

function sourceImageUrl(path: string): string {
  const orchardStylesheet = document.querySelector<HTMLLinkElement>('link[href*="relation-visuals.css"]')?.href;
  return new URL(path, orchardStylesheet ?? window.location.href).href;
}

function OrchardSourcePanel({ code, source, card }: { code: string; source: OrchardSourceCitation; card?: LabCaseView }) {
  const imageUrl = source.image ? sourceImageUrl(source.image.path) : null;
  const researchImages = source.image ? [] : orchardResearchImages[code] ?? [];
  return (
    <div className="babel-source-panel">
      <p className="babel-source-kind">{source.kind}</p>
      {source.image && imageUrl ? (
        <figure>
          <a href={imageUrl} target="_blank" rel="noreferrer">
            <img src={imageUrl} alt={source.image.alt} loading="lazy" />
          </a>
          <figcaption>
            {source.image.credit} Select the image to see it at full size.{' '}
            <a href={source.image.licenseUrl} target="_blank" rel="noreferrer">License ↗</a>
          </figcaption>
        </figure>
      ) : null}
      {researchImages.map((researchImage) => {
        const url = sourceImageUrl(orchardSourcePreviewPath(researchImage.path));
        return (
          <figure key={researchImage.path}>
            <a href={url} target="_blank" rel="noreferrer">
              <img src={url} alt={researchImage.label} loading="lazy" />
            </a>
            <figcaption>{researchImage.role === 'visual precedent' ? 'Related visual precedent' : 'Cited source figure'}: {researchImage.label}. Small source preview; open the cited work below for the full figure.</figcaption>
          </figure>
        );
      })}
      {!source.image && researchImages.length === 0 && source.url ? (
        <p>No image is hosted here for this entry. Open the cited work to inspect the source.</p>
      ) : null}
      <p className="babel-source-citation">{source.citation}</p>
      <p>{source.location ? `${source.location}. ` : ''}{source.note}</p>
      {source.url ? <a href={source.url} target="_blank" rel="noreferrer">Open cited work ↗</a> : null}
      {source.related?.map((related) => (
        <p key={related.url} className="babel-source-related">
          Related evidence: <a href={related.url} target="_blank" rel="noreferrer">{related.citation} ↗</a> ({related.location})
        </p>
      ))}
      {card ? <>{source.url ? ' · ' : ''}<a href={`#${relationAnchor(card)}`}>Orchard drawing ↗</a></> : null}
    </div>
  );
}

export const canonicalCases = allCases.filter(
  (item) => !archivedExampleArchetypes.has(archetypeCode(item))
);
export const archivedExampleCases = allCases.filter(
  (item) => archivedExampleArchetypes.has(archetypeCode(item))
);

const cases = canonicalCases;

function relationAnchor(item: LabCaseView) {
  const slug = `${item.archetype}-${item.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `relation-${slug}`;
}

function RendererCard({ item }: { item: LabCaseView }) {
  const cardRef = useRef<HTMLElement | null>(null);
  const source = orchardSourceCitations[archetypeCode(item)];
  const hasAuthoredRelation = item.derivationStages.some((stage) => stage.relations.length > 0);
  const [lensActive, setLensActive] = useState(hasAuthoredRelation);
  const [layoutPass, setLayoutPass] = useState(0);
  /** Reported only when something is wrong; a passing check stays silent. */
  const contractNotes = [
    ...item.contract.issues.map((issue) =>
      `stage ${issue.stageIndex} · ${issue.relation} · ${issue.kind} · ${issue.detail}`),
    ...(item.unregistered.length > 0
      ? [`unregistered relation, fallback only: ${item.unregistered.join(', ')}`]
      : [])
  ];

  /*
   * The new source plates use wide cards. Give their TreeVisualizer one
   * post-font render pass so an off-screen initial mount cannot freeze at the
   * minimum zoom. This changes only the camera fit; the authored tree and every
   * relation anchor stay untouched.
   */
  useEffect(() => {
    if (!/^(?:D(?:3|4|5|6|7)|E(?:4|5|6|7))/.test(item.archetype)) return;
    let cancelled = false;
    const settle = () => {
      if (!cancelled) setLayoutPass(1);
    };
    const timer = window.setTimeout(settle, 900);
    document.fonts?.ready.then(settle);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [item.archetype]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    let cancelled = false;
    let clicks = 0;
    let waits = 0;

    const fixStandaloneLogoPath = () => {
      card.querySelectorAll<HTMLImageElement>('img[src="/babellogo.png"]').forEach((image) => {
        image.src = '../../public/babellogo.png';
      });
    };

    const advanceToFinalReplayStep = () => {
      if (cancelled) return;
      fixStandaloneLogoPath();
      const nextButton = Array.from<HTMLButtonElement>(card.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Next');

      if (nextButton && !nextButton.disabled) {
        if (clicks >= MAX_REPLAY_CLICKS) return;
        clicks += 1;
        waits = 0;
        nextButton.click();
        window.setTimeout(advanceToFinalReplayStep, 45);
        return;
      }

      if (nextButton && (clicks > 0 || waits >= DISABLED_GRACE_POLLS)) return;
      waits += 1;
      if (waits < MAX_REPLAY_WAITS) {
        window.setTimeout(advanceToFinalReplayStep, 80);
      }
    };

    const observer = new MutationObserver(fixStandaloneLogoPath);
    observer.observe(card, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
    fixStandaloneLogoPath();
    const timer = window.setTimeout(advanceToFinalReplayStep, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [item.archetype]);

  return (
    <article
      id={relationAnchor(item)}
      className={`babel-render-card${item.wide ? ' babel-render-card--wide' : ''}`}
      data-lab-case={item.archetype}
      data-lens-active={lensActive ? 'true' : 'false'}
      data-layout-pass={layoutPass}
      ref={cardRef}
      key={`${item.archetype}-${item.title}`}
    >
      <header className="babel-render-card-header">
        <div>
          <span className="babel-render-archetype">{item.archetype}</span>
          <h3>{item.title}</h3>
          {item.lensLabel || source ? (
            <div className="babel-card-actions">
              {item.lensLabel ? (
                <button
                  type="button"
                  className="babel-lens-toggle"
                  aria-pressed={lensActive}
                  onClick={() => setLensActive((value) => !value)}
                >
                  {item.lensLabel}
                </button>
              ) : null}
              {source ? (
                <details className="babel-source-detail">
                  <summary>{source.image || orchardResearchImages[archetypeCode(item)]?.length ? source.kind === 'source figure' ? 'View source figure' : 'View visual evidence' : 'Drawing provenance'}</summary>
                  <OrchardSourcePanel code={archetypeCode(item)} source={source} />
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
        {contractNotes.length > 0 ? (
          <ul className="babel-contract-report">
            {contractNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        ) : null}
      </header>
      <div className="babel-render-mount" data-archetype={item.archetype}>
        <TreeVisualizer
          data={item.data}
          animated
          derivationStages={item.rendererStages}
          sentence={item.sentence}
        />
      </div>
    </article>
  );
}

function OrchardSourceIndex() {
  const imageCount = Object.entries(orchardSourceCitations)
    .filter(([code, source]) => source.image || orchardResearchImages[code]?.length).length;
  return (
    <>
      <div className="babel-source-preview-intro">
        <h4>Sources for all 55 drawings</h4>
        <p>Open an entry to compare its Orchard drawing with the cited visual evidence. {imageCount} entries have source previews. The others link to the cited work or identify a drawing made for Babel.</p>
      </div>
      <div className="babel-selected-sources">
        {Object.entries(orchardSourceCitations).map(([code, source]) => {
          const card = cases.find((item) => archetypeCode(item) === code);
          if (!card) return null;
          const hasImage = source.image || orchardResearchImages[code]?.length;
          return (
            <details id={`source-${code.toLowerCase()}`} className="babel-source-detail babel-source-figure-entry" name="babel-orchard-source" key={code}>
              <summary><span>{code} · {card.title}</span><small>{hasImage ? source.kind === 'source figure' ? 'source figure' : 'visual evidence' : source.url ? 'source link' : source.kind}</small></summary>
              <OrchardSourcePanel code={code} source={source} card={card} />
            </details>
          );
        })}
      </div>
    </>
  );
}

function CurrentRendererLab() {
  return (
    <>
      <div className="babel-render-grid">
        {cases.map((item) => (
          <React.Fragment key={`${item.archetype}-${item.title}`}>
            <RendererCard item={item} />
          </React.Fragment>
        ))}
      </div>
      <FallbackPrototypesSection />
    </>
  );
}

function RelationSidebar() {
  return (
    <>
      <a href="#archive-top">Overview</a>
      <a href="#visual-vocabulary">Visual vocabulary</a>
      {cases.map((item) => (
        <a
          className="relation-sidebar-link"
          href={`#${relationAnchor(item)}`}
          key={`sidebar-${item.archetype}-${item.title}`}
        >
          <span>{item.archetype}</span>
          <strong>{item.title}</strong>
        </a>
      ))}
      <a href="#fallback-prototypes">Fallback prototypes</a>
      <a href="#sources">Sources</a>
    </>
  );
}

if (typeof document !== 'undefined') {
  document.documentElement.dataset.atlasView = 'canonical';

  const mount = document.getElementById('babel-current-renderer-lab');
  if (mount) {
    createRoot(mount).render(<CurrentRendererLab />);
  }

  const sidebarMount = document.getElementById('babel-relation-sidebar');
  if (sidebarMount) {
    createRoot(sidebarMount).render(<RelationSidebar />);
  }

  const vocabularyMount = document.getElementById('babel-visual-vocabulary');
  if (vocabularyMount) {
    createRoot(vocabularyMount).render(<VisualVocabulary />);
  }

  const sourceGalleryMount = document.getElementById('babel-source-gallery');
  if (sourceGalleryMount) {
    createRoot(sourceGalleryMount).render(<SourceGallery />);
  }

  const selectedSourcesMount = document.getElementById('babel-selected-sources');
  if (selectedSourcesMount) {
    createRoot(selectedSourcesMount).render(<OrchardSourceIndex />);
  }

  let atlasReadyFrames = 0;
  const revealAtlasWhenReady = () => {
    const cardsReady = !mount || Boolean(mount.querySelector('.babel-render-card'));
    const sidebarReady = !sidebarMount || Boolean(sidebarMount.querySelector('a'));
    const vocabularyReady = !vocabularyMount
      || Boolean(vocabularyMount.querySelector('.babel-vocabulary-specimen'));
    const sourcesReady = !selectedSourcesMount
      || Boolean(selectedSourcesMount.querySelector('.babel-source-figure-entry'));

    if (cardsReady && sidebarReady && vocabularyReady && sourcesReady) {
      document.documentElement.classList.remove('atlas-loading');
      document.documentElement.classList.add('atlas-ready');
      document.documentElement.dataset.atlasReady = 'true';
      mount?.setAttribute('aria-busy', 'false');
      sidebarMount?.setAttribute('aria-busy', 'false');
      vocabularyMount?.setAttribute('aria-busy', 'false');
      if (window.location.hash === '#sources') {
        document.getElementById('sources')?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
      }
      return;
    }

    atlasReadyFrames += 1;
    if (atlasReadyFrames < 600) {
      window.requestAnimationFrame(revealAtlasWhenReady);
      return;
    }

    document.documentElement.classList.add('atlas-load-failed');
    const loadingLabel = document.querySelector('.atlas-loading-label');
    if (loadingLabel) {
      loadingLabel.textContent = 'Relation cards could not load';
    }
  };

  window.requestAnimationFrame(revealAtlasWhenReady);
}
