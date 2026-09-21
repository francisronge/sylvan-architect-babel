import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import { __test__ } from '../server/babelParser.js';
import { buildSystemInstruction, DERIVATION_STAGES_BASE_INSTRUCTION } from '../server/babelParser/systemInstruction.js';
import { buildParseContentsPrompt } from '../server/babelParser/prompts.js';
import { tokenizeSentenceSurfaceOrder } from '../server/babelParser/surfaceTokens.js';

const buildCurrentContractPayload = () => ({
  derivationStages: [
    {
      statement: 'The noun Mia enters the derivation.',
      stageRecord: 'Lexical selection introduces the proper noun Mia, which projects a noun phrase that will serve as the external argument of the predicate.',
      relations: [],
      workspaceForest: [
        {
          id: 'np_mia',
          label: 'NP',
          children: [
            {
              id: 'n_mia',
              label: 'N',
              children: [
                { id: 'leaf_mia', label: 'Mia', word: 'Mia', tokenIndex: 0, children: [] }
              ]
            }
          ]
        }
      ]
    },
    {
      statement: 'The intransitive verb laughed projects a verb phrase.',
      stageRecord: 'The unergative verb laughed is selected and projects a verb phrase; its single theta role is assigned to the external argument position, which the noun phrase Mia will occupy.',
      relations: [],
      workspaceForest: [
        { refId: 'np_mia' },
        {
          id: 'vp_laughed',
          label: 'VP',
          children: [
            {
              id: 'vbar_laughed',
              label: "V'",
              children: [
                {
                  id: 'v_laughed',
                  label: 'V',
                  children: [
                    { id: 'leaf_laughed', label: 'laughed', word: 'laughed', tokenIndex: 1, children: [] }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      statement: 'Tense combines with the verb phrase.',
      stageRecord: 'A finite past tense head selects the verb phrase as its complement, projecting the inflectional layer that licenses the subject position of the clause.',
      relations: [],
      workspaceForest: [
        { refId: 'np_mia' },
        {
          id: 'tbar_1',
          label: "T'",
          children: [
            { id: 't_past', label: 'T', children: [{ id: 'leaf_t', label: '∅', children: [] }] },
            { refId: 'vp_laughed' }
          ]
        }
      ]
    },
    {
      statement: 'The subject occupies the specifier of TP and the clause converges.',
      stageRecord: 'The noun phrase Mia merges as the specifier of the tense projection, and the tense head bears an open agreement relation to that subject; the derivation converges with the surface order Mia laughed.',
      relations: [
        {
          relation: 'bespoke-open-agreement',
          anchors: {
            'unbounded-probe-role': 't_past',
            'bespoke-goal-role': 'np_mia'
          },
          priorAnchors: {
            'earlier-probe-role': 't_past',
            'earlier-goal-role': 'np_mia'
          },
          values: {
            notation: '[uφ]',
            outcome: ['valued', 'NOM']
          }
        }
      ],
      workspaceForest: [
        {
          id: 'tp_root',
          label: 'TP',
          children: [{ refId: 'np_mia' }, { refId: 'tbar_1' }]
        }
      ]
    }
  ]
});

test('both frameworks select the theory and share the open derivation contract without theoretical coaching', () => {
  for (const framework of ['xbar', 'minimalism']) {
    const instruction = buildSystemInstruction(framework);
    const frameworkInstruction = instruction.slice(0, instruction.indexOf('\n\n'));
    assert.match(frameworkInstruction, framework === 'xbar'
      ? /X-bar Theory and Government and Binding Theory/
      : /Minimalist Program using Bare Phrase Structure/);
    assert.match(frameworkInstruction, /Explain the sentence-specific structural choices and derivational commitments/);
    assert.doesNotMatch(frameworkInstruction, /endocentric|binary|one or two children|Attach overt words|bar-level prime|X-bar shells/);
    assert.equal(instruction.slice(frameworkInstruction.length + 2), DERIVATION_STAGES_BASE_INSTRUCTION);
    assert.match(instruction, /An unchanged workspace needs a sentence-specific reason within the analysis for the new stage\./);
    assert.match(instruction, /Replay derives its construction steps from workspace changes; do not add relations solely to narrate those steps\./);
    assert.match(instruction, /Record relations that are not fully expressed by the forest's ordinary mother-daughter or sisterhood branching\./);
    assert.doesNotMatch(instruction, /their sequence is represented by the ordered relations/);
    assert.match(instruction, /Label each node according to the selected framework, preserving the distinctions made in the analysis\./);
    assert.match(instruction, /The supplied input-token boundaries are for reference; they do not prescribe syntactic or morpheme boundaries\./);
    assert.doesNotMatch(instruction, /A projection's label names the projection, not merely its head/);
    assert.match(instruction, /values: a nonempty object with nonblank entry names/);
    assert.match(instruction, /Each entry contains a literal string or a nonempty array of literal strings/);
    assert.match(instruction, /anchors: a nonempty object with nonblank role names/);
    assert.match(instruction, /priorAnchors:.*immediately preceding stage's expanded workspace/);
    assert.match(instruction, /Anchor-role and value-entry names are not fixed fields or a prescribed vocabulary/);
    assert.match(instruction, /Use an anchor list for nodes with the same role in this relation\. Keep distinct groups in separate entries and name their roles distinctly\./);
    assert.match(instruction, /Anchor each relation to the exact occurrences involved when it is established, including occurrences established by that relation\./);
    assert.match(instruction, /Do not substitute a different occurrence introduced only by a later relation merely because it shares lineage\./);
  }
});

test('the model-facing contract distinguishes a completed analysis from grammaticality', () => {
  const instruction = buildSystemInstruction('xbar', 'gemini');
  assert.match(instruction, /Analyze the exact input, including an ungrammatical input/);
  assert.match(instruction, /A completed analysis may establish that the input is illicit/);
  assert.match(instruction, /A judgment about the whole analysis is anchored to its final root/);
  assert.match(instruction, /In the final stage, ordinary pronounced terminals and explicit realization groups together account for every supplied input token exactly once\./);
  assert.match(instruction, /Without groups, the pronounced terminals in tree order match the supplied input tokens\./);
});

test('sentence requests preserve quoted, multiline and multilingual input as data', () => {
  for (const sentence of ['Which book did John buy?', 'She said "yes".\nThen left.', 'איזה ספר קנתה נועה?']) {
    const request = buildParseContentsPrompt(sentence, 'xbar', 'gpt');
    const [input, tokens] = request.split('\n');
    assert.equal(JSON.parse(input.slice('Sentence: '.length)), sentence);
    assert.deepEqual(JSON.parse(tokens.slice('Input tokens, indexed from zero: '.length)), tokenizeSentenceSurfaceOrder(sentence));
    assert.equal(buildParseContentsPrompt(sentence, 'minimalism', 'claude'), request);
  }
});

test('normalizes ordinary derivations without adding optional realization groups', () => {
  const bundle = __test__.normalizeParseBundle(
    buildCurrentContractPayload(),
    'xbar',
    'Mia laughed.',
    'gemini',
    true,
    { payloadIntegrityFlags: [] }
  );

  assert.equal(bundle.analyses.length, 1);
  const analysis = bundle.analyses[0];

  assert.equal(analysis.derivationStages.length, 4);
  analysis.derivationStages.forEach((stage) => {
    assert.deepEqual(Object.keys(stage), [
      'statement',
      'stageRecord',
      'relations',
      'workspaceForest'
    ]);
    assert.equal(typeof stage.statement, 'string');
    assert.equal(typeof stage.stageRecord, 'string');
    assert.ok(Array.isArray(stage.relations));
    assert.ok(Array.isArray(stage.workspaceForest));
  });

  assert.equal(analysis.derivationStages[3].relations[0].relation, 'bespoke-open-agreement');
  assert.deepEqual(analysis.derivationStages[3].relations[0].anchors, {
    'unbounded-probe-role': 't_past',
    'bespoke-goal-role': 'np_mia'
  });
  assert.deepEqual(analysis.derivationStages[3].relations[0].priorAnchors, {
    'earlier-probe-role': 't_past',
    'earlier-goal-role': 'np_mia'
  });
  assert.deepEqual(analysis.derivationStages[3].relations[0].values, {
    notation: '[uφ]',
    outcome: ['valued', 'NOM']
  });
  assert.deepEqual(
    analysis.derivationStages.map((stage) => stage.stageRecord),
    buildCurrentContractPayload().derivationStages.map((stage) => stage.stageRecord)
  );
  assert.equal(analysis.provenance.treeSource, 'derivationStages');
  const replayPlan = buildDerivationReplayPlan({ derivationStages: analysis.derivationStages });
  assert.equal(replayPlan.stages.length, 4);
  assert.equal(replayPlan.stages[0].stepId, 'stage-1');
  assert.equal(
    replayPlan.stages[3].relationSteps[0].relation,
    'bespoke-open-agreement'
  );
  assert.deepEqual(
    replayPlan.stages[3].macroStep.workspaceForest,
    analysis.derivationStages[3].workspaceForest
  );
  assert.deepEqual(Object.keys(analysis).sort(), [
    'derivationStages',
    'provenance',
    'tree'
  ]);
});

test('rejects derivation stages that add an unsupported authored field', () => {
  const payload = buildCurrentContractPayload();
  payload.derivationStages = payload.derivationStages.map((stage, index) => ({
    ...stage,
    compilerHint: `stage-${index + 1}`
  }));

  assert.throws(
    () => __test__.normalizeParseBundle(
      payload,
      'xbar',
      'Mia laughed.',
      'gemini',
      true,
      { payloadIntegrityFlags: [] }
    ),
    (error) => error?.code === 'BAD_MODEL_RESPONSE'
  );
});

test('rejects a top-level array at JSON ingress', () => {
  assert.throws(
    () => __test__.parseModelJson(JSON.stringify([buildCurrentContractPayload()])),
    (error) => error?.code === 'BAD_MODEL_RESPONSE'
  );
});

test('preserves every distinct analysis in the strict ambiguity envelope', () => {
  const payload = buildCurrentContractPayload();
  const bundle = __test__.normalizeParseBundle(
    { analyses: [payload, payload, payload] },
    'xbar',
    'Mia laughed.',
    'gemini',
    true,
    { payloadIntegrityFlags: [] }
  );

  assert.equal(bundle.analyses.length, 3);
  assert.equal(bundle.ambiguityDetected, true);
});

test('never substitutes an earlier committed tree for a split final stage', () => {
  const payload = buildCurrentContractPayload();
  payload.derivationStages.push({
    statement: 'The final authored state is split and has not converged.',
    stageRecord: 'The final state still contains separate nominal and verbal workspaces.',
    relations: [],
    workspaceForest: [
      { refId: 'np_mia' },
      { refId: 'vp_laughed' }
    ]
  });

  assert.throws(
    () => __test__.normalizeParseBundle(
      payload,
      'xbar',
      'Mia laughed.',
      'gemini',
      true,
      { payloadIntegrityFlags: [] }
    ),
    (error) => {
      assert.equal(error.code, 'INCOMPLETE_GENERATION');
      assert.equal(error.failure.ruleId, 'GENERATION_DID_NOT_CONVERGE');
      assert.equal(error.failure.stageIndex, 4);
      return true;
    }
  );
});

test('keeps the existing surface-mismatch result for a split final stage with different words', () => {
  const payload = buildCurrentContractPayload();
  payload.derivationStages.push({
    statement: 'The final authored state is split and changes the input words.',
    stageRecord: 'The final state contains Noa and the earlier verbal workspace as separate objects.',
    relations: [],
    workspaceForest: [
      {
        id: 'np_noa',
        label: 'NP',
        children: [{ id: 'n_noa', label: 'N', word: 'Noa', tokenIndex: 0, children: [] }]
      },
      { refId: 'vp_laughed' }
    ]
  });

  assert.throws(
    () => __test__.normalizeParseBundle(
      payload,
      'xbar',
      'Mia laughed.',
      'gemini',
      true,
      { payloadIntegrityFlags: [] }
    ),
    (error) => {
      assert.equal(error.code, 'BAD_MODEL_RESPONSE');
      assert.equal(error.failure.ruleId, 'SURFACE_ORDER_EXACT');
      return true;
    }
  );
});
