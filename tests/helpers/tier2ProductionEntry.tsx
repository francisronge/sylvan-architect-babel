import React, { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import TreeVisualizer from '../../components/TreeVisualizer';
import { displayTreeForAnalysis } from '../../replay/finalForest';
import { prepareReplay } from '../../replay/prepareReplay';
import { compileRelationRenderPlan } from '../../replay/relations/renderPlanCompiler';
import '../../styles.css';
import '../../contractQualification/review.css';

const specimen = JSON.parse(document.getElementById('tier2-specimen')!.textContent!);
const analysis = specimen.bundle.analyses[0];

function ProductionRecipe() {
  const prepared = useMemo(() => {
    const replay = prepareReplay({ sentence: specimen.sentence, inputTokens: specimen.bundle.inputTokens,
      derivationStages: analysis.derivationStages, includePlayback: true });
    if (specimen.activeLens) {
      replay.relationRenderPlan = compileRelationRenderPlan(analysis.derivationStages, { activeLens: true });
    }
    return replay;
  }, []);
  return <main className="qualification-review" data-atlas-recipe={specimen.recipe} data-atlas-lens-active={String(specimen.activeLens)}>
    <section className="review-tree" aria-label="Replay">
      <TreeVisualizer data={displayTreeForAnalysis(analysis)!} animated autoPlay={false}
        derivationStages={analysis.derivationStages} sentence={specimen.sentence}
        inputTokens={specimen.bundle.inputTokens} preparedReplay={prepared} />
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<ProductionRecipe />);
