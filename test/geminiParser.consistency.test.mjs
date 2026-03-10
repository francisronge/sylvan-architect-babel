import test from 'node:test';
import assert from 'node:assert/strict';

import { ParseApiError, __test__ } from '../server/geminiParser.js';

const {
  normalizeParseBundle,
  harmonizeExplanationWithDerivation,
  buildCanonicalMovementEvents,
  buildSystemInstruction,
  buildParseContentsPrompt,
  parseResponseJsonSchemaForRoute,
  buildSerializerContentsPrompt,
  buildNotesContentsPrompt,
  reconcileModelExplanationWithDerivation,
  reconcileGeneratedExplanationWithDerivation,
  mergeSerializedStructureIntoDraftPayload
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

  assert.match(instruction, /The tree must be the final pronounced structure/i);
  assert.match(instruction, /First decide movement and encode it in "movementDecision\.hasMovement"/i);
  assert.match(instruction, /For every apparent dependency, choose exactly one analysis: direct merge or movement/i);
  assert.match(instruction, /Return "movementEvents": \[\]/i);
  assert.match(instruction, /Every overt input token must appear in the tree exactly as pronounced/i);
  assert.match(instruction, /Keep only the pronounced copy overt and render the lower occurrence as a trace, copy, or null element/i);
  assert.match(instruction, /represent it only as "∅"/i);
  assert.match(instruction, /Do not use hyphenated trace forms/i);
  assert.match(instruction, /Do not introduce helper position labels .*labels beginning with "Spec"/i);
  assert.match(instruction, /Do not stack extra overt head labels such as C > V > word/i);
  assert.match(instruction, /use exactly one overt head label above the pronounced word/i);
  assert.match(instruction, /landing head should directly dominate the overt word/i);
  assert.match(instruction, /If the final tree places an overt head in a higher functional head position .* this must be encoded as a HeadMove/i);
  assert.match(instruction, /Flash Lite format discipline/i);
  assert.match(instruction, /Every overt terminal leaf must include tokenIndex/i);
  assert.doesNotMatch(proInstruction, /Flash Lite format discipline/i);
});

