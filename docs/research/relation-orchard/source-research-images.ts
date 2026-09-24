// Each research capture has a small public preview beside its cited work.
// The original research copy stays outside the published Orchard.
export type OrchardResearchImage = {
  path: string;
  label: string;
  role: 'cited figure' | 'visual precedent';
};

const cited = (path: string, label: string): OrchardResearchImage => ({ path, label, role: 'cited figure' });
const precedent = (path: string, label: string): OrchardResearchImage => ({ path, label, role: 'visual precedent' });

export function orchardSourcePreviewPath(path: string): string {
  return `assets/source-previews/${path.replaceAll('/', '--').replace(/\.[^.]+$/, '.jpg')}`;
}

export const orchardResearchImages: Readonly<Record<string, readonly OrchardResearchImage[]>> = {
  A2: [cited('head-movement-subject-aux-inversion.png', 'Head movement between T and C')],
  A3: [cited('glossa-before-k-lowering.png', 'Before K lowering'), cited('glossa-after-k-lowering.png', 'After K lowering')],
  B: [precedent('source-recovery-2026-08-04/final-stretch/f67-copy-identity-source-tree.png', 'Copy-identity derivation; not a source for Forest light'), precedent('source-recovery-2026-08-04/final-stretch/f67-copy-cancellation-source-tree.png', 'Copy cancellation; not a source for Forest light')],
  C: [cited('mit-control-raising.png', 'Richards, trees (8)–(9): squared dashed control/raising connectors and controller-to-PRO link')],
  C2: [cited('source-recovery-2026-08-06/fable-audit/hagstrom-2012-principle-a-binding-domains.png', 'Principle A binding-domain slide')],
  C4: [precedent('co-indexation.png', 'Coindexation notation')],
  C5: [cited('source-recovery-2026-07-30/reference-control-predication/primary-predication-brownlow-figure57.png', 'Brownlow figure 57')],
  D: [precedent('agree-merge-and-agree.jpg', 'van Gelderen, “Merge and AGREE”: T and DP bear contrasting unvalued and valued feature bundles')],
  D3: [cited('source-recovery-2026-07-30/agreement-case-licensing/multiple-agree-success-nevins-page-966.png', 'Nevins multiple-Agree figure')],
  D4: [cited('source-recovery-2026-07-30/agreement-case-licensing/cyclic-agree-keine-dash-page-680.png', 'Keine and Dash cyclic Agree figure')],
  D5: [cited('source-recovery-2026-07-30/agreement-case-licensing/feature-sharing-keine-page-13.png', 'Keine feature-sharing figure')],
  D6: [cited('source-recovery-2026-07-30/agreement-case-licensing/case-and-feature-collection-norris-page-18.png', 'Norris case and feature collection figure')],
  E1: [cited('source-recovery-2026-07-26/island-subjacency-cas-lx522-slide24.jpg', 'Bounding-node crossing slide')],
  E2: [cited('source-recovery-2026-07-30/phase-arc-gao-2016.png', 'Phase-domain arc')],
  E4: [cited('source-recovery-2026-07-31/domains-phases-locality/phase-transfer-pic-fong-page4.png', 'Fong phase and transfer diagrams')],
  E4b: [cited('source-recovery-2026-07-31/domains-phases-locality/phase-transfer-pic-fong-page4.png', 'Fong blocked-access diagram')],
  E5: [cited('source-recovery-2026-07-31/domains-phases-locality/anti-locality-newman-page16.png', 'Newman too-short path'), cited('source-recovery-2026-07-31/domains-phases-locality/anti-locality-newman-page18.png', 'Newman licensed path')],
  E6: [cited('source-recovery-2026-07-31/domains-phases-locality/improper-movement-poole-page371.png', 'Poole improper-movement figures')],
  F: [precedent('vp-ellipsis-shaded.jpg', 'VP ellipsis lecture: filled VP region; its comment about T is unrelated to Babel’s opacity'), cited('source-recovery-2026-08-01/silence-ellipsis-pronunciation/merchant-ellipsis-page-21.png', 'Merchant (56b): silent TP remains structurally present')],
  F5: [precedent('source-recovery-2026-08-01/silence-ellipsis-pronunciation/meadows-yan-verb-doubling-page-6.png', 'Meadows and Yan Figures 17–18: moved copies followed by selective deletion')],
  G: [cited('source-recovery-2026-08-02/sharing-coordination-non-tree/multidominance-bosveld-figure2.png', 'Bosveld-de Smet and de Vries multidominance')],
  G3: [cited('source-recovery-2026-08-02/sharing-coordination-non-tree/object-sharing-hiraiwa-bodomo-figure19.png', 'Hiraiwa and Bodomo object-sharing figure')],
  H: [precedent('source-recovery-2026-08-04/final-stretch/f37-many-to-many-pf-plate-source.png', 'Yang Figure 11: boxed feature/exponent representations; visual precedent for a compact record'), precedent('source-recovery-2026-09-24/vocabulary-insertion-goryczka-example3a.png', 'Goryczka example (3a): exponents inserted at terminal nodes')],
  H2B: [cited('source-recovery-2026-08-04/final-stretch/f38-phrasal-spellout-source.png', 'Caha and Pantcheva phrasal Spell-Out')],
  H2C: [cited('source-recovery-2026-08-04/final-stretch/f37-many-to-many-pf-plate-source.png', 'Yang many-to-many exponence mapping')],
  H3: [cited('source-recovery-2026-08-02/pf-morphology-linearization/babel-source-fission.png', 'Breit example 17, fission')],
  H4: [cited('source-recovery-2026-08-02/pf-morphology-linearization/babel-source-impoverishment.png', 'Harley and Noyer impoverishment')],
  H5: [cited('source-recovery-2026-08-02/pf-morphology-linearization/babel-source-local-dislocation-rebracketing.png', 'Gong local dislocation')],
  H6: [cited('source-recovery-2026-09-24/fox-pesetsky-cyclic-linearization-example2.png', 'Fox and Pesetsky example (2), page 5: numbered horizontal movement paths below the linear string'), precedent('source-recovery-2026-08-02/pf-morphology-linearization/babel-source-linearization-licensed.png', 'Fox and Pesetsky Scenario 1: source for the compatible ORDERING plaque'), precedent('source-recovery-2026-08-02/pf-morphology-linearization/babel-source-linearization-conflict.png', 'Fox and Pesetsky Scenario 2: accumulated ordering ledger exposes a cycle')],
  I1: [cited('source-recovery-2026-09-24/quantifier-raising-wang-example14.png', 'Wang example (14): right-angled dashed QR-for-scope and type-driven QR paths')],
  I6: [cited('source-recovery-2026-08-06/fable-audit/yoo-1998-ex25-cooper-storage.png', 'Yoo example 25, Cooper Storage')],
  I7: [cited('source-recovery-2026-08-06/fable-audit/hoyt-2005-ex26-accord.png', 'Hoyt example 26, negative concord')],
  I8: [cited('source-recovery-2026-08-06/fable-audit/nicolae-2013-ex89-91-strong-npi-paths.png', 'Nicolae examples 89 to 91, NPI licensing')],
  I9: [cited('source-recovery-2026-08-06/fable-audit/wagner-2010-ex67-f-projection.png', 'Wagner example 67, focus projection')],
  I1b: [precedent('source-recovery-2026-09-24/operator-variable-baumann-figure2-32.png', 'Baumann et al. Figure 2.32: binding arrows, active-scope regions and shadowing in a formula tree')],
  I2: [precedent('reconstruction-vp-phase.png', 'Secondary reconstruction illustration with higher and lower copies in a syntax tree; not the source of Babel’s LF emphasis'), precedent('source-recovery-2026-07-26/reconstruction-copy-neglect-poole-keine-2024-ex2.png', 'Poole and Keine example (2): interpretive contrast, shown as brackets rather than a tree')],
  J: [cited('source-recovery-2026-07-30/theta-grid-cas-lx522-slide33.jpg', 'Theta-grid slide')],
  K: [precedent('source-recovery-2026-09-24/intervention-maeda-miyamoto-example9b.png', 'Maeda and Miyamoto example (9b): wh intervention blocks a longer dependency')],
  L1: [precedent('source-recovery-2026-09-24/remnant-wiland-example62.png', 'Wiland example (62): two explicit trajectories for extraction and remnant fronting')],
  L2: [cited('source-recovery-2026-08-06/fable-audit/shlonsky-2004-roll-up-figure39.png', 'Shlonsky roll-up figure 39')],
  L3: [cited('belletti-smuggling-example-7.png', 'Belletti smuggling derivation, example 7')],
  M2: [cited('atb-torr-movement-schema.png', 'Torr across-the-board movement schema')],
  M3: [cited('barnickel-sideward-example-155.png', 'Barnickel sideward-movement derivation, example 155')],
  N1: [cited('source-recovery-2026-07-30/labeling-pair-merge-structural-metadata/pair-merge-ginsburg-figure4.png', 'Ginsburg pair-Merge figure 4')],
  N2: [cited('source-recovery-2026-07-30/labeling-pair-merge-structural-metadata/adjunct-condition-oseki-figure20.png', 'Oseki adjunct-condition figure 20')],
  N3: [cited('source-recovery-2026-07-30/labeling-pair-merge-structural-metadata/idiom-chunk-cointerpretation-ahn-figure94.png', 'Ahn idiom-chunk figure 94')],
  O1B: [precedent('source-recovery-2026-08-01/silence-ellipsis-pronunciation/meadows-yan-partial-deletion-detail.png', 'Meadows and Yan figure 18: strike through a deleted DP inside a lower copy'), precedent('source-recovery-2026-08-01/silence-ellipsis-pronunciation/merchant-ellipsis-page-21.png', 'Merchant example 56b: unpronounced phrase retains internal syntax')],
  O2: [cited('source-recovery-2026-08-06/fable-audit/phillips-2006-figure4-subject-island-paths.png', 'Phillips subject-island figure 4')],
  M1: [precedent('source-recovery-2026-08-06/fable-audit/phillips-2006-figure4-subject-island-paths.png', 'Phillips Figure 4: primary and connected secondary parasitic-gap paths; not Babel’s fork')],
  O5: [precedent('source-recovery-2026-09-24/ordered-case-stacking-assmann-example33.png', 'Assmann example (33): ordered K heads and KP movement, but no two-slot plaque'), precedent('source-recovery-2026-07-30/agreement-case-licensing/case-and-feature-collection-norris-page-18.png', 'Norris Figure 37: bracketed feature bundle, but no case stacking')],
  O6: [precedent('source-recovery-2026-07-30/reference-control-predication/split-antecedence-pdtc-2026-figure2.png', 'Prague Discourse Treebank Figure 2: directed reference links in a dependency tree; not an exact split-antecedence figure'), precedent('source-recovery-2026-08-06/fable-audit/dillon-johnson-ex37-38-split-antecedence.png', 'Dillon and Johnson: linguistic analysis, not Babel’s two-link graphic')]
};
