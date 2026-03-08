import test from 'node:test';
import assert from 'node:assert/strict';

import { ParseApiError, __test__ } from '../server/geminiParser.js';

const {
  normalizeParseBundle,
  harmonizeExplanationWithDerivation,
  buildCanonicalMovementEvents,
  buildSystemInstruction,
  buildParseContentsPrompt,
  buildFinalizationPrompt
} = __test__;

const TRACE_RE = /^(?:t|trace|t\d+|trace\d+|t[_-][a-z0-9]+|trace[_-][a-z0-9]+|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\}|∅|Ø|ε|null|epsilon)$/i;
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

  assert.match(instruction, /The tree must be the final pronounced structure/i);
  assert.match(instruction, /First decide movement and encode it in "movementDecision\.hasMovement"/i);
  assert.match(instruction, /For every apparent dependency, choose exactly one analysis: direct merge or movement/i);
  assert.match(instruction, /Return "movementEvents": \[\]/i);
  assert.match(instruction, /Every overt input token must appear in the tree exactly as pronounced/i);
  assert.match(instruction, /Keep only the pronounced copy overt and render the lower occurrence as a trace, copy, or null element/i);
  assert.match(instruction, /represent it only as "∅"/i);
});

test('buildParseContentsPrompt reinforces overt-token uniqueness and explicit lower copies', () => {
  const prompt = buildParseContentsPrompt('Ha comprado Ana el libro?', 'xbar');

  assert.match(prompt, /Return the complete analysis in one pass/i);
  assert.match(prompt, /Before returning, decide whether movement occurs in this analysis and make movementDecision, movementEvents, derivationSteps, explanation, and the tree all match that same one choice/i);
  assert.match(prompt, /If movement occurs, make it explicit\. If movement does not occur, do not leave traces, lower copies, or null heads that imply otherwise/i);
  assert.match(prompt, /The order of children in your final tree must encode the pronounced left-to-right order|CRITICAL LINEARIZATION RULE.*children array must be ordered/i);
  assert.match(prompt, /Use each overt input token exactly once in the final tree/i);
  assert.match(prompt, /use exactly "∅"/i);
});

test('buildFinalizationPrompt asks the model to finalize movement and linearization coherently', () => {
  const prompt = buildFinalizationPrompt(
    {
      analyses: [
        {
          tree: { id: 'n1', label: 'CP', children: [] },
          explanation: 'Draft explanation.'
        }
      ]
    },
    'Which article did Nora publish?',
    'xbar'
  );

  assert.match(prompt, /draft tree bundle from pass 1/i);
  assert.match(prompt, /Return a finalized JSON analysis bundle/i);
  assert.match(prompt, /If movement is intended, encode it explicitly in the tree/i);
  assert.match(prompt, /either encode that head movement explicitly or revise the draft/i);
  assert.match(prompt, /Return movementEvents, derivationSteps, and surfaceOrder in every finalized analysis/i);
  assert.match(prompt, /Left-to-right DFS of the final tree must spell exactly/i);
  assert.doesNotMatch(prompt, /Draft explanation/);
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

test('normalizeParseBundle preserves tree yield when sibling order drifts from the input sentence', () => {
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

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(
    normalized.analyses[0].surfaceOrder,
    ['The', 'student', 'said', 'that', 'the', 'lecture', 'ended', 'early']
  );
});

test('normalizeParseBundle preserves tree yield when overt tokens are duplicated beyond the input sentence inventory', () => {
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

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(
    normalized.analyses[0].surfaceOrder,
    ['Marie', 'Marie', 'a', 'dit', 'que', 'Paul', 'partirait']
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

test('normalizeParseBundle preserves tree yield even when overt constituents realize a non-sentence order', () => {
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

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  assert.deepEqual(
    normalized.analyses[0].surfaceOrder,
    ['The', 'lecture', 'said', 'early', 'that', 'student', 'ended']
  );
});

test('normalizeParseBundle preserves tree yield for misordered TP siblings in minimalism wh-questions', () => {
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

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'minimalism', sentence);
  assert.deepEqual(
    normalized.analyses[0].surfaceOrder,
    ['Quale', 'poema', 'ha', 'scritto', 'Elisa']
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

test('normalizeParseBundle sorts siblings by sentence position but does not restructure tree depth (V-initial with misplaced DP)', () => {
  // When the model places DP(Ana) as sibling of VP at InflP level instead of
  // inside VP, the simple sibling sort cannot fix the interleaving because
  // Ana (pos 2) falls between comprado (pos 1) and el (pos 3) which are both
  // inside VP.  The sort honestly surfaces this structural error.
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

  const normalized = normalizeParseBundle(withMovementDecision(payload), 'xbar', sentence);
  // With DP(Ana) outside VP, sibling sort places VP (min=1) before DP(Ana) (min=2),
  // so DFS reads: Ha, comprado, el, libro, Ana — the model's structural error is visible.
  assert.deepEqual(
    normalized.analyses[0].surfaceOrder,
    ['Ha', 'comprado', 'el', 'libro', 'Ana']
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

  assert.match(normalizedExplanation, /movement of DP_i from its lower copy/i);
  assert.doesNotMatch(normalizedExplanation, /movement from Infl to DP/i);
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

test('normalizeParseBundle accepts overt unary head-stacking when surface order remains coherent', () => {
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

test('normalizeParseBundle reorders siblings to match input sentence order (Spanish wh-VS)', () => {
  // Model might produce the object DP before the subject DP in the tree,
  // yielding "Donde compró el libro Juan" instead of "Donde compró Juan el libro".
  // reorderChildrenBySentenceOrder should fix the linearisation.
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

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  const analysis = normalized.analyses[0];

  // After reordering, the surface order must match the input sentence
  assert.deepStrictEqual(
    analysis.surfaceOrder,
    ['Donde', 'compró', 'Juan', 'el', 'libro'],
    'surface order must match input sentence after sibling reordering'
  );
});

test('normalizeParseBundle sorts siblings but does not restructure tree depth (Spanish wh-VS with misplaced DP at InfIP level)', () => {
  // Model places DP(Juan) as sibling of VP at InfIP level.  The sentence
  // requires Juan between compró and el (both inside VP), but the simple
  // sibling sort cannot fix this — it honestly surfaces the model's error.
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

  const normalized = normalizeParseBundle(payload, 'xbar', sentence);
  // VP (min=1) sorts before DP(Juan) (min=2), so DFS reads:
  // Donde, compró, el, libro, Juan — the model's structural error is visible.
  assert.deepStrictEqual(
    normalized.analyses[0].surfaceOrder,
    ['Donde', 'compró', 'el', 'libro', 'Juan'],
    'sibling sort preserves model structure; misplaced DP surfaces as wrong terminal order'
  );
});
