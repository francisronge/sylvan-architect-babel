export const leaf = (id, extras = {}) => ({
  id,
  label: 'X',
  word: id,
  children: [],
  ...extras
});

export const node = (id, children = [], extras = {}) => ({
  id,
  label: 'XP',
  children,
  ...extras
});

const scalarOrArray = (items) => items.length === 1 ? items[0] : items;

const idsFor = (role, count) => Array.from(
  { length: count },
  (_, index) => `${role.replace(/[^a-z0-9]+/giu, '_')}_${index + 1}`
);

const valueLiteral = (recipe, valueName, index) => {
  if (valueName === 'outcome') return recipe.acceptedOutcomeConcepts[0] ?? 'licensed';
  if (valueName === 'movement.route') return 'curve';
  if (valueName === 'verdict') return '*';
  if (valueName === 'index') return String(index + 1);
  if (valueName === 'label') return 'label';
  if (valueName === 'role.label') return ['Agent', 'Theme', 'Goal'][index] ?? `Role ${index + 1}`;
  if (valueName === 'feature.label') return recipe.id === 'strong-npi' ? 'strong NPI' : 'F';
  if (valueName === 'accent.label') return 'H*';
  if (valueName === 'cycle') return 'C1';
  if (valueName === 'step') return '1';
  if (valueName === 'plaque.rows') return `row ${index + 1}`;
  if (valueName === 'pf.rows') return `PF row ${index + 1}`;
  if (valueName === 'rewrite.rows') return `input ${index + 1} -> output ${index + 1}`;
  if (valueName === 'correspondence.rows') return `pf.sources ${index + 1} => pf.exponents ${index + 1}`;
  if (valueName === 'order.rows') return recipe.id === 'pf.local-dislocation'
    ? index === 0 ? 'a b' : '[a b]' : index === 0 ? 'a < b' : 'b < c';
  if (valueName === 'delink.position') return 'feature.hierarchy 1';

  const tokenCheck = recipe.checks.find((check) => (
    check.kind === 'value-token' && check.value === valueName
  ));
  if (tokenCheck) return tokenCheck.tokens[0];
  return `${valueName} ${index + 1}`;
};

