import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const guardPath = path.join(repoRoot, 'scripts', 'providerFreeNetworkGuard.cjs');
const minimumNodeMajor = 24;
const volatileProvenanceFields = Object.freeze([
  'timestamp',
  'promptVersion',
  'parserVersion',
  'uiVersion'
]);
const authoredStageFields = Object.freeze([
  'statement',
  'stageRecord',
  'relations',
  'workspaceForest'
]);
const packetArtifacts = Object.freeze([
  {
    classification: 'normative',
    name: 'babel-corrected-canonical-architecture.md'
  },
  {
    classification: 'normative',
    name: 'babel-provider-grade-benchmark-architecture.md'
  },
  {
    classification: 'normative',
    name: 'babel-universal-visual-relations-architecture.md'
  },
  {
    classification: 'normative',
    name: 'babel-corrected-sol-implementation-program.md'
  },
  {
    classification: 'normative',
    name: 'babel-relations-values-exhaustive-coverage-proof.md'
  },
  {
    classification: 'supporting',
    name: 'babel-answered-unknowns-dossier.md'
  }
]);
const sourceSurfaces = Object.freeze([
  'server/babelParser.js',
  'server/babelParser/systemInstruction.js',
  'server/babelParser/prompts.js',
  'server/babelParser/routeConfig.js',
  'server/babelParser/modelRuntime.js',
  'server/babelParser/parseRoutes.js',
  'server/babelParser/parseNormalization.js',
  'server/babelParser/derivationCompiler.js',
  'server/babelParser/nodePronunciation.js',
  'server/babelParser/inventionDetector.js',
  'server/babelParser/surfaceTokens.js',
  'server/babelParser/syntaxTree.js',
  'server/babelParser/treeBasics.js',
  'replay/replayCompiler.ts',
  'replay/replaySnapshot.ts',
  'derivationReplayPlan.js',
  'types.ts',
  'tests/inventionDetector.test.mjs',
  'scripts/captureProviderFreeBaseline.mjs',
  'scripts/providerFreeNetworkGuard.cjs',
  'docs/implementation/baselines/provider-free-baseline-spec.md',
  'docs/implementation/invention-boundary.md'
]);

const sha256 = (value) => crypto
  .createHash('sha256')
  .update(value)
  .digest('hex');

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => typeof value[key] !== 'undefined')
      .map((key) => [key, canonicalize(value[key])])
  );
};

const stableJson = (value) => `${JSON.stringify(canonicalize(value), null, 2)}\n`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const readBytes = (absolutePath) => fs.readFileSync(absolutePath);
const fileSha256 = (absolutePath) => sha256(readBytes(absolutePath));

