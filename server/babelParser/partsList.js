/**
 * Reads the parts-list workspace form. A parts-list stage names its current
 * roots in `workspace` and lists in `nodes` only the nodes it introduces or
 * changes; children are node ids. Every node keeps its latest definition until
 * a later stage redefines it. An entry with `copyOf` is a new occurrence with
 * the copied node's current structure; Babel writes out its descendants as
 * `copyId/descendantId`.
 *
 * Babel expands each parts-list stage into the nested `workspaceForest` form,
 * with every subtree written out, before any other check runs. Everything
 * downstream therefore reads one form, and records authored as nested forests
 * pass through unchanged. The module is pure so browser inspection can reuse it.
 */

const PARTS_LIST_STAGE_FIELDS = ['statement', 'stageRecord', 'relations', 'workspace', 'nodes', 'realizations'];
const REQUIRED_PARTS_LIST_STAGE_FIELDS = ['statement', 'stageRecord', 'relations', 'workspace', 'nodes'];

// The expanded forest is bounded like the spelling check's reading of it:
// saved analyses stay far below these limits.
const MAX_EXPANDED_DEPTH = 256;
const MAX_STAGE_NODES = 5_000;
const MAX_ANALYSIS_NODES = 50_000;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonblankString = (value) => typeof value === 'string' && Boolean(value.trim());
const quoted = (value) => JSON.stringify(String(value)).slice(0, 162);

const isPartsListStage = (stage) => isPlainObject(stage)
  && (Object.hasOwn(stage, 'workspace') || Object.hasOwn(stage, 'nodes'));

/**
 * Names the workspace form of one analysis: 'parts-list' when any stage writes
 * workspace or nodes, 'nested' otherwise, and 'mixed' when an analysis uses both.
 */
export const workspaceFormOf = (analysis) => {
  const stages = Array.isArray(analysis?.derivationStages) ? analysis.derivationStages : [];
  const partsList = stages.some(isPartsListStage);
  const nested = stages.some(stage => isPlainObject(stage) && Object.hasOwn(stage, 'workspaceForest'));
  return partsList ? (nested ? 'mixed' : 'parts-list') : 'nested';
};

class PartsListIssue extends Error {
  constructor(ruleId, stageIndex, fieldPath, offendingValue, expectedForm, message) {
    super(message);
    this.issue = { ruleId, stageIndex, fieldPath, offendingValue, expectedForm, message };
  }
}

const describeReceived = (value) => (typeof value === 'undefined' ? 'a missing field'
  : value === null ? 'null'
    : Array.isArray(value) ? 'an array'
      : typeof value === 'string' ? `the string ${quoted(value)}`
        : `a ${typeof value}`);

/**
 * Expands one parts-list analysis into nested workspace forests.
 *
 * Returns { form, analysis } where analysis is unchanged for the nested form.
 * A parts-list analysis that cannot be expanded returns { form, issue,
 * stages }: the issue names the first defect with its authored field path, and
 * stages holds the expanded stages before the failing one. `prefix` replaces
 * the leading `$` of every reported path.
 */