test('buildParseContentsPrompt reinforces overt-token uniqueness and explicit lower copies', () => {
  const prompt = buildParseContentsPrompt('Ha comprado Ana el libro?', 'xbar');
  const proPrompt = buildParseContentsPrompt('Ha comprado Ana el libro?', 'xbar', 'pro');

  assert.match(prompt, /Return the complete analysis in one pass/i);
  assert.match(prompt, /For the structure, use the flat node-table format/i);
  assert.match(prompt, /return analyses\[\]\.nodes plus optional rootId, and do not return a nested \"tree\" field at all/i);
  assert.match(prompt, /Babel will deterministically compile that committed node table into the visible tree/i);
  assert.match(prompt, /include tokenIndex values tied to that token list/i);
  assert.match(proPrompt, /Use the standard nested tree format with explicit ordered children arrays/i);
  assert.doesNotMatch(proPrompt, /Babel will deterministically compile that committed node table into the visible tree/i);
  assert.match(proPrompt, /CONSISTENCY RECHECK: Before returning, read the same request again and verify that your final JSON already encodes one coherent analysis\./i);
  assert.match(prompt, /Before returning, decide whether movement occurs in this analysis and make movementDecision, movementEvents, derivationSteps, explanation, and the tree all match that same one choice/i);
  assert.match(prompt, /If movement occurs, make it explicit\. If movement does not occur, do not leave traces, lower copies, or null heads that imply otherwise/i);
  assert.match(prompt, /CRITICAL LINEARIZATION RULE: Your committed structure must realize the overt terminals in exactly the pronounced sentence order/i);
  assert.match(prompt, /Token indices and surface spans must agree with that same left-to-right order/i);
  assert.match(prompt, /Use each overt input token exactly once in the final tree/i);
  assert.match(prompt, /use exactly "∅"/i);
  assert.match(prompt, /Keep lower copy notation consistent within this tree, including phrasal and head movement/i);
  assert.match(prompt, /do not use hyphenated trace forms/i);
  assert.match(prompt, /Do not use helper position labels .*labels beginning with "Spec" as separate nodes/i);
  assert.match(prompt, /realize it there as one overt head rather than stacking labels like C > V > word/i);
  assert.match(prompt, /use exactly one overt head label above the pronounced word/i);
  assert.match(prompt, /landing head should directly dominate the overt word/i);
  assert.match(prompt, /If your final tree contains an overt higher head with a silent lower head site for that same dependency, the final JSON must include a HeadMove/i);
  assert.match(prompt, /developed academic paragraph rather than a compressed checklist/i);
  assert.match(prompt, /recognized analytical tradition or mention a relevant scholar/i);
  assert.match(prompt, /FLASH LITE FORMAT CHECK: Return analyses\[\]\.nodes plus optional rootId only; never return tree or tree\.nodes\./i);
  assert.match(prompt, /FLASH LITE FORMAT CHECK AGAIN: analyses\[\]\.nodes is the only allowed structural format\./i);
  assert.match(prompt, /FLASH LITE FORMAT CHECK A THIRD TIME: parentId, siblingOrder, and overt tokenIndex are the primary commitments\./i);
  assert.match(prompt, /CONSISTENCY RECHECK: Before returning, read the same request again and verify that your final JSON already encodes one coherent analysis\./i);
});

test('parseResponseJsonSchemaForRoute uses flat analysis schema for lite and mixed schema for pro', () => {
  const liteSchema = parseResponseJsonSchemaForRoute('flash-lite');
  const proSchema = parseResponseJsonSchemaForRoute('pro');

  assert.equal(liteSchema.properties.analyses.items.required.includes('nodes'), true);
  assert.equal(liteSchema.properties.analyses.items.additionalProperties, false);
  assert.equal(
    liteSchema.$defs.flatSyntaxNode.required.includes('siblingOrder'),
    true
  );
  assert.equal(Array.isArray(proSchema.properties.analyses.items.anyOf), true);
  assert.equal(proSchema.properties.analyses.items.anyOf.length, 2);
  assert.equal(
    proSchema.$defs.syntaxNode.required.includes('siblingOrder'),
    false
  );
});

test('buildSerializerContentsPrompt constrains the serializer to canonical schema only', () => {
  const draftPayload = {
    analyses: [
      {
        tree: {
          id: 'CP',
          children: [
            { id: 'DP_wh', value: 'Wen' },
            { id: 'C_head', word: 'hat' }
          ]
        },
        explanation: 'A direct question asking for the object.'
      }
    ]
  };

  const prompt = buildSerializerContentsPrompt('Wen hat Maria gesehen?', 'xbar', draftPayload);

  assert.match(prompt, /without changing the underlying analysis/i);
  assert.match(prompt, /Every overt terminal leaf must include tokenIndex/i);
  assert.match(prompt, /ascending tokenIndex\/surfaceSpan order/i);
  assert.match(prompt, /reorder the children array only/i);
  assert.match(prompt, /left-to-right DFS over overt leaves spells exactly: Wen \| hat \| Maria \| gesehen/i);
  assert.match(prompt, /Use "word" for terminal surface forms, not alternate fields like "value"/i);
  assert.match(prompt, /Every node must have a usable "label"/i);
  assert.match(prompt, /do not change the hierarchy, dominance relations, or movement commitments/i);
  assert.match(prompt, /Preserve the same tree structure and same committed analysis/i);
  assert.match(prompt, /Exact pronounced tokens: Wen \| hat \| Maria \| gesehen/i);
  assert.match(prompt, /"value": "Wen"/i);
});

test('buildSerializerContentsPrompt keeps lite serializer in flat node-table format', () => {
  const draftPayload = {
    analyses: [
      {
        nodes: [
          { id: 'n1', label: 'CP' },
          { id: 'n2', label: 'D', parentId: 'n1', value: 'Welchen' }
        ],
        rootId: 'n1',
        explanation: 'A lite draft analysis.'
      }
    ]
  };

  const prompt = buildSerializerContentsPrompt('Welchen Film hat Jonas empfohlen?', 'xbar', draftPayload, 'flash-lite');

  assert.match(prompt, /canonical flat node-table schema/i);
  assert.match(prompt, /Return analyses\[\]\.nodes plus optional rootId as the only structural format/i);
  assert.match(prompt, /Do not rewrite the analysis into a nested tree/i);
  assert.match(prompt, /Every overt terminal must include tokenIndex/i);
  assert.match(prompt, /"value": "Welchen"/i);
});

test('reconcileModelExplanationWithDerivation removes implementation-leak prose but keeps scholar flavor', () => {
  const explanation = [
    'This analysis follows the tradition of McCloskey in treating the verb as raising to the clausal domain.',
    'By flattening the structure to preserve siblingOrder, the derivation maps tokenIndex values onto the pronounced string.'
  ].join(' ');

  const reconciled = reconcileModelExplanationWithDerivation(
    explanation,
    'Fallback explanation.',
    [{ operation: 'HeadMove', fromNodeId: 'n1', toNodeId: 'n2', traceNodeId: 'n3' }]
  );

  assert.match(reconciled, /McCloskey/i);
  assert.doesNotMatch(reconciled, /flattening the structure/i);
  assert.doesNotMatch(reconciled, /siblingOrder/i);
  assert.doesNotMatch(reconciled, /tokenIndex/i);
});

test('mergeSerializedStructureIntoDraftPayload preserves original movement commitments while swapping in serialized structure', () => {
  const draftPayload = {
    analyses: [
      {
        tree: {
          id: 'old-root',
          label: 'CP',
          children: []
        },
        explanation: 'Original explanation with movement.',
        movementDecision: {
          hasMovement: true,
          rationale: 'Movement is part of the committed analysis.'
        },
        movementEvents: [
          {
            operation: 'Move',
            fromNodeId: 'n14',
            toNodeId: 'n2',
            traceNodeId: 'n14'
          },
          {
            operation: 'HeadMove',
            fromNodeId: 'n10',
            toNodeId: 'n7'
          }
        ],
        derivationSteps: [
          { operation: 'Move', targetNodeId: 'n2', sourceNodeIds: ['n14'] },
          { operation: 'HeadMove', targetNodeId: 'n7', sourceNodeIds: ['n10'] }
        ]
      }
    ]
  };

  const serializedPayload = {
    analyses: [
      {
        nodes: [
          { id: 'n1', label: 'CP' },
          { id: 'n2', label: 'DP', parentId: 'n1' }
        ],
        rootId: 'n1',
        explanation: 'Serializer flattened the explanation.',
        movementDecision: {
          hasMovement: false,
          rationale: 'No movement.'
        },
        movementEvents: []
      }
    ]
  };

  const merged = mergeSerializedStructureIntoDraftPayload(draftPayload, serializedPayload);
  const analysis = merged.analyses[0];

  assert.ok(Array.isArray(analysis.nodes));
  assert.equal(analysis.rootId, 'n1');
  assert.equal(analysis.tree, undefined);
  assert.equal(analysis.explanation, 'Original explanation with movement.');
  assert.deepEqual(analysis.movementDecision, {
    hasMovement: true,
    rationale: 'Movement is part of the committed analysis.'
  });
  assert.equal(analysis.movementEvents.length, 2);
  assert.deepEqual(analysis.derivationSteps.map((step) => step.operation), ['Move', 'HeadMove']);
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

test('buildNotesContentsPrompt supplies grounded facts rather than free-form explanation text', () => {
  const prompt = buildNotesContentsPrompt('Which article did Nora publish?', 'xbar', [
    {
      tree: {
        id: 'cp1',
        label: 'CP',
        children: [
          {
            id: 'dp1',
            label: 'DP',
            children: [{ id: 'd1', label: 'D', children: [{ id: 'w1', label: 'Which', word: 'Which' }] }]
          },
          {
            id: 'cbar1',
            label: "C'",
            children: [
              { id: 'c1', label: 'C', children: [{ id: 'did1', label: 'did', word: 'did' }] },
              {
                id: 'inflp1',
                label: 'InflP',
                children: [
                  { id: 'dp2', label: 'DP', children: [{ id: 'nora1', label: 'Nora', word: 'Nora' }] },
                  { id: 'infl1', label: 'Infl', children: [{ id: 'null1', label: '∅', word: '∅' }] }
                ]
              }
            ]
          }
        ]
      },
      derivationSteps: [{ operation: 'Move', targetNodeId: 'dp1', sourceNodeIds: ['t1'] }],
      movementEvents: [{ operation: 'Move', fromNodeId: 't1', toNodeId: 'dp1', traceNodeId: 't1' }],
      surfaceOrder: ['Which', 'article', 'did', 'Nora', 'publish']
    }
  ]);

  assert.match(prompt, /Grounded analysis facts/i);
  assert.match(prompt, /movementSummary/i);
  assert.match(prompt, /The derivation explicitly records movement/i);
  assert.match(prompt, /Framework: X-Bar Theory/i);
  assert.doesNotMatch(prompt, /No explanation provided\./i);
});

test('reconcileGeneratedExplanationWithDerivation falls back when notes invent unsupported movement', () => {
  const fallback = 'On the committed X-bar analysis, the sentence is analyzed as a CP.';
  const generated = 'The derivation records wh-movement and successive head movement throughout the clause.';
  const reconciled = reconcileGeneratedExplanationWithDerivation(generated, fallback, []);
  assert.equal(reconciled, fallback);
});

test('reconcileModelExplanationWithDerivation keeps a substantive compatible model explanation', () => {
  const fallback = 'On the committed X-bar analysis, the sentence is analyzed as a CP.';
  const modelExplanation = 'This X-bar analysis treats the clause as a CP with a fronted DP at the left edge. The lower copy remains in object position, and the surface order follows from that displacement.';
  const reconciled = reconcileModelExplanationWithDerivation(
    modelExplanation,
    fallback,
    [{ operation: 'Move', fromNodeId: 'n1', toNodeId: 'n2', traceNodeId: 'n1' }]
  );
  assert.match(reconciled, /fronted DP/i);
  assert.doesNotMatch(reconciled, /On the committed X-bar analysis/i);
});

test('reconcileModelExplanationWithDerivation falls back when the model explanation is too thin', () => {
  const fallback = 'On the committed X-bar analysis, the sentence is analyzed as a CP.';
  const modelExplanation = 'A wh-question.';
  const reconciled = reconcileModelExplanationWithDerivation(
    modelExplanation,
    fallback,
    [{ operation: 'Move', fromNodeId: 'n1', toNodeId: 'n2', traceNodeId: 'n1' }]
  );
  assert.match(reconciled, /On the committed X-bar analysis/i);
});

test('reconcileModelExplanationWithDerivation supplements a thin but compatible explanation with grounded facts', () => {
  const fallback = 'On the committed X-bar analysis, the sentence is analyzed as a CP. The derivation explicitly records movement of DP "Which poem" from its lower copy.';
  const modelExplanation = 'This analysis fronts the DP while leaving a lower copy in object position for interpretive reconstruction.';
  const reconciled = reconcileModelExplanationWithDerivation(
    modelExplanation,
    fallback,
    [{ operation: 'Move', fromNodeId: 'n1', toNodeId: 'n2', traceNodeId: 'n1' }]
  );
  assert.match(reconciled, /fronts the DP while leaving a lower copy/i);
  assert.match(reconciled, /On the committed X-bar analysis/i);
});

test('reconcileModelExplanationWithDerivation drops truncated scholar-reference fragments', () => {
  const fallback = 'On the committed X-bar analysis, the sentence is analyzed as a CP.';
  const modelExplanation = 'Following the tradition of É. The wh-phrase moves from a lower copy to the left edge of the clause.';
  const reconciled = reconcileModelExplanationWithDerivation(
    modelExplanation,
    fallback,
    [{ operation: 'Move', fromNodeId: 'n1', toNodeId: 'n2', traceNodeId: 'n1' }]
  );
  assert.doesNotMatch(reconciled, /tradition of É/i);
  assert.match(reconciled, /moves from a lower copy/i);
});

test('reconcileModelExplanationWithDerivation drops merge-only phrasing for moved specifier positions', () => {
  const fallback = 'On the committed X-bar analysis, the derivation explicitly records movement of DP "Que carta" from its lower copy.';
  const modelExplanation = 'The wh-phrase is merged into Spec,CP to satisfy the interrogative requirement.';
  const reconciled = reconcileModelExplanationWithDerivation(
    modelExplanation,
    fallback,
    [{ operation: 'Move', fromNodeId: 'n1', toNodeId: 'n2', traceNodeId: 'n1' }]
  );
  assert.equal(reconciled, fallback);
});

test('reconcileModelExplanationWithDerivation keeps a single head-movement sentence when one HeadMove is grounded', () => {
  const fallback = 'On the committed X-bar analysis, the sentence is analyzed as a CP.';
  const modelExplanation = 'This derivation raises the auxiliary to C to satisfy the V2 requirement. The subject remains in Spec,InflP.';
  const reconciled = reconcileModelExplanationWithDerivation(
    modelExplanation,
    fallback,
    [{ operation: 'HeadMove', fromNodeId: 'infl1', toNodeId: 'c1', traceNodeId: 'infl1' }]
  );
  assert.match(reconciled, /raises the auxiliary to C/i);
  assert.doesNotMatch(reconciled, /On the committed X-bar analysis/i);
});

test('reconcileModelExplanationWithDerivation drops unsupported head-movement prose phrased as movement from the Infl head', () => {
  const fallback = 'On the committed X-bar analysis, the sentence is analyzed as a CP where the interrogative DP occupies the left edge of the clause.';
  const modelExplanation = "Following the tradition of Noam Chomsky's Government and Binding Theory, the auxiliary 'hat' is analyzed as occupying the C head position, having moved from the Infl head to satisfy the V2 requirement typical of German matrix interrogatives.";
  const reconciled = reconcileModelExplanationWithDerivation(
    modelExplanation,
    fallback,
    [{ operation: 'Move', fromNodeId: 'objTrace', toNodeId: 'whDp', traceNodeId: 'objTrace' }]
  );
  assert.equal(reconciled, fallback);
});

test('reconcileModelExplanationWithDerivation drops verb no-movement prose when a HeadMove is encoded', () => {
  const fallback = "The verb 'Gheall' undergoes head movement to Infl, while the embedded clause remains a CP complement.";
  const modelExplanation = "No phrasal movement is posited for the subject or the verb in this derivation, as the surface order is derived through head-adjunction to the functional Infl head.";
  const reconciled = reconcileModelExplanationWithDerivation(
    modelExplanation,
    fallback,
    [{ operation: 'HeadMove', fromNodeId: 'v1', toNodeId: 'infl1', traceNodeId: 'v1' }]
  );
  assert.equal(reconciled, fallback);
});

test('reconcileModelExplanationWithDerivation keeps ordinary wh-movement prose for generic Move events', () => {
  const fallback = 'On the committed X-bar analysis, the sentence is analyzed as a CP.';
  const modelExplanation = 'The wh-phrase moves to the left edge of the clause, leaving a trace in object position. This derives the interrogative order.';
  const reconciled = reconcileModelExplanationWithDerivation(
    modelExplanation,
    fallback,
    [{ operation: 'Move', fromNodeId: 'objTrace', toNodeId: 'whDp', traceNodeId: 'objTrace' }]
  );
  assert.match(reconciled, /wh-phrase moves to the left edge of the clause/i);
  assert.doesNotMatch(reconciled, /On the committed X-bar analysis/i);
});

test('reconcileModelExplanationWithDerivation appends grounded movement when the model omits it', () => {
  const fallback = "The subject remains in Spec,InflP. The derivation explicitly records head movement of \"Gheall\" from V to Infl.";
  const modelExplanation = "The subject remains in Spec,InflP, while the embedded clause is selected as a CP complement.";
  const reconciled = reconcileModelExplanationWithDerivation(
    modelExplanation,
    fallback,
    [{ operation: 'HeadMove', fromNodeId: 'v1', toNodeId: 'infl1', traceNodeId: 'v1' }]
  );
  assert.match(reconciled, /subject remains in Spec,InflP/i);
  assert.match(reconciled, /derivation explicitly records head movement/i);
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
  assert.doesNotMatch(analysis.explanation, /explicitly records movement/i);
  assert.match(analysis.explanation, /No displacement operation is encoded/i);
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

test('normalizeParseBundle reconciles movementDecision to the encoded committed analysis', () => {
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
  assert.deepEqual(normalized.analyses[0].movementDecision, {
    hasMovement: false,
    rationale: 'No movement is encoded in the final committed analysis.'
  });
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

test('harmonizeExplanationWithDerivation removes unsupported movement claims while keeping grounded ones', () => {
  const explanation = 'The verb undergoes head movement to T. The object also undergoes wh-movement to Spec,CP.';
  const movementEvents = [
    {
      operation: 'HeadMove',
      fromNodeId: 'n3',
      toNodeId: 'n1',
      traceNodeId: 'n3',
      note: 'Verb moves to T.'
    }
  ];
  const tree = {
    id: 'n1',
    label: 'TP',
    children: [
      {
        id: 'n2',
        label: 'T',
        children: [{ id: 'n3', label: 'V', children: [{ id: 'n4', label: 'zamknal', word: 'zamknal' }] }]
      },
      {
        id: 'n5',
        label: 'VP',
        children: [{ id: 'n6', label: 'DP', children: [{ id: 'n7', label: 'drzwi', word: 'drzwi' }] }]
      }
    ]
  };

  const normalizedExplanation = harmonizeExplanationWithDerivation(
    explanation,
    [],
    movementEvents,
    tree,
    'minimalism'
  );

  assert.match(normalizedExplanation, /committed Minimalist analysis/i);
  assert.match(normalizedExplanation, /head movement/i);
  assert.doesNotMatch(normalizedExplanation, /wh-movement/i);
  assert.doesNotMatch(normalizedExplanation, /Spec,CP/i);
});

test('harmonizeExplanationWithDerivation removes unsupported successive head-movement claims', () => {
  const explanation = 'The verb raises to Infl and subsequently to C to license the interrogative structure. The subject remains in Spec,InflP.';
  const movementEvents = [
    {
      operation: 'HeadMove',
      fromNodeId: 'n13',
      toNodeId: 'n3',
      traceNodeId: 'n13',
      note: 'Verb moves to C to satisfy the interrogative feature.'
    }
  ];
  const tree = {
    id: 'n1',
    label: 'CP',
    children: [
      {
        id: 'n2',
        label: 'C',
        children: [{ id: 'n3', label: 'bhfaca', word: 'bhfaca' }]
      }
    ]
  };

  const normalizedExplanation = harmonizeExplanationWithDerivation(
    explanation,
    [],
    movementEvents,
    tree,
    'xbar'
  );

  assert.doesNotMatch(normalizedExplanation, /raises to Infl and subsequently to C/i);
  assert.match(normalizedExplanation, /head movement/i);
});

test('harmonizeExplanationWithDerivation renders feature checking in prose instead of arrow shorthand', () => {
  const explanation = 'The clause is finite.';
  const derivationSteps = [
    {
      operation: 'Agree',
      featureChecking: [
        {
          feature: 'uFeature',
          status: 'valued',
          probeLabel: 'ProbeHead',
          goalLabel: 'GoalHead'
        }
      ]
    }
  ];
  const tree = {
    id: 'n1',
    label: 'Clause',
    children: [
      {
        id: 'n2',
        label: 'Head',
        children: [{ id: 'n3', label: 'token', word: 'token' }]
      }
    ]
  };

  const normalizedExplanation = harmonizeExplanationWithDerivation(
    explanation,
    derivationSteps,
    [],
    tree,
    'xbar'
  );

  assert.match(normalizedExplanation, /uFeature \(valued\) with ProbeHead probing GoalHead/i);
  assert.doesNotMatch(normalizedExplanation, /->/i);
});

test('harmonizeExplanationWithDerivation keeps embedded complementizers out of the matrix architecture summary', () => {
  const explanation = 'A finite declarative clause.';
  const tree = {
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
            children: [{ id: 'n4', label: 'I', word: 'I' }]
          },
          {
            id: 'n5',
            label: 'NP',
            children: [{ id: 'n6', label: 'Anna', word: 'Anna' }]
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
            children: [{ id: 'n9', label: '∅', word: '∅' }]
          },
          {
            id: 'n10',
            label: 'InflP',
            children: [
              {
                id: 'n11',
                label: 'DP',
                children: [{ id: 'n12', label: 'nomizei', word: 'nomizei' }]
              },
              {
                id: 'n13',
                label: "Infl'",
                children: [
                  {
                    id: 'n14',
                    label: 'Infl',
                    children: [{ id: 'n15', label: '∅', word: '∅' }]
                  },
                  {
                    id: 'n16',
                    label: 'CP',
                    children: [
                      {
                        id: 'n17',
                        label: 'C',
                        children: [{ id: 'n18', label: 'oti', word: 'oti' }]
                      },
                      {
                        id: 'n19',
                        label: 'InflP',
                        children: [
                          {
                            id: 'n20',
                            label: 'DP',
                            children: [{ id: 'n21', label: 'Nikos', word: 'Nikos' }]
                          },
                          {
                            id: 'n22',
                            label: 'VP',
                            children: [{ id: 'n23', label: 'efyge', word: 'efyge' }]
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

  const normalizedExplanation = harmonizeExplanationWithDerivation(
    explanation,
    [],
    [],
    tree,
    'xbar'
  );

  assert.match(normalizedExplanation, /dominating a InflP as its finite core/i);
  assert.match(normalizedExplanation, /embedded CP introduced by "oti"/i);
  assert.doesNotMatch(normalizedExplanation, /overt left-peripheral head "oti"/i);
});

test('harmonizeExplanationWithDerivation avoids infl-to-dp movement prose when the source is a null copy', () => {
  const explanation = 'A wh-question.';
  const movementEvents = [
    {
      operation: 'Move',
      fromNodeId: 'n10',
      toNodeId: 'n2',
      traceNodeId: 'n10'
    }
  ];
  const tree = {
    id: 'n1',
    label: 'CP',
    children: [
      {
        id: 'n2',
        label: 'DP_i',
        children: [
          {
            id: 'n3',
            label: 'D',
            children: [{ id: 'n4', label: 'Which', word: 'Which' }]
          },
          {
            id: 'n5',
            label: 'NP',
            children: [{ id: 'n6', label: 'book', word: 'book' }]
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
            children: [{ id: 'n9', label: 'did', word: 'did' }]
          },
          {
            id: 'n11',
            label: 'InflP',
            children: [
              {
                id: 'n12',
                label: 'DP',
                children: [{ id: 'n13', label: 'Anna', word: 'Anna' }]
              },
              {
                id: 'n14',
                label: "Infl'",
                children: [
                  {
                    id: 'n15',
                    label: 'Infl',
                    children: [{ id: 'n10', label: '∅_i', word: '∅' }]
                  },
                  {
                    id: 'n16',
                    label: 'VP',
                    children: [
                      {
                        id: 'n17',
                        label: 'V',
                        children: [{ id: 'n18', label: 'buy', word: 'buy' }]
                      },
                      {
                        id: 'n19',
                        label: 'DP',
                        children: [{ id: 'n20', label: 't_i', word: 't' }]
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

  const normalizedExplanation = harmonizeExplanationWithDerivation(
    explanation,
    [],
    movementEvents,
    tree,
    'xbar'
  );

  assert.match(normalizedExplanation, /movement of DP_i "Which book" from its lower copy/i);
  assert.doesNotMatch(normalizedExplanation, /movement from Infl to DP/i);
});

test('harmonizeExplanationWithDerivation prefers moved phrase wording over dp-to-dp prose for fronted wh phrases', () => {
  const explanation = 'A wh-question.';
  const movementEvents = [
    {
      operation: 'Move',
      fromNodeId: 'n11',
      toNodeId: 'n2',
      traceNodeId: 'n11'
    }
  ];
  const tree = {
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
                children: [{ id: 'n5', label: 'Quale', word: 'Quale' }]
              },
              {
                id: 'n6',
                label: 'NP',
                children: [{ id: 'n7', label: 'N', children: [{ id: 'n8', label: 'libro', word: 'libro' }] }]
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
            children: [{ id: 'n20', label: 'ha', word: 'ha' }]
          },
          {
            id: 'n12',
            label: 'InflP',
            children: [
              {
                id: 'n13',
                label: 'Infl',
                children: [{ id: 'n21', label: '∅', word: '∅' }]
              },
              {
                id: 'n14',
                label: 'VP',
                children: [
                  {
                    id: 'n15',
                    label: 'V',
                    children: [{ id: 'n22', label: 'letto', word: 'letto' }]
                  },
                  {
                    id: 'n11',
                    label: 'DP',
                    children: [{ id: 'n16', label: 'D', children: [{ id: 'n17', label: '∅', word: '∅' }] }]
                  }
                ]
              },
              {
                id: 'n18',
                label: 'DP',
                children: [{ id: 'n19', label: 'D', children: [{ id: 'n23', label: 'Giulia', word: 'Giulia' }] }]
              }
            ]
          }
        ]
      }
    ]
  };

  const normalizedExplanation = harmonizeExplanationWithDerivation(
    explanation,
    [],
    movementEvents,
    tree,
    'xbar'
  );

  assert.match(normalizedExplanation, /movement of DP "Quale libro" from its lower copy/i);
  assert.doesNotMatch(normalizedExplanation, /movement from DP to DP/i);
});

test('harmonizeExplanationWithDerivation does not upgrade successive-cyclic DP movement into CP movement prose', () => {
  const tree = {
    id: 'cp1',
    label: 'CP',
    children: [
      {
        id: 'dp1',
        label: 'DP',
        children: [{ id: 'w1', label: 'Which', word: 'Which' }]
      },
      {
        id: 'cbar1',
        label: "C'",
        children: [
          { id: 'c1', label: 'C', children: [{ id: 'w2', label: 'do', word: 'do' }] },
          {
            id: 'vp1',
            label: 'VP',
            children: [
              { id: 'v1', label: 'V', children: [{ id: 'w3', label: 'think', word: 'think' }] },
              {
                id: 'cp2',
                label: 'CP',
                children: [
                  { id: 'dp_trace2', label: 'DP', word: 't_1' },
                  {
                    id: 'cbar2',
                    label: "C'",
                    children: [
                      { id: 'c2', label: 'C', children: [{ id: 'null1', label: '∅', word: '∅' }] },
                      {
                        id: 'vp2',
                        label: 'VP',
                        children: [
                          { id: 'v2', label: 'V', children: [{ id: 'w4', label: 'bought', word: 'bought' }] },
                          { id: 'dp_trace3', label: 'DP', word: 't_1' }
                        ]
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

  const normalizedExplanation = harmonizeExplanationWithDerivation(
    'A successive-cyclic wh-question.',
    [],
    [
      { operation: 'Move', fromNodeId: 'dp_trace3', toNodeId: 'dp_trace2', traceNodeId: 'dp_trace3' },
      { operation: 'Move', fromNodeId: 'dp_trace2', toNodeId: 'dp1', traceNodeId: 'dp_trace2' }
    ],
    tree,
    'xbar'
  );

  assert.match(normalizedExplanation, /movement of DP/i);
  assert.doesNotMatch(normalizedExplanation, /movement of CP/i);
});

test('harmonizeExplanationWithDerivation describes head movement by overt head and landing site', () => {
  const explanation = 'A German V2 question.';
  const movementEvents = [
    {
      operation: 'HeadMove',
      fromNodeId: 'n10',
      toNodeId: 'n3',
      traceNodeId: 'n11'
    }
  ];
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
            children: [{ id: 'n4', label: 'hat', word: 'hat' }]
          },
          {
            id: 'n5',
            label: 'InflP',
            children: [
              {
                id: 'n6',
                label: 'DP',
                children: [{ id: 'n7', label: 'Maria', word: 'Maria' }]
              },
              {
                id: 'n8',
                label: "Infl'",
                children: [
                  {
                    id: 'n10',
                    label: 'Infl',
                    children: [{ id: 'n11', label: '∅', word: '∅' }]
                  },
                  {
                    id: 'n12',
                    label: 'VP',
                    children: [{ id: 'n13', label: 'gesehen', word: 'gesehen' }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const normalizedExplanation = harmonizeExplanationWithDerivation(
    explanation,
    [],
    movementEvents,
    tree,
    'xbar'
  );

  assert.match(normalizedExplanation, /head movement of "hat" from Infl to C/i);
  assert.doesNotMatch(normalizedExplanation, /head movement of C "hat" to C/i);
});

test('harmonizeExplanationWithDerivation bubbles stacked head landings up to the landing head in prose', () => {
  const explanation = 'An Irish VSO clause.';
  const movementEvents = [
    {
      operation: 'HeadMove',
      fromNodeId: 'n8',
      toNodeId: 'n3',
      traceNodeId: 'n8'
    }
  ];
  const tree = {
    id: 'n1',
    label: 'CP',
    children: [
      {
        id: 'n2',
        label: "C'",
        children: [
          {
            id: 'n4',
            label: 'C',
            children: [
              {
                id: 'n3',
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
                children: [{ id: 'n9', label: '∅', word: '∅' }]
              },
              {
                id: 'n10',
                label: 'VP',
                children: [
                  {
                    id: 'n8',
                    label: 'V',
                    children: [{ id: 'n11', label: '∅', word: '∅' }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const normalizedExplanation = harmonizeExplanationWithDerivation(
    explanation,
    [],
    movementEvents,
    tree,
    'xbar'
  );

  assert.match(normalizedExplanation, /head movement of "D'oscail" from V to C/i);
  assert.doesNotMatch(normalizedExplanation, /to V/i);
});

test('harmonizeExplanationWithDerivation uses the overt head surface rather than an entire subtree yield', () => {
  const explanation = 'A Hungarian wh question.';
  const tree = {
    id: 'n1',
    label: 'CP',
    children: [
      {
        id: 'n2',
        label: 'DP',
        children: [
          { id: 'n3', label: 'D', children: [{ id: 'n4', label: 'Melyik', word: 'Melyik' }] }
        ]
      },
      {
        id: 'n5',
        label: 'C',
        children: [
          {
            id: 'n6',
            label: 'InflP',
            children: [
              { id: 'n7', label: 'Infl', children: [{ id: 'n8', label: 'nezte', word: 'nezte' }] },
              { id: 'n9', label: 'DP', children: [{ id: 'n10', label: 'Anna', word: 'Anna' }] }
            ]
          }
        ]
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

  assert.match(normalizedExplanation, /left-peripheral head "nezte"/i);
  assert.doesNotMatch(normalizedExplanation, /"nezte Anna"/i);
});

test('harmonizeExplanationWithDerivation does not append generic structure-building boilerplate', () => {
  const explanation = 'The matrix clause selects a CP complement.';
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
    explanation,
    [
      {
        operation: 'ExternalMerge',
        targetNodeId: 'n1'
      }
    ],
    [],
    tree,
    'xbar'
  );

  assert.match(normalizedExplanation, /committed X-bar analysis/i);
  assert.match(normalizedExplanation, /analyzed as a CP/i);
  assert.match(normalizedExplanation, /No displacement operation is encoded in the derivation/i);
  assert.doesNotMatch(normalizedExplanation, /structure building/i);
  assert.doesNotMatch(normalizedExplanation, /adopts a CP-level structure/i);
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

  // Bracketed notation must use the clean labels
  assert.doesNotMatch(analysis.bracketedNotation, /DP_i/);
  assert.match(analysis.bracketedNotation, /\[DP \[D' \[D Which\]/);
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