const parseArguments = (argv) => {
  const options = {
    durableReceiptPath: '',
    guardedChild: false,
    outputPath: path.join(repoRoot, 'bench-baseline', 'provider-free-baseline.json'),
    packetDir: process.env.BABEL_ARCHITECTURE_PACKET_DIR || '',
    semanticOutputPath: '',
    semanticWorker: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--guarded-child') {
      options.guardedChild = true;
      continue;
    }
    if (argument === '--semantic-worker') {
      options.semanticWorker = true;
      continue;
    }
    if (argument === '--output') {
      options.outputPath = path.resolve(process.cwd(), argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (argument === '--packet-dir') {
      options.packetDir = path.resolve(process.cwd(), argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (argument === '--durable-receipt') {
      options.durableReceiptPath = path.resolve(process.cwd(), argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (argument === '--semantic-output') {
      options.semanticOutputPath = path.resolve(process.cwd(), argv[index + 1] || '');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.packetDir) {
    throw new Error(
      'Provide --packet-dir or BABEL_ARCHITECTURE_PACKET_DIR for the six-artifact architecture receipt.'
    );
  }
  return options;
};

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < minimumNodeMajor) {
  throw new Error(
    `Provider-free baseline capture requires Node ${minimumNodeMajor}+ for built-in TypeScript type stripping; found ${process.version}.`
  );
}

const options = parseArguments(process.argv.slice(2));
const guardState = globalThis.__BABEL_PROVIDER_FREE_NETWORK_GUARD__;

async function loadBaselineModules() {
  const [
    replayPlanModule,
    replaySnapshotModule,
    parserModule
  ] = await Promise.all([
    import(pathToFileURL(path.join(repoRoot, 'derivationReplayPlan.js')).href),
    import(pathToFileURL(path.join(repoRoot, 'replay', 'replaySnapshot.ts')).href),
    import(pathToFileURL(path.join(repoRoot, 'server', 'babelParser.js')).href)
  ]);
  return {
    buildDerivationReplayPlan: replayPlanModule.buildDerivationReplayPlan,
    buildReplaySnapshotProjection: replaySnapshotModule.buildReplaySnapshotProjection,
    parserTest: parserModule.__test__
  };
}

const stripVolatileProvenance = (bundle) => {
  for (const analysis of bundle.analyses || []) {
    if (!analysis.provenance || typeof analysis.provenance !== 'object') continue;
    for (const field of volatileProvenanceFields) {
      delete analysis.provenance[field];
    }
  }
  return bundle;
};

const describeFailure = (run) => {
  try {
    const result = run();
    const stableResult = result?.analyses
      ? stripVolatileProvenance(clone(result))
      : result;
    return {
      outcome: 'accepted',
      resultSha256: sha256(stableJson(stableResult))
    };
  } catch (error) {
    return {
      code: String(error?.code || ''),
      details: error?.details === undefined ? null : clone(error.details),
      message: String(error?.message || ''),
      name: String(error?.name || 'Error'),
      outcome: 'rejected',
      status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null
    };
  }
};

const makeMinimalStage = () => ({
  statement: 'The input is represented as one terminal.',
  stageRecord: 'The single overt terminal is represented as a complete minimal derivation tree.',
  relations: [],
  workspaceForest: [
    {
      children: [],
      id: 'minimal_root',
      label: 'Mia',
      tokenIndex: 0,
      word: 'Mia'
    }
  ]
});

const describeStageCompilerProbe = ({
  expectedFlag,
  mutation,
  mutate,
  parserTest
}) => {
  const stage = makeMinimalStage();
  mutate(stage);
  const integrityFlags = [];
  const frames = parserTest.normalizeDerivationStagesToDerivationFrames(
    [stage],
    { integrityFlags }
  );
  if (!integrityFlags.includes(expectedFlag)) {
    throw new Error(
      `Stage probe ${mutation} did not reach ${expectedFlag}; observed ${integrityFlags.join(', ')}.`
    );
  }
  return {
    expectedFlag,
    frameCount: frames.length,
    integrityFlags,
    mutation,
    reachedTargetRule: true
  };
};

async function buildSemanticBaseline(packetDir) {
  const {
    buildDerivationReplayPlan,
    buildReplaySnapshotProjection,
    parserTest
  } = await loadBaselineModules();
  const rawFixtureDir = path.join(repoRoot, 'fixtures', 'raw');
  const normalizedFixtureDir = path.join(repoRoot, 'fixtures', 'normalized');
  const replayFixtureDir = path.join(repoRoot, 'fixtures', 'replay-snapshots');
  const fixtureNames = fs.readdirSync(rawFixtureDir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  const fixtureOutputs = Object.fromEntries(fixtureNames.map((fixtureName) => {
    const rawFixturePath = path.join(rawFixtureDir, fixtureName);
    const normalizedFixturePath = path.join(normalizedFixtureDir, fixtureName);
    const replaySnapshotName = fixtureName.replace(/\.json$/, '.playback.json');
    const replaySnapshotPath = path.join(replayFixtureDir, replaySnapshotName);
    const rawFixtureBytes = readBytes(rawFixturePath);
    const normalizedFixtureBytes = readBytes(normalizedFixturePath);
    const replaySnapshotBytes = readBytes(replaySnapshotPath);
    const rawFixture = JSON.parse(rawFixtureBytes.toString('utf8'));
    const compiledBundle = stripVolatileProvenance(parserTest.normalizeParseBundle(
      clone(rawFixture.payload),
      rawFixture.framework,
      rawFixture.sentence,
      rawFixture.modelRoute,
      true,
      { payloadIntegrityFlags: [] }
    ));
    const committedBundle = stripVolatileProvenance(JSON.parse(
      normalizedFixtureBytes.toString('utf8')
    ));
    const replayPlan = buildDerivationReplayPlan({
      derivationStages: compiledBundle.analyses[0]?.derivationStages || []
    });
    const renderPlan = buildReplaySnapshotProjection(compiledBundle);
    const committedReplaySnapshot = JSON.parse(replaySnapshotBytes.toString('utf8'));
    const compiledBundleJson = stableJson(compiledBundle);
    const committedBundleJson = stableJson(committedBundle);
    const renderPlanJson = stableJson(renderPlan);
    const committedReplaySnapshotJson = stableJson(committedReplaySnapshot);

    return [fixtureName, {
      framework: rawFixture.framework,
      parsedProjections: {
        committedNormalizedSha256: sha256(committedBundleJson),
        currentNormalizedSha256: sha256(compiledBundleJson),
        normalizedParity: compiledBundleJson === committedBundleJson,
        committedReplaySnapshotSha256: sha256(committedReplaySnapshotJson),
        renderPlanParity: renderPlanJson === committedReplaySnapshotJson,
        renderPlanSha256: sha256(renderPlanJson),
        renderPlanStepCount: renderPlan.stepCount,
        replayPlanSha256: sha256(stableJson(replayPlan)),
        replayPlanStepCount: replayPlan.steps.length
      },
      rawByteHashes: {
        normalizedFixtureSha256: sha256(normalizedFixtureBytes),
        rawFixtureSha256: sha256(rawFixtureBytes),
        replaySnapshotSha256: sha256(replaySnapshotBytes)
      },
      sentence: rawFixture.sentence
    }];
  }));

  const malformedSource = JSON.parse(
    readBytes(path.join(rawFixtureDir, fixtureNames[0])).toString('utf8')
  );
  const normalizeMalformed = (payload, sentence = malformedSource.sentence) =>
    parserTest.normalizeParseBundle(
      payload,
      malformedSource.framework,
      sentence,
      malformedSource.modelRoute,
      true,
      { payloadIntegrityFlags: [] }
    );
  const minimalNormalize = (stage) => parserTest.normalizeParseBundle(
    { derivationStages: [stage] },
    'xbar',
    'Mia',
    'fixture',
    true,
    { payloadIntegrityFlags: [] }
  );

  const behaviorProbes = {
    malformedPayloads: {
      invalidJson: describeFailure(() =>
        parserTest.parseModelJson('{"derivationStages":')
      ),
      topLevelArray: describeFailure(() =>
        parserTest.parseModelJson(JSON.stringify([malformedSource.payload]))
      ),
      tokenMismatch: describeFailure(() =>
        normalizeMalformed(clone(malformedSource.payload), 'Different input.')
      ),
      unresolvedRelationAnchor: describeFailure(() => {
        const payload = clone(malformedSource.payload);
        payload.derivationStages.at(-1).relations.push({
          anchors: { witness: 'missing-node-id' },
          relation: 'baseline-unresolved-anchor'
        });
        return normalizeMalformed(payload);
      })
    },
    maskingObservation: {
      description: 'Legacy multi-stage fixture mutations are masked at the API boundary by a downstream refId error after stage 1 is discarded.',
      extraFieldOnFirstStage: describeFailure(() => {
        const payload = clone(malformedSource.payload);
        payload.derivationStages[0].unexpected = 'not part of the contract';
        return normalizeMalformed(payload);
      }),
      intendedStageRuleVisibleAtApiBoundary: false,
      missingStatementFieldOnFirstStage: describeFailure(() => {
        const payload = clone(malformedSource.payload);
        delete payload.derivationStages[0].statement;
        return normalizeMalformed(payload);
      })
    },
    stageRuleProbes: {
      missingStatementFieldContract: describeStageCompilerProbe({
        expectedFlag: 'derivation_stage_contract_fields_invalid:d1',
        mutation: 'delete statement',
        mutate: (stage) => {
          delete stage.statement;
        },
        parserTest
      }),
      missingWorkspaceForestValue: describeStageCompilerProbe({
        expectedFlag: 'workspace_forest_missing_on_derivation_stage:d1',
        mutation: 'set workspaceForest to undefined while retaining the authored key',
        mutate: (stage) => {
          stage.workspaceForest = undefined;
        },
        parserTest
      }),
      unexpectedStageFieldContract: describeStageCompilerProbe({
        expectedFlag: 'derivation_stage_contract_fields_invalid:d1',
        mutation: 'add unexpected field',
        mutate: (stage) => {
          stage.unexpected = 'not part of the contract';
        },
        parserTest
      }),
      emptyStatementValue: describeStageCompilerProbe({
        expectedFlag: 'statement_missing_on_derivation_stage:d1',
        mutation: 'set statement to an empty string while retaining the authored key',
        mutate: (stage) => {
          stage.statement = '';
        },
        parserTest
      }),
      validMinimalStage: describeFailure(() => minimalNormalize(makeMinimalStage()))
    }
  };

  return {
    architecturePacket: {
      artifacts: packetArtifacts.map((artifact) => ({
        ...artifact,
        sha256: fileSha256(path.join(packetDir, artifact.name))
      })),
      normativeArtifactCount: 5,
      supportingArtifactCount: 1
    },
    contract: {
      authoredDerivationStageFields: authoredStageFields,
      modelFacingRolloutChanged: false,
      nodeRuntimeFloor: {
        minimumMajor: minimumNodeMajor,
        reason: 'The replay snapshot import uses Node built-in type stripping for an erasable .ts module.'
      },
      provenanceFieldsExcludedFromSemanticComparison: volatileProvenanceFields
    },
    behaviorProbes,
    fixtureOutputs,
    sourceHashes: Object.fromEntries(
      sourceSurfaces.map((relativePath) => [
        relativePath,
        fileSha256(path.join(repoRoot, relativePath))
      ])
    )
  };
}

const expectDeniedSync = (surface, run, failureCode) => {
  try {
    run();
  } catch (error) {
    if (error?.code === failureCode) return { blocked: true, surface };
    throw error;
  }
  throw new Error(`Network guard self-test did not block ${surface}.`);
};

const expectDeniedAsync = async (surface, run, failureCode) => {
  try {
    await run();
  } catch (error) {
    if (error?.code === failureCode) return { blocked: true, surface };
    throw error;
  }
  throw new Error(`Network guard self-test did not block ${surface}.`);
};

async function proveNetworkGuard(guard) {
  const dgram = await import('node:dgram');
  const dns = await import('node:dns');
  const http = await import('node:http');
  const https = await import('node:https');
  const net = await import('node:net');
  const tls = await import('node:tls');
  const tests = [
    expectDeniedSync('dgram.createSocket', () => dgram.default.createSocket('udp4'), guard.failureCode),
    expectDeniedSync('dns.lookup', () => dns.default.lookup('example.invalid'), guard.failureCode),
    expectDeniedSync('dns.resolve', () => dns.default.resolve('example.invalid'), guard.failureCode),
    await expectDeniedAsync(
      'dns.promises.lookup',
      () => dns.default.promises.lookup('example.invalid'),
      guard.failureCode
    ),
    await expectDeniedAsync(
      'dns.promises.resolve',
      () => dns.default.promises.resolve('example.invalid'),
      guard.failureCode
    ),
    await expectDeniedAsync(
      'fetch',
      () => globalThis.fetch('https://example.invalid'),
      guard.failureCode
    ),
    expectDeniedSync('http.get', () => http.default.get('http://example.invalid'), guard.failureCode),
    expectDeniedSync('http.request', () => http.default.request('http://example.invalid'), guard.failureCode),
    expectDeniedSync('https.get', () => https.default.get('https://example.invalid'), guard.failureCode),
    expectDeniedSync('https.request', () => https.default.request('https://example.invalid'), guard.failureCode),
    expectDeniedSync('net.connect', () => net.default.connect(9, 'example.invalid'), guard.failureCode),
    expectDeniedSync(
      'net.createConnection',
      () => net.default.createConnection(9, 'example.invalid'),
      guard.failureCode
    ),
    expectDeniedSync('tls.connect', () => tls.default.connect(443, 'example.invalid'), guard.failureCode)
  ];
  const observedSurfaces = tests.map((test) => test.surface).sort();
  const declaredSurfaces = Array.from(guard.guardedSurfaces).sort();
  if (stableJson(observedSurfaces) !== stableJson(declaredSurfaces)) {
    throw new Error('Network guard self-test coverage does not match declared guarded surfaces.');
  }
  guard.resetAttempts();
  return tests;
}

const commandReceipt = ({ args, command, id, logDir }) => {
  const displayCommand = [command, ...args].join(' ');
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: null,
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1'
    },
    maxBuffer: 100 * 1024 * 1024
  });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
  const errorText = result.error
    ? Buffer.from(`${result.error.name}: ${result.error.message}\n`, 'utf8')
    : Buffer.alloc(0);
  const log = Buffer.concat([
    Buffer.from(`$ ${displayCommand}\n--- stdout ---\n`, 'utf8'),
    stdout,
    Buffer.from('\n--- stderr ---\n', 'utf8'),
    stderr,
    errorText
  ]);
  const logFile = `${id}.log`;
  fs.writeFileSync(path.join(logDir, logFile), log);
  return {
    command: displayCommand,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    executed: true,
    logBytes: log.length,
    logFile: `logs/${logFile}`,
    logSha256: sha256(log),
    signal: result.signal || null
  };
};

const git = (...args) => execFileSync('git', args, {
  cwd: repoRoot,
  encoding: 'utf8'
}).trimEnd();

const repositoryAnchor = () => {
  const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
  const [ahead, behind] = git('rev-list', '--left-right', '--count', `HEAD...${upstream}`)
    .split(/\s+/)
    .map(Number);
  return {
    ahead,
    behind,
    branch: git('branch', '--show-current'),
    head: git('rev-parse', 'HEAD'),
    upstream
  };
};

const runSemanticWorker = ({ outputPath, packetDir }) => {
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      '--guarded-child',
      '--semantic-worker',
      '--packet-dir',
      packetDir,
      '--semantic-output',
      outputPath
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    }
  );
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(
      `Semantic worker failed: ${result.error?.message || result.stderr || result.signal || result.status}.`
    );
  }
};

