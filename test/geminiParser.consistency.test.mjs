import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { ParseApiError, __test__ } from '../server/geminiParser.js';

const {
  normalizeParseBundle,
  normalizeParseResult,
  harmonizeExplanationWithDerivation,
  buildCanonicalMovementEvents,
  buildCanonicalMovementEventsFromGrowthFrames,
  inferSupplementalHeadMoveEventsFromGrowthFrames,
  buildCanonicalDerivationFromGrowthFrames,
  buildSystemInstruction,
  buildParseContentsPrompt,
  buildNotesSecondPassPrompt,
  summarizeProviderReasoningForDisplay,
  summarizeGeneration,
  estimateProOutputBudget,
  resolveRouteMaxOutputTokens,
  parseModelJson,
  normalizeGrowthFrames,
  normalizeSurfaceToken,
  tokenizeSentenceSurfaceOrder,
  validatePronouncedCopiesAgainstCommittedTree,
  validateNoteBindingsAgainstStructuredAnalysis,
  validateFinalProNoteBindings
} = __test__;

const TRACE_RE = /^(?:t|trace|t\d+|trace\d+|(?:t|trace)(?:_[a-z0-9]+)+|[a-z]+_trace(?:_[a-z0-9]+)*|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\}|∅|Ø|ε|null|epsilon)$/i;
const tokenize = (sentence) => String(sentence || '').trim().split(/\s+/).filter(Boolean);

function annotateSurfaceSpans(tree, sentence) {
  const tokens = tokenize(sentence);
  let index = 0;

  const walk = (node) => {
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = String(node.word || node.label || '').trim();
      if (!surface || TRACE_RE.test(surface)) {
        delete node.surfaceSpan;
        return null;
      }
      node.surfaceSpan = [index, index];
      index += 1;
      return node.surfaceSpan;
    }

    const childSpans = children.map(walk).filter(Boolean);
    if (childSpans.length === 0) {
      delete node.surfaceSpan;
      return null;
    }
    node.surfaceSpan = [childSpans[0][0], childSpans[childSpans.length - 1][1]];
    return node.surfaceSpan;
  };

  walk(tree);
  return tree;
}

function withMovementDecision(payload) {
  const analyses = Array.isArray(payload?.analyses) ? payload.analyses : [];
  analyses.forEach((analysis) => {
    if (!analysis || typeof analysis !== 'object' || analysis.movementDecision) return;
    const hasMovement = Array.isArray(analysis.movementEvents) && analysis.movementEvents.length > 0;
    analysis.movementDecision = {
      hasMovement,
      rationale: hasMovement
        ? 'Movement is part of the committed analysis.'
        : 'No movement is posited in the committed analysis.'
    };
  });
  return payload;
}

function findNodeById(tree, targetId) {
  let found = null;
  const visit = (node) => {
    if (!node || found) return;
    if (String(node.id || '').trim() === targetId) {
      found = node;
      return;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(tree);
  return found;
}

function collectLabels(tree, labels = []) {
  if (!tree) return labels;
  labels.push(String(tree.label || '').trim());
  const children = Array.isArray(tree.children) ? tree.children : [];
  children.forEach((child) => collectLabels(child, labels));
  return labels;
}

test('normalizeParseBundle commits a surface-consistent embedded-clause tree and appends SpellOut', () => {
  const sentence = 'Marie a dit que Paul partirait.';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                {
                  id: 'n3',
                  label: 'D',
                  children: [{ id: 'n4', label: 'Marie', word: 'Marie' }]
                }
              ]
            },
            {
              id: 'n5',
              label: 'InflP',
              children: [
                {
                  id: 'n6',
                  label: 'Infl',
                  children: [{ id: 'n7', label: 'a', word: 'a' }]
                },
                {
                  id: 'n8',
                  label: 'VP',
                  children: [
                    {
                      id: 'n9',
                      label: 'V',
                      children: [{ id: 'n10', label: 'dit', word: 'dit' }]
                    },
                    {
                      id: 'n11',
                      label: 'CP',
                      children: [
                        {
                          id: 'n12',
                          label: 'C',
                          children: [{ id: 'n13', label: 'que', word: 'que' }]
                        },
                        {
                          id: 'n14',
                          label: 'InflP',
                          children: [
                            {
                              id: 'n15',
                              label: 'DP',
                              children: [
                                {
                                  id: 'n16',
                                  label: 'D',
                                  children: [{ id: 'n17', label: 'Paul', word: 'Paul' }]
                                }
                              ]
                            },
                            {
                              id: 'n18',
                              label: 'VP',
                              children: [
                                {
                                  id: 'n19',
                                  label: 'V',
                                  children: [{ id: 'n20', label: 'partirait', word: 'partirait' }]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'This analysis treats the matrix verb as selecting a CP complement.'
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  const analysis = normalized.analyses[0];
  const spelloutStep = analysis.derivationSteps.at(-1);

  assert.deepEqual(analysis.surfaceOrder, ['Marie', 'a', 'dit', 'que', 'Paul', 'partirait']);
  assert.equal(spelloutStep.operation, 'SpellOut');
  assert.deepEqual(spelloutStep.spelloutOrder, ['Marie', 'a', 'dit', 'que', 'Paul', 'partirait']);
  assert.deepEqual(analysis.tree.surfaceSpan, [0, 5]);
});

test('buildSystemInstruction reinforces single overt realization and explicit movement-source commitments', () => {
  const instruction = buildSystemInstruction('xbar');
  const proInstruction = buildSystemInstruction('xbar', 'pro');

  assert.match(instruction, /Return raw JSON only\./i);
  assert.match(instruction, /Do not wrap the JSON in markdown or code fences\./i);
  assert.match(instruction, /Do not prepend or append any prose, labels, commentary, or explanatory text\./i);
  assert.match(instruction, /exactly one top-level JSON object and nothing else\./i);
  assert.match(instruction, /Each Flash Lite analysis must include:/i);
  assert.match(instruction, /"growthFrames"/i);
  assert.match(instruction, /"noteBindings"/i);
  assert.doesNotMatch(instruction, /Do not return a separate top-level "tree"/i);
  assert.doesNotMatch(instruction, /Do not return a separate top-level "movementDecision" or "explanation"/i);
  assert.match(instruction, /growthFrames are the only structural source of truth/i);
  assert.match(instruction, /noteBindings are the only Notes source of truth/i);
  assert.match(instruction, /Every overt terminal leaf should include "tokenIndex"/i);
  assert.match(instruction, /Every overt input token must appear in Growth exactly as pronounced/i);
  assert.match(instruction, /If movement occurs, encode the lower overt phrase before movement and the lower trace\/copy after movement directly in Growth/i);
  assert.match(instruction, /noteBindings mention movement, they must cover every encoded movement chain, including local subject A-movement chains/i);
  assert.match(instruction, /Do not build malformed head-move shells such as C branching into \[Infl did\] and \[C ∅\]/i);
  assert.match(instruction, /Do not use generic closure boilerplate/i);
  assert.match(instruction, /Flash Lite Growth-first discipline/i);
  assert.match(instruction, /Return growthFrames and noteBindings as the primary analysis bundle/i);
  assert.doesNotMatch(proInstruction, /Flash Lite Growth-first discipline/i);
  assert.match(proInstruction, /Use InflP \(not TP\) for compatibility with this project/i);
  assert.match(proInstruction, /noteBindings mention movement, they must cover every encoded movement chain, including local subject A-movement chains/i);
  assert.match(instruction, /For finite V2 clauses or topicalized finite clauses, keep the clause-initial fronted XP in Spec,CP/i);
  assert.match(proInstruction, /For finite V2 clauses or topicalized finite clauses, keep the clause-initial fronted XP in Spec,CP/i);
});

test('normalizeSurfaceToken preserves combining-mark scripts while stripping edge punctuation', () => {
  assert.equal(normalizeSurfaceToken('सी'), 'सी');
  assert.equal(normalizeSurfaceToken('मीरा'), 'मीरा');
  assert.equal(normalizeSurfaceToken('e\u0301'), 'é');
  assert.equal(normalizeSurfaceToken('¿Qué?'), 'qué');
});

test('tokenizeSentenceSurfaceOrder preserves native-script words with combining marks', () => {
  assert.deepEqual(
    tokenizeSentenceSurfaceOrder('कौन सी किताब मीरा ने खरीदी ?'),
    ['कौन', 'सी', 'किताब', 'मीरा', 'ने', 'खरीदी']
  );
  assert.deepEqual(
    tokenizeSentenceSurfaceOrder('কোন বইটা রিমা কিনেছে ?'),
    ['কোন', 'বইটা', 'রিমা', 'কিনেছে']
  );
});

test('buildParseContentsPrompt reinforces overt-token uniqueness and explicit lower copies', () => {
  const prompt = buildParseContentsPrompt('Ha comprado Ana el libro?', 'xbar');
  const proPrompt = buildParseContentsPrompt('Ha comprado Ana el libro?', 'xbar', 'pro');

  assert.match(prompt, /Return raw JSON only, with no markdown, no code fences, no labels, and no prose before or after the JSON object\./i);
  assert.match(proPrompt, /Return raw JSON only, with no markdown, no code fences, no labels, and no prose before or after the JSON object\./i);
  assert.match(prompt, /Return the complete analysis in one pass/i);
  assert.match(prompt, /return a complete syntactic analysis using X-Bar Theory in Babel's Lite Growth-first JSON format/i);
  assert.match(prompt, /Return growthFrames and noteBindings\./i);
  assert.doesNotMatch(prompt, /Do not return a separate tree object, flat node table, derivationSteps list, movementDecision object, explanation string, movementEvents list/i);
  assert.match(prompt, /growthFrames are the only structural source of truth/i);
  assert.match(prompt, /noteBindings are the only Notes source of truth/i);
  assert.match(prompt, /workspaceForest/i);
  assert.match(prompt, /workspaceForestJson" is accepted only for legacy compatibility/i);
  assert.match(prompt, /ordinary JSON object inside the array rather than as a compact JSON string/i);
  assert.match(prompt, /include tokenIndex values tied to that token list/i);
  assert.match(prompt, /The latest decisive Growth frame must realize the entire input sentence/i);
  assert.doesNotMatch(proPrompt, /Do not return a separate tree object/i);
  assert.match(proPrompt, /growthFrames are the only structural source of truth/i);
  assert.match(proPrompt, /Babel will derive Canopy plus any flat step log from them/i);
  assert.match(proPrompt, /The latest decisive Growth frame must realize the entire input sentence/i);
  assert.match(proPrompt, /Treat ledgers as typed summaries of facts that are already explicit in growthFrames, not as an independent second analysis/i);
  assert.match(proPrompt, /Do not let noteBindings or ledgers outrun the derivation/i);
  assert.match(proPrompt, /Movement does not cancel ordinary predicate-argument bookkeeping/i);
  assert.match(proPrompt, /FINAL CHECK: return one coherent JSON answer only\./i);
  assert.match(prompt, /If movement occurs, make it explicit and keep noteBindings and growthFrames consistent with the same one movement story/i);
  assert.match(prompt, /Every move-like Growth frame is invalid unless it also includes that movement object/i);
  assert.match(prompt, /Do not collapse distinct movement dependencies into one Lite frame/i);
  assert.match(prompt, /A one-frame Lite derivation is acceptable only when the analysis has no movement, no lower trace\/copy, no PRO\/control\/raising\/ECM dependency/i);
  assert.match(prompt, /The latest decisive Growth frame must be a single rooted committed structure whose overt terminals, read left-to-right, spell exactly/i);
  assert.match(prompt, /Do not use generic wrap-up boilerplate such as "the derivation converges"/i);
  assert.match(prompt, /If a closure sentence adds no concrete structural content, omit it/i);
  assert.match(prompt, /A good closure sentence should name a real structural payoff already encoded in Growth/i);
  assert.match(prompt, /"the analysis successfully captures"/i);
  assert.match(prompt, /"this demonstrates how"/i);
  assert.match(prompt, /Prefer direct structural closure wording over self-evaluative phrasing/i);
  assert.match(prompt, /use readable linguistic labels rather than internal placeholders such as V1, V2, VP1, CP_emb, InflP_mat/i);
  assert.match(prompt, /Phrase closure sentences as direct structural claims, not as self-referential sentences beginning with "This derivation" or "The analysis"/i);
  assert.match(prompt, /Do not stop at a pre-convergence frame: continue the derivation until every overt movement and head movement needed for the actual sentence has been encoded/i);
  assert.match(proPrompt, /Prefer enough structural Growth frames to keep lower merge, licensing, intermediate landing sites, and final landing sites distinct/i);
  assert.match(proPrompt, /Long-distance, raising\/control, or successive-cyclic dependencies should therefore normally surface as richer multi-frame timelines/i);
  assert.match(prompt, /For finite V2 clauses or topicalized finite clauses, keep the clause-initial fronted XP in Spec,CP/i);
  assert.match(prompt, /Never use positional placeholders such as Spec,CP, Spec,InflP, or Comp as node labels/i);
  assert.match(prompt, /Do not split, rewrite, or duplicate those overt tokens/i);
  assert.match(prompt, /On the Lite route, Growth may be more compact than Pro, but it must still be derivational rather than tree-first/i);
  assert.match(prompt, /include at least one lower-overt frame before the movement and one post-move frame/i);
  assert.match(prompt, /Once a phrase has moved, the pronounced landing copy must remain overt at its committed landing site/i);
  assert.match(prompt, /thematic subject surfaces high, Growth should still show its lower thematic merge site before later A-movement/i);
  assert.match(prompt, /If a thematic argument later surfaces in a higher licensing position, include at least one earlier structural frame where that argument is still present in its lower merge position/i);
  assert.match(prompt, /For head movement landing sites, represent one overt landed head and one lower trace\/copy/i);
  assert.match(prompt, /Never point movement at a bare label placeholder like Spec or C' unless that node carries an explicit id in the same frame/i);
  assert.match(prompt, /If the latest decisive frame still spells a different order from the input, do not return yet/i);
  assert.match(prompt, /If the sentence involves a clause-linking dependency such as raising, control, or ECM, encode that dependency explicitly in clausalDependencies/i);
  assert.match(prompt, /Do not encode control as ordinary A-movement/i);
  assert.match(prompt, /If a chain crosses more than one landing site or edge, encode each hop as its own explicit movement frame with the same chainId/i);
  assert.match(prompt, /If one predicate selects an overt finite or non-finite clause as its complement, record that embedding relation in clausalDependencies as well as in selectionLedger/i);
  assert.match(prompt, /If the architecture note says that a predicate selects an embedded clause, return a matching clausalDependencies entry for that clause embedding/i);
  assert.match(proPrompt, /Long-distance, raising\/control, or successive-cyclic dependencies should therefore normally surface as richer multi-frame timelines/i);
  assert.match(proPrompt, /If a chain crosses more than one landing site or edge, encode each hop as its own explicit movement frame with the same chainId/i);
  assert.match(prompt, /If movement is encoded, include one binding of kind "chain" for each encoded movement chain, and attach each such binding to the relevant chain via chainId/i);
  assert.match(prompt, /If the analysis encodes movement, include public "chains" with one entry for each encoded movement chain/i);
  assert.match(prompt, /Do not omit subject A-movement chains merely because they are local licensing steps/i);
  assert.match(prompt, /include separate chain bindings for embedded subject A-movement, matrix subject A-movement, head movement, and A-bar movement whenever those chains are encoded/i);
  assert.match(prompt, /Every chain note must use chainId/i);
  assert.match(prompt, /Every chain note in noteBindings must include "chainId" and at least one structural anchor such as "stepIds" or "nodeIds"/i);
  assert.match(prompt, /Do not rely on generic supportIds alone for typed claims/i);
  assert.match(proPrompt, /If movement is encoded, public "chains" are required on the Pro route/i);
  assert.match(proPrompt, /Every chain note on the Pro route must include chainId plus at least one of stepIds or nodeIds/i);
  assert.match(prompt, /Do not leave hidden movement implicit/i);
  assert.match(prompt, /If the pronounced sentence begins with a fronted wh\/topic XP, a derivation that encodes only head movement is incomplete/i);
  assert.match(prompt, /If a finite interrogative, V2 clause, or inversion pattern surfaces an overt auxiliary or functional head before the subject, encode the corresponding HeadMove explicitly and place that overt landed head in C/i);
  assert.match(prompt, /should describe clause architecture, selection, and headedness rather than narrating movement details/i);
  assert.match(prompt, /architecture binding must describe the final committed architecture, not a stale pre-move configuration/i);
  assert.match(prompt, /If head movement lands an auxiliary in C, the chain note must say that it moves or lands in C rather than leaving it only in Infl/i);
  assert.match(prompt, /Do not hide movement facts inside architecture or licensing notes when a corresponding chain note should exist/i);
  assert.match(prompt, /Use subtype labels for control\/raising\/ECM when the note commits to a specific subtype/i);
  assert.match(prompt, /clausalDependencies must include the matching type and the most specific compatible subtype rather than leaving subtype as a generic placeholder/i);
  assert.match(prompt, /Treat ledgers as typed summaries of facts that are already explicit in growthFrames, not as an independent second analysis/i);
  assert.match(proPrompt, /Do not return noteBindings on this first pass; Babel will request model-authored noteBindings separately/i);
  assert.match(proPrompt, /You may also include optional typed ledgers such as chains, researchTrace, caseAssignments, argumentStructure, phaseLog, morphologyRealization, featureLedger, selectionLedger, bindingLedger, clausalDependencies, agreementLedger, predicateClassLedger, probeLedger, nullElementLedger, diagnosticLedger, parameterLedger, informationStructureLedger, operatorScopeLedger, voiceValencyLedger, linearizationLedger, localityLedger, and predicationLedger/i);
  assert.match(proPrompt, /On the Pro route, treat caseAssignments, argumentStructure, and selectionLedger as core outputs for any argument-bearing clause/i);
  assert.match(proPrompt, /Every note binding must anchor itself back into the derivation with stepIds and\/or nodeIds/i);
  assert.match(proPrompt, /Every note binding must anchor itself back into the derivation with stepIds and\/or nodeIds/i);
  assert.match(proPrompt, /researchTrace is an explicit typed decision journal, not raw scratchpad or private monologue/i);
  assert.match(proPrompt, /If you return researchTrace, you may include at most one or two noteBindings that summarize the decisive reasoning/i);
  assert.match(proPrompt, /If a note mentions surface order, word order, inversion, V2, fronting, head-initial\/head-final, or another linearization fact, linearizationLedger is required/i);
  assert.match(proPrompt, /If a note mentions locality, a phase edge, the left periphery as a landing requirement, successive-cyclic movement, minimality, or another boundary-sensitive movement fact, localityLedger is required/i);
  assert.match(proPrompt, /supportIds should cite the stable ids of the relevant ledger entries/i);
  assert.match(proPrompt, /Notes must not introduce a new public syntactic fact on their own/i);
  assert.match(proPrompt, /Typed-domain words in Notes are commitments, not decoration/i);
  assert.match(proPrompt, /Case notes should cite caseAssignmentIds explicitly/i);
  assert.match(proPrompt, /fewer than 3 frames on the Pro route is incomplete/i);
  assert.match(proPrompt, /Do not leave architecture, licensing, or closure notes structurally unanchored/i);
  assert.match(proPrompt, /Every noteBinding object is invalid unless it carries at least one anchor field/i);
  assert.match(proPrompt, /ChainId and stepIds alone are not sufficient when a chain note also mentions typed facts/i);
  assert.doesNotMatch(proPrompt, /Do not omit growthFrames on the Pro route/i);
  assert.match(proPrompt, /growthFrames are the only structural source of truth/i);
  assert.match(proPrompt, /noteBindings are the only Notes source of truth/i);
  assert.doesNotMatch(proPrompt, /Do not return a separate tree object/i);
  assert.match(proPrompt, /latest decisive Growth frame must be sufficient for Babel to derive the final Canopy/i);
  assert.match(proPrompt, /Do not stop at a pre-convergence frame: continue the derivation until every overt movement and head movement needed for the actual sentence has been encoded/i);
  assert.match(proPrompt, /For finite V2 clauses or topicalized finite clauses, keep the clause-initial fronted XP in Spec,CP/i);
  assert.match(proPrompt, /Never use positional placeholders such as Spec,CP, Spec,InflP, or Comp as node labels/i);
  assert.match(proPrompt, /Each Growth frame must include stepId and operation/i);
  assert.match(proPrompt, /Do not compress several derivational operations into one frame/i);
  assert.match(proPrompt, /Never point movement at a bare label placeholder like Spec or C' unless that node carries an explicit id in the same frame/i);
  assert.match(proPrompt, /Every move-like Growth frame is invalid unless it also includes that movement object/i);
  assert.match(proPrompt, /Do not collapse distinct movement dependencies into one frame/i);
  assert.match(proPrompt, /A one-frame derivation is acceptable only when the analysis has no movement, no lower trace\/copy, no PRO\/control\/raising\/ECM dependency/i);
  assert.match(proPrompt, /Once a phrase has moved, the pronounced landing copy must remain overt at its committed landing site/i);
  assert.match(proPrompt, /If a thematic argument later surfaces in a higher licensing position, include at least one earlier structural frame where that argument is still present in its lower merge position/i);
  assert.match(proPrompt, /If the sentence involves a clause-linking dependency such as raising, control, or ECM, encode that dependency explicitly in clausalDependencies/i);
  assert.match(proPrompt, /Do not encode control as ordinary A-movement/i);
  assert.match(proPrompt, /Use subtype labels when appropriate, such as subject-control, object-control, raising-to-subject, raising-to-object, or ECM/i);
  assert.match(proPrompt, /Do not leave hidden movement implicit/i);
  assert.match(proPrompt, /If the pronounced sentence begins with a fronted wh\/topic XP, a derivation that encodes only head movement is incomplete/i);
  assert.match(proPrompt, /If a finite interrogative, V2 clause, or inversion pattern surfaces an overt auxiliary or functional head before the subject, encode the corresponding HeadMove explicitly and place that overt landed head in C/i);
  assert.match(proPrompt, /explain the committed clause architecture, selection, and headedness rather than narrating movement details/i);
  assert.match(proPrompt, /architecture binding must describe the final committed architecture, not a stale pre-move configuration/i);
  assert.match(proPrompt, /If head movement lands an auxiliary in C, the chain note must say that it moves or lands in C rather than leaving it only in Infl/i);
  assert.match(proPrompt, /Do not hide movement facts inside architecture or licensing notes when a corresponding chain note should exist/i);
  assert.match(proPrompt, /explicit case claims require caseAssignments unless the case value is already fully and unambiguously represented in featureChecking/i);
  assert.match(proPrompt, /Explicit theta-role claims require argumentStructure on the Pro route rather than leaving theta-role information only in prose/i);
  assert.match(proPrompt, /Notes must not introduce a new public syntactic fact on their own/i);
  assert.match(proPrompt, /clausalDependencies must include the matching type and the most specific compatible subtype rather than leaving subtype as a generic placeholder/i);
  assert.doesNotMatch(proPrompt, /Do not return a separate tree object, derivationSteps list, movementDecision object, explanation string, movementEvents list/i);
  assert.match(proPrompt, /return a complete syntactic analysis using X-Bar Theory in Babel's Pro Growth-first JSON format/i);
  assert.match(prompt, /CONSISTENCY RECHECK: Before returning, read the same request again and verify that your final JSON already encodes one coherent analysis\./i);
  assert.match(proPrompt, /Include one binding of kind "chain" for each encoded movement chain/i);
  assert.match(proPrompt, /If a chain undergoes more than one move, the corresponding chain note must describe the full path from base position through any intermediate landing to the final landing/i);
  assert.match(proPrompt, /compare noteBindings against the encoded move-like frames and make sure no encoded chain is omitted from the Notes/i);
  assert.match(proPrompt, /Favor structural clarity and explicit derivational truth over unnecessary bookkeeping/i);
  assert.match(proPrompt, /Even the simplest finite clause must continue until the derivation reaches a full committed clause, not stop after building one phrase/i);
  assert.match(prompt, /Even a simple finite clause must continue until the derivation reaches a full committed clause, not stop after building one phrase/i);
});

test('buildNotesSecondPassPrompt preserves first-pass decision context without re-opening syntax', () => {
  const prompt = buildNotesSecondPassPrompt(
    'Which violin did Nora borrow?',
    'xbar',
    {
      growthFrames: [{ frameId: 'f1', stepId: 's1', operation: 'SpellOut', workspaceForest: [] }],
      chains: [{ chainId: 'ch_wh', type: 'AbarMove' }],
      caseAssignments: [{ assignmentId: 'case_subj' }],
      selectionLedger: [{ selectionId: 'sel_v_obj' }],
      researchTrace: [
        {
          decisionId: 'rt_wh',
          stage: 'clause-typing',
          commitment: 'Treat the clause as a wh-question with object fronting.'
        }
      ],
      noteBindings: [
        { kind: 'architecture', text: 'Old note that should not be copied through.' }
      ]
    }
  );

  assert.match(prompt, /The syntax analysis .* is already frozen/i);
  assert.match(prompt, /Return raw JSON only\./i);
  assert.match(prompt, /Do not wrap the JSON in markdown or code fences\./i);
  assert.match(prompt, /Do not prepend or append any prose, labels, commentary, or explanatory text\./i);
  assert.match(prompt, /Return exactly one JSON object of the form \{"noteBindings":\[\.\.\.\]\}/i);
  assert.match(prompt, /If researchTrace is present below, treat it as preserved first-pass decision context/i);
  assert.match(prompt, /summarize that preserved reasoning in one or two noteBindings/i);
  assert.match(prompt, /Self-audit each note before returning it/i);
  assert.match(prompt, /case language requires caseAssignmentIds/i);
  assert.match(prompt, /movement language belongs in chain notes and those notes must carry chainId plus stepIds and\/or nodeIds/i);
  assert.match(prompt, /Support is note-local, not global/i);
  assert.match(prompt, /Architecture notes should stay structural/i);
  assert.doesNotMatch(prompt, /Old note that should not be copied through/i);
  assert.match(prompt, /"supportInventory":\{"chains":\[\{"chainId":"ch_wh"/i);
  assert.match(prompt, /"caseAssignmentIds":\["case_subj"\]/i);
  assert.match(prompt, /"selectionIds":\["sel_v_obj"\]/i);
  assert.match(prompt, /"researchTrace":\[\{"decisionId":"rt_wh"/i);
  assert.doesNotMatch(prompt, /"agreementLedger":\[\]/i);
  assert.doesNotMatch(prompt, /"bindingLedger":\[\]/i);
  assert.doesNotMatch(prompt, /"predicateClassLedger":\[\]/i);
  assert.doesNotMatch(prompt, /"nullElementLedger":\[\]/i);
});

test('summarizeGeneration preserves provider thought summaries separately from JSON text', () => {
  const meta = summarizeGeneration({
    text: '{"analyses":[]}',
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          parts: [
            { thought: true, text: 'The clause is treated as a wh-question because the object is clause-initial.' },
            { thought: true, text: 'Head movement places the auxiliary in C for the committed analysis.' },
            { text: '{"analyses":[]}' }
          ]
        }
      }
    ],
    usageMetadata: {
      promptTokenCount: 123,
      candidatesTokenCount: 45,
      totalTokenCount: 168,
      thoughtsTokenCount: 77
    }
  });

  assert.equal(meta.rawText, '{"analyses":[]}');
  assert.equal(meta.finishReason, 'STOP');
  assert.match(meta.providerReasoningRaw || '', /wh-question/i);
  assert.match(meta.providerReasoningRaw || '', /auxiliary in C/i);
  assert.match(meta.providerReasoningSummary || '', /wh-question/i);
  assert.ok((meta.providerReasoningSummary || '').length <= (meta.providerReasoningRaw || '').length);
  assert.equal(meta.promptTokenCount, 123);
  assert.equal(meta.outputTokenCount, 45);
  assert.equal(meta.totalTokenCount, 168);
  assert.equal(meta.thoughtsTokenCount, 77);
});

test('summarizeProviderReasoningForDisplay prefers decision cues over first-person setup prose', () => {
  const summary = summarizeProviderReasoningForDisplay(
    '**Analysis of the Portuguese Wh-Question:** Okay, here\'s how I\'m thinking about this sentence. ' +
    'I immediately recognize it as a wh-question. ' +
    'The verb "comprou" presents an interesting challenge because Portuguese subject inversion requires V-to-Infl-to-C movement. ' +
    'The standard analysis therefore moves the wh-phrase to Spec,CP rather than leaving it in object position.'
  );

  assert.doesNotMatch(summary, /here's how i'm thinking/i);
  assert.match(summary, /challenge because Portuguese subject inversion requires V-to-Infl-to-C movement/i);
  assert.match(summary, /moves the wh-phrase to Spec,CP rather than leaving it in object position/i);
});

test('summarizeProviderReasoningForDisplay rejects serialized analysis JSON blobs', () => {
  const summary = summarizeProviderReasoningForDisplay(
    '{"analyses":[{"growthFrames":[{"stepId":"f1","workspaceForest":[{"id":"cp","label":"CP"}]}]}]}'
  );

  assert.equal(summary, '');
});

test('normalizeGrowthFrames strips raw trace indices and materializes empty structural leaves in Growth', () => {
  const frames = normalizeGrowthFrames([
    {
      frameId: 'f1',
      stepId: 's1',
      operation: 'Project',
      workspaceForest: [
        {
          id: 'inflp',
          label: 'InflP',
          children: [
            { id: 'infl', label: 'Infl' },
            {
              id: 'vp',
              label: 'VP',
              children: [
                { id: 'trace_raw', label: 't_k' },
                { id: 'light_v', label: 'v' }
              ]
            }
          ]
        }
      ]
    }
  ], 'minimalism', ['which', 'article']);

  assert.equal(frames.length, 1);
  const workspaceRoot = frames[0].workspaceForest[0];
  const infl = workspaceRoot.children[0];
  const trace = workspaceRoot.children[1].children[0];
  const lightV = workspaceRoot.children[1].children[1];

  assert.equal(trace.label, 't');
  assert.deepEqual(infl.children, [{ label: '∅', id: 'null_infl', children: [] }]);
  assert.deepEqual(lightV.children, [{ label: '∅', id: 'null_light_v', children: [] }]);
});

test('resolveRouteMaxOutputTokens keeps Pro at the full route budget while Flash Lite stays capped', () => {
  const simple = 'Which pig did the farmer eat?';
  const embedded = 'Which book did Mary say John bought?';
  const simpleBudget = estimateProOutputBudget(simple);
  const embeddedBudget = estimateProOutputBudget(embedded);

  assert.equal(resolveRouteMaxOutputTokens('flash-lite', simple), 16384);
  assert.equal(simpleBudget, 65536);
  assert.equal(embeddedBudget, 65536);
  assert.equal(resolveRouteMaxOutputTokens('pro', simple), simpleBudget);
  assert.equal(resolveRouteMaxOutputTokens('pro', embedded), embeddedBudget);
});

test('normalizeParseBundle rejects underfilled pro growth bundles before normalization', () => {
  const sentence = 'The farmer ate the pig';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            stepId: 'g1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'dp_root',
                label: 'DP',
                children: [
                  {
                    id: 'dbar',
                    label: "D'",
                    children: [
                      {
                        id: 'd_head',
                        label: 'D',
                        children: [
                          { id: 'd_leaf', label: 'the', word: 'the', tokenIndex: 2 }
                        ]
                      },
                      {
                        id: 'np',
                        label: 'NP',
                        children: [
                          {
                            id: 'nbar',
                            label: "N'",
                            children: [
                              {
                                id: 'n_head',
                                label: 'N',
                                children: [
                                  { id: 'n_leaf', label: 'pig', word: 'pig', tokenIndex: 3 }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'The clause projects a finite CP.' },
          { kind: 'chain', text: 'The subject later raises to Spec,InflP.', chainId: 'c1' }
        ]
      }
    ]
  };

  assert.throws(
    () => normalizeParseBundle(payload, 'xbar', sentence, 'pro', true),
    (error) => {
      assert.ok(error instanceof ParseApiError);
      assert.equal(error.code, 'BAD_MODEL_RESPONSE');
      assert.match(error.message, /Pro analysis must include at least 3 growthFrames/i);
      return true;
    }
  );
});

test('normalizeParseBundle accepts transport-safe stringified workspace forests and ledger entries on pro', () => {
  const sentence = 'The farmer ate the pig';
  const finalTree = {
    id: 'cp',
    label: 'CP',
    children: [
      {
        id: 'cbar',
        label: "C'",
        children: [
          { id: 'c', label: 'C', word: '∅' },
          {
            id: 'inflp',
            label: 'InflP',
            children: [
              {
                id: 'subj',
                label: 'DP',
                children: [
                  {
                    id: 'subj_bar',
                    label: "D'",
                    children: [
                      { id: 'subj_d', label: 'D', word: 'The', tokenIndex: 0 },
                      {
                        id: 'subj_np',
                        label: 'NP',
                        children: [
                          {
                            id: 'subj_nbar',
                            label: "N'",
                            children: [{ id: 'subj_n', label: 'N', word: 'farmer', tokenIndex: 1 }]
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              {
                id: 'infl_bar',
                label: "Infl'",
                children: [
                  { id: 'infl', label: 'Infl', word: '∅' },
                  {
                    id: 'vp',
                    label: 'VP',
                    children: [
                      {
                        id: 'vbar',
                        label: "V'",
                        children: [
                          { id: 'v', label: 'V', word: 'ate', tokenIndex: 2 },
                          {
                            id: 'obj',
                            label: 'DP',
                            children: [
                              {
                                id: 'obj_bar',
                                label: "D'",
                                children: [
                                  { id: 'obj_d', label: 'D', word: 'the', tokenIndex: 3 },
                                  {
                                    id: 'obj_np',
                                    label: 'NP',
                                    children: [
                                      {
                                        id: 'obj_nbar',
                                        label: "N'",
                                        children: [{ id: 'obj_n', label: 'N', word: 'pig', tokenIndex: 4 }]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 'g1',
            operation: 'Project',
            workspaceForestJson: JSON.stringify([finalTree])
          },
          {
            frameId: 'f2',
            stepId: 'g2',
            operation: 'Agree',
            reusePreviousWorkspace: true,
            featureChecking: [
              { feature: 'case', value: 'Nominative', goalLabel: 'The farmer', probeLabel: 'Infl' }
            ]
          },
          {
            frameId: 'f3',
            stepId: 'g3',
            operation: 'SpellOut',
            workspaceForestJson: JSON.stringify([finalTree]),
            spelloutOrder: ['The', 'farmer', 'ate', 'the', 'pig']
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'The clause projects as a CP dominating an InflP.', stepIds: ['g1'], nodeIds: ['cp'] },
          { kind: 'licensing', text: 'The subject receives Nominative case from Infl.', stepIds: ['g2'], supportIds: ['case_1'] }
        ],
        caseAssignments: [
          JSON.stringify({
            assigneeLabel: 'The farmer',
            case: 'Nominative',
            assigner: 'Infl'
          })
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro', true);
  const analysis = normalized.analyses[0];
  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.equal(analysis.growthFrames?.length, 3);
  assert.equal(analysis.caseAssignments?.[0]?.case, 'Nominative');
  assert.deepEqual(analysis.surfaceOrder, ['The', 'farmer', 'ate', 'the', 'pig']);
});

test('normalizeParseBundle accepts direct structured workspaceForest arrays and direct ledger objects on pro', () => {
  const sentence = 'The farmer ate the pig';
  const finalTree = {
    id: 'cp',
    label: 'CP',
    children: [
      {
        id: 'cbar',
        label: "C'",
        children: [
          { id: 'c', label: 'C', word: '∅' },
          {
            id: 'inflp',
            label: 'InflP',
            children: [
              {
                id: 'subj',
                label: 'DP',
                children: [
                  {
                    id: 'subj_bar',
                    label: "D'",
                    children: [
                      { id: 'subj_d', label: 'D', word: 'The', tokenIndex: 0 },
                      {
                        id: 'subj_np',
                        label: 'NP',
                        children: [
                          {
                            id: 'subj_nbar',
                            label: "N'",
                            children: [{ id: 'subj_n', label: 'N', word: 'farmer', tokenIndex: 1 }]
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              {
                id: 'infl_bar',
                label: "Infl'",
                children: [
                  { id: 'infl', label: 'Infl', word: '∅' },
                  {
                    id: 'vp',
                    label: 'VP',
                    children: [
                      {
                        id: 'vbar',
                        label: "V'",
                        children: [
                          { id: 'v', label: 'V', word: 'ate', tokenIndex: 2 },
                          {
                            id: 'obj',
                            label: 'DP',
                            children: [
                              {
                                id: 'obj_bar',
                                label: "D'",
                                children: [
                                  { id: 'obj_d', label: 'D', word: 'the', tokenIndex: 3 },
                                  {
                                    id: 'obj_np',
                                    label: 'NP',
                                    children: [
                                      {
                                        id: 'obj_nbar',
                                        label: "N'",
                                        children: [{ id: 'obj_n', label: 'N', word: 'pig', tokenIndex: 4 }]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 'g1',
            operation: 'Project',
            workspaceForest: [finalTree]
          },
          {
            frameId: 'f2',
            stepId: 'g2',
            operation: 'Agree',
            reusePreviousWorkspace: true,
            featureChecking: [
              { feature: 'case', value: 'Nominative', goalLabel: 'The farmer', probeLabel: 'Infl' }
            ]
          },
          {
            frameId: 'f3',
            stepId: 'g3',
            operation: 'SpellOut',
            workspaceForest: [finalTree],
            spelloutOrder: ['The', 'farmer', 'ate', 'the', 'pig']
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'The clause projects as a CP dominating an InflP.', stepIds: ['g1'], nodeIds: ['cp'] },
          { kind: 'licensing', text: 'The subject receives Nominative case from Infl.', stepIds: ['g2'], caseAssignmentIds: ['case_a'] }
        ],
        caseAssignments: [
          {
            assignmentId: 'case_a',
            assigneeLabel: 'The farmer',
            case: 'Nominative',
            assigner: 'Infl',
            stepIds: ['g2']
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro', true);
  const analysis = normalized.analyses[0];
  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.equal(analysis.growthFrames?.length, 3);
  assert.equal(analysis.caseAssignments?.[0]?.assignmentId, 'case_a');
  assert.equal(analysis.caseAssignments?.[0]?.case, 'Nominative');
  assert.deepEqual(analysis.surfaceOrder, ['The', 'farmer', 'ate', 'the', 'pig']);
});

test('normalizeParseBundle preserves microOperations on growthFrames for compressed but honest replay steps', () => {
  const sentence = 'The farmer ate the pig';
  const finalTree = {
    id: 'cp',
    label: 'CP',
    children: [
      {
        id: 'cbar',
        label: "C'",
        children: [
          { id: 'c', label: 'C', children: [{ id: 'c-null', label: '∅' }] },
          {
            id: 'inflp',
            label: 'InflP',
            children: [
              {
                id: 'subj',
                label: 'DP',
                children: [
                  {
                    id: 'subj-bar',
                    label: "D'",
                    children: [
                      { id: 'subj-d', label: 'D', children: [{ id: 'tok0', label: 'The', word: 'The', tokenIndex: 0 }] },
                      {
                        id: 'subj-np',
                        label: 'NP',
                        children: [
                          { id: 'subj-nbar', label: "N'", children: [{ id: 'tok1', label: 'farmer', word: 'farmer', tokenIndex: 1 }] }
                        ]
                      }
                    ]
                  }
                ]
              },
              {
                id: 'inflbar',
                label: "Infl'",
                children: [
                  { id: 'infl', label: 'Infl', children: [{ id: 'infl-null', label: '∅' }] },
                  {
                    id: 'vp',
                    label: 'VP',
                    children: [
                      {
                        id: 'vbar',
                        label: "V'",
                        children: [
                          { id: 'v', label: 'V', children: [{ id: 'tok2', label: 'ate', word: 'ate', tokenIndex: 2 }] },
                          {
                            id: 'obj',
                            label: 'DP',
                            children: [
                              {
                                id: 'obj-bar',
                                label: "D'",
                                children: [
                                  { id: 'obj-d', label: 'D', children: [{ id: 'tok3', label: 'the', word: 'the', tokenIndex: 3 }] },
                                  {
                                    id: 'obj-np',
                                    label: 'NP',
                                    children: [
                                      { id: 'obj-nbar', label: "N'", children: [{ id: 'tok4', label: 'pig', word: 'pig', tokenIndex: 4 }] }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'ExternalMerge',
            microOperations: ['LexicalSelect', 'Project', 'ExternalMerge'],
            workspaceForestJson: JSON.stringify([finalTree])
          },
          {
            frameId: 'f2',
            stepId: 's2',
            operation: 'Project',
            reusePreviousWorkspace: true
          },
          {
            frameId: 'f3',
            stepId: 's3',
            operation: 'SpellOut',
            workspaceForestJson: JSON.stringify([finalTree]),
            spelloutOrder: ['The', 'farmer', 'ate', 'the', 'pig']
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'A finite clause with overt subject and object.' }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro', true);
  const analysis = normalized.analyses[0];
  assert.deepEqual(analysis.growthFrames?.[0]?.microOperations, ['LexicalSelect', 'Project', 'ExternalMerge']);
});

test('normalizeParseBundle rejects workspaceForestJson strings with trailing transport junk', () => {
  const sentence = 'Den Mann hat die Frau gesehen.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'Project',
            workspaceForestJson: `[{"id":"vp","label":"VP","children":[{"id":"dp_subj","label":"DP","children":[{"id":"die","label":"die","word":"die","tokenIndex":3},{"id":"frau","label":"Frau","word":"Frau","tokenIndex":4}]},{"id":"vbar","label":"V'","children":[{"id":"dp_obj","label":"DP","children":[{"id":"den","label":"Den","word":"Den","tokenIndex":0},{"id":"mann","label":"Mann","word":"Mann","tokenIndex":1}]},{"id":"v_seen","label":"V","children":[{"id":"gesehen","label":"gesehen","word":"gesehen","tokenIndex":5}]}]}]}]`
          },
          {
            frameId: 'f2',
            stepId: 's2',
            operation: 'HeadMove',
            chainId: 'chain_head',
            movement: {
              operation: 'HeadMove',
              sourceNodeId: 'infl_hat',
              targetNodeId: 'infl_hat_copy'
            },
            workspaceForestJson: `[{"id":"cp","label":"CP","children":[{"id":"dp_topic","label":"DP","children":[{"id":"den_top","label":"Den","word":"Den","tokenIndex":0},{"id":"mann_top","label":"Mann","word":"Mann","tokenIndex":1}]},{"id":"cbar","label":"C'","children":[{"id":"c_head","label":"C","children":[{"id":"infl_hat_copy","label":"Infl","children":[{"id":"hat","label":"hat","word":"hat","tokenIndex":2}]}]},{"id":"inflp","label":"InflP","children":[{"id":"dp_subj_top","label":"DP","children":[{"id":"die_top","label":"die","word":"die","tokenIndex":3},{"id":"frau_top","label":"Frau","word":"Frau","tokenIndex":4}]},{"id":"inflbar","label":"Infl'","children":[{"id":"vp_top","label":"VP","children":[{"id":"dp_subj_trace","label":"DP","children":[{"id":"t_subj","label":"t_subj"}]},{"id":"vbar_top","label":"V'","children":[{"id":"dp_obj_trace","label":"DP","children":[{"id":"t_obj","label":"t_obj"}]},{"id":"v_seen_top","label":"V","children":[{"id":"gesehen_top","label":"gesehen","word":"gesehen","tokenIndex":5}]}]}]},{"id":"infl_hat","label":"Infl","children":[{"id":"t_hat","label":"t_hat"}]}]}]}]}]}]]`
          },
          {
            frameId: 'f3',
            stepId: 's3',
            operation: 'SpellOut',
            reusePreviousWorkspace: true
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'German V2 with object topicalization and head movement.', stepIds: ['s2'], supportIds: ['lin_v2', 'sel_c'] }
        ],
        caseAssignments: [
          { assignmentId: 'case_nom', nodeId: 'dp_subj_top', case: 'Nominative', assigner: 'Infl' },
          { assignmentId: 'case_acc', nodeId: 'dp_topic', case: 'Accusative', assigner: 'V' }
        ],
        argumentStructure: [
          { argumentId: 'arg_subj', nodeId: 'dp_subj_top', role: 'Agent', predicate: 'gesehen' },
          { argumentId: 'arg_obj', nodeId: 'dp_topic', role: 'Theme', predicate: 'gesehen' }
        ],
        linearizationLedger: [
          {
            linearizationId: 'lin_v2',
            order: ['Den', 'Mann', 'hat', 'die', 'Frau', 'gesehen'],
            mechanism: 'object-topicalization plus head movement',
            effect: 'V2 surface order'
          }
        ],
        selectionLedger: [
          { selectionId: 'sel_c', selectorHead: 'C', selectedCategory: 'InflP', complementNodeId: 'inflp' }
        ]
      }
    ]
  };

  assert.throws(
    () => normalizeParseBundle(payload, 'xbar', sentence, 'pro', true),
    (error) =>
      error instanceof ParseApiError
      && error.code === 'BAD_MODEL_RESPONSE'
  );
});

test('normalizeParseBundle accepts transport-safe case ledgers that use value as the case field', () => {
  const sentence = 'Which pig did the farmer eat?';
  const finalTree = {
    id: 'CP',
    label: 'CP',
    children: [
      {
        id: 'dp_obj_land',
        label: 'DP',
        children: [
          {
            id: 'dbar_obj_land',
            label: "D'",
            children: [
              { id: 'd_obj_land', label: 'D', children: [{ id: 'tok0', label: 'Which', word: 'Which', tokenIndex: 0 }] },
              { id: 'np_obj_land', label: 'NP', children: [{ id: 'nbar_obj_land', label: "N'", children: [{ id: 'n_obj_land', label: 'N', children: [{ id: 'tok1', label: 'pig', word: 'pig', tokenIndex: 1 }] }] }] }
            ]
          }
        ]
      },
      {
        id: 'cbar',
        label: "C'",
        children: [
          { id: 'c_head', label: 'C', children: [{ id: 'tok2', label: 'did', word: 'did', tokenIndex: 2 }] },
          {
            id: 'inflp',
            label: 'InflP',
            children: [
              {
                id: 'dp_subj_land',
                label: 'DP',
                children: [
                  {
                    id: 'dbar_subj_land',
                    label: "D'",
                    children: [
                      { id: 'd_subj_land', label: 'D', children: [{ id: 'tok3', label: 'the', word: 'the', tokenIndex: 3 }] },
                      { id: 'np_subj_land', label: 'NP', children: [{ id: 'nbar_subj_land', label: "N'", children: [{ id: 'n_subj_land', label: 'N', children: [{ id: 'tok4', label: 'farmer', word: 'farmer', tokenIndex: 4 }] }] }] }
                    ]
                  }
                ]
              },
              {
                id: 'inflbar',
                label: "Infl'",
                children: [
                  { id: 'infl_trace', label: 'Infl', children: [{ id: 'infl_trace_leaf', label: 't₂', word: 't₂' }] },
                  {
                    id: 'vp',
                    label: 'VP',
                    children: [
                      { id: 'subj_trace', label: 'DP', children: [{ id: 'subj_trace_leaf', label: 't₁', word: 't₁' }] },
                      {
                        id: 'vbar',
                        label: "V'",
                        children: [
                          { id: 'v_head', label: 'V', children: [{ id: 'tok5', label: 'eat', word: 'eat', tokenIndex: 5 }] },
                          { id: 'obj_trace', label: 'DP', children: [{ id: 'obj_trace_leaf', label: 't₃', word: 't₃' }] }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'Project',
            workspaceForestJson: JSON.stringify([finalTree])
          },
          {
            frameId: 'f2',
            stepId: 's2',
            operation: 'Agree',
            workspaceForestJson: JSON.stringify([finalTree]),
            featureChecking: [
              { feature: 'case', value: 'Nominative', goalLabel: 'DP (the farmer)', probeLabel: 'Infl (did)' },
              { feature: 'case', value: 'Accusative', goalLabel: 'DP (Which pig)', probeLabel: 'V (eat)' }
            ]
          },
          {
            frameId: 'f3',
            stepId: 's3',
            operation: 'SpellOut',
            workspaceForestJson: JSON.stringify([finalTree]),
            spelloutOrder: ['Which', 'pig', 'did', 'the', 'farmer', 'eat']
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'The clause projects as a finite interrogative CP.', stepIds: ['s3'], nodeIds: ['CP'] },
          { kind: 'chain', text: 'The subject receives Nominative case from Infl and the wh-phrase receives Accusative case from V.', stepIds: ['s2'], supportIds: ['case_nom', 'case_acc'] }
        ],
        caseAssignments: [
          JSON.stringify({
            id: 'case_nom',
            assigneeLabel: 'DP (the farmer)',
            assignerLabel: 'Infl (did)',
            value: 'Nominative'
          }),
          JSON.stringify({
            id: 'case_acc',
            assigneeLabel: 'DP (Which pig)',
            assignerLabel: 'V (eat)',
            value: 'Accusative'
          })
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro', true);
  const analysis = normalized.analyses[0];
  assert.equal(analysis.caseAssignments.length, 2);
  assert.equal(analysis.caseAssignments[0].case, 'Nominative');
  assert.equal(analysis.caseAssignments[1].case, 'Accusative');
});

test('buildCanonicalDerivationFromGrowthFrames promotes committed growth tree without frame-local movement bookkeeping', () => {
  const sentence = 'The farmer ate the pig';
  const tokens = tokenizeSentenceSurfaceOrder(sentence);
  const growthFrames = [
    {
      frameId: 'f1',
      operation: 'ExternalMerge',
      workspaceForest: [
        {
          id: 'infl_bar_gf',
          label: 'InflP',
          children: [
            {
              id: 'subj_low',
              label: 'DP',
              children: [
                {
                  id: 'subj_low_bar',
                  label: "D'",
                  children: [
                    { id: 'subj_low_d', label: 'D', word: 'The' },
                    {
                      id: 'subj_low_np',
                      label: 'NP',
                      children: [
                        {
                          id: 'subj_low_nbar',
                          label: "N'",
                          children: [{ id: 'subj_low_n', label: 'N', word: 'farmer' }]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              id: 'vp_low',
              label: 'VP',
              children: [
                {
                  id: 'vbar_low',
                  label: "V'",
                  children: [
                    { id: 'v_low', label: 'V', word: 'ate' },
                    {
                      id: 'obj_low',
                      label: 'DP',
                      children: [
                        {
                          id: 'obj_low_bar',
                          label: "D'",
                          children: [
                            { id: 'obj_low_d', label: 'D', word: 'the' },
                            {
                              id: 'obj_low_np',
                              label: 'NP',
                              children: [
                                {
                                  id: 'obj_low_nbar',
                                  label: "N'",
                                  children: [{ id: 'obj_low_n', label: 'N', word: 'pig' }]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      frameId: 'f2',
      operation: 'Move',
      workspaceForest: [
        {
          id: 'cp',
          label: 'CP',
          children: [
            {
              id: 'cbar',
              label: "C'",
              children: [
                { id: 'c', label: 'C', word: '∅' },
                {
                  id: 'inflp',
                  label: 'InflP',
                  children: [
                    {
                      id: 'subj_high',
                      label: 'DP',
                      children: [
                        {
                          id: 'subj_high_bar',
                          label: "D'",
                          children: [
                            { id: 'subj_high_d', label: 'D', word: 'The' },
                            {
                              id: 'subj_high_np',
                              label: 'NP',
                              children: [
                                {
                                  id: 'subj_high_nbar',
                                  label: "N'",
                                  children: [{ id: 'subj_high_n', label: 'N', word: 'farmer' }]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    },
                    {
                      id: 'inflbar',
                      label: "Infl'",
                      children: [
                        { id: 'infl', label: 'Infl', word: '∅' },
                        {
                          id: 'vp',
                          label: 'VP',
                          children: [
                            {
                              id: 'trace_subj',
                              label: 'DP',
                              children: [{ id: 'trace_subj_d', label: 'D', word: 't_1' }]
                            },
                            {
                              id: 'vbar',
                              label: "V'",
                              children: [
                                { id: 'v', label: 'V', word: 'ate' },
                                {
                                  id: 'obj',
                                  label: 'DP',
                                  children: [
                                    {
                                      id: 'obj_bar',
                                      label: "D'",
                                      children: [
                                        { id: 'obj_d', label: 'D', word: 'the' },
                                        {
                                          id: 'obj_np',
                                          label: 'NP',
                                          children: [
                                            {
                                              id: 'obj_nbar',
                                              label: "N'",
                                              children: [{ id: 'obj_n', label: 'N', word: 'pig' }]
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const bundle = buildCanonicalDerivationFromGrowthFrames(growthFrames, tokens, 'xbar');
  assert.ok(bundle);
  assert.equal(bundle.tree?.label, 'CP');
  assert.deepEqual(bundle.surfaceOrder, ['The', 'farmer', 'ate', 'the', 'pig']);
  assert.equal(bundle.movementEvents.length, 1);
  assert.equal(bundle.movementEvents[0].operation, 'Move');
  assert.equal(bundle.derivationSteps.at(-1)?.operation, 'SpellOut');
});

test('buildCanonicalMovementEventsFromGrowthFrames matches numbered copy and trace ids within one movement chain', () => {
  const growthFrames = [
    {
      stepId: 'g1',
      operation: 'ExternalMerge',
      workspaceForest: [
        {
          id: 'cp1',
          label: 'CP',
          children: [
            { id: 'dp_who_copy1', label: 'DP', children: [{ id: 'w0', label: 'Who', word: 'Who' }] },
            {
              id: 'cbar1',
              label: "C'",
              children: [
                { id: 'c_did', label: 'C', children: [{ id: 'w1', label: 'did', word: 'did' }] },
                {
                  id: 'inflp1',
                  label: 'InflP',
                  children: [
                    { id: 'dp_mary_copy1', label: 'DP', children: [{ id: 'w2', label: 'Mary', word: 'Mary' }] },
                    {
                      id: 'inflbar1',
                      label: "Infl'",
                      children: [
                        { id: 'infl_trace', label: 'Infl', children: [{ id: 'null1', label: '∅', word: '∅' }] },
                        {
                          id: 'vp1',
                          label: 'VP',
                          children: [
                            { id: 'v_think', label: 'V', children: [{ id: 'w3', label: 'think', word: 'think' }] },
                            {
                              id: 'cp2',
                              label: 'CP',
                              children: [
                                { id: 'dp_who_copy2', label: 'DP', children: [{ id: 'w0b', label: 'Who', word: 'Who' }] },
                                {
                                  id: 'cbar2',
                                  label: "C'",
                                  children: [
                                    { id: 'c_null2', label: 'C', children: [{ id: 'null2', label: '∅', word: '∅' }] },
                                    {
                                      id: 'inflp2',
                                      label: 'InflP',
                                      children: [
                                        { id: 'dp_who_copy1_inner', label: 'DP', children: [{ id: 'w0c', label: 'Who', word: 'Who' }] },
                                        {
                                          id: 'inflbar2',
                                          label: "Infl'",
                                          children: [
                                            { id: 'infl_null2', label: 'Infl', children: [{ id: 'null3', label: '∅', word: '∅' }] },
                                            {
                                              id: 'vp2',
                                              label: 'VP',
                                              children: [
                                                { id: 'dp_mary_trace1', label: 'DP', children: [{ id: 'trace_mary_1', label: 't₂', word: 't₂' }] },
                                                { id: 'v_left', label: 'V', children: [{ id: 'w4', label: 'left?' }] }
                                              ]
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      stepId: 'g2',
      operation: 'AbarMove',
      chainId: 'chain_who',
      movement: {
        operation: 'AbarMove',
        sourceNodeId: 'dp_who_copy2',
        targetNodeId: 'dp_who_copy3',
        note: 'Wh phrase moves from embedded clause edge to matrix Spec,CP.'
      },
      affectedNodeIds: ['dp_who_copy2', 'dp_who_copy3', 'dp_who_trace2'],
      workspaceForest: [
        {
          id: 'cp1',
          label: 'CP',
          children: [
            { id: 'dp_who_copy3', label: 'DP', children: [{ id: 'w0', label: 'Who', word: 'Who' }] },
            {
              id: 'cbar1',
              label: "C'",
              children: [
                { id: 'c_did', label: 'C', children: [{ id: 'w1', label: 'did', word: 'did' }] },
                {
                  id: 'inflp1',
                  label: 'InflP',
                  children: [
                    { id: 'dp_mary_copy1', label: 'DP', children: [{ id: 'w2', label: 'Mary', word: 'Mary' }] },
                    {
                      id: 'inflbar1',
                      label: "Infl'",
                      children: [
                        { id: 'infl_trace', label: 'Infl', children: [{ id: 'null1', label: '∅', word: '∅' }] },
                        {
                          id: 'vp1',
                          label: 'VP',
                          children: [
                            { id: 'v_think', label: 'V', children: [{ id: 'w3', label: 'think', word: 'think' }] },
                            {
                              id: 'cp2',
                              label: 'CP',
                              children: [
                                { id: 'dp_who_trace2', label: 'DP', children: [{ id: 'trace_who_2', label: 't₁', word: 't₁' }] },
                                {
                                  id: 'cbar2',
                                  label: "C'",
                                  children: [
                                    { id: 'c_null2', label: 'C', children: [{ id: 'null2', label: '∅', word: '∅' }] },
                                    {
                                      id: 'inflp2',
                                      label: 'InflP',
                                      children: [
                                        { id: 'dp_who_trace1', label: 'DP', children: [{ id: 'trace_who_1', label: 't₁', word: 't₁' }] },
                                        {
                                          id: 'inflbar2',
                                          label: "Infl'",
                                          children: [
                                            { id: 'infl_null2', label: 'Infl', children: [{ id: 'null3', label: '∅', word: '∅' }] },
                                            {
                                              id: 'vp2',
                                              label: 'VP',
                                              children: [
                                                { id: 'dp_mary_trace1', label: 'DP', children: [{ id: 'trace_mary_1', label: 't₂', word: 't₂' }] },
                                                { id: 'v_left', label: 'V', children: [{ id: 'w4', label: 'left?' }] }
                                              ]
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const finalTree = growthFrames[1].workspaceForest[0];
  const movementEvents = buildCanonicalMovementEventsFromGrowthFrames(growthFrames, finalTree);
  const finalMove = movementEvents.find((event) =>
    event.operation === 'AbarMove' && event.toNodeId === 'dp_who_copy3'
  );

  assert.ok(finalMove);
  assert.equal(finalMove.fromNodeId, 'dp_who_trace2');
  assert.equal(finalMove.traceNodeId, 'dp_who_trace2');
});

test('buildCanonicalDerivationFromGrowthFrames supplements head movement from the committed Growth state when Lite compresses it into a final frame', () => {
  const sentence = 'Which pig did Mary eat';
  const tokens = tokenizeSentenceSurfaceOrder(sentence);
  const growthFrames = [
    {
      frameId: 'f1',
      operation: 'ExternalMerge',
      workspaceForest: [
        {
          id: 'inflp_low',
          label: 'InflP',
          children: [
            {
              id: 'mary_high',
              label: 'DP',
              children: [
                {
                  id: 'mary_bar',
                  label: "D'",
                  children: [{ id: 'mary_d', label: 'D', word: 'Mary' }]
                }
              ]
            },
            {
              id: 'inflbar_low',
              label: "Infl'",
              children: [
                { id: 'infl_did_low', label: 'Infl', children: [{ id: 'did_low_leaf', label: 'did', word: 'did' }] },
                {
                  id: 'vp_low',
                  label: 'VP',
                  children: [
                    { id: 'v_eat', label: 'V', children: [{ id: 'eat_leaf', label: 'eat', word: 'eat' }] },
                    {
                      id: 'obj_low',
                      label: 'DP',
                      children: [
                        {
                          id: 'obj_low_bar',
                          label: "D'",
                          children: [
                            { id: 'obj_low_d', label: 'D', word: 'Which' },
                            {
                              id: 'obj_low_np',
                              label: 'NP',
                              children: [
                                {
                                  id: 'obj_low_nbar',
                                  label: "N'",
                                  children: [{ id: 'obj_low_n', label: 'N', word: 'pig' }]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      frameId: 'f2',
      operation: 'AbarMove',
      chainId: 'chain_wh',
      movement: {
        operation: 'AbarMove',
        sourceNodeId: 'obj_low',
        targetNodeId: 'obj_high',
        note: 'Wh phrase moves to matrix Spec,CP.'
      },
      workspaceForest: [
        {
          id: 'cp_root',
          label: 'CP',
          children: [
            {
              id: 'obj_high',
              label: 'DP',
              children: [
                {
                  id: 'obj_high_bar',
                  label: "D'",
                  children: [
                    { id: 'obj_high_d', label: 'D', word: 'Which' },
                    {
                      id: 'obj_high_np',
                      label: 'NP',
                      children: [
                        {
                          id: 'obj_high_nbar',
                          label: "N'",
                          children: [{ id: 'obj_high_n', label: 'N', word: 'pig' }]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              id: 'cbar_root',
              label: "C'",
              children: [
                { id: 'c_did', label: 'C', children: [{ id: 'c_did_leaf', label: 'did', word: 'did' }] },
                {
                  id: 'inflp_root',
                  label: 'InflP',
                  children: [
                    {
                      id: 'mary_root',
                      label: 'DP',
                      children: [
                        {
                          id: 'mary_root_bar',
                          label: "D'",
                          children: [{ id: 'mary_root_d', label: 'D', word: 'Mary' }]
                        }
                      ]
                    },
                    {
                      id: 'inflbar_root',
                      label: "Infl'",
                      children: [
                        { id: 'infl_trace_head', label: 'Infl', children: [{ id: 'infl_trace_leaf', label: 't₁', word: 't₁' }] },
                        {
                          id: 'vp_root',
                          label: 'VP',
                          children: [
                            { id: 'v_root', label: 'V', children: [{ id: 'eat_leaf_root', label: 'eat', word: 'eat' }] },
                            {
                              id: 'obj_trace',
                              label: 'DP',
                              children: [{ id: 'obj_trace_leaf', label: 't₂', word: 't₂' }]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const bundle = buildCanonicalDerivationFromGrowthFrames(growthFrames, tokens, 'xbar');
  assert.ok(bundle);
  assert.ok(bundle.movementEvents.some((event) =>
    event.operation === 'AbarMove'
    && event.toNodeId === 'obj_high'
  ));
  const headMove = bundle.movementEvents.find((event) =>
    event.operation === 'HeadMove' && event.toNodeId === 'c_did'
  );
  assert.ok(headMove);
  assert.equal(headMove.fromNodeId, 'infl_trace_head');
  assert.equal(headMove.traceNodeId, 'infl_trace_leaf');
});

test('buildCanonicalDerivationFromGrowthFrames tolerates compressed Lite raising frames with an untokened lower head copy', () => {
  const sentence = 'John seems to like Mary';
  const tokens = tokenizeSentenceSurfaceOrder(sentence);
  const growthFrames = [
    {
      frameId: 'f1',
      operation: 'A-Move',
      movement: {
        operation: 'A-Move',
        sourceNodeId: 'subj_lower',
        targetNodeId: 'subj_high'
      },
      workspaceForest: [
        {
          id: 'cp_root',
          label: 'CP',
          children: [
            {
              id: 'cbar_root',
              label: "C'",
              children: [
                { id: 'c_root', label: 'C', children: [{ id: 'c_null', label: '∅', word: '∅' }] },
                {
                  id: 'inflp_root',
                  label: 'InflP',
                  children: [
                    { id: 'subj_high', label: 'DP', children: [{ id: 'john_high', label: 'D', word: 'John', tokenIndex: 0 }] },
                    {
                      id: 'inflbar_root',
                      label: "Infl'",
                      children: [
                        { id: 'infl_head', label: 'Infl', children: [{ id: 'seems_high', label: 'seems', word: 'seems', tokenIndex: 1 }] },
                        {
                          id: 'vp_root',
                          label: 'VP',
                          children: [
                            {
                              id: 'vbar_root',
                              label: "V'",
                              children: [
                                { id: 'v_low', label: 'V', children: [{ id: 'seems_low', label: 'seems' }] },
                                {
                                  id: 'inflp_emb',
                                  label: 'InflP',
                                  children: [
                                    { id: 'subj_lower', label: 'DP', children: [{ id: 'trace_john', label: 't_1', word: 't_1' }] },
                                    {
                                      id: 'inflbar_emb',
                                      label: "Infl'",
                                      children: [
                                        { id: 'infl_to', label: 'Infl', children: [{ id: 'to_leaf', label: 'to', word: 'to', tokenIndex: 2 }] },
                                        {
                                          id: 'vp_emb',
                                          label: 'VP',
                                          children: [
                                            { id: 'v_like', label: 'V', children: [{ id: 'like_leaf', label: 'like', word: 'like', tokenIndex: 3 }] },
                                            { id: 'dp_mary', label: 'DP', children: [{ id: 'mary_leaf', label: 'D', word: 'Mary', tokenIndex: 4 }] }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const bundle = buildCanonicalDerivationFromGrowthFrames(growthFrames, tokens, 'xbar');

  assert.ok(bundle);
  assert.deepStrictEqual(bundle.surfaceOrder, ['John', 'seems', 'to', 'like', 'Mary']);
});

test('buildCanonicalMovementEventsFromGrowthFrames keeps a phrasal wh-move tied to the local object trace even when trace ids do not preserve the lexical stem', () => {
  const growthFrames = [
    {
      frameId: 'f1',
      operation: 'Project',
      workspaceForest: [
        {
          id: 'cp_before',
          label: 'CP',
          children: [
            {
              id: 'cbar_before',
              label: "C'",
              children: [
                {
                  id: 'c_did',
                  label: 'C',
                  word: 'did'
                },
                {
                  id: 'inflp_before',
                  label: 'InflP',
                  children: [
                    { id: 'dp_subj_high', label: 'DP', children: [{ id: 'dp_subj_high_leaf', label: 'D', word: 'the' }] },
                    {
                      id: 'inflbar_before',
                      label: "Infl'",
                      children: [
                        { id: 'infl_trace', label: 'Infl', word: 't_2' },
                        {
                          id: 'vp_before',
                          label: 'VP',
                          children: [
                            { id: 'n_t_subj', label: 'DP', word: 't_1' },
                            {
                              id: 'vbar_before',
                              label: "V'",
                              children: [
                                { id: 'v_eat', label: 'V', word: 'eat' },
                                {
                                  id: 'n_DP_which',
                                  label: 'DP',
                                  children: [
                                    {
                                      id: 'n_Dbar_which',
                                      label: "D'",
                                      children: [
                                        { id: 'n_D_which', label: 'D', word: 'Which' },
                                        {
                                          id: 'n_NP_pig',
                                          label: 'NP',
                                          children: [{ id: 'n_N_pig', label: 'N', word: 'pig' }]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      frameId: 'f2',
      operation: 'AbarMove',
      chainId: 'chain_wh',
      movement: {
        operation: 'AbarMove',
        sourceNodeId: 'n_DP_which',
        targetNodeId: 'n_DP_which_copy',
        note: 'The wh-phrase moves to Spec,CP.'
      },
      workspaceForest: [
        {
          id: 'n_CP',
          label: 'CP',
          children: [
            {
              id: 'n_DP_which_copy',
              label: 'DP',
              children: [
                {
                  id: 'n_Dbar_which_copy',
                  label: "D'",
                  children: [
                    { id: 'n_D_which_copy', label: 'D', word: 'Which' },
                    {
                      id: 'n_NP_pig_copy',
                      label: 'NP',
                      children: [{ id: 'n_N_pig_copy', label: 'N', word: 'pig' }]
                    }
                  ]
                }
              ]
            },
            {
              id: 'n_Cbar',
              label: "C'",
              children: [
                { id: 'n_C_did', label: 'C', word: 'did' },
                {
                  id: 'n_InflP',
                  label: 'InflP',
                  children: [
                    { id: 'n_DP_the_copy', label: 'DP', children: [{ id: 'n_D_the_copy', label: 'D', word: 'the' }] },
                    {
                      id: 'n_Inflbar',
                      label: "Infl'",
                      children: [
                        { id: 'n_t_did', label: 'Infl', word: 't_2' },
                        {
                          id: 'n_VP',
                          label: 'VP',
                          children: [
                            { id: 'n_t_subj', label: 'DP', word: 't_1' },
                            {
                              id: 'n_Vbar',
                              label: "V'",
                              children: [
                                { id: 'n_V', label: 'V', word: 'eat' },
                                { id: 'n_t_obj', label: 'DP', word: 't_3' }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const finalTree = growthFrames[1].workspaceForest[0];
  const movementEvents = buildCanonicalMovementEventsFromGrowthFrames(growthFrames, finalTree);
  const whMove = movementEvents.find((event) =>
    event.operation === 'AbarMove' && event.toNodeId === 'n_DP_which_copy'
  );

  assert.ok(whMove);
  assert.equal(whMove.fromNodeId, 'n_t_obj');
  assert.equal(whMove.traceNodeId, 'n_t_obj');
});

test('normalizeParseBundle accepts Lite self-targeting head-move placeholders when the final Growth state is still coherent', () => {
  const sentence = 'Which pig did Mary eat';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'frame_1',
            operation: 'ExternalMerge',
            workspaceForest: {
              nodeId: 'root',
              label: 'VP',
              children: [
                { nodeId: 'subj', label: 'DP', children: [{ nodeId: 'mary_leaf', label: 'Mary', tokenIndex: 3 }] },
                {
                  nodeId: 'vbar',
                  label: "V'",
                  children: [
                    { nodeId: 'v_head', label: 'V', children: [{ nodeId: 'eat_leaf', label: 'eat', tokenIndex: 4 }] },
                    {
                      nodeId: 'obj',
                      label: 'DP',
                      children: [
                        { nodeId: 'obj_d', label: 'D', children: [{ nodeId: 'which_leaf', label: 'Which', tokenIndex: 0 }] },
                        { nodeId: 'obj_n', label: 'N', children: [{ nodeId: 'pig_leaf', label: 'pig', tokenIndex: 1 }] }
                      ]
                    }
                  ]
                }
              ]
            }
          },
          {
            frameId: 'frame_2',
            operation: 'HeadMove',
            movement: {
              operation: 'HeadMove',
              sourceNodeId: 'infl_head',
              targetNodeId: 'infl_head',
              note: 'Compressed Lite placeholder for auxiliary placement.'
            },
            workspaceForest: {
              nodeId: 'inflp',
              label: 'InflP',
              children: [
                { nodeId: 'subj_high', label: 'DP', children: [{ nodeId: 'mary_high', label: 'Mary', tokenIndex: 3 }] },
                {
                  nodeId: 'inflbar',
                  label: "Infl'",
                  children: [
                    { nodeId: 'infl_head', label: 'Infl', children: [{ nodeId: 'did_leaf', label: 'did', tokenIndex: 2 }] },
                    {
                      nodeId: 'vp_mid',
                      label: 'VP',
                      children: [
                        { nodeId: 'subj_trace', label: 'DP', children: [{ nodeId: 't_subj', label: 't_1', word: 't_1' }] },
                        {
                          nodeId: 'vbar_mid',
                          label: "V'",
                          children: [
                            { nodeId: 'v_mid', label: 'V', children: [{ nodeId: 'eat_mid', label: 'eat', tokenIndex: 4 }] },
                            {
                              nodeId: 'obj_mid',
                              label: 'DP',
                              children: [
                                { nodeId: 'obj_mid_d', label: 'D', children: [{ nodeId: 'which_mid', label: 'Which', tokenIndex: 0 }] },
                                { nodeId: 'obj_mid_n', label: 'N', children: [{ nodeId: 'pig_mid', label: 'pig', tokenIndex: 1 }] }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          },
          {
            frameId: 'frame_3',
            operation: 'AbarMove',
            movement: {
              operation: 'AbarMove',
              sourceNodeId: 't_obj',
              targetNodeId: 'wh_fronted'
            },
            workspaceForest: {
              nodeId: 'cp',
              label: 'CP',
              children: [
                {
                  nodeId: 'wh_fronted',
                  label: 'DP',
                  children: [
                    { nodeId: 'wh_fronted_d', label: 'D', children: [{ nodeId: 'which_final', label: 'Which', tokenIndex: 0 }] },
                    { nodeId: 'wh_fronted_n', label: 'N', children: [{ nodeId: 'pig_final', label: 'pig', tokenIndex: 1 }] }
                  ]
                },
                {
                  nodeId: 'cbar_final',
                  label: "C'",
                  children: [
                    { nodeId: 'c_head_final', label: 'C', children: [{ nodeId: 'did_c_final', label: 'did', tokenIndex: 2 }] },
                    {
                      nodeId: 'inflp_final',
                      label: 'InflP',
                      children: [
                        { nodeId: 'subj_final', label: 'DP', children: [{ nodeId: 'mary_final', label: 'Mary', tokenIndex: 3 }] },
                        {
                          nodeId: 'inflbar_final',
                          label: "Infl'",
                          children: [
                            { nodeId: 'infl_final', label: 'Infl', children: [{ nodeId: 'infl_trace_final', label: 't_3', word: 't_3' }] },
                            {
                              nodeId: 'vp_final',
                              label: 'VP',
                              children: [
                                { nodeId: 'subj_trace_final', label: 'DP', children: [{ nodeId: 't_subj_final', label: 't_1', word: 't_1' }] },
                                {
                                  nodeId: 'vbar_final',
                                  label: "V'",
                                  children: [
                                    { nodeId: 'v_final', label: 'V', children: [{ nodeId: 'eat_final', label: 'eat', tokenIndex: 4 }] },
                                    { nodeId: 't_obj', label: 'DP', children: [{ nodeId: 't_obj_leaf', label: 't_2', word: 't_2' }] }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        ],
        noteBindings: [
          {
            kind: 'chain',
            chainId: 'wh_chain',
            stepIds: ['s1'],
            text: "The wh-phrase 'Which pig' undergoes A-bar movement from object position to Spec,CP."
          }
        ],
        argumentStructure: {
          eat: {
            agent: 'Mary',
            theme: 'Which pig'
          }
        },
        caseAssignments: {
          Mary: 'nominative',
          'Which pig': 'accusative'
        }
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'flash-lite');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.ok(analysis.movementEvents.some((event) => event.operation === 'AbarMove'));
  assert.deepStrictEqual(analysis.surfaceOrder, ['Which', 'pig', 'did', 'Mary', 'eat']);
});

test('normalizeParseBundle simulates compressed Lite head movement when the final wh frame leaves the auxiliary in Infl', () => {
  const sentence = 'Which pig did the farmer eat?';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'frame_1',
            operation: 'ExternalMerge',
            workspaceForest: {
              nodeId: 'root',
              label: 'VP',
              children: [
                {
                  nodeId: 'n_subj',
                  label: 'DP',
                  children: [
                    {
                      nodeId: 'n_d',
                      label: "D'",
                      children: [
                        { nodeId: 'n_d_head', label: 'D', children: [{ nodeId: 'n_the', label: 'the', tokenIndex: 3 }] },
                        {
                          nodeId: 'n_np',
                          label: 'NP',
                          children: [{ nodeId: 'n_n', label: 'N', children: [{ nodeId: 'n_farmer', label: 'farmer', tokenIndex: 4 }] }]
                        }
                      ]
                    }
                  ]
                },
                {
                  nodeId: 'n_v_bar',
                  label: "V'",
                  children: [
                    { nodeId: 'n_v', label: 'V', children: [{ nodeId: 'n_eat', label: 'eat', tokenIndex: 5 }] },
                    {
                      nodeId: 'n_obj',
                      label: 'DP',
                      children: [
                        {
                          nodeId: 'n_d_wh',
                          label: "D'",
                          children: [
                            { nodeId: 'n_d_wh_head', label: 'D', children: [{ nodeId: 'n_which', label: 'Which', tokenIndex: 0 }] },
                            {
                              nodeId: 'n_np_wh',
                              label: 'NP',
                              children: [{ nodeId: 'n_n_wh', label: 'N', children: [{ nodeId: 'n_pig', label: 'pig', tokenIndex: 1 }] }]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          },
          {
            frameId: 'frame_2',
            operation: 'HeadMove',
            movement: {
              operation: 'HeadMove',
              sourceNodeId: 'n_infl',
              targetNodeId: 'n_infl',
              note: 'Auxiliary did is merged in Infl.'
            },
            workspaceForest: {
              nodeId: 'root_infl',
              label: 'InflP',
              children: [
                {
                  nodeId: 'n_subj_copy',
                  label: 'DP',
                  children: [
                    {
                      nodeId: 'n_d_copy',
                      label: "D'",
                      children: [
                        { nodeId: 'n_d_head_copy', label: 'D', children: [{ nodeId: 'n_the_copy', label: 'the', tokenIndex: 3 }] },
                        {
                          nodeId: 'n_np_copy',
                          label: 'NP',
                          children: [{ nodeId: 'n_n_copy', label: 'N', children: [{ nodeId: 'n_farmer_copy', label: 'farmer', tokenIndex: 4 }] }]
                        }
                      ]
                    }
                  ]
                },
                {
                  nodeId: 'n_infl_bar',
                  label: "Infl'",
                  children: [
                    { nodeId: 'n_infl', label: 'Infl', children: [{ nodeId: 'n_did', label: 'did', tokenIndex: 2 }] },
                    {
                      nodeId: 'n_vp_trace',
                      label: 'VP',
                      children: [
                        { nodeId: 't_subj', label: 't_subj' },
                        {
                          nodeId: 'n_v_bar_trace',
                          label: "V'",
                          children: [
                            { nodeId: 'n_v_trace', label: 'V', children: [{ nodeId: 'n_eat_copy', label: 'eat', tokenIndex: 5 }] },
                            {
                              nodeId: 'n_obj_copy',
                              label: 'DP',
                              children: [
                                {
                                  nodeId: 'n_d_wh_copy',
                                  label: "D'",
                                  children: [
                                    { nodeId: 'n_d_wh_head_copy', label: 'D', children: [{ nodeId: 'n_which_copy', label: 'Which', tokenIndex: 0 }] },
                                    {
                                      nodeId: 'n_np_wh_copy',
                                      label: 'NP',
                                      children: [{ nodeId: 'n_n_wh_copy', label: 'N', children: [{ nodeId: 'n_pig_copy', label: 'pig', tokenIndex: 1 }] }]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          },
          {
            frameId: 'frame_3',
            operation: 'AbarMove',
            movement: {
              operation: 'AbarMove',
              sourceNodeId: 't_obj',
              targetNodeId: 'n_wh_fronted',
              note: 'The wh-phrase moves to Spec,CP to satisfy the [+wh] feature of C.'
            },
            workspaceForest: {
              nodeId: 'root_cp',
              label: 'CP',
              children: [
                {
                  nodeId: 'n_wh_fronted',
                  label: 'DP',
                  children: [
                    {
                      nodeId: 'n_d_wh_final',
                      label: "D'",
                      children: [
                        { nodeId: 'n_d_wh_head_final', label: 'D', children: [{ nodeId: 'n_which_final', label: 'Which', tokenIndex: 0 }] },
                        {
                          nodeId: 'n_np_wh_final',
                          label: 'NP',
                          children: [{ nodeId: 'n_n_wh_final', label: 'N', children: [{ nodeId: 'n_pig_final', label: 'pig', tokenIndex: 1 }] }]
                        }
                      ]
                    }
                  ]
                },
                {
                  nodeId: 'n_c_bar',
                  label: "C'",
                  children: [
                    { nodeId: 'n_c', label: 'C', children: [{ nodeId: 'n_null_c', label: '∅' }] },
                    {
                      nodeId: 'n_inflp_final',
                      label: 'InflP',
                      children: [
                        {
                          nodeId: 'n_subj_final',
                          label: 'DP',
                          children: [
                            {
                              nodeId: 'n_d_final',
                              label: "D'",
                              children: [
                                { nodeId: 'n_d_head_final', label: 'D', children: [{ nodeId: 'n_the_final', label: 'the', tokenIndex: 3 }] },
                                {
                                  nodeId: 'n_np_final',
                                  label: 'NP',
                                  children: [{ nodeId: 'n_n_final', label: 'N', children: [{ nodeId: 'n_farmer_final', label: 'farmer', tokenIndex: 4 }] }]
                                }
                              ]
                            }
                          ]
                        },
                        {
                          nodeId: 'n_infl_bar_final',
                          label: "Infl'",
                          children: [
                            { nodeId: 'n_infl_final', label: 'Infl', children: [{ nodeId: 'n_did_final', label: 'did', tokenIndex: 2 }] },
                            {
                              nodeId: 'n_vp_final',
                              label: 'VP',
                              children: [
                                { nodeId: 't_subj_final', label: 'DP', children: [{ nodeId: 't_subj_final_leaf', label: 't_1', word: 't_1' }] },
                                {
                                  nodeId: 'n_v_bar_final',
                                  label: "V'",
                                  children: [
                                    { nodeId: 'n_v_final', label: 'V', children: [{ nodeId: 'n_eat_final', label: 'eat', tokenIndex: 5 }] },
                                    { nodeId: 't_obj', label: 'DP', children: [{ nodeId: 't_obj_leaf', label: 't_2', word: 't_2' }] }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        ],
        noteBindings: [
          {
            kind: 'chain',
            chainId: 'wh_chain',
            stepIds: ['frame_3'],
            text: "The wh-phrase 'Which pig' undergoes A-bar movement from object position to Spec,CP."
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'flash-lite');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.deepStrictEqual(analysis.surfaceOrder, ['Which', 'pig', 'did', 'the', 'farmer', 'eat']);
  assert.equal(analysis.movementEvents.filter((event) => event.operation === 'HeadMove').length, 1);
  assert.ok(analysis.movementEvents.some((event) => event.operation === 'AbarMove'));
  assert.equal(findNodeById(analysis.tree, 'n_c')?.children?.[0]?.word, 'did');
});

test('normalizeParseBundle rejects chains whose pronounced copy is silent in the committed tree', () => {
  const sentence = 'The farmer ate the pig';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'frame_1',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'root_1',
                label: 'VP',
                children: [
                  {
                    id: 'subj_dp',
                    label: 'DP',
                    children: [
                      { id: 'd1', label: 'D', children: [{ id: 't0', label: 'The', tokenIndex: 0 }] },
                      { id: 'n1', label: 'NP', children: [{ id: 't1', label: 'farmer', tokenIndex: 1 }] }
                    ]
                  },
                  {
                    id: 'v_bar',
                    label: "V'",
                    children: [
                      { id: 'v', label: 'V', children: [{ id: 't2', label: 'ate', tokenIndex: 2 }] },
                      {
                        id: 'obj_dp',
                        label: 'DP',
                        children: [
                          { id: 'd2', label: 'D', children: [{ id: 't3', label: 'the', tokenIndex: 3 }] },
                          { id: 'n2', label: 'NP', children: [{ id: 't4', label: 'pig', tokenIndex: 4 }] }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            frameId: 'frame_2',
            operation: 'A-Move',
            movement: {
              operation: 'A-Move',
              sourceNodeId: 'subj_dp',
              targetNodeId: 'spec_inflp',
              note: 'Subject DP moves to Spec,InflP.'
            },
            workspaceForest: [
              {
                id: 'root_2',
                label: 'CP',
                children: [
                  {
                    id: 'c_bar',
                    label: "C'",
                    children: [
                      { id: 'c', label: 'C', children: [{ id: 'null_c', label: '∅' }] },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          { id: 'spec_inflp', label: 'DP', children: [{ id: 't_subj', label: 't_subj' }] },
                          {
                            id: 'infl_bar',
                            label: "Infl'",
                            children: [
                              { id: 'infl', label: 'Infl', children: [{ id: 'null_infl', label: '∅' }] },
                              {
                                id: 'vp_final',
                                label: 'VP',
                                children: [
                                  { id: 'trace_subj', label: 't_subj' },
                                  {
                                    id: 'v_bar_final',
                                    label: "V'",
                                    children: [
                                      { id: 'v_final', label: 'V', children: [{ id: 't2', label: 'ate', tokenIndex: 2 }] },
                                      {
                                        id: 'obj_dp_final',
                                        label: 'DP',
                                        children: [
                                          { id: 'd2_final', label: 'D', children: [{ id: 't3_final', label: 'the', tokenIndex: 3 }] },
                                          { id: 'n2_final', label: 'NP', children: [{ id: 't4_final', label: 'pig', tokenIndex: 4 }] }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'The clause is projected as a CP.' },
          { kind: 'chain', text: 'The subject DP undergoes A-movement to Spec,InflP.', chainId: 'subj_move' }
        ],
        chains: [
          {
            chainId: 'subj_move',
            type: 'A',
            copies: ['spec_inflp', 'trace_subj'],
            pronouncedCopy: 'spec_inflp',
            silentCopies: ['trace_subj']
          }
        ]
      }
    ]
  };

  assert.throws(
    () => normalizeParseBundle(payload, 'xbar', sentence, 'flash-lite'),
    /pronounced copy.*(?:silent|does not exist)/i
  );
});

test('normalizeParseBundle accepts model-authored chains in legacy id/hops/targetNodeId shape', () => {
  const sentence = 'Which violin did Nora borrow?';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'frame_1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'cp',
                label: 'CP',
                children: [
                  {
                    id: 'dp_wh_landed',
                    label: 'DP',
                    children: [
                      { id: 'd_which', label: 'D', tokenIndex: 0, text: 'Which' },
                      { id: 'n_violin', label: 'NP', tokenIndex: 1, text: 'violin' }
                    ]
                  },
                  {
                    id: 'c_bar',
                    label: "C'",
                    children: [
                      { id: 'c_did', label: 'C', tokenIndex: 2, text: 'did' },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          { id: 'dp_subj', label: 'DP', tokenIndex: 3, text: 'Nora' },
                          {
                            id: 'infl_bar',
                            label: "Infl'",
                            children: [
                              { id: 'infl_trace', label: 'Infl', text: 't_T' },
                              {
                                id: 'vp',
                                label: 'VP',
                                children: [
                                  { id: 'v_borrow', label: 'V', tokenIndex: 4, text: 'borrow' },
                                  { id: 'dp_wh_trace', label: 'DP', text: 't_1' }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          {
            kind: 'chain',
            text: "The wh-object 'Which violin' moves to Spec,CP.",
            chainId: 'chain_wh'
          }
        ],
        chains: [
          {
            id: 'chain_wh',
            type: 'A-bar',
            sourceNodeId: 'dp_wh_trace',
            targetNodeId: 'dp_wh_landed',
            hops: ['dp_wh_trace', 'dp_wh_landed']
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'minimalism', sentence, 'pro');
  const analysis = normalized.analyses[0];

  assert.deepEqual(analysis.chains, [
    {
      chainId: 'chain_wh',
      type: 'A-bar',
      copies: ['dp_wh_trace', 'dp_wh_landed'],
      pronouncedCopy: 'dp_wh_landed',
      silentCopies: ['dp_wh_trace'],
      features: undefined,
      note: undefined
    }
  ]);
});

test('inferSupplementalHeadMoveEventsFromGrowthFrames does not duplicate explicit head movement recovery', () => {
  const growthFrames = [
    {
      frameId: 'f1',
      operation: 'Project',
      workspaceForest: [
        {
          id: 'n_Cbar',
          label: "C'",
          children: [
            { id: 'n_C', label: 'C', word: '∅' },
            {
              id: 'n_InflP',
              label: 'InflP',
              children: [
                { id: 'n_DP_the_copy', label: 'DP', children: [{ id: 'n_D_the_copy', label: 'D', word: 'the' }] },
                {
                  id: 'n_Inflbar',
                  label: "Infl'",
                  children: [
                    { id: 'n_Infl', label: 'Infl', word: 'did' },
                    {
                      id: 'n_VP',
                      label: 'VP',
                      children: [
                        { id: 'n_t_subj', label: 'DP', word: 't_1' },
                        {
                          id: 'n_Vbar',
                          label: "V'",
                          children: [
                            { id: 'n_V', label: 'V', word: 'eat' },
                            { id: 'n_DP_obj', label: 'DP', children: [{ id: 'n_D_obj', label: 'D', word: 'Which' }] }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      frameId: 'f2',
      operation: 'HeadMove',
      chainId: 'chain_infl',
      movement: {
        operation: 'HeadMove',
        sourceNodeId: 'n_Infl',
        targetNodeId: 'n_C_did',
        note: 'Infl moves to C.'
      },
      workspaceForest: [
        {
          id: 'n_Cbar',
          label: "C'",
          children: [
            { id: 'n_C_did', label: 'C', word: 'did' },
            {
              id: 'n_InflP',
              label: 'InflP',
              children: [
                { id: 'n_DP_the_copy', label: 'DP', children: [{ id: 'n_D_the_copy', label: 'D', word: 'the' }] },
                {
                  id: 'n_Inflbar',
                  label: "Infl'",
                  children: [
                    { id: 'n_infl_trace', label: 'Infl', word: 't_2' },
                    {
                      id: 'n_VP',
                      label: 'VP',
                      children: [
                        { id: 'n_t_subj', label: 'DP', word: 't_1' },
                        {
                          id: 'n_Vbar',
                          label: "V'",
                          children: [
                            { id: 'n_V', label: 'V', word: 'eat' },
                            { id: 'n_DP_obj', label: 'DP', children: [{ id: 'n_D_obj', label: 'D', word: 'Which' }] }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const explicitMovementEvents = buildCanonicalMovementEventsFromGrowthFrames(growthFrames, growthFrames[1].workspaceForest[0]);
  const supplementalHeadMoves = inferSupplementalHeadMoveEventsFromGrowthFrames(
    growthFrames,
    growthFrames[1].workspaceForest[0],
    explicitMovementEvents
  );
  const headMoves = [...explicitMovementEvents, ...supplementalHeadMoves].filter((event) => event.operation === 'HeadMove');
  assert.equal(headMoves.length, 1);
  assert.equal(headMoves[0].fromNodeId, 'n_infl_trace');
  assert.equal(headMoves[0].toNodeId, 'n_C_did');
});

test('inferSupplementalHeadMoveEventsFromGrowthFrames does not hallucinate Infl head movement in compressed raising trees', () => {
  const finalTree = {
    id: 'cp_root',
    label: 'CP',
    children: [
      {
        id: 'cbar',
        label: "C'",
        children: [
          { id: 'c_head', label: 'C', word: '∅' },
          {
            id: 'inflp_matrix',
            label: 'InflP',
            children: [
              { id: 'dp_high', label: 'DP', children: [{ id: 'john', label: 'John', word: 'John' }] },
              {
                id: 'inflbar_matrix',
                label: "Infl'",
                children: [
                  { id: 'infl_matrix', label: 'Infl', children: [{ id: 'seems_tok', label: 'seems', word: 'seems' }] },
                  {
                    id: 'vp_matrix',
                    label: 'VP',
                    children: [
                      {
                        id: 'vbar_matrix',
                        label: "V'",
                        children: [
                          { id: 'v_head_lower', label: 'V', children: [{ id: 'v_trace', label: 't_subj', word: 't_subj' }] },
                          {
                            id: 'inflp_embedded',
                            label: 'InflP',
                            children: [
                              { id: 'infl_emb', label: 'Infl', children: [{ id: 'to_tok', label: 'to', word: 'to' }] },
                              {
                                id: 'vp_emb',
                                label: 'VP',
                                children: [
                                  {
                                    id: 'vbar_emb',
                                    label: "V'",
                                    children: [
                                      { id: 'v_like', label: 'V', children: [{ id: 'like_tok', label: 'like', word: 'like' }] },
                                      { id: 'dp_mary', label: 'DP', children: [{ id: 'mary', label: 'Mary', word: 'Mary' }] }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const growthFrames = [
    {
      frameId: 'f1',
      operation: 'ExternalMerge',
      workspaceForest: [
        {
          id: 'vp_emb',
          label: 'VP',
          children: [
            {
              id: 'vbar_emb',
              label: "V'",
              children: [
                { id: 'v_like', label: 'V', children: [{ id: 'like_tok', label: 'like', word: 'like' }] },
                { id: 'dp_mary', label: 'DP', children: [{ id: 'mary', label: 'Mary', word: 'Mary' }] }
              ]
            }
          ]
        }
      ]
    },
    {
      frameId: 'f2',
      operation: 'A-Move',
      movement: {
        operation: 'A-Move',
        targetNodeId: 'dp_high',
        note: 'John raises to the matrix subject position.'
      },
      workspaceForest: [finalTree]
    }
  ];

  const inferred = inferSupplementalHeadMoveEventsFromGrowthFrames(growthFrames, finalTree, []);
  assert.deepEqual(inferred, []);
});

test('inferSupplementalHeadMoveEventsFromGrowthFrames does not hallucinate head movement for overt infinitival to in C', () => {
  const finalTree = {
    id: 'cp_root',
    label: 'CP',
    children: [
      {
        id: 'cbar',
        label: "C'",
        children: [
          { id: 'c_head', label: 'C', children: [{ id: 'to_tok', label: 'to', word: 'to' }] },
          {
            id: 'inflp',
            label: 'InflP',
            children: [
              { id: 'pro_subj', label: 'PRO' },
              {
                id: 'inflbar',
                label: "Infl'",
                children: [
                  { id: 'infl_null', label: 'Infl', children: [{ id: 'null_tok', label: '∅', word: '∅' }] },
                  {
                    id: 'vp',
                    label: 'VP',
                    children: [
                      { id: 'v_head', label: 'V', children: [{ id: 'leave_tok', label: 'leave', word: 'leave' }] }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const growthFrames = [
    {
      frameId: 'f1',
      operation: 'ExternalMerge',
      workspaceForest: [
        {
          id: 'cp_root',
          label: 'CP',
          children: [
            {
              id: 'cbar',
              label: "C'",
              children: [
                { id: 'c_head', label: 'C', children: [{ id: 'to_tok', label: 'to', word: 'to' }] },
                {
                  id: 'inflp',
                  label: 'InflP',
                  children: [
                    { id: 'pro_subj', label: 'PRO' },
                    {
                      id: 'inflbar',
                      label: "Infl'",
                      children: [
                        { id: 'infl_null', label: 'Infl', children: [{ id: 'null_tok', label: '∅', word: '∅' }] },
                        {
                          id: 'vp',
                          label: 'VP',
                          children: [
                            { id: 'v_head', label: 'V', children: [{ id: 'leave_tok', label: 'leave', word: 'leave' }] }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const inferred = inferSupplementalHeadMoveEventsFromGrowthFrames(growthFrames, finalTree, []);
  assert.deepEqual(inferred, []);
});

test('buildCanonicalMovementEventsFromGrowthFrames retargets earlier raising steps to the committed intermediate trace so cyclic chains remain visible', () => {
  const growthFrames = [
    {
      frameId: 'f1',
      operation: 'Project',
      workspaceForest: [
        {
          id: 'lower_vp',
          label: 'VP',
          children: [
            {
              id: 'john_base',
              label: 'DP',
              children: [{ id: 'john_base_leaf', label: 'N', word: 'John' }]
            },
            { id: 'v_like', label: 'V', word: 'like' }
          ]
        }
      ]
    },
    {
      frameId: 'f2',
      operation: 'A-Move',
      chainId: 'chain_john',
      movement: {
        operation: 'A-Move',
        sourceNodeId: 'john_base',
        targetNodeId: 'john_lower_spec',
        note: 'John raises to the embedded Spec,InflP.'
      },
      workspaceForest: [
        {
          id: 'lower_inflp',
          label: 'InflP',
          children: [
            {
              id: 'john_lower_spec',
              label: 'DP',
              children: [{ id: 'john_lower_leaf', label: 'N', word: 'John' }]
            },
            {
              id: 'lower_inflbar',
              label: "Infl'",
              children: [
                { id: 'to_head', label: 'Infl', word: 'to' },
                {
                  id: 'lower_vp',
                  label: 'VP',
                  children: [
                    { id: 'john_base_trace', label: 'DP', word: 't_1' },
                    { id: 'v_like', label: 'V', word: 'like' }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      frameId: 'f3',
      operation: 'A-Move',
      chainId: 'chain_john',
      movement: {
        operation: 'A-Move',
        sourceNodeId: 'john_lower_spec',
        targetNodeId: 'john_matrix_spec',
        note: 'John raises to the matrix Spec,InflP.'
      },
      workspaceForest: [
        {
          id: 'matrix_inflp',
          label: 'InflP',
          children: [
            {
              id: 'john_matrix_spec',
              label: 'DP',
              children: [{ id: 'john_matrix_leaf', label: 'N', word: 'John' }]
            },
            {
              id: 'matrix_inflbar',
              label: "Infl'",
              children: [
                { id: 'matrix_infl', label: 'Infl', word: '∅' },
                {
                  id: 'vp_seems',
                  label: 'VP',
                  children: [
                    { id: 'v_seems', label: 'V', word: 'seems' },
                    {
                      id: 'lower_inflp',
                      label: 'InflP',
                      children: [
                        { id: 'john_lower_trace', label: 'DP', word: 't_1' },
                        {
                          id: 'lower_inflbar',
                          label: "Infl'",
                          children: [
                            { id: 'to_head', label: 'Infl', word: 'to' },
                            {
                              id: 'lower_vp',
                              label: 'VP',
                              children: [
                                { id: 'john_base_trace', label: 'DP', word: 't_1' },
                                { id: 'v_like', label: 'V', word: 'like' }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const finalTree = growthFrames[2].workspaceForest[0];
  const movementEvents = buildCanonicalMovementEventsFromGrowthFrames(growthFrames, finalTree);
  const firstMove = movementEvents.find((event) =>
    event.operation === 'A-Move' && event.toNodeId === 'john_lower_trace'
  );
  const secondMove = movementEvents.find((event) =>
    event.operation === 'A-Move' && event.toNodeId === 'john_matrix_spec'
  );

  assert.ok(firstMove);
  assert.equal(firstMove.fromNodeId, 'john_base_trace');
  assert.ok(secondMove);
  assert.equal(secondMove.fromNodeId, 'john_lower_trace');
});

test('buildCanonicalMovementEventsFromGrowthFrames prefers an explicit subject trace over a silent head shell on raising frames', () => {
  const growthFrames = [
    {
      frameId: 'f1',
      operation: 'ExternalMerge',
      workspaceForest: [
        {
          id: 'root_1',
          label: 'CP',
          children: [
            { id: 'c_1', label: 'C', children: [{ id: 'null_c_1', label: '∅' }] },
            {
              id: 'inflp_1',
              label: 'InflP',
              children: [
                { id: 'infl_1', label: 'Infl', children: [{ id: 'seems_1', label: 'seems', word: 'seems' }] },
                {
                  id: 'vp_1',
                  label: 'VP',
                  children: [
                    {
                      id: 'dp_subj',
                      label: 'DP',
                      children: [{ id: 'john_1', label: 'D', word: 'John' }]
                    },
                    {
                      id: 'vbar_1',
                      label: "V'",
                      children: [
                        { id: 'v_1', label: 'V', children: [{ id: 'null_v_1', label: '∅' }] },
                        {
                          id: 'inflp_2',
                          label: 'InflP',
                          children: [
                            { id: 'infl_2', label: 'Infl', children: [{ id: 'to_1', label: 'to', word: 'to' }] },
                            {
                              id: 'vp_2',
                              label: 'VP',
                              children: [
                                { id: 't_subj', label: 't_subj' },
                                {
                                  id: 'vbar_2',
                                  label: "V'",
                                  children: [
                                    { id: 'like_1', label: 'V', word: 'like' },
                                    { id: 'mary_1', label: 'DP', children: [{ id: 'mary_leaf_1', label: 'D', word: 'Mary' }] }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      frameId: 'f2',
      operation: 'A-Move',
      movement: {
        operation: 'A-Move',
        sourceNodeId: 'dp_subj',
        targetNodeId: 'spec_inflp_1',
        note: 'John raises to the matrix Spec,InflP.'
      },
      workspaceForest: [
        {
          id: 'root_2',
          label: 'CP',
          children: [
            { id: 'c_2', label: 'C', children: [{ id: 'null_c_2', label: '∅' }] },
            {
              id: 'inflp_final',
              label: 'InflP',
              children: [
                {
                  id: 'spec_inflp_1',
                  label: 'DP',
                  children: [{ id: 'john_final', label: 'D', word: 'John' }]
                },
                {
                  id: 'inflbar_final',
                  label: "Infl'",
                  children: [
                    { id: 'infl_final', label: 'Infl', children: [{ id: 'seems_final', label: 'seems', word: 'seems' }] },
                    {
                      id: 'vp_final',
                      label: 'VP',
                      children: [
                        { id: 't_subj_final', label: 't_subj' },
                        {
                          id: 'vbar_final',
                          label: "V'",
                          children: [
                            { id: 'v_final', label: 'V', children: [{ id: 'null_v_final', label: '∅' }] },
                            {
                              id: 'inflp_embedded',
                              label: 'InflP',
                              children: [
                                { id: 'infl_emb', label: 'Infl', children: [{ id: 'to_final', label: 'to', word: 'to' }] },
                                {
                                  id: 'vp_emb',
                                  label: 'VP',
                                  children: [
                                    { id: 't_subj_emb', label: 't_subj' },
                                    {
                                      id: 'vbar_emb',
                                      label: "V'",
                                      children: [
                                        { id: 'like_final', label: 'V', word: 'like' },
                                        { id: 'mary_final', label: 'DP', children: [{ id: 'mary_leaf_final', label: 'D', word: 'Mary' }] }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const finalTree = growthFrames[1].workspaceForest[0];
  const movementEvents = buildCanonicalMovementEventsFromGrowthFrames(growthFrames, finalTree);

  assert.equal(movementEvents.length, 1);
  assert.equal(movementEvents[0].operation, 'A-Move');
  assert.match(movementEvents[0].fromNodeId, /^t_subj/);
  assert.match(movementEvents[0].traceNodeId || '', /^t_subj/);
  assert.equal(movementEvents[0].toNodeId, 'spec_inflp_1');
});

test('normalizeParseBundle accepts alternate terminal surface fields inside pro growthFrames and canonicalizes them to words', () => {
  const sentence = 'The farmer ate the pig';
  const payload = {
    analyses: [
      {
        movementDecision: {
          hasMovement: true,
          rationale: 'The thematic subject raises to Spec,InflP.'
        },
        growthFrames: [
          {
            stepId: 's1',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'inflp_low',
                label: 'InflP',
                children: [
                  {
                    id: 'inflbar_low',
                    label: "Infl'",
                    children: [
                      { id: 'infl_low', label: 'Infl', text: '∅' },
                      {
                        id: 'vp_low',
                        label: 'VP',
                        children: [
                          {
                            id: 'subj_low',
                            label: 'DP',
                            children: [
                              {
                                id: 'subj_low_bar',
                                label: "D'",
                                children: [
                                  { id: 'subj_low_d', label: 'D', token: 'The', tokenIndex: 0 },
                                  {
                                    id: 'subj_low_np',
                                    label: 'NP',
                                    children: [
                                      {
                                        id: 'subj_low_nbar',
                                        label: "N'",
                                        children: [
                                          { id: 'subj_low_n', label: 'N', form: 'farmer', tokenIndex: 1 }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'vbar_low',
                            label: "V'",
                            children: [
                              { id: 'v_low', label: 'V', surface: 'ate', tokenIndex: 2 },
                              {
                                id: 'obj_low',
                                label: 'DP',
                                children: [
                                  {
                                    id: 'obj_low_bar',
                                    label: "D'",
                                    children: [
                                      { id: 'obj_low_d', label: 'D', token: 'the', tokenIndex: 3 },
                                      {
                                        id: 'obj_low_np',
                                        label: 'NP',
                                        children: [
                                          {
                                            id: 'obj_low_nbar',
                                            label: "N'",
                                            children: [
                                              { id: 'obj_low_n', label: 'N', leafText: 'pig', tokenIndex: 4 }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 's2',
            operation: 'A-Move',
            movement: {
              operation: 'A-Move',
              sourceNodeId: 'subj_low',
              targetNodeId: 'subj_high',
              note: 'The subject DP moves to Spec,InflP.'
            },
            workspaceForest: [
              {
                id: 'cp',
                label: 'CP',
                children: [
                  {
                    id: 'cbar',
                    label: "C'",
                    children: [
                      { id: 'c', label: 'C', text: '∅' },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          {
                            id: 'subj_high',
                            label: 'DP',
                            children: [
                              {
                                id: 'subj_high_bar',
                                label: "D'",
                                children: [
                                  { id: 'subj_high_d', label: 'D', token: 'The', tokenIndex: 0 },
                                  {
                                    id: 'subj_high_np',
                                    label: 'NP',
                                    children: [
                                      {
                                        id: 'subj_high_nbar',
                                        label: "N'",
                                        children: [
                                          { id: 'subj_high_n', label: 'N', form: 'farmer', tokenIndex: 1 }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'inflbar',
                            label: "Infl'",
                            children: [
                              { id: 'infl', label: 'Infl', text: '∅' },
                              {
                                id: 'vp',
                                label: 'VP',
                                children: [
                                  {
                                    id: 'subj_trace',
                                    label: 'DP',
                                    children: [{ id: 'subj_trace_d', label: 'D', text: 't_1' }]
                                  },
                                  {
                                    id: 'vbar',
                                    label: "V'",
                                    children: [
                                      { id: 'v', label: 'V', surface: 'ate', tokenIndex: 2 },
                                      {
                                        id: 'obj',
                                        label: 'DP',
                                        children: [
                                          {
                                            id: 'obj_bar',
                                            label: "D'",
                                            children: [
                                              { id: 'obj_d', label: 'D', token: 'the', tokenIndex: 3 },
                                              {
                                                id: 'obj_np',
                                                label: 'NP',
                                                children: [
                                                  {
                                                    id: 'obj_nbar',
                                                    label: "N'",
                                                    children: [
                                                      { id: 'obj_n', label: 'N', form: 'pig', tokenIndex: 4 }
                                                    ]
                                                  }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 's3',
            operation: 'SpellOut',
            reusePreviousWorkspace: true,
            spelloutOrder: ['The', 'farmer', 'ate', 'the', 'pig']
          }
        ],
        noteBindings: [
          {
            kind: 'architecture',
            note: 'The clause is analyzed as a finite CP whose InflP core supports ordinary declarative clause structure.',
            stepIds: ['s3']
          },
          {
            kind: 'closure',
            note: 'The subject DP is first merged in the lower predicate domain and then undergoes A-movement to Spec,InflP.',
            chainId: 'chain_subj',
            stepIds: ['s2']
          }
        ],
        explanation: 'Stale explanation that should not survive when bound notes are present.'
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro');
  const analysis = normalized.analyses[0];
  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.deepEqual(analysis.surfaceOrder, ['The', 'farmer', 'ate', 'the', 'pig']);
  assert.equal(findNodeById(analysis.tree, 'subj_high_d')?.word, 'The');
  assert.equal(findNodeById(analysis.tree, 'subj_high_n')?.word, 'farmer');
  assert.equal(findNodeById(analysis.tree, 'v')?.word, 'ate');
  assert.deepEqual(
    analysis.noteBindings,
    [
      {
        kind: 'architecture',
        text: 'The clause is analyzed as a finite CP whose InflP core supports ordinary declarative clause structure.',
        chainId: undefined,
        stepIds: ['s3'],
        order: 0
      },
      {
        kind: 'closure',
        text: 'The subject DP is first merged in the lower predicate domain and then undergoes A-movement to Spec,InflP.',
        chainId: 'chain_subj',
        stepIds: ['s2'],
        order: 1
      }
    ]
  );
  assert.equal(
    analysis.explanation,
    'The clause is analyzed as a finite CP whose InflP core supports ordinary declarative clause structure. The subject DP is first merged in the lower predicate domain and then undergoes A-movement to Spec,InflP.'
  );
});

test('normalizeParseBundle preserves note binding support references into structural ledgers', () => {
  const sentence = 'The farmer ate the pig.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'SpellOut',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'dp_subj',
                    label: 'DP',
                    children: [
                      { id: 'd_subj', label: 'D', children: [{ id: 'the_subj', label: 'The', word: 'The' }] },
                      { id: 'np_subj', label: 'NP', children: [{ id: 'farmer_leaf', label: 'farmer', word: 'farmer' }] }
                    ]
                  },
                  {
                    id: 'cbar_root',
                    label: "C'",
                    children: [
                      { id: 'c_null', label: 'C', children: [{ id: 'c_null_leaf', label: '∅', word: '∅' }] },
                      {
                        id: 'inflp_root',
                        label: 'InflP',
                        children: [
                          {
                            id: 'subj_trace',
                            label: 'DP',
                            children: [{ id: 'subj_trace_leaf', label: 't₁', word: 't₁' }]
                          },
                          {
                            id: 'inflbar_root',
                            label: "Infl'",
                            children: [
                              { id: 'infl_null', label: 'Infl', children: [{ id: 'infl_null_leaf', label: '∅', word: '∅' }] },
                              {
                                id: 'vp_root',
                                label: 'VP',
                                children: [
                                  { id: 'v_head', label: 'V', children: [{ id: 'ate_leaf', label: 'ate', word: 'ate' }] },
                                  {
                                    id: 'dp_obj',
                                    label: 'DP',
                                    case: 'Accusative',
                                    assigner: 'V_ate',
                                    children: [
                                      { id: 'd_obj', label: 'D', children: [{ id: 'the_obj', label: 'the', word: 'the' }] },
                                      { id: 'np_obj', label: 'NP', children: [{ id: 'pig_leaf', label: 'pig', word: 'pig' }] }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        movementEvents: [
          { operation: 'A-Move', fromNodeId: 'subj_trace', toNodeId: 'dp_subj', traceNodeId: 'subj_trace_leaf' }
        ],
        selectionLedger: [
          { selectionId: 'sel_obj', selectorHead: 'V (ate)', selectedCategory: 'DP', selectedLabel: 'DP (the pig)', relation: 'complement' }
        ],
        caseAssignments: [
          { assignmentId: 'case_obj', assigneeLabel: 'the pig', case: 'Accusative', assigner: 'V_ate' }
        ],
        noteBindings: [
          {
            kind: 'licensing',
            text: 'The verb selects the object DP and assigns it Accusative case.',
            stepIds: ['s1'],
            nodeIds: ['dp_obj'],
            selectionIds: ['sel_obj'],
            caseAssignmentIds: ['case_obj']
          }
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'pro').analyses[0];
  assert.deepEqual(analysis.noteBindings[0].stepIds, ['s1']);
  assert.deepEqual(analysis.noteBindings[0].nodeIds, ['dp_obj']);
  assert.deepEqual(analysis.noteBindings[0].selectionIds, ['sel_obj']);
  assert.deepEqual(analysis.noteBindings[0].caseAssignmentIds, ['case_obj']);
});

test('normalizeParseBundle accepts noteBindings that use noteType and noteId transport aliases', () => {
  const sentence = 'The farmer ate the pig.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'SpellOut',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'dp_subj',
                    label: 'DP',
                    children: [
                      { id: 'd_subj', label: 'D', children: [{ id: 'the_subj', label: 'The', word: 'The' }] },
                      { id: 'np_subj', label: 'NP', children: [{ id: 'farmer_leaf', label: 'farmer', word: 'farmer' }] }
                    ]
                  },
                  {
                    id: 'cbar_root',
                    label: "C'",
                    children: [
                      { id: 'c_null', label: 'C', children: [{ id: 'c_null_leaf', label: '∅', word: '∅' }] },
                      {
                        id: 'inflp_root',
                        label: 'InflP',
                        children: [
                          {
                            id: 'subj_trace',
                            label: 'DP',
                            children: [{ id: 'subj_trace_leaf', label: 't₁', word: 't₁' }]
                          },
                          {
                            id: 'inflbar_root',
                            label: "Infl'",
                            children: [
                              { id: 'infl_null', label: 'Infl', children: [{ id: 'infl_null_leaf', label: '∅', word: '∅' }] },
                              {
                                id: 'vp_root',
                                label: 'VP',
                                children: [
                                  { id: 'v_head', label: 'V', children: [{ id: 'ate_leaf', label: 'ate', word: 'ate' }] },
                                  {
                                    id: 'dp_obj',
                                    label: 'DP',
                                    children: [
                                      { id: 'd_obj', label: 'D', children: [{ id: 'the_obj', label: 'the', word: 'the' }] },
                                      { id: 'np_obj', label: 'NP', children: [{ id: 'pig_leaf', label: 'pig', word: 'pig' }] }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          {
            noteId: 'nb_arch',
            noteType: 'architecture',
            text: 'The clause projects a CP over InflP and VP.',
            stepIds: ['s1'],
            nodeIds: ['cp_root', 'inflp_root', 'vp_root']
          }
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'pro').analyses[0];
  assert.equal(analysis.noteBindings.length, 1);
  assert.equal(analysis.noteBindings[0].noteId, 'nb_arch');
  assert.equal(analysis.noteBindings[0].kind, 'architecture');
  assert.deepEqual(analysis.noteBindings[0].stepIds, ['s1']);
});

test('normalizeParseBundle accepts noteBindings that use content as the note text transport alias', () => {
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            stepId: 'step_1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'dp',
                label: 'DP',
                children: [
                  {
                    id: 'd',
                    label: 'D',
                    children: [{ label: 'Teresa', tokenIndex: 0 }]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'step_2',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'dp',
                label: 'DP',
                children: [
                  {
                    id: 'd',
                    label: 'D',
                    children: [{ label: 'Teresa', tokenIndex: 0 }]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'step_3',
            operation: 'SpellOut',
            workspaceForest: [
              {
                id: 'dp',
                label: 'DP',
                children: [
                  {
                    id: 'd',
                    label: 'D',
                    children: [{ label: 'Teresa', tokenIndex: 0 }]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          {
            noteType: 'architecture',
            content: 'The derivation projects a simple DP.',
            stepIds: ['step_1'],
            nodeIds: ['dp']
          },
          {
            noteType: 'closure',
            content: 'Spellout yields the surface string.',
            stepIds: ['step_3'],
            nodeIds: ['dp']
          }
        ],
        caseAssignments: [],
        argumentStructure: [],
        selectionLedger: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', 'Teresa', 'pro', true);
  assert.equal(normalized.analyses[0].noteBindings.length, 2);
  assert.equal(normalized.analyses[0].noteBindings[0].text, 'The derivation projects a simple DP.');
});

test('normalizeParseBundle accepts noteBindings that use category and chainIds transport aliases', () => {
  const sentence = 'The farmer ate the pig.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'SpellOut',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'dp_subj',
                    label: 'DP',
                    children: [
                      { id: 'd_subj', label: 'D', children: [{ id: 'the_subj', label: 'The', word: 'The' }] },
                      { id: 'np_subj', label: 'NP', children: [{ id: 'farmer_leaf', label: 'farmer', word: 'farmer' }] }
                    ]
                  },
                  {
                    id: 'cbar_root',
                    label: "C'",
                    children: [
                      { id: 'c_null', label: 'C', children: [{ id: 'c_null_leaf', label: '∅', word: '∅' }] },
                      {
                        id: 'inflp_root',
                        label: 'InflP',
                        children: [
                          { id: 'subj_trace', label: 'DP', children: [{ id: 'subj_trace_leaf', label: 't₁', word: 't₁' }] },
                          {
                            id: 'inflbar_root',
                            label: "Infl'",
                            children: [
                              { id: 'infl_null', label: 'Infl', children: [{ id: 'infl_null_leaf', label: '∅', word: '∅' }] },
                              {
                                id: 'vp_root',
                                label: 'VP',
                                children: [
                                  { id: 'v_head', label: 'V', children: [{ id: 'ate_leaf', label: 'ate', word: 'ate' }] },
                                  {
                                    id: 'dp_obj',
                                    label: 'DP',
                                    children: [
                                      { id: 'd_obj', label: 'D', children: [{ id: 'the_obj', label: 'the', word: 'the' }] },
                                      { id: 'np_obj', label: 'NP', children: [{ id: 'pig_leaf', label: 'pig', word: 'pig' }] }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        chains: [
          { chainId: 'chain_subj', type: 'A', copies: ['dp_subj', 'subj_trace'], pronouncedCopy: 'dp_subj' }
        ],
        noteBindings: [
          {
            id: 'note_subj',
            category: 'movement',
            note: 'The subject undergoes A-movement to the higher subject position.',
            chainIds: ['chain_subj'],
            stepIds: ['s1'],
            nodeIds: ['dp_subj', 'subj_trace']
          }
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'pro').analyses[0];
  assert.equal(analysis.noteBindings.length, 1);
  assert.equal(analysis.noteBindings[0].noteId, 'note_subj');
  assert.equal(analysis.noteBindings[0].kind, 'chain');
  assert.equal(analysis.noteBindings[0].chainId, 'chain_subj');
});

test('normalizeParseBundle expands compact note binding supportIds into typed ledger refs', () => {
  const sentence = 'The farmer ate the pig.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'SpellOut',
            spelloutOrder: ['The', 'farmer', 'ate', 'the', 'pig'],
            workspaceForest: [
              {
                id: 'cp',
                label: 'CP',
                children: [
                  {
                    id: 'cbar',
                    label: "C'",
                    children: [
                      { id: 'c', label: 'C', children: [{ id: 'c_leaf', label: '∅', word: '∅' }] },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          {
                            id: 'dp_subj',
                            label: 'DP',
                            children: [
                              {
                                id: 'dbar_subj',
                                label: "D'",
                                children: [
                                  { id: 'd_subj', label: 'D', children: [{ id: 'the_subj', label: 'The', word: 'The', tokenIndex: 0 }] },
                                  {
                                    id: 'np_subj',
                                    label: 'NP',
                                    children: [
                                      {
                                        id: 'nbar_subj',
                                        label: "N'",
                                        children: [{ id: 'n_subj', label: 'N', children: [{ id: 'farmer_leaf', label: 'farmer', word: 'farmer', tokenIndex: 1 }] }]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'inflbar',
                            label: "Infl'",
                            children: [
                              { id: 'infl', label: 'Infl', children: [{ id: 'infl_leaf', label: '∅', word: '∅' }] },
                              {
                                id: 'vp',
                                label: 'VP',
                                children: [
                                  {
                                    id: 'vbar',
                                    label: "V'",
                                    children: [
                                      { id: 'v', label: 'V', children: [{ id: 'ate_leaf', label: 'ate', word: 'ate', tokenIndex: 2 }] },
                                      {
                                        id: 'dp_obj',
                                        label: 'DP',
                                        children: [
                                          {
                                            id: 'dbar_obj',
                                            label: "D'",
                                            children: [
                                              { id: 'd_obj', label: 'D', children: [{ id: 'the_obj', label: 'the', word: 'the', tokenIndex: 3 }] },
                                              {
                                                id: 'np_obj',
                                                label: 'NP',
                                                children: [
                                                  {
                                                    id: 'nbar_obj',
                                                    label: "N'",
                                                    children: [{ id: 'n_obj', label: 'N', children: [{ id: 'pig_leaf', label: 'pig', word: 'pig', tokenIndex: 4 }] }]
                                                  }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        selectionLedger: [
          { selectionId: 'selection_obj', selectorHead: 'V (ate)', selectedCategory: 'DP', selectedLabel: 'DP (the pig)', relation: 'complement' }
        ],
        caseAssignments: [
          { assignmentId: 'case_obj', assigneeLabel: 'the pig', case: 'Accusative', assigner: 'V (ate)' }
        ],
        noteBindings: [
          {
            kind: 'licensing',
            text: 'The verb selects the object DP and assigns it Accusative case.',
            stepIds: ['s1'],
            nodeIds: ['dp_obj'],
            supportIds: ['selection_obj', 'case_obj']
          }
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'pro').analyses[0];
  assert.deepEqual(analysis.noteBindings[0].supportIds, ['selection_obj', 'case_obj']);
  assert.deepEqual(analysis.noteBindings[0].selectionIds, ['selection_obj']);
  assert.deepEqual(analysis.noteBindings[0].caseAssignmentIds, ['case_obj']);
});

test('normalizeParseBundle drops note binding supportIds that do not survive ledger normalization', () => {
  const sentence = 'The farmer ate the pig.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'SpellOut',
            spelloutOrder: ['The', 'farmer', 'ate', 'the', 'pig'],
            workspaceForest: [
              {
                id: 'cp',
                label: 'CP',
                children: [
                  {
                    id: 'cbar',
                    label: "C'",
                    children: [
                      { id: 'c', label: 'C', children: [{ id: 'c_leaf', label: '∅', word: '∅' }] },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          {
                            id: 'dp_subj',
                            label: 'DP',
                            children: [
                              {
                                id: 'dbar_subj',
                                label: "D'",
                                children: [
                                  { id: 'd_subj', label: 'D', children: [{ id: 'the_subj', label: 'The', word: 'The', tokenIndex: 0 }] },
                                  {
                                    id: 'np_subj',
                                    label: 'NP',
                                    children: [
                                      {
                                        id: 'nbar_subj',
                                        label: "N'",
                                        children: [{ id: 'n_subj', label: 'N', children: [{ id: 'farmer_leaf', label: 'farmer', word: 'farmer', tokenIndex: 1 }] }]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'inflbar',
                            label: "Infl'",
                            children: [
                              { id: 'infl', label: 'Infl', children: [{ id: 'infl_leaf', label: '∅', word: '∅' }] },
                              {
                                id: 'vp',
                                label: 'VP',
                                children: [
                                  {
                                    id: 'vbar',
                                    label: "V'",
                                    children: [
                                      { id: 'v', label: 'V', children: [{ id: 'ate_leaf', label: 'ate', word: 'ate', tokenIndex: 2 }] },
                                      {
                                        id: 'dp_obj',
                                        label: 'DP',
                                        children: [
                                          {
                                            id: 'dbar_obj',
                                            label: "D'",
                                            children: [
                                              { id: 'd_obj', label: 'D', children: [{ id: 'the_obj', label: 'the', word: 'the', tokenIndex: 3 }] },
                                              {
                                                id: 'np_obj',
                                                label: 'NP',
                                                children: [
                                                  {
                                                    id: 'nbar_obj',
                                                    label: "N'",
                                                    children: [{ id: 'n_obj', label: 'N', children: [{ id: 'pig_leaf', label: 'pig', word: 'pig', tokenIndex: 4 }] }]
                                                  }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        selectionLedger: [
          { selectionId: 'selection_obj', selectorHead: 'V (ate)', selectedCategory: 'DP', selectedLabel: 'DP (the pig)', relation: 'complement' }
        ],
        noteBindings: [
          {
            kind: 'licensing',
            text: 'The verb selects the object DP.',
            stepIds: ['s1'],
            nodeIds: ['dp_obj'],
            supportIds: ['selection_obj', 'missing_case_obj']
          }
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'pro').analyses[0];
  assert.deepEqual(analysis.noteBindings[0].supportIds, ['selection_obj']);
  assert.deepEqual(analysis.noteBindings[0].selectionIds, ['selection_obj']);
  assert.equal(analysis.noteBindings[0].caseAssignmentIds, undefined);
});

test('normalizeParseBundle preserves generic raw ledger ids so note supportIds survive normalization', () => {
  const sentence = 'Which pig did the farmer eat?';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'SpellOut',
            spelloutOrder: ['Which', 'pig', 'did', 'the', 'farmer', 'eat'],
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'dp_wh',
                    label: 'DP',
                    children: [
                      { id: 'd_wh', label: 'D', children: [{ id: 'which_leaf', label: 'Which', word: 'Which', tokenIndex: 0 }] },
                      {
                        id: 'np_wh',
                        label: 'NP',
                        children: [{ id: 'pig_leaf', label: 'N', children: [{ id: 'pig_tok', label: 'pig', word: 'pig', tokenIndex: 1 }] }]
                      }
                    ]
                  },
                  {
                    id: 'cbar_root',
                    label: "C'",
                    children: [
                      { id: 'c_head', label: 'C', children: [{ id: 'did_leaf', label: 'did', word: 'did', tokenIndex: 2 }] },
                      {
                        id: 'inflp_root',
                        label: 'InflP',
                        children: [
                          {
                            id: 'dp_subj',
                            label: 'DP',
                            children: [
                              { id: 'd_subj', label: 'D', children: [{ id: 'the_leaf', label: 'the', word: 'the', tokenIndex: 3 }] },
                              {
                                id: 'np_subj',
                                label: 'NP',
                                children: [{ id: 'farmer_leaf', label: 'N', children: [{ id: 'farmer_tok', label: 'farmer', word: 'farmer', tokenIndex: 4 }] }]
                              }
                            ]
                          },
                          {
                            id: 'inflbar_root',
                            label: "Infl'",
                            children: [
                              { id: 'infl_trace', label: 'Infl', children: [{ id: 'infl_trace_leaf', label: 't₂', word: 't₂' }] },
                              {
                                id: 'vp_root',
                                label: 'VP',
                                children: [
                                  { id: 'dp_trace', label: 'DP', children: [{ id: 'dp_trace_leaf', label: 't₁', word: 't₁' }] },
                                  {
                                    id: 'vbar_root',
                                    label: "V'",
                                    children: [
                                      { id: 'v_head', label: 'V', children: [{ id: 'eat_leaf', label: 'eat', word: 'eat', tokenIndex: 5 }] },
                                      { id: 'obj_trace', label: 'DP', children: [{ id: 'obj_trace_leaf', label: 't₃', word: 't₃' }] }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        argumentStructure: [
          { id: 'arg_subj', argument: 'the farmer', predicate: 'eat', role: 'Agent' },
          { id: 'arg_obj', argument: 'Which pig', predicate: 'eat', role: 'Patient' }
        ],
        selectionLedger: [
          { id: 'sel_v', selector: 'V (eat)', selectee: 'DP (Which pig)', relation: 'complement' }
        ],
        clausalDependencies: [
          { id: 'dep_mat', type: 'matrix-interrogative', clause: 'CP' }
        ],
        noteBindings: [
          {
            kind: 'architecture',
            text: 'The clause is interrogative and the verb selects the wh-object as its complement.',
            supportIds: ['sel_v', 'arg_subj', 'arg_obj', 'dep_mat']
          }
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'pro').analyses[0];
  assert.deepEqual(analysis.noteBindings[0].supportIds, ['sel_v', 'arg_subj', 'arg_obj', 'dep_mat']);
  assert.deepEqual(analysis.noteBindings[0].selectionIds, ['sel_v']);
  assert.deepEqual(analysis.noteBindings[0].argumentIds, ['arg_subj', 'arg_obj']);
  assert.deepEqual(analysis.noteBindings[0].dependencyIds, ['dep_mat']);
});

test('normalizeParseBundle assigns deterministic ids to structured ledgers when the model omits them', () => {
  const sentence = 'The farmer ate the pig.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'SpellOut',
            spelloutOrder: ['The', 'farmer', 'ate', 'the', 'pig'],
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'inflp_root',
                    label: 'InflP',
                    children: [
                      {
                        id: 'dp_subj',
                        label: 'DP',
                        children: [
                          {
                            id: 'dbar_subj',
                            label: "D'",
                            children: [
                              { id: 'd_subj', label: 'D', children: [{ id: 'd_subj_leaf', label: 'The', word: 'The' }] },
                              {
                                id: 'np_subj',
                                label: 'NP',
                                children: [{ id: 'n_subj', label: 'N', children: [{ id: 'n_subj_leaf', label: 'farmer', word: 'farmer' }] }]
                              }
                            ]
                          }
                        ]
                      },
                      {
                        id: 'inflbar_root',
                        label: "Infl'",
                        children: [
                          { id: 'infl_head', label: 'Infl', children: [{ id: 'infl_leaf', label: '∅' }] },
                          {
                            id: 'vp_root',
                            label: 'VP',
                            children: [
                              { id: 'v_head', label: 'V', children: [{ id: 'v_leaf', label: 'ate', word: 'ate' }] },
                              {
                                id: 'dp_obj',
                                label: 'DP',
                                children: [
                                  {
                                    id: 'dbar_obj',
                                    label: "D'",
                                    children: [
                                      { id: 'd_obj', label: 'D', children: [{ id: 'd_obj_leaf', label: 'the', word: 'the' }] },
                                      {
                                        id: 'np_obj',
                                        label: 'NP',
                                        children: [{ id: 'n_obj', label: 'N', children: [{ id: 'n_obj_leaf', label: 'pig', word: 'pig' }] }]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        caseAssignments: [
          { assigneeLabel: 'the pig', case: 'Accusative', assigner: 'V_ate' }
        ],
        argumentStructure: [
          { role: 'Theme', predicate: 'ate', referent: 'the pig' }
        ],
        selectionLedger: [
          { selectorHead: 'V (ate)', selectedCategory: 'DP', selectedLabel: 'DP (the pig)', relation: 'complement' }
        ],
        bindingLedger: [
          { antecedentLabel: 'John', dependentLabel: 'himself', relation: 'binds', principle: 'A', status: 'satisfied' }
        ],
        clausalDependencies: [
          { type: 'control', subtype: 'object-control', controllerLabel: 'Mary', dependentLabel: 'PRO' }
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'pro').analyses[0];
  assert.equal(analysis.caseAssignments[0].assignmentId, 'case_1');
  assert.equal(analysis.argumentStructure[0].argumentId, 'argument_1');
  assert.equal(analysis.selectionLedger[0].selectionId, 'selection_1');
  assert.equal(analysis.bindingLedger[0].bindingId, 'binding_1');
  assert.equal(analysis.clausalDependencies[0].dependencyId, 'dependency_1');
});

test('normalizeParseBundle may preserve empty noteBindings before the final Pro notes pass runs', () => {
  const sentence = 'The farmer ate the pig';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'g1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'cbar_root',
                    label: "C'",
                    children: [
                      { id: 'c_head', label: 'C', children: [{ id: 'c_null', label: '∅' }] },
                      {
                        id: 'inflp_root',
                        label: 'InflP',
                        children: [
                          {
                            id: 'dp_subj',
                            label: 'DP',
                            children: [
                              {
                                id: 'dbar_subj',
                                label: "D'",
                                children: [
                                  { id: 'd_subj', label: 'D', children: [{ id: 'tok_the', label: 'The', tokenIndex: 0 }] },
                                  {
                                    id: 'np_subj',
                                    label: 'NP',
                                    children: [
                                      {
                                        id: 'nbar_subj',
                                        label: "N'",
                                        children: [{ id: 'n_subj', label: 'N', children: [{ id: 'tok_farmer', label: 'farmer', tokenIndex: 1 }] }]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'inflbar_root',
                            label: "Infl'",
                            children: [
                              { id: 'infl_head', label: 'Infl', children: [{ id: 'infl_null', label: '∅' }] },
                              {
                                id: 'vp_root',
                                label: 'VP',
                                children: [
                                  { id: 'subj_trace', label: 'DP', children: [{ id: 't_subj', label: 't_1', word: 't_1' }] },
                                  {
                                    id: 'vbar_root',
                                    label: "V'",
                                    children: [
                                      { id: 'v_head', label: 'V', children: [{ id: 'tok_ate', label: 'ate', tokenIndex: 2 }] },
                                      {
                                        id: 'dp_obj',
                                        label: 'DP',
                                        children: [
                                          {
                                            id: 'dbar_obj',
                                            label: "D'",
                                            children: [
                                              { id: 'd_obj', label: 'D', children: [{ id: 'tok_the_obj', label: 'the', tokenIndex: 3 }] },
                                              {
                                                id: 'np_obj',
                                                label: 'NP',
                                                children: [
                                                  {
                                                    id: 'nbar_obj',
                                                    label: "N'",
                                                    children: [{ id: 'n_obj', label: 'N', children: [{ id: 'tok_pig', label: 'pig', tokenIndex: 4 }] }]
                                                  }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        explanation: 'Stale explanation that should never survive on the growth-first fallback path.'
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.ok(Array.isArray(analysis.noteBindings));
  assert.equal(analysis.noteBindings.length, 0);
  assert.notEqual(
    analysis.explanation,
    'Stale explanation that should never survive on the growth-first fallback path.'
  );
  assert.match(analysis.explanation, /committed X-bar analysis/i);
});

test('normalizeParseBundle accepts singleton workspaceForest objects and nodeId aliases on growth-first lite parses', () => {
  const sentence = 'The farmer ate the pig';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 1,
            operation: 'ExternalMerge',
            workspaceForest: {
              nodeId: 'cp_root',
              label: 'CP',
              children: [
                {
                  nodeId: 'cbar',
                  label: "C'",
                  children: [
                    { nodeId: 'c_head', label: 'C', word: '∅' },
                    {
                      nodeId: 'inflp',
                      label: 'InflP',
                      children: [
                        {
                          nodeId: 'subj',
                          label: 'DP',
                          children: [
                            {
                              nodeId: 'subj_bar',
                              label: "D'",
                              children: [
                                { nodeId: 'subj_d', label: 'D', word: 'The', tokenIndex: 0 },
                                {
                                  nodeId: 'subj_np',
                                  label: 'NP',
                                  children: [
                                    {
                                      nodeId: 'subj_nbar',
                                      label: "N'",
                                      children: [
                                        { nodeId: 'subj_n', label: 'N', word: 'farmer', tokenIndex: 1 }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        },
                        {
                          nodeId: 'inflbar',
                          label: "Infl'",
                          children: [
                            { nodeId: 'infl', label: 'Infl', word: '∅' },
                            {
                              nodeId: 'vp',
                              label: 'VP',
                              children: [
                                {
                                  nodeId: 'vbar',
                                  label: "V'",
                                  children: [
                                    { nodeId: 'v', label: 'V', word: 'ate', tokenIndex: 2 },
                                    {
                                      nodeId: 'obj',
                                      label: 'DP',
                                      children: [
                                        {
                                          nodeId: 'obj_bar',
                                          label: "D'",
                                          children: [
                                            { nodeId: 'obj_d', label: 'D', word: 'the', tokenIndex: 3 },
                                            {
                                              nodeId: 'obj_np',
                                              label: 'NP',
                                              children: [
                                                {
                                                  nodeId: 'obj_nbar',
                                                  label: "N'",
                                                  children: [
                                                    { nodeId: 'obj_n', label: 'N', word: 'pig', tokenIndex: 4 }
                                                  ]
                                                }
                                              ]
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          },
          {
            frameId: 2,
            operation: 'SpellOut',
            reusePreviousWorkspace: true
          }
        ],
        noteBindings: [
          {
            kind: 'architecture',
            note: 'The clause projects a CP over InflP with an overt VP predicate.'
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'flash-lite');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.equal(analysis.growthFrames.length, 2);
  assert.equal(analysis.growthFrames[0].frameId, '1');
  assert.equal(analysis.growthFrames[0].workspaceForest[0].id, 'cp_root');
  assert.equal(analysis.tree.id, 'cp_root');
  assert.equal(findNodeById(analysis.tree, 'subj_d')?.word, 'The');
  assert.equal(findNodeById(analysis.tree, 'obj_n')?.word, 'pig');
  assert.equal(analysis.noteBindings[0].text, 'The clause projects a CP over InflP with an overt VP predicate.');
});

test('parseModelJson rejects malformed syntax-node JSON instead of repairing it', () => {
  const raw = `{
    "growthFrames": [
      {
        "frameId": "f1",
        "operation": "ExternalMerge",
        "workspaceForest": {
          "nodeId": "root",
          "label": "VP",
          "children": [
            {
              "nodeId": "n1",
              "label": "DP",
              "children": [
                {
                  "nodeId": "n2",
                  "label": "D'",
                  "children": [
                    {
                      "nodeId": "n3",
                      "label": "D",
                      "children": [
                        { "nodeId": "n4", "label": "Which", "tokenIndex": 0 }
                      ]
                    },
                    {
                      "nodeId": "n5",
                      "label": "NP",
                      "children": [
                        {
                          "nodeId": "n6",
                          "label": "N",
                          {
                            "nodeId": "n7",
                            "label": "pig",
                            "tokenIndex": 1
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    ],
    "noteBindings": [
      {
        "kind": "architecture",
        "text": "The clause projects a CP over an interrogative dependency."
      }
    ]
  }`;

  assert.throws(
    () => parseModelJson(raw),
    (error) =>
      error instanceof ParseApiError
      && error.code === 'BAD_MODEL_RESPONSE'
  );
});

test('normalizeParseBundle preserves the model explanation before the final Pro notes pass runs', () => {
  const sentence = 'The farmer ate the pig';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            stepId: 'g1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'vp_low',
                label: 'VP',
                children: [
                  {
                    id: 'subj_low',
                    label: 'DP',
                    children: [
                      {
                        id: 'subj_low_bar',
                        label: "D'",
                        children: [
                          { id: 'subj_low_d', label: 'D', word: 'The', tokenIndex: 0 },
                          {
                            id: 'subj_low_np',
                            label: 'NP',
                            children: [
                              {
                                id: 'subj_low_nbar',
                                label: "N'",
                                children: [{ id: 'subj_low_n', label: 'N', word: 'farmer', tokenIndex: 1 }]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'vbar_low',
                    label: "V'",
                    children: [
                      { id: 'v_low', label: 'V', word: 'ate', tokenIndex: 2 },
                      {
                        id: 'obj_low',
                        label: 'DP',
                        children: [
                          {
                            id: 'obj_low_bar',
                            label: "D'",
                            children: [
                              { id: 'obj_low_d', label: 'D', word: 'the', tokenIndex: 3 },
                              {
                                id: 'obj_low_np',
                                label: 'NP',
                                children: [
                                  {
                                    id: 'obj_low_nbar',
                                    label: "N'",
                                    children: [{ id: 'obj_low_n', label: 'N', word: 'pig', tokenIndex: 4 }]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'g2',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'cp',
                label: 'CP',
                children: [
                  {
                    id: 'cbar',
                    label: "C'",
                    children: [
                      { id: 'c', label: 'C', word: '∅' },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          {
                            id: 'subj_high',
                            label: 'DP',
                            children: [
                              {
                                id: 'subj_high_bar',
                                label: "D'",
                                children: [
                                  { id: 'subj_high_d', label: 'D', word: 'The', tokenIndex: 0 },
                                  {
                                    id: 'subj_high_np',
                                    label: 'NP',
                                    children: [
                                      {
                                        id: 'subj_high_nbar',
                                        label: "N'",
                                        children: [{ id: 'subj_high_n', label: 'N', word: 'farmer', tokenIndex: 1 }]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'inflbar',
                            label: "Infl'",
                            children: [
                              { id: 'infl', label: 'Infl', word: '∅' },
                              {
                                id: 'vp',
                                label: 'VP',
                                children: [
                                  {
                                    id: 'subj_trace',
                                    label: 'DP',
                                    children: [{ id: 'subj_trace_d', label: 'D', word: 't₁' }]
                                  },
                                  {
                                    id: 'vbar',
                                    label: "V'",
                                    children: [
                                      { id: 'v', label: 'V', word: 'ate', tokenIndex: 2 },
                                      {
                                        id: 'obj',
                                        label: 'DP',
                                        children: [
                                          {
                                            id: 'obj_bar',
                                            label: "D'",
                                            children: [
                                              { id: 'obj_d', label: 'D', word: 'the', tokenIndex: 3 },
                                              {
                                                id: 'obj_np',
                                                label: 'NP',
                                                children: [
                                                  {
                                                    id: 'obj_nbar',
                                                    label: "N'",
                                                    children: [{ id: 'obj_n', label: 'N', word: 'pig', tokenIndex: 4 }]
                                                  }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'g3',
            operation: 'SpellOut',
            reusePreviousWorkspace: true,
            spelloutOrder: ['The', 'farmer', 'ate', 'the', 'pig']
          }
        ],
        explanation: 'This stale model explanation should not be shown on the Pro growth path.'
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.ok(Array.isArray(analysis.noteBindings));
  assert.equal(analysis.noteBindings.length, 0);
  assert.notEqual(analysis.explanation, 'This stale model explanation should not be shown on the Pro growth path.');
  assert.match(analysis.explanation, /committed X-bar analysis/i);
});

test('validateFinalProNoteBindings rejects final Pro analyses whose noteBindings remain empty', () => {
  const bundle = {
    analyses: [
      {
        explanation: 'A stale explanation should not replace structured notes on final Pro output.',
        noteBindings: [],
        provenance: { treeSource: 'growthFrames', notesSecondPass: true }
      }
    ]
  };

  assert.throws(
    () => validateFinalProNoteBindings(bundle),
    (error) => {
      assert.ok(error instanceof ParseApiError);
      assert.equal(error.code, 'BAD_MODEL_RESPONSE');
      assert.match(error.message, /must include non-empty model-authored noteBindings/i);
      return true;
    }
  );
});

test('validateFinalProNoteBindings accepts final Pro analyses once structured noteBindings are present', () => {
  const bundle = {
    analyses: [
      {
        explanation: 'This explanation can coexist with structured notes, but not replace them.',
        noteBindings: [
          {
            kind: 'architecture',
            text: 'The clause projects a CP over InflP and anchors the derivation to the committed structure.'
          }
        ],
        provenance: { treeSource: 'growthFrames', notesSecondPass: true }
      }
    ]
  };

  assert.equal(validateFinalProNoteBindings(bundle), bundle);
});

test('normalizeParseBundle preserves model-authored chain notes even when local chain ids do not map cleanly onto the richer canonical chain ledger', () => {
  const sentence = 'John seems to like Mary.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'cbar',
                    label: "C'",
                    children: [
                      { id: 'c_head', label: 'C', word: '∅' },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          {
                            id: 'inflbar',
                            label: "Infl'",
                            children: [
                              { id: 'infl_head', label: 'Infl', word: 'seems', tokenIndex: 1 },
                              {
                                id: 'vp_matrix',
                                label: 'VP',
                                children: [
                                  {
                                    id: 'subj_low',
                                    label: 'DP',
                                    children: [{ id: 'john_low', label: 'John', word: 'John', tokenIndex: 0 }]
                                  },
                                  {
                                    id: 'vbar_matrix',
                                    label: "V'",
                                    children: [
                                      { id: 'trace_subj', label: 't_subj' },
                                      {
                                        id: 'inflp_emb',
                                        label: 'InflP',
                                        children: [
                                          { id: 'infl_emb', label: 'Infl', word: 'to', tokenIndex: 2 },
                                          {
                                            id: 'vp_emb',
                                            label: 'VP',
                                            children: [
                                              {
                                                id: 'vbar_emb',
                                                label: "V'",
                                                children: [
                                                  { id: 'v_like', label: 'V', word: 'like', tokenIndex: 3 },
                                                  {
                                                    id: 'obj_dp',
                                                    label: 'DP',
                                                    children: [{ id: 'mary', label: 'Mary', word: 'Mary', tokenIndex: 4 }]
                                                  }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            frameId: 'f2',
            operation: 'A-Move',
            movement: {
              sourceNodeId: 'trace_subj',
              targetNodeId: 'subj_high',
              operation: 'A-Move'
            },
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'cbar',
                    label: "C'",
                    children: [
                      { id: 'c_head', label: 'C', word: '∅' },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          {
                            id: 'subj_high',
                            label: 'DP',
                            children: [{ id: 'john_high', label: 'John', word: 'John', tokenIndex: 0 }]
                          },
                          {
                            id: 'inflbar',
                            label: "Infl'",
                            children: [
                              { id: 'infl_head', label: 'Infl', word: 'seems', tokenIndex: 1 },
                              {
                                id: 'vp_matrix',
                                label: 'VP',
                                children: [
                                  { id: 'trace_subj', label: 't_subj' },
                                  {
                                    id: 'vbar_matrix',
                                    label: "V'",
                                    children: [
                                      {
                                        id: 'inflp_emb',
                                        label: 'InflP',
                                        children: [
                                          { id: 'infl_emb', label: 'Infl', word: 'to', tokenIndex: 2 },
                                          {
                                            id: 'vp_emb',
                                            label: 'VP',
                                            children: [
                                              {
                                                id: 'vbar_emb',
                                                label: "V'",
                                                children: [
                                                  { id: 'v_like', label: 'V', word: 'like', tokenIndex: 3 },
                                                  {
                                                    id: 'obj_dp',
                                                    label: 'DP',
                                                    children: [{ id: 'mary', label: 'Mary', word: 'Mary', tokenIndex: 4 }]
                                                  }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          {
            kind: 'architecture',
            text: 'The matrix clause selects an infinitival complement headed by to.',
            stepIds: ['s1'],
            supportIds: ['sel_matrix_inf']
          },
          {
            kind: 'chain',
            chainId: 'c1',
            stepIds: ['s1'],
            text: 'John raises from the embedded clause to the matrix Spec,InflP.'
          }
        ],
        selectionLedger: [
          {
            selectionId: 'sel_matrix_inf',
            selectorHead: 'V (seems)',
            selectedCategory: 'InflP',
            selectedLabel: 'to like Mary',
            relation: 'complement'
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'flash-lite');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.equal(analysis.chains.length, 0);
  assert.equal(analysis.noteBindings.length, 2);
  assert.equal(analysis.noteBindings[1].kind, 'chain');
  assert.equal(analysis.noteBindings[1].text, 'John raises from the embedded clause to the matrix Spec,InflP.');
  assert.equal(analysis.noteBindings[1].chainId, 'c1');
});

test('normalizeParseBundle preserves model-authored chain notes even when no canonical chain ledger is derived yet', () => {
  const sentence = 'Which pig did the farmer eat?';
  const normalized = normalizeParseBundle({
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            operation: 'ExternalMerge',
            workspaceForest: {
              nodeId: 'vp_root',
              label: 'VP',
              children: [
                {
                  nodeId: 'v_bar',
                  label: "V'",
                  children: [
                    { nodeId: 'v_head', label: 'V', children: [{ label: 'eat', tokenIndex: 5 }] },
                    {
                      nodeId: 'obj_dp',
                      label: 'DP',
                      children: [
                        {
                          nodeId: 'obj_dbar',
                          label: "D'",
                          children: [
                            { nodeId: 'obj_d', label: 'D', children: [{ label: 'Which', tokenIndex: 0 }] },
                            { nodeId: 'obj_np', label: 'NP', children: [{ nodeId: 'obj_n', label: 'N', children: [{ label: 'pig', tokenIndex: 1 }] }] }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          },
          {
            frameId: 'f2',
            operation: 'HeadMove',
            movement: {
              operation: 'HeadMove',
              sourceNodeId: 'infl_trace',
              targetNodeId: 'c_overt',
              note: 'The auxiliary did moves from Infl to C.'
            },
            workspaceForest: {
              nodeId: 'cp_headmove',
              label: 'CP',
              children: [
                {
                  nodeId: 'c_prime_headmove',
                  label: "C'",
                  children: [
                    { nodeId: 'c_overt', label: 'C', children: [{ label: 'did', tokenIndex: 2 }] },
                    {
                      nodeId: 'inflp_headmove',
                      label: 'InflP',
                      children: [
                        {
                          nodeId: 'subj_dp_headmove',
                          label: 'DP',
                          children: [
                            {
                              nodeId: 'subj_dbar_headmove',
                              label: "D'",
                              children: [
                                { nodeId: 'subj_d_headmove', label: 'D', children: [{ label: 'the', tokenIndex: 3 }] },
                                { nodeId: 'subj_np_headmove', label: 'NP', children: [{ nodeId: 'subj_n_headmove', label: 'N', children: [{ label: 'farmer', tokenIndex: 4 }] }] }
                              ]
                            }
                          ]
                        },
                        {
                          nodeId: 'infl_prime_headmove',
                          label: "Infl'",
                          children: [
                            { nodeId: 'infl_trace', label: 'Infl', children: [{ label: 't_did' }] },
                            {
                              nodeId: 'vp_headmove',
                              label: 'VP',
                              children: [
                                {
                                  nodeId: 'vbar_headmove',
                                  label: "V'",
                                  children: [
                                    { nodeId: 'v_headmove', label: 'V', children: [{ label: 'eat', tokenIndex: 5 }] },
                                    {
                                      nodeId: 'obj_dp_headmove',
                                      label: 'DP',
                                      children: [
                                        {
                                          nodeId: 'obj_dbar_headmove',
                                          label: "D'",
                                          children: [
                                            { nodeId: 'obj_d_headmove', label: 'D', children: [{ label: 'Which', tokenIndex: 0 }] },
                                            { nodeId: 'obj_np_headmove', label: 'NP', children: [{ nodeId: 'obj_n_headmove', label: 'N', children: [{ label: 'pig', tokenIndex: 1 }] }] }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          },
          {
            frameId: 'f3',
            operation: 'AbarMove',
            movement: {
              operation: 'AbarMove',
              sourceNodeId: 'trace_obj',
              targetNodeId: 'spec_cp',
              note: 'The object DP moves to Spec,CP.'
            },
            workspaceForest: {
              nodeId: 'cp_root',
              label: 'CP',
              children: [
                {
                  nodeId: 'spec_cp',
                  label: 'DP',
                  children: [
                    {
                      nodeId: 'spec_dbar',
                      label: "D'",
                      children: [
                        { nodeId: 'spec_d', label: 'D', children: [{ label: 'Which', tokenIndex: 0 }] },
                        { nodeId: 'spec_np', label: 'NP', children: [{ nodeId: 'spec_n', label: 'N', children: [{ label: 'pig', tokenIndex: 1 }] }] }
                      ]
                    }
                  ]
                },
                {
                  nodeId: 'c_prime',
                  label: "C'",
                  children: [
                    { nodeId: 'c_head', label: 'C', children: [{ label: 'did', tokenIndex: 2 }] },
                    {
                      nodeId: 'inflp',
                      label: 'InflP',
                      children: [
                        {
                          nodeId: 'subj_dp',
                          label: 'DP',
                          children: [
                            { nodeId: 'subj_d', label: 'D', children: [{ label: 'the', tokenIndex: 3 }] },
                            { nodeId: 'subj_n', label: 'N', children: [{ label: 'farmer', tokenIndex: 4 }] }
                          ]
                        },
                        {
                          nodeId: 'infl_prime',
                          label: "Infl'",
                          children: [
                            { nodeId: 'infl', label: 'Infl', children: [{ label: 't_did' }] },
                            {
                              nodeId: 'vp_final',
                              label: 'VP',
                              children: [
                                {
                                  nodeId: 'vbar_final',
                                  label: "V'",
                                  children: [
                                    { nodeId: 'v_final', label: 'V', children: [{ label: 'eat', tokenIndex: 5 }] },
                                    { nodeId: 'trace_obj', label: 't_obj' }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'The clause projects a CP with an interrogative clause edge.' },
          { kind: 'chain', chainId: 'wh-movement', text: 'The object DP Which pig undergoes A-bar movement to Spec,CP.' },
          { kind: 'chain', chainId: 'head-movement', text: 'The auxiliary did moves to C and leaves a lower copy in Infl.' }
        ]
      }
    ]
  }, 'xbar', sentence, 'flash-lite');

  const analysis = normalized.analyses[0];
  assert.equal(analysis.noteBindings.length, 3);
  assert.equal(analysis.noteBindings[1].kind, 'chain');
  assert.equal(analysis.noteBindings[1].chainId, 'wh-movement');
  assert.equal(analysis.noteBindings[2].chainId, 'head-movement');
});

test('normalizeParseBundle ignores silent feature leaves such as PRO and past when selecting the committed growth frame', () => {
  const sentence = 'John promised Mary to leave.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'cbar',
                    label: "C'",
                    children: [
                      { id: 'c_head', label: 'C', word: '∅' },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          {
                            id: 'subj_dp',
                            label: 'DP',
                            children: [{ id: 'john', label: 'John', word: 'John', tokenIndex: 0 }]
                          },
                          {
                            id: 'inflbar',
                            label: "Infl'",
                            children: [
                              {
                                id: 'infl_head',
                                label: 'Infl',
                                children: [{ id: 'infl_feat', label: 'past' }]
                              },
                              {
                                id: 'vp',
                                label: 'VP',
                                children: [
                                  { id: 'v_promised', label: 'V', word: 'promised', tokenIndex: 1 },
                                  {
                                    id: 'obj_dp',
                                    label: 'DP',
                                    children: [{ id: 'mary', label: 'Mary', word: 'Mary', tokenIndex: 2 }]
                                  },
                                  {
                                    id: 'cp_inf',
                                    label: 'CP',
                                    children: [
                                      { id: 'c_inf', label: 'C', word: 'to', tokenIndex: 3 },
                                      {
                                        id: 'inflp_inf',
                                        label: 'InflP',
                                        children: [
                                          { id: 'pro_subj', label: 'PRO' },
                                          {
                                            id: 'vp_inf',
                                            label: 'VP',
                                            children: [
                                              { id: 'v_leave', label: 'V', word: 'leave', tokenIndex: 4 }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          {
            kind: 'architecture',
            text: 'The matrix clause selects an infinitival complement with a silent PRO subject.',
            stepIds: ['f1'],
            supportIds: ['sel_promise_inf']
          }
        ],
        selectionLedger: [
          {
            selectionId: 'sel_promise_inf',
            selectorHead: 'V (promised)',
            selectedCategory: 'CP',
            selectedLabel: 'to leave',
            relation: 'complement'
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'flash-lite');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.deepEqual(analysis.surfaceOrder, ['John', 'promised', 'Mary', 'to', 'leave']);
  assert.equal(findNodeById(analysis.tree, 'pro_subj')?.label, 'PRO');
});

test('normalizeParseBundle canonicalizes suffixed null markers like ∅_Q inside pro growthFrames', () => {
  const sentence = 'রিমা কিনেছে';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'vp',
                label: 'VP',
                children: [
                  {
                    id: 'dp_subj_base',
                    label: 'DP',
                    children: [
                      { id: 'subj_word', label: 'রিমা', word: 'রিমা', tokenIndex: 0 }
                    ]
                  },
                  {
                    id: 'v_head',
                    label: 'V',
                    children: [
                      { id: 'v_word', label: 'কিনেছে', word: 'কিনেছে', tokenIndex: 1 }
                    ]
                  }
                ]
              }
            ]
          },
          {
            frameId: 'f2',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'inflp',
                label: 'InflP',
                children: [
                  {
                    id: 'dp_subj_base',
                    label: 'DP',
                    children: [
                      { id: 'subj_word', label: 'রিমা', word: 'রিমা', tokenIndex: 0 }
                    ]
                  },
                  {
                    id: 'infl_bar',
                    label: "Infl'",
                    children: [
                      {
                        id: 'infl_head',
                        label: 'Infl',
                        children: [
                          { id: 'infl_null', label: '∅' }
                        ]
                      },
                      {
                        id: 'vp',
                        label: 'VP',
                        children: [
                          {
                            id: 't_subj',
                            label: 'DP',
                            children: [
                              { id: 't_subj_leaf', label: 't_subj' }
                            ]
                          },
                          {
                            id: 'v_head',
                            label: 'V',
                            children: [
                              { id: 'v_word', label: 'কিনেছে', word: 'কিনেছে', tokenIndex: 1 }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            frameId: 'f3',
            operation: 'SpellOut',
            workspaceForest: [
              {
                id: 'cp',
                label: 'CP',
                children: [
                  {
                    id: 'c_bar',
                    label: "C'",
                    children: [
                      {
                        id: 'c_head',
                        label: 'C',
                        children: [
                          { id: 'c_null', label: '∅_Q' }
                        ]
                      },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          {
                            id: 'dp_subj_landed',
                            label: 'DP',
                            children: [
                              { id: 'subj_word_top', label: 'রিমা', word: 'রিমা', tokenIndex: 0 }
                            ]
                          },
                          {
                            id: 'infl_bar',
                            label: "Infl'",
                            children: [
                              {
                                id: 'infl_head',
                                label: 'Infl',
                                children: [
                                  { id: 'infl_null_top', label: '∅' }
                                ]
                              },
                              {
                                id: 'vp',
                                label: 'VP',
                                children: [
                                  {
                                    id: 't_subj_top',
                                    label: 'DP',
                                    children: [
                                      { id: 't_subj_leaf_top', label: 't_subj' }
                                    ]
                                  },
                                  {
                                    id: 'v_head_top',
                                    label: 'V',
                                    children: [
                                      { id: 'v_word_top', label: 'কিনেছে', word: 'কিনেছে', tokenIndex: 1 }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          {
            kind: 'architecture',
            text: 'The clause projects to CP with a covert interrogative complementizer.',
            supportIds: ['sel_c']
          }
        ],
        caseAssignments: [
          {
            assignmentId: 'case_subj',
            nodeId: 'dp_subj_landed',
            case: 'Nominative',
            assigner: 'Infl'
          }
        ],
        argumentStructure: [
          {
            argumentId: 'arg_subj',
            nodeId: 'dp_subj_landed',
            role: 'Agent',
            predicate: 'কিনেছে'
          }
        ],
        selectionLedger: [
          {
            selectionId: 'sel_c',
            selectorHead: 'C',
            selectedCategory: 'InflP',
            complementNodeId: 'inflp'
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro', true);
  const analysis = normalized.analyses[0];

  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.deepEqual(analysis.surfaceOrder, ['রিমা', 'কিনেছে']);
  assert.equal(findNodeById(analysis.tree, 'c_null')?.label, '∅');
});

test('normalizeParseBundle preserves move-frame source ids from the previous Growth state and recovers the lower trace canonically', () => {
  const sentence = 'The farmer ate the pig';
  const payload = {
    analyses: [
      {
        movementDecision: {
          hasMovement: true,
          rationale: 'The thematic subject is first merged low and then raises.'
        },
        growthFrames: [
          {
            stepId: 'gf1',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'cp_low',
                label: 'CP',
                children: [
                  { id: 'c_low', label: 'C', word: '∅' },
                  {
                    id: 'inflp_low',
                    label: 'InflP',
                    children: [
                      {
                        id: 'subj_low',
                        label: 'DP',
                        children: [
                          {
                            id: 'subj_low_bar',
                            label: "D'",
                            children: [
                              { id: 'subj_low_d', label: 'D', word: 'The' },
                              {
                                id: 'subj_low_np',
                                label: 'NP',
                                children: [
                                  {
                                    id: 'subj_low_nbar',
                                    label: "N'",
                                    children: [{ id: 'subj_low_n', label: 'N', word: 'farmer' }]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      },
                      {
                        id: 'inflbar_low',
                        label: "Infl'",
                        children: [
                          { id: 'infl_low', label: 'Infl', word: '∅' },
                          {
                            id: 'vp_low',
                            label: 'VP',
                            children: [
                              {
                                id: 'vbar_low',
                                label: "V'",
                                children: [
                                  { id: 'v_low', label: 'V', word: 'ate' },
                                  {
                                    id: 'obj_low',
                                    label: 'DP',
                                    children: [
                                      {
                                        id: 'obj_low_bar',
                                        label: "D'",
                                        children: [
                                          { id: 'obj_low_d', label: 'D', word: 'the' },
                                          {
                                            id: 'obj_low_np',
                                            label: 'NP',
                                            children: [
                                              {
                                                id: 'obj_low_nbar',
                                                label: "N'",
                                                children: [{ id: 'obj_low_n', label: 'N', word: 'pig' }]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'gf2',
            operation: 'A-Move',
            movement: {
              operation: 'A-Move',
              sourceNodeId: 'subj_low',
              targetNodeId: 'subj_high',
              note: 'The subject raises to Spec,InflP.'
            },
            workspaceForest: [
              {
                id: 'cp_high',
                label: 'CP',
                children: [
                  { id: 'c_high', label: 'C', word: '∅' },
                  {
                    id: 'inflp_high',
                    label: 'InflP',
                    children: [
                      {
                        id: 'subj_high',
                        label: 'DP',
                        children: [
                          {
                            id: 'subj_high_bar',
                            label: "D'",
                            children: [
                              { id: 'subj_high_d', label: 'D', word: 'The' },
                              {
                                id: 'subj_high_np',
                                label: 'NP',
                                children: [
                                  {
                                    id: 'subj_high_nbar',
                                    label: "N'",
                                    children: [{ id: 'subj_high_n', label: 'N', word: 'farmer' }]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      },
                      {
                        id: 'inflbar_high',
                        label: "Infl'",
                        children: [
                          { id: 'infl_high', label: 'Infl', word: '∅' },
                          {
                            id: 'vp_high',
                            label: 'VP',
                            children: [
                              {
                                id: 'trace_subj',
                                label: 'DP',
                                children: [{ id: 'trace_subj_d', label: 'D', word: 't_1' }]
                              },
                              {
                                id: 'vbar_high',
                                label: "V'",
                                children: [
                                  { id: 'v_high', label: 'V', word: 'ate' },
                                  {
                                    id: 'obj_high',
                                    label: 'DP',
                                    children: [
                                      {
                                        id: 'obj_high_bar',
                                        label: "D'",
                                        children: [
                                          { id: 'obj_high_d', label: 'D', word: 'the' },
                                          {
                                            id: 'obj_high_np',
                                            label: 'NP',
                                            children: [
                                              {
                                                id: 'obj_high_nbar',
                                                label: "N'",
                                                children: [{ id: 'obj_high_n', label: 'N', word: 'pig' }]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'gf3',
            operation: 'SpellOut',
            reusePreviousWorkspace: true,
            spelloutOrder: ['The', 'farmer', 'ate', 'the', 'pig']
          }
        ],
        explanation: 'The subject is first merged low and then raises to Spec,InflP.'
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.growthFrames[1]?.movement?.sourceNodeId, 'subj_low');
  assert.deepEqual(
    analysis.movementEvents,
    [
      {
        operation: 'A-Move',
        fromNodeId: 'trace_subj',
        toNodeId: 'subj_high',
        traceNodeId: 'trace_subj',
        stepIndex: 1,
        note: 'The subject raises to Spec,InflP.'
      }
    ]
  );
});

test('normalizeParseBundle grounds successive raising moves against the replaced lower copies instead of unrelated null heads', () => {
  const sentence = 'John seems to like Mary.';
  const payload = {
    analyses: [
      {
        movementDecision: {
          hasMovement: true,
          rationale: 'John raises through the embedded subject position into the matrix subject position.'
        },
        growthFrames: [
          {
            stepId: 'gf1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'DP_Mary',
                label: 'DP',
                children: [{ id: 'Mary', label: 'Mary', word: 'Mary' }]
              }
            ]
          },
          {
            stepId: 'gf2',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'Vbar_emb',
                label: "V'",
                children: [
                  { id: 'V_like', label: 'V', children: [{ id: 'like', label: 'like', word: 'like' }] },
                  { id: 'DP_Mary', label: 'DP', children: [{ id: 'Mary', label: 'Mary', word: 'Mary' }] }
                ]
              }
            ]
          },
          {
            stepId: 'gf3',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'VP_emb',
                label: 'VP',
                children: [
                  {
                    id: 'DP_John',
                    label: 'DP',
                    children: [{ id: 'John', label: 'John', word: 'John' }]
                  },
                  {
                    id: 'Vbar_emb',
                    label: "V'",
                    children: [
                      { id: 'V_like', label: 'V', children: [{ id: 'like', label: 'like', word: 'like' }] },
                      { id: 'DP_Mary', label: 'DP', children: [{ id: 'Mary', label: 'Mary', word: 'Mary' }] }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'gf4',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'Inflbar_emb',
                label: "Infl'",
                children: [
                  { id: 'Infl_to', label: 'Infl', children: [{ id: 'to', label: 'to', word: 'to' }] },
                  {
                    id: 'VP_emb',
                    label: 'VP',
                    children: [
                      {
                        id: 'DP_John',
                        label: 'DP',
                        children: [{ id: 'John', label: 'John', word: 'John' }]
                      },
                      {
                        id: 'Vbar_emb',
                        label: "V'",
                        children: [
                          { id: 'V_like', label: 'V', children: [{ id: 'like', label: 'like', word: 'like' }] },
                          { id: 'DP_Mary', label: 'DP', children: [{ id: 'Mary', label: 'Mary', word: 'Mary' }] }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'gf5',
            operation: 'A-Move',
            chainId: 'chain_John',
            movement: {
              operation: 'A-Move',
              sourceNodeId: 'DP_John',
              targetNodeId: 'DP_John_copy1',
              note: 'John moves to embedded Spec,InflP.'
            },
            workspaceForest: [
              {
                id: 'InflP_emb',
                label: 'InflP',
                children: [
                  {
                    id: 'DP_John_copy1',
                    label: 'DP',
                    children: [{ id: 'John_copy1', label: 'John', word: 'John' }]
                  },
                  {
                    id: 'Inflbar_emb',
                    label: "Infl'",
                    children: [
                      { id: 'Infl_to', label: 'Infl', children: [{ id: 'to', label: 'to', word: 'to' }] },
                      {
                        id: 'VP_emb',
                        label: 'VP',
                        children: [
                          { id: 't_1', label: 't_1' },
                          {
                            id: 'Vbar_emb',
                            label: "V'",
                            children: [
                              { id: 'V_like', label: 'V', children: [{ id: 'like', label: 'like', word: 'like' }] },
                              { id: 'DP_Mary', label: 'DP', children: [{ id: 'Mary', label: 'Mary', word: 'Mary' }] }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'gf6',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'VP_mat',
                label: 'VP',
                children: [
                  {
                    id: 'Vbar_mat',
                    label: "V'",
                    children: [
                      { id: 'V_seems', label: 'V', children: [{ id: 'seems', label: 'seems', word: 'seems' }] },
                      {
                        id: 'InflP_emb',
                        label: 'InflP',
                        children: [
                          {
                            id: 'DP_John_copy1',
                            label: 'DP',
                            children: [{ id: 'John_copy1', label: 'John', word: 'John' }]
                          },
                          {
                            id: 'Inflbar_emb',
                            label: "Infl'",
                            children: [
                              { id: 'Infl_to', label: 'Infl', children: [{ id: 'to', label: 'to', word: 'to' }] },
                              {
                                id: 'VP_emb',
                                label: 'VP',
                                children: [
                                  { id: 't_1', label: 't_1' },
                                  {
                                    id: 'Vbar_emb',
                                    label: "V'",
                                    children: [
                                      { id: 'V_like', label: 'V', children: [{ id: 'like', label: 'like', word: 'like' }] },
                                      { id: 'DP_Mary', label: 'DP', children: [{ id: 'Mary', label: 'Mary', word: 'Mary' }] }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'gf7',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'Inflbar_mat',
                label: "Infl'",
                children: [
                  { id: 'Infl_mat', label: 'Infl', children: [{ id: 'Infl_mat_null', label: '∅' }] },
                  {
                    id: 'VP_mat',
                    label: 'VP',
                    children: [
                      {
                        id: 'Vbar_mat',
                        label: "V'",
                        children: [
                          { id: 'V_seems', label: 'V', children: [{ id: 'seems', label: 'seems', word: 'seems' }] },
                          {
                            id: 'InflP_emb',
                            label: 'InflP',
                            children: [
                              {
                                id: 'DP_John_copy1',
                                label: 'DP',
                                children: [{ id: 'John_copy1', label: 'John', word: 'John' }]
                              },
                              {
                                id: 'Inflbar_emb',
                                label: "Infl'",
                                children: [
                                  { id: 'Infl_to', label: 'Infl', children: [{ id: 'to', label: 'to', word: 'to' }] },
                                  {
                                    id: 'VP_emb',
                                    label: 'VP',
                                    children: [
                                      { id: 't_1', label: 't_1' },
                                      {
                                        id: 'Vbar_emb',
                                        label: "V'",
                                        children: [
                                          { id: 'V_like', label: 'V', children: [{ id: 'like', label: 'like', word: 'like' }] },
                                          { id: 'DP_Mary', label: 'DP', children: [{ id: 'Mary', label: 'Mary', word: 'Mary' }] }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'gf8',
            operation: 'A-Move',
            chainId: 'chain_John',
            movement: {
              operation: 'A-Move',
              sourceNodeId: 'DP_John_copy1',
              targetNodeId: 'DP_John_copy2',
              note: 'John moves to matrix Spec,InflP.'
            },
            workspaceForest: [
              {
                id: 'InflP_mat',
                label: 'InflP',
                children: [
                  {
                    id: 'DP_John_copy2',
                    label: 'DP',
                    children: [{ id: 'John_copy2', label: 'John', word: 'John' }]
                  },
                  {
                    id: 'Inflbar_mat',
                    label: "Infl'",
                    children: [
                      { id: 'Infl_mat', label: 'Infl', children: [{ id: 'Infl_mat_null', label: '∅' }] },
                      {
                        id: 'VP_mat',
                        label: 'VP',
                        children: [
                          {
                            id: 'Vbar_mat',
                            label: "V'",
                            children: [
                              { id: 'V_seems', label: 'V', children: [{ id: 'seems', label: 'seems', word: 'seems' }] },
                              {
                                id: 'InflP_emb',
                                label: 'InflP',
                                children: [
                                  { id: 't_2', label: 't_2' },
                                  {
                                    id: 'Inflbar_emb',
                                    label: "Infl'",
                                    children: [
                                      { id: 'Infl_to', label: 'Infl', children: [{ id: 'to', label: 'to', word: 'to' }] },
                                      {
                                        id: 'VP_emb',
                                        label: 'VP',
                                        children: [
                                          { id: 't_1', label: 't_1' },
                                          {
                                            id: 'Vbar_emb',
                                            label: "V'",
                                            children: [
                                              { id: 'V_like', label: 'V', children: [{ id: 'like', label: 'like', word: 'like' }] },
                                              { id: 'DP_Mary', label: 'DP', children: [{ id: 'Mary', label: 'Mary', word: 'Mary' }] }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'gf9',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'CP_mat',
                label: 'CP',
                children: [
                  { id: 'C_mat', label: 'C', children: [{ id: 'C_mat_null', label: '∅' }] },
                  {
                    id: 'InflP_mat',
                    label: 'InflP',
                    children: [
                      {
                        id: 'DP_John_copy2',
                        label: 'DP',
                        children: [{ id: 'John_copy2', label: 'John', word: 'John' }]
                      },
                      {
                        id: 'Inflbar_mat',
                        label: "Infl'",
                        children: [
                          { id: 'Infl_mat', label: 'Infl', children: [{ id: 'Infl_mat_null', label: '∅' }] },
                          {
                            id: 'VP_mat',
                            label: 'VP',
                            children: [
                              {
                                id: 'Vbar_mat',
                                label: "V'",
                                children: [
                                  { id: 'V_seems', label: 'V', children: [{ id: 'seems', label: 'seems', word: 'seems' }] },
                                  {
                                    id: 'InflP_emb',
                                    label: 'InflP',
                                    children: [
                                      { id: 't_2', label: 't_2' },
                                      {
                                        id: 'Inflbar_emb',
                                        label: "Infl'",
                                        children: [
                                          { id: 'Infl_to', label: 'Infl', children: [{ id: 'to', label: 'to', word: 'to' }] },
                                          {
                                            id: 'VP_emb',
                                            label: 'VP',
                                            children: [
                                              { id: 't_1', label: 't_1' },
                                              {
                                                id: 'Vbar_emb',
                                                label: "V'",
                                                children: [
                                                  { id: 'V_like', label: 'V', children: [{ id: 'like', label: 'like', word: 'like' }] },
                                                  { id: 'DP_Mary', label: 'DP', children: [{ id: 'Mary', label: 'Mary', word: 'Mary' }] }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'John raises through the embedded subject position into the matrix subject position.', stepIds: ['s5', 's8'], chainId: 'chain_John', order: 0 }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro');
  const analysis = normalized.analyses[0];

  assert.deepEqual(
    analysis.movementEvents,
    [
      {
        operation: 'A-Move',
        fromNodeId: 't_1',
        toNodeId: 't_2',
        traceNodeId: 't_1',
        chainId: 'chain_John',
        stepIndex: 4,
        note: 'John moves to embedded Spec,InflP.'
      },
      {
        operation: 'A-Move',
        fromNodeId: 't_2',
        toNodeId: 'DP_John_copy2',
        traceNodeId: 't_2',
        chainId: 'chain_John',
        stepIndex: 7,
        note: 'John moves to matrix Spec,InflP.'
      }
    ]
  );
  assert.equal(analysis.chains.length, 0);
});

test('normalizeParseBundle assigns derivation step ids and preserves lightweight step metadata', () => {
  const sentence = 'Who bought the book?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [{ id: 'n3', label: 'who', word: 'Who' }]
            },
            {
              id: 'n4',
              label: 'TP',
              children: [
                {
                  id: 'n5',
                  label: 'T',
                  children: [{ id: 'n6', label: 'bought', word: 'bought' }]
                },
                {
                  id: 'n7',
                  label: 'DP',
                  children: [
                    { id: 'n8', label: 'D', children: [{ id: 'n9', label: 'the', word: 'the' }] },
                    { id: 'n10', label: 'N', children: [{ id: 'n11', label: 'book', word: 'book' }] }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A simple clause with a fronted wh phrase.',
        movementDecision: {
          hasMovement: false,
          rationale: 'No movement is explicitly committed in this test payload.'
        },
        movementEvents: [],
        derivationSteps: [
          {
            operation: 'ExternalMerge',
            targetNodeId: 'n1',
            sourceNodeIds: ['n2', 'n4'],
            trigger: 'clause-build',
            chainId: 'ch1',
            note: 'Merge the subject edge and TP into CP.'
          },
          {
            operation: 'SpellOut',
            targetNodeId: 'n1',
            spelloutDomain: 'CP'
          }
        ]
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  const analysis = normalized.analyses[0];
  const mergeStep = analysis.derivationSteps.find((step) => step.targetNodeId === 'n1' && step.operation === 'ExternalMerge');
  const spelloutStep = analysis.derivationSteps.at(-1);

  assert.ok(analysis.derivationSteps.every((step, index) => step.stepId === `s${index + 1}`));
  assert.equal(mergeStep.trigger, 'clause-build');
  assert.equal(mergeStep.chainId, 'ch1');
  assert.equal(spelloutStep.operation, 'SpellOut');
  assert.equal(spelloutStep.spelloutDomain, 'CP');
});

test('normalizeParseBundle preserves explicit case metadata on committed nodes', () => {
  const sentence = 'pit’ín-im páa’yaxˆna picpíc-ne.';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'cp',
          label: 'CP',
          children: [
            {
              id: 'cbar',
              label: "C'",
              children: [
                { id: 'c', label: 'C', word: '∅' },
                {
                  id: 'inflp',
                  label: 'InflP',
                  children: [
                    {
                      id: 'subj',
                      label: 'DP',
                      case: 'ergative',
                      assigner: 'Infl',
                      caseEvidence: '-im',
                      caseOvert: true,
                      children: [
                        {
                          id: 'subj-bar',
                          label: "D'",
                          children: [{ id: 'subj-d', label: 'D', word: 'pit’ín-im', tokenIndex: 0 }]
                        }
                      ]
                    },
                    {
                      id: 'infl-bar',
                      label: "Infl'",
                      children: [
                        { id: 'infl', label: 'Infl', word: 'páa’yaxˆna', tokenIndex: 1 },
                        {
                          id: 'obj',
                          label: 'DP',
                          case: 'objective',
                          assigner: 'v',
                          caseEvidence: '-ne',
                          caseOvert: true,
                          children: [
                            {
                              id: 'obj-bar',
                              label: "D'",
                              children: [{ id: 'obj-d', label: 'D', word: 'picpíc-ne', tokenIndex: 2 }]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'The subject receives ergative case and the object receives objective case.'
      }
    ]
  };

  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  const analysis = normalized.analyses[0];
  const subject = findNodeById(analysis.tree, 'subj');
  const object = findNodeById(analysis.tree, 'obj');

  assert.equal(subject.case, 'ergative');
  assert.equal(subject.assigner, 'Infl');
  assert.equal(subject.caseEvidence, '-im');
  assert.equal(subject.caseOvert, true);
  assert.equal(object.case, 'objective');
  assert.equal(object.assigner, 'v');
  assert.equal(object.caseEvidence, '-ne');
  assert.equal(object.caseOvert, true);
});

test('normalizeParseBundle preserves richer structured ledgers for selection, binding, and clausal dependencies', () => {
  const sentence = 'John seems to like Mary.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            stepId: 'g1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  { id: 'c_root', label: 'C', word: '∅' },
                  {
                    id: 'inflp_matrix',
                    label: 'InflP',
                    children: [
                      {
                        id: 'dp_john_high',
                        label: 'DP',
                        children: [
                          {
                            id: 'dbar_john',
                            label: "D'",
                            children: [{ id: 'd_john', label: 'D', word: 'John', tokenIndex: 0 }]
                          }
                        ]
                      },
                      {
                        id: 'inflbar_matrix',
                        label: "Infl'",
                        children: [
                          { id: 'infl_matrix', label: 'Infl', word: '∅' },
                          {
                            id: 'vp_matrix',
                            label: 'VP',
                            children: [
                              { id: 'v_seems', label: 'V', word: 'seems', tokenIndex: 1 },
                              {
                                id: 'inflp_embedded',
                                label: 'InflP',
                                children: [
                                  { id: 'infl_to', label: 'Infl', word: 'to', tokenIndex: 2 },
                                  {
                                    id: 'vp_embedded',
                                    label: 'VP',
                                    children: [
                                      { id: 'trace_john', label: 'DP', children: [{ id: 'trace_john_d', label: 'D', word: 't₁' }] },
                                      { id: 'v_like', label: 'V', word: 'like', tokenIndex: 3 },
                                      {
                                        id: 'dp_mary',
                                        label: 'DP',
                                        children: [
                                          {
                                            id: 'dbar_mary',
                                            label: "D'",
                                            children: [{ id: 'd_mary', label: 'D', word: 'Mary', tokenIndex: 4 }]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          {
            kind: 'architecture',
            text: 'The matrix clause embeds a non-finite complement selected by the raising predicate.',
            stepIds: ['g1'],
            supportIds: ['sel1', 'dep1', 'pred1']
          }
        ],
        selectionLedger: [
          {
            selectionId: 'sel1',
            selectorNodeId: 'v_seems',
            selectorHead: 'seems',
            selectedNodeId: 'inflp_embedded',
            selectedCategory: 'InflP',
            relation: 'clausal-complement',
            note: 'The matrix predicate selects a non-finite InflP complement.'
          }
        ],
        bindingLedger: [
          {
            bindingId: 'bind1',
            domainNodeId: 'inflp_embedded',
            antecedentNodeId: 'dp_john_high',
            dependentNodeId: 'trace_john',
            relation: 'variable',
            principle: 'other',
            status: 'satisfied',
            note: 'The lower copy is interpreted as part of the same A-chain.'
          }
        ],
        clausalDependencies: [
          {
            dependencyId: 'dep1',
            type: 'raising',
            predicateNodeId: 'v_seems',
            clauseNodeId: 'inflp_embedded',
            dependentNodeId: 'dp_john_high',
            evidence: 'No external theta-role is assigned by the matrix predicate.',
            note: 'This is a raising configuration rather than control.'
          }
        ],
        agreementLedger: [
          {
            agreementId: 'agr1',
            probeNodeId: 'infl_matrix',
            goalNodeId: 'dp_john_high',
            probeLabel: 'Infl',
            goalLabel: 'John',
            feature: 'nominative/agreement',
            value: '3sg',
            status: 'valued'
          }
        ],
        predicateClassLedger: [
          {
            predicateClassId: 'pred1',
            predicateNodeId: 'v_seems',
            predicateLabel: 'seems',
            classification: 'raising',
            diagnostics: ['no matrix theta-role']
          }
        ],
        probeLedger: [
          {
            probeId: 'probe1',
            probeNodeId: 'infl_matrix',
            goalNodeId: 'dp_john_high',
            probeLabel: 'Infl',
            goalLabel: 'John',
            feature: 'phi',
            direction: 'downward',
            outcome: 'matched'
          }
        ],
        nullElementLedger: [
          {
            nullElementId: 'null1',
            nodeId: 'c_root',
            label: '∅',
            kind: 'silent-complementizer'
          }
        ],
        diagnosticLedger: [
          {
            diagnosticId: 'diag1',
            diagnostic: 'raising diagnostic',
            observation: 'matrix predicate assigns no theta-role to John',
            supports: 'raising'
          }
        ],
        parameterLedger: [
          {
            parameterId: 'param1',
            parameter: 'overt subject movement',
            value: 'required',
            domain: 'finite InflP'
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.selectionLedger?.[0]?.selectorNodeId, 'v_seems');
  assert.equal(analysis.selectionLedger?.[0]?.selectedNodeId, 'inflp_embedded');
  assert.equal(analysis.bindingLedger?.[0]?.domainNodeId, 'inflp_embedded');
  assert.equal(analysis.bindingLedger?.[0]?.dependentNodeId, 'trace_john');
  assert.equal(analysis.clausalDependencies?.[0]?.type, 'raising');
  assert.equal(analysis.clausalDependencies?.[0]?.predicateNodeId, 'v_seems');
  assert.equal(analysis.provenance?.hasSelectionLedger, true);
  assert.equal(analysis.provenance?.hasBindingLedger, true);
  assert.equal(analysis.provenance?.hasClausalDependencies, true);
  assert.equal(analysis.agreementLedger?.[0]?.goalNodeId, 'dp_john_high');
  assert.equal(analysis.predicateClassLedger?.[0]?.classification, 'raising');
  assert.equal(analysis.probeLedger?.[0]?.direction, 'downward');
  assert.equal(analysis.nullElementLedger?.[0]?.kind, 'silent-complementizer');
  assert.equal(analysis.diagnosticLedger?.[0]?.supports, 'raising');
  assert.equal(analysis.parameterLedger?.[0]?.parameter, 'overt subject movement');
  assert.equal(analysis.provenance?.hasAgreementLedger, true);
  assert.equal(analysis.provenance?.hasPredicateClassLedger, true);
  assert.equal(analysis.provenance?.hasProbeLedger, true);
  assert.equal(analysis.provenance?.hasNullElementLedger, true);
  assert.equal(analysis.provenance?.hasDiagnosticLedger, true);
  assert.equal(analysis.provenance?.hasParameterLedger, true);
});

test('normalizeParseBundle accepts object-shaped argument, selection, and clausal ledgers without dropping them', () => {
  const sentence = 'John promised Mary to leave.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'inflp_root',
                label: 'InflP',
                children: [
                  { id: 'dp_john', label: 'DP', children: [{ id: 'john_leaf', label: 'John', word: 'John', tokenIndex: 0 }] },
                  {
                    id: 'infl_bar',
                    label: "Infl'",
                    children: [
                      { id: 'infl_head', label: 'Infl', children: [{ id: 'infl_null', label: '∅' }] },
                      {
                        id: 'vp_root',
                        label: 'VP',
                        children: [
                          { id: 'v_promised', label: 'V', word: 'promised', tokenIndex: 1 },
                          { id: 'dp_mary', label: 'DP', children: [{ id: 'mary_leaf', label: 'Mary', word: 'Mary', tokenIndex: 2 }] },
                          {
                            id: 'cp_comp',
                            label: 'CP',
                            children: [
                              {
                                id: 'cbar_comp',
                                label: "C'",
                                children: [
                                  { id: 'c_to', label: 'C', word: 'to', tokenIndex: 3 },
                                  { id: 'inflp_emb', label: 'InflP', children: [{ id: 'pro_subj', label: 'DP', children: [{ id: 'pro_leaf', label: 'PRO' }] }, { id: 'vp_emb', label: 'VP', children: [{ id: 'v_leave', label: 'V', word: 'leave', tokenIndex: 4 }] }] }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          {
            kind: 'architecture',
            text: 'The matrix InflP contains a control infinitival complement headed by to.',
            stepIds: ['f1'],
            supportIds: ['selection_1', 'dependency_1']
          },
          {
            kind: 'licensing',
            text: 'John functions as the controller of the embedded PRO subject under subject-control.',
            stepIds: ['f1'],
            supportIds: ['dependency_1']
          }
        ],
        argumentStructure: {
          promised: {
            agent: 'John',
            goal: 'Mary',
            theme: 'CP'
          }
        },
        selectionLedger: {
          promised: 'CP'
        },
        clausalDependencies: {
          control: {
            subtype: 'subject-control',
            controller: 'John',
            controllee: 'PRO',
            predicate: 'promised',
            clause: 'CP'
          }
        }
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'flash-lite');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.argumentStructure.length, 3);
  assert.equal(analysis.argumentStructure[0].predicate, 'promised');
  assert.equal(analysis.argumentStructure[0].role, 'agent');
  assert.equal(analysis.argumentStructure[0].referent, 'John');
  assert.equal(analysis.selectionLedger.length, 1);
  assert.equal(analysis.selectionLedger[0].selectorHead, 'promised');
  assert.equal(analysis.selectionLedger[0].selectedCategory, 'CP');
  assert.equal(analysis.clausalDependencies.length, 1);
  assert.equal(analysis.clausalDependencies[0].type, 'control');
  assert.equal(analysis.clausalDependencies[0].subtype, 'subject-control');
  assert.equal(analysis.clausalDependencies[0].controllerLabel, 'John');
  assert.equal(analysis.clausalDependencies[0].dependentLabel, 'PRO');
});

test('normalizeParseBundle accepts richer synonym-heavy ledger field names without dropping them', () => {
  const sentence = 'John promised Mary to leave.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'cbar_root',
                    label: "C'",
                    children: [
                      { id: 'c_head', label: 'C', children: [{ id: 'c_null', label: '∅' }] },
                      {
                        id: 'inflp_root',
                        label: 'InflP',
                        children: [
                          { id: 'dp_john', label: 'DP', children: [{ id: 'john_leaf', label: 'John', word: 'John', tokenIndex: 0 }] },
                          {
                            id: 'infl_bar',
                            label: "Infl'",
                            children: [
                              { id: 'infl_head', label: 'Infl', children: [{ id: 'infl_null', label: '∅' }] },
                              {
                                id: 'vp_root',
                                label: 'VP',
                                children: [
                                  { id: 'v_promised', label: 'V', children: [{ id: 'promised_leaf', label: 'promised', word: 'promised', tokenIndex: 1 }] },
                                  { id: 'dp_mary', label: 'DP', children: [{ id: 'mary_leaf', label: 'Mary', word: 'Mary', tokenIndex: 2 }] },
                                  {
                                    id: 'cp_emb',
                                    label: 'CP',
                                    children: [
                                      {
                                        id: 'cbar_emb',
                                        label: "C'",
                                        children: [
                                          { id: 'c_to', label: 'C', children: [{ id: 'to_leaf', label: 'to', word: 'to', tokenIndex: 3 }] },
                                          {
                                            id: 'inflp_emb',
                                            label: 'InflP',
                                            children: [
                                              { id: 'pro_dp', label: 'DP', children: [{ id: 'pro_leaf', label: 'PRO' }] },
                                              { id: 'vp_emb', label: 'VP', children: [{ id: 'v_leave', label: 'V', children: [{ id: 'leave_leaf', label: 'leave', word: 'leave', tokenIndex: 4 }] }] }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'The matrix predicate selects a non-finite CP complement.', stepIds: ['f1'], supportIds: ['selection_1'] },
          { kind: 'licensing', text: 'John is the external argument of promised, Mary is its internal argument, and Mary controls PRO.', stepIds: ['f1'], supportIds: ['argument_1', 'argument_2', 'binding_1', 'dependency_1'] }
        ],
        argumentStructure: [
          { predicateLabel: 'promised', argumentLabel: 'John', thematicRole: 'Agent' },
          { predicateLabel: 'promised', participant: 'Mary', theta: 'Goal' },
          { predicateLabel: 'leave', argument: 'PRO', thetaRole: 'Agent' }
        ],
        selectionLedger: [
          { head: 'promised', complementCategory: 'CP' },
          { selectorLabel: 'promised', specifierCategory: 'DP' }
        ],
        bindingLedger: [
          { binder: 'Mary', anaphor: 'PRO', principle: 'A', status: 'satisfied' }
        ],
        clausalDependencies: [
          {
            type: 'control',
            subtype: 'object-control',
            controllerLabel: 'Mary',
            dependentLabel: 'PRO',
            predicateLabel: 'promised',
            clauseLabel: 'to leave'
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.argumentStructure.length, 3);
  assert.equal(analysis.argumentStructure[0].predicate, 'promised');
  assert.equal(analysis.argumentStructure[0].referent, 'John');
  assert.equal(analysis.argumentStructure[0].role, 'Agent');
  assert.equal(analysis.selectionLedger.length, 2);
  assert.equal(analysis.selectionLedger[0].selectorHead, 'promised');
  assert.equal(analysis.selectionLedger[0].selectedCategory, 'CP');
  assert.equal(analysis.selectionLedger[1].selectedCategory, 'DP');
  assert.equal(analysis.bindingLedger.length, 1);
  assert.equal(analysis.bindingLedger[0].antecedentLabel, 'Mary');
  assert.equal(analysis.bindingLedger[0].dependentLabel, 'PRO');
});

test('validateNoteBindingsAgainstStructuredAnalysis rejects object-control notes when clausal dependency subtype is missing or mismatched', () => {
  assert.throws(
    () => validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        {
          kind: 'licensing',
          text: 'The embedded PRO subject is licensed under object control by Mary.'
        }
      ],
      movementEvents: [],
      chains: [],
      clausalDependencies: [
        {
          type: 'control',
          subtype: 'subject-control',
          controllerLabel: 'John',
          dependentLabel: 'PRO'
        }
      ],
      caseAssignments: [],
      argumentStructure: [],
      selectionLedger: [],
      bindingLedger: []
    }),
    /subtype "object-control"/i
  );
});

test('validateNoteBindingsAgainstStructuredAnalysis rejects control notes when clausal dependency bookkeeping is absent', () => {
  assert.throws(
    () => validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        {
          kind: 'licensing',
          text: 'The embedded PRO subject is licensed under object control by Mary.'
        }
      ],
      movementEvents: [],
      chains: [],
      clausalDependencies: [],
      caseAssignments: [],
      argumentStructure: [],
      selectionLedger: [],
      bindingLedger: []
    }),
    /clausalDependencies/i
  );
});

test('normalizeParseBundle accepts richer raising ledgers that use semantic field names', () => {
  const sentence = 'John seems to like Mary.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            stepId: 'g1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'cbar_root',
                    label: "C'",
                    children: [
                      { id: 'c_root', label: 'C', children: [{ id: 'c_null', label: '∅' }] },
                      {
                        id: 'inflp_root',
                        label: 'InflP',
                        children: [
                          {
                            id: 'dp_john',
                            label: 'DP',
                            children: [
                              {
                                id: 'dbar_john',
                                label: "D'",
                                children: [{ id: 'd_john', label: 'D', children: [{ id: 'john_leaf', label: '0:John' }] }]
                              }
                            ]
                          },
                          {
                            id: 'inflbar_root',
                            label: "Infl'",
                            children: [
                              { id: 'infl_root', label: 'Infl', children: [{ id: 'infl_null', label: '∅' }] },
                              {
                                id: 'vp_root',
                                label: 'VP',
                                children: [
                                  {
                                    id: 'vbar_root',
                                    label: "V'",
                                    children: [
                                      { id: 'v_root', label: 'V', children: [{ id: 'seems_leaf', label: '1:seems' }] },
                                      {
                                        id: 'inflp_emb',
                                        label: 'InflP',
                                        children: [
                                          { id: 'infl_emb_head', label: 'Infl', children: [{ id: 'to_leaf', label: '2:to' }] },
                                          {
                                            id: 'vp_emb',
                                            label: 'VP',
                                            children: [
                                              { id: 'trace_john', label: 'DP', children: [{ id: 't1', label: 't_1' }] },
                                              {
                                                id: 'vbar_emb',
                                                label: "V'",
                                                children: [
                                                  { id: 'v_emb', label: 'V', children: [{ id: 'like_leaf', label: '3:like' }] },
                                                  {
                                                    id: 'dp_mary',
                                                    label: 'DP',
                                                    children: [
                                                      {
                                                        id: 'dbar_mary',
                                                        label: "D'",
                                                        children: [{ id: 'd_mary', label: 'D', children: [{ id: 'mary_leaf', label: '4:Mary' }] }]
                                                      }
                                                    ]
                                                  }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          {
            kind: 'architecture',
            text: 'The sentence is a raising-to-subject construction in which the matrix predicate seems selects an infinitival complement.',
            stepIds: ['g1'],
            supportIds: ['selection_1', 'dependency_1', 'case_1']
          }
        ],
        selectionLedger: [
          {
            selector: 'seems',
            selectedCategory: 'InflP',
            selectedLabel: 'to like Mary',
            relation: 'complement'
          }
        ],
        clausalDependencies: [
          {
            relationType: 'raising-to-subject',
            matrixPredicate: 'seems',
            dependentClause: 'to like Mary',
            raisedArgument: 'John'
          }
        ],
        argumentStructure: [
          {
            predicate: 'like',
            arguments: [
              { argument: 'John', role: 'Experiencer', position: 'Spec,VP' },
              { argument: 'Mary', role: 'Theme', position: 'Complement,V' }
            ]
          }
        ],
        caseAssignments: [
          {
            assigner: 'Infl_pres',
            assignee: 'John',
            case: 'Nominative',
            position: 'Spec,InflP'
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.clausalDependencies.length, 1);
  assert.equal(analysis.clausalDependencies[0].type, 'raising');
  assert.equal(analysis.clausalDependencies[0].subtype, 'raising-to-subject');
  assert.equal(analysis.clausalDependencies[0].predicateLabel, 'seems');
  assert.equal(analysis.clausalDependencies[0].clauseLabel, 'to like Mary');
  assert.equal(analysis.clausalDependencies[0].dependentLabel, 'John');

  assert.equal(analysis.argumentStructure.length, 2);
  assert.equal(analysis.argumentStructure[0].predicate, 'like');
  assert.equal(analysis.argumentStructure[0].referent, 'John');
  assert.equal(analysis.argumentStructure[1].referent, 'Mary');

  assert.equal(analysis.caseAssignments.length, 1);
  assert.equal(analysis.caseAssignments[0].assigneeLabel, 'John');
  assert.equal(analysis.caseAssignments[0].case, 'Nominative');
  assert.equal(analysis.caseAssignments[0].position, 'Spec,InflP');
});

test('normalizeParseBundle accepts token-anchored overt leaves and derives canonical spans', () => {
  const sentence = 'Ha comprado Ana el libro?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'cp',
          label: 'CP',
          children: [
            {
              id: 'cbar',
              label: "C'",
              children: [
                { id: 'c', label: 'C', children: [{ id: 'ha', label: 'Ha', tokenIndex: 0 }] },
                {
                  id: 'inflp',
                  label: 'InflP',
                  children: [
                    {
                      id: 'vp',
                      label: 'VP',
                      children: [
                        { id: 'v', label: 'V', children: [{ id: 'comprado', label: 'comprado', tokenIndex: 1 }] },
                        { id: 'subj', label: 'DP', children: [{ id: 'ana', label: 'Ana', tokenIndex: 2 }] },
                        {
                          id: 'obj',
                          label: 'DP',
                          children: [
                            { id: 'd', label: 'D', children: [{ id: 'el', label: 'el', tokenIndex: 3 }] },
                            { id: 'n', label: 'N', children: [{ id: 'libro', label: 'libro', tokenIndex: 4 }] }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A canonical token-anchored parse.',
        movementDecision: {
          hasMovement: false,
          rationale: 'No movement is posited in the committed analysis.'
        },
        movementEvents: [],
        derivationSteps: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  const analysis = normalized.analyses[0];

  assert.deepStrictEqual(analysis.surfaceOrder, ['Ha', 'comprado', 'Ana', 'el', 'libro']);
  assert.deepStrictEqual(analysis.tree.surfaceSpan, [0, 4]);
  assert.equal(analysis.tree.children[0].children[0].children[0].word, 'Ha');
});

test('normalizeParseBundle accepts pronunciation as an overt-leaf transport alias', () => {
  const sentence = 'Teresa';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            stepId: 'step_1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'dp',
                label: 'DP',
                children: [
                  {
                    id: 'dbar',
                    label: "D'",
                    children: [
                      {
                        id: 'd',
                        label: 'D',
                        children: [{ tokenIndex: 0, pronunciation: 'Teresa' }]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'step_2',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'dp',
                label: 'DP',
                children: [
                  {
                    id: 'dbar',
                    label: "D'",
                    children: [
                      {
                        id: 'd',
                        label: 'D',
                        children: [{ tokenIndex: 0, pronunciation: 'Teresa' }]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 'step_3',
            operation: 'SpellOut',
            workspaceForest: [
              {
                id: 'dp',
                label: 'DP',
                children: [
                  {
                    id: 'dbar',
                    label: "D'",
                    children: [
                      {
                        id: 'd',
                        label: 'D',
                        children: [{ tokenIndex: 0, pronunciation: 'Teresa' }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        caseAssignments: [],
        argumentStructure: [],
        selectionLedger: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro', true);
  assert.deepStrictEqual(normalized.analyses[0].surfaceOrder, ['Teresa']);
  assert.deepStrictEqual(normalized.analyses[0].tree.surfaceSpan, [0, 0]);
});

test('normalizeParseBundle accepts token-anchored string leaves inside growthFrames and promotes Growth as Canopy truth', () => {
  const sentence = 'The farmer ate the pig';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            stepId: 1,
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'vp',
                label: 'VP',
                children: [
                  {
                    id: 'dp_subj',
                    label: 'DP',
                    children: [
                      {
                        id: 'dbar_subj',
                        label: "D'",
                        children: [
                          { id: 'd_subj', label: 'D', children: ['0:The'] },
                          {
                            id: 'np_subj',
                            label: 'NP',
                            children: [{ id: 'n_subj', label: 'N', children: ['1:farmer'] }]
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'vbar',
                    label: "V'",
                    children: [
                      { id: 'v', label: 'V', children: ['2:ate'] },
                      {
                        id: 'dp_obj',
                        label: 'DP',
                        children: [
                          {
                            id: 'dbar_obj',
                            label: "D'",
                            children: [
                              { id: 'd_obj', label: 'D', children: ['3:the'] },
                              {
                                id: 'np_obj',
                                label: 'NP',
                                children: [{ id: 'n_obj', label: 'N', children: ['4:pig'] }]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 2,
            operation: 'A-Move',
            chainId: 'chain_subj',
            movement: {
              operation: 'A-Move',
              sourceNodeId: 'dp_subj',
              targetNodeId: 'dp_subj_high'
            },
            workspaceForest: [
              {
                id: 'inflp',
                label: 'InflP',
                children: [
                  {
                    id: 'dp_subj_high',
                    label: 'DP',
                    children: [
                      {
                        id: 'dbar_subj_high',
                        label: "D'",
                        children: [
                          { id: 'd_subj_high', label: 'D', children: ['0:The'] },
                          {
                            id: 'np_subj_high',
                            label: 'NP',
                            children: [{ id: 'n_subj_high', label: 'N', children: ['1:farmer'] }]
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'inflbar',
                    label: "Infl'",
                    children: [
                      { id: 'infl', label: 'Infl', children: ['∅'] },
                      {
                        id: 'vp_after',
                        label: 'VP',
                        children: [
                          { id: 'trace_subj', label: 'DP', children: ['t_subj'] },
                          {
                            id: 'vbar_after',
                            label: "V'",
                            children: [
                              { id: 'v_after', label: 'V', children: ['2:ate'] },
                              {
                                id: 'dp_obj_after',
                                label: 'DP',
                                children: [
                                  {
                                    id: 'dbar_obj_after',
                                    label: "D'",
                                    children: [
                                      { id: 'd_obj_after', label: 'D', children: ['3:the'] },
                                      {
                                        id: 'np_obj_after',
                                        label: 'NP',
                                        children: [{ id: 'n_obj_after', label: 'N', children: ['4:pig'] }]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            stepId: 3,
            operation: 'ExternalMerge',
            workspaceForest: [
              {
                id: 'cp',
                label: 'CP',
                children: [
                  {
                    id: 'cbar',
                    label: "C'",
                    children: [
                      { id: 'c', label: 'C', children: ['∅'] },
                      {
                        id: 'inflp_final',
                        label: 'InflP',
                        children: [
                          {
                            id: 'dp_subj_high_final',
                            label: 'DP',
                            children: [
                              {
                                id: 'dbar_subj_high_final',
                                label: "D'",
                                children: [
                                  { id: 'd_subj_high_final', label: 'D', children: ['0:The'] },
                                  {
                                    id: 'np_subj_high_final',
                                    label: 'NP',
                                    children: [{ id: 'n_subj_high_final', label: 'N', children: ['1:farmer'] }]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'inflbar_final',
                            label: "Infl'",
                            children: [
                              { id: 'infl_final', label: 'Infl', children: ['∅'] },
                              {
                                id: 'vp_final',
                                label: 'VP',
                                children: [
                                  { id: 'trace_subj_final', label: 'DP', children: ['t_subj'] },
                                  {
                                    id: 'vbar_final',
                                    label: "V'",
                                    children: [
                                      { id: 'v_final', label: 'V', children: ['2:ate'] },
                                      {
                                        id: 'dp_obj_final',
                                        label: 'DP',
                                        children: [
                                          {
                                            id: 'dbar_obj_final',
                                            label: "D'",
                                            children: [
                                              { id: 'd_obj_final', label: 'D', children: ['3:the'] },
                                              {
                                                id: 'np_obj_final',
                                                label: 'NP',
                                                children: [{ id: 'n_obj_final', label: 'N', children: ['4:pig'] }]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'A simple declarative clause.' },
          { kind: 'chain', chainId: 'chain_subj', text: 'The subject raises to Spec,InflP.' }
        ],
        chains: [
          {
            chainId: 'chain_subj',
            type: 'A',
            copies: ['dp_subj_high_final', 'trace_subj_final'],
            pronouncedCopy: 'dp_subj_high_final',
            silentCopies: ['trace_subj_final']
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.deepStrictEqual(analysis.surfaceOrder, ['The', 'farmer', 'ate', 'the', 'pig']);
  assert.match(JSON.stringify(analysis.growthFrames?.[0] || {}), /"word":"The"/);
  assert.match(JSON.stringify(analysis.growthFrames?.[0] || {}), /"tokenIndex":0/);
});

test('normalizeParseBundle accepts token-array-anchored structural leaves inside control growthFrames', () => {
  const sentence = 'John persuaded Mary to leave.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            stepId: 'g1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'cp',
                label: 'CP',
                children: [
                  {
                    id: 'cbar',
                    label: "C'",
                    children: [
                      { id: 'c_null', label: 'C', children: [{ id: 'c_null_leaf', label: '∅' }] },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          {
                            id: 'dp_john',
                            label: 'DP',
                            children: [
                              {
                                id: 'dbar_john',
                                label: "D'",
                                children: [{ id: 'd_john', label: 'D', tokens: [0] }]
                              }
                            ]
                          },
                          {
                            id: 'inflbar',
                            label: "Infl'",
                            children: [
                              { id: 'infl_null', label: 'Infl', children: [{ id: 'infl_null_leaf', label: '∅' }] },
                              {
                                id: 'vp',
                                label: 'VP',
                                children: [
                                  {
                                    id: 'vbar_matrix',
                                    label: "V'",
                                    children: [
                                      { id: 'v_persuaded', label: 'V', tokens: [1] },
                                      {
                                        id: 'vp_lower',
                                        label: 'VP',
                                        children: [
                                          {
                                            id: 'dp_mary',
                                            label: 'DP',
                                            children: [
                                              {
                                                id: 'dbar_mary',
                                                label: "D'",
                                                children: [{ id: 'd_mary', label: 'D', tokens: [2] }]
                                              }
                                            ]
                                          },
                                          {
                                            id: 'vbar_lower',
                                            label: "V'",
                                            children: [
                                              {
                                                id: 'cp_emb',
                                                label: 'CP',
                                                children: [
                                                  {
                                                    id: 'cbar_emb',
                                                    label: "C'",
                                                    children: [
                                                      { id: 'c_to', label: 'C', tokens: [3] },
                                                      {
                                                        id: 'inflp_emb',
                                                        label: 'InflP',
                                                        children: [
                                                          {
                                                            id: 'dp_pro',
                                                            label: 'DP',
                                                            children: [{ id: 'pro_leaf', label: 'PRO' }]
                                                          },
                                                          {
                                                            id: 'inflbar_emb',
                                                            label: "Infl'",
                                                            children: [
                                                              { id: 'infl_null_emb', label: 'Infl', children: [{ id: 'infl_null_emb_leaf', label: '∅' }] },
                                                              {
                                                                id: 'vp_emb',
                                                                label: 'VP',
                                                                children: [
                                                                  {
                                                                    id: 'vbar_emb',
                                                                    label: "V'",
                                                                    children: [{ id: 'v_leave', label: 'V', tokens: [4] }]
                                                                  }
                                                                ]
                                                              }
                                                            ]
                                                          }
                                                        ]
                                                      }
                                                    ]
                                                  }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          {
            kind: 'architecture',
            text: 'A matrix clause selecting an infinitival control complement.',
            stepIds: ['g1'],
            supportIds: ['dependency_1']
          }
        ],
        clausalDependencies: [
          {
            type: 'control',
            subtype: 'object-control',
            controllerLabel: 'Mary',
            dependentLabel: 'PRO'
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.deepStrictEqual(analysis.surfaceOrder, ['John', 'persuaded', 'Mary', 'to', 'leave']);
  assert.equal(findNodeById(analysis.tree, 'v_persuaded')?.word, 'persuaded');
  assert.equal(findNodeById(analysis.tree, 'c_to')?.word, 'to');
  assert.equal(findNodeById(analysis.tree, 'd_mary')?.word, 'Mary');
  assert.equal(analysis.clausalDependencies[0].subtype, 'object-control');
});

test('normalizeParseBundle accepts token-anchored label-only leaf nodes inside growthFrames', () => {
  const sentence = 'The farmer ate the pig';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            stepId: 'g1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'cp',
                label: 'CP',
                children: [
                  {
                    id: 'cbar',
                    label: "C'",
                    children: [
                      { id: 'c_head', label: 'C', children: [{ id: 'c_null', label: '∅' }] },
                      {
                        id: 'inflp',
                        label: 'InflP',
                        children: [
                          {
                            id: 'dp_subj',
                            label: 'DP',
                            children: [
                              {
                                id: 'dbar_subj',
                                label: "D'",
                                children: [
                                  { id: 'd_subj', label: 'D', children: [{ id: 'tok_0', label: '0:The' }] },
                                  {
                                    id: 'np_subj',
                                    label: 'NP',
                                    children: [
                                      {
                                        id: 'nbar_subj',
                                        label: "N'",
                                        children: [{ id: 'n_subj', label: 'N', children: [{ id: 'tok_1', label: '1:farmer' }] }]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'inflbar',
                            label: "Infl'",
                            children: [
                              { id: 'infl_head', label: 'Infl', children: [{ id: 'infl_null', label: '∅' }] },
                              {
                                id: 'vp',
                                label: 'VP',
                                children: [
                                  { id: 'vbar', label: "V'", children: [{ id: 'v_head', label: 'V', children: [{ id: 'tok_2', label: '2:ate' }] }, { id: 'dp_obj', label: 'DP', children: [{ id: 'dbar_obj', label: "D'", children: [{ id: 'd_obj', label: 'D', children: [{ id: 'tok_3', label: '3:the' }] }, { id: 'np_obj', label: 'NP', children: [{ id: 'nbar_obj', label: "N'", children: [{ id: 'n_obj', label: 'N', children: [{ id: 'tok_4', label: '4:pig' }] }] }] }] }] }] }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          {
            kind: 'architecture',
            text: 'The clause projects a CP over an InflP headed by a null C and null Infl.'
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro');
  const analysis = normalized.analyses[0];

  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.equal(analysis.surfaceOrder.join(' '), 'The farmer ate the pig');
  assert.match(JSON.stringify(analysis.tree), /"word":"The"/);
  assert.match(JSON.stringify(analysis.tree), /"tokenIndex":0/);
  assert.match(JSON.stringify(analysis.tree), /"word":"pig"/);
  assert.match(JSON.stringify(analysis.tree), /"tokenIndex":4/);
});

test('normalizeParseBundle compiles a flat node table into a canonical nested tree', () => {
  const sentence = 'Ha comprado Ana el libro?';
  const payload = {
    analyses: [
      {
        nodes: [
          { id: 'cp', label: 'CP', surfaceSpan: [0, 4] },
          { id: 'cbar', label: "C'", parentId: 'cp', surfaceSpan: [0, 4] },
          { id: 'inflp', label: 'InflP', parentId: 'cbar', surfaceSpan: [1, 4] },
          { id: 'c', label: 'C', parentId: 'cbar', surfaceSpan: [0, 0] },
          { id: 'ha', label: 'Aux', parentId: 'c', word: 'Ha', tokenIndex: 0 },
          { id: 'vp', label: 'VP', parentId: 'inflp', surfaceSpan: [1, 4] },
          { id: 'v', label: 'V', parentId: 'vp', surfaceSpan: [1, 1] },
          { id: 'comprado', label: 'V', parentId: 'v', word: 'comprado', tokenIndex: 1 },
          { id: 'subj', label: 'DP', parentId: 'vp', surfaceSpan: [2, 2] },
          { id: 'ana', label: 'N', parentId: 'subj', word: 'Ana', tokenIndex: 2 },
          { id: 'obj', label: 'DP', parentId: 'vp', surfaceSpan: [3, 4] },
          { id: 'd', label: 'D', parentId: 'obj', surfaceSpan: [3, 3] },
          { id: 'el', label: 'D', parentId: 'd', word: 'el', tokenIndex: 3 },
          { id: 'n', label: 'N', parentId: 'obj', surfaceSpan: [4, 4] },
          { id: 'libro', label: 'N', parentId: 'n', word: 'libro', tokenIndex: 4 }
        ],
        rootId: 'cp',
        explanation: 'A canonical flat-node-table parse.',
        movementDecision: {
          hasMovement: false,
          rationale: 'No movement is posited in the committed analysis.'
        },
        movementEvents: [],
        derivationSteps: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  const analysis = normalized.analyses[0];

  assert.equal(analysis.tree.label, 'CP');
  assert.deepStrictEqual(analysis.surfaceOrder, ['Ha', 'comprado', 'Ana', 'el', 'libro']);
  assert.equal(analysis.tree.children[0].children[0].children[0].word, 'Ha');
});

test('normalizeParseBundle compiles a flat node table nested under tree into a canonical nested tree', () => {
  const sentence = 'Welchen Film hat Jonas empfohlen?';
  const payload = {
    analyses: [
      {
        tree: {
          rootId: 'n1',
          nodes: [
            { id: 'n1', label: 'CP', surfaceSpan: [0, 4] },
            { id: 'n2', label: 'DP', parentId: 'n1', surfaceSpan: [0, 1] },
            { id: 'n3', label: "D'", parentId: 'n2', surfaceSpan: [0, 1] },
            { id: 'n4', label: 'D', parentId: 'n3', word: 'Welchen', tokenIndex: 0 },
            { id: 'n5', label: 'NP', parentId: 'n3', surfaceSpan: [1, 1] },
            { id: 'n6', label: 'N', parentId: 'n5', word: 'Film', tokenIndex: 1 },
            { id: 'n7', label: "C'", parentId: 'n1', surfaceSpan: [2, 4] },
            { id: 'n8', label: 'C', parentId: 'n7', surfaceSpan: [2, 2] },
            { id: 'n9', label: 'Aux', parentId: 'n8', word: 'hat', tokenIndex: 2 },
            { id: 'n10', label: 'InflP', parentId: 'n7', surfaceSpan: [3, 4] },
            { id: 'n11', label: 'DP', parentId: 'n10', surfaceSpan: [3, 3] },
            { id: 'n12', label: 'N', parentId: 'n11', word: 'Jonas', tokenIndex: 3 },
            { id: 'n13', label: "Infl'", parentId: 'n10', surfaceSpan: [4, 4] },
            { id: 'n14', label: 'VP', parentId: 'n13', surfaceSpan: [4, 4] },
            { id: 'n15', label: 'V', parentId: 'n14', word: 'empfohlen', tokenIndex: 4 }
          ]
        },
        explanation: 'A canonical flat-node-table parse nested under tree.',
        movementDecision: {
          hasMovement: false,
          rationale: 'No movement is posited in the committed analysis.'
        },
        movementEvents: [],
        derivationSteps: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  const analysis = normalized.analyses[0];

  assert.equal(analysis.tree.label, 'CP');
  assert.deepStrictEqual(analysis.surfaceOrder, ['Welchen', 'Film', 'hat', 'Jonas', 'empfohlen']);
  assert.equal(analysis.tree.children[0].children[0].children[0].word, 'Welchen');
});

test('normalizeParseBundle orders flat-node siblings by overt token indices even when model surface spans are sloppy', () => {
  const sentence = 'Ha comprado Ana el libro?';
  const payload = {
    analyses: [
      {
        nodes: [
          { id: 'cp', label: 'CP', surfaceSpan: [0, 4] },
          { id: 'cbar', label: "C'", parentId: 'cp', surfaceSpan: [1, 4] },
          { id: 'c', label: 'C', parentId: 'cbar', surfaceSpan: [4, 4] },
          { id: 'ha', label: 'C', parentId: 'c', word: 'Ha', tokenIndex: 0 },
          { id: 'inflp', label: 'InflP', parentId: 'cbar', surfaceSpan: [0, 3] },
          { id: 'inflbar', label: "Infl'", parentId: 'inflp', surfaceSpan: [1, 4] },
          { id: 'vp', label: 'VP', parentId: 'inflbar', surfaceSpan: [1, 4] },
          { id: 'v', label: 'V', parentId: 'vp', word: 'comprado', tokenIndex: 1 },
          { id: 'subj', label: 'DP', parentId: 'vp', surfaceSpan: [4, 4] },
          { id: 'ana', label: 'N', parentId: 'subj', word: 'Ana', tokenIndex: 2 },
          { id: 'obj', label: 'DP', parentId: 'vp', surfaceSpan: [2, 2] },
          { id: 'd', label: 'D', parentId: 'obj', surfaceSpan: [4, 4] },
          { id: 'el', label: 'D', parentId: 'd', word: 'el', tokenIndex: 3 },
          { id: 'nbar', label: "N'", parentId: 'obj', surfaceSpan: [3, 3] },
          { id: 'n', label: 'N', parentId: 'nbar', word: 'libro', tokenIndex: 4 }
        ],
        rootId: 'cp',
        explanation: 'A flat-node parse with misleading spans but correct token anchoring.',
        movementDecision: {
          hasMovement: false,
          rationale: 'No movement is posited in the committed analysis.'
        },
        movementEvents: [],
        derivationSteps: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  const analysis = normalized.analyses[0];

  assert.deepStrictEqual(analysis.surfaceOrder, ['Ha', 'comprado', 'Ana', 'el', 'libro']);
});

test('normalizeParseBundle ignores stray tokenIndex values on null or trace leaves in flat-node mode', () => {
  const sentence = 'Welchen Film hat Jonas empfohlen?';
  const payload = {
    analyses: [
      {
        nodes: [
          { id: 'cp', label: 'CP' },
          { id: 'dp', label: 'DP', parentId: 'cp' },
          { id: 'd', label: 'D', parentId: 'dp', word: 'Welchen', tokenIndex: 0 },
          { id: 'np', label: 'NP', parentId: 'dp', word: 'Film', tokenIndex: 1 },
          { id: 'cbar', label: "C'", parentId: 'cp' },
          { id: 'c', label: 'C', parentId: 'cbar', word: 'hat', tokenIndex: 2 },
          { id: 'inflp', label: 'InflP', parentId: 'cbar' },
          { id: 'subj', label: 'DP', parentId: 'inflp', word: 'Jonas', tokenIndex: 3 },
          { id: 'inflbar', label: "Infl'", parentId: 'inflp' },
          { id: 'vp', label: 'VP', parentId: 'inflbar' },
          { id: 'v', label: 'V', parentId: 'vp', word: 'empfohlen', tokenIndex: 4 },
          { id: 'trace', label: 't', parentId: 'vp', word: 't', tokenIndex: 4 }
        ],
        rootId: 'cp',
        explanation: 'A flat-node parse with stray tokenIndex on a trace.',
        movementDecision: {
          hasMovement: true,
          rationale: 'The wh-phrase moves to the left periphery.'
        },
        movementEvents: [{ operation: 'Move', fromNodeId: 'trace', toNodeId: 'dp', traceNodeId: 'trace' }],
        derivationSteps: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  const analysis = normalized.analyses[0];

  assert.deepStrictEqual(analysis.surfaceOrder, ['Welchen', 'Film', 'hat', 'Jonas', 'empfohlen']);
});

test('normalizeParseBundle infers missing tokenIndex for unique overt words in flat-node mode', () => {
  const sentence = 'Welchen Film hat Jonas empfohlen?';
  const payload = {
    analyses: [
      {
        nodes: [
          { id: 'cp', label: 'CP' },
          { id: 'dp', label: 'DP', parentId: 'cp' },
          { id: 'dbar', label: "D'", parentId: 'dp' },
          { id: 'd', label: 'D', parentId: 'dbar', word: 'Welchen' },
          { id: 'np', label: 'NP', parentId: 'dbar', word: 'Film', tokenIndex: 1 },
          { id: 'cbar', label: "C'", parentId: 'cp' },
          { id: 'c', label: 'C', parentId: 'cbar', word: 'hat', tokenIndex: 2 },
          { id: 'inflp', label: 'InflP', parentId: 'cbar' },
          { id: 'subj', label: 'DP', parentId: 'inflp', word: 'Jonas', tokenIndex: 3 },
          { id: 'inflbar', label: "Infl'", parentId: 'inflp' },
          { id: 'vp', label: 'VP', parentId: 'inflbar' },
          { id: 'vbar', label: "V'", parentId: 'vp' },
          { id: 'v', label: 'V', parentId: 'vbar', word: 'empfohlen', tokenIndex: 4 },
          { id: 'trace', label: 'DP', parentId: 'vbar', word: 't' }
        ],
        rootId: 'cp',
        explanation: 'A flat-node parse with one missing overt tokenIndex.',
        movementDecision: {
          hasMovement: true,
          rationale: 'The wh-phrase moves to the left periphery.'
        },
        movementEvents: [{ operation: 'Move', fromNodeId: 'trace', toNodeId: 'dp', traceNodeId: 'trace' }],
        derivationSteps: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  const analysis = normalized.analyses[0];

  assert.deepStrictEqual(analysis.surfaceOrder, ['Welchen', 'Film', 'hat', 'Jonas', 'empfohlen']);
});

test('normalizeParseBundle infers missing parentId links in flat-node mode from token intervals', () => {
  const sentence = 'Melyik konyvet vette meg Anna?';
  const payload = {
    analyses: [
      {
        nodes: [
          { id: 'n0', label: 'CP', surfaceSpan: [0, 4] },
          { id: 'n1', label: 'DP', surfaceSpan: [0, 1] },
          { id: 'n2', label: 'D', word: 'Melyik', tokenIndex: 0 },
          { id: 'n3', label: 'NP', word: 'konyvet', tokenIndex: 1 },
          { id: 'n4', label: 'C', word: 'vette', tokenIndex: 2 },
          { id: 'n5', label: 'TP', surfaceSpan: [3, 4] },
          { id: 'n6', label: 'V', word: 'meg', tokenIndex: 3 },
          { id: 'n7', label: 'DP', word: 'Anna', tokenIndex: 4 }
        ],
        rootId: 'n0',
        explanation: 'A flat-node parse with omitted parent links.',
        movementDecision: {
          hasMovement: false,
          rationale: 'No movement is posited in the committed analysis.'
        },
        movementEvents: [],
        derivationSteps: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'minimalism', sentence);
  const analysis = normalized.analyses[0];

  assert.deepStrictEqual(analysis.surfaceOrder, ['Melyik', 'konyvet', 'vette', 'meg', 'Anna']);
});

test('normalizeParseBundle materializes overt lexical words on phrasal flat nodes into preterminal structure', () => {
  const sentence = 'Melyik konyvet vette meg Anna?';
  const payload = {
    analyses: [
      {
        nodes: [
          { id: 'n0', label: 'CP', surfaceSpan: [0, 4] },
          { id: 'n1', label: 'DP', parentId: 'n0', surfaceSpan: [0, 1] },
          { id: 'n2', label: 'D', parentId: 'n1', word: 'Melyik', tokenIndex: 0 },
          { id: 'n3', label: 'NP', parentId: 'n1', word: 'konyvet', tokenIndex: 1 },
          { id: 'n4', label: 'TP', parentId: 'n0', surfaceSpan: [2, 4] },
          { id: 'n5', label: 'T', parentId: 'n4', word: 'vette', tokenIndex: 2 },
          { id: 'n6', label: 'VP', parentId: 'n4', surfaceSpan: [3, 4] },
          { id: 'n7', label: 'V', parentId: 'n6', word: 'meg', tokenIndex: 3 },
          { id: 'n8', label: 'DP', parentId: 'n6', word: 'Anna', tokenIndex: 4 }
        ],
        rootId: 'n0',
        explanation: 'A flat-node parse with lexical words on phrasal nodes.',
        movementDecision: {
          hasMovement: false,
          rationale: 'No movement is posited in the committed analysis.'
        },
        movementEvents: [],
        derivationSteps: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'minimalism', sentence);
  const analysis = normalized.analyses[0];
  const whDp = analysis.tree.children[0];
  const npChild = whDp.children.find((child) => child.label === 'NP');
  assert.equal(npChild?.children?.[0]?.label, 'N');
  const tp = analysis.tree.children[1];
  const vp = tp.children.find((child) => child.label === 'VP');
  const subjectDp = vp.children.find((child) => child.label === 'DP');
  assert.equal(subjectDp?.children?.[0]?.label, 'NP');
  assert.equal(subjectDp?.children?.[0]?.children?.[0]?.label, 'N');
});

test('normalizeParseBundle leaves phrasal lexical words untouched on legacy flat-node paths', () => {
  const sentence = 'Melyik konyvet vette meg Anna?';
  const payload = {
    analyses: [
      {
        nodes: [
          { id: 'n0', label: 'CP', surfaceSpan: [0, 4] },
          { id: 'n1', label: 'DP', parentId: 'n0', surfaceSpan: [0, 1] },
          { id: 'n2', label: 'D', parentId: 'n1', word: 'Melyik', tokenIndex: 0 },
          { id: 'n3', label: 'NP', parentId: 'n1', word: 'konyvet', tokenIndex: 1 },
          { id: 'n4', label: 'TP', parentId: 'n0', surfaceSpan: [2, 4] },
          { id: 'n5', label: 'T', parentId: 'n4', word: 'vette', tokenIndex: 2 },
          { id: 'n6', label: 'VP', parentId: 'n4', surfaceSpan: [3, 4] },
          { id: 'n7', label: 'V', parentId: 'n6', word: 'meg', tokenIndex: 3 },
          { id: 'n8', label: 'DP', parentId: 'n6', word: 'Anna', tokenIndex: 4 }
        ],
        rootId: 'n0',
        explanation: 'A flat-node parse with lexical words on phrasal nodes.',
        movementDecision: {
          hasMovement: false,
          rationale: 'No movement is posited in the committed analysis.'
        },
        movementEvents: [],
        derivationSteps: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'minimalism', sentence, 'local');
  const analysis = normalized.analyses[0];
  const whDp = analysis.tree.children[0];
  const npChild = whDp.children.find((child) => child.label === 'NP');
  assert.equal(npChild?.word, 'konyvet');
  assert.equal(npChild?.children, undefined);
  const tp = analysis.tree.children[1];
  const vp = tp.children.find((child) => child.label === 'VP');
  const subjectDp = vp.children.find((child) => child.label === 'DP');
  assert.equal(subjectDp?.word, 'Anna');
  assert.equal(subjectDp?.children, undefined);
});

test('normalizeParseBundle uses explicit siblingOrder in flat-node mode to preserve head-initial local order', () => {
  const sentence = 'Gheall se go bhfillfeadh se ar an bhaile.';
  const payload = {
    analyses: [
      {
        nodes: [
          { id: 'n1', label: 'CP', surfaceSpan: [0, 7] },
          { id: 'n2', label: "C'", parentId: 'n1', siblingOrder: 0, surfaceSpan: [0, 7] },
          { id: 'n3', label: 'C', parentId: 'n2', siblingOrder: 1, word: '∅' },
          { id: 'n4', label: 'InflP', parentId: 'n2', siblingOrder: 0, surfaceSpan: [0, 7] },
          { id: 'n8', label: 'Infl', parentId: 'n4', siblingOrder: 0, word: 'Gheall', tokenIndex: 0 },
          { id: 'n5', label: 'DP', parentId: 'n4', siblingOrder: 1, surfaceSpan: [1, 1] },
          { id: 'n6', label: 'D', parentId: 'n5', siblingOrder: 0, word: 'se', tokenIndex: 1 },
          { id: 'n9', label: 'VP', parentId: 'n4', siblingOrder: 2, surfaceSpan: [2, 7] },
          { id: 'n10', label: "V'", parentId: 'n9', siblingOrder: 0, surfaceSpan: [2, 7] },
          { id: 'n11', label: 'V', parentId: 'n10', siblingOrder: 1, word: '∅' },
          { id: 'n12', label: 'CP', parentId: 'n10', siblingOrder: 0, surfaceSpan: [2, 7] },
          { id: 'n13', label: "C'", parentId: 'n12', siblingOrder: 0, surfaceSpan: [2, 7] },
          { id: 'n14', label: 'C', parentId: 'n13', siblingOrder: 0, word: 'go', tokenIndex: 2 },
          { id: 'n15', label: 'InflP', parentId: 'n13', siblingOrder: 1, surfaceSpan: [3, 7] },
          { id: 'n19', label: 'Infl', parentId: 'n15', siblingOrder: 0, word: 'bhfillfeadh', tokenIndex: 3 },
          { id: 'n16', label: 'DP', parentId: 'n15', siblingOrder: 1, surfaceSpan: [4, 4] },
          { id: 'n17', label: 'D', parentId: 'n16', siblingOrder: 0, word: 'se', tokenIndex: 4 },
          { id: 'n20', label: 'VP', parentId: 'n15', siblingOrder: 2, surfaceSpan: [5, 7] },
          { id: 'n21', label: "V'", parentId: 'n20', siblingOrder: 0, surfaceSpan: [5, 7] },
          { id: 'n22', label: 'PP', parentId: 'n21', siblingOrder: 0, surfaceSpan: [5, 7] },
          { id: 'n23', label: "P'", parentId: 'n22', siblingOrder: 0, surfaceSpan: [5, 7] },
          { id: 'n24', label: 'P', parentId: 'n23', siblingOrder: 0, word: 'ar', tokenIndex: 5 },
          { id: 'n25', label: 'DP', parentId: 'n23', siblingOrder: 1, surfaceSpan: [6, 7] },
          { id: 'n26', label: "D'", parentId: 'n25', siblingOrder: 0, surfaceSpan: [6, 7] },
          { id: 'n27', label: 'D', parentId: 'n26', siblingOrder: 0, word: 'an', tokenIndex: 6 },
          { id: 'n28', label: 'NP', parentId: 'n26', siblingOrder: 1, surfaceSpan: [7, 7] },
          { id: 'n29', label: 'N', parentId: 'n28', siblingOrder: 0, word: 'bhaile', tokenIndex: 7 }
        ],
        rootId: 'n1',
        explanation: 'An Irish flat-node parse with explicit sibling ordering.',
        movementDecision: {
          hasMovement: true,
          rationale: 'The verbs move to Infl in both clauses.'
        },
        movementEvents: [
          { operation: 'HeadMove', fromNodeId: 'n11', toNodeId: 'n8' },
          { operation: 'HeadMove', fromNodeId: 'n21', toNodeId: 'n19' }
        ],
        derivationSteps: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  assert.deepStrictEqual(
    normalized.analyses[0].surfaceOrder,
    ['Gheall', 'se', 'go', 'bhfillfeadh', 'se', 'ar', 'an', 'bhaile']
  );
});

test('normalizeParseBundle falls back to token anchoring when explicit siblingOrder contradicts the sentence in flat-node mode', () => {
  const sentence = 'Gheall se go bhfillfeadh se ar an bhaile.';
  const payload = {
    analyses: [
      {
        nodes: [
          { id: 'n0', label: 'CP', siblingOrder: 0 },
          { id: 'n1', label: "C'", parentId: 'n0', siblingOrder: 0 },
          { id: 'n2', label: 'C', parentId: 'n1', siblingOrder: 0 },
          { id: 'n3', label: '∅', parentId: 'n2', siblingOrder: 0 },
          { id: 'n4', label: 'InflP', parentId: 'n1', siblingOrder: 1 },
          { id: 'n5', label: 'DP', parentId: 'n4', siblingOrder: 0 },
          { id: 'n6', label: 'D', parentId: 'n5', siblingOrder: 0 },
          { id: 'n7', label: 'se', parentId: 'n6', siblingOrder: 0, tokenIndex: 1 },
          { id: 'n8', label: "Infl'", parentId: 'n4', siblingOrder: 1 },
          { id: 'n9', label: 'Infl', parentId: 'n8', siblingOrder: 0 },
          { id: 'n10', label: 'Gheall', parentId: 'n9', siblingOrder: 0, tokenIndex: 0 },
          { id: 'n11', label: 'VP', parentId: 'n8', siblingOrder: 1 },
          { id: 'n12', label: "V'", parentId: 'n11', siblingOrder: 0 },
          { id: 'n13', label: 'V', parentId: 'n12', siblingOrder: 0 },
          { id: 'n14', label: 't', parentId: 'n13', siblingOrder: 0 },
          { id: 'n15', label: 'CP', parentId: 'n12', siblingOrder: 1 },
          { id: 'n16', label: "C'", parentId: 'n15', siblingOrder: 0 },
          { id: 'n17', label: 'C', parentId: 'n16', siblingOrder: 0 },
          { id: 'n18', label: 'go', parentId: 'n17', siblingOrder: 0, tokenIndex: 2 },
          { id: 'n19', label: 'InflP', parentId: 'n16', siblingOrder: 1 },
          { id: 'n20', label: 'DP', parentId: 'n19', siblingOrder: 0 },
          { id: 'n21', label: 'D', parentId: 'n20', siblingOrder: 0 },
          { id: 'n22', label: 'se', parentId: 'n21', siblingOrder: 0, tokenIndex: 4 },
          { id: 'n23', label: "Infl'", parentId: 'n19', siblingOrder: 1 },
          { id: 'n24', label: 'Infl', parentId: 'n23', siblingOrder: 0 },
          { id: 'n25', label: 'bhfillfeadh', parentId: 'n24', siblingOrder: 0, tokenIndex: 3 },
          { id: 'n26', label: 'VP', parentId: 'n23', siblingOrder: 1 },
          { id: 'n27', label: 'PP', parentId: 'n26', siblingOrder: 0 },
          { id: 'n28', label: 'P', parentId: 'n27', siblingOrder: 0 },
          { id: 'n29', label: 'ar', parentId: 'n28', siblingOrder: 0, tokenIndex: 5 },
          { id: 'n30', label: 'DP', parentId: 'n27', siblingOrder: 1 },
          { id: 'n31', label: 'D', parentId: 'n30', siblingOrder: 0 },
          { id: 'n32', label: 'an', parentId: 'n31', siblingOrder: 0, tokenIndex: 6 },
          { id: 'n33', label: 'NP', parentId: 'n30', siblingOrder: 1 },
          { id: 'n34', label: 'N', parentId: 'n33', siblingOrder: 0 },
          { id: 'n35', label: 'bhaile', parentId: 'n34', siblingOrder: 0, tokenIndex: 7 }
        ],
        rootId: 'n0',
        explanation: 'A flat-node parse whose siblingOrder contradicts the overt token anchoring.',
        movementDecision: {
          hasMovement: true,
          rationale: 'The verb moves to Infl in the matrix clause.'
        },
        movementEvents: [{ operation: 'HeadMove', fromNodeId: 'n14', toNodeId: 'n10' }],
        derivationSteps: []
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  assert.deepStrictEqual(
    normalized.analyses[0].surfaceOrder,
    ['Gheall', 'se', 'go', 'bhfillfeadh', 'se', 'ar', 'an', 'bhaile']
  );
});

test('normalizeParseBundle does not infer movement from indexed tree labels when movementEvents are omitted', () => {
  const sentence = 'Which book did Anna buy?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP_a',
              children: [
                {
                  id: 'n3',
                  label: "D'",
                  children: [
                    {
                      id: 'n4',
                      label: 'D',
                      children: [{ id: 'n5', label: 'Which', word: 'Which' }]
                    },
                    {
                      id: 'n6',
                      label: 'NP',
                      children: [{ id: 'n7', label: 'N', children: [{ id: 'n8', label: 'book', word: 'book' }] }]
                    }
                  ]
                }
              ]
            },
            {
              id: 'n9',
              label: "C'",
              children: [
                {
                  id: 'n10',
                  label: 'C',
                  children: [{ id: 'n11', label: 'did', word: 'did' }]
                },
                {
                  id: 'n12',
                  label: 'InflP',
                  children: [
                    {
                      id: 'n13',
                      label: 'DP',
                      children: [{ id: 'n14', label: 'D', children: [{ id: 'n15', label: 'Anna', word: 'Anna' }] }]
                    },
                    {
                      id: 'n16',
                      label: "Infl'",
                      children: [
                        {
                          id: 'n17',
                          label: 'Infl',
                          children: [{ id: 'n18', label: '∅' }]
                        },
                        {
                          id: 'n19',
                          label: 'VP',
                          children: [
                            {
                              id: 'n20',
                              label: 'V',
                              children: [{ id: 'n21', label: 'buy', word: 'buy' }]
                            },
                            {
                              id: 'n22',
                              label: 'DP',
                              children: [{ id: 'n23', label: 't_a' }]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'The wh-phrase is displaced to the clause edge.'
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  const analysis = normalized.analyses[0];

  assert.deepStrictEqual(analysis.movementEvents, []);
  assert.equal(analysis.explanation, 'The wh-phrase is displaced to the clause edge.');
  assert.equal(analysis.noteBindings.length, 0);
});

test('normalizeParseBundle rejects trees whose overt traversal order drifts from the input sentence', () => {
  const sentence = 'The student said that the lecture ended early.';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                {
                  id: 'n3',
                  label: 'D',
                  children: [{ id: 'n4', label: 'The', word: 'The' }]
                },
                {
                  id: 'n5',
                  label: 'NP',
                  children: [{ id: 'n6', label: 'student', word: 'student' }]
                }
              ]
            },
            {
              id: 'n7',
              label: 'CP',
              children: [
                {
                  id: 'n8',
                  label: 'C',
                  children: [{ id: 'n9', label: 'that', word: 'that' }]
                },
                {
                  id: 'n10',
                  label: 'InflP',
                  children: [
                    {
                      id: 'n11',
                      label: 'DP',
                      children: [
                        {
                          id: 'n12',
                          label: 'D',
                          children: [{ id: 'n13', label: 'the', word: 'the' }]
                        },
                        {
                          id: 'n14',
                          label: 'NP',
                          children: [{ id: 'n15', label: 'lecture', word: 'lecture' }]
                        }
                      ]
                    },
                    {
                      id: 'n16',
                      label: 'VP',
                      children: [
                        {
                          id: 'n17',
                          label: 'V',
                          children: [{ id: 'n18', label: 'ended', word: 'ended' }]
                        },
                        {
                          id: 'n19',
                          label: 'AdvP',
                          children: [{ id: 'n20', label: 'early', word: 'early' }]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              id: 'n21',
              label: 'VP',
              children: [
                {
                  id: 'n22',
                  label: 'V',
                  children: [{ id: 'n23', label: 'said', word: 'said' }]
                }
              ]
            }
          ]
        },
        explanation: 'A malformed embedded-clause analysis.'
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  assert.throws(
    () => normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence),
    /Tree overt terminals do not match the input sentence order/
  );
});

test('normalizeParseBundle rejects trees that duplicate overt tokens beyond the sentence inventory', () => {
  const sentence = 'Marie a dit que Paul partirait.';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                {
                  id: 'n3',
                  label: 'D',
                  children: [{ id: 'n4', label: 'Marie', word: 'Marie' }]
                }
              ]
            },
            {
              id: 'n5',
              label: 'C\'',
              children: [
                {
                  id: 'n6',
                  label: 'C',
                  children: [{ id: 'n7', label: '∅' }]
                },
                {
                  id: 'n8',
                  label: 'InflP',
                  children: [
                    {
                      id: 'n9',
                      label: 'DP',
                      children: [
                        {
                          id: 'n10',
                          label: 'D',
                          children: [{ id: 'n11', label: 'Marie', word: 'Marie' }]
                        }
                      ]
                    },
                    {
                      id: 'n12',
                      label: 'Infl\'',
                      children: [
                        { id: 'n13', label: 'Infl', children: [{ id: 'n14', label: 'a', word: 'a' }] },
                        {
                          id: 'n15',
                          label: 'VP',
                          children: [
                            { id: 'n16', label: 'V', children: [{ id: 'n17', label: 'dit', word: 'dit' }] },
                            {
                              id: 'n18',
                              label: 'CP',
                              children: [
                                { id: 'n19', label: 'C', children: [{ id: 'n20', label: 'que', word: 'que' }] },
                                {
                                  id: 'n21',
                                  label: 'InflP',
                                  children: [
                                    { id: 'n22', label: 'DP', children: [{ id: 'n23', label: 'D', children: [{ id: 'n24', label: 'Paul', word: 'Paul' }] }] },
                                    { id: 'n25', label: 'Infl', children: [{ id: 'n26', label: 'partirait', word: 'partirait' }] }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A malformed duplicate-subject analysis.'
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  assert.throws(
    () => normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence),
    /Tree overt terminals do not match the input sentence order/
  );
});

test('buildCanonicalMovementEvents preserves explicit head movement without inferring a lower launch trace', () => {
  const tree = {
    id: 'n1',
    label: 'TP',
    children: [
      {
        id: 'n2',
        label: 'T',
        children: [{ id: 'n3', label: 'vette', word: 'vette' }]
      },
      {
        id: 'n4',
        label: 'VP',
        children: [
          {
            id: 'n5',
            label: 'V',
            children: [{ id: 'n6', label: 'vette', word: 'vette' }]
          }
        ]
      }
    ]
  };

  const derivationSteps = [
    {
      operation: 'HeadMove',
      targetNodeId: 'n2',
      sourceNodeIds: ['n4'],
      note: 'Verb raises to T.'
    }
  ];

  const movementEvents = buildCanonicalMovementEvents({
    tree,
    derivationSteps,
    rawMovementEvents: [
      {
        operation: 'HeadMove',
        fromNodeId: 'n4',
        toNodeId: 'n2',
        stepIndex: 0,
        note: 'Ungrounded head movement.'
      }
    ]
  });

  assert.ok(Array.isArray(movementEvents));
  assert.equal(movementEvents.length, 1);
  assert.equal(movementEvents[0].operation, 'HeadMove');
  assert.equal(movementEvents[0].fromNodeId, 'n4');
  assert.equal(movementEvents[0].toNodeId, 'n2');
});

test('buildCanonicalMovementEventsFromGrowthFrames keeps an explicit lower head trace as the head-move source', () => {
  const growthFrames = [
    {
      operation: 'Project',
      workspaceForest: [
        {
          id: 'vP_mat',
          label: 'vP',
          children: [
            {
              id: 'v_mat_bar',
              label: "v'",
              children: [
                {
                  id: 'V_mat',
                  label: 'V',
                  children: [{ id: 'persuaded_term', label: 'persuaded', word: 'persuaded' }]
                },
                {
                  id: 'CP_emb',
                  label: 'CP',
                  children: [
                    {
                      id: 'C_emb',
                      label: 'C',
                      children: [{ id: 'C_emb_term', label: '∅', word: '∅' }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      operation: 'HeadMove',
      chainId: 'chain_V_to_v',
      movement: {
        operation: 'HeadMove',
        sourceNodeId: 'V_mat',
        targetNodeId: 'v_mat_complex',
        note: 'Lexical verb head-moves to v.'
      },
      workspaceForest: [
        {
          id: 'vP_mat',
          label: 'vP',
          children: [
            {
              id: 'v_mat_bar',
              label: "v'",
              children: [
                { id: 'v_mat_complex', label: 'v', word: 'persuaded' },
                {
                  id: 'CP_emb',
                  label: 'CP',
                  children: [{ id: 'V_mat', label: 't_V' }]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const movementEvents = buildCanonicalMovementEventsFromGrowthFrames(
    growthFrames,
    growthFrames[1].workspaceForest[0]
  );

  assert.equal(movementEvents.length, 1);
  assert.equal(movementEvents[0].operation, 'HeadMove');
  assert.equal(movementEvents[0].fromNodeId, 'V_mat');
  assert.equal(movementEvents[0].toNodeId, 'v_mat_complex');
});

test('buildCanonicalMovementEventsFromGrowthFrames keeps head-move landings tied to the moved head yield', () => {
  const growthFrames = [
    {
      operation: 'ExternalMerge',
      workspaceForest: [
        {
          id: 'VP_higher',
          label: 'VP',
          children: [
            {
              id: 'DP_John',
              label: 'DP',
              children: [{ id: 'D_John', label: 'D', children: [{ id: 'John_tok', label: 'John', word: 'John' }] }]
            },
            {
              id: 'Vbar_higher',
              label: "V'",
              children: [
                {
                  id: 'V_persuaded',
                  label: 'V',
                  children: [{ id: 'persuaded_tok', label: 'persuaded', word: 'persuaded' }]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      operation: 'HeadMove',
      chainId: 'chain_v_move',
      movement: {
        operation: 'HeadMove',
        sourceNodeId: 'V_persuaded_trace',
        targetNodeId: 'V_persuaded_landed',
        note: 'Lexical verb moves to higher V shell.'
      },
      workspaceForest: [
        {
          id: 'VP_higher',
          label: 'VP',
          children: [
            {
              id: 'DP_John',
              label: 'DP',
              children: [{ id: 'D_John', label: 'D', children: [{ id: 'John_tok', label: 'John', word: 'John' }] }]
            },
            {
              id: 'Vbar_higher',
              label: "V'",
              children: [
                {
                  id: 'V_higher',
                  label: 'V',
                  children: [{ id: 'persuaded_tok', label: 'persuaded', word: 'persuaded' }]
                },
                {
                  id: 'VP_lower',
                  label: 'VP',
                  children: [
                    {
                      id: 'Vbar_lower',
                      label: "V'",
                      children: [
                        {
                          id: 'V_persuaded_trace',
                          label: 'V',
                          children: [{ id: 't_v', label: 't_v' }]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const finalTree = {
    id: 'CP_mat',
    label: 'CP',
    children: [
      {
        id: 'Cbar_mat',
        label: "C'",
        children: [
          { id: 'C_mat', label: 'C', children: [{ id: 'C_null', label: '∅' }] },
          {
            id: 'InflP_mat',
            label: 'InflP',
            children: [
              {
                id: 'DP_John_landed',
                label: 'DP',
                children: [{ id: 'D_John', label: 'D', children: [{ id: 'John_tok', label: 'John', word: 'John' }] }]
              },
              {
                id: 'Inflbar_mat',
                label: "Infl'",
                children: [
                  { id: 'Infl_mat', label: 'Infl', children: [{ id: 'Infl_null', label: '∅' }] },
                  {
                    id: 'VP_higher',
                    label: 'VP',
                    children: [
                      {
                        id: 'DP_John_trace',
                        label: 'DP',
                        children: [{ id: 't_John', label: 't_1' }]
                      },
                      {
                        id: 'Vbar_higher',
                        label: "V'",
                        children: [
                          {
                            id: 'V_higher',
                            label: 'V',
                            children: [{ id: 'persuaded_tok', label: 'persuaded', word: 'persuaded' }]
                          },
                          {
                            id: 'VP_lower',
                            label: 'VP',
                            children: [
                              {
                                id: 'Vbar_lower',
                                label: "V'",
                                children: [
                                  {
                                    id: 'V_persuaded_trace',
                                    label: 'V',
                                    children: [{ id: 't_v', label: 't_v' }]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const movementEvents = buildCanonicalMovementEventsFromGrowthFrames(growthFrames, finalTree);

  assert.equal(movementEvents.length, 1);
  assert.equal(movementEvents[0].operation, 'HeadMove');
  assert.equal(movementEvents[0].fromNodeId, 'V_persuaded_trace');
  assert.equal(movementEvents[0].toNodeId, 'V_higher');
});

test('buildCanonicalMovementEvents preserves only the explicit successive head-movement hops the model encoded', () => {
  const tree = {
    id: 'n1',
    label: 'CP',
    children: [
      {
        id: 'n2',
        label: "C'",
        children: [
          {
            id: 'n3',
            label: 'C',
            children: [
              {
                id: 'n4',
                label: 'V',
                children: [{ id: 'n5', label: "D'oscail", word: "D'oscail" }]
              }
            ]
          },
          {
            id: 'n6',
            label: 'InflP',
            children: [
              {
                id: 'n7',
                label: 'Infl',
                children: [{ id: 'n8', label: 't' }]
              },
              {
                id: 'n9',
                label: 'VP',
                children: [
                  {
                    id: 'n10',
                    label: 'V',
                    children: [{ id: 'n11', label: 't' }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const derivationSteps = [
    {
      operation: 'Project',
      targetNodeId: 'n7',
      targetLabel: 'Infl',
      sourceNodeIds: ['n11'],
      sourceLabels: ['t'],
      recipe: 't -> Infl'
    },
    {
      operation: 'HeadMove',
      targetNodeId: 'n3',
      targetLabel: 'C',
      sourceNodeIds: ['n11'],
      sourceLabels: ['t'],
      recipe: 't -> C',
      note: 'Verb raises to C.'
    }
  ];

  const movementEvents = buildCanonicalMovementEvents({
    tree,
    derivationSteps,
    rawMovementEvents: [
      {
        operation: 'HeadMove',
        fromNodeId: 'n11',
        toNodeId: 'n3',
        stepIndex: 1,
        note: 'Verb raises to C.'
      }
    ]
  });

  assert.ok(Array.isArray(movementEvents));
  assert.equal(movementEvents.length, 1);
  assert.deepEqual(
    movementEvents.map((event) => [event.operation, event.fromNodeId, event.toNodeId]),
    [
      ['HeadMove', 'n11', 'n3']
    ]
  );
});

test('buildCanonicalMovementEvents keeps generic Move generic even when it lands in C', () => {
  const tree = {
    id: 'n1',
    label: 'CP',
    children: [
      {
        id: 'n2',
        label: 'C',
        children: [{ id: 'n3', label: 'did', word: 'did' }]
      },
      {
        id: 'n4',
        label: 'TP',
        children: [
          {
            id: 'n5',
            label: 'T',
            children: [{ id: 'n6', label: 't' }]
          }
        ]
      }
    ]
  };

  const movementEvents = buildCanonicalMovementEvents({
    tree,
    derivationSteps: [
      {
        operation: 'Move',
        targetNodeId: 'n2',
        sourceNodeIds: ['n6'],
        note: 'Movement to C is part of the committed derivation.'
      }
    ],
    rawMovementEvents: [
      {
        operation: 'Move',
        fromNodeId: 'n6',
        toNodeId: 'n2',
        stepIndex: 0,
        note: 'Movement to C is part of the committed derivation.'
      }
    ]
  });

  assert.deepEqual(
    movementEvents?.map((event) => event.operation),
    ['Move']
  );
});

test('normalizeParseBundle does not require movementDecision when explicit movement is encoded elsewhere', () => {
  const sentence = 'Did Marie leave?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'C',
              children: [{ id: 'n3', label: 'Did', word: 'Did' }]
            },
            {
              id: 'n4',
              label: 'TP',
              children: [
                {
                  id: 'n5',
                  label: 'DP',
                  children: [{ id: 'n6', label: 'Marie', word: 'Marie' }]
                },
                {
                  id: 'n7',
                  label: 'VP',
                  children: [
                    {
                      id: 'n8',
                      label: 'V',
                      children: [{ id: 'n9', label: 'leave', word: 'leave' }]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A clause with head movement in the committed analysis.',
        derivationSteps: [
          {
            operation: 'Move',
            targetNodeId: 'n2',
            sourceNodeIds: ['n10'],
            note: 'A contradictory movement step.'
          }
        ],
        movementEvents: [
          {
            operation: 'Move',
            fromNodeId: 'n10',
            toNodeId: 'n2',
            traceNodeId: 'n10',
            stepIndex: 0,
            note: 'A contradictory movement event.'
          }
        ]
      }
    ]
  };
  payload.analyses[0].tree.children[1].children[1].children.push({
    id: 'n10',
    label: 'V',
    children: [{ id: 'n11', label: 't' }]
  });
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(payload, 'minimalism', sentence);
  assert.equal(normalized.analyses[0].movementEvents?.length, 1);
});

test('normalizeParseBundle ignores legacy movementDecision in the normalized output shape', () => {
  const sentence = 'Melyik konyvet vette meg Anna?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n0',
          label: 'CP',
          children: [
            {
              id: 'n1',
              label: 'DP',
              children: [
                { id: 'n2', label: 'D', children: [{ id: 'n3', label: 'Melyik', word: 'Melyik' }] },
                { id: 'n4', label: 'NP', children: [{ id: 'n5', label: 'N', word: 'konyvet' }] }
              ]
            },
            { id: 'n6', label: 'C', children: [{ id: 'n7', label: '∅', word: '∅' }] },
            {
              id: 'n8',
              label: 'TP',
              children: [
                { id: 'n9', label: 'T', children: [{ id: 'n10', label: 'vette', word: 'vette' }] },
                {
                  id: 'n11',
                  label: 'VP',
                  children: [
                    { id: 'n12', label: 'V', word: 'meg' },
                    { id: 'n13', label: 'DP', children: [{ id: 'n14', label: 'D', word: 'Anna' }] }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'No displacement operation is encoded in the derivation, so the pronounced order is read directly from the final tree.',
        movementDecision: {
          hasMovement: true,
          rationale: 'The wh-phrase moves to the clause edge.'
        },
        movementEvents: []
      }
    ]
  };

  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = ['Melyik', 'konyvet', 'vette', 'meg', 'Anna'];

  const normalized = normalizeParseBundle(payload, 'minimalism', sentence);
  assert.ok(!Object.prototype.hasOwnProperty.call(normalized.analyses[0], 'movementDecision'));
  assert.deepStrictEqual(normalized.analyses[0].movementEvents, []);
});

test('normalizeParseBundle rejects trees whose overt constituents realize a non-sentence order', () => {
  const sentence = 'The student said that the lecture ended early.';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                { id: 'n3', label: 'D', children: [{ id: 'n4', label: 'The', word: 'The' }] },
                { id: 'n5', label: 'NP', children: [{ id: 'n6', label: 'lecture', word: 'lecture' }] }
              ]
            },
            {
              id: 'n7',
              label: 'VP',
              children: [
                { id: 'n8', label: 'V', children: [{ id: 'n9', label: 'said', word: 'said' }] },
                { id: 'n10', label: 'AdvP', children: [{ id: 'n11', label: 'early', word: 'early' }] }
              ]
            },
            {
              id: 'n12',
              label: 'CP',
              children: [
                { id: 'n13', label: 'C', children: [{ id: 'n14', label: 'that', word: 'that' }] },
                {
                  id: 'n15',
                  label: 'InflP',
                  children: [
                    { id: 'n16', label: 'DP', children: [{ id: 'n17', label: 'N', children: [{ id: 'n18', label: 'student', word: 'student' }] }] },
                    { id: 'n19', label: 'VP', children: [{ id: 'n20', label: 'V', children: [{ id: 'n21', label: 'ended', word: 'ended' }] }] }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'An impossible interleaving analysis.'
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  assert.throws(
    () => normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence),
    /Tree overt terminals do not match the input sentence order/
  );
});

test('normalizeParseBundle rejects misordered TP siblings in minimalism wh-questions', () => {
  const sentence = 'Quale poema ha scritto Elisa?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                {
                  id: 'n3',
                  label: 'D',
                  children: [{ id: 'n4', label: 'Quale', word: 'Quale' }]
                },
                {
                  id: 'n5',
                  label: 'NP',
                  children: [{ id: 'n6', label: 'N', children: [{ id: 'n7', label: 'poema', word: 'poema' }] }]
                }
              ]
            },
            {
              id: 'n8',
              label: 'C',
              children: [{ id: 'n9', label: 'Aux', children: [{ id: 'n10', label: 'ha', word: 'ha' }] }]
            },
            {
              id: 'n11',
              label: 'TP',
              children: [
                { id: 'n12', label: 'DP', children: [{ id: 'n13', label: 'Elisa', word: 'Elisa' }] },
                { id: 'n14', label: 'T', children: [{ id: 'n15', label: 'V', children: [{ id: 'n16', label: 'scritto', word: 'scritto' }] }] }
              ]
            }
          ]
        },
        explanation: 'A wh-question with a recoverably misordered TP.'
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  assert.throws(
    () => normalizeParseBundle(withMovementDecision(payload), 'minimalism', sentence),
    /Tree overt terminals do not match the input sentence order/
  );
});

test('normalizeParseBundle derives surface spans canonically when the model omits them', () => {
  const sentence = 'The story was shocking';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'TP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                { id: 'n3', label: 'D', children: [{ id: 'n4', label: 'The', word: 'The' }] },
                { id: 'n5', label: 'NP', children: [{ id: 'n6', label: 'story', word: 'story' }] }
              ]
            },
            { id: 'n7', label: 'T', children: [{ id: 'n8', label: 'was', word: 'was' }] },
            { id: 'n9', label: 'AP', children: [{ id: 'n10', label: 'shocking', word: 'shocking' }] }
          ]
        },
        explanation: 'A simple predicational clause.',
        surfaceOrder: tokenize(sentence)
      }
    ]
  };

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(normalized.analyses[0].surfaceOrder, ['The', 'story', 'was', 'shocking']);
  assert.deepEqual(normalized.analyses[0].tree.surfaceSpan, [0, 3]);
});

test('normalizeParseBundle flattens interleaving flat-node shells that would otherwise block correct surface order', () => {
  const sentence = 'Ha comprado Ana el libro?';
  const payload = {
    analyses: [
      {
        nodes: [
          { id: 'n0', label: 'CP', siblingOrder: 0 },
          { id: 'n1', label: "C'", parentId: 'n0', siblingOrder: 0 },
          { id: 'n2', label: 'C', parentId: 'n1', siblingOrder: 0 },
          { id: 'n3', label: 'Ha', parentId: 'n2', word: 'Ha', tokenIndex: 0 },
          { id: 'n4', label: 'InflP', parentId: 'n1', siblingOrder: 1 },
          { id: 'n5', label: 'DP', parentId: 'n4', siblingOrder: 0 },
          { id: 'n6', label: 'D', parentId: 'n5', siblingOrder: 0, word: '∅' },
          { id: 'n7', label: 'NP', parentId: 'n5', siblingOrder: 1 },
          { id: 'n8', label: 'N', parentId: 'n7', siblingOrder: 0, word: 'Ana', tokenIndex: 2 },
          { id: 'n9', label: "Infl'", parentId: 'n4', siblingOrder: 1 },
          { id: 'n10', label: 'Infl', parentId: 'n9', siblingOrder: 0, word: 't_Ha' },
          { id: 'n11', label: 'VP', parentId: 'n9', siblingOrder: 1 },
          { id: 'n12', label: "V'", parentId: 'n11', siblingOrder: 0 },
          { id: 'n13', label: 'V', parentId: 'n12', siblingOrder: 0, word: 'comprado', tokenIndex: 1 },
          { id: 'n14', label: 'DP', parentId: 'n12', siblingOrder: 1 },
          { id: 'n15', label: "D'", parentId: 'n14', siblingOrder: 0 },
          { id: 'n16', label: 'D', parentId: 'n15', siblingOrder: 0, word: 'el', tokenIndex: 3 },
          { id: 'n17', label: 'NP', parentId: 'n15', siblingOrder: 1 },
          { id: 'n18', label: 'N', parentId: 'n17', siblingOrder: 0, word: 'libro', tokenIndex: 4 }
        ],
        rootId: 'n0',
        explanation: 'Spanish auxiliary-fronting with a subject shell that interleaves the overt order.',
        movementDecision: {
          hasMovement: true,
          rationale: 'The auxiliary moves to C.'
        },
        movementEvents: [
          {
            operation: 'HeadMove',
            fromNodeId: 'n10',
            toNodeId: 'n3',
            traceNodeId: 'n10'
          }
        ]
      }
    ]
  };

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  assert.deepEqual(normalized.analyses[0].surfaceOrder, ['Ha', 'comprado', 'Ana', 'el', 'libro']);
});

test('normalizeParseBundle ignores model-provided spans on null heads and derives canonical spans', () => {
  const sentence = 'Hanako-ga eiga-o mita.';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          surfaceSpan: [0, 2],
          children: [
            {
              id: 'n2',
              label: 'C',
              surfaceSpan: [0, 2],
              children: [
                {
                  id: 'n3',
                  label: 'C',
                  surfaceSpan: [0, 2],
                  children: [{ id: 'n4', label: '∅', children: [] }]
                }
              ]
            },
            {
              id: 'n5',
              label: 'InflP',
              surfaceSpan: [0, 2],
              children: [
                { id: 'n6', label: 'DP', surfaceSpan: [0, 0], children: [{ id: 'n7', label: 'N', surfaceSpan: [0, 0], children: [{ id: 'n8', label: 'Hanako-ga', word: 'Hanako-ga', surfaceSpan: [0, 0] }] }] },
                { id: 'n9', label: 'VP', surfaceSpan: [1, 2], children: [
                  { id: 'n10', label: 'DP', surfaceSpan: [1, 1], children: [{ id: 'n11', label: 'N', surfaceSpan: [1, 1], children: [{ id: 'n12', label: 'eiga-o', word: 'eiga-o', surfaceSpan: [1, 1] }] }] },
                  { id: 'n13', label: 'V', surfaceSpan: [2, 2], children: [{ id: 'n14', label: 'mita', word: 'mita', surfaceSpan: [2, 2] }] }
                ] }
              ]
            }
          ]
        },
        explanation: 'A bad tree with overt spans on null C.',
        surfaceOrder: tokenize(sentence)
      }
    ]
  };

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(normalized.analyses[0].surfaceOrder, ['Hanako-ga', 'eiga-o', 'mita']);
  assert.deepEqual(normalized.analyses[0].tree.surfaceSpan, [0, 2]);
});

test('normalizeParseBundle rejects V-initial trees whose deeper structure cannot realize the sentence order', () => {
  const sentence = 'Ha comprado Ana el libro?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          surfaceSpan: [0, 4],
          children: [
            {
              id: 'n2',
              label: 'C\'',
              surfaceSpan: [0, 4],
              children: [
                {
                  id: 'n3',
                  label: 'C',
                  surfaceSpan: [0, 0],
                  children: [{ id: 'n4', label: 'V', surfaceSpan: [0, 0], children: [{ id: 'n5', label: 'Ha', word: 'Ha', surfaceSpan: [0, 0] }] }]
                },
                {
                  id: 'n6',
                  label: 'InflP',
                  surfaceSpan: [1, 4],
                  children: [
                    { id: 'n7', label: 'DP', surfaceSpan: [2, 2], children: [{ id: 'n8', label: 'N', surfaceSpan: [2, 2], children: [{ id: 'n9', label: 'Ana', word: 'Ana', surfaceSpan: [2, 2] }] }] },
                    { id: 'n10', label: 'VP', surfaceSpan: [1, 4], children: [
                      { id: 'n11', label: 'V', surfaceSpan: [1, 1], children: [{ id: 'n12', label: 'comprado', word: 'comprado', surfaceSpan: [1, 1] }] },
                      { id: 'n13', label: 'DP', surfaceSpan: [3, 4], children: [
                        { id: 'n14', label: 'D', surfaceSpan: [3, 3], children: [{ id: 'n15', label: 'el', word: 'el', surfaceSpan: [3, 3] }] },
                        { id: 'n16', label: 'NP', surfaceSpan: [4, 4], children: [{ id: 'n17', label: 'N', surfaceSpan: [4, 4], children: [{ id: 'n18', label: 'libro', word: 'libro', surfaceSpan: [4, 4] }] }] }
                      ] }
                    ] }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A bad V-initial tree whose children do not realize the sentence.',
        surfaceOrder: tokenize(sentence)
      }
    ]
  };
  payload.analyses[0].tree.children[0].children[1].children = [
    payload.analyses[0].tree.children[0].children[1].children[0],
    payload.analyses[0].tree.children[0].children[1].children[1]
  ];
  payload.analyses[0].tree.children[0].children[1].children[0] = {
    id: 'n7',
    label: 'DP',
    children: [{ id: 'n8', label: 'N', children: [{ id: 'n9', label: 'Ana', word: 'Ana' }] }]
  };
  payload.analyses[0].tree.children[0].children[1].children[1] = {
    id: 'n10',
    label: 'VP',
    children: [
      { id: 'n11', label: 'V', children: [{ id: 'n12', label: 'comprado', word: 'comprado' }] },
      {
        id: 'n13',
        label: 'DP',
        children: [
          { id: 'n14', label: 'D', children: [{ id: 'n15', label: 'el', word: 'el' }] },
          { id: 'n16', label: 'NP', children: [{ id: 'n17', label: 'N', children: [{ id: 'n18', label: 'libro', word: 'libro' }] }] }
        ]
      }
    ]
  };

  assert.throws(
    () => normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence),
    /Tree overt terminals do not match the input sentence order/
  );
});

test('harmonizeExplanationWithDerivation preserves substantive model prose without reconciliation edits', () => {
  const explanation = 'The clause is analyzed as a finite CP, and the wh-phrase moves to Spec,CP.';
  const tree = {
    id: 'n1',
    label: 'CP',
    children: [
      {
        id: 'n2',
        label: 'C',
        children: [{ id: 'n3', label: 'did', word: 'did' }]
      }
    ]
  };

  const normalizedExplanation = harmonizeExplanationWithDerivation(
    explanation,
    [],
    [],
    tree,
    'xbar'
  );

  assert.equal(normalizedExplanation, 'The clause is analyzed as a finite CP, and the wh-phrase moves to Spec,CP.');
});

test('harmonizeExplanationWithDerivation falls back only when the model explanation is empty', () => {
  const tree = {
    id: 'n1',
    label: 'CP',
    children: [
      {
        id: 'n2',
        label: 'C',
        children: [{ id: 'n3', label: 'that', word: 'that' }]
      }
    ]
  };

  const normalizedExplanation = harmonizeExplanationWithDerivation(
    '',
    [],
    [],
    tree,
    'xbar'
  );

  assert.match(normalizedExplanation, /committed X-bar analysis/i);
  assert.match(normalizedExplanation, /analyzed as a CP/i);
});

test('normalizeParseBundle collapses overt unary head-stacking at landing sites', () => {
  const sentence = 'Kya Anu ne chai banayi?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: "C'",
              children: [
                {
                  id: 'n3',
                  label: 'C',
                  children: [
                    {
                      id: 'n4',
                      label: 'Q',
                      children: [{ id: 'n5', label: 'Kya', word: 'Kya' }]
                    }
                  ]
                },
                {
                  id: 'n6',
                  label: 'InflP',
                  children: [
                    {
                      id: 'n7',
                      label: 'DP',
                      children: [
                        { id: 'n8', label: 'N', children: [{ id: 'n9', label: 'Anu', word: 'Anu' }] },
                        { id: 'n10', label: 'D', children: [{ id: 'n11', label: 'ne', word: 'ne' }] }
                      ]
                    },
                    {
                      id: 'n12',
                      label: 'VP',
                      children: [
                        { id: 'n13', label: 'DP', children: [{ id: 'n14', label: 'N', children: [{ id: 'n15', label: 'chai', word: 'chai' }] }] },
                        { id: 'n16', label: 'V', children: [{ id: 'n17', label: 'banayi', word: 'banayi' }] }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A malformed unary head-stack analysis.'
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(normalized.analyses[0].surfaceOrder, ['Kya', 'Anu', 'ne', 'chai', 'banayi']);
  const cNode = normalized.analyses[0].tree.children[0].children[0];
  assert.equal(cNode.label, 'C');
  assert.equal(Array.isArray(cNode.children), true);
  assert.equal(cNode.children.length, 1);
  assert.equal(cNode.children[0].label, 'Kya');
  assert.equal(cNode.children[0].word, 'Kya');
});

test('normalizeParseBundle remaps movement landing ids after collapsing stacked head shells', () => {
  const sentence = 'Has Elena finished the report?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: "C'",
              children: [
                {
                  id: 'n3',
                  label: 'C',
                  children: [
                    {
                      id: 'n4',
                      label: 'Aux',
                      children: [{ id: 'n5', label: 'Has', word: 'Has' }]
                    }
                  ]
                },
                {
                  id: 'n6',
                  label: 'InflP',
                  children: [
                    {
                      id: 'n7',
                      label: 'DP',
                      children: [{ id: 'n8', label: 'N', children: [{ id: 'n9', label: 'Elena', word: 'Elena' }] }]
                    },
                    {
                      id: 'n10',
                      label: "Infl'",
                      children: [
                        { id: 'n11', label: 'Infl', children: [{ id: 'n12', label: '∅', word: '∅' }] },
                        {
                          id: 'n13',
                          label: 'VP',
                          children: [
                            { id: 'n14', label: 'V', children: [{ id: 'n15', label: 'finished', word: 'finished' }] },
                            {
                              id: 'n16',
                              label: 'DP',
                              children: [
                                { id: 'n17', label: 'D', children: [{ id: 'n18', label: 'the', word: 'the' }] },
                                { id: 'n19', label: 'N', children: [{ id: 'n20', label: 'report', word: 'report' }] }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        movementDecision: {
          hasMovement: true,
          rationale: 'Head movement is part of the committed analysis.'
        },
        movementEvents: [
          {
            operation: 'HeadMove',
            fromNodeId: 'n11',
            toNodeId: 'n4',
            traceNodeId: 'n12'
          }
        ],
        explanation: 'An auxiliary-in-C analysis.'
      }
    ]
  };

  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  assert.deepEqual(normalized.analyses[0].surfaceOrder, ['Has', 'Elena', 'finished', 'the', 'report']);
  assert.equal(normalized.analyses[0].movementEvents?.[0]?.toNodeId, 'n3');
  const cNode = normalized.analyses[0].tree.children[0].children[0];
  assert.equal(cNode.label, 'C');
  assert.equal(cNode.children[0].label, 'Has');
});

test('normalizeParseBundle does not misclassify ordinary t-initial words as traces', () => {
  const sentence = 'The story was shocking';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'TP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                { id: 'n3', label: 'D', children: [{ id: 'n4', label: 'The', word: 'The' }] },
                { id: 'n5', label: 'NP', children: [{ id: 'n6', label: 'story', word: 'story' }] }
              ]
            },
            {
              id: 'n7',
              label: 'T',
              children: [{ id: 'n8', label: 'was', word: 'was' }]
            },
            {
              id: 'n9',
              label: 'AP',
              children: [{ id: 'n10', label: 'shocking', word: 'shocking' }]
            }
          ]
        },
        explanation: 'A simple predicational clause.'
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(normalized.analyses[0].surfaceOrder, ['The', 'story', 'was', 'shocking']);
});

test('normalizeParseBundle does not misclassify hyphenated lexical words like t-aran as traces', () => {
  const sentence = 'Dith Niamh an t-aran.';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: "C'",
              children: [
                {
                  id: 'n3',
                  label: 'C',
                  children: [{ id: 'n4', label: 'Dith', word: 'Dith' }]
                },
                {
                  id: 'n5',
                  label: 'InflP',
                  children: [
                    {
                      id: 'n6',
                      label: 'DP',
                      children: [{ id: 'n7', label: 'D', children: [{ id: 'n8', label: 'Niamh', word: 'Niamh' }] }]
                    },
                    {
                      id: 'n9',
                      label: "Infl'",
                      children: [
                        {
                          id: 'n10',
                          label: 'Infl',
                          children: [{ id: 'n11', label: '∅' }]
                        },
                        {
                          id: 'n12',
                          label: 'VP',
                          children: [
                            { id: 'n13', label: 'V', children: [{ id: 'n14', label: 't' }] },
                            {
                              id: 'n15',
                              label: 'DP',
                              children: [
                                {
                                  id: 'n16',
                                  label: "D'",
                                  children: [
                                    { id: 'n17', label: 'D', word: 'an' },
                                    { id: 'n18', label: 'NP', children: [{ id: 'n19', label: 'N', word: 't-aran' }] }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A VSO declarative with head movement and an overt object DP.'
      }
    ]
  };

  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = ['Dith', 'Niamh', 'an', 't-aran'];
  payload.analyses[0].movementDecision = {
    hasMovement: true,
    rationale: 'Head movement is posited in the committed analysis.'
  };
  payload.analyses[0].movementEvents = [
    { operation: 'HeadMove', fromNodeId: 'n14', toNodeId: 'n3', traceNodeId: 'n14' }
  ];

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  assert.deepEqual(normalized.analyses[0].surfaceOrder, ['Dith', 'Niamh', 'an', 't-aran']);
});

test('normalizeParseBundle canonicalizes split clause-edge moved phrases into one overt DP shell', () => {
  const sentence = 'Que carta escribio Lucia?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'root',
          label: 'CP',
          children: [
            {
              id: 'c_head',
              label: 'C',
              children: [{ id: 'que', label: 'Que', word: 'Que' }]
            },
            {
              id: 'dp_obj',
              label: 'DP',
              children: [
                {
                  id: 'd_obj',
                  label: 'D',
                  children: [{ id: 'null_d', label: '∅', word: '∅' }]
                },
                {
                  id: 'np_obj',
                  label: 'NP',
                  children: [{ id: 'n_obj', label: 'N', children: [{ id: 'carta', label: 'carta', word: 'carta' }] }]
                }
              ]
            },
            {
              id: 'tp',
              label: 'TP',
              children: [
                { id: 't_head', label: 'T', children: [{ id: 'v_t', label: 'escribio', word: 'escribio' }] },
                { id: 'subj', label: 'DP', children: [{ id: 'lucia', label: 'N', word: 'Lucia' }] },
                {
                  id: 'vp',
                  label: 'VP',
                  children: [
                    { id: 'v_trace', label: 'V', word: '∅' },
                    { id: 'obj_trace', label: 'DP', word: 'trace_DP' }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A Spanish wh-question with a split left-edge phrase.',
        movementDecision: {
          hasMovement: true,
          rationale: 'The object DP moves to the left edge and the verb moves to T.'
        },
        movementEvents: [
          {
            operation: 'Move',
            fromNodeId: 'obj_trace',
            toNodeId: 'dp_obj',
            traceNodeId: 'obj_trace'
          },
          {
            operation: 'HeadMove',
            fromNodeId: 'v_trace',
            toNodeId: 'v_t',
            traceNodeId: 'v_trace'
          }
        ]
      }
    ]
  };

  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(payload, 'minimalism', sentence);
  const tree = normalized.analyses[0].tree;
  assert.deepEqual(normalized.analyses[0].surfaceOrder, ['Que', 'carta', 'escribio', 'Lucia']);
  assert.equal(tree.children[0].label, 'C');
  assert.equal(tree.children[0].children[0].label, '∅');
  assert.equal(tree.children[1].label, 'DP');
  assert.equal(tree.children[1].children[0].label, 'D');
  assert.equal(tree.children[1].children[0].children[0].word, 'Que');
});

test('normalizeParseBundle inserts a dedicated lower head copy for assisted head movement sourced from a shell', () => {
  const sentence = 'vette meg Anna';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'tp',
          label: 'TP',
          children: [
            { id: 't_head', label: 'T', word: 'vette' },
            {
              id: 'vp',
              label: 'VP',
              children: [
                { id: 'v_particle', label: 'V', word: 'meg' },
                {
                  id: 'subj',
                  label: 'DP',
                  children: [{ id: 'subj_n', label: 'N', word: 'Anna' }]
                }
              ]
            }
          ]
        },
        explanation: 'A Hungarian-style head movement configuration.',
        movementDecision: {
          hasMovement: true,
          rationale: 'The verb raises to T.'
        },
        movementEvents: [
          {
            operation: 'HeadMove',
            fromNodeId: 'vp',
            toNodeId: 't_head',
            stepIndex: 3
          }
        ]
      }
    ]
  };

  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const analysis = normalizeParseBundle(payload, 'minimalism', sentence, 'flash-lite').analyses[0];
  assert.equal(analysis.movementEvents.length, 1);
  const headMove = analysis.movementEvents[0];
  assert.equal(headMove.operation, 'HeadMove');
  assert.notEqual(headMove.fromNodeId, 'vp');
  assert.ok(headMove.traceNodeId);
  const traceNode = findNodeById(analysis.tree, headMove.traceNodeId);
  assert.ok(traceNode);
  assert.equal(traceNode.word, '∅');
  const vp = findNodeById(analysis.tree, 'vp');
  assert.equal(vp.children[0].label, 'V');
  assert.equal(vp.children[0].children[0].word, '∅');
});

test('normalizeParseBundle drops assisted phrasal movement that illegitimately reuses a head trace source', () => {
  const sentence = 'Hvilken bok leste Nora?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                { id: 'n3', label: 'D', word: 'Hvilken' },
                { id: 'n4', label: 'NP', children: [{ id: 'n5', label: 'N', word: 'bok' }] }
              ]
            },
            {
              id: 'n6',
              label: 'C',
              children: [{ id: 'n7', label: 'leste', word: 'leste' }]
            },
            {
              id: 'n8',
              label: 'TP',
              children: [
                {
                  id: 'n9',
                  label: 'DP',
                  children: [{ id: 'n11', label: 'NP', children: [{ id: 'n12', label: 'N', word: 'Nora' }] }]
                },
                { id: 'n10', label: 'V', word: '∅' }
              ]
            }
          ]
        },
        explanation: 'A Norwegian wh-question with V2.',
        movementDecision: {
          hasMovement: true,
          rationale: 'Wh movement and verb movement are both part of the intended analysis.'
        },
        movementEvents: [
          {
            operation: 'HeadMove',
            fromNodeId: 'n10',
            toNodeId: 'n7',
            traceNodeId: 'n10',
            stepIndex: 12
          },
          {
            operation: 'Move',
            fromNodeId: 'n10',
            toNodeId: 'n2',
            traceNodeId: 'n10',
            stepIndex: 13
          }
        ]
      }
    ]
  };

  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const analysis = normalizeParseBundle(payload, 'minimalism', sentence, 'flash-lite').analyses[0];
  assert.equal(analysis.movementEvents.length, 1);
  assert.equal(analysis.movementEvents[0].operation, 'HeadMove');
  const launchSites = analysis.movementEvents.map((event) => event.traceNodeId || event.fromNodeId);
  assert.equal(new Set(launchSites).size, launchSites.length);
});

test('normalizeParseBundle materializes committed trace shells for growth-primary head and phrasal movement', () => {
  const sentence = 'Which pig did the farmer eat?';
  const finalTree = {
    id: 'cp',
    label: 'CP',
    children: [
      {
        id: 'dp_obj',
        label: 'DP',
        children: [
          {
            id: 'd_bar_obj',
            label: "D'",
            children: [
              { id: 'd_obj', label: 'D', children: [{ id: 'tok0', label: 'Which', word: 'Which', tokenIndex: 0 }] },
              { id: 'np_obj', label: 'NP', children: [{ id: 'n_bar_obj', label: "N'", children: [{ id: 'n_obj', label: 'N', children: [{ id: 'tok1', label: 'pig', word: 'pig', tokenIndex: 1 }] }] }] }
            ]
          }
        ]
      },
      {
        id: 'c_bar',
        label: "C'",
        children: [
          { id: 'c_head', label: 'C', children: [{ id: 'tok2', label: 'did', word: 'did', tokenIndex: 2 }] },
          {
            id: 'inflp',
            label: 'InflP',
            children: [
              {
                id: 'dp_subj',
                label: 'DP',
                children: [
                  {
                    id: 'd_bar_subj',
                    label: "D'",
                    children: [
                      { id: 'd_subj', label: 'D', children: [{ id: 'tok3', label: 'the', word: 'the', tokenIndex: 3 }] },
                      { id: 'np_subj', label: 'NP', children: [{ id: 'n_bar_subj', label: "N'", children: [{ id: 'n_subj', label: 'N', children: [{ id: 'tok4', label: 'farmer', word: 'farmer', tokenIndex: 4 }] }] }] }
                    ]
                  }
                ]
              },
              {
                id: 'infl_bar',
                label: "Infl'",
                children: [
                  { id: 't_did', label: 't' },
                  {
                    id: 'vp',
                    label: 'VP',
                    children: [
                      { id: 't_subj', label: 't' },
                      {
                        id: 'v_bar',
                        label: "V'",
                        children: [
                          { id: 'v_head', label: 'V', children: [{ id: 'tok5', label: 'eat', word: 'eat', tokenIndex: 5 }] },
                          { id: 't_obj', label: 't' }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            stepId: 'g1',
            operation: 'A-Move',
            chainId: 'chain_subj',
            movement: { operation: 'A-Move', sourceNodeId: 't_subj', targetNodeId: 'dp_subj' },
            workspaceForest: [JSON.parse(JSON.stringify(finalTree))]
          },
          {
            stepId: 'g2',
            operation: 'HeadMove',
            chainId: 'chain_head',
            movement: { operation: 'HeadMove', sourceNodeId: 't_did', targetNodeId: 'c_head' },
            workspaceForest: [JSON.parse(JSON.stringify(finalTree))]
          },
          {
            stepId: 'g3',
            operation: 'AbarMove',
            chainId: 'chain_obj',
            movement: { operation: 'AbarMove', sourceNodeId: 't_obj', targetNodeId: 'dp_obj' },
            workspaceForest: [JSON.parse(JSON.stringify(finalTree))]
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'The clause is a finite interrogative CP.' },
          { kind: 'chain', chainId: 'chain_subj', text: 'The subject A-moves to Spec,InflP.' },
          { kind: 'chain', chainId: 'chain_head', text: 'The auxiliary moves from Infl to C.' },
          { kind: 'chain', chainId: 'chain_obj', text: 'The wh phrase moves to Spec,CP.' }
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'pro').analyses[0];
  assert.equal(analysis.provenance?.treeSource, 'growthFrames');
  assert.equal(findNodeById(analysis.tree, 't_did__shell')?.label, 'Infl');
  assert.equal(findNodeById(analysis.tree, 't_subj__shell')?.label, 'DP');
  assert.equal(findNodeById(analysis.tree, 't_obj__shell')?.label, 'DP');
  assert.deepEqual(analysis.chains || [], []);
  assert.deepEqual(
    (analysis.noteBindings || [])
      .filter((binding) => binding.kind === 'chain')
      .map((binding) => binding.chainId)
      .sort(),
    ['chain_head', 'chain_obj', 'chain_subj']
  );
});

test('normalizeParseBundle preserves explicit model-authored case assignments without deriving missing ones', () => {
  const sentence = 'John seems to like Mary.';
  const payload = {
    analyses: [
      {
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 'g1',
            operation: 'Project',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'cbar_root',
                    label: "C'",
                    children: [
                      { id: 'c_null', label: 'C', children: [{ id: 'c_null_leaf', label: '∅' }] },
                      {
                        id: 'inflp_mat',
                        label: 'InflP',
                        children: [
                          {
                            id: 'dp_john_high',
                            label: 'DP',
                            case: 'Nominative',
                            assigner: 'Infl_pres',
                            caseEvidence: 'Matrix Infl checks nominative on the raised subject.',
                            children: [
                              {
                                id: 'dbar_john_high',
                                label: "D'",
                                children: [
                                  { id: 'd_john_high', label: 'D', children: [{ id: 'john_leaf', label: 'John', word: 'John', tokenIndex: 0 }] }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'inflbar_mat',
                            label: "Infl'",
                            children: [
                              { id: 'infl_mat', label: 'Infl', children: [{ id: 'infl_null', label: '∅' }] },
                              {
                                id: 'vp_mat',
                                label: 'VP',
                                children: [
                                  { id: 'v_seems', label: 'V', children: [{ id: 'seems_leaf', label: 'seems', word: 'seems', tokenIndex: 1 }] },
                                  {
                                    id: 'inflp_emb',
                                    label: 'InflP',
                                    children: [
                                      { id: 'trace_john', label: 'DP', children: [{ id: 'trace_john_leaf', label: 't_1' }] },
                                      {
                                        id: 'inflbar_emb',
                                        label: "Infl'",
                                        children: [
                                          { id: 'infl_to', label: 'Infl', children: [{ id: 'to_leaf', label: 'to', word: 'to', tokenIndex: 2 }] },
                                          {
                                            id: 'vp_emb',
                                            label: 'VP',
                                            children: [
                                              { id: 'v_like', label: 'V', children: [{ id: 'like_leaf', label: 'like', word: 'like', tokenIndex: 3 }] },
                                              {
                                                id: 'dp_mary',
                                                label: 'DP',
                                                case: 'Accusative',
                                                assigner: 'V_like',
                                                children: [
                                                  { id: 'dbar_mary', label: "D'", children: [{ id: 'd_mary', label: 'D', children: [{ id: 'mary_leaf', label: 'Mary', word: 'Mary', tokenIndex: 4 }] }] }
                                                ]
                                              }
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        noteBindings: [
          { kind: 'architecture', text: 'The sentence is a raising-to-subject construction with an infinitival complement.', stepIds: ['g1'], supportIds: ['dependency_1'] },
          { kind: 'licensing', text: 'John receives Nominative case from the matrix Infl, while Mary receives Accusative case from the embedded verb.', stepIds: ['g1'], supportIds: ['case_1', 'case_2'] }
        ],
        caseAssignments: [
          { assigneeLabel: 'John', case: 'Nominative', assigner: 'Infl_pres' },
          { assigneeLabel: 'Mary', case: 'Accusative', assigner: 'V_like' }
        ],
        clausalDependencies: [
          {
            type: 'raising',
            subtype: 'raising-to-subject',
            predicateLabel: 'seems',
            clauseLabel: 'to like Mary',
            dependentLabel: 'John'
          }
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'pro').analyses[0];
  assert.equal(analysis.caseAssignments.length, 2);
  const byAssignee = new Map((analysis.caseAssignments || []).map((entry) => [entry.assigneeLabel, entry]));
  assert.equal(byAssignee.get('John')?.case, 'Nominative');
  assert.equal(byAssignee.get('John')?.assigner, 'Infl_pres');
  assert.equal(byAssignee.get('Mary')?.case, 'Accusative');
  assert.equal(byAssignee.get('Mary')?.assigner, 'V_like');
});

test('normalizeParseBundle keeps complementizer and PP words like that/time in the overt yield', () => {
  const sentence = 'It was shocking that no one arrived on time';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'TP',
          children: [
            { id: 'n2', label: 'DP', children: [{ id: 'n3', label: 'It', word: 'It' }] },
            {
              id: 'n4',
              label: 'T',
              children: [{ id: 'n5', label: 'was', word: 'was' }]
            },
            {
              id: 'n6',
              label: 'AP',
              children: [
                { id: 'n7', label: 'A', children: [{ id: 'n8', label: 'shocking', word: 'shocking' }] },
                {
                  id: 'n9',
                  label: 'CP',
                  children: [
                    { id: 'n10', label: 'C', children: [{ id: 'n11', label: 'that', word: 'that' }] },
                    {
                      id: 'n12',
                      label: 'TP',
                      children: [
                        {
                          id: 'n13',
                          label: 'DP',
                          children: [
                            { id: 'n14', label: 'D', children: [{ id: 'n15', label: 'no', word: 'no' }] },
                            { id: 'n16', label: 'NP', children: [{ id: 'n17', label: 'one', word: 'one' }] }
                          ]
                        },
                        {
                          id: 'n18',
                          label: 'VP',
                          children: [
                            { id: 'n19', label: 'V', children: [{ id: 'n20', label: 'arrived', word: 'arrived' }] },
                            {
                              id: 'n21',
                              label: 'PP',
                              children: [
                                { id: 'n22', label: 'P', children: [{ id: 'n23', label: 'on', word: 'on' }] },
                                { id: 'n24', label: 'DP', children: [{ id: 'n25', label: 'N', children: [{ id: 'n26', label: 'time', word: 'time' }] }] }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A clausal adjective complement.'
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(
    normalized.analyses[0].surfaceOrder,
    ['It', 'was', 'shocking', 'that', 'no', 'one', 'arrived', 'on', 'time']
  );
});

test('normalizeParseBundle does not treat empty category leaves as overt terminals', () => {
  const sentence = 'I am proud of this victory';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                {
                  id: 'n3',
                  label: 'D',
                  children: [
                    { id: 'n4', label: 'Pron', children: [{ id: 'n5', label: 'I', word: 'I', children: [] }] }
                  ]
                }
              ]
            },
            {
              id: 'n6',
              label: 'C\'',
              children: [
                {
                  id: 'n7',
                  label: 'C',
                  children: [{ id: 'n8', label: 'C', children: [] }]
                },
                {
                  id: 'n9',
                  label: 'InflP',
                  children: [
                    { id: 'n10', label: 'Infl', children: [{ id: 'n11', label: 'am', children: [] }] },
                    {
                      id: 'n12',
                      label: 'AP',
                      children: [
                        { id: 'n13', label: 'A', children: [{ id: 'n14', label: 'proud', children: [] }] },
                        {
                          id: 'n15',
                          label: 'PP',
                          children: [
                            { id: 'n16', label: 'P', children: [{ id: 'n17', label: 'of', children: [] }] },
                            {
                              id: 'n18',
                              label: 'DP',
                              children: [
                                { id: 'n19', label: 'D', children: [{ id: 'n20', label: 'this', children: [] }] },
                                { id: 'n21', label: 'NP', children: [{ id: 'n22', label: 'N', children: [{ id: 'n23', label: 'victory', children: [] }] }] }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A tree with an empty category placeholder in C.'
      }
    ]
  };

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(normalized.analyses[0].surfaceOrder, ['I', 'am', 'proud', 'of', 'this', 'victory']);
});

test('normalizeParseBundle keeps lowercase lexical tokens like French a even when they resemble category labels', () => {
  const sentence = 'Marie a dit que Paul partirait.';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                {
                  id: 'n3',
                  label: "D'",
                  children: [
                    {
                      id: 'n4',
                      label: 'D',
                      children: [
                        {
                          id: 'n5',
                          label: 'N',
                          children: [{ id: 'n6', label: 'Marie', children: [] }]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              id: 'n7',
              label: "C'",
              children: [
                {
                  id: 'n8',
                  label: 'C',
                  children: [{ id: 'n9', label: '∅', children: [] }]
                },
                {
                  id: 'n10',
                  label: 'InflP',
                  children: [
                    {
                      id: 'n11',
                      label: "Infl'",
                      children: [
                        {
                          id: 'n12',
                          label: 'Infl',
                          children: [{ id: 'n13', label: 'a', children: [] }]
                        },
                        {
                          id: 'n14',
                          label: 'VP',
                          children: [
                            {
                              id: 'n15',
                              label: "V'",
                              children: [
                                {
                                  id: 'n16',
                                  label: 'V',
                                  children: [{ id: 'n17', label: 'dit', children: [] }]
                                },
                                {
                                  id: 'n18',
                                  label: 'CP',
                                  children: [
                                    {
                                      id: 'n19',
                                      label: "C'",
                                      children: [
                                        {
                                          id: 'n20',
                                          label: 'C',
                                          children: [{ id: 'n21', label: 'que', children: [] }]
                                        },
                                        {
                                          id: 'n22',
                                          label: 'InflP',
                                          children: [
                                            {
                                              id: 'n23',
                                              label: 'DP',
                                              children: [
                                                {
                                                  id: 'n24',
                                                  label: "D'",
                                                  children: [
                                                    {
                                                      id: 'n25',
                                                      label: 'D',
                                                      children: [
                                                        {
                                                          id: 'n26',
                                                          label: 'N',
                                                          children: [{ id: 'n27', label: 'Paul', children: [] }]
                                                        }
                                                      ]
                                                    }
                                                  ]
                                                }
                                              ]
                                            },
                                            {
                                              id: 'n28',
                                              label: "Infl'",
                                              children: [
                                                {
                                                  id: 'n29',
                                                  label: 'Infl',
                                                  children: [{ id: 'n30', label: 'partirait', children: [] }]
                                                }
                                              ]
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A matrix clause with an embedded CP complement.'
      }
    ]
  };

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(normalized.analyses[0].surfaceOrder, ['Marie', 'a', 'dit', 'que', 'Paul', 'partirait']);
});

test('normalizeParseBundle materializes singleton-span lexical leaves when their label matches the sentence token', () => {
  const sentence = 'A diretora disse que os alunos chegaram cedo.';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                {
                  id: 'n3',
                  label: "D'",
                  children: [
                    {
                      id: 'n4',
                      label: 'D',
                      children: [{ id: 'n5', label: 'A' }]
                    },
                    {
                      id: 'n6',
                      label: 'NP',
                      children: [{ id: 'n7', label: 'diretora', children: [] }]
                    }
                  ]
                }
              ]
            },
            {
              id: 'n8',
              label: "Infl'",
              children: [
                {
                  id: 'n9',
                  label: 'Infl',
                  children: [{ id: 'n10', label: 'disse', children: [] }]
                },
                {
                  id: 'n11',
                  label: 'CP',
                  children: [
                    {
                      id: 'n12',
                      label: 'C',
                      children: [{ id: 'n13', label: 'que', children: [] }]
                    },
                    {
                      id: 'n14',
                      label: 'InflP',
                      children: [
                        {
                          id: 'n15',
                          label: 'DP',
                          children: [
                            { id: 'n16', label: 'D', children: [{ id: 'n17', label: 'os', children: [] }] },
                            { id: 'n18', label: 'NP', children: [{ id: 'n19', label: 'alunos', children: [] }] }
                          ]
                        },
                        {
                          id: 'n20',
                          label: "Infl'",
                          children: [
                            { id: 'n21', label: 'Infl', children: [{ id: 'n22', label: 'chegaram', children: [] }] },
                            { id: 'n23', label: 'AdvP', children: [{ id: 'n24', label: 'cedo', children: [] }] }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A matrix clause with an embedded CP complement.'
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(
    normalized.analyses[0].surfaceOrder,
    ['A', 'diretora', 'disse', 'que', 'os', 'alunos', 'chegaram', 'cedo']
  );
});

test('normalizeParseBundle recognizes category-prefixed traces like V_trace_1 and excludes them from surface order', () => {
  const sentence = "D'oscail Sean an doras?";
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: "C'",
              children: [
                {
                  id: 'n3',
                  label: 'C',
                  children: [
                    {
                      id: 'n4',
                      label: 'V[+Q]',
                      children: [{ id: 'n5', label: "D'oscail", word: "D'oscail" }]
                    }
                  ]
                },
                {
                  id: 'n6',
                  label: 'InflP',
                  children: [
                    {
                      id: 'n7',
                      label: 'DP',
                      children: [
                        {
                          id: 'n8',
                          label: "D'",
                          children: [
                            { id: 'n9', label: 'D', children: [{ id: 'n10', label: 'Sean', word: 'Sean' }] }
                          ]
                        }
                      ]
                    },
                    {
                      id: 'n11',
                      label: "Infl'",
                      children: [
                        { id: 'n12', label: 'Infl', children: [{ id: 'n13', label: '∅' }] },
                        {
                          id: 'n14',
                          label: 'VP',
                          children: [
                            {
                              id: 'n15',
                              label: "V'",
                              children: [
                                { id: 'n16', label: 'V_trace_1' },
                                {
                                  id: 'n17',
                                  label: 'DP',
                                  children: [
                                    {
                                      id: 'n18',
                                      label: "D'",
                                      children: [
                                        { id: 'n19', label: 'D', children: [{ id: 'n20', label: 'an', word: 'an' }] },
                                        {
                                          id: 'n21',
                                          label: 'NP',
                                          children: [
                                            { id: 'n22', label: "N'", children: [{ id: 'n23', label: 'doras', word: 'doras' }] }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'Irish VSO with verb fronting.',
        movementEvents: []
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  const analysis = normalized.analyses[0];

  // V_trace_1 must not appear in the surface order
  assert.deepEqual(analysis.surfaceOrder, ["D'oscail", 'Sean', 'an', 'doras']);

  // Model did not commit to indexed movement pairing, so movementEvents stays empty
  assert.ok(!analysis.movementEvents || analysis.movementEvents.length === 0);

  // Explanation must not claim movement that was not encoded
  assert.doesNotMatch(analysis.explanation, /explicitly records movement/i);
});

test('normalizeParseBundle recognizes multi-segment trace labels like t_Vilken_bok and excludes them from surface order', () => {
  const sentence = 'Vilken bok laste Sara?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP',
              children: [
                { id: 'n3', label: 'D', children: [{ id: 'n4', label: 'Vilken', word: 'Vilken' }] },
                { id: 'n5', label: 'NP', children: [{ id: 'n6', label: 'bok', word: 'bok' }] }
              ]
            },
            {
              id: 'n7',
              label: "C'",
              children: [
                { id: 'n8', label: 'C', children: [{ id: 'n9', label: 'laste', word: 'laste' }] },
                {
                  id: 'n10',
                  label: 'InflP',
                  children: [
                    { id: 'n11', label: 'DP', children: [{ id: 'n12', label: 'Sara', word: 'Sara' }] },
                    {
                      id: 'n13',
                      label: "Infl'",
                      children: [
                        { id: 'n14', label: 'Infl', children: [{ id: 'n15', label: '∅', word: '∅' }] },
                        {
                          id: 'n16',
                          label: 'VP',
                          children: [
                            { id: 'n17', label: 'V', children: [{ id: 'n18', label: 't_laste' }] },
                            { id: 'n19', label: 'DP', children: [{ id: 'n20', label: 't_Vilken_bok' }] }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'A Swedish V2 wh-question.',
        movementEvents: []
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(normalized.analyses[0].surfaceOrder, ['Vilken', 'bok', 'laste', 'Sara']);
});

test('normalizeParseBundle strips movement indices from tree labels so Canopy receives clean data', () => {
  const sentence = 'Which book did Anna buy?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'n1',
          label: 'CP',
          children: [
            {
              id: 'n2',
              label: 'DP_i',
              children: [
                {
                  id: 'n3',
                  label: "D'",
                  children: [
                    { id: 'n4', label: 'D', children: [{ id: 'n5', label: 'Which', word: 'Which' }] },
                    { id: 'n6', label: 'NP', children: [{ id: 'n7', label: 'N', children: [{ id: 'n8', label: 'book', word: 'book' }] }] }
                  ]
                }
              ]
            },
            {
              id: 'n9',
              label: "C'",
              children: [
                { id: 'n10', label: 'C', children: [{ id: 'n11', label: 'did', word: 'did' }] },
                {
                  id: 'n12',
                  label: 'InflP',
                  children: [
                    { id: 'n13', label: 'DP', children: [{ id: 'n14', label: 'D', children: [{ id: 'n15', label: 'Anna', word: 'Anna' }] }] },
                    {
                      id: 'n16',
                      label: "Infl'",
                      children: [
                        { id: 'n17', label: 'Infl', children: [{ id: 'n18', label: '∅' }] },
                        {
                          id: 'n19',
                          label: 'VP',
                          children: [
                            { id: 'n20', label: 'V', children: [{ id: 'n21', label: 'buy', word: 'buy' }] },
                            { id: 'n22', label: 'DP_i', children: [{ id: 'n23', label: 't_i' }] }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        explanation: 'The wh-phrase is displaced to the clause edge.'
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  const analysis = normalized.analyses[0];

  // Tree labels must be stripped of movement indices
  assert.equal(analysis.tree.children[0].label, 'DP');
  // Infl' keeps [Infl(∅), VP] — null Infl stays in model position, so VP is at index 1
  assert.equal(analysis.tree.children[1].children[1].children[1].children[1].children[1].label, 'DP');

  // Movement is no longer inferred from label indices alone.
  assert.deepStrictEqual(analysis.movementEvents, []);

  // Legacy bracketedNotation is no longer emitted on the normalized active path.
  assert.ok(!Object.prototype.hasOwnProperty.call(analysis, 'bracketedNotation'));
});

test('normalizeParseBundle rewrites nested literal word labels into surface terminals', () => {
  const sentence = 'The analyst';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'root',
          label: 'DP',
          children: [
            {
              id: 'd_head',
              label: 'D',
              children: [{ id: 'd_word', label: 'word', word: 'The' }]
            },
            {
              id: 'np',
              label: 'NP',
              children: [
                {
                  id: 'n_head',
                  label: 'N',
                  children: [{ id: 'n_word', label: 'word', word: 'analyst' }]
                }
              ]
            }
          ]
        },
        explanation: 'A simple determiner phrase.',
        movementEvents: []
      }
    ]
  };

  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const analysis = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence).analyses[0];
  assert.equal(collectLabels(analysis.tree).includes('word'), false);
  assert.equal(analysis.tree.children[0].children[0].label, 'The');
  assert.equal(analysis.tree.children[1].children[0].children[0].label, 'analyst');
});

test('normalizeParseBundle does not derive movement from trace-prefixed node IDs without explicit movement events', () => {
  const sentence = 'Welches Buch hat Maria gelesen';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'CP_1', label: 'CP', children: [
            { id: 'DP_1', label: 'DP', children: [
              { id: 'D_bar_1', label: "D'", children: [
                { id: 'D_1', label: 'D', children: [
                  { id: 'T_1', label: 'Welches' }
                ]},
                { id: 'NP_1', label: 'NP', children: [
                  { id: 'N_1', label: 'N', children: [
                    { id: 'T_2', label: 'Buch' }
                  ]}
                ]}
              ]}
            ]},
            { id: 'C_bar_1', label: "C'", children: [
              { id: 'C_1', label: 'C', children: [
                { id: 'T_3', label: 'hat' }
              ]},
              { id: 'InflP_1', label: 'InflP', children: [
                { id: 'DP_2', label: 'DP', children: [
                  { id: 'D_bar_2', label: "D'", children: [
                    { id: 'D_2', label: 'D', children: [
                      { id: 'T_4', label: 'Maria' }
                    ]}
                  ]}
                ]},
                { id: 'Infl_bar_1', label: "Infl'", children: [
                  { id: 'Infl_1', label: 'Infl', children: [
                    { id: 'T_5', label: '\u2205' }
                  ]},
                  { id: 'VP_1', label: 'VP', children: [
                    { id: 'V_bar_1', label: "V'", children: [
                      { id: 'V_1', label: 'V', children: [
                        { id: 'T_6', label: 'gelesen' }
                      ]},
                      { id: 'trace_1', label: 'DP' }
                    ]}
                  ]}
                ]}
              ]}
            ]}
          ]
        },
        explanation: 'No displacement.',
        movementEvents: []
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);
  payload.analyses[0].surfaceOrder = tokenize(sentence);

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  const analysis = normalized.analyses[0];

  assert.deepStrictEqual(analysis.movementEvents, []);

  // Surface order should not include the trace DP
  assert.deepStrictEqual(analysis.surfaceOrder, ['Welches', 'Buch', 'hat', 'Maria', 'gelesen']);
});

test('normalizeParseBundle rejects sibling orders that do not already realize the input sentence (Spanish wh-VS)', () => {
  const sentence = 'Donde compró Juan el libro';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'CP_1', label: 'CP', children: [
            { id: 'DP_1', label: 'DP', children: [
              { id: 'D_bar_1', label: "D'", children: [
                { id: 'D_1', label: 'D', children: [
                  { id: 'T_1', label: 'Donde' }
                ]}
              ]}
            ]},
            { id: 'C_bar_1', label: "C'", children: [
              { id: 'C_1', label: 'C' },
              { id: 'IP_1', label: 'IP', children: [
                { id: 'I_bar_1', label: "I'", children: [
                  { id: 'VP_1', label: 'VP', children: [
                    { id: 'V_bar_1', label: "V'", children: [
                      { id: 'V_1', label: 'V', children: [
                        { id: 'T_2', label: 'compró' }
                      ]},
                      // WRONG ORDER: object DP before subject DP
                      { id: 'DP_3', label: 'DP', children: [
                        { id: 'D_bar_3', label: "D'", children: [
                          { id: 'D_3', label: 'D', children: [
                            { id: 'T_4', label: 'el' }
                          ]},
                          { id: 'NP_1', label: 'NP', children: [
                            { id: 'N_1', label: 'N', children: [
                              { id: 'T_5', label: 'libro' }
                            ]}
                          ]}
                        ]}
                      ]},
                      { id: 'DP_2', label: 'DP', children: [
                        { id: 'D_bar_2', label: "D'", children: [
                          { id: 'D_2', label: 'D', children: [
                            { id: 'T_3', label: 'Juan' }
                          ]}
                        ]}
                      ]}
                    ]}
                  ]},
                  { id: 'I_1', label: 'I' }
                ]}
              ]}
            ]}
          ]
        },
        explanation: 'Wh-movement of Donde.',
        movementEvents: [],
        surfaceOrder: ['Donde', 'compró', 'el', 'libro', 'Juan']
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);

  assert.throws(
    () => normalizeParseBundle(payload, 'xbar', sentence),
    /Tree overt terminals do not match the input sentence order/
  );
});

test('normalizeParseBundle rejects deeper structural misplacements instead of silently surfacing them', () => {
  const sentence = 'Donde compró Juan el libro';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'CP_1', label: 'CP', children: [
            { id: 'XP_1', label: 'XP', children: [
              { id: 'X_bar_1', label: "X'", children: [
                { id: 'X_1', label: 'X', children: [
                  { id: 'T_1', label: 'Donde' }
                ]}
              ]}
            ]},
            { id: 'C_bar_1', label: "C'", children: [
              { id: 'InfIP_1', label: 'InfIP', children: [
                { id: 'VP_1', label: 'VP', children: [
                  { id: 'V_bar_1', label: "V'", children: [
                    { id: 'V_1', label: 'V', children: [
                      { id: 'T_2', label: 'compró' }
                    ]},
                    { id: 'DP_3', label: 'DP', children: [
                      { id: 'D_bar_3', label: "D'", children: [
                        { id: 'D_3', label: 'D', children: [
                          { id: 'T_4', label: 'el' }
                        ]},
                        { id: 'NP_1', label: 'NP', children: [
                          { id: 'N_1', label: 'N', children: [
                            { id: 'T_5', label: 'libro' }
                          ]}
                        ]}
                      ]}
                    ]}
                  ]}
                ]},
                { id: 'DP_2', label: 'DP', children: [
                  { id: 'D_bar_2', label: "D'", children: [
                    { id: 'N_2', label: 'N', children: [
                      { id: 'T_3', label: 'Juan' }
                    ]}
                  ]}
                ]}
              ]},
              { id: 'C_1', label: 'C' }
            ]}
          ]
        },
        explanation: 'Wh-movement of Donde.',
        movementEvents: [],
        surfaceOrder: ['Donde', 'compró', 'el', 'libro', 'Juan']
      }
    ]
  };
  annotateSurfaceSpans(payload.analyses[0].tree, sentence);

  assert.throws(
    () => normalizeParseBundle(payload, 'xbar', sentence),
    /Tree overt terminals do not match the input sentence order/
  );
});

test('validateNoteBindingsAgainstStructuredAnalysis allows contrastive raising/control closure language', () => {
  assert.doesNotThrow(() =>
    validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        {
          kind: 'closure',
          text: 'This derivation captures the object-control dependency without positing movement between thematic positions, maintaining the structural distinction between raising and control.'
        }
      ],
      clausalDependencies: [
        {
          type: 'control',
          subtype: 'object-control',
          controllerLabel: 'Mary',
          dependentLabel: 'PRO'
        }
      ]
    })
  );
});

test('validateNoteBindingsAgainstStructuredAnalysis allows control notes that negate raising without overt contrast keywords', () => {
  assert.doesNotThrow(() =>
    validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        {
          kind: 'closure',
          text: 'This object-control architecture maintains PRO in its base thematic position within the embedded infinitival clause without requiring raising.'
        }
      ],
      clausalDependencies: [
        {
          type: 'control',
          subtype: 'object-control',
          controllerLabel: 'Mary',
          dependentLabel: 'PRO'
        }
      ]
    })
  );
});

test('validateNoteBindingsAgainstStructuredAnalysis rejects note-level case/theta/selection claims without matching ledgers', () => {
  assert.throws(
    () => validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        {
          kind: 'chain',
          text: "The wh-phrase 'Which pig' receives Patient theta-role and Accusative case as the complement selected by V."
        }
      ],
      movementEvents: [{ operation: 'AbarMove' }],
      chains: [{ chainId: 'chain_wh', type: 'A-bar' }],
      clausalDependencies: [],
      caseAssignments: [],
      argumentStructure: [],
      selectionLedger: [],
      bindingLedger: []
    }),
    /caseAssignments|argumentStructure|selectionLedger/i
  );
});

test('validateNoteBindingsAgainstStructuredAnalysis accepts note-level case/theta/selection claims when matching ledgers exist', () => {
  assert.doesNotThrow(() =>
    validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        {
          kind: 'chain',
          text: "The wh-phrase 'Which pig' receives Patient theta-role and Accusative case as the complement selected by V.",
          caseAssignmentIds: ['case_obj'],
          argumentIds: ['arg_obj'],
          selectionIds: ['sel_obj']
        }
      ],
      movementEvents: [{ operation: 'AbarMove' }],
      chains: [{ chainId: 'chain_wh', type: 'A-bar' }],
      clausalDependencies: [],
      caseAssignments: [{ assignmentId: 'case_obj', assigneeLabel: 'Which pig', case: 'Accusative' }],
      argumentStructure: [{ argumentId: 'arg_obj', predicate: 'eat', role: 'Patient', referent: 'Which pig' }],
      selectionLedger: [{ selectionId: 'sel_obj', selectorHead: 'V (eat)', selectedCategory: 'DP', selectedLabel: 'Which pig' }],
      bindingLedger: []
    })
  );
});

test('validateNoteBindingsAgainstStructuredAnalysis rejects predicate-class claims without predicateClassLedger', () => {
  assert.throws(
    () => validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        {
          kind: 'architecture',
          text: "The predicate behaves as an unaccusative predicate, so the sole argument originates internally."
        }
      ],
      movementEvents: [],
      chains: [],
      clausalDependencies: [],
      caseAssignments: [],
      argumentStructure: [],
      selectionLedger: [],
      bindingLedger: [],
      predicateClassLedger: []
    }),
    /predicateClassLedger/i
  );
});

test('validateNoteBindingsAgainstStructuredAnalysis rejects stock boilerplate note text', () => {
  assert.throws(
    () => validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        { kind: 'licensing', text: 'Initial logic and parameters are validated.' },
        { kind: 'chain', text: 'Standard processing applied.' }
      ]
    }),
    /stock boilerplate/i
  );
});

test('normalizeParseBundle softens semantic note drift in production without exposing warnings to clients', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const sentence = 'The farmer ate the pig';
    const finalTree = {
      id: 'cp',
      label: 'CP',
      children: [
        {
          id: 'cbar',
          label: "C'",
          children: [
            { id: 'c', label: 'C', children: [{ id: 'c-null', label: '∅' }] },
            {
              id: 'inflp',
              label: 'InflP',
              children: [
                {
                  id: 'subj',
                  label: 'DP',
                  children: [
                    {
                      id: 'subj-bar',
                      label: "D'",
                      children: [
                        { id: 'subj-d', label: 'D', children: [{ id: 'tok0', label: 'The', word: 'The', tokenIndex: 0 }] },
                        {
                          id: 'subj-np',
                          label: 'NP',
                          children: [
                            { id: 'subj-nbar', label: "N'", children: [{ id: 'tok1', label: 'farmer', word: 'farmer', tokenIndex: 1 }] }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  id: 'inflbar',
                  label: "Infl'",
                  children: [
                    { id: 'infl', label: 'Infl', children: [{ id: 'infl-null', label: '∅' }] },
                    {
                      id: 'vp',
                      label: 'VP',
                      children: [
                        {
                          id: 'vbar',
                          label: "V'",
                          children: [
                            { id: 'v', label: 'V', children: [{ id: 'tok2', label: 'ate', word: 'ate', tokenIndex: 2 }] },
                            {
                              id: 'obj',
                              label: 'DP',
                              children: [
                                {
                                  id: 'obj-bar',
                                  label: "D'",
                                  children: [
                                    { id: 'obj-d', label: 'D', children: [{ id: 'tok3', label: 'the', word: 'the', tokenIndex: 3 }] },
                                    {
                                      id: 'obj-np',
                                      label: 'NP',
                                      children: [
                                        { id: 'obj-nbar', label: "N'", children: [{ id: 'tok4', label: 'pig', word: 'pig', tokenIndex: 4 }] }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const payload = {
      analyses: [
        {
          growthFrames: [
            {
              frameId: 'f1',
              stepId: 's1',
              operation: 'Project',
              workspaceForestJson: JSON.stringify([finalTree])
            },
            {
              frameId: 'f2',
              stepId: 's2',
              operation: 'Project',
              reusePreviousWorkspace: true
            },
            {
              frameId: 'f3',
              stepId: 's3',
              operation: 'SpellOut',
              workspaceForestJson: JSON.stringify([finalTree]),
              spelloutOrder: ['The', 'farmer', 'ate', 'the', 'pig']
            }
          ],
          noteBindings: [
            { kind: 'architecture', text: 'Initial logic and parameters are validated.' }
          ]
        }
      ]
    };

    const normalized = normalizeParseBundle(payload, 'xbar', sentence, 'pro', true);
    const analysis = normalized.analyses[0];
    assert.equal(analysis.provenance?.validationWarnings, undefined);
    assert.equal(analysis.provenance?.completenessStatus, 'partial');
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test('validateNoteBindingsAgainstStructuredAnalysis accepts canonical chain-type variants like Head-movement and A-movement', () => {
  assert.doesNotThrow(() =>
    validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        {
          kind: 'chain',
          chainId: 'head1',
          text: "The lexical verb 'persuaded' undergoes head movement to the higher V shell."
        },
        {
          kind: 'chain',
          chainId: 'a1',
          text: "The matrix subject 'John' undergoes A-movement to Spec,InflP."
        }
      ],
      movementEvents: [],
      chains: [
        { chainId: 'head1', type: 'Head-movement' },
        { chainId: 'a1', type: 'A-movement' }
      ],
      clausalDependencies: [],
      caseAssignments: [],
      argumentStructure: [],
      selectionLedger: [],
      bindingLedger: []
    })
  );
});

test('validateNoteBindingsAgainstStructuredAnalysis accepts control notes when control is encoded in dependency subtype', () => {
  assert.doesNotThrow(() =>
    validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        {
          kind: 'architecture',
          text: "The matrix predicate is a control predicate whose subject controls PRO in the embedded clause.",
          dependencyIds: ['dep1'],
          predicateClassIds: ['pc1']
        }
      ],
      movementEvents: [],
      chains: [],
      clausalDependencies: [
        {
          dependencyId: 'dep1',
          type: 'finite-complement',
          subtype: 'subject-control',
          predicateLabel: 'thanda',
          dependentLabel: 'PRO'
        }
      ],
      caseAssignments: [],
      argumentStructure: [],
      selectionLedger: [],
      bindingLedger: [],
      predicateClassLedger: [
        {
          predicateClassId: 'pc1',
          predicateLabel: 'thanda',
          classification: 'control',
          subtype: 'subject-control'
        }
      ]
    })
  );
});

test('validatePronouncedCopiesAgainstCommittedTree allows intermediate head-move landings that move again later', () => {
  const tree = {
    id: 'infl',
    label: 'Infl',
    children: [{ id: 'leaf', label: 'ku-xova', word: 'ku-xova' }]
  };

  assert.doesNotThrow(() =>
    validatePronouncedCopiesAgainstCommittedTree({
      chains: [
        {
          chainId: 'chain_V_to_v',
          type: 'head',
          pronouncedCopy: 'v_head',
          copies: ['v_head', 'v_base'],
          silentCopies: ['v_base']
        }
      ],
      tree,
      movementEvents: [
        {
          operation: 'HeadMove',
          fromNodeId: 'v_head',
          toNodeId: 'infl'
        }
      ]
    })
  );
});

test('validateNoteBindingsAgainstStructuredAnalysis does not treat soft complement wording as explicit selection-ledger drift', () => {
  assert.doesNotThrow(() =>
    validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        {
          kind: 'architecture',
          text: 'The clause contains a finite complement CP in the matrix structure.'
        }
      ],
      movementEvents: [],
      chains: [],
      clausalDependencies: [],
      caseAssignments: [],
      argumentStructure: [],
      selectionLedger: [],
      bindingLedger: []
    })
  );
});

test('validateNoteBindingsAgainstStructuredAnalysis accepts growth-grounded selection, linearization, locality, and null-element notes when they are structurally anchored', () => {
  assert.doesNotThrow(() =>
    validateNoteBindingsAgainstStructuredAnalysis({
      noteBindings: [
        {
          kind: 'architecture',
          text: 'C selects InflP and the clause shows O-V-S surface order after inversion.',
          stepIds: ['s1'],
          nodeIds: ['c_head']
        },
        {
          kind: 'chain',
          chainId: 'wh1',
          text: 'Wh-movement targets the left periphery.',
          stepIds: ['s2'],
          nodeIds: ['dp_wh']
        },
        {
          kind: 'licensing',
          text: 'A null expletive pro occupies Spec,InflP.',
          stepIds: ['s1'],
          nodeIds: ['pro_expl']
        }
      ],
      movementEvents: [
        { operation: 'HeadMove', fromNodeId: 'infl_head', toNodeId: 'c_head' },
        { operation: 'AbarMove', fromNodeId: 'dp_low', toNodeId: 'dp_wh' }
      ],
      chains: [{ chainId: 'wh1', type: 'phrasal', copies: ['dp_wh', 'dp_low'] }],
      clausalDependencies: [],
      caseAssignments: [],
      argumentStructure: [],
      selectionLedger: [],
      bindingLedger: [],
      linearizationLedger: [],
      localityLedger: [],
      nullElementLedger: []
    })
  );
});

test('normalizeParseBundle preserves explicit model-authored selection ledger entries when selector notes cite them', () => {
  const sentence = 'Which pig did the farmer eat?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'cp_root',
          label: 'CP',
          children: [
            {
              id: 'dp_wh',
              label: 'DP',
              children: [
                { id: 'd_wh', label: 'D', children: [{ id: 'which_leaf', label: 'Which', word: 'Which' }] },
                { id: 'np_wh', label: 'NP', children: [{ id: 'pig_leaf', label: 'pig', word: 'pig' }] }
              ]
            },
            {
              id: 'cbar_root',
              label: "C'",
              children: [
                { id: 'c_head', label: 'C', children: [{ id: 'did_leaf', label: 'did', word: 'did' }] },
                {
                  id: 'inflp_root',
                  label: 'InflP',
                  children: [
                    {
                      id: 'dp_subj',
                      label: 'DP',
                      children: [
                        { id: 'd_subj', label: 'D', children: [{ id: 'the_leaf', label: 'the', word: 'the' }] },
                        { id: 'np_subj', label: 'NP', children: [{ id: 'farmer_leaf', label: 'farmer', word: 'farmer' }] }
                      ]
                    },
                    {
                      id: 'inflbar_root',
                      label: "Infl'",
                      children: [
                        { id: 'infl_trace', label: 'Infl', children: [{ id: 'infl_trace_leaf', label: 't₂', word: 't₂' }] },
                        {
                          id: 'vp_root',
                          label: 'VP',
                          children: [
                            { id: 'subj_trace', label: 'DP', children: [{ id: 'subj_trace_leaf', label: 't₁', word: 't₁' }] },
                            {
                              id: 'vbar_root',
                              label: "V'",
                              children: [
                                { id: 'v_head', label: 'V', children: [{ id: 'eat_leaf', label: 'eat', word: 'eat' }] },
                                { id: 'obj_trace', label: 'DP', children: [{ id: 'obj_trace_leaf', label: 't₃', word: 't₃' }] }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        noteBindings: [
          { kind: 'architecture', text: 'C selects InflP and V selects the wh-phrase Which pig as its complement.', stepIds: ['s1'], supportIds: ['sel_c', 'sel_v'] }
        ],
        selectionLedger: [
          {
            selectionId: 'sel_c',
            selectorHead: 'C (did)',
            selectedCategory: 'InflP',
            selectedLabel: 'the farmer eat',
            relation: 'complement'
          },
          {
            selectionId: 'sel_v',
            selectorHead: 'V (eat)',
            selectedCategory: 'DP',
            selectedLabel: 'Which pig',
            relation: 'complement'
          }
        ],
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'SpellOut',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  {
                    id: 'dp_wh',
                    label: 'DP',
                    children: [
                      { id: 'd_wh', label: 'D', children: [{ id: 'which_leaf', label: 'Which', word: 'Which' }] },
                      { id: 'np_wh', label: 'NP', children: [{ id: 'pig_leaf', label: 'pig', word: 'pig' }] }
                    ]
                  },
                  {
                    id: 'cbar_root',
                    label: "C'",
                    children: [
                      { id: 'c_head', label: 'C', children: [{ id: 'did_leaf', label: 'did', word: 'did' }] },
                      {
                        id: 'inflp_root',
                        label: 'InflP',
                        children: [
                          {
                            id: 'dp_subj',
                            label: 'DP',
                            children: [
                              { id: 'd_subj', label: 'D', children: [{ id: 'the_leaf', label: 'the', word: 'the' }] },
                              { id: 'np_subj', label: 'NP', children: [{ id: 'farmer_leaf', label: 'farmer', word: 'farmer' }] }
                            ]
                          },
                          {
                            id: 'inflbar_root',
                            label: "Infl'",
                            children: [
                              { id: 'infl_trace', label: 'Infl', children: [{ id: 'infl_trace_leaf', label: 't₂', word: 't₂' }] },
                              {
                                id: 'vp_root',
                                label: 'VP',
                                children: [
                                  { id: 'subj_trace', label: 'DP', children: [{ id: 'subj_trace_leaf', label: 't₁', word: 't₁' }] },
                                  {
                                    id: 'vbar_root',
                                    label: "V'",
                                    children: [
                                      { id: 'v_head', label: 'V', children: [{ id: 'eat_leaf', label: 'eat', word: 'eat' }] },
                                      { id: 'obj_trace', label: 'DP', children: [{ id: 'obj_trace_leaf', label: 't₃', word: 't₃' }] }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        movementEvents: [
          { operation: 'HeadMove', fromNodeId: 'infl_trace', toNodeId: 'c_head', traceNodeId: 'infl_trace_leaf' },
          { operation: 'A-Move', fromNodeId: 'subj_trace', toNodeId: 'dp_subj', traceNodeId: 'subj_trace_leaf' },
          { operation: 'AbarMove', fromNodeId: 'obj_trace', toNodeId: 'dp_wh', traceNodeId: 'obj_trace_leaf' }
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'pro').analyses[0];
  assert.ok(Array.isArray(analysis.selectionLedger));
  assert.equal(analysis.selectionLedger.length, 2);
  assert.ok(
    analysis.selectionLedger.some((entry) =>
      entry.selectorHead === 'C (did)'
      && entry.selectedCategory === 'InflP'
      && entry.relation === 'complement'
    )
  );
  assert.ok(
    analysis.selectionLedger.some((entry) =>
      entry.selectorHead === 'V (eat)'
      && entry.selectedCategory === 'DP'
      && /Which pig/i.test(String(entry.selectedLabel || ''))
      && entry.relation === 'complement'
    )
  );
});

test('normalizeParseBundle preserves researchTrace-backed note support when notes cite decision ids', () => {
  const sentence = 'Which violin did Nora borrow?';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'cp_root',
          label: 'CP',
          children: [
            { id: 'dp_wh', label: 'DP', children: [{ id: 'which_leaf', label: 'Which', word: 'Which' }, { id: 'violin_leaf', label: 'violin', word: 'violin' }] },
            {
              id: 'cbar_root',
              label: "C'",
              children: [
                { id: 'c_head', label: 'C', children: [{ id: 'did_leaf', label: 'did', word: 'did' }] },
                {
                  id: 'inflp_root',
                  label: 'InflP',
                  children: [
                    { id: 'dp_subj', label: 'DP', children: [{ id: 'nora_leaf', label: 'Nora', word: 'Nora' }] },
                    { id: 'inflbar_root', label: "Infl'", children: [{ id: 'infl_trace', label: 'Infl', children: [{ id: 'infl_trace_leaf', label: 't_Infl' }] }, { id: 'vp_root', label: 'VP', children: [{ id: 'v_head', label: 'V', children: [{ id: 'borrow_leaf', label: 'borrow', word: 'borrow' }] }, { id: 'obj_trace', label: 'DP', children: [{ id: 'obj_trace_leaf', label: 't_obj' }] }] }] }
                  ]
                }
              ]
            }
          ]
        },
        growthFrames: [
          {
            frameId: 'f1',
            stepId: 's1',
            operation: 'SpellOut',
            workspaceForest: [
              {
                id: 'cp_root',
                label: 'CP',
                children: [
                  { id: 'dp_wh', label: 'DP', children: [{ id: 'which_leaf', label: 'Which', word: 'Which' }, { id: 'violin_leaf', label: 'violin', word: 'violin' }] },
                  {
                    id: 'cbar_root',
                    label: "C'",
                    children: [
                      { id: 'c_head', label: 'C', children: [{ id: 'did_leaf', label: 'did', word: 'did' }] },
                      {
                        id: 'inflp_root',
                        label: 'InflP',
                        children: [
                          { id: 'dp_subj', label: 'DP', children: [{ id: 'nora_leaf', label: 'Nora', word: 'Nora' }] },
                          { id: 'inflbar_root', label: "Infl'", children: [{ id: 'infl_trace', label: 'Infl', children: [{ id: 'infl_trace_leaf', label: 't_Infl' }] }, { id: 'vp_root', label: 'VP', children: [{ id: 'v_head', label: 'V', children: [{ id: 'borrow_leaf', label: 'borrow', word: 'borrow' }] }, { id: 'obj_trace', label: 'DP', children: [{ id: 'obj_trace_leaf', label: 't_obj' }] }] }] }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        researchTrace: [
          {
            decisionId: 'rt_wh',
            stage: 'clause-typing',
            decisionPoint: 'fronted object analysis',
            observations: ['The object surfaces clause-initially.', 'The auxiliary is in C.'],
            commitment: 'Treat the clause as a wh-question with object A-bar movement.',
            supports: { stepIds: ['s1'], nodeIds: ['dp_wh', 'c_head'] },
            status: 'committed'
          }
        ],
        noteBindings: [
          {
            kind: 'other',
            text: 'The analysis chooses a wh-fronting derivation because the object occupies the left periphery while the auxiliary is in C.',
            stepIds: ['s1'],
            nodeIds: ['dp_wh', 'c_head'],
            researchTraceIds: ['rt_wh'],
            supportIds: ['rt_wh']
          }
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'pro').analyses[0];
  assert.equal(analysis.researchTrace.length, 1);
  assert.deepEqual(analysis.noteBindings[0].researchTraceIds, ['rt_wh']);
  assert.deepEqual(analysis.noteBindings[0].supportIds, ['rt_wh']);
});

test('normalizeParseBundle preserves case assignments that use assigneeId and assignerId transport aliases on legacy tree paths', () => {
  const sentence = 'John left';
  const payload = {
    analyses: [
      {
        tree: {
          id: 'inflp_root',
          label: 'InflP',
          children: [
            {
              id: 'dp_john',
              label: 'DP',
              children: [
                {
                  id: 'dbar_john',
                  label: "D'",
                  children: [
                    { id: 'd_john', label: 'D', children: [{ id: 'john_leaf', label: 'John', word: 'John' }] }
                  ]
                }
              ]
            },
            {
              id: 'inflbar_root',
              label: "Infl'",
              children: [
                { id: 'infl_head', label: 'Infl', children: [{ id: 'left_leaf', label: 'left', word: 'left' }] }
              ]
            }
          ]
        },
        caseAssignments: [
          JSON.stringify({
            id: 'case_nom',
            assigneeId: 'dp_john',
            assignerId: 'infl_head',
            caseValue: 'Nominative'
          })
        ]
      }
    ]
  };

  const analysis = normalizeParseBundle(payload, 'xbar', sentence, 'flash-lite').analyses[0];
  assert.equal(analysis.caseAssignments.length, 1);
  assert.equal(analysis.caseAssignments[0].assignmentId, 'case_nom');
  assert.equal(analysis.caseAssignments[0].nodeId, 'dp_john');
  assert.equal(analysis.caseAssignments[0].case, 'Nominative');
  assert.equal(analysis.caseAssignments[0].assigner, 'infl_head');
});

test('normalizeParseResult accepts locality-rich notes without localityLedger when they stay structurally anchored to Growth', () => {
  const payloadText = fs.readFileSync(
    new URL('../.artifacts/debug-model-payloads/2026-04-06T11-48-31-735Z-normalization-gemini-3.1-pro-preview.txt', import.meta.url),
    'utf8'
  );
  const jsonStart = payloadText.indexOf('{');
  assert.ok(jsonStart >= 0, 'debug payload should contain JSON');
  const parsedPayload = JSON.parse(payloadText.slice(jsonStart));
  parsedPayload.analyses[0].noteBindings.push({
    kind: 'chain',
    chainId: 'chain_obj',
    stepIds: ['step_7'],
    nodeIds: ['dp_obj', 't_obj'],
    text: 'The wh-phrase stops at the phase edge in Spec,CP before satisfying the interrogative requirement.'
  });

  assert.doesNotThrow(
    () => normalizeParseResult(
      parsedPayload.analyses[0],
      'xbar',
      'Que pintura comprou Teresa?',
      'pro',
      true
    )
  );
});

test('normalizeParseResult accepts Turkish alias-heavy ledgers for linearization and researchTrace', () => {
  const payloadText = fs.readFileSync(
    new URL('../.artifacts/debug-model-payloads/2026-04-02T16-03-50-861Z-normalization-gemini-3.1-pro-preview.txt', import.meta.url),
    'utf8'
  );
  const jsonStart = payloadText.indexOf('{');
  assert.ok(jsonStart >= 0, 'debug payload should contain JSON');
  const parsedPayload = JSON.parse(payloadText.slice(jsonStart));

  const analysis = normalizeParseResult(
    parsedPayload.analyses[0],
    'xbar',
    'Ayse biliyor ki Deniz gelecek.',
    'pro',
    true
  );

  assert.ok(Array.isArray(analysis.linearizationLedger));
  assert.ok(analysis.linearizationLedger.length >= 1);
  assert.ok(Array.isArray(analysis.researchTrace));
  assert.equal(analysis.researchTrace[0]?.decisionId, 'cp_position');
});