// Shared fixtures supply complete authored evidence for recipe tests and the
// production-renderer atlas; they do not bypass public normalization.
export const buildFacetFixture = (recipe, options = {}) => {
  const counts = new Map();
  recipe.anchors.forEach((requirement) => {
    const largeMinimum = recipe.checks
      .filter((check) => check.kind === 'large-array' && check.role === requirement.role)
      .reduce((maximum, check) => Math.max(maximum, check.min), 0);
    counts.set(requirement.role, Math.max(requirement.min, largeMinimum));
  });
  if (recipe.id === 'pf.local-dislocation') counts.set('sequence', 3);
  recipe.checks
    .filter((check) => check.kind === 'paired-cardinality')
    .forEach((check) => {
      const count = Math.max(...check.roles.map((role) => counts.get(role) ?? 1));
      check.roles.forEach((role) => counts.set(role, count));
    });

  const currentAnchors = {};
  const priorAnchors = {};
  recipe.anchors.forEach((requirement) => {
    const target = requirement.source === 'prior' ? priorAnchors : currentAnchors;
    target[requirement.role] = idsFor(requirement.role, counts.get(requirement.role) ?? 1);
  });

  const values = {};
  recipe.values.forEach((requirement) => {
    const count = Math.max(requirement.min, 1);
    values[requirement.value] = Array.from(
      { length: count },
      (_, index) => valueLiteral(recipe, requirement.value, index)
    );
  });
  if (options.movementRoute) values['movement.route'] = [options.movementRoute];
  // Orders are node lists: the current order in anchors, the prior order in
  // priorAnchors, both resolvable in their stage.
  if (recipe.id === 'pf.linearization') {
    currentAnchors.order = idsFor('order', 2);
    priorAnchors.order = [...currentAnchors.order].reverse();
  }
  // Per-item literals pair with an anchor list through a same-name entry.
  recipe.checks
    .filter((check) => check.kind === 'paired-values')
    .forEach((check) => {
      if ((counts.get(check.role) ?? 1) > 1 && values[check.value]) {
        values[check.role] = values[check.value];
        delete values[check.value];
      }
    });

  const currentNodes = new Map(
    Object.values(currentAnchors).flat().map((id) => [id, leaf(id)])
  );
  if (recipe.id === 'coreference.coindex') currentNodes.forEach((participant, id) => {
    participant.label = 'DP';
    delete participant.word;
    participant.children = [leaf(`${id}_word`, { label: 'D', word: id })];
  });
  const priorNodes = new Map(
    Object.values(priorAnchors).flat().map((id) => [id, leaf(id)])
  );
  const attached = new Set();
  let syntheticIndex = 0;

  const attach = (parent, child) => {
    if (!parent.children.some((candidate) => candidate.id === child.id)) {
      parent.children.push(child);
    }
    attached.add(child.id);
  };

  recipe.checks.forEach((check) => {
    const current = (role) => (currentAnchors[role] ?? []).map((id) => currentNodes.get(id));
    switch (check.kind) {
      case 'movement-evidence':
        current('movement.landing').forEach(member => { member.label = 'DP'; });
        break;
      case 'contains': {
        current(check.containerRole).forEach(container =>
          current(check.memberRole).forEach((member) => attach(container, member)));
        break;
      }
      case 'contains-authored-silent':
      case 'authored-trace-or-gap':
      case 'gap-or-silent-copy':
        current(check.role).forEach((member) => {
          member.silent = true;
          member.label = 't';
          delete member.word;
        });
        break;
      case 'shared-lineage':
      case 'shared-root-lineage':
        check.roles.flatMap(current).forEach((member) => {
          member.lineageId = `lineage_${recipe.id}`;
        });
        break;
      case 'multiple-parents': {
        const parents = current('parents');
        current(check.role).forEach((member) => {
          if (parents[0]) attach(parents[0], member);
        });
        break;
      }
      case 'shared-native-parent': {
        const sharedParent = node(`synthetic_shared_parent_${syntheticIndex += 1}`);
        check.roles.flatMap(current).forEach((member) => attach(sharedParent, member));
        currentNodes.set(sharedParent.id, sharedParent);
        break;
      }
      case 'siblings-within-domain': {
        const siblingParent = node(`synthetic_siblings_${syntheticIndex += 1}`);
        current(check.leftRole).forEach((member) => attach(siblingParent, member));
        current(check.rightRole).forEach((member) => attach(siblingParent, member));
        attach(current(check.domainRole)[0], siblingParent);
        break;
      }
      case 'native-parent-branch': {
        current(check.role).forEach((member) => {
          const parent = node(`synthetic_parent_${syntheticIndex += 1}`);
          attach(parent, member);
          currentNodes.set(parent.id, parent);
        });
        break;
      }
      case 'projection-chain': {
        const chain = [...current('accent.bearer'), ...current('projection.nodes')];
        chain.slice(1).forEach((parent, index) => attach(parent, chain[index]));
        break;
      }
      case 'transfer-configuration': {
        const [phase] = current('phase');
        [...current('phase.head'), ...current('phase.edge'), ...current('transfer.domain')].forEach(member => attach(phase, member));
        break;
      }
      case 'movement-carrier': {
        attach(current('movement.carrier')[0], current('movement.source')[0]);
        break;
      }
      case 'rebracketing-configuration': {
        // [a b] c becomes a [b c]; a renamed parent or unary wrapper is not rebracketing.
        const members = current('sequence');
        const before = node(`synthetic_prior_group_${syntheticIndex += 1}`,
          members.slice(0, 2).map(member => structuredClone(member)));
        priorNodes.set(before.id, before);
        priorNodes.set(members[2].id, structuredClone(members[2]));
        const after = node(`synthetic_current_group_${syntheticIndex += 1}`);
        members.slice(1).forEach(member => attach(after, member));
        currentNodes.set(after.id, after);
        break;
      }
      case 'distinct':
      case 'paired-cardinality':
      case 'value-token':
      case 'accepted-outcome':
      case 'active-lens':
      case 'parent-facet-complete':
      case 'large-array':
        break;
    }
  });

  const topLevel = [...currentNodes.values()].filter((member) => !attached.has(member.id));
  let currentForest;
  if (options.crossWorkspace) {
    const [sourceId] = currentAnchors['movement.source'];
    const [landingId] = currentAnchors['movement.landing'];
    const source = currentNodes.get(sourceId);
    const landing = currentNodes.get(landingId);
    const remainder = topLevel.filter((member) => member !== source && member !== landing);
    currentForest = [
      node('workspace_source', [source]),
      node('workspace_landing', [landing, ...remainder])
    ];
  } else {
    currentForest = [node(`root_${recipe.id}`, topLevel)];
  }
  const priorForest = priorNodes.size > 0
    ? [node(`prior_root_${recipe.id}`, [...priorNodes.values()])]
    : [];

  const relation = {
    relation: `UnknownFacet:${recipe.id}`,
    anchors: Object.fromEntries(
      Object.entries(currentAnchors).map(([role, ids]) => [role, scalarOrArray(ids)])
    ),
    ...(Object.keys(priorAnchors).length > 0
      ? {
          priorAnchors: Object.fromEntries(
            Object.entries(priorAnchors).map(([role, ids]) => [role, scalarOrArray(ids)])
          )
        }
      : {}),
    ...(Object.keys(values).length > 0
      ? {
          values: Object.fromEntries(
            Object.entries(values).map(([name, literals]) => [name, scalarOrArray(literals)])
          )
        }
      : {})
  };

  return {
    relation,
    currentForest,
    priorForest,
    activeLens: true
  };
};