async function runGuardedCapture(captureOptions, guard) {
  if (captureOptions.semanticWorker) {
    if (!captureOptions.semanticOutputPath) {
      throw new Error('--semantic-worker requires --semantic-output.');
    }
    const semantic = await buildSemanticBaseline(captureOptions.packetDir);
    fs.mkdirSync(path.dirname(captureOptions.semanticOutputPath), { recursive: true });
    fs.writeFileSync(captureOptions.semanticOutputPath, stableJson(semantic), 'utf8');
    return;
  }

  const outputDir = path.dirname(captureOptions.outputPath);
  const logDir = path.join(outputDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const guardSelfTest = await proveNetworkGuard(guard);
  const verification = [
    commandReceipt({
      args: ['run', 'build'],
      command: 'npm',
      id: 'build',
      logDir
    }),
    commandReceipt({
      args: ['run', 'verify:all'],
      command: 'npm',
      id: 'verify-all',
      logDir
    }),
    commandReceipt({
      args: ['audit', '--offline', '--json'],
      command: 'npm',
      id: 'audit-offline',
      logDir
    })
  ];
  const semanticRunPaths = [
    path.join(outputDir, 'semantic-run-1.json'),
    path.join(outputDir, 'semantic-run-2.json')
  ];
  for (const semanticRunPath of semanticRunPaths) {
    runSemanticWorker({
      outputPath: semanticRunPath,
      packetDir: captureOptions.packetDir
    });
  }
  const semanticRunBytes = semanticRunPaths.map((semanticRunPath) =>
    readBytes(semanticRunPath)
  );
  const semanticRunHashes = semanticRunBytes.map((bytes) => sha256(bytes));
  const semanticRunsEqual = semanticRunBytes[0].equals(semanticRunBytes[1]);
  const runtimeNetworkAttempts = guard.getAttempts();
  const verificationPassed = verification.every((receipt) =>
    receipt.executed && receipt.exitCode === 0 && receipt.signal === null
  );
  const capturePassed = (
    verificationPassed
    && semanticRunsEqual
    && runtimeNetworkAttempts.length === 0
  );
  const semantic = JSON.parse(semanticRunBytes[0].toString('utf8'));
  const semanticSha256 = sha256(stableJson(semantic));
  const manifest = {
    capture: {
      capturedAt: new Date().toISOString(),
      executionBoundary: {
        assertion: 'All Node processes in this capture inherited a deny-by-default socket, fetch, DNS, and datagram guard.',
        guardActive: guard.active === true,
        guardFailureCode: guard.failureCode,
        guardSelfTest,
        guardVersion: guard.version,
        runtimeNetworkAttempts,
        runtimeNetworkAttemptsAllowed: 0
      },
      passed: capturePassed,
      repository: repositoryAnchor(),
      runtime: {
        architecture: process.arch,
        node: process.version,
        platform: process.platform
      },
      verification: {
        allPassed: verificationPassed,
        receipts: verification
      }
    },
    determinism: {
      equal: semanticRunsEqual,
      method: 'Two fresh guarded Node semantic workers with identical inputs.',
      semanticRunFiles: ['semantic-run-1.json', 'semantic-run-2.json'],
      semanticRunSha256: semanticRunHashes
    },
    partition: {
      semanticDigestAlgorithm: 'sha256(canonical-json($.semantic))',
      semanticRoot: '$.semantic',
      volatileAndExecutionRoot: '$.capture'
    },
    schemaVersion: 2,
    semantic,
    semanticSha256
  };
  fs.writeFileSync(captureOptions.outputPath, stableJson(manifest), 'utf8');

  if (capturePassed && captureOptions.durableReceiptPath) {
    const durableReceipt = {
      schemaVersion: 1,
      semantic,
      semanticSha256
    };
    fs.mkdirSync(path.dirname(captureOptions.durableReceiptPath), { recursive: true });
    fs.writeFileSync(captureOptions.durableReceiptPath, stableJson(durableReceipt), 'utf8');
  }

  process.stdout.write(
    `${path.relative(repoRoot, captureOptions.outputPath)}\nsemantic ${semanticSha256}\n`
  );
  if (!capturePassed) {
    process.exitCode = 1;
  }
}

async function main() {
  if (!options.guardedChild) {
    const existingNodeOptions = String(process.env.NODE_OPTIONS || '').trim();
    const guardNodeOption = `--require=${guardPath}`;
    const child = spawnSync(
      process.execPath,
      [scriptPath, '--guarded-child', ...process.argv.slice(2)],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          NODE_OPTIONS: [existingNodeOptions, guardNodeOption].filter(Boolean).join(' ')
        },
        stdio: 'inherit'
      }
    );
    if (child.error) throw child.error;
    if (child.signal) {
      throw new Error(`Guarded baseline capture ended with signal ${child.signal}.`);
    }
    process.exitCode = Number.isInteger(child.status) ? child.status : 1;
    return;
  }
  if (!guardState?.active) {
    throw new Error('Guarded baseline capture refused to run because the network guard is not active.');
  }
  await runGuardedCapture(options, guardState);
}

await main();