export const expandPartsListAnalysis = (analysis, prefix = '$') => {
  const form = workspaceFormOf(analysis);
  if (form === 'nested') return { form, analysis };
  const stages = analysis.derivationStages;
  const stagePath = (stageIndex) => `${prefix}.derivationStages[${stageIndex}]`;
  const expanded = [];

  // id -> { node, stageIndex, nodeIndex }: the latest definition of each node.
  const definitions = new Map();
  let analysisNodes = 0;
  try {
    stages.forEach((stage, stageIndex) => {
      const path = stagePath(stageIndex);
      const fail = (fieldPath, offendingValue, expectedForm, ruleId = 'DERIVATION_PARTS_LIST_VALID', detail) => {
        throw new PartsListIssue(ruleId, stageIndex, fieldPath, offendingValue, expectedForm,
          `Stage ${stageIndex + 1}, ${fieldPath}: ${detail || `expected ${expectedForm}; received ${describeReceived(offendingValue)}`}.`);
      };
      if (!isPlainObject(stage)) fail(path, stage, 'an object', 'DERIVATION_STAGE_OBJECT');
      // A mixed analysis keeps the stages expanded before its first nested stage.
      if (form === 'mixed' && Object.hasOwn(stage, 'workspaceForest')) {
        fail(`${path}.workspaceForest`, null, 'workspace and nodes, as in the other stages of this analysis',
          'DERIVATION_WORKSPACE_FORM_MIXED',
          'this analysis writes other stages as workspace and nodes; every stage of one analysis must use workspace and nodes');
      }
      const fields = Object.keys(stage);
      if (fields.some(field => !PARTS_LIST_STAGE_FIELDS.includes(field))
        || REQUIRED_PARTS_LIST_STAGE_FIELDS.some(field => !Object.hasOwn(stage, field))) {
        fail(path, fields, 'statement, stageRecord, relations, workspace and nodes, with only realizations optional',
          'DERIVATION_STAGE_FIELDS_EXACT',
          `expected statement, stageRecord, relations, workspace and nodes, with only realizations optional; received the fields ${fields.join(', ') || 'none'}`);
      }
      if (!Array.isArray(stage.nodes)) fail(`${path}.nodes`, stage.nodes, 'an array of node entries');
      if (!Array.isArray(stage.workspace)) fail(`${path}.workspace`, stage.workspace, 'an array of root node ids');

      // This stage's definitions replace earlier ones before any id is resolved,
      // so a root or child may name a node listed later in the same stage.
      const stageIds = new Set();
      stage.nodes.forEach((node, nodeIndex) => {
        const nodePath = `${path}.nodes[${nodeIndex}]`;
        if (!isPlainObject(node)) fail(nodePath, node, 'a node entry object');
        if (Object.hasOwn(node, 'refId')) {
          fail(`${nodePath}.refId`, node.refId, 'no refId; name an existing node by its id in children or workspace');
        }
        if (!isNonblankString(node.id)) fail(`${nodePath}.id`, node.id, 'a nonblank string');
        const copy = Object.hasOwn(node, 'copyOf');
        if (copy) {
          if (!isNonblankString(node.copyOf)) fail(`${nodePath}.copyOf`, node.copyOf, 'the id of the node this entry copies');
          if (Object.hasOwn(node, 'children')) fail(`${nodePath}.children`, node.children, 'no children; a copy takes its structure from the node it copies');
        }
        if ((!copy || Object.hasOwn(node, 'label')) && !isNonblankString(node.label)) fail(`${nodePath}.label`, node.label, 'a nonblank string');
        if (Object.hasOwn(node, 'children')) {
          if (!Array.isArray(node.children)) fail(`${nodePath}.children`, node.children, 'an array of node ids');
          node.children.forEach((child, childIndex) => {
            if (isNonblankString(child)) return;
            fail(`${nodePath}.children[${childIndex}]`, child,
              isPlainObject(child) ? 'a node id; list the child as its own entry in nodes and name it here by id' : 'a nonblank node id');
          });
        }
        if (Object.hasOwn(node, 'word') && typeof node.word !== 'string') fail(`${nodePath}.word`, node.word, 'a string');
        if (Object.hasOwn(node, 'silent') && typeof node.silent !== 'boolean') fail(`${nodePath}.silent`, node.silent, 'a boolean');
        if (Object.hasOwn(node, 'lineageId') && !isNonblankString(node.lineageId)) fail(`${nodePath}.lineageId`, node.lineageId, 'a nonblank string');
        if (stageIds.has(node.id)) {
          fail(`${nodePath}.id`, node.id, 'an id listed once in this stage\'s nodes', 'DERIVATION_PARTS_LIST_VALID',
            `node ${quoted(node.id)} is listed more than once in this stage's nodes`);
        }
        stageIds.add(node.id);
      });
      stage.nodes.forEach((node, nodeIndex) => definitions.set(node.id, { node, stageIndex, nodeIndex }));

      // A copy entry becomes ordinary definitions: the copied node's current
      // label, words and subtree, each descendant named copyId/descendantId.
      // A copy may copy another copy of this stage once that one is expanded.
      let pending = stage.nodes.map((node, nodeIndex) => ({ node, nodeIndex })).filter(({ node }) => Object.hasOwn(node, 'copyOf'));
      const pendingIds = () => new Set(pending.map(({ node }) => node.id));
      const subtreeHasPending = (id, waiting, seen = new Set()) => {
        if (seen.has(id) || !definitions.has(id)) return false;
        seen.add(id);
        if (waiting.has(id)) return true;
        const children = definitions.get(id).node.children;
        return Array.isArray(children) && children.some(child => subtreeHasPending(child, waiting, seen));
      };
      while (pending.length) {
        const waiting = pendingIds();
        const ready = pending.filter(({ node }) => definitions.has(node.copyOf) && node.copyOf !== node.id
          && !subtreeHasPending(node.copyOf, waiting));
        if (!ready.length) {
          const { node, nodeIndex } = pending[0];
          const copyPath = `${path}.nodes[${nodeIndex}].copyOf`;
          if (node.copyOf === node.id) fail(copyPath, node.copyOf, 'the id of another node', 'DERIVATION_PARTS_LIST_VALID', `node ${quoted(node.id)} copies itself`);
          if (!definitions.has(node.copyOf)) {
            fail(copyPath, node.copyOf, 'the id of a node defined in this or an earlier stage', 'DERIVATION_PARTS_LIST_VALID',
              `no node ${quoted(node.copyOf)} is defined in this or an earlier stage`);
          }
          fail(copyPath, node.copyOf, 'copies that do not contain one another', 'DERIVATION_PARTS_LIST_VALID',
            `copy ${quoted(node.id)} contains itself through the node it copies`);
        }
        for (const { node: entry, nodeIndex } of ready) {
          const copyPath = `${path}.nodes[${nodeIndex}].copyOf`;
          const copyNode = (sourceId, targetId, depth, visiting) => {
            if (depth >= MAX_EXPANDED_DEPTH || visiting.has(sourceId)) {
              fail(copyPath, entry.copyOf, `a copied subtree at most ${MAX_EXPANDED_DEPTH} levels deep and free of cycles`, 'DERIVATION_PARTS_LIST_VALID',
                `the subtree copied from ${quoted(entry.copyOf)} cannot be expanded`);
            }
            const source = definitions.get(sourceId)?.node;
            if (!source) {
              fail(copyPath, entry.copyOf, 'a copied node whose subtree is defined', 'DERIVATION_PARTS_LIST_VALID',
                `no node ${quoted(sourceId)} beneath ${quoted(entry.copyOf)} is defined in this or an earlier stage`);
            }
            visiting.add(sourceId);
            const copied = { id: targetId };
            Object.entries(source).forEach(([key, value]) => { if (key !== 'children' && key !== 'id') copied[key] = value; });
            const sourceChildren = Array.isArray(source.children) ? source.children : [];
            if (Object.hasOwn(source, 'children')) {
              copied.children = sourceChildren.map(childId => {
                const childTarget = `${entry.id}/${childId}`;
                if (stageIds.has(childTarget)) {
                  fail(copyPath, entry.copyOf, 'a copy whose descendant ids are new', 'DERIVATION_PARTS_LIST_VALID',
                    `copying ${quoted(entry.copyOf)} would name a descendant ${quoted(childTarget)}, which this stage also lists`);
                }
                copyNode(childId, childTarget, depth + 1, visiting);
                return childTarget;
              });
            }
            visiting.delete(sourceId);
            if (targetId !== entry.id) definitions.set(targetId, { node: copied, stageIndex, nodeIndex });
            return copied;
          };
          const root = copyNode(entry.copyOf, entry.id, 0, new Set());
          // A copy takes the copied node's word. Restating that same word changes
          // nothing; any other word would be a second definition, so it fails.
          if (Object.hasOwn(entry, 'word') && entry.word !== root.word) {
            fail(`${path}.nodes[${nodeIndex}].word`, entry.word, `no word, or the copied node's own word ${root.word === undefined ? '(it has none)' : quoted(root.word)}; a copy takes its structure from the node it copies`);
          }
          for (const field of ['label', 'silent', 'lineageId']) if (Object.hasOwn(entry, field)) root[field] = entry[field];
          definitions.set(entry.id, { node: root, stageIndex, nodeIndex });
        }
        const done = new Set(ready.map(({ node }) => node.id));
        pending = pending.filter(({ node }) => !done.has(node.id));
      }

      // Every node this stage lists must resolve and stay acyclic, even one that
      // no root reaches yet.
      const acyclic = new Set();
      const checkDefinition = (id, visiting, depth = 0) => {
        if (acyclic.has(id)) return;
        if (depth >= MAX_EXPANDED_DEPTH) {
          const { stageIndex: definedAt, nodeIndex } = definitions.get(id);
          fail(`${stagePath(definedAt)}.nodes[${nodeIndex}]`, id, `a workspace at most ${MAX_EXPANDED_DEPTH} levels deep`, 'DERIVATION_PARTS_LIST_VALID',
            `the workspace nests deeper than ${MAX_EXPANDED_DEPTH} levels`);
        }
        visiting.add(id);
        const { node, stageIndex: definedAt, nodeIndex } = definitions.get(id);
        (Array.isArray(node.children) ? node.children : []).forEach((childId, childIndex) => {
          const childPath = `${stagePath(definedAt)}.nodes[${nodeIndex}].children[${childIndex}]`;
          if (!definitions.has(childId)) {
            fail(childPath, childId, 'the id of a node defined in this or an earlier stage', 'DERIVATION_PARTS_LIST_VALID',
              `no node ${quoted(childId)} is defined in this or an earlier stage`);
          }
          if (visiting.has(childId)) {
            fail(childPath, childId, 'a child that is not the node itself or one of its ancestors', 'DERIVATION_PARTS_LIST_VALID',
              `node ${quoted(childId)} contains itself through its children`);
          }
          checkDefinition(childId, visiting, depth + 1);
        });
        visiting.delete(id);
        acyclic.add(id);
      };
      stage.nodes.forEach(node => checkDefinition(node.id, new Set()));

      const definitionPath = ({ stageIndex: definedAt, nodeIndex }) => `${stagePath(definedAt)}.nodes[${nodeIndex}]`;
      // id -> where it already stands in this stage's workspace.
      const placed = new Map();
      const ancestors = new Set();
      let stageNodes = 0;
      const build = (id, referencePath, parentId, depth) => {
        const definition = definitions.get(id);
        if (!definition) {
          fail(referencePath, id, 'the id of a node defined in this or an earlier stage', 'DERIVATION_PARTS_LIST_VALID',
            `no node ${quoted(id)} is defined in this or an earlier stage`);
        }
        if (ancestors.has(id)) {
          fail(referencePath, id, 'a child that is not the node itself or one of its ancestors', 'DERIVATION_PARTS_LIST_VALID',
            `node ${quoted(id)} contains itself through its children`);
        }
        if (placed.has(id)) {
          const earlier = placed.get(id);
          fail(referencePath, id, 'a node standing at only one position in this workspace', 'DERIVATION_PARTS_LIST_VALID',
            `node ${quoted(id)} stands at two positions in this workspace: ${earlier.parentId === null ? 'as a root' : `under ${quoted(earlier.parentId)}`} (${earlier.referencePath}) and ${parentId === null ? 'as a root' : `under ${quoted(parentId)}`}; each node is one root or the child of one parent`);
        }
        if (depth >= MAX_EXPANDED_DEPTH) {
          fail(referencePath, id, `a workspace at most ${MAX_EXPANDED_DEPTH} levels deep`, 'DERIVATION_PARTS_LIST_VALID',
            `the workspace nests deeper than ${MAX_EXPANDED_DEPTH} levels`);
        }
        if ((stageNodes += 1) > MAX_STAGE_NODES || (analysisNodes += 1) > MAX_ANALYSIS_NODES) {
          fail(referencePath, id, 'a workspace within Babel\'s size limits', 'DERIVATION_PARTS_LIST_VALID',
            'the workspaces expand to more nodes than Babel reads');
        }
        placed.set(id, { parentId, referencePath });
        ancestors.add(id);
        const ownPath = definitionPath(definition);
        const { node } = definition;
        const children = Array.isArray(node.children) ? node.children : [];
        const result = {};
        // Contract fields are scalars. Any other authored key is passed on by
        // reference, never copied per stage, so a large unknown value retained
        // across many stages cannot multiply before the response-wide field
        // budget downstream rejects it.
        Object.entries(node).forEach(([key, value]) => {
          if (key !== 'children') result[key] = value;
        });
        result.children = children.map((childId, childIndex) => build(childId, `${ownPath}.children[${childIndex}]`, id, depth + 1));
        ancestors.delete(id);
        return result;
      };
      const workspaceForest = stage.workspace.map((rootId, rootIndex) => {
        const rootPath = `${path}.workspace[${rootIndex}]`;
        if (!isNonblankString(rootId)) fail(rootPath, rootId, 'a nonblank node id');
        return build(rootId, rootPath, null, 0);
      });

      const converted = {};
      Object.entries(stage).forEach(([key, value]) => {
        if (key === 'workspace') converted.workspaceForest = workspaceForest;
        else if (key !== 'nodes') converted[key] = value;
      });
      expanded.push(converted);
    });
  } catch (error) {
    if (!(error instanceof PartsListIssue)) throw error;
    return { form, stages: expanded, issue: error.issue };
  }
  return { form, analysis: { ...analysis, derivationStages: expanded } };
};

/**
 * Expands every parts-list analysis of a response. Returns the payload with
 * expanded analyses and the issues of those that could not be expanded, keyed
 * by analysis index; an analysis with an issue keeps its authored form.
 */
export const expandPartsListPayload = (payload) => {
  const multiple = Array.isArray(payload?.analyses);
  const analyses = multiple ? payload.analyses : [payload];
  const issues = [];
  let changed = false;
  const next = analyses.map((analysis, analysisIndex) => {
    const result = expandPartsListAnalysis(analysis, multiple ? `$.analyses[${analysisIndex}]` : '$');
    if (result.form === 'nested') return analysis;
    if (result.issue) {
      issues.push({ analysisIndex, ...result.issue });
      return analysis;
    }
    changed = true;
    return result.analysis;
  });
  if (!changed) return { payload, issues };
  return { payload: multiple ? { ...payload, analyses: next } : next[0], issues };
};