export const buildPublicFacetFixture = (recipe, options = {}) => {
  const fixture = buildFacetFixture(recipe, options);
  // Companions require an independently complete claim in the same relation.
  // Identity supplies that claim through the public contract, without a forged
  // parentFacetComplete flag or a synthetic compiler identity.
  if (recipe.id === 'presentation.lens') {
    const ids = [fixture.relation.anchors['facet.anchors'], 'second-occurrence'];
    fixture.currentForest[0].children.push(leaf(ids[1], { word: 'second' }));
    fixture.relation.anchors.occurrences = ids;
    fixture.relation.anchors['facet.anchors'] = ids;
  } else if (recipe.id === 'organization.large-anchor-set') {
    fixture.relation.anchors.occurrences = fixture.relation.anchors['large.anchor.array'];
  }
  const terminals = (tree, silent = false) => {
    const children = tree.children ?? [];
    // The interpreter fixture helper initially creates every anchor as a word.
    // Public trees pronounce terminals; their subsequently built parents do not.
    if (children.length > 0) delete tree.word;
    const childWords = children.flatMap(child => terminals(child, silent || tree.silent));
    return silent || tree.silent ? [] : children.length > 0 ? childWords : tree.word ? [tree.word] : [];
  };
  let words = fixture.currentForest.flatMap(tree => terminals(tree));
  fixture.priorForest.forEach(tree => terminals(tree));
  if (words.length === 0) {
    // An all-silent claim can occur beside pronounced syntax. The unrelated
    // context supplies a nonempty input without changing the silent occurrence.
    fixture.currentForest[0].children.push(leaf('pronounced-context', { word: 'context' }));
    words = ['context'];
  }
  const stage = (workspaceForest, relations = []) => ({
    statement: 'The authored relation is established.',
    stageRecord: 'The workspace supplies the exact occurrences named in this relation.',
    relations,
    workspaceForest
  });
  return {
    fixture,
    sentence: words.join(' '),
    relationStageIndex: fixture.priorForest.length > 0 ? 1 : 0,
    derivationStages: [
      ...(fixture.priorForest.length > 0 ? [stage(fixture.priorForest)] : []),
      stage(fixture.currentForest, [fixture.relation]),
      // Cross-workspace movement is an intermediate state. A later merge
      // supplies the complete final tree required of a public analysis.
      ...(fixture.currentForest.length > 1
        ? [stage([node('completed-root', structuredClone(fixture.currentForest))])] : [])
    ]
  };
};
