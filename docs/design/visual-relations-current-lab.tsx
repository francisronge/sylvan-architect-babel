import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TreeVisualizer from '../../components/TreeVisualizer';
import type { SyntaxNode } from '../../types';
import type { LabStage } from './visual-relations-lab-adapter.ts';
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

type LabCase = {
  archetype: string;
  title: string;
  status: string;
  sentence: string;
  data: SyntaxNode;
  derivationStages: LabStage[];
  /** Opt out of the two-column card layout when the tree is genuinely wide. */
  wide?: boolean;
  /** Archive UI copy only; relation meaning comes exclusively from derivationStages. */
  lensLabel?: string;
};

/** Replay auto-advance budgets. Clicks walk frames; waits poll for the control. */
const MAX_REPLAY_CLICKS = 400;
const MAX_REPLAY_WAITS = 150;
const DISABLED_GRACE_POLLS = 6;

const leaf = (
  id: string,
  label: string,
  word?: string,
  extra: Record<string, unknown> = {}
): SyntaxNode => ({
  id,
  label,
  ...(word ? { word } : {}),
  ...extra
});

const node = (
  id: string,
  label: string,
  children: SyntaxNode[],
  extra: Record<string, unknown> = {}
): SyntaxNode => ({
  id,
  label,
  children,
  ...extra
});

const offsetTokenIndices = (tree: SyntaxNode, offset: number): SyntaxNode => ({
  ...tree,
  ...(Number.isInteger(tree.tokenIndex) ? { tokenIndex: Number(tree.tokenIndex) + offset } : {}),
  ...(tree.children
    ? { children: tree.children.map((child) => offsetTokenIndices(child, offset)) }
    : {})
});

// Lexical content lives in `word`, as the authored contract requires; the
// leaf label repeats it so the card keeps its two-level category/terminal shape.
const silentLexicalNode = (
  id: string,
  category: string,
  surface: string,
  extra: Record<string, unknown> = {}
): SyntaxNode => node(id, category, [
  leaf(`${id}__silent`, surface, surface, { silent: true, ...extra })
], { silent: true, ...extra });

const nullHead = (id: string, category: string): SyntaxNode => node(id, category, [
  leaf(`${id}__null`, '∅', undefined, { silent: true })
]);

const stage = (
  _stepId: string,
  statement: string,
  stageRecord: string,
  relations: LabStage['relations'],
  workspace: SyntaxNode | SyntaxNode[]
): LabStage => ({
  statement,
  stageRecord,
  relations,
  workspaceForest: Array.isArray(workspace) ? workspace : [workspace]
});

const cloneSyntaxTree = (tree: SyntaxNode): SyntaxNode => ({
  ...tree,
  ...(tree.children ? { children: tree.children.map(cloneSyntaxTree) } : {})
});

const findSyntaxNode = (tree: SyntaxNode, id: string): SyntaxNode | null => {
  if (tree.id === id) return tree;
  for (const child of tree.children || []) {
    const match = findSyntaxNode(child, id);
    if (match) return match;
  }
  return null;
};

const requiredSyntaxSubtree = (tree: SyntaxNode, id: string): SyntaxNode => {
  const subtree = findSyntaxNode(tree, id);
  if (!subtree) throw new Error(`Missing syntax subtree: ${id}`);
  return cloneSyntaxTree(subtree);
};

const replaceSyntaxNode = (
  tree: SyntaxNode,
  id: string,
  replacement: SyntaxNode
): SyntaxNode => {
  if (tree.id === id) return cloneSyntaxTree(replacement);
  return {
    ...tree,
    ...(tree.children
      ? { children: tree.children.map((child) => replaceSyntaxNode(child, id, replacement)) }
      : {})
  };
};

const removeSyntaxNode = (
  tree: SyntaxNode,
  id: string,
  collapseIds: ReadonlySet<string>
): SyntaxNode | null => {
  if (tree.id === id) return null;
  if (!tree.children) return { ...tree };

  const children = tree.children
    .map((child) => removeSyntaxNode(child, id, collapseIds))
    .filter((child): child is SyntaxNode => child !== null);
  if (collapseIds.has(String(tree.id)) && children.length === 1) return children[0];
  return { ...tree, children };
};

/**
 * Reconstruct the completed state immediately before a single-copy movement.
 * The pronounced occurrence keeps its id while returning to the lower source;
 * the later silent occurrence is introduced only by the movement stage.
 */
const movementBaseTree = (
  finalTree: SyntaxNode,
  pronouncedCopyId: string,
  lowerCopyId: string,
  collapseIds: string[]
): SyntaxNode => {
  const pronouncedCopy = findSyntaxNode(finalTree, pronouncedCopyId);
  if (!pronouncedCopy) throw new Error(`Missing pronounced movement copy: ${pronouncedCopyId}`);
  const withoutLanding = removeSyntaxNode(finalTree, pronouncedCopyId, new Set(collapseIds));
  if (!withoutLanding) throw new Error(`Movement base removed the complete tree: ${pronouncedCopyId}`);
  if (!findSyntaxNode(withoutLanding, lowerCopyId)) {
    throw new Error(`Missing lower movement copy: ${lowerCopyId}`);
  }
  return replaceSyntaxNode(withoutLanding, lowerCopyId, pronouncedCopy);
};

/**
 * Reconstruct a pronounced base occurrence without relocating the landing
 * occurrence's ids into the lower position. Stable lower ids let Replay
 * reserve the later landing topology without duplicating one occurrence.
 */
const movementBaseTreeWithStableLowerIds = (
  finalTree: SyntaxNode,
  pronouncedCopyId: string,
  lowerCopyId: string,
  collapseIds: string[]
): SyntaxNode => {
  const pronouncedCopy = findSyntaxNode(finalTree, pronouncedCopyId);
  const lowerCopy = findSyntaxNode(finalTree, lowerCopyId);
  if (!pronouncedCopy) throw new Error(`Missing pronounced movement copy: ${pronouncedCopyId}`);
  if (!lowerCopy) throw new Error(`Missing lower movement copy: ${lowerCopyId}`);

  if (lowerCopy.label !== pronouncedCopy.label) {
    throw new Error(`Movement copies do not share one category: ${lowerCopyId}`);
  }
  const pronouncedLeafByLineage = new Map<string, SyntaxNode>();
  const collectPronouncedLeaves = (current: SyntaxNode) => {
    const children = current.children || [];
    if (children.length === 0) {
      const lineageId = String(current.lineageId || '').trim();
      if (lineageId) pronouncedLeafByLineage.set(lineageId, current);
      return;
    }
    children.forEach(collectPronouncedLeaves);
  };
  collectPronouncedLeaves(pronouncedCopy);

  const transplantMaterial = (lowerNode: SyntaxNode): SyntaxNode => {
    const lowerChildren = lowerNode.children || [];
    if (lowerChildren.length === 0) {
      const source = pronouncedLeafByLineage.get(String(lowerNode.lineageId || '').trim());
      if (!source) return cloneSyntaxTree(lowerNode);
      const surface = String(source.word || source.label || '').trim();
      // The base occurrence is pronounced, so its lexical content is authored
      // in `word`; the label repeats it to keep the card's terminal shape.
      return {
        ...lowerNode,
        label: surface,
        word: surface,
        ...(source.tokenIndex !== undefined ? { tokenIndex: source.tokenIndex } : {}),
        silent: false
      };
    }

    const children = lowerChildren.map(transplantMaterial);
    const containsOvertLeaf = (current: SyntaxNode): boolean => {
      const currentChildren = current.children || [];
      if (currentChildren.length === 0) return current.silent !== true;
      return currentChildren.some(containsOvertLeaf);
    };
    const next: SyntaxNode = { ...lowerNode, children };
    if (children.some(containsOvertLeaf)) delete next.silent;
    return next;
  };

  const withoutLanding = removeSyntaxNode(finalTree, pronouncedCopyId, new Set(collapseIds));
  if (!withoutLanding) throw new Error(`Movement base removed the complete tree: ${pronouncedCopyId}`);
  return replaceSyntaxNode(
    withoutLanding,
    lowerCopyId,
    transplantMaterial(lowerCopy)
  );
};

const withoutLandingTree = (
  finalTree: SyntaxNode,
  landingId: string,
  collapseIds: string[]
): SyntaxNode => {
  const result = removeSyntaxNode(finalTree, landingId, new Set(collapseIds));
  if (!result) throw new Error(`Landing removal erased the complete tree: ${landingId}`);
  return result;
};

const revealPronouncedDomain = (tree: SyntaxNode, domainId: string): SyntaxNode => {
  const reveal = (current: SyntaxNode): SyntaxNode => {
    const { silent: _silent, ...visible } = current;
    if (!current.children) {
      const remainsSilent = /^(?:∅|\[[^\]]+\]|t(?:[_₀-₉\d]+)?|gap)$/iu.test(
        String(current.word || current.label || '').trim()
      );
      return remainsSilent ? { ...current, silent: true } : visible;
    }
    return { ...visible, children: current.children.map(reveal) };
  };

  const domain = findSyntaxNode(tree, domainId);
  if (!domain) throw new Error(`Missing pronunciation domain: ${domainId}`);
  return replaceSyntaxNode(tree, domainId, reveal(domain));
};

const phrasalMovementTree = node('cp_wh', 'CP', [
  node('dp_which_book_2', 'DP', [
    leaf('d_which_2', 'D', 'Which', { lineageId: 'which-book-d' }),
    node('np_book_2', 'NP', [
      leaf('n_book_2', 'N', 'book', { lineageId: 'which-book-n' })
    ], { lineageId: 'which-book-np' })
  ], { lineageId: 'which-book-chain' }),
  node('cbar_wh', "C'", [
    leaf('c_did', 'C', 'did', { lineageId: 'did-chain' }),
    node('tp_wh', 'TP', [
      node('subj_john', 'DP', [
      node('subj_john_np', 'NP', [
        leaf('subj_john_n', 'N', 'John')
      ])
    ]),
      node('tbar_wh', "T'", [
        nullHead('t_did_wh', 'T'),
        node('vp_wh', 'VP', [
          leaf('v_buy', 'V', 'buy'),
          node('dp_which_book_1', 'DP', [
            leaf('d_which_1', 'D', 't₁', { lineageId: 'which-book-d', silent: true }),
            node('np_book_1', 'NP', [
              leaf('n_book_1', 'N', 't₁', { lineageId: 'which-book-n', silent: true })
            ], { lineageId: 'which-book-np' })
          ], { lineageId: 'which-book-chain' })
        ])
      ])
    ])
  ])
]);

const phrasalMovementBaseTree = node('cbar_wh', "C'", [
  leaf('c_did', 'C', 'did', { lineageId: 'did-chain' }),
  node('tp_wh', 'TP', [
    node('subj_john', 'DP', [
    node('subj_john_np', 'NP', [
      leaf('subj_john_n', 'N', 'John')
    ])
    ]),
    node('tbar_wh', "T'", [
      nullHead('t_did_wh', 'T'),
      node('vp_wh', 'VP', [
        leaf('v_buy', 'V', 'buy'),
        node('dp_which_book_1', 'DP', [
          leaf('d_which_1', 'D', 'Which', { lineageId: 'which-book-d' }),
          node('np_book_1', 'NP', [
            leaf('n_book_1', 'N', 'book', { lineageId: 'which-book-n' })
          ], { lineageId: 'which-book-np' })
        ], { lineageId: 'which-book-chain' })
      ])
    ])
  ])
]);

const headMovementTree = node('cp_head', 'CP', [
  leaf('c_head_did', 'C', 'Did', { lineageId: 'did-chain' }),
  node('tp_head', 'TP', [
    node('subj_noa', 'DP', [
      node('subj_noa_np', 'NP', [
        leaf('subj_noa_n', 'N', 'Noa')
      ])
    ]),
    node('tbar_head', "T'", [
      leaf('t_head_trace', 'T', 't_1', { lineageId: 'did-chain', silent: true }),
      node('vp_head', 'VP', [
        leaf('v_leave', 'V', 'leave')
      ])
    ])
  ])
]);

const headMovementBaseTree = node('cp_head', 'CP', [
  leaf('c_head_did', 'C', '∅', { silent: true }),
  node('tp_head', 'TP', [
    node('subj_noa', 'DP', [
      node('subj_noa_np', 'NP', [
        leaf('subj_noa_n', 'N', 'Noa')
      ])
    ]),
    node('tbar_head', "T'", [
      leaf('t_head_trace', 'T', 'did', { lineageId: 'did-chain' }),
      node('vp_head', 'VP', [
        leaf('v_leave', 'V', 'leave')
      ])
    ])
  ])
]);

/*
 * Lowering with complete displacement witnesses, per the Glossa source's
 * before/after states. The base tree holds the affix at its higher T origin;
 * the lowered tree keeps a silent occurrence at that origin and realizes the
 * affix inside a derived complex V head. The affix chain alone shares a
 * lineageId — the host verb is a different lexical object and never joins it.
 */
const loweringBaseTree = node('tp_lowering', 'TP', [
  node('subj_mia_lowering', 'DP', [
      node('subj_mia_lowering_np', 'NP', [
        leaf('subj_mia_lowering_n', 'N', 'Mia')
      ])
    ]),
  node('tbar_lowering', "T'", [
    leaf('t_affix', 'T', '-ed', { lineageId: 'lowering-affix' }),
    node('vp_lowering', 'VP', [
      leaf('v_laugh', 'V', 'laugh')
    ])
  ])
]);

const loweringTree = node('tp_lowering', 'TP', [
  node('subj_mia_lowering', 'DP', [
      node('subj_mia_lowering_np', 'NP', [
        leaf('subj_mia_lowering_n', 'N', 'Mia')
      ])
    ]),
  node('tbar_lowering', "T'", [
    leaf('t_affix', 'T', 't₁', { silent: true, lineageId: 'lowering-affix' }),
    node('vp_lowering', 'VP', [
      node('v_laugh_complex', 'V', [
        leaf('v_laugh', 'V', 'laugh'),
        leaf('t_affix_low', 'T', '-ed', { lineageId: 'lowering-affix' })
      ])
    ])
  ])
]);

const identityTree = node('cp_identity', 'CP', [
  node('dp_book_high', 'DP', [
    leaf('d_which_book_high', 'D', 'Which', { lineageId: 'book-d', tokenIndex: 0 }),
    node('np_book_high', 'NP', [
      leaf('n_book_high', 'N', 'book', { lineageId: 'book-n', tokenIndex: 1 })
    ], { lineageId: 'book-np' })
  ], { lineageId: 'book-chain' }),
  node('cbar_identity', "C'", [
    leaf('c_identity_did', 'C', 'did', { lineageId: 'did-chain', tokenIndex: 2 }),
    node('tp_identity', 'TP', [
      node('subj_mia_identity', 'DP', [
      node('subj_mia_identity_np', 'NP', [
        leaf('subj_mia_identity_n', 'N', 'Mia', { tokenIndex: 3 })
      ])
    ]),
      node('tbar_identity', "T'", [
        leaf('t_identity_did_trace', 'T', 't_2', { lineageId: 'did-chain', silent: true }),
        node('vp_say_identity', 'VP', [
          leaf('v_say_identity', 'V', 'say', { tokenIndex: 4 }),
          node('cp_embedded_identity', 'CP', [
            node('dp_book_edge_gap', 'DP', [
              leaf('d_book_edge_trace', 'D', 't_1', { lineageId: 'book-d', silent: true }),
              node('np_book_edge_trace', 'NP', [
                leaf('n_book_edge_trace', 'N', 't_1', { lineageId: 'book-n', silent: true })
              ], { lineageId: 'book-np' })
            ], { lineageId: 'book-chain' }),
            node('cbar_embedded_identity', "C'", [
              leaf('c_that_identity', 'C', 'that', { tokenIndex: 5 }),
              node('tp_embedded_identity', 'TP', [
                node('subj_noa_identity', 'DP', [
      node('subj_noa_identity_np', 'NP', [
        leaf('subj_noa_identity_n', 'N', 'Noa', { tokenIndex: 6 })
      ])
    ]),
                node('vp_file_identity', 'VP', [
                  leaf('v_filed_identity', 'V', 'filed', { tokenIndex: 7 }),
                  node('dp_book_file_gap', 'DP', [
                    leaf('d_book_file_trace', 'D', 't_1', { lineageId: 'book-d', silent: true }),
                    node('np_book_file_trace', 'NP', [
                      leaf('n_book_file_trace', 'N', 't_1', { lineageId: 'book-n', silent: true })
                    ], { lineageId: 'book-np' })
                  ], { lineageId: 'book-chain' })
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

/*
 * Identity-chain Replay is genuinely derivational. The embedded clause is
 * complete before the first A-bar step; the matrix clause is then assembled
 * around that landed occurrence, head movement applies, and only then does the
 * wh-DP move to matrix Spec,CP. These card-specific builders keep every
 * occurrence structurally complete without changing the accepted final tree.
 */
const identityBaseObject = (pronounced: boolean, tokenOffset = 0) => node('dp_book_file_gap', 'DP', [
  leaf('d_book_file_trace', 'D', pronounced ? 'Which' : 't_1', {
    lineageId: 'book-d',
    silent: !pronounced,
    ...(pronounced ? { tokenIndex: tokenOffset } : {})
  }),
  node('np_book_file_trace', 'NP', [
    leaf('n_book_file_trace', 'N', pronounced ? 'book' : 't_1', {
      lineageId: 'book-n',
      silent: !pronounced,
      ...(pronounced ? { tokenIndex: tokenOffset + 1 } : {})
    })
  ], { lineageId: 'book-np' })
], { lineageId: 'book-chain' });

const identityEdgeObject = (pronounced: boolean, tokenOffset = 0) => node('dp_book_edge_gap', 'DP', [
  leaf('d_book_edge_trace', 'D', pronounced ? 'Which' : 't_1', {
    lineageId: 'book-d',
    silent: !pronounced,
    ...(pronounced ? { tokenIndex: tokenOffset } : {})
  }),
  node('np_book_edge_trace', 'NP', [
    leaf('n_book_edge_trace', 'N', pronounced ? 'book' : 't_1', {
      lineageId: 'book-n',
      silent: !pronounced,
      ...(pronounced ? { tokenIndex: tokenOffset + 1 } : {})
    })
  ], { lineageId: 'book-np' })
], { lineageId: 'book-chain' });

const identityEmbeddedCbar = (basePronounced: boolean, tokenOffset = 0) => node('cbar_embedded_identity', "C'", [
  leaf('c_that_identity', 'C', 'that', { tokenIndex: tokenOffset }),
  node('tp_embedded_identity', 'TP', [
    node('subj_noa_identity', 'DP', [
      node('subj_noa_identity_np', 'NP', [
        leaf('subj_noa_identity_n', 'N', 'Noa', { tokenIndex: tokenOffset + 1 })
      ])
    ]),
    node('vp_file_identity', 'VP', [
      leaf('v_filed_identity', 'V', 'filed', { tokenIndex: tokenOffset + 2 }),
      identityBaseObject(basePronounced, tokenOffset + 3)
    ])
  ])
]);

const identityEmbeddedBaseTree = identityEmbeddedCbar(true);

const identityEmbeddedEdgeTree = (edgePronounced: boolean, tokenOffset = 0) => node('cp_embedded_identity', 'CP', [
  identityEdgeObject(edgePronounced, tokenOffset),
  identityEmbeddedCbar(false, tokenOffset + (edgePronounced ? 2 : 0))
]);

const identityMatrixCbar = (headMoved: boolean) => node('cbar_identity', "C'", [
  headMoved
    ? leaf('c_identity_did', 'C', 'did', { lineageId: 'did-chain', tokenIndex: 0 })
    : leaf('c_identity_did', 'C', '∅', { silent: true }),
  node('tp_identity', 'TP', [
    node('subj_mia_identity', 'DP', [
      node('subj_mia_identity_np', 'NP', [
        leaf('subj_mia_identity_n', 'N', 'Mia', { tokenIndex: headMoved ? 1 : 0 })
      ])
    ]),
    node('tbar_identity', "T'", [
      headMoved
        ? leaf('t_identity_did_trace', 'T', 't_2', { lineageId: 'did-chain', silent: true })
        : leaf('t_identity_did_trace', 'T', 'did', { lineageId: 'did-chain', tokenIndex: 1 }),
      node('vp_say_identity', 'VP', [
        leaf('v_say_identity', 'V', 'say', { tokenIndex: 2 }),
        identityEmbeddedEdgeTree(true, 3)
      ])
    ])
  ])
]);

const identityMatrixBaseTree = identityMatrixCbar(false);
const identityHeadMovedTree = identityMatrixCbar(true);

const fourOccurrenceIdentityLowCbarTree = node('cbar_chain4_low', "C'", [
  leaf('c_that_chain4_low', 'C', 'that', { tokenIndex: 0 }),
  node('tp_chain4_low', 'TP', [
    node('dp_ava_chain4', 'DP', [
      node('np_ava_chain4', 'NP', [
        leaf('n_ava_chain4', 'N', 'Ava', { tokenIndex: 1 })
      ])
    ]),
    node('tbar_chain4_low', "T'", [
      silentLexicalNode('t_past_chain4_low', 'T', '[past]'),
      node('vp_file_chain4', 'VP', [
        leaf('v_filed_chain4', 'V', 'filed', { tokenIndex: 2 }),
        node('dp_chain4_base', 'DP', [
          leaf('d_chain4_base', 'D', 'Which', {
            lineageId: 'chain4-book-d',
            tokenIndex: 3
          }),
          node('np_chain4_base', 'NP', [
            leaf('n_chain4_base', 'N', 'book', {
              lineageId: 'chain4-book-n',
              tokenIndex: 4
            })
          ], { lineageId: 'chain4-book-np' })
        ], { lineageId: 'chain4-book' })
      ])
    ])
  ])
]);

const fourOccurrenceIdentityLowEdgeTree = node('cp_chain4_low', 'CP', [
  node('dp_chain4_edge_low', 'DP', [
    leaf('d_chain4_edge_low', 'D', 'Which', {
      lineageId: 'chain4-book-d',
      tokenIndex: 0
    }),
    node('np_chain4_edge_low', 'NP', [
      leaf('n_chain4_edge_low', 'N', 'book', {
        lineageId: 'chain4-book-n',
        tokenIndex: 1
      })
    ], { lineageId: 'chain4-book-np' })
  ], { lineageId: 'chain4-book' }),
  node('cbar_chain4_low', "C'", [
    leaf('c_that_chain4_low', 'C', 'that', { tokenIndex: 2 }),
    node('tp_chain4_low', 'TP', [
      node('dp_ava_chain4', 'DP', [
        node('np_ava_chain4', 'NP', [
          leaf('n_ava_chain4', 'N', 'Ava', { tokenIndex: 3 })
        ])
      ]),
      node('tbar_chain4_low', "T'", [
        silentLexicalNode('t_past_chain4_low', 'T', '[past]'),
        node('vp_file_chain4', 'VP', [
          leaf('v_filed_chain4', 'V', 'filed', { tokenIndex: 4 }),
          node('dp_chain4_base', 'DP', [
            leaf('d_chain4_base', 'D', 't_1', {
              lineageId: 'chain4-book-d',
              silent: true
            }),
            node('np_chain4_base', 'NP', [
              leaf('n_chain4_base', 'N', 't_1', {
                lineageId: 'chain4-book-n',
                silent: true
              })
            ], { silent: true, lineageId: 'chain4-book-np' })
          ], { silent: true, lineageId: 'chain4-book' })
        ])
      ])
    ])
  ])
]);

const fourOccurrenceIdentityMidCbarTree = node('cbar_chain4_mid', "C'", [
  leaf('c_that_chain4_mid', 'C', 'that', { tokenIndex: 0 }),
  node('tp_chain4_mid', 'TP', [
    node('dp_noa_chain4', 'DP', [
      node('np_noa_chain4', 'NP', [
        leaf('n_noa_chain4', 'N', 'Noa', { tokenIndex: 1 })
      ])
    ]),
    node('tbar_chain4_mid', "T'", [
      silentLexicalNode('t_past_chain4_mid', 'T', '[past]'),
      node('vp_claim_chain4', 'VP', [
        leaf('v_claimed_chain4', 'V', 'claimed', { tokenIndex: 2 }),
        offsetTokenIndices(fourOccurrenceIdentityLowEdgeTree, 3)
      ])
    ])
  ])
]);

const fourOccurrenceIdentityMidEdgeTree = node('cp_chain4_mid', 'CP', [
  node('dp_chain4_edge_mid', 'DP', [
    leaf('d_chain4_edge_mid', 'D', 'Which', {
      lineageId: 'chain4-book-d',
      tokenIndex: 0
    }),
    node('np_chain4_edge_mid', 'NP', [
      leaf('n_chain4_edge_mid', 'N', 'book', {
        lineageId: 'chain4-book-n',
        tokenIndex: 1
      })
    ], { lineageId: 'chain4-book-np' })
  ], { lineageId: 'chain4-book' }),
  node('cbar_chain4_mid', "C'", [
    leaf('c_that_chain4_mid', 'C', 'that', { tokenIndex: 2 }),
    node('tp_chain4_mid', 'TP', [
      node('dp_noa_chain4', 'DP', [
        node('np_noa_chain4', 'NP', [
          leaf('n_noa_chain4', 'N', 'Noa', { tokenIndex: 3 })
        ])
      ]),
      node('tbar_chain4_mid', "T'", [
        silentLexicalNode('t_past_chain4_mid', 'T', '[past]'),
        node('vp_claim_chain4', 'VP', [
          leaf('v_claimed_chain4', 'V', 'claimed', { tokenIndex: 4 }),
          node('cp_chain4_low', 'CP', [
            node('dp_chain4_edge_low', 'DP', [
              leaf('d_chain4_edge_low', 'D', 't_1', {
                lineageId: 'chain4-book-d',
                silent: true
              }),
              node('np_chain4_edge_low', 'NP', [
                leaf('n_chain4_edge_low', 'N', 't_1', {
                  lineageId: 'chain4-book-n',
                  silent: true
                })
              ], { silent: true, lineageId: 'chain4-book-np' })
            ], { silent: true, lineageId: 'chain4-book' }),
            node('cbar_chain4_low', "C'", [
              leaf('c_that_chain4_low', 'C', 'that', { tokenIndex: 5 }),
              node('tp_chain4_low', 'TP', [
                node('dp_ava_chain4', 'DP', [
                  node('np_ava_chain4', 'NP', [
                    leaf('n_ava_chain4', 'N', 'Ava', { tokenIndex: 6 })
                  ])
                ]),
                node('tbar_chain4_low', "T'", [
                  silentLexicalNode('t_past_chain4_low', 'T', '[past]'),
                  node('vp_file_chain4', 'VP', [
                    leaf('v_filed_chain4', 'V', 'filed', { tokenIndex: 7 }),
                    node('dp_chain4_base', 'DP', [
                      leaf('d_chain4_base', 'D', 't_1', {
                        lineageId: 'chain4-book-d',
                        silent: true
                      }),
                      node('np_chain4_base', 'NP', [
                        leaf('n_chain4_base', 'N', 't_1', {
                          lineageId: 'chain4-book-n',
                          silent: true
                        })
                      ], { silent: true, lineageId: 'chain4-book-np' })
                    ], { silent: true, lineageId: 'chain4-book' })
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

const fourOccurrenceIdentityMatrixCbarTree = node('cbar_chain4_matrix', "C'", [
  leaf('c_did_chain4', 'C', 'did', { tokenIndex: 0 }),
  node('tp_chain4_matrix', 'TP', [
    node('dp_mia_chain4', 'DP', [
      node('np_mia_chain4', 'NP', [
        leaf('n_mia_chain4', 'N', 'Mia', { tokenIndex: 1 })
      ])
    ]),
    node('tbar_chain4_matrix', "T'", [
      nullHead('t_chain4_matrix', 'T'),
      node('vp_say_chain4', 'VP', [
        leaf('v_say_chain4', 'V', 'say', { tokenIndex: 2 }),
        offsetTokenIndices(fourOccurrenceIdentityMidEdgeTree, 3)
      ])
    ])
  ])
]);

const fourOccurrenceIdentityTree = node('cp_chain4_matrix', 'CP', [
  node('dp_chain4_high', 'DP', [
    leaf('d_chain4_high', 'D', 'Which', {
      lineageId: 'chain4-book-d',
      tokenIndex: 0
    }),
    node('np_chain4_high', 'NP', [
      leaf('n_chain4_high', 'N', 'book', {
        lineageId: 'chain4-book-n',
        tokenIndex: 1
      })
    ], { lineageId: 'chain4-book-np' })
  ], { lineageId: 'chain4-book' }),
  node('cbar_chain4_matrix', "C'", [
    leaf('c_did_chain4', 'C', 'did', { tokenIndex: 2 }),
    node('tp_chain4_matrix', 'TP', [
      node('dp_mia_chain4', 'DP', [
        node('np_mia_chain4', 'NP', [
          leaf('n_mia_chain4', 'N', 'Mia', { tokenIndex: 3 })
        ])
      ]),
      node('tbar_chain4_matrix', "T'", [
        nullHead('t_chain4_matrix', 'T'),
        node('vp_say_chain4', 'VP', [
          leaf('v_say_chain4', 'V', 'say', { tokenIndex: 4 }),
          node('cp_chain4_mid', 'CP', [
            node('dp_chain4_edge_mid', 'DP', [
              leaf('d_chain4_edge_mid', 'D', 't_1', {
                lineageId: 'chain4-book-d',
                silent: true
              }),
              node('np_chain4_edge_mid', 'NP', [
                leaf('n_chain4_edge_mid', 'N', 't_1', {
                  lineageId: 'chain4-book-n',
                  silent: true
                })
              ], { silent: true, lineageId: 'chain4-book-np' })
            ], { silent: true, lineageId: 'chain4-book' }),
            node('cbar_chain4_mid', "C'", [
              leaf('c_that_chain4_mid', 'C', 'that', { tokenIndex: 5 }),
              node('tp_chain4_mid', 'TP', [
                node('dp_noa_chain4', 'DP', [
                  node('np_noa_chain4', 'NP', [
                    leaf('n_noa_chain4', 'N', 'Noa', { tokenIndex: 6 })
                  ])
                ]),
                node('tbar_chain4_mid', "T'", [
                  silentLexicalNode('t_past_chain4_mid', 'T', '[past]'),
                  node('vp_claim_chain4', 'VP', [
                    leaf('v_claimed_chain4', 'V', 'claimed', { tokenIndex: 7 }),
                    node('cp_chain4_low', 'CP', [
                      node('dp_chain4_edge_low', 'DP', [
                        leaf('d_chain4_edge_low', 'D', 't_1', {
                          lineageId: 'chain4-book-d',
                          silent: true
                        }),
                        node('np_chain4_edge_low', 'NP', [
                          leaf('n_chain4_edge_low', 'N', 't_1', {
                            lineageId: 'chain4-book-n',
                            silent: true
                          })
                        ], { silent: true, lineageId: 'chain4-book-np' })
                      ], { silent: true, lineageId: 'chain4-book' }),
                      node('cbar_chain4_low', "C'", [
                        leaf('c_that_chain4_low', 'C', 'that', { tokenIndex: 8 }),
                        node('tp_chain4_low', 'TP', [
                          node('dp_ava_chain4', 'DP', [
                            node('np_ava_chain4', 'NP', [
                              leaf('n_ava_chain4', 'N', 'Ava', { tokenIndex: 9 })
                            ])
                          ]),
                          node('tbar_chain4_low', "T'", [
                            silentLexicalNode('t_past_chain4_low', 'T', '[past]'),
                            node('vp_file_chain4', 'VP', [
                              leaf('v_filed_chain4', 'V', 'filed', { tokenIndex: 10 }),
                              node('dp_chain4_base', 'DP', [
                                leaf('d_chain4_base', 'D', 't_1', {
                                  lineageId: 'chain4-book-d',
                                  silent: true
                                }),
                                node('np_chain4_base', 'NP', [
                                  leaf('n_chain4_base', 'N', 't_1', {
                                    lineageId: 'chain4-book-n',
                                    silent: true
                                  })
                                ], { silent: true, lineageId: 'chain4-book-np' })
                              ], { silent: true, lineageId: 'chain4-book' })
                            ])
                          ])
                        ])
                      ])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

const controlTree = node('tp_control', 'TP', [
  node('john_dp', 'DP', [
      node('john_dp_np', 'NP', [
        leaf('john_dp_n', 'N', 'John', { tokenIndex: 0 })
      ])
    ], { lineageId: 'john' }),
  node('tbar_control', "T'", [
    nullHead('t_control', 'T'),
    node('vp_control', 'VP', [
      leaf('v_promised', 'V', 'promised', { tokenIndex: 1 }),
      node('tp_inf', 'TP', [
        silentLexicalNode('pro_subject', 'DP', 'PRO', { lineageId: 'john' }),
        node('tbar_inf', "T'", [
          leaf('t_inf_to', 'T', 'to', { tokenIndex: 2 }),
          node('vp_inf', 'VP', [
            leaf('v_leave_inf', 'V', 'leave', { tokenIndex: 3 })
          ])
        ])
      ])
    ])
  ])
]);

/** Primary predication: one subject predicand and one verbal predicate. */
const primaryPredicationTree = node('tp_predication_primary', 'TP', [
  node('dp_mia_predication_primary', 'DP', [
    node('np_mia_predication_primary', 'NP', [
      leaf('n_mia_predication_primary', 'N', 'Mia', { tokenIndex: 0 })
    ])
  ]),
  node('tbar_predication_primary', "T'", [
    silentLexicalNode('t_past_predication_primary', 'T', '[past]'),
    node('vp_predication_primary', 'VP', [
      leaf('v_laughed_predication_primary', 'V', 'laughed', { tokenIndex: 1 })
    ])
  ])
]);

/**
 * Resultative secondary predication. `Mia` is the understood subject of both
 * the event predicate and the resulting-state predicate, so one predicand
 * genuinely needs two links.
 */
const resultativePredicationTree = node('tp_predication_resultative', 'TP', [
  node('dp_mia_predication_resultative', 'DP', [
    node('np_mia_predication_resultative', 'NP', [
      leaf('n_mia_predication_resultative', 'N', 'Mia', { tokenIndex: 0 })
    ])
  ]),
  node('tbar_predication_resultative', "T'", [
    silentLexicalNode('t_past_predication_resultative', 'T', '[past]'),
    node('vp_predication_resultative', 'VP', [
      leaf('v_froze_predication_resultative', 'V', 'froze', { tokenIndex: 1 }),
      node('ap_solid_predication_resultative', 'AP', [
        leaf('a_solid_predication_resultative', 'A', 'solid', { tokenIndex: 2 })
      ])
    ])
  ])
]);

const bindingTree = node('vp_binding', 'VP', [
  node('john_binding', 'DP', [
      node('john_binding_np', 'NP', [
        leaf('john_binding_n', 'N', 'John')
      ])
    ], { lineageId: 'john-binding' }),
  node('vbar_binding', "V'", [
    leaf('v_saw_binding', 'V', 'saw'),
    node('himself_binding', 'DP', [
      leaf('himself_binding_d', 'D', 'himself')
    ], { lineageId: 'john-binding' })
  ])
]);

/*
 * The possessive DP is fully headed: the possessor DP sits in Spec,DP and a
 * silent possessive D heads the D' that dominates the NP. The circled domain
 * is the possessor's c-commanded sister — the same domain convention as the
 * licensed card — and the anaphor falls outside it, which is the failure.
 */
const bindingBlockedTree = node('vp_binding_blocked', 'VP', [
  node('dp_johns_mother_binding', 'DP', [
    node('dp_john_possessor_binding', 'DP', [
      leaf('dp_john_possessor_binding_d', 'D', "John's")
    ], { lineageId: 'john-binding-blocked' }),
    node('dbar_johns_mother_binding', "D'", [
      nullHead('d_poss_binding', 'D'),
      node('np_mother_binding', 'NP', [
        leaf('n_mother_binding', 'N', 'mother')
      ])
    ])
  ]),
  node('vbar_binding_blocked', "V'", [
    leaf('v_saw_binding_blocked', 'V', 'saw'),
    node('himself_binding_blocked', 'DP', [
      leaf('himself_binding_blocked_d', 'D', 'himself')
    ], { lineageId: 'john-binding-blocked' })
  ])
]);

const coreferenceTree = node('tp_coreference', 'TP', [
  node('john_coref', 'DP', [
      node('john_coref_np', 'NP', [
        leaf('john_coref_n', 'N', 'John', { tokenIndex: 0 })
      ])
    ], { lineageId: 'john-coref' }),
  node('tbar_coreference', "T'", [
    silentLexicalNode('t_past_coref', 'T', '[past]'),
    node('vp_say_coref', 'VP', [
      leaf('v_said_coref', 'V', 'said', { tokenIndex: 1 }),
      node('cp_coref_embedded', 'CP', [
        nullHead('c_null_coref', 'C'),
        node('tp_coref_embedded', 'TP', [
          node('he_coref', 'DP', [
      leaf('he_coref_d', 'D', 'he', { tokenIndex: 2 })
    ], { lineageId: 'john-coref' }),
          node('tbar_coref_embedded', "T'", [
            silentLexicalNode('t_past_embedded_coref', 'T', '[past]'),
            node('vp_left_coref', 'VP', [
              leaf('v_left_coref', 'V', 'left', { tokenIndex: 3 })
            ])
          ])
        ])
      ])
    ])
  ])
]);

const agreeTree = node('tp_agree', 'TP', [
  silentLexicalNode('t_phi_probe', 'T', '[uφ]'),
  node('vp_agree', 'vP', [
    node('girls_goal', 'DP', [
      leaf('d_girls', 'D', 'The'),
      node('np_girls', 'NP', [
        leaf('n_girls', 'N', 'girls')
      ])
    ], { case: 'Nom', caseOvert: true }),
    node('vbar_agree', "v'", [
      leaf('v_arrive', 'v', 'arrive')
    ])
  ])
]);

/**
 * Nevins-style Multiple Agree: one T probe relates simultaneously to the
 * subject and object DPs. The English words are a readable host for the source
 * topology, not a claim that English spells out this agreement pattern.
 */
const multipleAgreeTree = node('tp_multiple_agree', 'TP', [
  silentLexicalNode('t_probe_multiple_agree', 'T', '[uφ]'),
  node('vp_multiple_agree', 'vP', [
    node('dp_subject_multiple_agree', 'DP', [
      leaf('d_we_multiple_agree', 'D', 'We', { tokenIndex: 0 })
    ]),
    node('vbar_multiple_agree', "v'", [
      leaf('v_see_multiple_agree', 'V', 'see', { tokenIndex: 1 }),
      node('dp_object_multiple_agree', 'DP', [
        leaf('d_you_multiple_agree', 'D', 'you', { tokenIndex: 2 })
      ])
    ])
  ])
]);

/** The same Multiple Agree topology one clause down. */
const embeddedMultipleAgreeTree = node('cp_multiple_agree_embedded', 'CP', [
  leaf('c_that_multiple_agree_embedded', 'C', 'that', { tokenIndex: 0 }),
  node('tp_multiple_agree_embedded', 'TP', [
    silentLexicalNode('t_probe_multiple_agree_embedded', 'T', '[uφ]'),
    node('vp_multiple_agree_embedded', 'vP', [
      node('dp_subject_multiple_agree_embedded', 'DP', [
        leaf('d_we_multiple_agree_embedded', 'D', 'we', { tokenIndex: 1 })
      ]),
      node('vbar_multiple_agree_embedded', "v'", [
        leaf('v_see_multiple_agree_embedded', 'V', 'see', { tokenIndex: 2 }),
        node('dp_object_multiple_agree_embedded', 'DP', [
          leaf('d_you_multiple_agree_embedded', 'D', 'you', { tokenIndex: 3 })
        ])
      ])
    ])
  ])
]);

/**
 * Keine and Dash's two search cycles. Cycle 1 searches the complement before
 * the external argument exists; cycle 2 becomes available only after that DP
 * is merged in the specifier.
 */
const cyclicAgreeFirstCycleTree = node('vbar_cyclic_agree', "v'", [
  silentLexicalNode('v_probe_cyclic_agree', 'v', '[uφ]'),
  node('vp_domain_cyclic_agree', 'VP', [
    leaf('v_see_cyclic_agree', 'V', 'saw', { tokenIndex: 0 }),
    node('dp_internal_cyclic_agree', 'DP', [
      leaf('d_noa_internal_cyclic_agree', 'D', 'Noa', { tokenIndex: 1 })
    ])
  ])
]);

const cyclicAgreeSecondCycleTree = node('vp_cyclic_agree', 'vP', [
  node('dp_goal_cyclic_agree', 'DP', [
    leaf('d_mia_cyclic_agree', 'D', 'Mia', { tokenIndex: 0 })
  ]),
  node('vbar_cyclic_agree', "v'", [
    silentLexicalNode('v_probe_cyclic_agree', 'v', '[uφ]'),
    node('vp_domain_cyclic_agree', 'VP', [
      leaf('v_see_cyclic_agree', 'V', 'saw', { tokenIndex: 1 }),
      node('dp_internal_cyclic_agree', 'DP', [
        leaf('d_noa_internal_cyclic_agree', 'D', 'Noa', { tokenIndex: 2 })
      ])
    ])
  ])
]);

/** A second Cyclic Agree context that is later embedded under an overt C. */
const embeddedCyclicAgreeFirstCycleTree = node('vbar_cyclic_agree_embedded', "v'", [
  silentLexicalNode('v_probe_cyclic_agree_embedded', 'v', '[uφ]'),
  node('vp_domain_cyclic_agree_embedded', 'VP', [
    leaf('v_see_cyclic_agree_embedded', 'V', 'saw', { tokenIndex: 0 }),
    node('dp_internal_cyclic_agree_embedded', 'DP', [
      leaf('d_noa_internal_cyclic_agree_embedded', 'D', 'Noa', { tokenIndex: 1 })
    ])
  ])
]);

const embeddedCyclicAgreeSecondCycleTree = node('vp_cyclic_agree_embedded', 'vP', [
  node('dp_goal_cyclic_agree_embedded', 'DP', [
    leaf('d_mia_cyclic_agree_embedded', 'D', 'Mia', { tokenIndex: 0 })
  ]),
  node('vbar_cyclic_agree_embedded', "v'", [
    silentLexicalNode('v_probe_cyclic_agree_embedded', 'v', '[uφ]'),
    node('vp_domain_cyclic_agree_embedded', 'VP', [
      leaf('v_see_cyclic_agree_embedded', 'V', 'saw', { tokenIndex: 1 }),
      node('dp_internal_cyclic_agree_embedded', 'DP', [
        leaf('d_noa_internal_cyclic_agree_embedded', 'D', 'Noa', { tokenIndex: 2 })
      ])
    ])
  ])
]);

const embeddedCyclicAgreeFinalTree = node('cp_cyclic_agree_embedded', 'CP', [
  leaf('c_that_cyclic_agree_embedded', 'C', 'that', { tokenIndex: 0 }),
  offsetTokenIndices(embeddedCyclicAgreeSecondCycleTree, 1)
]);

/**
 * An ordinary Babel DP hosts Keine's relation convention. The source's empty
 * feature brackets are not copied into the tree; the overlay connects the
 * actual terminal bearers to one shared Case plaque.
 */
const featureSharingTree = node('dp_feature_sharing', 'DP', [
  leaf('d_feature_sharing', 'D', 'The', { tokenIndex: 0 }),
  node('nump_feature_sharing', 'NumP', [
    leaf('num_feature_sharing', 'Num', 'three', { tokenIndex: 1 }),
    node('np_feature_sharing', 'NP', [
      node('ap_feature_sharing', 'AP', [
        leaf('a_feature_sharing', 'A', 'red', { tokenIndex: 2 })
      ]),
      node('np_lower_feature_sharing', 'NP', [
        leaf('n_feature_sharing', 'N', 'books', { tokenIndex: 3 })
      ])
    ])
  ])
]);

/** The same shared-feature token with three bearers inside a selected DP. */
const selectedFeatureSharingTree = node('pp_feature_sharing_selected', 'PP', [
  leaf('p_with_feature_sharing_selected', 'P', 'with', { tokenIndex: 0 }),
  node('dp_feature_sharing_selected', 'DP', [
    leaf('d_feature_sharing_selected', 'D', 'the', { tokenIndex: 1 }),
    node('nump_feature_sharing_selected', 'NumP', [
      leaf('num_feature_sharing_selected', 'Num', 'two', { tokenIndex: 2 }),
      node('np_feature_sharing_selected', 'NP', [
        leaf('n_feature_sharing_selected', 'N', 'books', { tokenIndex: 3 })
      ])
    ])
  ])
]);

/**
 * Norris's nominal-domain relation: P assigns Case to K, while dotted Agree
 * paths collect number and gender onto the same K feature plaque.
 */
const caseAssignmentTree = node('pp_case_assignment', 'PP', [
  leaf('p_case_assignment', 'P', 'Af', { tokenIndex: 0 }),
  node('kp_case_assignment', 'KP', [
    nullHead('k_case_assignment', 'K'),
    node('dp_case_assignment', 'DP', [
      nullHead('d_case_assignment', 'D'),
      node('nump_case_assignment', 'NumP', [
        silentLexicalNode('num_case_assignment', 'Num', '[PL]'),
        node('np_case_assignment', 'NP', [
          silentLexicalNode('n_gender_case_assignment', 'n(P)', '[MASC]'),
          leaf('n_hestum_case_assignment', '√HEST', 'hestum', { tokenIndex: 1 })
        ])
      ])
    ])
  ])
]);

/** A second Norris-style Case/collection configuration inside a verbal domain. */
const embeddedCaseAssignmentTree = node('vp_case_assignment_embedded', 'VP', [
  leaf('v_spoke_case_assignment_embedded', 'V', 'spoke', { tokenIndex: 0 }),
  node('pp_case_assignment_embedded', 'PP', [
    leaf('p_med_case_assignment_embedded', 'P', 'með', { tokenIndex: 1 }),
    node('kp_case_assignment_embedded', 'KP', [
      nullHead('k_case_assignment_embedded', 'K'),
      node('dp_case_assignment_embedded', 'DP', [
        nullHead('d_case_assignment_embedded', 'D'),
        node('nump_case_assignment_embedded', 'NumP', [
          silentLexicalNode('num_case_assignment_embedded', 'Num', '[PL]'),
          node('np_case_assignment_embedded', 'NP', [
            silentLexicalNode('n_gender_case_assignment_embedded', 'n(P)', '[MASC]'),
            leaf('n_vinum_case_assignment_embedded', '√VIN', 'vinum', { tokenIndex: 2 })
          ])
        ])
      ])
    ])
  ])
]);

/** Low dependent Case: the higher DP unlocks a probe that values the lower DP. */
const lowDependentCaseTree = node('tp_low_dependent_case', 'TP', [
  silentLexicalNode('t_probe_low_dependent_case', 'T', '[uφ]'),
  node('vp_low_dependent_case', 'vP', [
    node('dp_high_low_dependent_case', 'DP', [
      leaf('d_aya_low_dependent_case', 'D', 'Aya', { tokenIndex: 0 })
    ]),
    node('vbar_low_dependent_case', "v'", [
      silentLexicalNode('v_low_dependent_case', 'v', '[v]'),
      node('vp_domain_low_dependent_case', 'VP', [
        leaf('v_saw_low_dependent_case', 'V', 'saw', { tokenIndex: 1 }),
        node('dp_low_low_dependent_case', 'DP', [
          leaf('d_noa_low_dependent_case', 'D', 'Noa', { tokenIndex: 2 })
        ])
      ])
    ])
  ])
]);

/** High dependent Case: the lower DP unlocks a probe that values the higher DP. */
const highDependentCaseTree = node('vp_high_dependent_case', 'vP', [
  node('dp_high_high_dependent_case', 'DP', [
    leaf('d_aya_high_dependent_case', 'D', 'Aya', { tokenIndex: 0 })
  ]),
  node('vbar_high_dependent_case', "v'", [
    silentLexicalNode('v_probe_high_dependent_case', 'v', '[uφ]'),
    node('vp_domain_high_dependent_case', 'VP', [
      leaf('v_saw_high_dependent_case', 'V', 'saw', { tokenIndex: 1 }),
      node('dp_low_high_dependent_case', 'DP', [
        leaf('d_noa_high_dependent_case', 'D', 'Noa', { tokenIndex: 2 })
      ])
    ])
  ])
]);

const domainTree = node('cp_island_matrix', 'CP', [
  node('dp_which_book_island_high', 'DP', [
    leaf('d_which_island_high', 'D', 'Which', { lineageId: 'island-book-d' }),
    node('np_book_island_high', 'NP', [
      leaf('n_book_island_high', 'N', 'book', { lineageId: 'island-book-n' })
    ], { lineageId: 'island-book-chain' })
  ], { lineageId: 'island-book-chain' }),
  node('cbar_island_matrix', "C'", [
    leaf('c_did_island', 'C', 'did'),
    node('tp_island_matrix', 'TP', [
      node('mia_island', 'DP', [
      node('mia_island_np', 'NP', [
        leaf('mia_island_n', 'N', 'Mia')
      ])
    ]),
      node('tbar_island_matrix', "T'", [
        nullHead('t_null_island', 'T'),
        node('vp_wonder_island', 'VP', [
          leaf('v_wonder_island', 'V', 'wonder'),
          node('cp_whether_island', 'CP', [
            node('cbar_whether_island', "C'", [
              leaf('c_whether_island', 'C', 'whether'),
              node('tp_embedded_island', 'TP', [
                node('noa_island', 'DP', [
      node('noa_island_np', 'NP', [
        leaf('noa_island_n', 'N', 'Noa')
      ])
    ]),
                node('tbar_embedded_island', "T'", [
                  nullHead('t_embedded_null_island', 'T'),
                  node('vp_read_island', 'VP', [
                    leaf('v_read_island', 'V', 'read'),
                    node('dp_which_book_island_low', 'DP', [
                      leaf('d_which_island_low', 'D', 't₁', { lineageId: 'island-book-d', silent: true }),
                      node('np_book_island_low', 'NP', [
                        leaf('n_book_island_low', 'N', 't₁', { lineageId: 'island-book-n', silent: true })
                      ], { silent: true, lineageId: 'island-book-chain' })
                    ], { silent: true, lineageId: 'island-book-chain' })
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

/**
 * Strong complex-NP witness for the canonical bounding-node card. The direct
 * object-to-matrix-edge path crosses the embedded TP, the containing NP, and
 * the matrix TP; every cut therefore comes from an authored boundary anchor.
 */
const complexNpTree = node('cp_cnpc', 'CP', [
  node('dp_which_book_cnpc_high', 'DP', [
    leaf('d_which_cnpc_high', 'D', 'Which', { lineageId: 'cnpc-book-d', tokenIndex: 0 }),
    node('np_book_cnpc_high', 'NP', [
      leaf('n_book_cnpc_high', 'N', 'book', { lineageId: 'cnpc-book-n', tokenIndex: 1 })
    ], { lineageId: 'cnpc-book-np' })
  ], { lineageId: 'cnpc-book-chain' }),
  node('cbar_cnpc', "C'", [
    leaf('c_did_cnpc', 'C', 'did', { tokenIndex: 2 }),
    node('tp_cnpc_matrix', 'TP', [
      node('mia_cnpc', 'DP', [
      node('mia_cnpc_np', 'NP', [
        leaf('mia_cnpc_n', 'N', 'Mia', { tokenIndex: 3 })
      ])
    ]),
      node('tbar_cnpc_matrix', "T'", [
        nullHead('t_cnpc_matrix', 'T'),
        node('vp_cnpc_matrix', 'VP', [
          leaf('v_believe_cnpc', 'V', 'believe', { tokenIndex: 4 }),
          node('dp_claim_cnpc', 'DP', [
            leaf('d_the_cnpc', 'D', 'the', { tokenIndex: 5 }),
            node('np_claim_cnpc', 'NP', [
              leaf('n_claim_cnpc', 'N', 'claim', { tokenIndex: 6 }),
              node('cp_that_cnpc', 'CP', [
                node('cbar_that_cnpc', "C'", [
                  leaf('c_that_cnpc', 'C', 'that', { tokenIndex: 7 }),
                  node('tp_cnpc_embedded', 'TP', [
                    node('noa_cnpc', 'DP', [
      node('noa_cnpc_np', 'NP', [
        leaf('noa_cnpc_n', 'N', 'Noa', { tokenIndex: 8 })
      ])
    ]),
                    node('tbar_cnpc_embedded', "T'", [
                      nullHead('t_cnpc_embedded', 'T'),
                      node('vp_cnpc_embedded', 'VP', [
                        leaf('v_read_cnpc', 'V', 'read', { tokenIndex: 9 }),
                        node('dp_which_book_cnpc_low', 'DP', [
                          silentLexicalNode('d_which_cnpc_low', 'D', 't₁', { lineageId: 'cnpc-book-d' }),
                          node('np_book_cnpc_low', 'NP', [
                            silentLexicalNode('n_book_cnpc_low', 'N', 't₁', { lineageId: 'cnpc-book-n' })
                          ], { silent: true, lineageId: 'cnpc-book-np' })
                        ], { silent: true, lineageId: 'cnpc-book-chain' })
                      ])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

const phaseTree = node('cp_phase', 'CP', [
  nullHead('c_null_phase', 'C'),
  node('tp_phase', 'TP', [
    silentLexicalNode('t_past_phase', 'T', '[past]'),
    node('vp_phase', 'vP', [
      node('sara_phase_edge', 'DP', [
        node('sara_phase_np', 'NP', [
          leaf('sara_phase_n', 'N', 'Sara', { tokenIndex: 0 })
        ])
      ]),
      node('vbar_phase', "v'", [
        nullHead('v_phase_head', 'v'),
        node('vp_phase_complement', 'VP', [
          leaf('v_read_phase', 'V', 'read', { tokenIndex: 1 }),
          node('dp_book_phase', 'DP', [
            leaf('d_the_phase', 'D', 'the', { tokenIndex: 2 }),
            node('np_book_phase', 'NP', [
              leaf('n_book_phase', 'N', 'book', { tokenIndex: 3 })
            ])
          ])
        ])
      ])
    ])
  ])
]);

/*
 * Fong's transfer plate is about the vP phase edge and its VP complement, not
 * subject movement. Keep Sara pronounced once at the edge so the card does
 * not manufacture an unexplained lower copy or an unrelated movement arrow.
 */
const transferPhaseTree = node('tp_transfer', 'TP', [
  nullHead('t_probe_transfer', 'T'),
  node('vp_transfer', 'vP', [
    node('sara_transfer_edge', 'DP', [
      node('sara_transfer_np', 'NP', [
        leaf('sara_transfer_n', 'N', 'Sara', { tokenIndex: 0 })
      ])
    ]),
    node('vbar_transfer', "v'", [
      nullHead('v_transfer_head', 'v'),
      node('vp_transfer_complement', 'VP', [
        leaf('v_read_transfer', 'V', 'read', { tokenIndex: 1 }),
        node('dp_book_transfer', 'DP', [
          leaf('d_the_transfer', 'D', 'the', { tokenIndex: 2 }),
          node('np_book_transfer', 'NP', [
            leaf('n_book_transfer', 'N', 'book', { tokenIndex: 3 })
          ])
        ])
      ])
    ])
  ])
]);

/*
 * Fong (2025), example (1c): matrix plural agreement cannot target the
 * embedded subject across a finite CP. Every access-path anchor is ordinary
 * syntax required by the example: matrix T is the probe, embedded CP is the
 * phase, its TP complement is the SOD, and os alunos is the inaccessible goal.
 */
const postTransferLdaTree = node('tp_fong_lda', 'TP', [
  silentLexicalNode('t_probe_fong_lda', 'T', '[uφ]'),
  node('vp_matrix_fong_lda', 'VP', [
    leaf('v_seem_fong_lda', 'V', 'Parecem', { tokenIndex: 0 }),
    node('cp_embedded_fong_lda', 'CP', [
      leaf('c_que_fong_lda', 'C', 'que', { tokenIndex: 1 }),
      node('tp_embedded_fong_lda', 'TP', [
        node('dp_students_fong_lda', 'DP', [
          leaf('d_os_fong_lda', 'D', 'os', { tokenIndex: 2 }),
          node('np_students_fong_lda', 'NP', [
            leaf('n_students_fong_lda', 'N', 'alunos', { tokenIndex: 3 })
          ])
        ]),
        node('tbar_embedded_fong_lda', "T'", [
          silentLexicalNode('t_finite_fong_lda', 'T', '[3PL]'),
          node('vp_embedded_fong_lda', 'VP', [
            leaf('v_visited_fong_lda', 'V', 'visitaram', { tokenIndex: 4 }),
            node('dp_zoo_fong_lda', 'DP', [
              leaf('d_o_fong_lda', 'D', 'o', { tokenIndex: 5 }),
              node('np_zoo_fong_lda', 'NP', [
                leaf('n_zoo_fong_lda', 'N', 'zoológico', { tokenIndex: 6 })
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

const multiPhaseTree = node('cp_multiphase', 'CP', [
  nullHead('c_null_multiphase', 'C'),
  node('tp_multiphase', 'TP', [
    silentLexicalNode('t_past_multiphase', 'T', '[past]'),
    node('vp_matrix_multiphase', 'vP', [
      node('lena_matrix_edge', 'DP', [
        node('lena_matrix_edge_np', 'NP', [
          leaf('lena_matrix_edge_n', 'N', 'Lena', { tokenIndex: 0 })
        ])
      ]),
      node('vbar_matrix_multiphase', "v'", [
        leaf('v_say_multiphase', 'V', 'said', { tokenIndex: 1 }),
        node('cp_embedded_multiphase', 'CP', [
          leaf('c_that_multiphase', 'C', 'that', { tokenIndex: 2 }),
          node('tp_embedded_multiphase', 'TP', [
            silentLexicalNode('t_null_embedded_multiphase', 'T', '[past]'),
            node('vp_embedded_multiphase', 'vP', [
              node('orion_embedded_edge', 'DP', [
                node('orion_embedded_edge_np', 'NP', [
                  leaf('orion_embedded_edge_n', 'N', 'Orion', { tokenIndex: 3 })
                ])
              ]),
              node('vbar_embedded_multiphase', "v'", [
                nullHead('v_phase_embedded_head', 'v'),
                node('vp_embedded_complement_multiphase', 'VP', [
                  leaf('v_praise_multiphase', 'V', 'praised', { tokenIndex: 4 }),
                  node('dp_lena_object_multiphase', 'DP', [
                    leaf('d_lena_object_multiphase', 'D', 'the', { tokenIndex: 5 }),
                    node('np_lena_object_multiphase', 'NP', [
                      leaf('n_lena_object_multiphase', 'N', 'singer', { tokenIndex: 6 })
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

const antiLocalityShortTree = node('vp_anti_short', 'vP', [
  node('dp_ocean_high_anti_short', 'DP', [
    leaf('d_the_high_anti_short', 'D', 'The', {
      tokenIndex: 0,
      lineageId: 'anti-short-d'
    }),
    node('np_ocean_high_anti_short', 'NP', [
      leaf('n_ocean_high_anti_short', 'N', 'ocean', {
        tokenIndex: 1,
        lineageId: 'anti-short-n'
      })
    ], { lineageId: 'anti-short-np' })
  ], { lineageId: 'anti-short-dp' }),
  node('vbar_anti_short', "v'", [
    leaf('v_photographs_high_anti_short', 'v', 'photographs', {
      tokenIndex: 2,
      lineageId: 'anti-short-v'
    }),
    node('vp_complement_anti_short', 'VP', [
      node('vbar_low_anti_short', "V'", [
        silentLexicalNode('v_photographs_low_anti_short', 'V', 't₁', {
          lineageId: 'anti-short-v'
        }),
        node('dp_ocean_low_anti_short', 'DP', [
          silentLexicalNode('d_the_low_anti_short', 'D', 't₂', {
            lineageId: 'anti-short-d'
          }),
          node('np_ocean_low_anti_short', 'NP', [
            silentLexicalNode('n_ocean_low_anti_short', 'N', 't₂', {
              lineageId: 'anti-short-n'
            })
          ], { silent: true, lineageId: 'anti-short-np' })
        ], { silent: true, lineageId: 'anti-short-dp' })
      ])
    ])
  ])
]);

const antiLocalityFacilitatorTree = node('vp_anti_facilitator', 'vP', [
  node('dp_ocean_high_anti_facilitator', 'DP', [
    leaf('d_the_high_anti_facilitator', 'D', 'The', {
      tokenIndex: 0,
      lineageId: 'anti-facilitator-d'
    }),
    node('np_ocean_high_anti_facilitator', 'NP', [
      leaf('n_ocean_high_anti_facilitator', 'N', 'ocean', {
        tokenIndex: 1,
        lineageId: 'anti-facilitator-n'
      })
    ], { lineageId: 'anti-facilitator-np' })
  ], { lineageId: 'anti-facilitator-dp' }),
  node('vbar_anti_facilitator', "v'", [
    leaf('v_photographs_high_anti_facilitator', 'v', 'photographs', {
      tokenIndex: 2,
      lineageId: 'anti-facilitator-v'
    }),
    node('vp_complement_anti_facilitator', 'VP', [
      node('advp_anti_facilitator', 'AdvP', [
        leaf('adv_well_anti_facilitator', 'Adv', 'well', { tokenIndex: 3 })
      ]),
      node('vbar_low_anti_facilitator', "V'", [
        silentLexicalNode('v_photographs_low_anti_facilitator', 'V', 't₁', {
          lineageId: 'anti-facilitator-v'
        }),
        node('dp_ocean_low_anti_facilitator', 'DP', [
          silentLexicalNode('d_the_low_anti_facilitator', 'D', 't₂', {
            lineageId: 'anti-facilitator-d'
          }),
          node('np_ocean_low_anti_facilitator', 'NP', [
            silentLexicalNode('n_ocean_low_anti_facilitator', 'N', 't₂', {
              lineageId: 'anti-facilitator-n'
            })
          ], { silent: true, lineageId: 'anti-facilitator-np' })
        ], { silent: true, lineageId: 'anti-facilitator-dp' })
      ])
    ])
  ])
]);

const antiLocalityShortObjectBaseTree = replaceSyntaxNode(
  movementBaseTree(
    antiLocalityShortTree,
    'dp_ocean_high_anti_short',
    'dp_ocean_low_anti_short',
    ['vp_anti_short']
  ),
  'd_the_high_anti_short',
  leaf('d_the_high_anti_short', 'D', 'the', {
    tokenIndex: 0,
    lineageId: 'anti-short-d'
  })
);

const antiLocalityShortHeadBaseTree = replaceSyntaxNode(
  replaceSyntaxNode(
    antiLocalityShortObjectBaseTree,
    'v_photographs_high_anti_short',
    nullHead('v_photographs_high_anti_short', 'v')
  ),
  'v_photographs_low_anti_short',
  leaf('v_photographs_low_anti_short', 'V', 'photographs', {
    tokenIndex: 2,
    lineageId: 'anti-short-v'
  })
);

const antiLocalityFacilitatorObjectBaseTree = replaceSyntaxNode(
  movementBaseTree(
    antiLocalityFacilitatorTree,
    'dp_ocean_high_anti_facilitator',
    'dp_ocean_low_anti_facilitator',
    ['vp_anti_facilitator']
  ),
  'd_the_high_anti_facilitator',
  leaf('d_the_high_anti_facilitator', 'D', 'the', {
    tokenIndex: 0,
    lineageId: 'anti-facilitator-d'
  })
);

const antiLocalityFacilitatorHeadBaseTree = replaceSyntaxNode(
  replaceSyntaxNode(
    antiLocalityFacilitatorObjectBaseTree,
    'v_photographs_high_anti_facilitator',
    nullHead('v_photographs_high_anti_facilitator', 'v')
  ),
  'v_photographs_low_anti_facilitator',
  leaf('v_photographs_low_anti_facilitator', 'V', 'photographs', {
    tokenIndex: 2,
    lineageId: 'anti-facilitator-v'
  })
);

const improperCpTree = node('cp_improper_cp_root', 'CP', [
  node('cp_clause_high_improper_cp', 'CP', [
    leaf('c_that_high_improper_cp', 'C', 'That', {
      tokenIndex: 0,
      lineageId: 'improper-cp-c'
    }),
    node('tp_clause_high_improper_cp', 'TP', [
      node('dp_noa_high_improper_cp', 'DP', [
        node('np_noa_high_improper_cp', 'NP', [
          leaf('n_noa_high_improper_cp', 'N', 'Noa', {
            tokenIndex: 1,
            lineageId: 'improper-cp-noa'
          })
        ])
      ]),
      node('tbar_clause_high_improper_cp', "T'", [
        silentLexicalNode('t_past_high_improper_cp', 'T', '[past]'),
        node('vp_clause_high_improper_cp', 'VP', [
          leaf('v_left_high_improper_cp', 'V', 'left', {
            tokenIndex: 2,
            lineageId: 'improper-cp-v'
          })
        ])
      ])
    ])
  ], { lineageId: 'improper-cp-clause' }),
  node('cbar_improper_cp_root', "C'", [
    nullHead('c_null_improper_cp_root', 'C'),
    node('tp_improper_cp_matrix', 'TP', [
      node('dp_mia_improper_cp', 'DP', [
        node('np_mia_improper_cp', 'NP', [
          leaf('n_mia_improper_cp', 'N', 'Mia', { tokenIndex: 3 })
        ])
      ]),
      node('tbar_improper_cp_matrix', "T'", [
        silentLexicalNode('t_past_improper_cp_matrix', 'T', '[past]'),
        node('vp_improper_cp_matrix', 'vP', [
          nullHead('v_null_improper_cp_matrix', 'v'),
          node('vp_improper_cp_complement', 'VP', [
            leaf('v_believed_improper_cp', 'V', 'believed', { tokenIndex: 4 }),
            node('cp_clause_low_improper_cp', 'CP', [
              silentLexicalNode('c_that_low_improper_cp', 'C', 't₁', {
                lineageId: 'improper-cp-c'
              }),
              node('tp_clause_low_improper_cp', 'TP', [
                node('dp_noa_low_improper_cp', 'DP', [
                  node('np_noa_low_improper_cp', 'NP', [
                    silentLexicalNode('n_noa_low_improper_cp', 'N', 't₁', {
                      lineageId: 'improper-cp-noa'
                    })
                  ])
                ], { silent: true }),
                node('tbar_clause_low_improper_cp', "T'", [
                  silentLexicalNode('t_past_low_improper_cp', 'T', '[past]'),
                  node('vp_clause_low_improper_cp', 'VP', [
                    silentLexicalNode('v_left_low_improper_cp', 'V', 't₁', {
                      lineageId: 'improper-cp-v'
                    })
                  ], { silent: true })
                ])
              ], { silent: true })
            ], { silent: true, lineageId: 'improper-cp-clause' })
          ])
        ])
      ])
    ])
  ])
]);

const improperTpTree = node('cp_improper_tp_root', 'CP', [
  node('tp_clause_high_improper_tp', 'TP', [
    leaf('t_to_high_improper_tp', 'T', 'To', {
      tokenIndex: 0,
      lineageId: 'improper-tp-t'
    }),
    node('vp_clause_high_improper_tp', 'VP', [
      leaf('v_leave_high_improper_tp', 'V', 'leave', {
        tokenIndex: 1,
        lineageId: 'improper-tp-v'
      })
    ])
  ], { lineageId: 'improper-tp-clause' }),
  node('cbar_improper_tp_root', "C'", [
    nullHead('c_null_improper_tp_root', 'C'),
    node('tp_improper_tp_matrix', 'TP', [
      node('dp_noa_improper_tp', 'DP', [
        node('np_noa_improper_tp', 'NP', [
          leaf('n_noa_improper_tp', 'N', 'Noa', { tokenIndex: 2 })
        ])
      ]),
      node('tbar_improper_tp_matrix', "T'", [
        silentLexicalNode('t_past_improper_tp_matrix', 'T', '[past]'),
        node('vp_improper_tp_matrix', 'vP', [
          nullHead('v_null_improper_tp_matrix', 'v'),
          node('vp_improper_tp_complement', 'VP', [
            leaf('v_tried_improper_tp', 'V', 'tried', { tokenIndex: 3 }),
            node('tp_clause_low_improper_tp', 'TP', [
              silentLexicalNode('t_to_low_improper_tp', 'T', 't₁', {
                lineageId: 'improper-tp-t'
              }),
              node('vp_clause_low_improper_tp', 'VP', [
                silentLexicalNode('v_leave_low_improper_tp', 'V', 't₁', {
                  lineageId: 'improper-tp-v'
                })
              ], { silent: true })
            ], { silent: true, lineageId: 'improper-tp-clause' })
          ])
        ])
      ])
    ])
  ])
]);

const ellipsisTree = node('coord_ellipsis', 'CoordP', [
  node('tp_antecedent', 'TP', [
    node('lena_ellipsis', 'DP', [
      node('lena_ellipsis_np', 'NP', [
        leaf('lena_ellipsis_n', 'N', 'Lena', { tokenIndex: 0 })
      ])
    ]),
    node('vp_antecedent', 'VP', [
      leaf('read_ellipsis', 'V', 'read', { lineageId: 'ellipsis-read', tokenIndex: 1 }),
      node('book_ellipsis', 'DP', [
        leaf('d_book_ellipsis', 'D', 'the', { lineageId: 'ellipsis-the', tokenIndex: 2 }),
        node('np_book_ellipsis', 'NP', [
          leaf('n_book_ellipsis', 'N', 'book', { lineageId: 'ellipsis-book', tokenIndex: 3 })
        ], { lineageId: 'ellipsis-book-np' })
      ], { lineageId: 'ellipsis-book-dp' })
    ])
  ]),
  node('coordbar_ellipsis', "Coord'", [
    leaf('and_ellipsis', 'Coord', 'and', { tokenIndex: 4 }),
    node('tp_ellipsis_site', 'TP', [
      node('noa_ellipsis', 'DP', [
      node('noa_ellipsis_np', 'NP', [
        leaf('noa_ellipsis_n', 'N', 'Noa', { tokenIndex: 5 })
      ])
    ]),
      node('tbar_ellipsis_site', "T'", [
        node('tbar_ellipsis_aux_vp', "T'", [
          leaf('did_ellipsis', 'T', 'did', { tokenIndex: 6 }),
          node('vp_silent_site', 'VP', [
            silentLexicalNode('read_ellipsis_ghost', 'V', 'read', { lineageId: 'ellipsis-read' }),
            node('book_ellipsis_ghost', 'DP', [
              silentLexicalNode('d_book_ellipsis_ghost', 'D', 'the', { lineageId: 'ellipsis-the' }),
              node('np_book_ellipsis_ghost', 'NP', [
                silentLexicalNode('n_book_ellipsis_ghost', 'N', 'book', { lineageId: 'ellipsis-book' })
              ], { silent: true, lineageId: 'ellipsis-book-np' })
            ], { silent: true, lineageId: 'ellipsis-book-dp' })
          ], { silent: true })
        ]),
        leaf('too_ellipsis', 'Adv', 'too', { tokenIndex: 7 })
      ])
    ])
  ])
]);

/** Gengel's remnant after object shift, before VP pronunciation is deleted. */
const pseudogappingMovementTree = node('tp_pseudogapping', 'TP', [
  node('dp_mary_pseudogapping', 'DP', [
    node('np_mary_pseudogapping', 'NP', [
      leaf('n_mary_pseudogapping', 'N', 'Mary', { tokenIndex: 0 })
    ])
  ]),
  node('tbar_pseudogapping', "T'", [
    leaf('t_will_pseudogapping', 'T', 'will', { tokenIndex: 1 }),
    node('agrop_pseudogapping', 'AgrOP', [
      node('dp_jane_high_pseudogapping', 'DP', [
        node('np_jane_high_pseudogapping', 'NP', [
          leaf('n_jane_high_pseudogapping', 'N', 'Jane', {
            tokenIndex: 2,
            lineageId: 'pseudogapping-jane-n'
          })
        ])
      ], { lineageId: 'pseudogapping-jane-dp' }),
      node('agrobar_pseudogapping', "AgrO'", [
        nullHead('agro_pseudogapping', 'AgrO'),
        node('vp_pseudogapping', 'VP', [
          leaf('v_invite_pseudogapping', 'V', 'invite'),
          node('dp_jane_low_pseudogapping', 'DP', [
            node('np_jane_low_pseudogapping', 'NP', [
              silentLexicalNode('n_jane_low_pseudogapping', 'N', 't', {
                lineageId: 'pseudogapping-jane-n'
              })
            ], { silent: true })
          ], { silent: true, lineageId: 'pseudogapping-jane-dp' })
        ])
      ])
    ])
  ])
]);

/** The remnant remains pronounced while its complete VP sister is silent. */
const pseudogappingTree = node('tp_pseudogapping', 'TP', [
  node('dp_mary_pseudogapping', 'DP', [
    node('np_mary_pseudogapping', 'NP', [
      leaf('n_mary_pseudogapping', 'N', 'Mary', { tokenIndex: 0 })
    ])
  ]),
  node('tbar_pseudogapping', "T'", [
    leaf('t_will_pseudogapping', 'T', 'will', { tokenIndex: 1 }),
    node('agrop_pseudogapping', 'AgrOP', [
      node('dp_jane_high_pseudogapping', 'DP', [
        node('np_jane_high_pseudogapping', 'NP', [
          leaf('n_jane_high_pseudogapping', 'N', 'Jane', {
            tokenIndex: 2,
            lineageId: 'pseudogapping-jane-n'
          })
        ])
      ], { lineageId: 'pseudogapping-jane-dp' }),
      node('agrobar_pseudogapping', "AgrO'", [
        nullHead('agro_pseudogapping', 'AgrO'),
        node('vp_pseudogapping', 'VP', [
          silentLexicalNode('v_invite_pseudogapping', 'V', 'invite'),
          node('dp_jane_low_pseudogapping', 'DP', [
            node('np_jane_low_pseudogapping', 'NP', [
              silentLexicalNode('n_jane_low_pseudogapping', 'N', 't', {
                lineageId: 'pseudogapping-jane-n'
              })
            ], { silent: true })
          ], { silent: true, lineageId: 'pseudogapping-jane-dp' })
        ], { silent: true })
      ])
    ])
  ])
]);

/** Gengel's gapping derivation before either remnant has escaped TP. */
const gappingEscapeBaseTree = node('tp_gapping_escape', 'TP', [
  node('dp_heather_low_gapping_escape', 'DP', [
    node('np_heather_low_gapping_escape', 'NP', [
      leaf('n_heather_low_gapping_escape', 'N', 'Heather', { tokenIndex: 0 })
    ])
  ]),
  node('tbar_gapping_escape', "T'", [
    leaf('t_past_gapping_escape', 'T', '[past]', { silent: true }),
    node('vp_gapping_escape', 'VP', [
      leaf('v_read_gapping_escape', 'V', 'read', { tokenIndex: 1 }),
      node('dp_magazine_low_gapping_escape', 'DP', [
        leaf('d_a_low_gapping_escape', 'D', 'a', { tokenIndex: 2 }),
        node('np_magazine_low_gapping_escape', 'NP', [
          leaf('n_magazine_low_gapping_escape', 'N', 'magazine', { tokenIndex: 3 })
        ])
      ])
    ])
  ])
]);

/** The object remnant has escaped VP into FocP; the subject remains in TP. */
const gappingObjectEscapeTree = node('focp_gapping_escape', 'FocP', [
  node('dp_magazine_high_gapping_escape', 'DP', [
    leaf('d_a_high_gapping_escape', 'D', 'a', {
      tokenIndex: 1,
      lineageId: 'gapping-magazine-d'
    }),
    node('np_magazine_high_gapping_escape', 'NP', [
      leaf('n_magazine_high_gapping_escape', 'N', 'magazine', {
        tokenIndex: 2,
        lineageId: 'gapping-magazine-n'
      })
    ])
  ], { lineageId: 'gapping-magazine-dp' }),
  node('focbar_gapping_escape', "Foc'", [
    nullHead('foc_gapping_escape', 'Foc'),
    node('tp_gapping_escape', 'TP', [
      node('dp_heather_low_gapping_escape', 'DP', [
        node('np_heather_low_gapping_escape', 'NP', [
          leaf('n_heather_low_gapping_escape', 'N', 'Heather', { tokenIndex: 0 })
        ])
      ]),
      node('tbar_gapping_escape', "T'", [
        leaf('t_past_gapping_escape', 'T', '[past]', { silent: true }),
        node('vp_gapping_escape', 'VP', [
          leaf('v_read_gapping_escape', 'V', 'read'),
          node('dp_magazine_low_gapping_escape', 'DP', [
            silentLexicalNode('d_a_low_gapping_escape', 'D', 't', {
              lineageId: 'gapping-magazine-d'
            }),
            node('np_magazine_low_gapping_escape', 'NP', [
              silentLexicalNode('n_magazine_low_gapping_escape', 'N', 't', {
                lineageId: 'gapping-magazine-n'
              })
            ], { silent: true })
          ], { silent: true, lineageId: 'gapping-magazine-dp' })
        ])
      ])
    ])
  ])
]);

/** Both gapping remnants have escaped to the articulated left periphery. */
const gappingBothEscapeTree = node('topp_gapping_escape', 'TopP', [
  node('dp_heather_high_gapping_escape', 'DP', [
    node('np_heather_high_gapping_escape', 'NP', [
      leaf('n_heather_high_gapping_escape', 'N', 'Heather', {
        tokenIndex: 0,
        lineageId: 'gapping-heather-n'
      })
    ])
  ], { lineageId: 'gapping-heather-dp' }),
  node('topbar_gapping_escape', "Top'", [
    nullHead('top_gapping_escape', 'Top'),
    node('focp_gapping_escape', 'FocP', [
      node('dp_magazine_high_gapping_escape', 'DP', [
        leaf('d_a_high_gapping_escape', 'D', 'a', {
          tokenIndex: 1,
          lineageId: 'gapping-magazine-d'
        }),
        node('np_magazine_high_gapping_escape', 'NP', [
          leaf('n_magazine_high_gapping_escape', 'N', 'magazine', {
            tokenIndex: 2,
            lineageId: 'gapping-magazine-n'
          })
        ])
      ], { lineageId: 'gapping-magazine-dp' }),
      node('focbar_gapping_escape', "Foc'", [
        nullHead('foc_gapping_escape', 'Foc'),
        node('tp_gapping_escape', 'TP', [
          node('dp_heather_low_gapping_escape', 'DP', [
            node('np_heather_low_gapping_escape', 'NP', [
              silentLexicalNode('n_heather_low_gapping_escape', 'N', 't', {
                lineageId: 'gapping-heather-n'
              })
            ], { silent: true })
          ], { silent: true, lineageId: 'gapping-heather-dp' }),
          node('tbar_gapping_escape', "T'", [
            leaf('t_past_gapping_escape', 'T', '[past]', { silent: true }),
            node('vp_gapping_escape', 'VP', [
              leaf('v_read_gapping_escape', 'V', 'read'),
              node('dp_magazine_low_gapping_escape', 'DP', [
                silentLexicalNode('d_a_low_gapping_escape', 'D', 't', {
                  lineageId: 'gapping-magazine-d'
                }),
                node('np_magazine_low_gapping_escape', 'NP', [
                  silentLexicalNode('n_magazine_low_gapping_escape', 'N', 't', {
                    lineageId: 'gapping-magazine-n'
                  })
                ], { silent: true })
              ], { silent: true, lineageId: 'gapping-magazine-dp' })
            ])
          ])
        ])
      ])
    ])
  ])
]);

/** Final gapping state: both trajectories persist while the complete TP is silent. */
const gappingDeletionTree = node('topp_gapping_escape', 'TopP', [
  node('dp_heather_high_gapping_escape', 'DP', [
    node('np_heather_high_gapping_escape', 'NP', [
      leaf('n_heather_high_gapping_escape', 'N', 'Heather', {
        tokenIndex: 0,
        lineageId: 'gapping-heather-n'
      })
    ])
  ], { lineageId: 'gapping-heather-dp' }),
  node('topbar_gapping_escape', "Top'", [
    nullHead('top_gapping_escape', 'Top'),
    node('focp_gapping_escape', 'FocP', [
      node('dp_magazine_high_gapping_escape', 'DP', [
        leaf('d_a_high_gapping_escape', 'D', 'a', {
          tokenIndex: 1,
          lineageId: 'gapping-magazine-d'
        }),
        node('np_magazine_high_gapping_escape', 'NP', [
          leaf('n_magazine_high_gapping_escape', 'N', 'magazine', {
            tokenIndex: 2,
            lineageId: 'gapping-magazine-n'
          })
        ])
      ], { lineageId: 'gapping-magazine-dp' }),
      node('focbar_gapping_escape', "Foc'", [
        nullHead('foc_gapping_escape', 'Foc'),
        node('tp_gapping_escape', 'TP', [
          node('dp_heather_low_gapping_escape', 'DP', [
            node('np_heather_low_gapping_escape', 'NP', [
              silentLexicalNode('n_heather_low_gapping_escape', 'N', 't', {
                lineageId: 'gapping-heather-n'
              })
            ], { silent: true })
          ], { silent: true, lineageId: 'gapping-heather-dp' }),
          node('tbar_gapping_escape', "T'", [
            silentLexicalNode('t_past_gapping_escape', 'T', '[past]'),
            node('vp_gapping_escape', 'VP', [
              silentLexicalNode('v_read_gapping_escape', 'V', 'read'),
              node('dp_magazine_low_gapping_escape', 'DP', [
                silentLexicalNode('d_a_low_gapping_escape', 'D', 't', {
                  lineageId: 'gapping-magazine-d'
                }),
                node('np_magazine_low_gapping_escape', 'NP', [
                  silentLexicalNode('n_magazine_low_gapping_escape', 'N', 't', {
                    lineageId: 'gapping-magazine-n'
                  })
                ], { silent: true })
              ], { silent: true, lineageId: 'gapping-magazine-dp' })
            ], { silent: true })
          ], { silent: true })
        ], { silent: true })
      ])
    ])
  ])
]);

/** Base position for the VP that will receive multiple pronunciation. */
const partialCopyBaseTree = node('tp_partial_copy', 'TP', [
  node('dp_ta_partial_copy', 'DP', [
    leaf('d_ta_partial_copy', 'D', 'ta', { tokenIndex: 0 })
  ]),
  node('tbar_partial_copy', "T'", [
    nullHead('t_partial_copy', 'T'),
    node('voicep_partial_copy', 'VoiceP', [
      nullHead('voice_partial_copy', 'Voice'),
      node('modp_partial_copy', 'ModP', [
        node('vp_low_partial_copy', 'VP', [
          leaf('v_kan_low_partial_copy', 'V', 'kan', {
            tokenIndex: 1,
            lineageId: 'partial-copy-v'
          }),
          node('dp_xiaoshuo_low_partial_copy', 'DP', [
            node('np_xiaoshuo_low_partial_copy', 'NP', [
              leaf('n_xiaoshuo_low_partial_copy', 'N', 'xiaoshuo', {
                tokenIndex: 2,
                lineageId: 'partial-copy-n'
              })
            ], { lineageId: 'partial-copy-np' })
          ], { lineageId: 'partial-copy-dp' }),
        ], { lineageId: 'partial-copy-vp' }),
        node('modbar_partial_copy', "Mod'", [
          leaf('mod_de_partial_copy', 'Mod', 'de', { tokenIndex: 3 }),
          node('advp_partial_copy', 'AdvP', [
            leaf('adv_henkuai_partial_copy', 'Adv', 'hen kuai', { tokenIndex: 4 })
          ])
        ])
      ])
    ])
  ])
]);

/** Figure 17's complete higher and lower VP copies before selective PF deletion. */
const partialCopyMovementTree = node('cp_partial_copy', 'CP', [
  node('vp_high_partial_copy', 'VP', [
    leaf('v_kan_high_partial_copy', 'V', 'Kan', {
      tokenIndex: 0,
      lineageId: 'partial-copy-v'
    }),
    node('dp_xiaoshuo_high_partial_copy', 'DP', [
      node('np_xiaoshuo_high_partial_copy', 'NP', [
        leaf('n_xiaoshuo_high_partial_copy', 'N', 'xiaoshuo', {
          tokenIndex: 1,
          lineageId: 'partial-copy-n'
        })
      ], { lineageId: 'partial-copy-np' })
    ], { lineageId: 'partial-copy-dp' })
  ], { lineageId: 'partial-copy-vp' }),
  node('cbar_partial_copy', "C'", [
    nullHead('c_partial_copy', 'C'),
    node('tp_partial_copy', 'TP', [
      node('dp_ta_partial_copy', 'DP', [
        leaf('d_ta_partial_copy', 'D', 'ta', { tokenIndex: 2 })
      ]),
      node('tbar_partial_copy', "T'", [
        nullHead('t_partial_copy', 'T'),
        node('voicep_partial_copy', 'VoiceP', [
          nullHead('voice_partial_copy', 'Voice'),
          node('modp_partial_copy', 'ModP', [
            node('vp_low_partial_copy', 'VP', [
              leaf('v_kan_low_partial_copy', 'V', 'kan', {
                tokenIndex: 3,
                lineageId: 'partial-copy-v'
              }),
              node('dp_xiaoshuo_low_partial_copy', 'DP', [
                node('np_xiaoshuo_low_partial_copy', 'NP', [
                  leaf('n_xiaoshuo_low_partial_copy', 'N', 'xiaoshuo', {
                    lineageId: 'partial-copy-n'
                  })
                ], { lineageId: 'partial-copy-np' })
              ], { lineageId: 'partial-copy-dp' })
            ], { lineageId: 'partial-copy-vp' }),
            node('modbar_partial_copy', "Mod'", [
              leaf('mod_de_partial_copy', 'Mod', 'de', { tokenIndex: 4 }),
              node('advp_partial_copy', 'AdvP', [
                leaf('adv_henkuai_partial_copy', 'Adv', 'hen kuai', { tokenIndex: 5 })
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

/** Figure 18's PF result, kept inside Figure 17's complete Babel tree. */
const partialCopyDeletionTree = node('cp_partial_copy', 'CP', [
  node('vp_high_partial_copy', 'VP', [
    leaf('v_kan_high_partial_copy', 'V', 'Kan', {
      tokenIndex: 0,
      lineageId: 'partial-copy-v'
    }),
    node('dp_xiaoshuo_high_partial_copy', 'DP', [
      node('np_xiaoshuo_high_partial_copy', 'NP', [
        leaf('n_xiaoshuo_high_partial_copy', 'N', 'xiaoshuo', {
          tokenIndex: 1,
          lineageId: 'partial-copy-n'
        })
      ], { lineageId: 'partial-copy-np' })
    ], { lineageId: 'partial-copy-dp' })
  ], { lineageId: 'partial-copy-vp' }),
  node('cbar_partial_copy', "C'", [
    nullHead('c_partial_copy', 'C'),
    node('tp_partial_copy', 'TP', [
      node('dp_ta_partial_copy', 'DP', [
        leaf('d_ta_partial_copy', 'D', 'ta', { tokenIndex: 2 })
      ]),
      node('tbar_partial_copy', "T'", [
        nullHead('t_partial_copy', 'T'),
        node('voicep_partial_copy', 'VoiceP', [
          nullHead('voice_partial_copy', 'Voice'),
          node('modp_partial_copy', 'ModP', [
            node('vp_low_partial_copy', 'VP', [
              leaf('v_kan_low_partial_copy', 'V', 'kan', {
                tokenIndex: 3,
                lineageId: 'partial-copy-v'
              }),
              node('dp_xiaoshuo_low_partial_copy', 'DP', [
                node('np_xiaoshuo_low_partial_copy', 'NP', [
                  silentLexicalNode('n_xiaoshuo_low_partial_copy', 'N', 'xiaoshuo', {
                    lineageId: 'partial-copy-n'
                  })
                ], { silent: true, lineageId: 'partial-copy-np' })
              ], { silent: true, lineageId: 'partial-copy-dp' })
            ], { lineageId: 'partial-copy-vp' }),
            node('modbar_partial_copy', "Mod'", [
              leaf('mod_de_partial_copy', 'Mod', 'de', { tokenIndex: 4 }),
              node('advp_partial_copy', 'AdvP', [
                leaf('adv_henkuai_partial_copy', 'Adv', 'hen kuai', { tokenIndex: 5 })
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

/** Yip and Ahenkorah's Cantonese object before movement creates a lower copy. */
const resumptivePartialCopyBaseTree = node('tp_resumptive_partial_copy', 'TP', [
  node('dp_nei_resumptive_partial_copy', 'DP', [
    leaf('d_nei_resumptive_partial_copy', 'D', 'Nei', { tokenIndex: 0 })
  ]),
  node('tbar_resumptive_partial_copy', "T'", [
    leaf('t_jiu_resumptive_partial_copy', 'T', 'jiu', { tokenIndex: 1 }),
    node('dispp_resumptive_partial_copy', 'DispP', [
      leaf('disp_zoeng_resumptive_partial_copy', 'Disp', 'zoeng', { tokenIndex: 2 }),
      node('vp_resumptive_partial_copy', 'vP', [
        node('vbar_resumptive_partial_copy', "v'", [
          nullHead('v_resumptive_partial_copy', 'v'),
          node('n1', 'VP', [
            leaf('v_taisaai_resumptive_partial_copy', 'V', 'tai-saai', { tokenIndex: 3 }),
            node('dp_book_low_resumptive_partial_copy', 'DP', [
              leaf('d_di_low_resumptive_partial_copy', 'D', 'di', {
                tokenIndex: 4,
                lineageId: 'resumptive-book-d'
              }),
              node('np_book_low_resumptive_partial_copy', 'NP', [
                leaf('n_syu_low_resumptive_partial_copy', 'N', 'syu', {
                  tokenIndex: 5,
                  lineageId: 'resumptive-book-n'
                })
              ], { lineageId: 'resumptive-book-np' })
            ], { lineageId: 'resumptive-book-dp' })
          ])
        ])
      ])
    ])
  ])
]);

/** Object movement stage: the complete lower copy is still visible before PF deletion. */
const resumptivePartialCopyMovementTree = node('tp_resumptive_partial_copy', 'TP', [
  node('dp_nei_resumptive_partial_copy', 'DP', [
    leaf('d_nei_resumptive_partial_copy', 'D', 'Nei', { tokenIndex: 0 })
  ]),
  node('tbar_resumptive_partial_copy', "T'", [
    leaf('t_jiu_resumptive_partial_copy', 'T', 'jiu', { tokenIndex: 1 }),
    node('dispp_resumptive_partial_copy', 'DispP', [
      leaf('disp_zoeng_resumptive_partial_copy', 'Disp', 'zoeng', { tokenIndex: 2 }),
      node('vp_resumptive_partial_copy', 'vP', [
        node('dp_book_high_resumptive_partial_copy', 'DP', [
          leaf('d_di_high_resumptive_partial_copy', 'D', 'di', {
            tokenIndex: 3,
            lineageId: 'resumptive-book-d'
          }),
          node('np_book_high_resumptive_partial_copy', 'NP', [
            leaf('n_syu_high_resumptive_partial_copy', 'N', 'syu', {
              tokenIndex: 4,
              lineageId: 'resumptive-book-n'
            })
          ], { lineageId: 'resumptive-book-np' })
        ], { lineageId: 'resumptive-book-dp' }),
        node('vbar_resumptive_partial_copy', "v'", [
          nullHead('v_resumptive_partial_copy', 'v'),
          node('n1', 'VP', [
            leaf('v_taisaai_resumptive_partial_copy', 'V', 'tai-saai', { tokenIndex: 5 }),
            node('dp_book_low_resumptive_partial_copy', 'DP', [
              silentLexicalNode('d_di_low_resumptive_partial_copy', 'D', 'di', {
                lineageId: 'resumptive-book-d'
              }),
              node('np_book_low_resumptive_partial_copy', 'NP', [
                silentLexicalNode('n_syu_low_resumptive_partial_copy', 'N', 'syu', {
                  lineageId: 'resumptive-book-n'
                })
              ], { silent: true, lineageId: 'resumptive-book-np' })
            ], { silent: true, lineageId: 'resumptive-book-dp' })
          ])
        ])
      ])
    ])
  ])
]);

const resumptivePartialCopyLowerTree = requiredSyntaxSubtree(
  resumptivePartialCopyBaseTree,
  'vbar_resumptive_partial_copy'
);

const resumptivePartialCopyVpMovementTree = requiredSyntaxSubtree(
  resumptivePartialCopyMovementTree,
  'vp_resumptive_partial_copy'
);

/** PF deletes NP in the lower DP while retaining the abstract D head. */
const resumptivePartialCopyDeletionTree = node('tp_resumptive_partial_copy', 'TP', [
  node('dp_nei_resumptive_partial_copy', 'DP', [
    leaf('d_nei_resumptive_partial_copy', 'D', 'Nei', { tokenIndex: 0 })
  ]),
  node('tbar_resumptive_partial_copy', "T'", [
    leaf('t_jiu_resumptive_partial_copy', 'T', 'jiu', { tokenIndex: 1 }),
    node('dispp_resumptive_partial_copy', 'DispP', [
      leaf('disp_zoeng_resumptive_partial_copy', 'Disp', 'zoeng', { tokenIndex: 2 }),
      node('vp_resumptive_partial_copy', 'vP', [
        node('dp_book_high_resumptive_partial_copy', 'DP', [
          leaf('d_di_high_resumptive_partial_copy', 'D', 'di', {
            tokenIndex: 3,
            lineageId: 'resumptive-book-d'
          }),
          node('np_book_high_resumptive_partial_copy', 'NP', [
            leaf('n_syu_high_resumptive_partial_copy', 'N', 'syu', {
              tokenIndex: 4,
              lineageId: 'resumptive-book-n'
            })
          ], { lineageId: 'resumptive-book-np' })
        ], { lineageId: 'resumptive-book-dp' }),
        node('vbar_resumptive_partial_copy', "v'", [
          nullHead('v_resumptive_partial_copy', 'v'),
          node('n1', 'VP', [
            leaf('v_taisaai_resumptive_partial_copy', 'V', 'tai-saai', { tokenIndex: 5 }),
            node('dp_book_low_resumptive_partial_copy', 'DP', [
              silentLexicalNode('d_di_low_resumptive_partial_copy', 'D', '[D]', {
                lineageId: 'resumptive-book-d'
              }),
              node('np_book_low_resumptive_partial_copy', 'NP', [
                silentLexicalNode('n_syu_low_resumptive_partial_copy', 'N', 'syu', {
                  lineageId: 'resumptive-book-n'
                })
              ], { silent: true, lineageId: 'resumptive-book-np' })
            ], { lineageId: 'resumptive-book-dp' })
          ])
        ])
      ])
    ])
  ])
]);

/** Vocabulary Insertion realizes the surviving lower D as default pronoun keoi. */
const resumptivePartialCopyRealizationTree = node('tp_resumptive_partial_copy', 'TP', [
  node('dp_nei_resumptive_partial_copy', 'DP', [
    leaf('d_nei_resumptive_partial_copy', 'D', 'Nei', { tokenIndex: 0 })
  ]),
  node('tbar_resumptive_partial_copy', "T'", [
    leaf('t_jiu_resumptive_partial_copy', 'T', 'jiu', { tokenIndex: 1 }),
    node('dispp_resumptive_partial_copy', 'DispP', [
      leaf('disp_zoeng_resumptive_partial_copy', 'Disp', 'zoeng', { tokenIndex: 2 }),
      node('vp_resumptive_partial_copy', 'vP', [
        node('dp_book_high_resumptive_partial_copy', 'DP', [
          leaf('d_di_high_resumptive_partial_copy', 'D', 'di', {
            tokenIndex: 3,
            lineageId: 'resumptive-book-d'
          }),
          node('np_book_high_resumptive_partial_copy', 'NP', [
            leaf('n_syu_high_resumptive_partial_copy', 'N', 'syu', {
              tokenIndex: 4,
              lineageId: 'resumptive-book-n'
            })
          ], { lineageId: 'resumptive-book-np' })
        ], { lineageId: 'resumptive-book-dp' }),
        node('vbar_resumptive_partial_copy', "v'", [
          nullHead('v_resumptive_partial_copy', 'v'),
          node('n1', 'VP', [
            leaf('v_taisaai_resumptive_partial_copy', 'V', 'tai-saai', { tokenIndex: 5 }),
            node('dp_book_low_resumptive_partial_copy', 'DP', [
              leaf('d_di_low_resumptive_partial_copy', 'D', 'keoi', {
                tokenIndex: 6,
                lineageId: 'resumptive-book-d'
              }),
              node('np_book_low_resumptive_partial_copy', 'NP', [
                silentLexicalNode('n_syu_low_resumptive_partial_copy', 'N', 'syu', {
                  lineageId: 'resumptive-book-n'
                })
              ], { silent: true, lineageId: 'resumptive-book-np' })
            ], { lineageId: 'resumptive-book-dp' })
          ])
        ])
      ])
    ])
  ])
]);

const sharingTree = node('coord_sharing', 'CoordP', [
  node('tp_shared_left', 'TP', [
    node('sam_shared', 'DP', [
      node('sam_shared_np', 'NP', [
        leaf('sam_shared_n', 'N', 'Sam')
      ])
    ]),
    node('vp_shared_left', 'VP', [
      leaf('v_caught_shared', 'V', 'caught')
    ])
  ]),
  node('coordbar_sharing', "Coord'", [
    leaf('and_sharing', 'Coord', 'and'),
    node('tp_shared_right', 'TP', [
      node('alex_shared', 'DP', [
      node('alex_shared_np', 'NP', [
        leaf('alex_shared_n', 'N', 'Alex')
      ])
    ]),
      node('vp_shared_right', 'VP', [
        leaf('v_cooked_shared', 'V', 'cooked'),
        node('book_shared', 'DP', [
          leaf('d_shared', 'D', 'a'),
          node('np_shared', 'NP', [
            leaf('n_shared', 'N', 'fish')
          ])
        ])
      ])
    ])
  ])
]);

/**
 * A tree-shaped serial-predicate structure for the object-sharing lens. The
 * syntax contains one overt object exactly once. ArgumentSharing contributes
 * only the two source-backed domain ovals and the OBJ marker.
 */
const argumentSharingTree = node('vp_argument_sharing', 'vP', [
  node('dp_wo_argument_sharing', 'DP', [
    node('np_wo_argument_sharing', 'NP', [
      leaf('n_wo_argument_sharing', 'N', 'Wo', { tokenIndex: 0 })
    ])
  ]),
  node('serialp_argument_sharing', 'SerialP', [
    node('vp_left_argument_sharing', 'VP', [
      leaf('v_da_argument_sharing', 'V', 'da', { tokenIndex: 1 })
    ]),
    node('vp_right_argument_sharing', 'VP', [
      node('dp_fufu_argument_sharing', 'DP', [
        node('np_fufu_argument_sharing', 'NP', [
          leaf('n_fufu_argument_sharing', 'N', 'fufu', { tokenIndex: 2 })
        ])
      ]),
      leaf('v_du_argument_sharing', 'V', 'du', { tokenIndex: 3 })
    ])
  ])
]);

/**
 * Hiraiwa and Bodomo's resultative SVC supplies a second geometry for the
 * same lens: the one object is linearly between the two serial predicates.
 */
const resultativeArgumentSharingTree = node('vp_argument_sharing_resultative', 'vP', [
  node('dp_subject_argument_sharing_resultative', 'DP', [
    node('np_subject_argument_sharing_resultative', 'NP', [
      leaf('n_subject_argument_sharing_resultative', 'N', 'N', { tokenIndex: 0 })
    ])
  ]),
  node('vbar_argument_sharing_resultative', "v'", [
    node('vp_left_argument_sharing_resultative', 'VP', [
      leaf('v_daa_argument_sharing_resultative', 'V', 'daa', { tokenIndex: 1 })
    ]),
    node('focp_argument_sharing_resultative', 'FocP', [
      leaf('foc_argument_sharing_resultative', 'Foc', 'la', { tokenIndex: 2 }),
      node('serialp_argument_sharing_resultative', 'SerialP', [
        node('dp_dakoraa_argument_sharing_resultative', 'DP', [
          node('np_dakoraa_argument_sharing_resultative', 'NP', [
            leaf('n_dakoraa_argument_sharing_resultative', 'N', 'Dakoraa', { tokenIndex: 3 })
          ])
        ]),
        node('vp_right_argument_sharing_resultative', 'VP', [
          leaf('v_loo_argument_sharing_resultative', 'V', 'loo', { tokenIndex: 4 })
        ])
      ])
    ])
  ])
]);

const pfAbstractTree = node('tp_pf', 'TP', [
  node('mia_pf', 'DP', [
      node('mia_pf_np', 'NP', [
        leaf('mia_pf_n', 'N', 'Mia', { tokenIndex: 0 })
      ])
    ]),
  node('tbar_pf', "T'", [
    node('t_past', 'T', [
      leaf('past_pf', '[past]', undefined, { silent: true })
    ]),
    node('vp_pf', 'vP', [
      node('v_pf', 'v', [
        leaf('root_laugh', '√LAUGH')
      ])
    ])
  ])
]);

const pfRealizedTree = node('tp_pf', 'TP', [
  node('mia_pf', 'DP', [
      node('mia_pf_np', 'NP', [
        leaf('mia_pf_n', 'N', 'Mia', { tokenIndex: 0 })
      ])
    ]),
  node('tbar_pf', "T'", [
    node('t_past', 'T', [
      leaf('past_pf', '[past]', undefined, { silent: true })
    ]),
    node('vp_pf', 'vP', [
      node('v_pf', 'v', [
        leaf('root_laugh', 'laughed', 'laughed', { tokenIndex: 1 })
      ])
    ])
  ])
]);

/** A complete abstract case phrase before its phrasal exponent is inserted. */
const phrasalSpellOutAbstractTree = node('datp_phrasal_spellout', 'DatP', [
  nullHead('dat_phrasal_spellout', 'Dat'),
  node('pp_phrasal_spellout', 'PP', [
    nullHead('p_phrasal_spellout', 'P'),
    node('np_mira_phrasal_spellout', 'NP', [
      leaf('n_mira_phrasal_spellout', '√MIRA')
    ])
  ])
]);

/** The same case phrase after PF exposes the complete surface token. */
const phrasalSpellOutRealizedTree = node('datp_phrasal_spellout', 'DatP', [
  nullHead('dat_phrasal_spellout', 'Dat'),
  node('pp_phrasal_spellout', 'PP', [
    nullHead('p_phrasal_spellout', 'P'),
    node('np_mira_phrasal_spellout', 'NP', [
      leaf('n_mira_phrasal_spellout', 'N', 'Mirának', { tokenIndex: 0 })
    ])
  ])
]);

/** A complete morphological word inspected by Yang's many-to-many PF map. */
const manyToManyPfTree = node('wordp_many_to_many_pf', 'WordP', [
  node('rootp_many_to_many_pf', 'RootP', [
    leaf('root_many_to_many_pf', 'Root', 'Ktab', { tokenIndex: 0 })
  ]),
  node('agrp_many_to_many_pf', 'AgrP', [
    leaf('agr_one_many_to_many_pf', 'Agr', '-u', { tokenIndex: 1 }),
    leaf('agr_two_many_to_many_pf', 'Agr', '-h', { tokenIndex: 2 })
  ])
]);

/** One Basque pronominal-clitic terminal before postsyntactic Fission. */
const fissionInputTree = node('auxp_fission', 'AuxP', [
  node('clitic_fission_input', 'Clitic', [
    leaf('clitic_bundle_fission_input', 'Agr', '[−author, +participant, +plural]', { silent: true })
  ]),
  node('aux_fission_input', 'Aux', [
    leaf('aux_stem_fission_input', 'V', 'aux')
  ])
]);

/** The same auxiliary after the clitic terminal is split into -su and -e. */
const fissionOutputTree = node('auxp_fission', 'AuxP', [
  node('cliticp_fission_output', 'CliticP', [
    node('clitic_person_fission_output', 'Clitic', [
      leaf('clitic_person_exponent_fission', 'Agr', '-su')
    ]),
    node('clitic_plural_fission_output', 'Clitic', [
      leaf('clitic_plural_exponent_fission', 'Num', '-e')
    ])
  ]),
  node('aux_fission_output', 'Aux', [
    leaf('aux_stem_fission_output', 'V', 'aux')
  ])
]);

/** Impoverishment changes the pronoun's feature geometry, not this syntax tree. */
const impoverishmentTree = node('tp_impoverishment', 'TP', [
  node('dp_you_impoverishment', 'DP', [
    leaf('d_you_impoverishment', 'D', 'You', { tokenIndex: 0 })
  ]),
  node('tbar_impoverishment', "T'", [
    silentLexicalNode('t_present_impoverishment', 'T', '[present]'),
    node('vp_impoverishment', 'VP', [
      leaf('v_arrive_impoverishment', 'V', 'arrive', { tokenIndex: 1 })
    ])
  ])
]);

/** Gong's derived PF input before string-vacuous rebracketing. */
const localDislocationInputTree = node('kp_local_dislocation', 'KP', [
  node('possp_local_dislocation', 'PossP', [
    node('np_local_dislocation', 'nP', [
      node('root_origin_local_dislocation', '√Root', [], {
        silent: true,
        lineageId: 'local-dislocation-root'
      }),
      node('n_complex_local_dislocation', 'n', [
        node('root_landed_local_dislocation', '√Root', [], {
          lineageId: 'local-dislocation-root'
        }),
        node('n_host_local_dislocation', 'n', [])
      ])
    ]),
    node('poss_complex_local_dislocation', 'Poss', [
      node('k_landed_local_dislocation', 'K', [], {
        lineageId: 'local-dislocation-k'
      }),
      node('poss_host_local_dislocation', 'Poss', [])
    ])
  ]),
  node('k_origin_local_dislocation', 'K', [], {
    silent: true,
    lineageId: 'local-dislocation-k'
  })
]);

/** The same derived heads with their explicit PF output witnesses. */
const localDislocationTree = node('kp_local_dislocation', 'KP', [
  node('possp_local_dislocation', 'PossP', [
    node('np_local_dislocation', 'nP', [
      node('root_origin_local_dislocation', '√Root', [], {
        silent: true,
        lineageId: 'local-dislocation-root'
      }),
      node('n_complex_local_dislocation', 'n', [
        node('root_landed_local_dislocation', '√Root', [], {
          word: 'Tery',
          tokenIndex: 0,
          lineageId: 'local-dislocation-root'
        }),
        node('n_host_local_dislocation', 'n', [])
      ])
    ]),
    node('poss_complex_local_dislocation', 'Poss', [
      node('k_landed_local_dislocation', 'K', [], {
        word: '-eer',
        tokenIndex: 1,
        lineageId: 'local-dislocation-k'
      }),
      node('poss_host_local_dislocation', 'Poss', [], {
        word: '-maan',
        tokenIndex: 2
      })
    ])
  ]),
  node('k_origin_local_dislocation', 'K', [], {
    silent: true,
    lineageId: 'local-dislocation-k'
  })
]);

const cyclicLicensedPriorTree = node('cbar_cyclic_licensed', "C'", [
    nullHead('c_cyclic_licensed', 'C'),
    node('tp_cyclic_licensed', 'TP', [
      node('dp_mia_cyclic_licensed', 'DP', [
        node('np_mia_cyclic_licensed', 'NP', [
          leaf('n_mia_cyclic_licensed', 'N', 'Mia', { tokenIndex: 0 })
        ])
      ]),
      node('tbar_cyclic_licensed', "T'", [
        silentLexicalNode('t_past_cyclic_licensed', 'T', '[past]'),
        node('vp_say_cyclic_licensed', 'VP', [
          leaf('v_say_cyclic_licensed', 'V', 'said', { tokenIndex: 1 }),
          node('cp_emb_cyclic_licensed', 'CP', [
            node('dp_which_book_cyclic_licensed_edge', 'DP', [
              leaf('d_which_cyclic_licensed_edge', 'D', 'which', {
                lineageId: 'cyclic-licensed-d'
              }),
              node('np_book_cyclic_licensed_edge', 'NP', [
                leaf('n_book_cyclic_licensed_edge', 'N', 'book', {
                  lineageId: 'cyclic-licensed-n'
                })
              ], { lineageId: 'cyclic-licensed-np' })
            ], { lineageId: 'cyclic-licensed-chain' }),
            node('cbar_emb_cyclic_licensed', "C'", [
              leaf('c_that_cyclic_licensed', 'C', 'that', { tokenIndex: 2 }),
              node('tp_emb_cyclic_licensed', 'TP', [
                node('dp_noa_cyclic_licensed', 'DP', [
                  node('np_noa_cyclic_licensed', 'NP', [
                    leaf('n_noa_cyclic_licensed', 'N', 'Noa', { tokenIndex: 3 })
                  ])
                ]),
                node('tbar_emb_cyclic_licensed', "T'", [
                  silentLexicalNode('t_past_emb_cyclic_licensed', 'T', '[past]'),
                  node('vp_read_cyclic_licensed', 'VP', [
                    leaf('v_read_cyclic_licensed', 'V', 'read', { tokenIndex: 4 }),
                    node('dp_which_book_cyclic_licensed_base', 'DP', [
                      leaf('d_which_cyclic_licensed_base', 'D', 't₁', {
                        lineageId: 'cyclic-licensed-d',
                        silent: true
                      }),
                      node('np_book_cyclic_licensed_base', 'NP', [
                        leaf('n_book_cyclic_licensed_base', 'N', 't₁', {
                          lineageId: 'cyclic-licensed-n',
                          silent: true
                        })
                      ], { lineageId: 'cyclic-licensed-np', silent: true })
                    ], { lineageId: 'cyclic-licensed-chain', silent: true })
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
]);

const cyclicLicensedTree = node('cp_cyclic_licensed', 'CP', [
  node('dp_which_book_cyclic_licensed_high', 'DP', [
    leaf('d_which_cyclic_licensed_high', 'D', 'Which', {
      lineageId: 'cyclic-licensed-d',
      tokenIndex: 0
    }),
    node('np_book_cyclic_licensed_high', 'NP', [
      leaf('n_book_cyclic_licensed_high', 'N', 'book', {
        lineageId: 'cyclic-licensed-n',
        tokenIndex: 1
      })
    ], { lineageId: 'cyclic-licensed-np' })
  ], { lineageId: 'cyclic-licensed-chain' }),
  node('cbar_cyclic_licensed', "C'", [
    nullHead('c_cyclic_licensed', 'C'),
    node('tp_cyclic_licensed', 'TP', [
      node('dp_mia_cyclic_licensed', 'DP', [
        node('np_mia_cyclic_licensed', 'NP', [
          leaf('n_mia_cyclic_licensed', 'N', 'Mia', { tokenIndex: 2 })
        ])
      ]),
      node('tbar_cyclic_licensed', "T'", [
        silentLexicalNode('t_past_cyclic_licensed', 'T', '[past]'),
        node('vp_say_cyclic_licensed', 'VP', [
          leaf('v_say_cyclic_licensed', 'V', 'said', { tokenIndex: 3 }),
          node('cp_emb_cyclic_licensed', 'CP', [
            node('dp_which_book_cyclic_licensed_edge', 'DP', [
              leaf('d_which_cyclic_licensed_edge', 'D', 't₁', {
                lineageId: 'cyclic-licensed-d',
                silent: true
              }),
              node('np_book_cyclic_licensed_edge', 'NP', [
                leaf('n_book_cyclic_licensed_edge', 'N', 't₁', {
                  lineageId: 'cyclic-licensed-n',
                  silent: true
                })
              ], { lineageId: 'cyclic-licensed-np', silent: true })
            ], { lineageId: 'cyclic-licensed-chain', silent: true }),
            node('cbar_emb_cyclic_licensed', "C'", [
              leaf('c_that_cyclic_licensed', 'C', 'that', { tokenIndex: 4 }),
              node('tp_emb_cyclic_licensed', 'TP', [
                node('dp_noa_cyclic_licensed', 'DP', [
                  node('np_noa_cyclic_licensed', 'NP', [
                    leaf('n_noa_cyclic_licensed', 'N', 'Noa', { tokenIndex: 5 })
                  ])
                ]),
                node('tbar_emb_cyclic_licensed', "T'", [
                  silentLexicalNode('t_past_emb_cyclic_licensed', 'T', '[past]'),
                  node('vp_read_cyclic_licensed', 'VP', [
                    leaf('v_read_cyclic_licensed', 'V', 'read', { tokenIndex: 6 }),
                    node('dp_which_book_cyclic_licensed_base', 'DP', [
                      leaf('d_which_cyclic_licensed_base', 'D', 't₁', {
                        lineageId: 'cyclic-licensed-d',
                        silent: true
                      }),
                      node('np_book_cyclic_licensed_base', 'NP', [
                        leaf('n_book_cyclic_licensed_base', 'N', 't₁', {
                          lineageId: 'cyclic-licensed-n',
                          silent: true
                        })
                      ], { lineageId: 'cyclic-licensed-np', silent: true })
                    ], { lineageId: 'cyclic-licensed-chain', silent: true })
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

const cyclicConflictPriorTree = node('cbar_cyclic_conflict', "C'", [
    nullHead('c_cyclic_conflict', 'C'),
    node('tp_cyclic_conflict', 'TP', [
      node('dp_mia_cyclic_conflict', 'DP', [
        node('np_mia_cyclic_conflict', 'NP', [
          leaf('n_mia_cyclic_conflict', 'N', 'Mia', { tokenIndex: 0 })
        ])
      ]),
      node('tbar_cyclic_conflict', "T'", [
        silentLexicalNode('t_past_cyclic_conflict', 'T', '[past]'),
        node('vp_say_cyclic_conflict', 'VP', [
          leaf('v_say_cyclic_conflict', 'V', 'said', { tokenIndex: 1 }),
          node('cp_emb_cyclic_conflict', 'CP', [
            node('cbar_emb_cyclic_conflict', "C'", [
              leaf('c_that_cyclic_conflict', 'C', 'that', { tokenIndex: 2 }),
              node('tp_emb_cyclic_conflict', 'TP', [
                node('dp_noa_cyclic_conflict', 'DP', [
                  node('np_noa_cyclic_conflict', 'NP', [
                    leaf('n_noa_cyclic_conflict', 'N', 'Noa', { tokenIndex: 3 })
                  ])
                ]),
                node('tbar_emb_cyclic_conflict', "T'", [
                  silentLexicalNode('t_past_emb_cyclic_conflict', 'T', '[past]'),
                  node('vp_read_cyclic_conflict', 'VP', [
                    leaf('v_read_cyclic_conflict', 'V', 'read', { tokenIndex: 4 }),
                    node('dp_which_book_cyclic_conflict_base', 'DP', [
                      leaf('d_which_cyclic_conflict_base', 'D', 'which', {
                        lineageId: 'cyclic-conflict-d',
                        tokenIndex: 5
                      }),
                      node('np_book_cyclic_conflict_base', 'NP', [
                        leaf('n_book_cyclic_conflict_base', 'N', 'book', {
                          lineageId: 'cyclic-conflict-n',
                          tokenIndex: 6
                        })
                      ], { lineageId: 'cyclic-conflict-np' })
                    ], { lineageId: 'cyclic-conflict-chain' })
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
]);

const cyclicConflictTree = node('cp_cyclic_conflict', 'CP', [
  node('dp_which_book_cyclic_conflict_high', 'DP', [
    leaf('d_which_cyclic_conflict_high', 'D', 'Which', {
      lineageId: 'cyclic-conflict-d',
      tokenIndex: 0
    }),
    node('np_book_cyclic_conflict_high', 'NP', [
      leaf('n_book_cyclic_conflict_high', 'N', 'book', {
        lineageId: 'cyclic-conflict-n',
        tokenIndex: 1
      })
    ], { lineageId: 'cyclic-conflict-np' })
  ], { lineageId: 'cyclic-conflict-chain' }),
  node('cbar_cyclic_conflict', "C'", [
    nullHead('c_cyclic_conflict', 'C'),
    node('tp_cyclic_conflict', 'TP', [
      node('dp_mia_cyclic_conflict', 'DP', [
        node('np_mia_cyclic_conflict', 'NP', [
          leaf('n_mia_cyclic_conflict', 'N', 'Mia', { tokenIndex: 2 })
        ])
      ]),
      node('tbar_cyclic_conflict', "T'", [
        silentLexicalNode('t_past_cyclic_conflict', 'T', '[past]'),
        node('vp_say_cyclic_conflict', 'VP', [
          leaf('v_say_cyclic_conflict', 'V', 'said', { tokenIndex: 3 }),
          node('cp_emb_cyclic_conflict', 'CP', [
            node('cbar_emb_cyclic_conflict', "C'", [
              leaf('c_that_cyclic_conflict', 'C', 'that', { tokenIndex: 4 }),
              node('tp_emb_cyclic_conflict', 'TP', [
                node('dp_noa_cyclic_conflict', 'DP', [
                  node('np_noa_cyclic_conflict', 'NP', [
                    leaf('n_noa_cyclic_conflict', 'N', 'Noa', { tokenIndex: 5 })
                  ])
                ]),
                node('tbar_emb_cyclic_conflict', "T'", [
                  silentLexicalNode('t_past_emb_cyclic_conflict', 'T', '[past]'),
                  node('vp_read_cyclic_conflict', 'VP', [
                    leaf('v_read_cyclic_conflict', 'V', 'read', { tokenIndex: 6 }),
                    node('dp_which_book_cyclic_conflict_base', 'DP', [
                      leaf('d_which_cyclic_conflict_base', 'D', 't₁', {
                        lineageId: 'cyclic-conflict-d',
                        silent: true
                      }),
                      node('np_book_cyclic_conflict_base', 'NP', [
                        leaf('n_book_cyclic_conflict_base', 'N', 't₁', {
                          lineageId: 'cyclic-conflict-n',
                          silent: true
                        })
                      ], { lineageId: 'cyclic-conflict-np', silent: true })
                    ], { lineageId: 'cyclic-conflict-chain', silent: true })
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

const qrScopeTree = node('tp_qr_lf', 'TP', [
  node('qp_every_book_high_lf', 'QP', [
    silentLexicalNode('q_every_high_lf', 'Q', 'every', { lineageId: 'qr-q' }),
    node('np_book_high_lf', 'NP', [
      silentLexicalNode('n_book_high_lf', 'N', 'book', { lineageId: 'qr-n' })
    ], { silent: true, lineageId: 'qr-np' })
  ], { silent: true, lineageId: 'qr-book' }),
  node('tp_qr_surface_lf', 'TP', [
    node('sue_qr_lf', 'DP', [
      node('sue_qr_lf_np', 'NP', [
        leaf('sue_qr_lf_n', 'N', 'Sue', { tokenIndex: 0 })
      ])
    ]),
    node('tbar_qr_lf', "T'", [
      nullHead('t_qr_lf', 'T'),
      node('vp_qr_lf', 'VP', [
        leaf('v_read_qr_lf', 'V', 'read', { tokenIndex: 1 }),
        node('qp_every_book_low_lf', 'QP', [
          leaf('q_every_low_lf', 'Q', 'every', { lineageId: 'qr-q', tokenIndex: 2 }),
          node('np_book_low_lf', 'NP', [
            leaf('n_book_low_lf', 'N', 'book', { lineageId: 'qr-n', tokenIndex: 3 })
          ], { lineageId: 'qr-np' })
        ], { lineageId: 'qr-book' })
      ])
    ])
  ])
]);

/* Cooper storage keeps the syntax ordinary and attaches its ledger to it. */
const cooperStorageTree = node('s_cooper_storage', 'S', [
  node('np_someone_cooper_storage', 'NP', [
    leaf('n_someone_cooper_storage', 'N', 'Someone', { tokenIndex: 0 })
  ]),
  node('vp_cooper_storage', 'VP', [
    leaf('v_saw_cooper_storage', 'V', 'saw', { tokenIndex: 1 }),
    node('np_everyone_cooper_storage', 'NP', [
      leaf('n_everyone_cooper_storage', 'N', 'everyone', { tokenIndex: 2 })
    ])
  ])
]);

/* A normal clause carrying the source's I-to-DP negative-concord relation. */
const negativeConcordAccordTree = node('ip_accord', 'IP', [
  node('ibar_accord', "I'", [
    leaf('i_neg_accord', 'I', 'Ma-', { tokenIndex: 0 }),
    node('vp_accord', 'VP', [
      leaf('v_saw_accord', 'V', 'saw', { tokenIndex: 1 }),
      node('dp_nword_accord', 'DP', [
        leaf('d_even_accord', 'D', 'even', { tokenIndex: 2 }),
        node('np_one_accord', 'NP', [
          leaf('n_one_accord', 'N', 'one', { tokenIndex: 3 })
        ])
      ])
    ])
  ])
]);

/* The successful strong-NPI configuration from the source's lower-right tree. */
const strongNpiLicensingTree = node('exhp_strong_npi', 'ExhP', [
  nullHead('exh_strong_npi', 'Exh'),
  node('onlyp_strong_npi', 'OnlyP', [
    leaf('only_strong_npi', 'Adv', 'Only', { tokenIndex: 0 }),
    node('tp_strong_npi', 'TP', [
      node('dp_mia_strong_npi', 'DP', [
        node('np_mia_strong_npi', 'NP', [
          leaf('n_mia_strong_npi', 'N', 'Mia', { tokenIndex: 1 })
        ])
      ]),
      node('tbar_strong_npi', "T'", [
        silentLexicalNode('t_past_strong_npi', 'T', '[past]'),
        node('vp_strong_npi', 'VP', [
          leaf('v_lifted_strong_npi', 'V', 'lifted', { tokenIndex: 2 }),
          node('dp_finger_strong_npi', 'DP', [
            leaf('d_a_strong_npi', 'D', 'a', { tokenIndex: 3 }),
            node('np_finger_strong_npi', 'NP', [
              leaf('n_finger_strong_npi', 'N', 'finger', { tokenIndex: 4 })
            ])
          ])
        ])
      ])
    ])
  ])
]);

/* Source-faithful F-projection over an ordinary authored syntax tree. */
const fProjectionTree = node('ip_f_projection', 'IP', [
  node('dp_she_f_projection', 'DP', [
    leaf('d_she_f_projection', 'D', 'She', { tokenIndex: 0 })
  ]),
  node('ibar_f_projection', "I'", [
    silentLexicalNode('i_past_f_projection', 'I', '[past]'),
    node('vp_f_projection', 'VP', [
      leaf('v_praised_f_projection', 'V', 'praised', { tokenIndex: 1 }),
      node('dp_john_f_projection', 'DP', [
        leaf('d_john_f_projection', 'D', 'John', { tokenIndex: 2 })
      ])
    ])
  ])
]);

const operatorVariableBindingTree = node('tp_scope_outer_ovb', 'TP', [
  node('qp_every_critic_ovb', 'QP', [
    leaf('q_every_critic_ovb', 'Q', 'Every', { tokenIndex: 0 }),
    node('np_critic_ovb', 'NP', [
      leaf('n_critic_ovb', 'N', 'critic', { tokenIndex: 1 })
    ])
  ]),
  node('tbar_scope_outer_body_ovb', "T'", [
    silentLexicalNode('t_past_outer_ovb', 'T', '[past]'),
    node('vp_told_outer_ovb', 'VP', [
      leaf('v_told_outer_ovb', 'V', 'told', { tokenIndex: 2 }),
      node('applp_scope_middle_ovb', 'ApplP', [
        node('qp_some_author_ovb', 'QP', [
          leaf('q_some_author_ovb', 'Q', 'some', { tokenIndex: 3 }),
          node('np_author_ovb', 'NP', [
            leaf('n_author_ovb', 'N', 'author', { tokenIndex: 4 })
          ])
        ]),
        node('cp_scope_middle_ovb', 'CP', [
          leaf('c_that_middle_ovb', 'C', 'that', { tokenIndex: 5 }),
          node('tp_scope_inner_ovb', 'TP', [
            node('qp_every_editor_ovb', 'QP', [
              leaf('q_every_editor_ovb', 'Q', 'every', { tokenIndex: 6 }),
              node('np_editor_ovb', 'NP', [
                leaf('n_editor_ovb', 'N', 'editor', { tokenIndex: 7 })
              ])
            ]),
            node('tbar_scope_inner_body_ovb', "T'", [
              silentLexicalNode('t_past_inner_ovb', 'T', '[past]'),
              node('vp_inner_scope_ovb', 'VP', [
                node('vp_inner_with_scope_ovb', 'VP', [
                  node('vbar_filed_scope_ovb', "V'", [
                    leaf('v_filed_ovb', 'V', 'filed', { tokenIndex: 8 }),
                    node('dp_report_ovb', 'DP', [
                      leaf('d_their_report_ovb', 'D', 'their', { tokenIndex: 9 }),
                      node('np_report_ovb', 'NP', [
                        leaf('n_report_ovb', 'N', 'report', { tokenIndex: 10 })
                      ])
                    ])
                  ]),
                  node('pp_notes_ovb', 'PP', [
                    leaf('p_with_notes_ovb', 'P', 'with', { tokenIndex: 11 }),
                    node('dp_notes_ovb', 'DP', [
                      leaf('d_their_notes_ovb', 'D', 'their', { tokenIndex: 12 }),
                      node('np_notes_ovb', 'NP', [
                        leaf('n_notes_ovb', 'N', 'notes', { tokenIndex: 13 })
                      ])
                    ])
                  ])
                ]),
                node('pp_office_ovb', 'PP', [
                  leaf('p_in_office_ovb', 'P', 'in', { tokenIndex: 14 }),
                  node('dp_office_ovb', 'DP', [
                    leaf('d_their_office_ovb', 'D', 'their', { tokenIndex: 15 }),
                    node('np_office_ovb', 'NP', [
                      leaf('n_office_ovb', 'N', 'office', { tokenIndex: 16 })
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

const lfReconstructionTree = node('cp_reconstruction_lf', 'CP', [
  node('dp_picture_high_lf', 'DP', [
    leaf('d_which_picture_high_lf', 'D', 'Which', { lineageId: 'recon-d', tokenIndex: 0 }),
    node('np_picture_high_lf', 'NP', [
      leaf('n_picture_high_lf', 'N', 'picture', { lineageId: 'recon-n', tokenIndex: 1 }),
      node('pp_himself_high_lf', 'PP', [
        leaf('p_of_high_lf', 'P', 'of', { lineageId: 'recon-of', tokenIndex: 2 }),
        node('dp_himself_high_lf', 'DP', [
          leaf('d_himself_high_lf', 'D', 'himself', { lineageId: 'recon-himself-d', tokenIndex: 3 })
        ], { lineageId: 'recon-himself' })
      ])
    ], { lineageId: 'recon-np' })
  ], { lineageId: 'recon-picture' }),
  node('cbar_reconstruction_lf', "C'", [
    leaf('c_did_reconstruction_lf', 'C', 'did', { tokenIndex: 4 }),
    node('tp_reconstruction_lf', 'TP', [
      node('dp_every_student_lf', 'DP', [
        leaf('d_every_student_lf', 'D', 'every', { tokenIndex: 5 }),
        node('np_student_lf', 'NP', [
          leaf('n_student_lf', 'N', 'student', { tokenIndex: 6 })
        ])
      ]),
      node('tbar_reconstruction_lf', "T'", [
        nullHead('t_reconstruction_lf', 'T'),
        node('vp_reconstruction_lf', 'VP', [
          leaf('v_file_reconstruction_lf', 'V', 'file', { tokenIndex: 7 }),
          node('dp_picture_low_lf', 'DP', [
            silentLexicalNode('d_which_picture_low_lf', 'D', 'which', { lineageId: 'recon-d' }),
            node('np_picture_low_lf', 'NP', [
              silentLexicalNode('n_picture_low_lf', 'N', 'picture', { lineageId: 'recon-n' }),
              node('pp_himself_low_lf', 'PP', [
                silentLexicalNode('p_of_low_lf', 'P', 'of', { lineageId: 'recon-of' }),
                node('dp_himself_low_lf', 'DP', [
                  silentLexicalNode('d_himself_low_lf', 'D', 'himself', { lineageId: 'recon-himself-d' })
                ], { silent: true, lineageId: 'recon-himself' })
              ], { silent: true })
            ], { silent: true, lineageId: 'recon-np' })
          ], { silent: true, lineageId: 'recon-picture' })
        ])
      ])
    ])
  ])
]);

/**
 * A structurally different reconstruction context: a fronted AP is pronounced
 * high but interpreted in its silent predicate position, where the matrix
 * subject can bind the reflexive inside it.
 */
const lfPredicateReconstructionTree = node('cp_proud_reconstruction_lf', 'CP', [
  node('ap_proud_high_lf', 'AP', [
    node('degp_how_high_lf', 'DegP', [
      leaf('deg_how_high_lf', 'Deg', 'How', { lineageId: 'recon-proud-how', tokenIndex: 0 })
    ]),
    node('abar_proud_high_lf', "A'", [
      leaf('a_proud_high_lf', 'A', 'proud', { lineageId: 'recon-proud-a', tokenIndex: 1 }),
      node('pp_himself_proud_high_lf', 'PP', [
        leaf('p_of_proud_high_lf', 'P', 'of', { lineageId: 'recon-proud-of', tokenIndex: 2 }),
        node('dp_himself_proud_high_lf', 'DP', [
          leaf('d_himself_proud_high_lf', 'D', 'himself', {
            lineageId: 'recon-proud-himself-d',
            tokenIndex: 3
          })
        ], { lineageId: 'recon-proud-himself' })
      ])
    ])
  ], { lineageId: 'recon-proud-ap' }),
  node('cbar_proud_reconstruction_lf', "C'", [
    leaf('c_does_proud_reconstruction_lf', 'C', 'does', { tokenIndex: 4 }),
    node('tp_proud_reconstruction_lf', 'TP', [
      node('dp_john_proud_reconstruction_lf', 'DP', [
        leaf('d_john_proud_reconstruction_lf', 'D', 'John', { tokenIndex: 5 })
      ]),
      node('tbar_proud_reconstruction_lf', "T'", [
        nullHead('t_proud_reconstruction_lf', 'T'),
        node('vp_seem_proud_reconstruction_lf', 'VP', [
          leaf('v_seem_proud_reconstruction_lf', 'V', 'seem', { tokenIndex: 6 }),
          node('tp_inf_proud_reconstruction_lf', 'TP', [
            leaf('t_to_proud_reconstruction_lf', 'T', 'to', { tokenIndex: 7 }),
            node('vp_be_proud_reconstruction_lf', 'VP', [
              leaf('v_be_proud_reconstruction_lf', 'V', 'be', { tokenIndex: 8 }),
              node('ap_proud_low_lf', 'AP', [
                node('degp_how_low_lf', 'DegP', [
                  silentLexicalNode('deg_how_low_lf', 'Deg', 'how', { lineageId: 'recon-proud-how' })
                ], { silent: true }),
                node('abar_proud_low_lf', "A'", [
                  silentLexicalNode('a_proud_low_lf', 'A', 'proud', { lineageId: 'recon-proud-a' }),
                  node('pp_himself_proud_low_lf', 'PP', [
                    silentLexicalNode('p_of_proud_low_lf', 'P', 'of', { lineageId: 'recon-proud-of' }),
                    node('dp_himself_proud_low_lf', 'DP', [
                      silentLexicalNode('d_himself_proud_low_lf', 'D', 'himself', {
                        lineageId: 'recon-proud-himself-d'
                      })
                    ], { silent: true, lineageId: 'recon-proud-himself' })
                  ], { silent: true })
                ], { silent: true })
              ], { silent: true, lineageId: 'recon-proud-ap' })
            ])
          ])
        ])
      ])
    ])
  ])
]);

/**
 * Plain focus marking: no focus-sensitive operator, so nothing in the tree
 * conflates prominence with association. The same fixture serves subject focus
 * and object focus, which is what shows the drawing is anchor-driven.
 */
const focusMarkingTree = node('tp_focus', 'TP', [
  node('mia_focus', 'DP', [
      node('mia_focus_np', 'NP', [
        leaf('mia_focus_n', 'N', 'Mia', { tokenIndex: 0 })
      ])
    ]),
  node('tbar_focus', "T'", [
    silentLexicalNode('t_focus', 'T', '[past]'),
    node('vp_focus', 'VP', [
      leaf('v_read_focus', 'V', 'read', { tokenIndex: 1 }),
      node('dp_book_focus', 'DP', [
        leaf('d_the_focus', 'D', 'the', { tokenIndex: 2 }),
        node('np_book_focus', 'NP', [
          leaf('n_book_focus', 'N', 'book', { tokenIndex: 3 })
        ])
      ])
    ])
  ])
]);

const thetaRoleTree = node('vp_theta', 'vP', [
  node('agent_ray_theta', 'DP', [
      node('agent_ray_theta_np', 'NP', [
        leaf('agent_ray_theta_n', 'N', 'Ray', { tokenIndex: 0 })
      ])
    ]),
  node('vbar_theta', "v'", [
    nullHead('v_light_theta', 'v'),
    node('vp_arguments_theta', 'VP', [
      node('vbar_arguments_theta', "V'", [
        leaf('v_gave_theta', 'V', 'gave', { tokenIndex: 1 }),
        node('dp_grape_theta', 'DP', [
          leaf('d_grape_theta', 'D', 'a', { tokenIndex: 2 }),
          node('np_grape_theta', 'NP', [
            leaf('n_grape_theta', 'N', 'grape', { tokenIndex: 3 })
          ])
        ])
      ]),
      node('pp_goal_theta', 'PP', [
        leaf('p_to_theta', 'P', 'to', { tokenIndex: 4 }),
        node('goal_bill_theta', 'DP', [
          node('goal_bill_theta_np', 'NP', [
            leaf('goal_bill_theta_n', 'N', 'Bill', { tokenIndex: 5 })
          ])
        ])
      ])
    ])
  ])
]);

const interventionTree = node('cp_intervention', 'CP', [
  node('dp_what_intervention_high', 'DP', [
    leaf('d_what_intervention_high', 'D', 'What', {
      lineageId: 'intervention-object-d',
      tokenIndex: 0
    })
  ], { lineageId: 'intervention-object-chain' }),
  node('cbar_intervention', "C'", [
    leaf('c_do_intervention', 'C', 'do', { tokenIndex: 1 }),
    node('tp_intervention', 'TP', [
      node('dp_you_intervention', 'DP', [
        leaf('d_you_intervention', 'D', 'you', { tokenIndex: 2 })
      ]),
      node('tbar_intervention', "T'", [
        nullHead('t_intervention', 'T'),
        node('vp_intervention', 'VP', [
          leaf('v_wonder_intervention', 'V', 'wonder', { tokenIndex: 3 }),
          node('cp_emb_intervention', 'CP', [
            node('dp_wh_subject_intervention_high', 'DP', [
              leaf('d_wh_subject_intervention_high', 'D', 'which', {
                lineageId: 'intervention-subject-d',
                tokenIndex: 4
              }),
              node('np_wh_subject_intervention_high', 'NP', [
                leaf('n_wh_subject_intervention_high', 'N', 'student', {
                  lineageId: 'intervention-subject-n',
                  tokenIndex: 5
                })
              ], { lineageId: 'intervention-subject-np' })
            ], { lineageId: 'intervention-subject-chain' }),
            node('cbar_emb_intervention', "C'", [
              nullHead('c_emb_intervention', 'C'),
              node('tp_emb_intervention', 'TP', [
                node('dp_wh_subject_intervention_low', 'DP', [
                  leaf('d_wh_subject_intervention_low', 'D', 't₁', {
                    lineageId: 'intervention-subject-d',
                    silent: true
                  }),
                  node('np_wh_subject_intervention_low', 'NP', [
                    leaf('n_wh_subject_intervention_low', 'N', 't₁', {
                      lineageId: 'intervention-subject-n',
                      silent: true
                    })
                  ], { silent: true, lineageId: 'intervention-subject-np' })
                ], { silent: true, lineageId: 'intervention-subject-chain' }),
                node('tbar_emb_intervention', "T'", [
                  nullHead('t_emb_intervention', 'T'),
                  node('vp_emb_intervention', 'VP', [
                    leaf('v_bought_intervention', 'V', 'bought', { tokenIndex: 6 }),
                    node('dp_what_intervention_low', 'DP', [
                      silentLexicalNode('d_what_intervention_low', 'D', 't₂', {
                        lineageId: 'intervention-object-d'
                      })
                    ], { silent: true, lineageId: 'intervention-object-chain' })
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

const interventionObjectBaseTree = replaceSyntaxNode(
  withoutLandingTree(interventionTree, 'dp_what_intervention_high', ['cp_intervention']),
  'dp_what_intervention_low',
  node('dp_what_intervention_low', 'DP', [
    leaf('d_what_intervention_low', 'D', 'What', {
      lineageId: 'intervention-object-d',
      tokenIndex: 0
    })
  ], { lineageId: 'intervention-object-chain' })
);

const interventionBothBaseTree = movementBaseTree(
  interventionObjectBaseTree,
  'dp_wh_subject_intervention_high',
  'dp_wh_subject_intervention_low',
  ['cp_emb_intervention']
);


/**
 * Lowering inside an embedded clause; matrix tense is present and unaffected.
 * Same witness discipline as the root-clause card: the base tree holds the
 * embedded affix at its T origin, the lowered tree keeps a silent occurrence
 * there and realizes the affix inside the embedded complex V head.
 */
const embeddedLoweringBaseTree = node('tp_lower2', 'TP', [
  node('mia_lower2', 'DP', [
      node('mia_lower2_np', 'NP', [
        leaf('mia_lower2_n', 'N', 'Mia')
      ])
    ]),
  node('tbar_lower2', "T'", [
    silentLexicalNode('t_matrix_lower2', 'T', '[past]'),
    node('vp_lower2', 'VP', [
      leaf('v_said_lower2', 'V', 'said'),
      node('cp_lower2', 'CP', [
        nullHead('c_lower2', 'C'),
        node('tp_emb_lower2', 'TP', [
          node('noa_lower2', 'DP', [
      node('noa_lower2_np', 'NP', [
        leaf('noa_lower2_n', 'N', 'Noa')
      ])
    ]),
          node('tbar_emb_lower2', "T'", [
            leaf('t_affix_lower2', 'T', '-ed', { lineageId: 'embedded-lowering-affix' }),
            node('vp_emb_lower2', 'VP', [
              leaf('v_walk_lower2', 'V', 'walk')
            ])
          ])
        ])
      ])
    ])
  ])
]);

const embeddedLoweringTree = node('tp_lower2', 'TP', [
  node('mia_lower2', 'DP', [
      node('mia_lower2_np', 'NP', [
        leaf('mia_lower2_n', 'N', 'Mia')
      ])
    ]),
  node('tbar_lower2', "T'", [
    silentLexicalNode('t_matrix_lower2', 'T', '[past]'),
    node('vp_lower2', 'VP', [
      leaf('v_said_lower2', 'V', 'said'),
      node('cp_lower2', 'CP', [
        nullHead('c_lower2', 'C'),
        node('tp_emb_lower2', 'TP', [
          node('noa_lower2', 'DP', [
      node('noa_lower2_np', 'NP', [
        leaf('noa_lower2_n', 'N', 'Noa')
      ])
    ]),
          node('tbar_emb_lower2', "T'", [
            leaf('t_affix_lower2', 'T', 't₁', { silent: true, lineageId: 'embedded-lowering-affix' }),
            node('vp_emb_lower2', 'VP', [
              node('v_walk_complex_lower2', 'V', [
                leaf('v_walk_lower2', 'V', 'walk'),
                leaf('t_affix_low_lower2', 'T', '-ed', { lineageId: 'embedded-lowering-affix' })
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);


/** Subject-position variable: the bound gap is the subject, not the object. */
const subjectOperatorVariableTree = node('cp_opvar2', 'CP', [
  node('dp_who_opvar2', 'DP', [
    leaf('d_who_opvar2', 'D', 'Who', { lineageId: 'who-subject-d', tokenIndex: 0 })
  ], { lineageId: 'who-subject-chain' }),
  node('cbar_opvar2', "C'", [
    nullHead('c_opvar2', 'C'),
    node('tp_opvar2', 'TP', [
      node('dp_who_variable_opvar2', 'DP', [
        node('d_who_variable_opvar2', 'D', [
          leaf('who_variable_trace_opvar2', 't', undefined, {
            silent: true,
            lineageId: 'who-subject-d'
          })
        ], {
          silent: true,
          lineageId: 'who-subject-d'
        })
      ], { silent: true, lineageId: 'who-subject-chain' }),
      node('tbar_opvar2', "T'", [
        silentLexicalNode('t_opvar2', 'T', '[past]'),
        node('vp_opvar2', 'VP', [
          leaf('v_left_opvar2', 'V', 'left', { tokenIndex: 1 })
        ])
      ])
    ])
  ])
]);

/** Inverse scope: the object quantifier raises over an indefinite subject. */
const inverseScopeTree = node('tp_qr2_top', 'TP', [
  node('qp_every_high_qr2', 'QP', [
    silentLexicalNode('d_every_high_qr2', 'D', 'every', { lineageId: 'every-book-d-qr2' }),
    node('np_book_high_qr2', 'NP', [
      silentLexicalNode('n_book_high_qr2', 'N', 'book', { lineageId: 'every-book-n-qr2' })
    ], { silent: true, lineageId: 'every-book-np-qr2' })
  ], { silent: true, lineageId: 'every-book-qr2' }),
  node('tp_qr2_surface', 'TP', [
    node('dp_someone_qr2', 'DP', [
      node('dp_someone_qr2_np', 'NP', [
        leaf('dp_someone_qr2_n', 'N', 'Someone', { tokenIndex: 0 })
      ])
    ]),
    node('tbar_qr2', "T'", [
      silentLexicalNode('t_qr2', 'T', '[past]'),
      node('vp_qr2', 'VP', [
        leaf('v_read_qr2', 'V', 'read', { tokenIndex: 1 }),
        node('qp_every_low_qr2', 'QP', [
          leaf('d_every_low_qr2', 'D', 'every', { lineageId: 'every-book-d-qr2', tokenIndex: 2 }),
          node('np_book_low_qr2', 'NP', [
            leaf('n_book_low_qr2', 'N', 'book', { lineageId: 'every-book-n-qr2', tokenIndex: 3 })
          ], { lineageId: 'every-book-np-qr2' })
        ], { lineageId: 'every-book-qr2' })
      ])
    ])
  ])
]);




/** Two occurrences of one object in an A-chain, not an A-bar chain. */
const passiveIdentityBaseTree = node('tbar_id2', "T'", [
  leaf('t_was_id2', 'T', 'was', { tokenIndex: 0 }),
  node('vp_id2', 'VP', [
    leaf('v_read_id2', 'V', 'read', { tokenIndex: 1 }),
    node('dp_book_low_id2', 'DP', [
      leaf('d_the_low_id2', 'D', 'the', { lineageId: 'book-d-id2', tokenIndex: 2 }),
      node('np_book_low_id2', 'NP', [
        leaf('n_book_low_id2', 'N', 'book', { lineageId: 'book-n-id2', tokenIndex: 3 })
      ], { lineageId: 'book-np-id2' })
    ], { lineageId: 'book-chain-id2' })
  ])
]);

const passiveIdentityTree = node('tp_id2', 'TP', [
  node('dp_book_high_id2', 'DP', [
    leaf('d_the_high_id2', 'D', 'The', { lineageId: 'book-d-id2', tokenIndex: 0 }),
    node('np_book_high_id2', 'NP', [
      leaf('n_book_high_id2', 'N', 'book', { lineageId: 'book-n-id2', tokenIndex: 1 })
    ], { lineageId: 'book-np-id2' })
  ], { lineageId: 'book-chain-id2' }),
  node('tbar_id2', "T'", [
    leaf('t_was_id2', 'T', 'was', { tokenIndex: 2 }),
    node('vp_id2', 'VP', [
      leaf('v_read_id2', 'V', 'read', { tokenIndex: 3 }),
      node('dp_book_low_id2', 'DP', [
        silentLexicalNode('d_the_low_id2', 'D', 't₁', { lineageId: 'book-d-id2' }),
        node('np_book_low_id2', 'NP', [
          silentLexicalNode('n_book_low_id2', 'N', 't₁', { lineageId: 'book-n-id2' })
        ], { silent: true, lineageId: 'book-np-id2' })
      ], { silent: true, lineageId: 'book-chain-id2' })
    ])
  ])
]);


/** Object control: the controller is the matrix object, not the matrix subject. */
const objectControlTree = node('tp_ctrl2', 'TP', [
  node('mia_ctrl2', 'DP', [
      node('mia_ctrl2_np', 'NP', [
        leaf('mia_ctrl2_n', 'N', 'Mia', { tokenIndex: 0 })
      ])
    ]),
  node('tbar_ctrl2', "T'", [
    silentLexicalNode('t_ctrl2', 'T', '[past]'),
    node('vp_shell_ctrl2', 'vP', [
      leaf('v_persuaded_ctrl2', 'v', 'persuaded', { tokenIndex: 1 }),
      node('vp_inner_ctrl2', 'VP', [
        node('noa_ctrl2', 'DP', [
      node('noa_ctrl2_np', 'NP', [
        leaf('noa_ctrl2_n', 'N', 'Noa', { tokenIndex: 2 })
      ])
    ]),
        node('tp_inf_ctrl2', 'TP', [
          silentLexicalNode('pro_ctrl2', 'DP', 'PRO'),
          node('tbar_inf_ctrl2', "T'", [
            leaf('t_to_ctrl2', 'T', 'to', { tokenIndex: 3 }),
            node('vp_inf_ctrl2', 'VP', [
              leaf('v_leave_ctrl2', 'V', 'leave', { tokenIndex: 4 })
            ])
          ])
        ])
      ])
    ])
  ])
]);


/** Coreference across coordination rather than into an embedded clause. */
const coordinateCoreferenceTree = node('coordp_coref2', 'CoordP', [
  node('tp_coref2_first', 'TP', [
    node('noa_coref2', 'DP', [
      node('noa_coref2_np', 'NP', [
        leaf('noa_coref2_n', 'N', 'Noa', { tokenIndex: 0 })
      ])
    ], { lineageId: 'noa-coref2' }),
    node('tbar_coref2_first', "T'", [
      silentLexicalNode('t_coref2_first', 'T', '[past]'),
      node('vp_coref2_first', 'VP', [
        leaf('v_arrived_coref2', 'V', 'arrived', { tokenIndex: 1 })
      ])
    ])
  ]),
  node('coordbar_coref2', "Coord'", [
    leaf('coord_coref2', 'Coord', 'and', { tokenIndex: 2 }),
    node('tp_coref2_second', 'TP', [
      node('she_coref2', 'DP', [
      leaf('she_coref2_d', 'D', 'she', { tokenIndex: 3 })
    ], { lineageId: 'noa-coref2' }),
      node('tbar_coref2_second', "T'", [
        silentLexicalNode('t_coref2_second', 'T', '[past]'),
        node('vp_coref2_second', 'VP', [
          leaf('v_waved_coref2', 'V', 'waved', { tokenIndex: 4 })
        ])
      ])
    ])
  ])
]);


/** Sluicing: wh-movement leaves its lower occurrence inside the silent TP. */
const sluicingTree = node('coordp_sluice', 'CoordP', [
  node('tp_sluice_antecedent', 'TP', [
    node('mia_sluice', 'DP', [
      node('mia_sluice_np', 'NP', [
        leaf('mia_sluice_n', 'N', 'Mia', { tokenIndex: 0 })
      ])
    ]),
    node('tbar_sluice_first', "T'", [
      silentLexicalNode('t_sluice_first', 'T', '[past]'),
      node('vp_sluice_first', 'VP', [
        leaf('v_left_sluice', 'V', 'left', { tokenIndex: 1 })
      ])
    ])
  ]),
  node('coordbar_sluice', "Coord'", [
    leaf('coord_sluice', 'Coord', 'but', { tokenIndex: 2 }),
    node('tp_sluice_matrix', 'TP', [
      node('noa_sluice', 'DP', [
      node('noa_sluice_np', 'NP', [
        leaf('noa_sluice_n', 'N', 'Noa', { tokenIndex: 3 })
      ])
    ]),
      node('tbar_sluice_second', "T'", [
        silentLexicalNode('t_sluice_second', 'T', '[pres]'),
        node('vp_sluice_second', 'VP', [
          leaf('v_knows_sluice', 'V', 'knows', { tokenIndex: 4 }),
          node('cp_sluice', 'CP', [
            node('why_sluice', 'AdvP', [
              leaf('why_sluice_adv', 'Adv', 'why', {
                tokenIndex: 5,
                lineageId: 'why-sluice-adv'
              })
            ], { lineageId: 'why-sluice-chain' }),
            node('cbar_sluice', "C'", [
              nullHead('c_sluice', 'C'),
              node('tp_sluice_site', 'TP', [
                silentLexicalNode('dp_mia_sluice_site', 'DP', 'Mia'),
                node('tbar_sluice_site', "T'", [
                  silentLexicalNode('t_sluice_site', 'T', '[past]'),
                  node('vp_sluice_site', 'VP', [
                    silentLexicalNode('v_left_sluice_site', 'V', 'left'),
                    node('why_sluice_low', 'AdvP', [
                      leaf('why_sluice_low_adv', 'Adv', 't₁', {
                        silent: true,
                        lineageId: 'why-sluice-adv'
                      })
                    ], { silent: true, lineageId: 'why-sluice-chain' })
                  ], { silent: true })
                ], { silent: true })
              ], { silent: true })
            ])
          ])
        ])
      ])
    ])
  ])
]);

const sluicingAntecedentTree = requiredSyntaxSubtree(sluicingTree, 'tp_sluice_antecedent');
const sluicingEmbeddedTree = requiredSyntaxSubtree(sluicingTree, 'cp_sluice');
const sluicingEmbeddedBaseTree = movementBaseTree(
  sluicingEmbeddedTree,
  'why_sluice',
  'why_sluice_low',
  ['cp_sluice']
);


/** Superiority: the lower wh-object cannot cross the closer wh-subject. */
const superiorityTree = node('cp_sup', 'CP', [
  node('dp_who_sup', 'DP', [
    leaf('d_who_sup', 'D', 'Who', { lineageId: 'who-sup-d', tokenIndex: 0 })
  ], { lineageId: 'who-sup-chain' }),
  node('cbar_sup', "C'", [
    nullHead('c_sup', 'C'),
    node('tp_sup', 'TP', [
      node('dp_who_low_sup', 'DP', [
        silentLexicalNode('d_who_low_sup', 'D', 't₁', { lineageId: 'who-sup-d' })
      ], { silent: true, lineageId: 'who-sup-chain' }),
      node('tbar_sup', "T'", [
        silentLexicalNode('t_sup', 'T', '[past]'),
        node('vp_sup', 'VP', [
          leaf('v_bought_sup', 'V', 'bought', { tokenIndex: 1 }),
          node('dp_what_sup', 'DP', [
            leaf('d_what_sup', 'D', 'what', { tokenIndex: 2 })
          ])
        ])
      ])
    ])
  ])
]);


/** Agreement with a postverbal associate across an expletive subject. */
const expletiveAgreeTree = node('tp_agr2', 'TP', [
  node('there_agr2', 'DP', [
      leaf('there_agr2_d', 'D', 'There', { tokenIndex: 0 })
    ]),
  node('tbar_agr2', "T'", [
    silentLexicalNode('t_probe_agr2', 'T', '[uφ]'),
    node('vp_agr2', 'vP', [
      leaf('v_arrive_agr2', 'v', 'arrive', { tokenIndex: 1 }),
      node('dp_girls_agr2', 'DP', [
        leaf('d_three_agr2', 'D', 'three', { tokenIndex: 2 }),
        node('np_girls_agr2', 'NP', [
          leaf('n_girls_agr2', 'N', 'girls', { tokenIndex: 3 })
        ])
      ])
    ])
  ])
]);


/**
 * Suppletion: root and tense are realized together by a single exponent, so the
 * realization is one step rather than an affixation sequence.
 */
const suppletionAbstractTree = node('tp_pf2', 'TP', [
  node('mia_pf2', 'DP', [
      node('mia_pf2_np', 'NP', [
        leaf('mia_pf2_n', 'N', 'Mia', { tokenIndex: 0 })
      ])
    ]),
  node('tbar_pf2', "T'", [
    node('t_past_pf2', 'T', [
      leaf('past_pf2', '[past]', undefined, { silent: true })
    ]),
    node('vp_pf2', 'vP', [
      node('v_pf2', 'v', [
        leaf('root_go_pf2', '√GO')
      ])
    ])
  ])
]);

const suppletionRealizedTree = node('tp_pf2', 'TP', [
  node('mia_pf2', 'DP', [
      node('mia_pf2_np', 'NP', [
        leaf('mia_pf2_n', 'N', 'Mia', { tokenIndex: 0 })
      ])
    ]),
  node('tbar_pf2', "T'", [
    node('t_past_pf2', 'T', [
      leaf('past_pf2', '[past]', undefined, { silent: true })
    ]),
    node('vp_pf2', 'vP', [
      node('v_pf2', 'v', [
        leaf('root_go_pf2', 'went', 'went', { tokenIndex: 1 })
      ])
    ])
  ])
]);


/**
 * The canonical tree carries the subject under the left vP. Multidominance
 * adds the second mother from the right vP; it never makes the subject a
 * daughter of either bare VP predicate.
 */
const sharedSubjectTree = node('coordp_md2', 'CoordP', [
  node('vp_sang_md2', 'vP', [
    node('dp_noa_md2', 'DP', [
      node('dp_noa_md2_np', 'NP', [
        leaf('dp_noa_md2_n', 'N', 'Noa', { tokenIndex: 0 })
      ])
    ]),
    node('vbar_sang_md2', "v'", [
      nullHead('v_sang_light_md2', 'v'),
      node('vp_sang_predicate_md2', 'VP', [
        leaf('v_sang_md2', 'V', 'sang', { tokenIndex: 1 })
      ])
    ])
  ]),
  node('coordbar_md2', "Coord'", [
    leaf('coord_md2', 'Coord', 'and', { tokenIndex: 2 }),
    node('vp_danced_md2', 'vP', [
      node('vbar_danced_md2', "v'", [
        nullHead('v_danced_light_md2', 'v'),
        node('vp_danced_predicate_md2', 'VP', [
          leaf('v_danced_md2', 'V', 'danced', { tokenIndex: 3 })
        ])
      ])
    ])
  ])
]);


/** The unaccusative Theme starts VP-internally and raises to Spec,TP. */
const unaccusativeThetaBaseTree = node('tbar_theta2', "T'", [
  silentLexicalNode('t_theta2', 'T', '[past]'),
  node('vp_theta2', 'VP', [
    leaf('v_broke_theta2', 'V', 'broke', { tokenIndex: 0 }),
    node('dp_vase_low_theta2', 'DP', [
      leaf('d_the_low_theta2', 'D', 'the', {
        tokenIndex: 1,
        lineageId: 'theta2-vase-d'
      }),
      node('np_vase_low_theta2', 'NP', [
        leaf('n_vase_low_theta2', 'N', 'vase', {
          tokenIndex: 2,
          lineageId: 'theta2-vase-n'
        })
      ], { lineageId: 'theta2-vase-np' })
    ], { lineageId: 'theta2-vase-chain' })
  ])
]);

const unaccusativeThetaTree = node('tp_theta2', 'TP', [
  node('dp_vase_high_theta2', 'DP', [
    leaf('d_the_high_theta2', 'D', 'The', {
      tokenIndex: 0,
      lineageId: 'theta2-vase-d'
    }),
    node('np_vase_high_theta2', 'NP', [
      leaf('n_vase_high_theta2', 'N', 'vase', {
        tokenIndex: 1,
        lineageId: 'theta2-vase-n'
      })
    ], { lineageId: 'theta2-vase-np' })
  ], { lineageId: 'theta2-vase-chain' }),
  node('tbar_theta2', "T'", [
    silentLexicalNode('t_theta2', 'T', '[past]'),
    node('vp_theta2', 'VP', [
      leaf('v_broke_theta2', 'V', 'broke', { tokenIndex: 2 }),
      node('dp_vase_low_theta2', 'DP', [
        silentLexicalNode('d_the_low_theta2', 'D', 't_1', {
          lineageId: 'theta2-vase-d'
        }),
        node('np_vase_low_theta2', 'NP', [
          silentLexicalNode('n_vase_low_theta2', 'N', 't_1', {
            lineageId: 'theta2-vase-n'
          })
        ], { silent: true, lineageId: 'theta2-vase-np' })
      ], { silent: true, lineageId: 'theta2-vase-chain' })
    ])
  ])
]);


/** Focus inside an embedded clause, in a different sentence from the matrix pair. */
const embeddedFocusTree = node('tp_focus3', 'TP', [
  node('noa_focus3', 'DP', [
      node('noa_focus3_np', 'NP', [
        leaf('noa_focus3_n', 'N', 'Noa', { tokenIndex: 0 })
      ])
    ]),
  node('tbar_focus3', "T'", [
    silentLexicalNode('t_focus3', 'T', '[past]'),
    node('vp_focus3', 'VP', [
      leaf('v_said_focus3', 'V', 'said', { tokenIndex: 1 }),
      node('cp_focus3', 'CP', [
        nullHead('c_focus3', 'C'),
        node('tp_emb_focus3', 'TP', [
          node('mia_focus3', 'DP', [
      node('mia_focus3_np', 'NP', [
        leaf('mia_focus3_n', 'N', 'Mia', { tokenIndex: 2 })
      ])
    ]),
          node('tbar_emb_focus3', "T'", [
            silentLexicalNode('t_emb_focus3', 'T', '[past]'),
            node('vp_emb_focus3', 'VP', [
              leaf('v_left_focus3', 'V', 'left', { tokenIndex: 3 })
            ])
          ])
        ])
      ])
    ])
  ])
]);


/**
 * Clause-bounded QR: the quantifier scopes inside its own embedded clause, so
 * the raised occurrence and the scope domain sit far below the root rather than
 * at the matrix level.
 */
const embeddedScopeTree = node('tp_qr3', 'TP', [
  node('mia_qr3', 'DP', [
      node('mia_qr3_np', 'NP', [
        leaf('mia_qr3_n', 'N', 'Mia', { tokenIndex: 0 })
      ])
    ]),
  node('tbar_qr3', "T'", [
    silentLexicalNode('t_qr3', 'T', '[past]'),
    node('vp_qr3', 'VP', [
      leaf('v_said_qr3', 'V', 'said', { tokenIndex: 1 }),
      node('cp_qr3', 'CP', [
        nullHead('c_qr3', 'C'),
        node('tp_qr3_emb_top', 'TP', [
          node('qp_everyone_high_qr3', 'QP', [
            silentLexicalNode('d_everyone_high_qr3', 'D', 'everyone', { lineageId: 'everyone-d-qr3' })
          ], { silent: true, lineageId: 'everyone-qr3' }),
          node('tp_qr3_emb_surface', 'TP', [
            node('qp_everyone_low_qr3', 'QP', [
              leaf('d_everyone_low_qr3', 'D', 'everyone', { lineageId: 'everyone-d-qr3', tokenIndex: 2 })
            ], { lineageId: 'everyone-qr3' }),
            node('tbar_qr3_emb', "T'", [
              silentLexicalNode('t_qr3_emb', 'T', '[past]'),
              node('vp_qr3_emb', 'VP', [
                leaf('v_left_qr3', 'V', 'left', { tokenIndex: 3 })
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

/*
 * Remnant VP topicalization in German.
 *
 * `Auf den Tisch gelegt hat er das Buch nicht` — "he hasn't put the book on the
 * table". A whole verb phrase is in first position, and you can see that it is
 * a phrase: it carries a PP and a participle. What it does not carry is its
 * object, which sits back in the middle field above `nicht`.
 *
 * Den Besten and Webelhuth's account of this is two movements: the object
 * leaves the VP first, and only then does what is left of the VP front. Müller
 * gives the same shape a remnant-movement treatment for partial VP fronting
 * generally. This is that analysis, not a neutral description of the string;
 * whether the evacuation is scrambling in particular is contested in later work.
 *
 * The object's position above `nicht` is what makes the first step visible: a
 * scrambled object precedes sentential negation, an in-situ one follows it.
 */
const remnantStepOneTree = node('cbar_rt', "C'", [
  leaf('c_hat_rt', 'C', 'hat', { tokenIndex: 4 }),
  node('tp_rt', 'TP', [
    node('dp_subj_rt', 'DP', [
      leaf('d_er_rt', 'D', 'er', { tokenIndex: 5 })
    ]),
    node('tbar_rt', "T'", [
      node('negp_rt', 'NegP', [
        node('dp_obj_high', 'DP', [
          leaf('d_das_rt', 'D', 'das', { tokenIndex: 6 }),
          node('np_buch_rt', 'NP', [
            leaf('n_buch_rt', 'N', 'Buch', { tokenIndex: 7 })
          ])
        ], { lineageId: 'rt-obj' }),
        node('negbar_rt', "Neg'", [
          leaf('neg_nicht_rt', 'Neg', 'nicht', { tokenIndex: 8 }),
          node('vp_rt_low', 'VP', [
            node('vbar_rt_arg', "V'", [
              /*
               * The object's own argument position, inside V' with the PP and
               * the verb. A trace is a terminal, so the vacated occurrence keeps
               * the DP's D and N and only what they dominate goes silent.
               */
              node('dp_obj_gap', 'DP', [
                silentLexicalNode('d_das_gap', 'D', 't₁'),
                node('np_buch_gap', 'NP', [
                  silentLexicalNode('n_buch_gap', 'N', 't₁')
                ], { silent: true })
              ], { silent: true, lineageId: 'rt-obj' }),
              node('vbar_rt', "V'", [
                node('pp_rt', 'PP', [
                  leaf('p_auf_rt', 'P', 'Auf', { tokenIndex: 0 }),
                  node('dp_tisch_rt', 'DP', [
                    leaf('d_den_rt', 'D', 'den', { tokenIndex: 1 }),
                    node('np_tisch_rt', 'NP', [
                      leaf('n_tisch_rt', 'N', 'Tisch', { tokenIndex: 2 })
                    ])
                  ])
                ]),
                leaf('v_gelegt_rt', 'V', 'gelegt', { tokenIndex: 3 })
              ])
            ])
          ], { lineageId: 'rt-vp' })
        ])
      ]),
      nullHead('t_rt', 'T')
    ])
  ])
]);

/*
 * The remnant VP fronts, and the derivation accumulates.
 *
 * Everything silent stays where the derivation left it. The object's gap is in
 * its own argument position inside the vacated VP, keeping its D and N; the four
 * words that fronted leave a trace under each of the P, D, N and V they emptied.
 * The landing is only what is pronounced there — four words, no trace — because
 * a trace at a landing would say the phrase both arrived and did not.
 *
 * Both arrows stay drawn: the second step did not undo the first.
 */
const remnantMovementTree = node('cp_rt', 'CP', [
  node('vp_rt_high', 'VP', [
    node('vbar_rt', "V'", [
      node('pp_rt', 'PP', [
        leaf('p_auf_rt', 'P', 'Auf', { tokenIndex: 0 }),
        node('dp_tisch_rt', 'DP', [
          leaf('d_den_rt', 'D', 'den', { tokenIndex: 1 }),
          node('np_tisch_rt', 'NP', [
            leaf('n_tisch_rt', 'N', 'Tisch', { tokenIndex: 2 })
          ])
        ])
      ]),
      leaf('v_gelegt_rt', 'V', 'gelegt', { tokenIndex: 3 })
    ])
  ], { lineageId: 'rt-vp' }),
  node('cbar_rt', "C'", [
    leaf('c_hat_rt', 'C', 'hat', { tokenIndex: 4 }),
    node('tp_rt', 'TP', [
      node('dp_subj_rt', 'DP', [
        leaf('d_er_rt', 'D', 'er', { tokenIndex: 5 })
      ]),
      node('tbar_rt', "T'", [
        node('negp_rt', 'NegP', [
          node('dp_obj_high', 'DP', [
            leaf('d_das_rt', 'D', 'das', { tokenIndex: 6 }),
            node('np_buch_rt', 'NP', [
              leaf('n_buch_rt', 'N', 'Buch', { tokenIndex: 7 })
            ])
          ], { lineageId: 'rt-obj' }),
          node('negbar_rt', "Neg'", [
            leaf('neg_nicht_rt', 'Neg', 'nicht', { tokenIndex: 8 }),
            node('vp_rt_low', 'VP', [
              node('vbar_rt_arg', "V'", [
                node('dp_obj_gap', 'DP', [
                  silentLexicalNode('d_das_gap', 'D', 't₁'),
                  node('np_buch_gap', 'NP', [
                    silentLexicalNode('n_buch_gap', 'N', 't₁')
                  ], { silent: true })
                ], { silent: true, lineageId: 'rt-obj' }),
                node('vbar_rt_low', "V'", [
                  node('pp_rt_low', 'PP', [
                    silentLexicalNode('p_auf_low', 'P', 't₂'),
                    node('dp_tisch_low', 'DP', [
                      silentLexicalNode('d_den_low', 'D', 't₂'),
                      node('np_tisch_low', 'NP', [
                        silentLexicalNode('n_tisch_low', 'N', 't₂')
                      ], { silent: true })
                    ], { silent: true })
                  ], { silent: true }),
                  silentLexicalNode('v_gelegt_low', 'V', 't₂')
                ], { silent: true })
              ])
            ], { silent: true, lineageId: 'rt-vp' })
          ])
        ]),
        nullHead('t_rt', 'T')
      ])
    ])
  ])
]);



/*
 * Roll-up movement in the Hebrew DP.
 *
 * Hebrew orders the noun before its adjectives and the demonstrative last:
 * `ha-sfarim ha-adumim ha-gdolim ha-ele`, the mirror of the English `these big
 * red books`. Shlonsky derives that mirror by rolling the nominal projection up
 * through the specifier of each modifier in turn, so what moves on each step is
 * the constituent the previous step built.
 *
 * Nothing here is drawn to match a page. This is an ordinary binary X-bar DP:
 * every phrase is endocentric, every pronounced terminal is a word of the
 * sentence, and each vacated phrase is a complete, headed silent copy — its
 * head and complement skeleton under proper preterminals, the same
 * structural-witness standard the chain cards uphold. Shlonsky's figure keeps
 * one vacated position per snowball step; derived landings are not reprinted
 * inside the copies, so no step manufactures trace positions the derivation
 * never used.
 */
/** Complete base-generated hierarchy, before any roll-up movement applies. */
const rollUpBaseTree = node('demp_ru', 'DemP', [
  node('dembar_ru', "Dem'", [
    leaf('dem_ru', 'Dem', 'ha-ele', { tokenIndex: 3 }),
    node('ap_big_ru', 'AP', [
      node('abar_big_ru', "A'", [
        leaf('a_big_ru', 'A', 'ha-gdolim', { lineageId: 'ru-big-a', tokenIndex: 2 }),
        node('ap_red_ru', 'AP', [
          node('abar_red_ru', "A'", [
            leaf('a_red_ru', 'A', 'ha-adumim', { lineageId: 'ru-red-a', tokenIndex: 1 }),
            node('np_ru', 'NP', [
              leaf('n_books_ru', 'N', 'ha-sfarim', { lineageId: 'ru-books-n', tokenIndex: 0 })
            ], { lineageId: 'ru-np' })
          ])
        ], { lineageId: 'ru-ap-red' })
      ])
    ], { lineageId: 'ru-ap-big' })
  ])
]);

/** The nominal projection raises into Spec,AP of the innermost adjective. */
const rollUpStepOneTree = node('demp_ru', 'DemP', [
  node('dembar_ru', "Dem'", [
    leaf('dem_ru', 'Dem', 'ha-ele', { tokenIndex: 3 }),
    node('ap_big_ru', 'AP', [
      node('abar_big_ru', "A'", [
        leaf('a_big_ru', 'A', 'ha-gdolim', { lineageId: 'ru-big-a', tokenIndex: 2 }),
        node('ap_red_ru', 'AP', [
          node('np_ru_hi', 'NP', [
            leaf('n_books_hi_ru', 'N', 'ha-sfarim', { lineageId: 'ru-books-n', tokenIndex: 0 })
          ], { lineageId: 'ru-np' }),
          node('abar_red_ru', "A'", [
            leaf('a_red_ru', 'A', 'ha-adumim', { lineageId: 'ru-red-a', tokenIndex: 1 }),
            node('np_ru', 'NP', [
              leaf('n_books_ru', 'N', 't₁', { silent: true, lineageId: 'ru-books-n' })
            ], { silent: true, lineageId: 'ru-np' })
          ])
        ], { lineageId: 'ru-ap-red' })
      ])
    ], { lineageId: 'ru-ap-big' })
  ])
]);

/**
 * That whole constituent raises again, past the outer adjective. The moved AP
 * carries its own internal NP trace along; the vacated position receives a
 * complete headed silent copy of the red AP's skeleton.
 */
const rollUpStepTwoTree = node('demp_ru', 'DemP', [
  node('dembar_ru', "Dem'", [
    leaf('dem_ru', 'Dem', 'ha-ele', { tokenIndex: 3 }),
    node('ap_big_ru', 'AP', [
      node('ap_red_ru_hi', 'AP', [
        node('np_ru_hi', 'NP', [
          leaf('n_books_hi_ru', 'N', 'ha-sfarim', { lineageId: 'ru-books-n', tokenIndex: 0 })
        ], { lineageId: 'ru-np' }),
        node('abar_red_ru_hi', "A'", [
          leaf('a_red_hi_ru', 'A', 'ha-adumim', { lineageId: 'ru-red-a', tokenIndex: 1 }),
          node('np_ru', 'NP', [
            leaf('n_books_ru', 'N', 't₁', { silent: true, lineageId: 'ru-books-n' })
          ], { silent: true, lineageId: 'ru-np' })
        ])
      ], { lineageId: 'ru-ap-red' }),
      node('abar_big_ru', "A'", [
        leaf('a_big_ru', 'A', 'ha-gdolim', { lineageId: 'ru-big-a', tokenIndex: 2 }),
        node('ap_red_ru', 'AP', [
          node('abar_red_trace_ru', "A'", [
            leaf('a_red_trace_ru', 'A', 't₂', { silent: true, lineageId: 'ru-red-a' }),
            node('np_red_trace_ru', 'NP', [
              leaf('n_red_trace_ru', 'N', 't₂', { silent: true, lineageId: 'ru-books-n' })
            ], { silent: true, lineageId: 'ru-np' })
          ], { silent: true })
        ], { silent: true, lineageId: 'ru-ap-red' })
      ])
    ], { lineageId: 'ru-ap-big' })
  ])
]);

/** And once more, into Spec,DemP, which fixes the surface order. */
const rollUpMovementTree = node('demp_ru', 'DemP', [
  node('ap_big_ru_hi', 'AP', [
    node('ap_red_ru_hi', 'AP', [
      node('np_ru_hi', 'NP', [
        leaf('n_books_hi_ru', 'N', 'ha-sfarim', { lineageId: 'ru-books-n', tokenIndex: 0 })
      ], { lineageId: 'ru-np' }),
      node('abar_red_ru_hi', "A'", [
        leaf('a_red_hi_ru', 'A', 'ha-adumim', { lineageId: 'ru-red-a', tokenIndex: 1 }),
        node('np_ru', 'NP', [
          leaf('n_books_ru', 'N', 't₁', { silent: true, lineageId: 'ru-books-n' })
        ], { silent: true, lineageId: 'ru-np' })
      ])
    ], { lineageId: 'ru-ap-red' }),
    node('abar_big_ru_hi', "A'", [
      leaf('a_big_hi_ru', 'A', 'ha-gdolim', { lineageId: 'ru-big-a', tokenIndex: 2 }),
      node('ap_red_ru', 'AP', [
        node('abar_red_trace_ru', "A'", [
          leaf('a_red_trace_ru', 'A', 't₂', { silent: true, lineageId: 'ru-red-a' }),
          node('np_red_trace_ru', 'NP', [
            leaf('n_red_trace_ru', 'N', 't₂', { silent: true, lineageId: 'ru-books-n' })
          ], { silent: true, lineageId: 'ru-np' })
        ], { silent: true })
      ], { silent: true, lineageId: 'ru-ap-red' })
    ])
  ], { lineageId: 'ru-ap-big' }),
  node('dembar_ru', "Dem'", [
    leaf('dem_ru', 'Dem', 'ha-ele', { tokenIndex: 3 }),
    node('ap_big_ru', 'AP', [
      node('abar_big_trace_ru', "A'", [
        leaf('a_big_trace_ru', 'A', 't₃', { silent: true, lineageId: 'ru-big-a' }),
        node('ap_red_in_big_trace_ru', 'AP', [
          node('abar_red_in_big_trace_ru', "A'", [
            leaf('a_red_in_big_trace_ru', 'A', 't₃', { silent: true, lineageId: 'ru-red-a' }),
            node('np_in_big_trace_ru', 'NP', [
              leaf('n_in_big_trace_ru', 'N', 't₃', { silent: true, lineageId: 'ru-books-n' })
            ], { silent: true, lineageId: 'ru-np' })
          ], { silent: true })
        ], { silent: true, lineageId: 'ru-ap-red' })
      ], { silent: true })
    ], { silent: true, lineageId: 'ru-ap-big' })
  ])
]);





/*
 * Smuggling (Belletti's carrier chunk).
 *
 * The verb phrase containing the internal argument moves as one block to the
 * specifier of the by-phrase, carrying that argument past the external argument
 * that would otherwise be the closer goal. The passenger then raises to subject
 * position out of the landed carrier — a separate movement, in a later frame.
 */
/* The workspace after smuggling, before the passenger raises: PassP, not yet TP. */
const smugglingStepOneTree = node('passp_smuggle', 'PassP', [
  node('vp_carrier_high', 'VP', [
    node('v_read_high_smuggle', 'V', [
      leaf('v_read_head_high', 'V', 'read', { lineageId: 'smuggle-v', tokenIndex: 0 })
    ], { lineageId: 'smuggle-v-shell' }),
    node('dp_book_mid_smuggle', 'DP', [
      leaf('d_the_mid_smuggle', 'D', 'the', { lineageId: 'smuggle-d', tokenIndex: 1 }),
      node('np_book_mid_smuggle', 'NP', [
        leaf('n_book_mid_smuggle', 'N', 'book', { lineageId: 'smuggle-n', tokenIndex: 2 })
      ], { lineageId: 'smuggle-np' })
    ], { lineageId: 'smuggle-dp' })
  ], { lineageId: 'smuggle-carrier' }),
  node('passbar_smuggle', "Pass'", [
    nullHead('pass_smuggle', 'Pass'),
    node('voicep_smuggle', 'VoiceP', [
      node('pp_by_smuggle', 'PP', [
        node('p_by_smuggle', 'P', [
          leaf('p_by_head_smuggle', 'P', 'by', { tokenIndex: 3 })
        ]),
        node('dp_noa_smuggle', 'DP', [
          node('np_noa_smuggle', 'NP', [
            leaf('n_noa_smuggle', 'N', 'Noa', { tokenIndex: 4 })
          ])
        ])
      ]),
      node('voicebar_smuggle', "Voice'", [
        nullHead('voice_smuggle', 'Voice'),
        node('vp_carrier_low', 'VP', [
          node('v_read_low_smuggle', 'V', [
            silentLexicalNode('v_read_head_low', 'V', 't₁', { lineageId: 'smuggle-v' })
          ], { silent: true, lineageId: 'smuggle-v-shell' }),
          node('dp_book_low_smuggle', 'DP', [
            silentLexicalNode('d_the_low_smuggle', 'D', 't₁', { lineageId: 'smuggle-d' }),
            node('np_book_low_smuggle', 'NP', [
              silentLexicalNode('n_book_low_smuggle', 'N', 't₁', { lineageId: 'smuggle-n' })
            ], { silent: true, lineageId: 'smuggle-np' })
          ], { silent: true, lineageId: 'smuggle-dp' })
        ], { silent: true, lineageId: 'smuggle-carrier' })
      ])
    ])
  ])
]);

const smugglingTree = node('tp_smuggle', 'TP', [
  node('dp_book_high_smuggle', 'DP', [
    leaf('d_the_high_smuggle', 'D', 'The', { lineageId: 'smuggle-d', tokenIndex: 0 }),
    node('np_book_high_smuggle', 'NP', [
      leaf('n_book_high_smuggle', 'N', 'book', { lineageId: 'smuggle-n', tokenIndex: 1 })
    ], { lineageId: 'smuggle-np' })
  ], { lineageId: 'smuggle-dp' }),
  node('tbar_smuggle', "T'", [
    leaf('t_was_smuggle', 'T', 'was', { tokenIndex: 2 }),
    node('passp_smuggle', 'PassP', [
      node('vp_carrier_high', 'VP', [
        node('v_read_high_smuggle', 'V', [
          leaf('v_read_head_high', 'V', 'read', { lineageId: 'smuggle-v', tokenIndex: 3 })
        ], { lineageId: 'smuggle-v-shell' }),
        node('dp_book_mid_smuggle', 'DP', [
          silentLexicalNode('d_the_mid_smuggle', 'D', 't₂', { lineageId: 'smuggle-d' }),
          node('np_book_mid_smuggle', 'NP', [
            silentLexicalNode('n_book_mid_smuggle', 'N', 't₂', { lineageId: 'smuggle-n' })
          ], { silent: true, lineageId: 'smuggle-np' })
        ], { silent: true, lineageId: 'smuggle-dp' })
      ], { lineageId: 'smuggle-carrier' }),
      node('passbar_smuggle', "Pass'", [
        nullHead('pass_smuggle', 'Pass'),
        node('voicep_smuggle', 'VoiceP', [
          node('pp_by_smuggle', 'PP', [
            node('p_by_smuggle', 'P', [
              leaf('p_by_head_smuggle', 'P', 'by', { tokenIndex: 4 })
            ]),
            node('dp_noa_smuggle', 'DP', [
              node('np_noa_smuggle', 'NP', [
                leaf('n_noa_smuggle', 'N', 'Noa', { tokenIndex: 5 })
              ])
            ])
          ]),
          node('voicebar_smuggle', "Voice'", [
            nullHead('voice_smuggle', 'Voice'),
            node('vp_carrier_low', 'VP', [
              node('v_read_low_smuggle', 'V', [
                silentLexicalNode('v_read_head_low', 'V', 't₁', { lineageId: 'smuggle-v' })
              ], { silent: true, lineageId: 'smuggle-v-shell' }),
              node('dp_book_low_smuggle', 'DP', [
                silentLexicalNode('d_the_low_smuggle', 'D', 't₁', { lineageId: 'smuggle-d' }),
                node('np_book_low_smuggle', 'NP', [
                  silentLexicalNode('n_book_low_smuggle', 'N', 't₁', { lineageId: 'smuggle-n' })
                ], { silent: true, lineageId: 'smuggle-np' })
              ], { silent: true, lineageId: 'smuggle-dp' })
            ], { silent: true, lineageId: 'smuggle-carrier' })
          ])
        ])
      ])
    ])
  ])
]);

/*
 * Parasitic gap: ordinary movement plus the Frobenius semantic copy fork.
 *
 * The ordinary object gap is the source of the wh-movement path. A separate
 * unheaded fork shows the filler content interpreted at the ordinary and
 * parasitic gaps; the parasitic gap is not a second movement source.
 */
const parasiticGapTree = node('cp_pg', 'CP', [
  node('dp_filler_pg', 'DP', [
    leaf('d_which_pg', 'D', 'Which', { lineageId: 'pg-d' }),
    node('np_article_pg', 'NP', [
      leaf('n_article_pg', 'N', 'article', { lineageId: 'pg-n' })
    ], { lineageId: 'pg-np' })
  ], { lineageId: 'pg-chain' }),
  node('cbar_pg', "C'", [
    leaf('c_did_pg', 'C', 'did'),
    node('tp_pg', 'TP', [
      node('dp_ted_pg', 'DP', [
        node('np_ted_pg', 'NP', [
          leaf('n_ted_pg', 'N', 'Ted')
        ])
      ]),
      node('tbar_pg', "T'", [
        nullHead('t_pg', 'T'),
        node('vp_pg', 'VP', [
          node('vp_file_pg', 'VP', [
            leaf('v_file_pg', 'V', 'file'),
            node('dp_real_gap_pg', 'DP', [
              silentLexicalNode('d_real_gap_pg', 'D', 't₁', { lineageId: 'pg-d' }),
              node('np_real_gap_pg', 'NP', [
                silentLexicalNode('n_real_gap_pg', 'N', 't₁', { lineageId: 'pg-n' })
              ], { silent: true, lineageId: 'pg-np' })
            ], { silent: true, lineageId: 'pg-chain' })
          ]),
          node('pp_without_pg', 'PP', [
            leaf('p_without_pg', 'P', 'without'),
            node('vp_reading_pg', 'VP', [
            leaf('v_reading_pg', 'V', 'reading'),
            node('dp_parasitic_gap_pg', 'DP', [
              silentLexicalNode('d_parasitic_gap_pg', 'D', 'gap', { lineageId: 'pg-gap' })
            ], { silent: true, lineageId: 'pg-chain' })
            ])
          ])
        ])
      ])
    ])
  ])
]);

/*
 * Across-the-board movement, after Torr's convergent-arrow figure.
 *
 * One wh-DP is pronounced above a coordination and has one lower occurrence in
 * each conjunct. The relation remains one multi-anchor object; the renderer
 * expands its paired source and witness arrays into the two source-faithful
 * trajectories that converge on the shared landing.
 */
const acrossTheBoardTree = node('tp_atb', 'TP', [
  node('dp_i_atb', 'DP', [
    leaf('d_i_atb', 'D', 'I')
  ]),
  node('tbar_atb', "T'", [
    nullHead('t_atb', 'T'),
    node('vp_know_atb', 'VP', [
      leaf('v_know_atb', 'V', 'know'),
      node('cp_embedded_atb', 'CP', [
        node('dp_who_atb', 'DP', [
          leaf('d_who_atb', 'D', 'who', { lineageId: 'atb-d' })
        ], { lineageId: 'atb-chain' }),
        node('cbar_embedded_atb', "C'", [
          nullHead('c_embedded_atb', 'C'),
          node('coordp_atb', 'CoordP', [
            node('tp_left_atb', 'TP', [
              node('dp_jack_atb', 'DP', [
                node('np_jack_atb', 'NP', [
                  leaf('n_jack_atb', 'N', 'Jack')
                ])
              ]),
              node('vp_left_atb', 'VP', [
                leaf('v_likes_atb', 'V', 'likes'),
                node('dp_trace_left_atb', 'DP', [
                  silentLexicalNode('d_trace_left_atb', 'D', 't₁', { lineageId: 'atb-d' })
                ], { silent: true, lineageId: 'atb-chain' })
              ])
            ]),
            node('coordbar_atb', "Coord'", [
              leaf('coord_and_atb', 'Coord', 'and'),
              node('tp_right_atb', 'TP', [
                node('dp_mary_atb', 'DP', [
                  node('np_mary_atb', 'NP', [
                    leaf('n_mary_atb', 'N', 'Mary')
                  ])
                ]),
                node('vp_right_atb', 'VP', [
                  leaf('v_hates_atb', 'V', 'hates'),
                  node('dp_trace_right_atb', 'DP', [
                    silentLexicalNode('d_trace_right_atb', 'D', 't₁', { lineageId: 'atb-d' })
                  ], { silent: true, lineageId: 'atb-chain' })
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

const acrossTheBoardEmbeddedTree = requiredSyntaxSubtree(acrossTheBoardTree, 'cp_embedded_atb');
const acrossTheBoardEmbeddedBaseTree = withoutLandingTree(
  acrossTheBoardEmbeddedTree,
  'dp_who_atb',
  ['cp_embedded_atb']
);

const acrossTheBoardPreMovementTree = replaceSyntaxNode(
  replaceSyntaxNode(
    acrossTheBoardEmbeddedBaseTree,
    'dp_trace_left_atb',
    node('dp_trace_left_atb', 'DP', [
      leaf('d_trace_left_atb', 'D', 'who', { lineageId: 'atb-d' })
    ], { lineageId: 'atb-chain' })
  ),
  'dp_trace_right_atb',
  node('dp_trace_right_atb', 'DP', [
    leaf('d_trace_right_atb', 'D', 'who', { lineageId: 'atb-d' })
  ], { lineageId: 'atb-chain' })
);

/*
 * Sideward movement, after Barnickel (2017), figure 155.
 *
 * The derivation temporarily contains two rooted workspaces. The subject is
 * removed from the additional predicate on the right and remerged into the
 * primary predicate on the left. The final stage externally merges those
 * workspaces into one coordination while retaining the movement relation.
 */
const sidewardPrimaryBaseTree = node('tp_primary_sw', 'TP', [
  node('pp_lion_sw', 'PP', [
    leaf('p_hinter_sw', 'P', 'Hinter'),
    node('dp_lion_sw', 'DP', [
      leaf('d_jedem_sw', 'D', 'jedem'),
      node('np_lion_sw', 'NP', [
        leaf('n_lion_sw', 'N', 'Löwen')
      ])
    ])
  ]),
  node('tbar_primary_sw', "T'", [
    leaf('t_stand_sw', 'T', 'steht'),
    node('vp_primary_sw', 'vP', [
      node('vbar_primary_sw', "v'", [
        nullHead('v_primary_sw', 'v'),
        node('vp_stand_sw', 'VP', [
          nullHead('v_stand_sw', 'V')
        ])
      ])
    ])
  ])
]);

const sidewardPrimaryTree = node('tp_primary_sw', 'TP', [
  node('pp_lion_sw', 'PP', [
    leaf('p_hinter_sw', 'P', 'Hinter'),
    node('dp_lion_sw', 'DP', [
      leaf('d_jedem_sw', 'D', 'jedem'),
      node('np_lion_sw', 'NP', [
        leaf('n_lion_sw', 'N', 'Löwen')
      ])
    ])
  ]),
  node('tbar_primary_sw', "T'", [
    leaf('t_stand_sw', 'T', 'steht'),
    node('vp_primary_sw', 'vP', [
      node('dp_tamer_landing_sw', 'DP', [
        leaf('d_eine_sw', 'D', 'eine', { lineageId: 'sideward-subject' }),
        node('np_tamer_sw', 'NP', [
          leaf('n_tamer_sw', 'N', 'Dompteuse', { lineageId: 'sideward-subject' })
        ], { lineageId: 'sideward-subject' })
      ], { lineageId: 'sideward-subject' }),
      node('vbar_primary_sw', "v'", [
        nullHead('v_primary_sw', 'v'),
        node('vp_stand_sw', 'VP', [
          nullHead('v_stand_sw', 'V')
        ])
      ])
    ])
  ])
]);

const sidewardAdditionalBaseTree = node('tp_additional_sw', 'TP', [
  node('dp_tamer_source_sw', 'DP', [
      leaf('d_tamer_trace_sw', 'D', 'eine', { lineageId: 'sideward-subject' }),
      node('np_tamer_trace_sw', 'NP', [
        leaf('n_tamer_trace_sw', 'N', 'Dompteuse', { lineageId: 'sideward-subject' })
      ], { lineageId: 'sideward-subject' })
    ], { lineageId: 'sideward-subject' }),
  node('tbar_additional_sw', "T'", [
    nullHead('t_additional_sw', 'T'),
    node('vp_additional_sw', 'VP', [
      node('vbar_strokes_sw', "V'", [
        leaf('v_strokes_sw', 'V', 'krault'),
        node('dp_him_sw', 'DP', [
          leaf('d_him_sw', 'D', 'ihm')
        ])
      ]),
      node('dp_back_sw', 'DP', [
          leaf('d_the_back_sw', 'D', 'den'),
          node('np_back_sw', 'NP', [
            leaf('n_back_sw', 'N', 'Rücken')
          ])
      ])
    ])
  ])
]);

const sidewardAdditionalTree = node('tp_additional_sw', 'TP', [
  node('dp_tamer_source_sw', 'DP', [
      silentLexicalNode('d_tamer_trace_sw', 'D', 't₁', { lineageId: 'sideward-subject' }),
      node('np_tamer_trace_sw', 'NP', [
        silentLexicalNode('n_tamer_trace_sw', 'N', 't₁', { lineageId: 'sideward-subject' })
      ], { silent: true, lineageId: 'sideward-subject' })
    ], { silent: true, lineageId: 'sideward-subject' }),
  node('tbar_additional_sw', "T'", [
    nullHead('t_additional_sw', 'T'),
    node('vp_additional_sw', 'VP', [
      node('vbar_strokes_sw', "V'", [
        leaf('v_strokes_sw', 'V', 'krault'),
        node('dp_him_sw', 'DP', [
          leaf('d_him_sw', 'D', 'ihm')
        ])
      ]),
      node('dp_back_sw', 'DP', [
          leaf('d_the_back_sw', 'D', 'den'),
          node('np_back_sw', 'NP', [
            leaf('n_back_sw', 'N', 'Rücken')
          ])
      ])
    ])
  ])
]);

const sidewardFinalTree = node('coordp_sideward_sw', 'CoordP', [
  sidewardPrimaryTree,
  node('coordbar_sideward_sw', "Coord'", [
    leaf('coord_and_sw', 'Coord', 'und'),
    sidewardAdditionalTree
  ])
]);

/*
 * A second parasitic-gap topology with two adjunct gaps.
 *
 * The ordinary object copy still supplies the one movement trajectory. Both
 * adjunct gaps are separately anchored members of the same dependency and
 * therefore receive the same `pg` index without becoming movement sources.
 */
const multipleParasiticGapTree = node('cp_pg_multi', 'CP', [
  node('dp_filler_pg_multi', 'DP', [
    leaf('d_which_pg_multi', 'D', 'Which', { lineageId: 'pg-multi-d' }),
    node('np_paper_pg_multi', 'NP', [
      leaf('n_paper_pg_multi', 'N', 'paper', { lineageId: 'pg-multi-n' })
    ], { lineageId: 'pg-multi-np' })
  ], { lineageId: 'pg-multi-chain' }),
  node('cbar_pg_multi', "C'", [
    leaf('c_did_pg_multi', 'C', 'did'),
    node('tp_pg_multi', 'TP', [
      node('dp_lena_pg_multi', 'DP', [
        node('np_lena_pg_multi', 'NP', [
          leaf('n_lena_pg_multi', 'N', 'Lena')
        ])
      ]),
      node('tbar_pg_multi', "T'", [
        nullHead('t_pg_multi', 'T'),
        node('vp_pg_multi', 'VP', [
          node('vp_file_pg_multi', 'VP', [
            leaf('v_file_pg_multi', 'V', 'file'),
            node('dp_real_gap_pg_multi', 'DP', [
              silentLexicalNode('d_real_gap_pg_multi', 'D', 't₁', { lineageId: 'pg-multi-d' }),
              node('np_real_gap_pg_multi', 'NP', [
                silentLexicalNode('n_real_gap_pg_multi', 'N', 't₁', { lineageId: 'pg-multi-n' })
              ], { silent: true, lineageId: 'pg-multi-np' })
            ], { silent: true, lineageId: 'pg-multi-chain' })
          ]),
          node('pp_without_pg_multi', 'PP', [
            leaf('p_without_pg_multi', 'P', 'without'),
            node('vp_reading_pg_multi', 'VP', [
              node('vp_read_pg_multi', 'VP', [
                leaf('v_reading_pg_multi', 'V', 'reading'),
                node('dp_parasitic_one_pg_multi', 'DP', [
                  silentLexicalNode('d_parasitic_one_pg_multi', 'D', 'gap', {
                    lineageId: 'pg-multi-gap-one'
                  })
                ], { silent: true, lineageId: 'pg-multi-chain' })
              ]),
              node('pp_before_pg_multi', 'PP', [
                leaf('p_before_pg_multi', 'P', 'before'),
                node('vp_citing_pg_multi', 'VP', [
                  leaf('v_citing_pg_multi', 'V', 'citing'),
                  node('dp_parasitic_two_pg_multi', 'DP', [
                    silentLexicalNode('d_parasitic_two_pg_multi', 'D', 'gap', {
                      lineageId: 'pg-multi-gap-two'
                    })
                  ], { silent: true, lineageId: 'pg-multi-chain' })
                ])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

/*
 * A three-conjunct ATB stress context.
 *
 * The relation owns three paired source/witness entries and one landing. This
 * is the same convergent visual grammar as Torr's two-conjunct figure, exercised
 * at a different fan-in rather than duplicated as three independent relations.
 */
const acrossTheBoardThreeTree = node('cp_atb_three', 'CP', [
  node('dp_who_atb_three', 'DP', [
    leaf('d_who_atb_three', 'D', 'Who', { lineageId: 'atb-three-d' })
  ], { lineageId: 'atb-three-chain' }),
  node('cbar_atb_three', "C'", [
    leaf('c_did_atb_three', 'C', 'did'),
    node('coordp_outer_atb_three', 'CoordP', [
      node('tp_lena_atb_three', 'TP', [
        node('dp_lena_atb_three', 'DP', [
          node('np_lena_atb_three', 'NP', [
            leaf('n_lena_atb_three', 'N', 'Lena')
          ])
        ]),
        node('vp_lena_atb_three', 'VP', [
          leaf('v_praise_atb_three', 'V', 'praise'),
          node('dp_trace_lena_atb_three', 'DP', [
            silentLexicalNode('d_trace_lena_atb_three', 'D', 't₁', {
              lineageId: 'atb-three-d'
            })
          ], { silent: true, lineageId: 'atb-three-chain' })
        ])
      ]),
      node('coordbar_outer_atb_three', "Coord'", [
        leaf('coord_and_outer_atb_three', 'Coord', 'and'),
        node('coordp_inner_atb_three', 'CoordP', [
          node('tp_noa_atb_three', 'TP', [
            node('dp_noa_atb_three', 'DP', [
              node('np_noa_atb_three', 'NP', [
                leaf('n_noa_atb_three', 'N', 'Noa')
              ])
            ]),
            node('vp_noa_atb_three', 'VP', [
              leaf('v_thank_atb_three', 'V', 'thank'),
              node('dp_trace_noa_atb_three', 'DP', [
                silentLexicalNode('d_trace_noa_atb_three', 'D', 't₁', {
                  lineageId: 'atb-three-d'
                })
              ], { silent: true, lineageId: 'atb-three-chain' })
            ])
          ]),
          node('coordbar_inner_atb_three', "Coord'", [
            leaf('coord_and_inner_atb_three', 'Coord', 'and'),
            node('tp_mira_atb_three', 'TP', [
              node('dp_mira_atb_three', 'DP', [
                node('np_mira_atb_three', 'NP', [
                  leaf('n_mira_atb_three', 'N', 'Mira')
                ])
              ]),
              node('vp_mira_atb_three', 'VP', [
                leaf('v_call_atb_three', 'V', 'call'),
                node('dp_trace_mira_atb_three', 'DP', [
                  silentLexicalNode('d_trace_mira_atb_three', 'D', 't₁', {
                    lineageId: 'atb-three-d'
                  })
                ], { silent: true, lineageId: 'atb-three-chain' })
              ])
            ])
          ])
        ])
      ])
    ])
  ])
]);

/*
 * Nunes's sideward-movement analysis of "Which paper did you file without
 * reading?", as reproduced in the inspected dissertation source.
 *
 * The DP is first copied from an independently built adjunct into the matrix
 * object position. After the workspaces combine, ordinary wh-movement carries
 * that matrix occurrence to Spec,CP. The final frame therefore contains two
 * persistent paths with different families: sideward first, phrasal second.
 */
const sidewardPgAdjunctBaseTree = node('pp_adj_swpg', 'PP', [
  leaf('p_without_swpg', 'P', 'without'),
  node('tp_adj_swpg', 'TP', [
    silentLexicalNode('pro_adj_swpg', 'DP', 'PRO'),
    node('vp_adj_swpg', 'VP', [
      leaf('v_reading_swpg', 'V', 'reading'),
      node('dp_paper_adj_swpg', 'DP', [
        leaf('d_paper_adj_swpg', 'D', 'which', { lineageId: 'sideward-pg-d' }),
        node('np_paper_adj_swpg', 'NP', [
          leaf('n_paper_adj_swpg', 'N', 'paper', { lineageId: 'sideward-pg-n' })
        ], { lineageId: 'sideward-pg-np' })
      ], { lineageId: 'sideward-pg-chain' })
    ])
  ])
]);

const sidewardPgMatrixBaseTree = node('vp_matrix_swpg', 'VP', [
  leaf('v_file_swpg', 'V', 'file')
]);

const sidewardPgAdjunctMovedTree = node('pp_adj_swpg', 'PP', [
  leaf('p_without_swpg', 'P', 'without'),
  node('tp_adj_swpg', 'TP', [
    silentLexicalNode('pro_adj_swpg', 'DP', 'PRO'),
    node('vp_adj_swpg', 'VP', [
      leaf('v_reading_swpg', 'V', 'reading'),
      node('dp_paper_adj_swpg', 'DP', [
        silentLexicalNode('d_paper_adj_swpg', 'D', 't₁', { lineageId: 'sideward-pg-d' }),
        node('np_paper_adj_swpg', 'NP', [
          silentLexicalNode('n_paper_adj_swpg', 'N', 't₁', { lineageId: 'sideward-pg-n' })
        ], { silent: true, lineageId: 'sideward-pg-np' })
      ], { silent: true, lineageId: 'sideward-pg-chain' })
    ])
  ])
]);

const sidewardPgMatrixMovedTree = node('vp_matrix_swpg', 'VP', [
  leaf('v_file_swpg', 'V', 'file'),
  node('dp_paper_matrix_swpg', 'DP', [
    leaf('d_paper_matrix_swpg', 'D', 'which', { lineageId: 'sideward-pg-d' }),
    node('np_paper_matrix_swpg', 'NP', [
      leaf('n_paper_matrix_swpg', 'N', 'paper', { lineageId: 'sideward-pg-n' })
    ], { lineageId: 'sideward-pg-np' })
  ], { lineageId: 'sideward-pg-chain' })
]);

const sidewardPgFinalTree = node('cp_final_swpg', 'CP', [
  node('dp_paper_high_swpg', 'DP', [
    leaf('d_paper_high_swpg', 'D', 'Which', { lineageId: 'sideward-pg-d' }),
    node('np_paper_high_swpg', 'NP', [
      leaf('n_paper_high_swpg', 'N', 'paper', { lineageId: 'sideward-pg-n' })
    ], { lineageId: 'sideward-pg-np' })
  ], { lineageId: 'sideward-pg-chain' }),
  node('cbar_final_swpg', "C'", [
    leaf('c_did_swpg', 'C', 'did'),
    node('tp_final_swpg', 'TP', [
      node('dp_you_swpg', 'DP', [
        leaf('d_you_swpg', 'D', 'you')
      ]),
      node('tbar_final_swpg', "T'", [
        nullHead('t_final_swpg', 'T'),
        node('vp_final_swpg', 'VP', [
          node('vp_matrix_swpg', 'VP', [
            leaf('v_file_swpg', 'V', 'file'),
            node('dp_paper_matrix_swpg', 'DP', [
              silentLexicalNode('d_paper_matrix_swpg', 'D', 't₁', {
                lineageId: 'sideward-pg-d'
              }),
              node('np_paper_matrix_swpg', 'NP', [
                silentLexicalNode('n_paper_matrix_swpg', 'N', 't₁', {
                  lineageId: 'sideward-pg-n'
                })
              ], { silent: true, lineageId: 'sideward-pg-np' })
            ], { silent: true, lineageId: 'sideward-pg-chain' })
          ]),
          sidewardPgAdjunctMovedTree
        ])
      ])
    ])
  ])
]);

/*
 * Pair Merge, in the two configurations supplied by the source plates.
 *
 * The phrase-level card pair-merges an AdvP with a VP host. The lexical card
 * pair-merges D with an NP host; per Ginsburg's figure 4 the nominal host
 * alone projects, so the mother of the pair is the host's NP — the pair
 * member never projects a DP over its host. Each card keeps exactly one
 * dominance attachment for the member. The relation highlights the complete
 * shared-parent fork: both native branches for Pair Merge, using the same
 * branch-overlay primitive that blocked extraction applies to one adjunct arm.
 */
const pairMergePhraseHost = node('vp_host_pair_phrase', 'VP', [
  leaf('v_read_pair_phrase', 'V', 'read'),
  node('dp_book_pair_phrase', 'DP', [
    leaf('d_the_book_pair_phrase', 'D', 'the'),
    node('np_book_pair_phrase', 'NP', [
      leaf('n_book_pair_phrase', 'N', 'book')
    ])
  ])
]);

const pairMergePhraseMember = node('advp_quietly_pair_phrase', 'AdvP', [
  leaf('adv_quietly_pair_phrase', 'Adv', 'quietly')
]);

const pairMergePhraseTree = node('tp_pair_phrase', 'TP', [
  node('dp_mia_pair_phrase', 'DP', [
    node('np_mia_pair_phrase', 'NP', [
      leaf('n_mia_pair_phrase', 'N', 'Mia')
    ])
  ]),
  node('tbar_pair_phrase', "T'", [
    leaf('t_past_pair_phrase', 'T', '[past]', { silent: true }),
    node('vp_pair_phrase', 'VP', [
      pairMergePhraseHost,
      pairMergePhraseMember
    ])
  ])
]);

const pairMergeLexicalMember = leaf('d_the_pair_lexical', 'D', 'the');
const pairMergeLexicalHost = node('np_book_pair_lexical', 'NP', [
  leaf('n_book_pair_lexical', 'N', 'book')
]);
const pairMergeLexicalTree = node('np_pair_lexical', 'NP', [
  pairMergeLexicalMember,
  pairMergeLexicalHost
]);

/*
 * Oseki-style blocked extraction in two adjunct configurations.
 *
 * The temporal card commits the illicit wh-chain required by its exact input:
 * the pronounced landing and silent lower occurrence are both real syntax.
 * AbarMove owns that transition; BlockedExtraction only judges the completed
 * chain against its adjunct domain.
 */
const temporalAdjunctDomain = node('cp_temporal_blocked', 'CP', [
  leaf('c_after_blocked', 'C', 'after', { tokenIndex: 0 }),
  node('tp_temporal_blocked', 'TP', [
    node('dp_john_temporal_blocked', 'DP', [
      node('np_john_temporal_blocked', 'NP', [
        leaf('n_john_temporal_blocked', 'N', 'John', { tokenIndex: 1 })
      ])
    ]),
    node('tbar_temporal_blocked', "T'", [
      leaf('t_past_temporal_blocked', 'T', '[past]', { silent: true }),
      node('vp_temporal_blocked', 'VP', [
        leaf('v_hit_temporal_blocked', 'V', 'hit', { tokenIndex: 2 }),
        node('dp_who_low_temporal_blocked', 'DP', [
          silentLexicalNode('d_who_low_temporal_blocked', 'D', 't₁', {
            lineageId: 'temporal-blocked-who-d'
          })
        ], { silent: true, lineageId: 'temporal-blocked-who-chain' })
      ])
    ])
  ])
]);

const temporalBlockedLowerTree = node('tp_blocked_temporal', 'TP', [
  node('dp_mary_blocked_temporal', 'DP', [
    node('np_mary_blocked_temporal', 'NP', [
      leaf('n_mary_blocked_temporal', 'N', 'Mary', { tokenIndex: 0 })
    ])
  ]),
  node('tbar_blocked_temporal', "T'", [
    leaf('t_past_blocked_temporal', 'T', '[past]', { silent: true }),
    node('vp_blocked_temporal', 'VP', [
      node('vp_cry_blocked_temporal', 'VP', [
        leaf('v_cry_blocked_temporal', 'V', 'cry', { tokenIndex: 1 })
      ]),
      offsetTokenIndices(temporalAdjunctDomain, 2)
    ])
  ])
]);

const temporalBlockedTree = node('cp_blocked_temporal', 'CP', [
  node('dp_who_high_temporal_blocked', 'DP', [
    leaf('d_who_high_temporal_blocked', 'D', 'Who', {
      tokenIndex: 0,
      lineageId: 'temporal-blocked-who-d'
    })
  ], { lineageId: 'temporal-blocked-who-chain' }),
  node('cbar_blocked_temporal', "C'", [
    leaf('c_did_blocked_temporal', 'C', 'did', { tokenIndex: 1 }),
    offsetTokenIndices(temporalBlockedLowerTree, 2)
  ])
]);

const participialAdjunctDomain = node('pp_participial_blocked', 'PP', [
  leaf('p_without_participial_blocked', 'P', 'without'),
  node('vp_reading_participial_blocked', 'VP', [
    leaf('v_reading_participial_blocked', 'V', 'reading'),
    node('dp_article_participial_blocked', 'DP', [
      leaf('d_the_article_participial_blocked', 'D', 'the'),
      node('np_article_participial_blocked', 'NP', [
        leaf('n_article_participial_blocked', 'N', 'article')
      ])
    ])
  ])
]);

const participialBlockedLowerTree = node('tp_blocked_participial', 'TP', [
  node('dp_critic_blocked_participial', 'DP', [
    leaf('d_the_critic_blocked_participial', 'D', 'The'),
    node('np_critic_blocked_participial', 'NP', [
      leaf('n_critic_blocked_participial', 'N', 'critic')
    ])
  ]),
  node('tbar_blocked_participial', "T'", [
    leaf('t_past_blocked_participial', 'T', '[past]', { silent: true }),
    node('vp_blocked_participial', 'VP', [
      node('vp_praise_blocked_participial', 'VP', [
        leaf('v_praised_blocked_participial', 'V', 'praised'),
        node('dp_book_blocked_participial', 'DP', [
          leaf('d_the_book_blocked_participial', 'D', 'the'),
          node('np_book_blocked_participial', 'NP', [
            leaf('n_book_blocked_participial', 'N', 'book')
          ])
        ])
      ]),
      participialAdjunctDomain
    ])
  ])
]);

const participialBlockedTree = node('cp_blocked_participial', 'CP', [
  nullHead('c_target_blocked_participial', 'C'),
  participialBlockedLowerTree
]);

/*
 * Ahn's two idiom-domain configurations.
 *
 * In the first, predicate and internal argument form the idiom inside VP. In
 * the second, the subject and predicate form the idiom, so the interpretation
 * bracket spans the complete clause rather than only the predicate domain.
 */
const cookBooksIdiomTree = node('tp_idiom_cook_books', 'TP', [
  node('dp_julie_idiom_cook_books', 'DP', [
    node('np_julie_idiom_cook_books', 'NP', [
      leaf('n_julie_idiom_cook_books', 'N', 'Julie')
    ])
  ]),
  node('tbar_idiom_cook_books', "T'", [
    leaf('t_past_idiom_cook_books', 'T', '[past]', { silent: true }),
    node('vp_idiom_cook_books', 'VP', [
      leaf('v_cooked_idiom_cook_books', 'V', 'cooked'),
      node('dp_books_idiom_cook_books', 'DP', [
        leaf('d_the_books_idiom_cook_books', 'D', 'the'),
        node('np_books_idiom_cook_books', 'NP', [
          leaf('n_books_idiom_cook_books', 'N', 'books')
        ])
      ])
    ])
  ])
]);

const travelBugIdiomTree = node('tp_idiom_travel_bug', 'TP', [
  node('dp_travel_bug_idiom', 'DP', [
    leaf('d_the_travel_bug_idiom', 'D', 'The'),
    node('np_travel_bug_idiom', 'NP', [
      node('nbar_travel_bug_idiom', "N'", [
        leaf('n_travel_idiom', 'N', 'travel'),
        leaf('n_bug_idiom', 'N', 'bug')
      ])
    ])
  ]),
  node('tbar_idiom_travel_bug', "T'", [
    leaf('t_past_idiom_travel_bug', 'T', '[past]', { silent: true }),
    node('vp_idiom_travel_bug', 'VP', [
      leaf('v_bit_idiom_travel_bug', 'V', 'bit'),
      node('dp_me_idiom_travel_bug', 'DP', [
        leaf('d_me_idiom_travel_bug', 'D', 'me')
      ])
    ])
  ])
]);

/* Source-backed completion batch: complete trees first, relation overlays second. */
const zeroRealizationTree = node('tp_zero_realization', 'TP', [
  node('dp_pro_zero_realization', 'DP', [
    silentLexicalNode('d_pro_zero_realization', 'D', 'pro')
  ], { silent: true }),
  node('tbar_zero_realization', "T'", [
    leaf('t_past_zero_realization', 'T', '[past]', { silent: true }),
    node('vp_zero_realization', 'VP', [
      leaf('v_arrived_zero_realization', 'V', 'arrived')
    ])
  ])
]);

const deletionContrastTree = node('tp_deletion_contrast', 'TP', [
  node('dp_students_deletion_contrast', 'DP', [
    silentLexicalNode('d_the_deletion_contrast', 'D', 'The', { tokenIndex: 0 }),
    node('np_students_deletion_contrast', 'NP', [
      silentLexicalNode('n_students_deletion_contrast', 'N', 'students')
    ], { silent: true })
  ], { silent: true }),
  node('tbar_deletion_contrast', "T'", [
    leaf('t_past_deletion_contrast', 'T', '[past]', { silent: true }),
    node('vp_deletion_contrast', 'VP', [
      leaf('v_arrived_deletion_contrast', 'V', 'arrived')
    ])
  ])
]);

const pgIslandLicensedTree = node('cp_pg_island_licensed', 'CP', [
  node('dp_filler_pg_island_licensed', 'DP', [
    leaf('d_which_pg_island_licensed', 'D', 'which', {
      lineageId: 'pg-island-licensed-d',
      tokenIndex: 0
    }),
    node('np_monument_pg_island_licensed', 'NP', [
      leaf('n_monument_pg_island_licensed', 'N', 'monument', { lineageId: 'pg-island-licensed-n' })
    ], { lineageId: 'pg-island-licensed-np' })
  ], { lineageId: 'pg-island-licensed-chain' }),
  node('cbar_pg_island_licensed', "C'", [
    leaf('c_did_pg_island_licensed', 'C', 'did'),
    node('tp_pg_island_licensed', 'TP', [
      node('dp_subject_pg_island_licensed', 'DP', [
        leaf('d_the_subject_pg_island_licensed', 'D', 'the'),
        node('np_plan_pg_island_licensed', 'NP', [
          leaf('n_plan_pg_island_licensed', 'N', 'plan'),
          node('tp_infinitive_pg_island_licensed', 'TP', [
            silentLexicalNode('d_pro_pg_island_licensed', 'DP', 'PRO'),
            node('tbar_infinitive_pg_island_licensed', "T'", [
              leaf('t_to_pg_island_licensed', 'T', 'to'),
              node('vp_infinitive_pg_island_licensed', 'VP', [
                leaf('v_preserve_pg_island_licensed', 'V', 'preserve'),
                node('dp_parasitic_pg_island_licensed', 'DP', [
                  silentLexicalNode('d_parasitic_pg_island_licensed', 'D', 'gap', {
                    lineageId: 'pg-island-licensed-d'
                  })
                ], { silent: true, lineageId: 'pg-island-licensed-chain' })
              ])
            ])
          ])
        ])
      ]),
      node('tbar_matrix_pg_island_licensed', "T'", [
        nullHead('t_matrix_pg_island_licensed', 'T'),
        node('vp_matrix_pg_island_licensed', 'VP', [
          leaf('adv_ultimately_pg_island_licensed', 'Adv', 'ultimately'),
          node('vp_harm_pg_island_licensed', 'VP', [
            leaf('v_endanger_pg_island_licensed', 'V', 'endanger'),
            node('dp_real_pg_island_licensed', 'DP', [
              silentLexicalNode('d_real_pg_island_licensed', 'D', 't', {
                lineageId: 'pg-island-licensed-d'
              }),
              node('np_real_pg_island_licensed', 'NP', [
                silentLexicalNode('n_real_pg_island_licensed', 'N', 't', {
                  lineageId: 'pg-island-licensed-n'
                })
              ], { silent: true, lineageId: 'pg-island-licensed-np' })
            ], { silent: true, lineageId: 'pg-island-licensed-chain' })
          ])
        ])
      ])
    ])
  ])
]);

const pgIslandBlockedTree = node('cp_pg_island_blocked', 'CP', [
  node('dp_filler_pg_island_blocked', 'DP', [
    leaf('d_which_pg_island_blocked', 'D', 'which', {
      lineageId: 'pg-island-blocked-d',
      tokenIndex: 0
    }),
    node('np_monument_pg_island_blocked', 'NP', [
      leaf('n_monument_pg_island_blocked', 'N', 'monument', { lineageId: 'pg-island-blocked-n' })
    ], { lineageId: 'pg-island-blocked-np' })
  ], { lineageId: 'pg-island-blocked-chain' }),
  node('cbar_pg_island_blocked', "C'", [
    leaf('c_did_pg_island_blocked', 'C', 'did'),
    node('tp_pg_island_blocked', 'TP', [
      node('dp_subject_pg_island_blocked', 'DP', [
        leaf('d_the_subject_pg_island_blocked', 'D', 'the'),
        node('np_plan_pg_island_blocked', 'NP', [
          leaf('n_plan_pg_island_blocked', 'N', 'plan'),
          node('cp_relative_pg_island_blocked', 'CP', [
            leaf('c_that_pg_island_blocked', 'C', 'that'),
            node('tp_relative_pg_island_blocked', 'TP', [
              node('dp_donors_pg_island_blocked', 'DP', [
                node('np_donors_pg_island_blocked', 'NP', [
                  leaf('n_donors_pg_island_blocked', 'N', 'donors')
                ])
              ]),
              node('tbar_relative_pg_island_blocked', "T'", [
                leaf('t_pres_pg_island_blocked', 'T', '[pres]', { silent: true }),
                node('vp_relative_pg_island_blocked', 'VP', [
                  leaf('v_preserve_pg_island_blocked', 'V', 'preserve'),
                  node('dp_parasitic_pg_island_blocked', 'DP', [
                    silentLexicalNode('d_parasitic_pg_island_blocked', 'D', 'gap', {
                      lineageId: 'pg-island-blocked-d'
                    })
                  ], { silent: true, lineageId: 'pg-island-blocked-chain' })
                ])
              ])
            ])
          ])
        ])
      ]),
      node('tbar_matrix_pg_island_blocked', "T'", [
        nullHead('t_matrix_pg_island_blocked', 'T'),
        node('vp_matrix_pg_island_blocked', 'VP', [
          leaf('adv_ultimately_pg_island_blocked', 'Adv', 'ultimately'),
          node('vp_harm_pg_island_blocked', 'VP', [
            leaf('v_endanger_pg_island_blocked', 'V', 'endanger'),
            node('dp_real_pg_island_blocked', 'DP', [
              silentLexicalNode('d_real_pg_island_blocked', 'D', 't', {
                lineageId: 'pg-island-blocked-d'
              }),
              node('np_real_pg_island_blocked', 'NP', [
                silentLexicalNode('n_real_pg_island_blocked', 'N', 't', {
                  lineageId: 'pg-island-blocked-n'
                })
              ], { silent: true, lineageId: 'pg-island-blocked-np' })
            ], { silent: true, lineageId: 'pg-island-blocked-chain' })
          ])
        ])
      ])
    ])
  ])
]);

/*
 * The relative clause carries a complete null-operator chain: Op moves from
 * the object position of the elided VP to Spec,CP, and the object gap is a
 * silent occurrence of that operator under its own D preterminal, tied to the
 * chain by lineage. Both QP occurrences author the same complete structure;
 * copied terminals share a lineage pairwise.
 */
const acdHighQp = node('qp_high_acd', 'QP', [
  leaf('q_every_high_acd', 'Q', 'every', { silent: true, lineageId: 'acd-q' }),
  node('np_report_high_acd', 'NP', [
    leaf('n_report_high_acd', 'N', 'report', { silent: true, lineageId: 'acd-n' }),
    node('cp_relative_high_acd', 'CP', [
      node('dp_op_high_acd', 'DP', [
        silentLexicalNode('d_op_high_acd', 'D', 'Op', { lineageId: 'acd-op' })
      ], { silent: true, lineageId: 'acd-op-dp' }),
      node('cbar_relative_high_acd', "C'", [
        leaf('c_that_high_acd', 'C', 'that', { silent: true, lineageId: 'acd-c' }),
        node('tp_relative_high_acd', 'TP', [
          node('dp_mary_high_acd', 'DP', [
            leaf('d_mary_high_acd', 'D', 'Mary', { silent: true, lineageId: 'acd-mary' })
          ], { silent: true }),
          node('tbar_relative_high_acd', "T'", [
            leaf('t_did_high_acd', 'T', 'did', { silent: true, lineageId: 'acd-did' }),
            node('vp_ellipsis_high_acd', 'VP', [
              leaf('v_read_high_acd', 'V', 'read', { silent: true, lineageId: 'acd-rel-v' }),
              node('dp_object_gap_high_acd', 'DP', [
                silentLexicalNode('d_object_gap_high_acd', 'D', 'Op', { lineageId: 'acd-op' })
              ], { silent: true, lineageId: 'acd-op-dp' })
            ], { silent: true })
          ], { silent: true })
        ], { silent: true })
      ], { silent: true })
    ], { silent: true })
  ], { silent: true, lineageId: 'acd-np' })
], { silent: true, lineageId: 'acd-chain' });

const acdLowQp = node('qp_low_acd', 'QP', [
  leaf('q_every_low_acd', 'Q', 'every', { lineageId: 'acd-q' }),
  node('np_report_low_acd', 'NP', [
    leaf('n_report_low_acd', 'N', 'report', { lineageId: 'acd-n' }),
    node('cp_relative_low_acd', 'CP', [
      node('dp_op_low_acd', 'DP', [
        silentLexicalNode('d_op_low_acd', 'D', 'Op', { lineageId: 'acd-op' })
      ], { silent: true, lineageId: 'acd-op-dp' }),
      node('cbar_relative_low_acd', "C'", [
        leaf('c_that_low_acd', 'C', 'that', { lineageId: 'acd-c' }),
        node('tp_relative_low_acd', 'TP', [
          node('dp_mary_low_acd', 'DP', [
            leaf('d_mary_low_acd', 'D', 'Mary', { lineageId: 'acd-mary' })
          ]),
          node('tbar_relative_low_acd', "T'", [
            leaf('t_did_low_acd', 'T', 'did', { lineageId: 'acd-did' }),
            node('vp_ellipsis_low_acd', 'VP', [
              leaf('v_read_low_acd', 'V', 'read', { silent: true, lineageId: 'acd-rel-v' }),
              node('dp_object_gap_low_acd', 'DP', [
                silentLexicalNode('d_object_gap_low_acd', 'D', 'Op', { lineageId: 'acd-op' })
              ], { silent: true, lineageId: 'acd-op-dp' })
            ], { silent: true })
          ])
        ])
      ])
    ])
  ], { lineageId: 'acd-np' })
], { lineageId: 'acd-chain' });

/** Surface state before QR: the object QP sits inside the matrix VP. */
const acdSurfaceTree = node('tp_surface_acd', 'TP', [
  node('dp_john_acd', 'DP', [leaf('d_john_acd', 'D', 'John')]),
  node('tbar_surface_acd', "T'", [
    leaf('t_past_acd', 'T', '[past]', { silent: true }),
    node('vp_matrix_acd', 'VP', [
      leaf('v_read_matrix_acd', 'V', 'read'),
      acdLowQp
    ])
  ])
]);

const acdTree = node('tp_acd', 'TP', [
  acdHighQp,
  acdSurfaceTree
]);

const orderedCaseStackingBaseTree = node('tp_case_stacking', 'TP', [
  node('dp_mina_low_case_stacking', 'DP', [
    node('np_mina_low_case_stacking', 'NP', [
      leaf('n_mina_low_case_stacking', 'N', 'Mina', { lineageId: 'case-stack-mia' })
    ], { lineageId: 'case-stack-mia-np' })
  ], { lineageId: 'case-stack-chain' }),
  node('tbar_case_stacking', "T'", [
    leaf('t_past_case_stacking', 'T', '[past]', { silent: true }),
    node('vp_case_stacking', 'VP', [
      leaf('v_arrived_case_stacking', 'V', 'arrived')
    ])
  ])
]);

const orderedCaseStackingTree = node('kp_case_stacking', 'KP', [
  node('dp_mina_high_case_stacking', 'DP', [
    node('np_mina_high_case_stacking', 'NP', [
      leaf('n_mina_high_case_stacking', 'N', 'Mina', { lineageId: 'case-stack-mia' })
    ], { lineageId: 'case-stack-mia-np' })
  ], { lineageId: 'case-stack-chain' }),
  node('kbar_case_stacking', "K'", [
    nullHead('k_case_stacking', 'K'),
    node('tp_case_stacking', 'TP', [
      node('dp_mina_low_case_stacking', 'DP', [
        node('np_mina_low_case_stacking', 'NP', [
          silentLexicalNode('n_mina_low_case_stacking', 'N', 't₁', {
            lineageId: 'case-stack-mia'
          })
        ], { silent: true, lineageId: 'case-stack-mia-np' })
      ], { silent: true, lineageId: 'case-stack-chain' }),
      node('tbar_case_stacking', "T'", [
        leaf('t_past_case_stacking', 'T', '[past]', { silent: true }),
        node('vp_case_stacking', 'VP', [
          leaf('v_arrived_case_stacking', 'V', 'arrived')
        ])
      ])
    ])
  ])
]);

const splitAntecedenceTree = node('tp_split_antecedence', 'TP', [
  node('dp_kyle_split_antecedence', 'DP', [leaf('d_kyle_split_antecedence', 'D', 'Kyle')]),
  node('tbar_split_antecedence', "T'", [
    leaf('t_past_split_antecedence', 'T', '[past]', { silent: true }),
    node('vp_split_antecedence', 'VP', [
      leaf('v_told_split_antecedence', 'V', 'told'),
      node('vbar_split_antecedence', "V'", [
        node('dp_sten_split_antecedence', 'DP', [leaf('d_sten_split_antecedence', 'D', 'Sten')]),
        node('pp_split_antecedence', 'PP', [
          leaf('p_about_split_antecedence', 'P', 'about'),
          node('dp_themselves_split_antecedence', 'DP', [
            leaf('d_themselves_split_antecedence', 'D', 'themselves')
          ])
        ])
      ])
    ])
  ])
]);

const phaseStressTree = node('coordp_phase_stress', 'CoordP', [
  node('cp_left_phase_stress', 'CP', [
    nullHead('c_left_phase_stress', 'C'),
    node('tp_left_phase_stress', 'TP', [
      node('tbar_left_phase_stress', "T'", [
        nullHead('t_past_left_phase_stress', 'T'),
        node('vp_left_phase_stress', 'vP', [
          node('dp_lena_edge_phase_stress', 'DP', [
            leaf('d_lena_edge_phase_stress', 'D', 'Lena')
          ]),
          node('vbar_left_phase_stress', "v'", [
            nullHead('v_left_phase_stress', 'v'),
            node('vp_read_phase_stress', 'VP', [leaf('v_read_phase_stress', 'V', 'read')])
          ])
        ])
      ])
    ])
  ]),
  node('coordbar_phase_stress', "Coord'", [
    leaf('coord_and_phase_stress', 'Coord', 'and'),
    node('cp_right_phase_stress', 'CP', [
      nullHead('c_right_phase_stress', 'C'),
      node('tp_right_phase_stress', 'TP', [
        node('tbar_right_phase_stress', "T'", [
          nullHead('t_past_right_phase_stress', 'T'),
          node('vp_right_phase_stress', 'vP', [
            node('dp_noa_edge_phase_stress', 'DP', [
              leaf('d_noa_edge_phase_stress', 'D', 'Noa')
            ]),
            node('vbar_right_phase_stress', "v'", [
              nullHead('v_right_phase_stress', 'v'),
              node('vp_wrote_phase_stress', 'VP', [leaf('v_wrote_phase_stress', 'V', 'wrote')])
            ])
          ])
        ])
      ])
    ])
  ])
]);

const illicitAnalysisSubject = node('dp_subject_illicit_analysis', 'DP', [
  leaf('d_the_illicit_analysis', 'D', 'The'),
  node('np_subject_illicit_analysis', 'NP', [
    leaf('n_girls_illicit_analysis', 'N', 'girls')
  ])
]);

const illicitAnalysisPredicate = node('vp_illicit_analysis', 'VP', [
  leaf('v_arrives_illicit_analysis', 'V', 'arrives')
]);

const illicitAnalysisTree = node('tp_illicit_analysis', 'TP', [
  illicitAnalysisSubject,
  node('tbar_illicit_analysis', "T'", [
    leaf('t_present_illicit_analysis', 'T', '[3SG, pres]', { silent: true }),
    illicitAnalysisPredicate
  ])
]);

export const rawCases: LabCase[] = [
  {
    archetype: 'A1. Trajectory / phrasal',
    title: 'Phrasal Movement',
    status: 'Current Babel renders this as a phrase-spine movement trajectory: lower DP copy to pronounced DP copy, with D and NP trace leaves.',
    sentence: 'Which book did John buy',

    data: phrasalMovementTree,
    derivationStages: [
      stage(
        'A1-1',
        "The clause is assembled through C' with the complete wh-DP in object position.",
        'The complete phrase Which book is pronounced in its base object position. Spec,CP and the movement relation do not exist yet.',
        [],
        phrasalMovementBaseTree
      ),
      stage(
        'A1-2',
        'The complete wh-DP is internally merged to Spec,CP.',
        'Internal Merge creates CP with the complete pronounced DP in Spec,CP. The complete lower occurrence becomes silent, and AbarMove relates the two DP shells in the same movement moment.',
        [{ relation: 'AbarMove', anchors: { lowerCopy: 'dp_which_book_1', traceWitness: 'd_which_1', pronouncedCopy: 'dp_which_book_2' } }],
        phrasalMovementTree
      )
    ]
  },
  {
    archetype: 'A2. Trajectory / head',
    title: 'Head Movement',
    status: 'Current Babel renders this as a movement trajectory, using the same live renderer as Replay.',
    sentence: 'Did Noa leave',

    data: headMovementTree,
    derivationStages: [
      stage(
        'A2-1',
        'The complete clause is assembled with the auxiliary in T and an empty C.',
        'did is pronounced in its base T position. The CP and TP shells are complete, but head movement and the lower trace do not exist yet.',
        [],
        headMovementBaseTree
      ),
      stage(
        'A2-2',
        'The auxiliary head is realized in C with a lower T-head copy.',
        'HeadMove relates the lower T copy to the pronounced C head.',
        [{ relation: 'HeadMove', anchors: { source: 't_head_trace', target: 'c_head_did' } }],
        headMovementTree
      )
    ]
  },
  {
    archetype: 'A3. Trajectory / lowering',
    title: 'Lowering',
    status: 'Head lowering with complete displacement witnesses: the base frame holds the affix at its higher T origin, and the lowered frame keeps a silent occurrence there while the affix is realized inside the derived complex V head. The head-sized downward path runs between the two occurrences of the one affix; the head/phrase split is read off the anchored topology, and only the affix chain shares a lineage.',
    sentence: 'Mia laughed',

    data: loweringTree,
    derivationStages: [
      stage(
        'A3-1',
        'The tense affix is generated in T above its verbal host.',
        'The base structure holds the past-tense affix in T and the bare verb inside VP. No displacement has applied, so no relation is present.',
        [],
        loweringBaseTree
      ),
      stage(
        'A3-2',
        'The tense affix lowers to the verbal host.',
        'Lowering relates the silent higher origin of the affix in T to the lowered affix terminal inside the derived complex V head. The origin occurrence and the lowered occurrence are the same derivational object; the host verb is stationary and is not part of that chain.',
        [{ relation: 'Lowering', anchors: { source: 't_affix', target: 't_affix_low' } }],
        loweringTree
      )
    ]
  },
  {
    archetype: 'A3b. Trajectory / lowering',
    title: 'Lowering (embedded clause)',
    status: 'Lowering one clause down, with the same displacement witnesses as the root-clause card. The matrix tense is realized on said and is untouched; only the embedded affix lowers, keeping a silent origin in the embedded T while the affix terminal is realized inside the embedded complex V head. The regular host walk keeps lowering distinct from irregular PF realization: the path runs affix-to-affix and the stationary verb never looks like part of the trajectory.',
    sentence: 'Mia said Noa walked',

    data: embeddedLoweringTree,
    derivationStages: [
      stage(
        'A3b-1',
        'The embedded tense affix is generated in the embedded T.',
        'The base structure holds the embedded past-tense affix in the embedded T and the bare embedded verb inside its VP. The matrix tense is realized separately and never participates.',
        [],
        embeddedLoweringBaseTree
      ),
      stage(
        'A3b-2',
        'The embedded tense affix lowers to the embedded verbal host.',
        'Lowering relates the silent higher origin of the embedded affix to the lowered affix terminal inside the embedded complex V head. The host verb is stationary and outside the affix chain; the matrix T is realized separately and is not part of this relation.',
        [{ relation: 'Lowering', anchors: { source: 't_affix_lower2', target: 't_affix_low_lower2' } }],
        embeddedLoweringTree
      )
    ]
  },
  {
    archetype: 'B. Identity / copy / chain',
    title: 'Identity / Copy Chain',
    status: 'Current Babel shows head movement for Did and successive-cyclic wh-movement for Which book; the identity lens marks only the DP copy family.',
    sentence: 'Which book did Mia say that Noa filed',

    data: identityTree,
    derivationStages: [
      stage(
        'B-1',
        'The embedded clause is assembled with Which book in object position.',
        'The complete wh-DP is pronounced in its base object position. No movement occurrence or relation exists yet.',
        [],
        identityEmbeddedBaseTree
      ),
      stage(
        'B-2',
        'The complete wh-DP moves to the embedded CP edge.',
        'AbarMove creates the complete pronounced edge occurrence and leaves the complete lower object occurrence silent in the same movement moment.',
        [{ relation: 'AbarMove', anchors: { lowerCopy: 'dp_book_file_gap', traceWitness: 'd_book_file_trace', higherCopy: 'dp_book_edge_gap' } }],
        identityEmbeddedEdgeTree(true)
      ),
      stage(
        'B-3',
        'The matrix clause is assembled around the embedded CP.',
        'The embedded edge occurrence remains pronounced while the matrix clause is built with did in T and an empty C.',
        [],
        identityMatrixBaseTree
      ),
      stage(
        'B-4',
        'Did raises from T to C.',
        'HeadMove realizes did in C and leaves its silent lower T occurrence in one head-movement moment.',
        [{ relation: 'HeadMove', anchors: { source: 't_identity_did_trace', target: 'c_identity_did' } }],
        identityHeadMovedTree
      ),
      stage(
        'B-5',
        'The three DP occurrences are inspected as one identity family.',
        'Identity adds no path. It marks the pronounced landing, intermediate edge, and base object as occurrences of the same DP chain.',
        [
          { relation: 'AbarMove', anchors: { lowerCopy: 'dp_book_edge_gap', traceWitness: 'd_book_edge_trace', pronouncedCopy: 'dp_book_high' } },
          { relation: 'Identity', anchors: { pronouncedCopy: 'dp_book_high', intermediateCopy: 'dp_book_edge_gap', lowerCopy: 'dp_book_file_gap' } }
        ],
        identityTree
      )
    ],
    lensLabel: 'Chain lens'
  },
  {
    archetype: 'B2. Identity / copy / chain',
    title: 'Identity / Copy Chain (four occurrences)',
    status: 'A four-position successive-cyclic A-bar chain: the object moves from its base position through two embedded CP edges before reaching matrix Spec,CP. Replay introduces one link per stage; the final frame retains all three links and marks exactly four occurrences as one identity family.',
    sentence: 'Which book did Mia say that Noa claimed that Ava filed',
    data: fourOccurrenceIdentityTree,
    derivationStages: [
      stage(
        'B2-0',
        'The lowest embedded C-prime is assembled with the wh-DP in object position.',
        'The complete base object and its complete C-prime host exist before movement to the first CP edge.',
        [],
        fourOccurrenceIdentityLowCbarTree
      ),
      stage(
        'B2-1',
        'The wh-DP moves from object position to the edge of the lowest embedded CP.',
        'AbarMove relates the base object copy to the first CP-edge occurrence.',
        [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_chain4_base',
            traceWitness: 'd_chain4_base',
            higherCopy: 'dp_chain4_edge_low'
          }
        }],
        fourOccurrenceIdentityLowEdgeTree
      ),
      stage(
        'B2-2a',
        'The next embedded C-prime is assembled around the completed lower CP.',
        'The first CP-edge occurrence remains pronounced while the next clause is built. The second landing does not exist yet.',
        [],
        fourOccurrenceIdentityMidCbarTree
      ),
      stage(
        'B2-2b',
        'The wh-DP moves from the lower CP edge to the next embedded CP edge.',
        'AbarMove relates the first CP-edge occurrence to the second CP-edge occurrence; the earlier movement remains part of the chain.',
        [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_chain4_edge_low',
            traceWitness: 'd_chain4_edge_low',
            higherCopy: 'dp_chain4_edge_mid'
          }
        }],
        fourOccurrenceIdentityMidEdgeTree
      ),
      stage(
        'B2-3a',
        'The matrix C-prime is assembled around the completed embedded CP.',
        'The second embedded edge occurrence remains pronounced while the matrix clause is built. Matrix Spec,CP does not exist yet.',
        [],
        fourOccurrenceIdentityMatrixCbarTree
      ),
      stage(
        'B2-3b',
        'The wh-DP moves from the intermediate CP edge to matrix Spec,CP.',
        'AbarMove relates the second CP-edge occurrence to the pronounced matrix occurrence. Identity marks the final landing, both intermediate edges, and the base object as one four-occurrence family.',
        [
          {
            relation: 'AbarMove',
            anchors: {
              lowerCopy: 'dp_chain4_edge_mid',
              traceWitness: 'd_chain4_edge_mid',
              pronouncedCopy: 'dp_chain4_high'
            }
          },
          {
            relation: 'Identity',
            anchors: {
              occurrences: [
                'dp_chain4_high',
                'dp_chain4_edge_mid',
                'dp_chain4_edge_low',
                'dp_chain4_base'
              ]
            }
          }
        ],
        fourOccurrenceIdentityTree
      )
    ],

    wide: true,
    lensLabel: 'Four-occurrence chain lens'
  },
  {
    archetype: 'B3. Identity / copy / chain',
    title: 'Identity / Copy Chain (passive)',
    status: 'A two-position A-chain in a passive, where the first card shows a three-position A-bar chain. A-movement creates the higher subject occurrence and lower silent copy; the identity family then marks those two positions as one object.',
    sentence: 'The book was read',
    data: passiveIdentityTree,
    derivationStages: [
      stage(
        'B3-0',
        'The object is first merged in the complement position of read.',
        'The complete passive predicate is present with the book pronounced in its base object position. No movement or identity relation has applied.',
        [],
        passiveIdentityBaseTree
      ),
      stage(
        'B3-1',
        'The object A-moves to subject position, leaving a lower silent occurrence.',
        'AMove creates the higher pronounced occurrence and lower silent copy. Identity then marks those two positions as one family while the movement path remains visible.',
        [
          {
            relation: 'AMove',
            anchors: {
              lowerCopy: 'dp_book_low_id2',
              traceWitness: 'd_the_low_id2',
              pronouncedCopy: 'dp_book_high_id2'
            }
          },
          {
            relation: 'Identity',
            anchors: { pronouncedCopy: 'dp_book_high_id2', lowerCopy: 'dp_book_low_id2' }
          }
        ],
        passiveIdentityTree
      )
    ],
    lensLabel: 'Chain lens'
  },
  {
    archetype: 'C. Binding / control / coreference',
    title: 'Control Dependency',
    status: 'Current Babel renders coindexing, a dotted directed control dependency, and the embedded TP control domain as a focused relation layer.',
    sentence: 'John promised to leave',
    data: controlTree,
    derivationStages: [
      stage(
        'C-0',
        'The matrix predicate and infinitival TP are assembled with PRO as the embedded subject.',
        'The silent embedded subject and its complete infinitival domain are structurally present before a controller is identified.',
        [],
        controlTree
      ),
      stage(
        'C',
        'John controls the silent embedded PRO subject.',
        'Control relates the controller DP to the silent controlled subject in the embedded TP.',
        [{ relation: 'Control', anchors: { controller: 'john_dp', controllee: 'pro_subject', domain: 'tp_inf' } }],
        controlTree
      )
    ],
    lensLabel: 'Control lens'
  },
  {
    archetype: 'C1b. Binding / control / coreference',
    title: 'Control Dependency (object control)',
    status: 'The controller is the matrix object here, where the first card has a subject controller. The dependency therefore runs from a lower, closer antecedent, and the control domain sits beside it rather than under it.',
    sentence: 'Mia persuaded Noa to leave',
    data: objectControlTree,
    derivationStages: [
      stage(
        'C1b-0',
        'The matrix object and infinitival TP are assembled with PRO as the embedded subject.',
        'Noa and the silent embedded subject are both structurally present before the object-control dependency is established.',
        [],
        objectControlTree
      ),
      stage(
        'C1b',
        'Noa controls the silent embedded PRO subject.',
        'Control relates the matrix object to the silent controlled subject in the embedded infinitival TP.',
        [{
          relation: 'Control',
          anchors: { controller: 'noa_ctrl2', controllee: 'pro_ctrl2', domain: 'tp_inf_ctrl2' }
        }],
        objectControlTree
      )
    ],
    lensLabel: 'Control lens'
  },
  {
    archetype: 'C2. Binding / Principle A',
    title: 'Binding / Principle A',
    status: 'Binding is not movement: the relation layer shows coindexed DPs and the local c-command domain that licenses the anaphor.',
    sentence: 'John saw himself',
    data: bindingTree,
    derivationStages: [
      stage(
        'C2',
        "John binds the anaphor himself inside the V' constituent that is John's c-commanded sister.",
        "Binding marks John and himself with the same index and highlights the V' sister domain c-commanded by John; it does not draw a movement path.",
        [{ relation: 'Binding', anchors: { binder: 'john_binding', bound: 'himself_binding', domain: 'vbar_binding' } }],
        bindingTree
      )
    ],
    lensLabel: 'Binding lens'
  },
  {
    archetype: 'C3. Binding / C-command Failure',
    title: 'Binding / C-command Failure',
    status: "The same circle/domain convention as the licensed card, from the CAS LX 522 Principle A slide family: the circled domain is everything the intended binder c-commands — its D' sister inside the possessive DP — and the coindexed anaphor falls outside it. The failure is the authored outcome, not an inference from what the circle happens to contain, and no obstruction shape replaces the domain circle.",
    sentence: "John's mother saw himself",
    data: bindingBlockedTree,
    derivationStages: [
      stage(
        'C3-0',
        'The possessive subject and object anaphor are assembled in one VP.',
        'John remains inside the subject DP while himself occupies the object position. No binding relation has yet been evaluated.',
        [],
        bindingBlockedTree
      ),
      stage(
        'C3',
        'John inside the subject DP does not c-command the anaphor himself.',
        "Binding draws the same coindex and domain circle as the licensed configuration: the domain is the possessor's c-commanded sister inside the subject DP. The anaphor sits outside that domain, so the local c-command requirement fails, and the relation records the failed outcome itself.",
        [{
          relation: 'Binding',
          anchors: {
            binder: 'dp_john_possessor_binding',
            bound: 'himself_binding_blocked',
            domain: 'dbar_johns_mother_binding'
          },
          values: { outcome: 'failed' }
        }],
        bindingBlockedTree
      )
    ],
    lensLabel: 'Binding lens'
  },
  {
    archetype: 'C4. Coreference / reference',
    title: 'Plain Coreference',
    status: 'Coreference is deliberately minimal here: Babel only marks the two DPs with the same index. No binding domain, no control box, no movement path.',
    sentence: 'John said he left',
    data: coreferenceTree,
    derivationStages: [
      stage(
        'C4-0',
        'The matrix and embedded clauses are assembled with two independent referential DPs.',
        'John and he occupy their authored positions before the discourse interpretation identifies them as coreferential.',
        [],
        coreferenceTree
      ),
      stage(
        'C4',
        'John and he are interpreted as the same discourse individual.',
        'Coreference marks the matrix DP and embedded pronoun with the same index; it does not introduce a binding domain, control relation, or movement path.',
        [{ relation: 'Coreference', anchors: { antecedent: 'john_coref', pronoun: 'he_coref' } }],
        coreferenceTree
      )
    ]
  },
  {
    archetype: 'C4b. Coreference / reference',
    title: 'Plain Coreference (across coordination)',
    status: 'Coreference between conjuncts rather than between a matrix and an embedded clause. Neither DP c-commands the other, which is what makes this coreference and not binding: shared index only, no domain and no path.',
    sentence: 'Noa arrived and she waved',
    data: coordinateCoreferenceTree,
    derivationStages: [
      stage(
        'C4b-0',
        'The two clauses are assembled as a complete coordination.',
        'Noa and she occupy separate conjuncts before the discourse interpretation identifies them as coreferential.',
        [],
        coordinateCoreferenceTree
      ),
      stage(
        'C4b',
        'Noa and she pick out the same individual across the two conjuncts.',
        'Coreference marks the two DPs with the same index. It draws no movement path and no binding domain, because no structural relation between them is claimed.',
        [{
          relation: 'Coreference',
          anchors: { first: 'noa_coref2', second: 'she_coref2' }
        }],
        coordinateCoreferenceTree
      )
    ],
    lensLabel: 'Coreference lens'
  },
  {
    archetype: 'C5. Predication / primary',
    title: 'Predication',
    status: 'The Brownlow source contributes one added mark: an undirected dotted path between the subject predicand and the predicating head. It is not movement, control, or ordinary dominance.',
    sentence: 'Mia laughed',
    data: primaryPredicationTree,
    derivationStages: [
      stage(
        'C5',
        'Mia is the predicand of laughed.',
        'Predication relates the subject DP to the verbal predicate with an undirected dotted path.',
        [{
          relation: 'Predication',
          anchors: {
            predicand: 'dp_mia_predication_primary',
            predicate: 'v_laughed_predication_primary'
          }
        }],
        primaryPredicationTree
      )
    ],
    lensLabel: 'Predication lens'
  },
  {
    archetype: 'C5b. Predication / resultative',
    title: 'Predication (resultative)',
    status: 'The Enfield source generalizes the same dotted relation to one predicand and several predicates. The paths share their source but remain separate claims; no resultative-specific mark is invented.',
    sentence: 'Mia froze solid',
    data: resultativePredicationTree,
    derivationStages: [
      stage(
        'C5b',
        'Mia is the understood subject of the event and resulting-state predicates.',
        'Predication links one subject predicand to froze and solid with two undirected dotted paths.',
        [{
          relation: 'Predication',
          anchors: {
            predicand: 'dp_mia_predication_resultative',
            predicates: [
              'v_froze_predication_resultative',
              'a_solid_predication_resultative'
            ]
          }
        }],
        resultativePredicationTree
      )
    ],
    lensLabel: 'Predication lens'
  },
  {
    archetype: 'D. Feature / agreement / licensing',
    title: 'Agree / Feature Valuation',
    status: 'Current Babel can render feature valuation as anchored bundles near the syntactic objects that bear those features.',
    sentence: 'The girls arrive',
    data: agreeTree,
    derivationStages: [
      stage(
        'D',
        'T values phi features against the DP goal.',
        'Agree relates the T probe to the DP goal; Nom is licensed on the DP. Each participant carries its own authored feature bundle.',
        [
          {
            relation: 'Agree',
            anchors: { probe: 't_phi_probe', goal: 'girls_goal' },
            values: { 'uφ': '__ → 3PL', Case: 'NOM' }
          },
          {
            relation: 'FeatureBundle',
            anchors: { goal: 'girls_goal' },
            values: { 'φ': '3PL', Case: 'NOM' }
          }
        ],
        agreeTree
      )
    ],

    lensLabel: 'Agree lens'
  },
  {
    archetype: 'D2. Feature / agreement / licensing',
    title: 'Agree / Expletive Associate',
    status: 'The probe agrees with a postverbal associate, not with the subject in its specifier. The expletive occupies the subject position and carries no plaque, so the plaques land on the two participants the relation actually names.',
    sentence: 'There arrive three girls',
    data: expletiveAgreeTree,
    derivationStages: [
      stage(
        'D2-0',
        'The expletive clause is assembled with a postverbal associate.',
        'There occupies the subject position, the associate DP remains postverbal, and T is available as a probe before Agree applies.',
        [],
        expletiveAgreeTree
      ),
      stage(
        'D2',
        'T values phi features against the postverbal associate.',
        'Agree relates the T probe to the associate DP across the expletive. Each participant carries its own authored feature bundle; the expletive carries none.',
        [
          {
            relation: 'Agree',
            anchors: { probe: 't_probe_agr2', goal: 'dp_girls_agr2' },
            values: { 'uφ': '__ → 3PL' }
          },
          {
            relation: 'FeatureBundle',
            anchors: { associate: 'dp_girls_agr2' },
            values: { 'φ': '3PL', Case: 'NOM' }
          }
        ],
        expletiveAgreeTree
      )
    ],
    lensLabel: 'Agree lens'
  },
  {
    archetype: 'D3. Feature / agreement / multiple goals',
    title: 'Multiple Agree',
    status: 'Nevins (2011), Figure 61: T sits to the left of both goals. One short inward curve reaches the higher DP and one long outer curve reaches the lower DP, matching the source rather than using a generic symmetric fan.',
    sentence: 'We see you',
    data: multipleAgreeTree,
    wide: true,
    derivationStages: [
      stage(
        'D3',
        'One T probe agrees with the subject and object DPs.',
        'MultipleAgree relates one probe to two simultaneous goals. The renderer expands the authored goal array into a directed fan-out.',
        [{
          relation: 'MultipleAgree',
          anchors: {
            probe: 't_probe_multiple_agree',
            goals: ['dp_subject_multiple_agree', 'dp_object_multiple_agree']
          },
          values: { outcome: 'successful' }
        }],
        multipleAgreeTree
      )
    ],
    lensLabel: 'Multiple Agree lens'
  },
  {
    archetype: 'D3b. Feature / agreement / multiple goals',
    title: 'Multiple Agree (embedded clause)',
    status: 'The Nevins routing is repeated one clause down: a short curve to the nearer DP and a long outside curve to the lower DP, both derived from the embedded anchors.',
    sentence: 'that we see you',
    data: embeddedMultipleAgreeTree,
    wide: true,
    derivationStages: [
      stage(
        'D3b-0',
        'The embedded clause is assembled with both nominal goals.',
        'The embedded T probe and the two DPs are structurally present before the simultaneous agreement relation is introduced.',
        [],
        embeddedMultipleAgreeTree
      ),
      stage(
        'D3b',
        'The embedded T probe agrees with both embedded DPs.',
        'MultipleAgree expands the embedded probe’s authored goal array into the same simultaneous directed fan-out.',
        [{
          relation: 'MultipleAgree',
          anchors: {
            probe: 't_probe_multiple_agree_embedded',
            goals: [
              'dp_subject_multiple_agree_embedded',
              'dp_object_multiple_agree_embedded'
            ]
          },
          values: { outcome: 'successful' }
        }],
        embeddedMultipleAgreeTree
      )
    ],
    lensLabel: 'Multiple Agree lens'
  },
  {
    archetype: 'D4. Feature / agreement / cyclic search',
    title: 'Cyclic Agree',
    status: 'Keine and Dash (2023), Figure 1: cycle 1 searches the complement but fails because the internal DP is inaccessible to the probe. Only then can Merge expand the search space and make the external DP available to cycle 2. Replay introduces one numbered search curve per relation frame.',
    sentence: 'Mia saw Noa',
    data: cyclicAgreeSecondCycleTree,
    wide: true,
    derivationStages: [
      stage(
        'D4.1',
        'The first Agree cycle searches the probe complement but cannot value the probe.',
        'CyclicAgree cycle 1 reaches the internal DP inside VP, but that DP is inaccessible to the probe, so the first cycle is unsuccessful and the probe remains unvalued.',
        [{
          relation: 'CyclicAgree',
          anchors: {
            probe: 'v_probe_cyclic_agree',
            goal: 'dp_internal_cyclic_agree'
          },
          values: { cycle: '1', outcome: 'unsuccessful', reason: 'goal inaccessible' }
        }],
        cyclicAgreeFirstCycleTree
      ),
      stage(
        'D4.2',
        'After the failed first cycle, the external argument is merged and becomes available to the second Agree cycle.',
        'CyclicAgree cycle 2 expands the search space and curves from the still-unvalued probe to the newly merged accessible external DP. Replay retains the earlier failed search quietly so the ordered pair remains legible.',
        [{
          relation: 'CyclicAgree',
          anchors: {
            probe: 'v_probe_cyclic_agree',
            goal: 'dp_goal_cyclic_agree'
          },
          values: { cycle: '2', outcome: 'successful' }
        }],
        cyclicAgreeSecondCycleTree
      )
    ],
    lensLabel: 'Cyclic Agree lens'
  },
  {
    archetype: 'D4b. Feature / agreement / cyclic search',
    title: 'Cyclic Agree (embedded clause)',
    status: 'The same Keine–Dash sequence occurs under an overt complementizer. The inaccessible internal DP leaves cycle 1 unsuccessful; after Merge expands the search space, the external DP becomes the accessible goal for cycle 2.',
    sentence: 'that Mia saw Noa',
    data: embeddedCyclicAgreeFinalTree,
    wide: true,
    derivationStages: [
      stage(
        'D4b.1',
        'The embedded probe first searches its VP complement but cannot value against the inaccessible internal DP.',
        'CyclicAgree cycle 1 reaches the embedded internal DP before the external argument exists, but the goal is inaccessible and the probe remains unvalued.',
        [{
          relation: 'CyclicAgree',
          anchors: {
            probe: 'v_probe_cyclic_agree_embedded',
            goal: 'dp_internal_cyclic_agree_embedded'
          },
          values: { cycle: '1', outcome: 'unsuccessful', reason: 'goal inaccessible' }
        }],
        embeddedCyclicAgreeFirstCycleTree
      ),
      stage(
        'D4b.2',
        'After the failed first cycle, the embedded external argument is merged for cycle 2.',
        'CyclicAgree cycle 2 reaches the newly available accessible external DP and values the probe in its own relation frame.',
        [{
          relation: 'CyclicAgree',
          anchors: {
            probe: 'v_probe_cyclic_agree_embedded',
            goal: 'dp_goal_cyclic_agree_embedded'
          },
          values: { cycle: '2', outcome: 'successful' }
        }],
        embeddedCyclicAgreeSecondCycleTree
      ),
      stage(
        'D4b.3',
        'The completed vP is embedded under the overt complementizer.',
        'External Merge combines that with the already completed vP only after both Agree cycles have finished.',
        [],
        embeddedCyclicAgreeFinalTree
      )
    ],
    lensLabel: 'Cyclic Agree lens'
  },
  {
    archetype: 'D5. Feature / sharing',
    title: 'Feature Sharing',
    status: 'Keine, Figure 18 supplies the relation grammar, not Babel’s host tree: thin undirected vines leave the terminal bearers and converge on one shared green Case plaque without following dominance branches.',
    sentence: 'The three red books',
    data: featureSharingTree,
    wide: true,
    derivationStages: [
      stage(
        'D5',
        'The nominal elements share one Case feature.',
        'FeatureSharing relates D, Num, A, and N to one shared Case token with undirected association lines.',
        [{
          relation: 'FeatureSharing',
          anchors: {
            bearers: [
              'd_feature_sharing',
              'num_feature_sharing',
              'a_feature_sharing',
              'n_feature_sharing'
            ]
          },
          values: { feature: 'Case', value: '□' }
        }],
        featureSharingTree
      )
    ],
    lensLabel: 'Feature Sharing lens'
  },
  {
    archetype: 'D5b. Feature / sharing',
    title: 'Feature Sharing (selected DP)',
    status: 'The same Keine vine grammar now begins at three feature-bearing leaves inside a PP-selected DP and converges on one shared green Case plaque.',
    sentence: 'with the two books',
    data: selectedFeatureSharingTree,
    wide: true,
    derivationStages: [
      stage(
        'D5b',
        'Three nominal elements inside the selected DP share one Case feature.',
        'FeatureSharing connects D, Num, and N to one shared Case token with three undirected vines.',
        [{
          relation: 'FeatureSharing',
          anchors: {
            bearers: [
              'd_feature_sharing_selected',
              'num_feature_sharing_selected',
              'n_feature_sharing_selected'
            ]
          },
          values: { feature: 'Case', value: '□' }
        }],
        selectedFeatureSharingTree
      )
    ],
    lensLabel: 'Feature Sharing lens'
  },
  {
    archetype: 'D6. Case / assignment and collection',
    title: 'Case Assignment / Feature Collection',
    status: 'Norris, Figure 37: the solid directed path assigns DAT from P to K, while quieter dotted Agree paths collect PL and MASC from their nominal sources. Babel cleans the lanes without changing that solid-versus-dotted distinction.',
    sentence: 'Af hestum',
    data: caseAssignmentTree,
    wide: true,
    derivationStages: [
      stage(
        'D6-0',
        'The PP and its complete nominal feature-bearing structure are assembled.',
        'P, K, Num, and the gender-bearing nominal are all structurally present before Case assignment and feature collection apply.',
        [],
        caseAssignmentTree
      ),
      stage(
        'D6',
        'P assigns dative Case while K collects number and gender.',
        'CaseAssignment supplies the Case row on K. Two Agree relations supply the number and gender rows and connect the same plaque to their authored sources with dotted paths. Production composes one plaque from these three claims; Replay gives each claim its own moment.',
        [
          {
            relation: 'CaseAssignment',
            anchors: {
              assigner: 'p_case_assignment',
              bearer: 'k_case_assignment'
            },
            values: { feature: 'Case', value: 'DAT' }
          },
          {
            relation: 'Agree',
            anchors: {
              probe: 'k_case_assignment',
              goal: 'num_case_assignment'
            },
            values: { feature: 'Number', value: 'PL' }
          },
          {
            relation: 'Agree',
            anchors: {
              probe: 'k_case_assignment',
              goal: 'n_gender_case_assignment'
            },
            values: { feature: 'Gender', value: 'MASC' }
          }
        ],
        caseAssignmentTree
      )
    ],
    lensLabel: 'Case lens'
  },
  {
    archetype: 'D6b. Case / assignment and collection',
    title: 'Case Assignment / Feature Collection (embedded PP)',
    status: 'The Norris convention is embedded under VP and routed from a different P. Solid Case assignment still targets the K Case row; the two dotted collection paths still terminate on Number and Gender.',
    sentence: 'spoke með vinum',
    data: embeddedCaseAssignmentTree,
    wide: true,
    derivationStages: [
      stage(
        'D6b-0',
        'The embedded PP and its complete nominal feature-bearing structure are assembled inside VP.',
        'The selecting verb, P, K, Num, and the gender-bearing nominal are structurally present before Case assignment and feature collection apply.',
        [],
        embeddedCaseAssignmentTree
      ),
      stage(
        'D6b',
        'The embedded P assigns Case while K collects nominal features.',
        'CaseAssignment and the two Agree paths preserve the source’s solid-versus-dotted distinction inside a deeper constituent.',
        [
          {
            relation: 'CaseAssignment',
            anchors: {
              assigner: 'p_med_case_assignment_embedded',
              bearer: 'k_case_assignment_embedded'
            },
            values: { feature: 'Case', value: 'DAT' }
          },
          {
            relation: 'Agree',
            anchors: {
              probe: 'k_case_assignment_embedded',
              goal: 'num_case_assignment_embedded'
            },
            values: { feature: 'Number', value: 'PL' }
          },
          {
            relation: 'Agree',
            anchors: {
              probe: 'k_case_assignment_embedded',
              goal: 'n_gender_case_assignment_embedded'
            },
            values: { feature: 'Gender', value: 'MASC' }
          }
        ],
        embeddedCaseAssignmentTree
      )
    ],
    lensLabel: 'Case lens'
  },
  {
    archetype: 'D7. Case / dependent / low',
    title: 'Dependent Case (low)',
    status: 'Poole (2024), Figure 10: the higher DP first unlocks the dependent-Case probe; the newly active probe then values the lower DP. Each ordered step uses the source’s elbow connector with filled circular endpoints, never a movement arrowhead.',
    sentence: 'Aya saw Noa',
    data: lowDependentCaseTree,
    wide: true,
    derivationStages: [
      stage(
        'D7.1',
        'The higher DP values the first probe and unlocks dependent Case.',
        'DependentCase step 1 draws the source’s two-turn bracket between the T probe state and the higher DP Case state.',
        [{
          relation: 'DependentCase',
          anchors: {
            probe: 't_probe_low_dependent_case',
            goal: 'dp_high_low_dependent_case'
          },
          values: {
            step: '1',
            Case: 'UNM',
            probeLabel: '[*φ*] UNM',
            goalLabel: '[CASE: □]'
          }
        }],
        lowDependentCaseTree
      ),
      stage(
        'D7.2',
        'The unlocked probe assigns dependent Case to the lower DP.',
        'DependentCase step 2 replaces the earlier frame with the source’s single L connector: down from the higher active T state, then across to the lower DP Case state.',
        [{
          relation: 'DependentCase',
          anchors: {
            probe: 't_probe_low_dependent_case',
            goal: 'dp_low_low_dependent_case'
          },
          priorAnchors: {
            probe: 't_probe_low_dependent_case',
            goal: 'dp_high_low_dependent_case'
          },
          values: {
            step: '2',
            Case: 'DEP',
            probeLabel: '[*φ*] UNM/DEP',
            goalLabel: '[CASE: DEP]'
          }
        }],
        lowDependentCaseTree
      )
    ],
    lensLabel: 'Dependent Case lens'
  },
  {
    archetype: 'D7b. Case / dependent / high',
    title: 'Dependent Case (high)',
    status: 'Poole (2024), Figure 11 reverses the configuration: the lower DP unlocks the probe and the higher DP receives dependent Case. The same endpoint and elbow grammar must work without position-specific tuning.',
    sentence: 'Aya saw Noa',
    data: highDependentCaseTree,
    wide: true,
    derivationStages: [
      stage(
        'D7b.1',
        'The lower DP values the first probe and unlocks dependent Case.',
        'DependentCase step 1 draws the source’s two-turn bracket between the v probe state and the lower DP Case state.',
        [{
          relation: 'DependentCase',
          anchors: {
            probe: 'v_probe_high_dependent_case',
            goal: 'dp_low_high_dependent_case'
          },
          values: {
            step: '1',
            Case: 'UNM',
            probeLabel: '[*φ*] UNM',
            goalLabel: '[CASE: □]'
          }
        }],
        highDependentCaseTree
      ),
      stage(
        'D7b.2',
        'The unlocked probe assigns dependent Case to the higher DP.',
        'DependentCase step 2 replaces the earlier frame with the source’s single L connector: down from the higher DP Case state, then across to the lower active v state.',
        [{
          relation: 'DependentCase',
          anchors: {
            probe: 'v_probe_high_dependent_case',
            goal: 'dp_high_high_dependent_case'
          },
          priorAnchors: {
            probe: 'v_probe_high_dependent_case',
            goal: 'dp_low_high_dependent_case'
          },
          values: {
            step: '2',
            Case: 'DEP',
            probeLabel: '[*φ*] UNM/DEP',
            goalLabel: '[CASE: DEP]'
          }
        }],
        highDependentCaseTree
      )
    ],
    lensLabel: 'Dependent Case lens'
  },
  {
    archetype: 'E1. Locality / bounding-node crossing',
    title: 'Bounding-Node Crossing (complex NP)',
    status: 'A strong complex-NP witness replaces the weak whether-island fixture. The exact deviant input forces the completed A-bar chain; BoundingNodeCrossing then judges that chain illicit and places one equal cut on each authored bounding node it crosses: embedded TP, the containing NP, and matrix TP.',
    sentence: 'Which book did Mia believe the claim that Noa read',
    wide: true,
    data: complexNpTree,
    derivationStages: [
      stage(
        'E1-0',
        'The matrix C-prime is assembled with the wh-DP inside the complex NP.',
        'The complete wh-DP remains pronounced as the embedded object inside the complex NP. Matrix Spec,CP and the crossing diagnostic do not yet exist.',
        [],
        movementBaseTree(complexNpTree, 'dp_which_book_cnpc_high', 'dp_which_book_cnpc_low', ['cp_cnpc'])
      ),
      stage(
        'E1-1',
        'The wh-DP A-bar moves from the complex-NP object position to matrix Spec,CP.',
        'AbarMove creates the completed chain required by the pronounced initial wh-DP and its silent embedded object occurrence.',
        [{ relation: 'AbarMove', anchors: { lowerCopy: 'dp_which_book_cnpc_low', traceWitness: 'd_which_cnpc_low', pronouncedCopy: 'dp_which_book_cnpc_high' } }],
        complexNpTree
      ),
      stage(
        'E1-2',
        'The completed A-bar chain violates the authored bounding-node condition.',
        'BoundingNodeCrossing judges the completed chain illicit because it crosses the embedded TP, the containing NP, and the matrix TP. IllicitAnalysis marks the complete derivation with the authored star.',
        [
          {
            relation: 'BoundingNodeCrossing',
            anchors: {
              domain: 'cp_cnpc',
              boundary: ['tp_cnpc_embedded', 'np_claim_cnpc', 'tp_cnpc_matrix']
            },
            values: { outcome: 'blocked' }
          },
          {
            relation: 'IllicitAnalysis',
            anchors: { analysis: 'cp_cnpc' },
            values: { judgment: '*' }
          }
        ],
        complexNpTree
      )
    ],
    lensLabel: 'Bounding-node lens'
  },
  {
    archetype: 'E1b. Locality / bounding-node crossing',
    title: 'Bounding-Node Crossing (wh-island)',
    status: 'Archived historical Subjacency fixture. The whether-clause example is a weak island and D-linked which book is acceptable for many speakers, so this tree demonstrates the classical two-TP notation but is not the canonical live violation.',
    sentence: 'Which book did Mia wonder whether Noa read',
    data: domainTree,
    derivationStages: [
      stage(
        'E1b-0',
        'The matrix C-prime is assembled with the wh-DP still in the embedded object position.',
        'The complete wh-DP remains pronounced inside the embedded whether clause. Matrix Spec,CP and the historical bounding-node diagnostic have not been introduced.',
        [],
        movementBaseTree(domainTree, 'dp_which_book_island_high', 'dp_which_book_island_low', ['cp_island_matrix'])
      ),
      stage(
        'E1b',
        'The classical analysis associates the matrix wh-DP with an object position inside the whether clause.',
        'AbarMove relates the embedded object copy to the pronounced wh-DP. BoundingNodeCrossing records the two TP cuts in the archived classical analysis.',
        [
          { relation: 'AbarMove', anchors: { lowerCopy: 'dp_which_book_island_low', traceWitness: 'd_which_island_low', pronouncedCopy: 'dp_which_book_island_high' } },
          { relation: 'BoundingNodeCrossing', anchors: { domain: 'cp_island_matrix', boundary: ['tp_embedded_island', 'tp_island_matrix'] } }
        ],
        domainTree
      )
    ],
    lensLabel: 'Bounding-node lens'
  },
  {
    archetype: 'E2. Phase / edge',
    title: 'Phase Boundary',
    status: 'An authored phase domain and its authored edge, nothing further. The arc marks the domain the relation names; it does not assert islandhood, movement, Spell-Out, or what is accessible, since none of that is authored here.',
    sentence: 'Sara read the book',
    data: phaseTree,
    derivationStages: [
      stage(
        'E2-0',
        'The clause is assembled through the complete vP.',
        'Sara occupies the vP edge and the complete verbal complement is present before any phase-domain annotation is introduced.',
        [],
        phaseTree
      ),
      stage(
        'E2',
        'The derivation contains a vP phase with an authored edge position.',
        'Phase names one phase domain and its edge. The arc marks that domain; no accessibility, transfer, or movement claim is authored at this stage.',
        [
          { relation: 'Phase', anchors: { phase: 'vp_phase', edge: 'sara_phase_edge' } }
        ],
        phaseTree
      )
    ],
    lensLabel: 'Phase lens'
  },
  {
    archetype: 'E3. Phase / multiple domains',
    title: 'Multiple Phase Boundaries',
    status: 'Three authored phase domains in one derivation, each drawn from its own relation. Lena and Orion occur once at their vP edges, so the card invents no subject-movement chains. For the embedded CP, pronounced C is the phase head and accessible edge anchor; Babel does not invent an empty Spec node.',
    sentence: 'Lena said that Orion praised the singer',
    data: multiPhaseTree,
    derivationStages: [
      stage(
        'E3-0',
        'The matrix and embedded clauses are assembled into one connected structure.',
        'The two vPs and the embedded CP are structurally complete, with their authored edge material present, before phase domains are inspected.',
        [],
        multiPhaseTree
      ),
      stage(
        'E3',
        'The derivation contains a matrix vP phase, an embedded CP phase, and an embedded vP phase.',
        'Phase names three separate domains. The vP edges are the authored subject DPs; the embedded CP uses its pronounced phase head as the accessible edge anchor. No relation between the domains is authored.',
        [
          { relation: 'Phase', anchors: { phase: 'vp_matrix_multiphase', edge: 'lena_matrix_edge' } },
          { relation: 'Phase', anchors: { phase: 'cp_embedded_multiphase', edge: 'c_that_multiphase' } },
          { relation: 'Phase', anchors: { phase: 'vp_embedded_multiphase', edge: 'orion_embedded_edge' } }
        ],
        multiPhaseTree
      )
    ],
    lensLabel: 'Multi-phase lens'
  },
  {
    archetype: 'O7. Domain / mixed region stress',
    title: 'Phase Boundaries (nested and disjoint)',
    status: 'One complete coordination exercises the existing phase primitive in both required configurations: the left vP is nested inside the left CP, while the right CP is disjoint from both. No new domain geometry is introduced.',
    sentence: 'Lena read and Noa wrote',
    wide: true,
    data: phaseStressTree,
    derivationStages: [
      stage(
        'O7-0',
        'The coordinated clauses are assembled with the left vP nested inside its CP.',
        'Both conjuncts are structurally complete before the nested and disjoint phase regions are inspected.',
        [],
        phaseStressTree
      ),
      stage(
        'O7',
        'The structure contains one nested phase and one disjoint phase.',
        'Three Phase relations independently name the left CP, its nested vP, and the separate right CP. The renderer derives three arcs from those nodes.',
        [
          { relation: 'Phase', anchors: { phase: 'cp_left_phase_stress', edge: 'c_left_phase_stress' } },
          { relation: 'Phase', anchors: { phase: 'vp_left_phase_stress', edge: 'dp_lena_edge_phase_stress' } },
          { relation: 'Phase', anchors: { phase: 'cp_right_phase_stress', edge: 'c_right_phase_stress' } }
        ],
        phaseStressTree
      )
    ],
    lensLabel: 'Mixed-phase lens'
  },
  {
    archetype: 'E4. Phase / transfer',
    title: 'Transfer / Spell-Out Domain',
    status: "Fong's source composition translated onto a Babel vP: a clean tilted solid arc is labelled Phase, a roomy outline marks the DP phase edge, and a matching dashed SOD arc marks only the transferred VP complement. Sara occurs once at the edge; no unrelated movement chain is present.",
    sentence: 'Sara read the book',
    data: transferPhaseTree,
    derivationStages: [
      stage(
        'E4-2',
        'The vP is identified as a phase with Sara at its edge.',
        'Phase names the vP domain and its authored edge position.',
        [{ relation: 'Phase', anchors: { phase: 'vp_transfer', edge: 'sara_transfer_edge' } }],
        transferPhaseTree
      ),
      stage(
        'E4-3',
        'The VP complement is transferred.',
        'TransferDomain names the phase, its edge, and the VP complement sent to the interfaces. The dashed inner arc is the source notation for that Spell-Out domain.',
        [{
          relation: 'TransferDomain',
          anchors: {
            phase: 'vp_transfer',
            edge: 'sara_transfer_edge',
            spellOutDomain: 'vp_transfer_complement'
          }
        }],
        transferPhaseTree
      )
    ],
    lensLabel: 'Transfer lens'
  },
  {
    archetype: 'E4b. Phase / PIC',
    title: 'Post-Transfer Access Failure',
    status: "Fong's Brazilian Portuguese long-distance-agreement violation makes every endpoint independent syntax: matrix T is the plural probe, os alunos is the embedded goal, finite CP is the phase, and its TP complement is the transferred SOD. The dashed path records failed Agree access, not movement.",
    sentence: 'Parecem que os alunos visitaram o zoológico',
    data: postTransferLdaTree,
    wide: true,
    derivationStages: [
      stage(
        'E4b-1',
        'The embedded finite CP is identified as a phase.',
        'Phase names the embedded CP and its pronounced C head que as the accessible phase edge.',
        [{ relation: 'Phase', anchors: { phase: 'cp_embedded_fong_lda', edge: 'c_que_fong_lda' } }],
        postTransferLdaTree
      ),
      stage(
        'E4b-2',
        'The embedded TP complement is transferred.',
        'TransferDomain marks embedded TP as the Spell-Out Domain of the finite CP phase.',
        [{
          relation: 'TransferDomain',
          anchors: {
            phase: 'cp_embedded_fong_lda',
            edge: 'c_que_fong_lda',
            spellOutDomain: 'tp_embedded_fong_lda'
          }
        }],
        postTransferLdaTree
      ),
      stage(
        'E4b-3',
        'The matrix T probe cannot agree with the embedded subject after transfer.',
        'PostTransferAccess judges the long-distance Agree dependency illicit because os alunos remains inside the transferred embedded TP. IllicitAnalysis marks the complete derivation with the authored star.',
        [
          {
            relation: 'PostTransferAccess',
            anchors: {
              source: 't_probe_fong_lda',
              target: 'dp_students_fong_lda',
              spellOutDomain: 'tp_embedded_fong_lda'
            },
            values: { outcome: 'blocked' }
          },
          {
            relation: 'IllicitAnalysis',
            anchors: { analysis: 'tp_fong_lda' },
            values: { judgment: '*' }
          }
        ],
        postTransferLdaTree
      )
    ],
    lensLabel: 'PIC lens'
  },
  {
    archetype: 'E5. Locality / anti-locality',
    title: 'Anti-Locality (too short)',
    status: "Newman's English middle contrast. Without the low adverbial facilitator, the internal argument's movement from complement of V to Spec,vP is too local. The dashed path retains the source's perpendicular bar and unhappy verdict; the separate V-to-v step is ordinary head movement.",
    sentence: 'The ocean photographs',

    data: antiLocalityShortTree,
    derivationStages: [
      stage(
        'E5-0',
        'The middle predicate is assembled with photographs in V, the ocean as its complement, and an empty v landing.',
        'The complete lexical material is base-generated before either movement applies. No trace or movement relation exists yet.',
        [],
        antiLocalityShortHeadBaseTree
      ),
      stage(
        'E5-1',
        'Photographs raises from V to v while the ocean remains its internal argument.',
        'HeadMove creates the pronounced v occurrence and its silent lower V copy before the object movement is evaluated.',
        [{
          relation: 'HeadMove',
          anchors: {
            source: 'v_photographs_low_anti_short',
            target: 'v_photographs_high_anti_short'
          }
        }],
        antiLocalityShortObjectBaseTree
      ),
      stage(
        'E5-2',
        'The ocean moves directly from complement of V to Spec,vP.',
        'AMove creates the higher subject occurrence and silent lower object occurrence required by the deviant middle input. The anti-locality judgment is not yet applied.',
        [
          {
            relation: 'AMove',
            anchors: {
              lowerCopy: 'dp_ocean_low_anti_short',
              traceWitness: 'n_ocean_low_anti_short',
              pronouncedCopy: 'dp_ocean_high_anti_short'
            }
          }
        ],
        antiLocalityShortTree
      ),
      stage(
        'E5-3',
        'The completed middle movement is too short.',
        'AntiLocality judges the completed DP chain illicit because no facilitating projection intervenes. IllicitAnalysis marks the complete derivation with the authored star.',
        [
          {
            relation: 'AntiLocality',
            anchors: {
              source: 'dp_ocean_low_anti_short',
              traceWitness: 'n_ocean_low_anti_short',
              landing: 'dp_ocean_high_anti_short'
            },
            values: { outcome: 'blocked' }
          },
          {
            relation: 'IllicitAnalysis',
            anchors: { analysis: 'vp_anti_short' },
            values: { judgment: '*' }
          }
        ],
        antiLocalityShortTree
      )
    ],
    lensLabel: 'Anti-locality lens'
  },
  {
    archetype: 'E5b. Locality / anti-locality',
    title: 'Anti-Locality (facilitated)',
    status: "Newman's licensed English middle. The low adverb well supplies the intervening projection that the otherwise comparable DP path needs. The separate V-to-v step remains ordinary head movement; AntiLocality contributes the solid licensed path and happy verdict.",
    sentence: 'The ocean photographs well',

    data: antiLocalityFacilitatorTree,
    derivationStages: [
      stage(
        'E5b-0',
        'The licensed middle predicate is assembled with photographs in V, the ocean as its complement, well as the facilitator, and an empty v landing.',
        'The complete lexical material is base-generated before either movement applies. No trace or movement relation exists yet.',
        [],
        antiLocalityFacilitatorHeadBaseTree
      ),
      stage(
        'E5b-1',
        'Photographs raises from V to v above the low adverb well.',
        'HeadMove creates the pronounced v occurrence and its silent lower V copy while the ocean remains the internal argument below the facilitator.',
        [{
          relation: 'HeadMove',
          anchors: {
            source: 'v_photographs_low_anti_facilitator',
            target: 'v_photographs_high_anti_facilitator'
          }
        }],
        antiLocalityFacilitatorObjectBaseTree
      ),
      stage(
        'E5b-2',
        'The ocean moves across the low adverbial projection to Spec,vP.',
        'AMove creates the higher subject occurrence and silent lower object occurrence required by the licensed middle input.',
        [
          {
            relation: 'AMove',
            anchors: {
              lowerCopy: 'dp_ocean_low_anti_facilitator',
              traceWitness: 'n_ocean_low_anti_facilitator',
              pronouncedCopy: 'dp_ocean_high_anti_facilitator'
            }
          }
        ],
        antiLocalityFacilitatorTree
      ),
      stage(
        'E5b-3',
        'The completed middle movement crosses the facilitating projection.',
        'AntiLocality records the completed DP path as licensed because AdvP intervenes between its source and landing.',
        [
          {
            relation: 'AntiLocality',
            anchors: {
              source: 'dp_ocean_low_anti_facilitator',
              traceWitness: 'n_ocean_low_anti_facilitator',
              landing: 'dp_ocean_high_anti_facilitator',
              facilitator: 'advp_anti_facilitator'
            },
            values: { outcome: 'licensed' }
          }
        ],
        antiLocalityFacilitatorTree
      )
    ],
    lensLabel: 'Anti-locality lens'
  },
  {
    archetype: 'E6. Locality / improper movement',
    title: 'Improper Movement (CP origin)',
    status: "Poole's CP-origin diagram translated onto a complete clausal-topicalization tree. A smuggling-style green region marks the forbidden lower domain, while one shared bottom rail sends straight candidate arrows upward beneath the possible landing phrases. Rejected arrows carry X marks on the region boundary.",
    sentence: 'That Noa left Mia believed',
    wide: true,

    data: improperCpTree,
    derivationStages: [
      stage(
        'E6-0',
        'The clausal complement is merged in the lower object position of believed.',
        'The complete CP That Noa left remains pronounced as the complement of believed. The matrix CP landing and the landing-domain comparison do not yet exist.',
        [],
        movementBaseTreeWithStableLowerIds(
          improperCpTree,
          'cp_clause_high_improper_cp',
          'cp_clause_low_improper_cp',
          ['cp_improper_cp_root']
        )
      ),
      stage(
        'E6-1',
        'The CP moves to the matrix CP edge.',
        'AbarMove creates the completed CP chain while preserving every previously built matrix and embedded constituent.',
        [
          {
            relation: 'AbarMove',
            anchors: {
              lowerCopy: 'cp_clause_low_improper_cp',
              traceWitness: 'c_that_low_improper_cp',
              pronouncedCopy: 'cp_clause_high_improper_cp'
            }
          }
        ],
        improperCpTree
      ),
      stage(
        'E6-2',
        'The completed CP chain is compared with the source landing hierarchy.',
        'ImproperMovement names the lower TP, vP, and VP landing hosts rejected by the source hierarchy. It judges the existing chain without rebuilding syntax.',
        [
          {
            relation: 'ImproperMovement',
            anchors: {
              source: 'cp_clause_low_improper_cp',
              traceWitness: 'c_that_low_improper_cp',
              licensedLanding: 'cp_clause_high_improper_cp',
              rejectedLandingHosts: [
                'tp_improper_cp_matrix',
                'vp_improper_cp_matrix',
                'vp_improper_cp_complement'
              ],
              forbiddenRegion: [
                'tp_improper_cp_matrix',
                'vp_improper_cp_matrix',
                'vp_improper_cp_complement'
              ]
            }
          }
        ],
        improperCpTree
      )
    ],
    lensLabel: 'Landing-domain lens'
  },
  {
    archetype: 'E6b. Locality / improper movement',
    title: 'Improper Movement (TP origin)',
    status: "The source's TP-origin comparison changes the lower edge of the ban. A TP may land at TP or CP, while the smuggling-style region contains only the vP and VP candidates. Every candidate rises from one continuous bottom rail and targets the centre beneath its authored landing phrase.",
    sentence: 'To leave Noa tried',
    wide: true,

    data: improperTpTree,
    derivationStages: [
      stage(
        'E6b-0',
        'The infinitival TP is merged in the lower complement position of tried.',
        'The complete TP To leave remains pronounced in its lower position. The matrix CP landing and the landing-domain comparison do not yet exist.',
        [],
        movementBaseTree(improperTpTree, 'tp_clause_high_improper_tp', 'tp_clause_low_improper_tp', ['cp_improper_tp_root'])
      ),
      stage(
        'E6b-1',
        'The infinitival TP moves to the matrix CP edge.',
        'AbarMove draws the licensed high chain. ImproperMovement allows the authored TP alternative and rejects only the lower vP and VP hosts.',
        [
          {
            relation: 'AbarMove',
            anchors: {
              lowerCopy: 'tp_clause_low_improper_tp',
              traceWitness: 't_to_low_improper_tp',
              pronouncedCopy: 'tp_clause_high_improper_tp'
            }
          },
          {
            relation: 'ImproperMovement',
            anchors: {
              source: 'tp_clause_low_improper_tp',
              traceWitness: 't_to_low_improper_tp',
              licensedLanding: 'tp_clause_high_improper_tp',
              licensedLandingHosts: ['tp_improper_tp_matrix'],
              rejectedLandingHosts: [
                'vp_improper_tp_matrix',
                'vp_improper_tp_complement'
              ],
              forbiddenRegion: [
                'vp_improper_tp_matrix',
                'vp_improper_tp_complement'
              ]
            }
          }
        ],
        improperTpTree
      )
    ],
    lensLabel: 'Landing-domain lens'
  },
  {
    archetype: 'E7. Judgment / illicit analysis',
    title: 'Illicit Analysis',
    status: 'IllicitAnalysis contributes one analysis verdict: an authored judgment glyph plus an optional authored label. It adds no path, domain, or tree transition.',
    sentence: 'The girls arrives',
    data: illicitAnalysisTree,
    derivationStages: [
      {
        statement: 'The plural subject DP and singular finite predicate are built as separate workspace objects.',
        stageRecord: 'The girls is morphologically plural. Arrives realizes third-person singular present agreement. The two objects have not yet formed one clause, so no analysis verdict is authored.',
        relations: [],
        workspaceForest: [illicitAnalysisSubject, illicitAnalysisPredicate]
      },
      stage(
        'E7-2',
        'External Merge assembles the deviant input as one complete TP.',
        'The completed TP pairs the plural subject the girls with singular [3SG, pres] and arrives. The mismatch is now structurally available, but it has not yet been judged.',
        [],
        illicitAnalysisTree
      ),
      stage(
        'E7-3',
        'The completed analysis receives an illicit agreement verdict.',
        'IllicitAnalysis anchors the verdict to the complete TP. Its authored values record the star, the open label agreement, the illicit outcome, and why the plural subject is incompatible with singular arrives.',
        [{
          relation: 'IllicitAnalysis',
          anchors: { analysis: 'tp_illicit_analysis' },
          values: {
            judgment: '*',
            label: 'agreement',
            outcome: 'illicit',
            reason: 'Plural the girls requires plural present agreement, but arrives is third-person singular.'
          }
        }],
        illicitAnalysisTree
      )
    ],
    lensLabel: 'Illicit-analysis lens'
  },
  {
    archetype: 'F. Silence / ellipsis / deletion',
    title: 'Ellipsis / Silent Structure',
    status: 'Ellipsis ghosts an authored unpronounced domain. It adds no correspondence path and no deletion strike.',
    sentence: 'Lena read the book and Noa did too',
    data: ellipsisTree,
    derivationStages: [
      stage(
        'F-0',
        'Both conjuncts are assembled with a pronounced VP.',
        'The second conjunct contains the complete pronounced predicate before ellipsis applies.',
        [],
        revealPronouncedDomain(ellipsisTree, 'vp_silent_site')
      ),
      stage(
        'F-1',
        'The second conjunct contains an unpronounced VP recoverable from the first conjunct.',
        'Ellipsis ghosts the complete authored VP at the silent site. It draws no strike and no antecedent-to-site connector.',
        [{ relation: 'Ellipsis', anchors: { domain: 'vp_silent_site' } }],
        ellipsisTree
      )
    ],
    lensLabel: 'Ellipsis lens'
  },
  {
    archetype: 'F2. Silence / ellipsis / deletion',
    title: 'Ellipsis / Sluicing',
    status: 'Sluicing is presented as a composition, not a primitive: optional wh-movement and ellipsis ghosting are authored as separate claims.',
    sentence: 'Mia left but Noa knows why',
    data: sluicingTree,
    derivationStages: [
      stage(
        'F2-0',
        'The antecedent and embedded C-prime are built as separate workspace objects.',
        'The embedded clause contains pronounced why in its lower adverbial position. The selecting matrix predicate and coordination have not been built.',
        [],
        [
          sluicingAntecedentTree,
          revealPronouncedDomain(sluicingEmbeddedBaseTree, 'tp_sluice_site')
        ]
      ),
      stage(
        'F2-1',
        'Why moves to the embedded CP edge.',
        'AbarMove establishes the optional wh-chain while the TP remains pronounced. Sluicing itself does not supply this movement.',
        [
          {
            relation: 'AbarMove',
            anchors: {
              lowerCopy: 'why_sluice_low',
              traceWitness: 'why_sluice_low_adv',
              pronouncedCopy: 'why_sluice'
            }
          }
        ],
        [
          sluicingAntecedentTree,
          revealPronouncedDomain(sluicingEmbeddedTree, 'tp_sluice_site')
        ]
      ),
      stage(
        'F2-2',
        'The TP becomes an ellipsis site.',
        'Ellipsis ghosts the complete silent TP. It adds neither a deletion strike nor a recoverability connector.',
        [{ relation: 'Ellipsis', anchors: { domain: 'tp_sluice_site' } }],
        [sluicingAntecedentTree, sluicingEmbeddedTree]
      ),
      stage(
        'F2-3',
        'The completed sluice CP is selected by knows and coordinated with the antecedent.',
        'Only after movement and ghosting are complete does External Merge build the upper Noa knows spine and final coordination.',
        [],
        sluicingTree
      )
    ],
    lensLabel: 'Sluicing lens'
  },
  {
    archetype: 'F4. Silence / remnant escape',
    title: 'Remnant Escape / Pseudogapping',
    status: "Archived composition fixture. Jane first moves as an ordinary phrase out of VP; ordinary Ellipsis later ghosts the complete authored-silent VP while the landed remnant and its movement path persist.",
    sentence: 'Mary will Jane',

    data: pseudogappingTree,
    derivationStages: [
      stage(
        'F4-1',
        'The object remnant moves out of VP to the higher object position.',
        'AMove relates the lower object position to pronounced Jane. The complete VP is still present and pronounced in this movement frame.',
        [{
          relation: 'AMove',
          anchors: {
            lowerCopy: 'dp_jane_low_pseudogapping',
            traceWitness: 'n_jane_low_pseudogapping',
            pronouncedCopy: 'dp_jane_high_pseudogapping'
          }
        }],
        pseudogappingMovementTree
      ),
      stage(
        'F4-2',
        'PF deletes the pronunciation of VP after the object remnant has escaped.',
        'Ellipsis ghosts the complete authored-silent VP domain. Jane remains pronounced outside it, and the earlier movement persists.',
        [{
          relation: 'Ellipsis',
          anchors: { domain: 'vp_pseudogapping' }
        }],
        pseudogappingTree
      )
    ],
    lensLabel: 'Remnant-escape lens'
  },
  {
    archetype: 'F4b. Silence / remnant escape',
    title: 'Remnant Escape / Gapping',
    status: "Gengel's gapping tree supplies the second remnant-escape context. Heather and a magazine escape as separate phrases before the complete TP is deleted. Their two ordinary phrasal trajectories remain visible in the final frame; gapping adds no special movement arrow.",
    sentence: 'Heather a magazine',
    wide: true,

    data: gappingDeletionTree,
    derivationStages: [
      stage(
        'F4b-1',
        'The gapping clause begins with its subject, verb, and object inside TP.',
        'The baseline contains Heather, read, and a magazine. Neither remnant has escaped and no deletion has applied.',
        [],
        gappingEscapeBaseTree
      ),
      stage(
        'F4b-2',
        'The contrastive object remnant moves to Spec,FocP.',
        'AbarMove relates the lower object copy to pronounced a magazine. Its two terminal traces remain inside the lower DP.',
        [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_magazine_low_gapping_escape',
            traceWitness: 'd_a_low_gapping_escape',
            pronouncedCopy: 'dp_magazine_high_gapping_escape'
          }
        }],
        gappingObjectEscapeTree
      ),
      stage(
        'F4b-3',
        'The contrastive subject remnant moves to Spec,TopP.',
        'AbarMove relates the lower subject copy to pronounced Heather. Both remnant trajectories are now present.',
        [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_heather_low_gapping_escape',
            traceWitness: 'n_heather_low_gapping_escape',
            pronouncedCopy: 'dp_heather_high_gapping_escape'
          }
        }],
        gappingBothEscapeTree
      ),
      stage(
        'F4b-4',
        'PF deletes the complete TP after both remnants have escaped.',
        'Ellipsis names TP as the silent domain. Heather and a magazine remain pronounced above it, and both earlier movement paths persist.',
        [{
          relation: 'Ellipsis',
          anchors: { domain: 'tp_gapping_escape' }
        }],
        gappingDeletionTree
      )
    ],
    lensLabel: 'Remnant-escape lens'
  },
  {
    archetype: 'F5. Silence / partial copy deletion',
    title: 'Partial Copy Deletion',
    status: "Meadows and Yan's two source figures translated as one ordered Babel derivation. The full VP moves first and both occurrences receive the source's boxes; a later PF frame strikes only the lower VP's DP. The lower V remains pronounced, so the strike is not a trace and not whole-copy deletion.",
    sentence: 'Kan xiaoshuo ta kan de hen kuai',
    wide: true,

    data: partialCopyDeletionTree,
    derivationStages: [
      stage(
        'F5-1',
        'The VP is base-generated in its lower position.',
        'The base frame contains one complete VP. No movement, enclosure, or deletion relation is active yet.',
        [],
        partialCopyBaseTree
      ),
      stage(
        'F5-2',
        'The complete VP moves to the left edge, creating higher and lower occurrences.',
        'AbarMove creates the VP trajectory. CopyOccurrence separately encloses the two VP shells exactly where Figure 17 identifies them.',
        [
          {
            relation: 'AbarMove',
            anchors: {
              lowerCopy: 'vp_low_partial_copy',
              traceWitness: 'v_kan_low_partial_copy',
              pronouncedCopy: 'vp_high_partial_copy'
            }
          },
          {
            relation: 'CopyOccurrence',
            anchors: { occurrences: ['vp_high_partial_copy', 'vp_low_partial_copy'] }
          }
        ],
        partialCopyMovementTree
      ),
      stage(
        'F5-3',
        'PF deletes only the DP inside the lower VP copy.',
        'PartialCopyDeletion strikes only the lower DP category and its subtree. The lower V remains pronounced; movement and copy enclosures persist because their own earlier relations persist.',
        [{
          relation: 'PartialCopyDeletion',
          anchors: {
            deletedSubconstituent: 'dp_xiaoshuo_low_partial_copy'
          }
        }],
        partialCopyDeletionTree
      )
    ],
    lensLabel: 'Partial-deletion lens'
  },
  {
    archetype: 'F5b. Silence / partial copy deletion',
    title: 'Partial Copy Deletion (Resumptive D)',
    status: "Yip and Ahenkorah's Cantonese derivation supplies a genuinely different second context. The complete object DP moves first; PF then deletes only NP in the lower copy, leaving D to receive the default exponent keoi. The movement path, lower-copy enclosure, selective strike, and final realization all follow those separate authored stages.",
    sentence: 'Nei jiu zoeng di syu tai-saai keoi',
    wide: true,

    data: resumptivePartialCopyRealizationTree,
    derivationStages: [
      stage(
        'F5b-1',
        'The lower verb phrase is built around the base-generated object DP.',
        'The derivation begins with one complete di syu DP as the complement of tai-saai and completes v-prime before any upper material is selected.',
        [],
        resumptivePartialCopyLowerTree
      ),
      stage(
        'F5b-2',
        'The complete object DP moves above the verb phrase.',
        'AbarMove relates the lower object copy to pronounced di syu. CopyOccurrence records the two DP shells while the lower copy is still complete.',
        [
          {
            relation: 'AbarMove',
            anchors: {
              lowerCopy: 'dp_book_low_resumptive_partial_copy',
              traceWitness: 'd_di_low_resumptive_partial_copy',
              pronouncedCopy: 'dp_book_high_resumptive_partial_copy'
            }
          },
          {
            relation: 'CopyOccurrence',
            anchors: {
              occurrences: [
                'dp_book_high_resumptive_partial_copy',
                'dp_book_low_resumptive_partial_copy'
              ]
            }
          }
        ],
        resumptivePartialCopyVpMovementTree
      ),
      stage(
        'F5b-3',
        'The completed vP is embedded under the upper functional spine.',
        'Disp, T, and the subject are selected only after object movement has completed the lower vP.',
        [],
        resumptivePartialCopyMovementTree
      ),
      stage(
        'F5b-4',
        'PF deletes NP inside the lower DP copy but retains D.',
        'PartialCopyDeletion strikes only NP. The existing CopyOccurrence enclosure persists, while the visible [D] remains an abstract surviving D head awaiting its own realization relation.',
        [{
          relation: 'PartialCopyDeletion',
          anchors: {
            deletedSubconstituent: 'np_book_low_resumptive_partial_copy'
          }
        }],
        resumptivePartialCopyDeletionTree
      ),
      stage(
        'F5b-5',
        'The surviving lower D is realized as keoi.',
        'VocabularyInsertion maps the retained D head to the default pronoun keoi. The lower NP remains deleted, and the earlier object-movement path persists.',
        [{
          relation: 'VocabularyInsertion',
          anchors: { terminal: 'd_di_low_resumptive_partial_copy' },
          values: { input: '[D]', output: 'keoi' }
        }],
        resumptivePartialCopyRealizationTree
      )
    ],
    lensLabel: 'Partial-deletion lens'
  },
  {
    archetype: 'G. Sharing / multidominance',
    title: 'Multidominance / Sharing',
    status: 'This lab pass draws multidominance as one shared DP with two intentional mother branches: a DAG affordance, not movement and not copy identity.',
    sentence: 'Sam caught and Alex cooked a fish',
    data: sharingTree,
    derivationStages: [
      stage(
        'G-0',
        'The coordination is assembled with the object dominated by its first predicate.',
        'Both predicate domains and the single overt object are present before the second mother relation is introduced.',
        [],
        sharingTree
      ),
      stage(
        'G',
        'The object is analyzed as shared by both conjuncts.',
        'Multidominance relates both VP mothers to one shared DP object.',
        [{ relation: 'Multidominance', anchors: { parents: ['vp_shared_left', 'vp_shared_right'], shared: 'book_shared' } }],
        sharingTree
      )
    ],
    lensLabel: 'Sharing lens'
  },
  {
    archetype: 'G2. Sharing / multidominance',
    title: 'Multidominance / Shared Subject',
    status: 'One DP is the specifier of both coordinated vPs. The ordinary tree gives it one mother; the Multidominance relation supplies exactly the second vP mother.',
    sentence: 'Noa sang and danced',
    data: sharedSubjectTree,
    derivationStages: [
      stage(
        'G2-0',
        'The coordinated predicates are assembled with Noa dominated by the first vP.',
        'Both vP domains and the single overt subject are present before the second mother relation is introduced.',
        [],
        sharedSubjectTree
      ),
      stage(
        'G2',
        'The subject is shared by both coordinated predicates.',
        'Multidominance relates both vP parents to one shared DP subject. One vP already dominates the DP; the relation adds only the second mother.',
        [{
          relation: 'Multidominance',
          anchors: { parents: ['vp_sang_md2', 'vp_danced_md2'], shared: 'dp_noa_md2' }
        }],
        sharedSubjectTree
      )
    ],
    lensLabel: 'Sharing lens'
  },
  {
    archetype: 'G3. Sharing / argument sharing',
    title: 'Argument Sharing / Serial Predicates',
    status: 'The source convention is transferred as two tilted, overlapping predicate-domain ovals plus one standalone OBJ box at their overlap beside the existing shared object. The overlay adds no mother branch, copy, or syntax node.',
    sentence: 'Wo da fufu du',
    data: argumentSharingTree,
    derivationStages: [
      stage(
        'G3-0',
        'The serial predicate structure is assembled with one overt object.',
        'Both predicate domains and fufu are structurally present before their argument-sharing interpretation is recorded.',
        [],
        argumentSharingTree
      ),
      stage(
        'G3',
        'The two serial predicates share the one overt object fufu.',
        'ArgumentSharing names both predicate domains and the single authored object. Babel draws only the two domain ovals and the OBJ box used by the source figure.',
        [{
          relation: 'ArgumentSharing',
          anchors: {
            domains: ['vp_left_argument_sharing', 'vp_right_argument_sharing'],
            shared: 'dp_fufu_argument_sharing'
          },
          values: { role: 'OBJ' }
        }],
        argumentSharingTree
      )
    ],
    lensLabel: 'Argument-sharing lens'
  },
  {
    archetype: 'G3B. Sharing / argument sharing',
    title: 'Argument Sharing / Resultative Serial Predicates',
    status: 'The same source-backed ovals and OBJ box are applied to a resultative SVC. The single overt object sits between the two predicates, producing a different overlap geometry without adding syntax.',
    sentence: 'N daa la Dakoraa loo',
    data: resultativeArgumentSharingTree,
    derivationStages: [
      stage(
        'G3B-0',
        'The resultative serial predicate structure is assembled with one overt argument.',
        'Both resultative predicate domains and Dakoraa are structurally present before their argument-sharing interpretation is recorded.',
        [],
        resultativeArgumentSharingTree
      ),
      stage(
        'G3B',
        'The pushing and result predicates share the one overt argument Dakoraa.',
        'ArgumentSharing names both resultative predicate domains and the single authored object. Babel reuses the two domain ovals and OBJ box from the source figure.',
        [{
          relation: 'ArgumentSharing',
          anchors: {
            domains: [
              'vp_left_argument_sharing_resultative',
              'vp_right_argument_sharing_resultative'
            ],
            shared: 'dp_dakoraa_argument_sharing_resultative'
          },
          values: { role: 'OBJ' }
        }],
        resultativeArgumentSharingTree
      )
    ],
    lensLabel: 'Argument-sharing lens'
  },
  {
    archetype: 'H. PF / morphology',
    title: 'PF Realization',
    status: 'This lab pass only draws PF when the model explicitly authors the relation: a compact equation plate mapping abstract syntactic material to the pronounced surface token.',
    sentence: 'Mia laughed',
    data: pfRealizedTree,
    derivationStages: [
      stage(
        'H1',
        'The derivation starts with an abstract root and a past-tense feature.',
        'The endocentric verbal spine is already present: vP contains v, and v contains √LAUGH; T contains [past].',
        [],
        pfAbstractTree
      ),
      stage(
        'H2',
        'PF realizes the root and tense package as the pronounced token laughed.',
        'PFRealization maps the current root witness to laugh while the vP spine remains in place. The following Vocabulary Insertion steps add tense and then the combined pronounced exponent.',
        [
          {
            relation: 'PFRealization',
            anchors: { root: 'root_laugh', verbalHead: 'v_pf', tense: 't_past', feature: 'past_pf', exponent: 'root_laugh' },
            values: { input: '√LAUGH', output: 'laugh' }
          },
          {
            relation: 'VocabularyInsertion',
            anchors: { terminal: 'past_pf' },
            values: { input: 'T[past]', output: '-ed' }
          },
          {
            relation: 'VocabularyInsertion',
            anchors: { terminal: 'root_laugh' },
            values: { input: 'laugh + -ed', output: 'laughed' }
          }
        ],
        pfRealizedTree
      )
    ],
    lensLabel: 'PF lens'
  },
  {
    archetype: 'H2. PF / morphology',
    title: 'PF Realization (suppletion)',
    status: 'Suppletion is contextual allomorphy: the root is realized as went in the context of past T, and that T receives no independent exponent.',
    sentence: 'Mia went',
    data: suppletionRealizedTree,
    derivationStages: [
      stage(
        'H2a',
        'The derivation starts with an abstract root and a past-tense feature.',
        'The verbal spine is present: vP contains v, v contains √GO, and T contains [past].',
        [],
        suppletionAbstractTree
      ),
      stage(
        'H2b',
        'PF realizes the root as went in the past-tense context and gives T no separate exponent.',
        'PFRealization selects the contextual allomorph went for √GO before T[past]. VocabularyInsertion then realizes T[past] as zero.',
        [
          {
            relation: 'PFRealization',
            anchors: {
              root: 'root_go_pf2',
              verbalHead: 'v_pf2',
              tense: 't_past_pf2',
              feature: 'past_pf2',
              exponent: 'root_go_pf2'
            },
            values: { input: '√GO', context: '__ T[past]', output: 'went' }
          },
          {
            relation: 'VocabularyInsertion',
            anchors: { terminal: 'past_pf2' },
            values: { input: 'T[past]', output: '∅' }
          }
        ],
        suppletionRealizedTree
      )
    ],
    lensLabel: 'PF lens'
  },
  {
    archetype: 'H2B. PF / morphology / phrasal spell-out',
    title: 'Phrasal Spell-Out',
    status: "Caha and Pantcheva's source convention generalized for Babel: one exponent may realize any connected phrase-sized syntactic span, while nested or neighboring spell-outs remain separately authorable. The complete surface token is Mirának; the compact -nak label identifies the exponent associated with DatP.",
    sentence: 'Mirának',
    data: phrasalSpellOutRealizedTree,
    derivationStages: [
      stage(
        'H2B-0',
        'The complete DatP is assembled before lexical insertion.',
        'DatP contains its full PP and NP structure with an abstract nominal root while no surface token or phrasal exponent is present.',
        [],
        phrasalSpellOutAbstractTree
      ),
      stage(
        'H2B',
        'The connected DatP subtree is realized in the surface token Mirának by the dative exponent -nak.',
        'PhrasalSpellOut associates -nak with the complete DatP span while the stable nominal terminal begins pronouncing the exact input token Mirának.',
        [{
          relation: 'PhrasalSpellOut',
          anchors: { phrase: 'datp_phrasal_spellout' },
          values: { exponent: '-nak' }
        }],
        phrasalSpellOutRealizedTree
      )
    ],
    lensLabel: 'Phrasal-spell-out lens'
  },
  {
    archetype: 'H2C. PF / morphology / correspondence',
    title: 'Many-to-Many PF Correspondence',
    status: "Yang's lexical-representation box transferred as a compact external PF plate. The authored word tree remains complete; only the explicitly authored root/feature-to-exponent correspondences appear in the plate.",
    sentence: 'Ktab-u-h',
    data: manyToManyPfTree,
    wide: true,
    derivationStages: [
      stage(
        'H2C',
        'The root and agreement features correspond to three surface exponents.',
        'ManyToManyCorrespondence anchors one lexical-representation plate to the complete WordP and draws only the authored feature-exponent pairs.',
        [{
          relation: 'ManyToManyCorrespondence',
          anchors: { word: 'wordp_many_to_many_pf' },
          // Sources and exponents pair item by item; a repeated literal
          // expresses a many-to-many correspondence.
          values: {
            sources: ['√BOOK', '3', 'M', 'M', 'SG'],
            exponents: ['/ktab/', '/-u/', '/-u/', '/-h/', '/-h/']
          }
        }],
        manyToManyPfTree
      )
    ],
    lensLabel: 'PF-correspondence lens'
  },
  {
    archetype: 'H3. PF / morphology / fission',
    title: 'Fission',
    status: 'After Breit\'s source figure: one Basque pronominal-clitic feature bundle splits into two output bundles. Shared Case and participant features are copied to both; −author and +plural are separated before Vocabulary Insertion supplies -su and -e.',
    sentence: 'Basque 2PL auxiliary clitic: -su-e',
    data: fissionOutputTree,
    wide: true,
    derivationStages: [
      stage(
        'H3a',
        'The second-person plural clitic is one terminal before Fission.',
        'The input terminal contains the co-occurring −author and +plural features together with their shared Case and participant features.',
        [],
        fissionInputTree
      ),
      stage(
        'H3b',
        'Fission splits that terminal into person and plural outputs.',
        'Fission maps one prior clitic terminal to two current terminals. The source-backed plate copies shared features to both outputs and separates −author from +plural.',
        [{
          relation: 'Fission',
          anchors: {
            outputs: [
              'clitic_person_fission_output',
              'clitic_plural_fission_output'
            ]
          },
          priorAnchors: { input: 'clitic_fission_input' },
          // One feature bundle per output, paired with the outputs by name.
          values: {
            inputFeatures: ['Case: α', 'βparticipant', '−author', '+plural'],
            outputs: ['Case: α, βparticipant, −author', 'Case: α, βparticipant, +plural']
          }
        }],
        fissionOutputTree
      )
    ]
  },
  {
    archetype: 'H4. PF / morphology / impoverishment',
    title: 'Impoverishment',
    status: 'The tree stays ordinary. Beside the pronoun, Babel copies Harley and Noyer\'s feature geometry: 2 dominates plural, plural dominates feminine, and crossing the 2–plural link delinks plural together with dependent feminine.',
    sentence: 'You arrive',
    data: impoverishmentTree,
    derivationStages: [
      stage(
        'H4-0',
        'The second-person feature geometry is available before impoverishment.',
        'The terminal retains person, plural, and feminine features in the authored hierarchy before any dependency is delinked.',
        [],
        impoverishmentTree
      ),
      stage(
        'H4',
        'Impoverishment delinks plural and everything dependent on it.',
        'Impoverishment targets the link immediately below second person. Babel crosses that link and shows second person as the surviving output.',
        [{
          relation: 'Impoverishment',
          anchors: { terminal: 'd_you_impoverishment' },
          values: {
            featureHierarchy: ['2', 'pl', 'f'],
            delinkAfter: '2'
          }
        }],
        impoverishmentTree
      )
    ]
  },
  {
    archetype: 'H5. PF / morphology / local dislocation',
    title: 'Local Dislocation / String-Vacuous Rebracketing',
    status: 'Gong derives Dagur tery-eer-maan by moving Root into n, lowering K onto Poss, realizing the resulting heads, and then rebracketing adjacent PF pieces without changing their order.',
    sentence: 'Tery-eer-maan',
    data: localDislocationTree,
    wide: true,
    derivationStages: [
      stage(
        'H5a',
        'The derived PF input contains Root-n and K-Poss complex heads.',
        'The card begins from Gong\'s derived structure: Root is inside n, K is inside Poss, and their original positions are silent. Those earlier displacements are not Local Dislocation.',
        [],
        localDislocationInputTree
      ),
      stage(
        'H5b',
        'Local Dislocation rebrackets the PF pieces without changing their order.',
        'The three outputs are tery, -eer, and -maan. LocalDislocation changes [tery] [-eer -maan] into [tery -eer] [-maan]; it does not rebuild or move the syntax tree.',
        [{
          relation: 'LocalDislocation',
          anchors: {
            sequence: [
              'root_landed_local_dislocation',
              'k_landed_local_dislocation',
              'poss_host_local_dislocation'
            ]
          },
          values: {
            beforeGroupSizes: ['1', '2'],
            afterGroupSizes: ['2', '1']
          }
        }],
        localDislocationTree
      )
    ]
  },
  {
    archetype: 'H6. PF / cyclic linearization',
    title: 'Cyclic Linearization / Edge Movement',
    status: 'Successive-cyclic wh-movement first reaches the embedded CP edge, then the matrix edge. The ordinary phrasal paths persist; the new source-backed plate records compatible prior and current precedence orders.',
    sentence: 'Which book, Mia said that Noa read',
    data: cyclicLicensedTree,
    wide: true,

    derivationStages: [
      stage(
        'H6a',
        'Which book moves from object position to the embedded CP edge.',
        'AbarMove establishes the lower movement segment. At this Spell-Out domain, which book is at the left edge.',
        [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_which_book_cyclic_licensed_base',
            traceWitness: 'd_which_cyclic_licensed_base',
            pronouncedCopy: 'dp_which_book_cyclic_licensed_edge'
          }
        }],
        cyclicLicensedPriorTree
      ),
      stage(
        'H6b',
        'Which book moves from the embedded edge to the matrix edge.',
        'AbarMove completes the final movement segment from the embedded edge to matrix Spec,CP. The ordering comparison has not been drawn yet.',
        [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_which_book_cyclic_licensed_edge',
            traceWitness: 'd_which_cyclic_licensed_edge',
            pronouncedCopy: 'dp_which_book_cyclic_licensed_high'
          }
        }],
        cyclicLicensedTree
      ),
      stage(
        'H6c',
        'The prior and current precedence orders are compared.',
        'CyclicLinearization adds the ordering ledger after the final movement path is complete. The prior and current precedence statements remain compatible.',
        [{
          relation: 'CyclicLinearization',
          anchors: {
            edgePosition: 'dp_which_book_cyclic_licensed_edge',
            order: [
              'dp_which_book_cyclic_licensed_high',
              'dp_mia_cyclic_licensed',
              'v_say_cyclic_licensed',
              'c_that_cyclic_licensed',
              'dp_noa_cyclic_licensed',
              'v_read_cyclic_licensed'
            ]
          },
          priorAnchors: {
            order: [
              'dp_which_book_cyclic_licensed_edge',
              'c_that_cyclic_licensed',
              'dp_noa_cyclic_licensed',
              'v_read_cyclic_licensed'
            ]
          },
          values: { outcome: 'licensed' }
        }],
        cyclicLicensedTree
      )
    ]
  },
  {
    archetype: 'H6B. PF / cyclic linearization',
    title: 'Cyclic Linearization / Order Conflict',
    status: 'The same wh-DP moves directly from the non-edge object position. Its ordinary movement path is visible, while the ordering ledger carries the source\'s failure asterisk because the old and new precedence statements form a contradiction.',
    sentence: 'Which book, Mia said that Noa read',
    data: cyclicConflictTree,
    wide: true,
    derivationStages: [
      stage(
        'H6c',
        'Which book remains in its embedded object position at the first Spell-Out domain.',
        'The embedded order places that, Noa, and read before which book; the wh-DP has not reached the embedded CP edge.',
        [],
        cyclicConflictPriorTree
      ),
      stage(
        'H6d',
        'Which book moves directly from the non-edge position to the matrix edge.',
        'AbarMove completes the direct movement from the embedded object position to matrix Spec,CP. The ordering conflict has not been drawn yet.',
        [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_which_book_cyclic_conflict_base',
            traceWitness: 'd_which_cyclic_conflict_base',
            pronouncedCopy: 'dp_which_book_cyclic_conflict_high'
          }
        }],
        cyclicConflictTree
      ),
      stage(
        'H6e',
        'The preserved and current precedence orders are compared.',
        'CyclicLinearization adds the ordering ledger after movement. The preserved and current orders require the wh-DP to both precede and follow read, so the source marks the result with an asterisk.',
        [{
          relation: 'CyclicLinearization',
          anchors: {
            conflictWitness: 'dp_which_book_cyclic_conflict_base',
            order: [
              'dp_which_book_cyclic_conflict_high',
              'dp_mia_cyclic_conflict',
              'v_say_cyclic_conflict',
              'c_that_cyclic_conflict',
              'dp_noa_cyclic_conflict',
              'v_read_cyclic_conflict'
            ]
          },
          priorAnchors: {
            order: [
              'c_that_cyclic_conflict',
              'dp_noa_cyclic_conflict',
              'v_read_cyclic_conflict',
              'dp_which_book_cyclic_conflict_base'
            ]
          },
          values: { outcome: 'conflict' }
        }],
        cyclicConflictTree
      )
    ]
  },
  {
    archetype: 'I1. Scope / LF / QR',
    title: 'QR / Covert Scope',
    sentence: 'Sue read every book',
    status: 'QR is a covert LF relation: the pronounced QP remains in object position, while the LF layer shows the higher scope position with a dashed covert path.',
    data: qrScopeTree,
    derivationStages: [
      stage(
        'I1-0',
        'The surface clause is assembled with every book in object position.',
        'The object QP remains pronounced inside VP. No higher LF occurrence or covert scope path exists yet.',
        [],
        withoutLandingTree(qrScopeTree, 'qp_every_book_high_lf', ['tp_qr_lf'])
      ),
      stage(
        'I1',
        'Every book takes scope over the interpreted TP at LF.',
        'QuantifierRaising relates the lower pronounced QP to a higher LF scope position; the path is covert and dashed, not ordinary overt movement.',
        [{ relation: 'QuantifierRaising', anchors: { pronouncedQP: 'qp_every_book_low_lf', lfQP: 'qp_every_book_high_lf', scopeDomain: 'tp_qr_surface_lf' } }],
        qrScopeTree
      )
    ],
    lensLabel: 'LF QR lens'
  },
  {
    archetype: 'I1a. Scope / LF / inverse scope',
    title: 'QR / Inverse Scope',
    status: 'Two quantifiers rather than one. The object quantifier raises over an indefinite subject to give the inverse reading, so the covert path spans a scope relation between two operators instead of one quantifier and a predicate.',
    sentence: 'Someone read every book',
    data: inverseScopeTree,
    derivationStages: [
      stage(
        'I1a-0',
        'The surface clause is assembled with the indefinite subject above the object quantifier.',
        'Every book remains pronounced in object position. No higher LF occurrence or inverse-scope path exists yet.',
        [],
        withoutLandingTree(inverseScopeTree, 'qp_every_high_qr2', ['tp_qr2_top'])
      ),
      stage(
        'I1a',
        'Every book takes scope over the indefinite subject at LF.',
        'QuantifierRaising relates the pronounced object QP to a higher LF scope position above the subject. The higher occurrence is non-surfacing and the path is covert.',
        [{
          relation: 'QuantifierRaising',
          anchors: {
            pronouncedQP: 'qp_every_low_qr2',
            lfQP: 'qp_every_high_qr2',
            scopeDomain: 'tp_qr2_surface'
          }
        }],
        inverseScopeTree
      )
    ]
  },
  {
    archetype: 'I1d. Scope / LF / clause-bounded scope',
    title: 'QR / Clause-Bounded Scope',
    status: 'The quantifier scopes inside its own embedded clause rather than at the matrix level, so both the raised occurrence and the scope domain sit deep in the tree. The covert path is short and local instead of spanning the root clause.',
    sentence: 'Mia said everyone left',
    data: embeddedScopeTree,
    derivationStages: [
      stage(
        'I1d-0',
        'The embedded surface clause is assembled with everyone in its lower position.',
        'The embedded QP remains pronounced inside its clause. No adjoined LF occurrence or covert scope path exists yet.',
        [],
        withoutLandingTree(embeddedScopeTree, 'qp_everyone_high_qr3', ['tp_qr3_emb_top'])
      ),
      stage(
        'I1d',
        'Everyone takes scope inside the embedded clause at LF.',
        'QuantifierRaising relates the pronounced embedded QP to a higher occurrence adjoined within the same embedded clause. The scope domain is the embedded TP, not the matrix one.',
        [{
          relation: 'QuantifierRaising',
          anchors: {
            pronouncedQP: 'qp_everyone_low_qr3',
            lfQP: 'qp_everyone_high_qr3',
            scopeDomain: 'tp_qr3_emb_surface'
          }
        }],
        embeddedScopeTree
      )
    ]
  },
  {
    archetype: 'I6. Scope / LF / Cooper storage',
    title: 'Cooper Storage',
    status: 'Quantifiers remain in their authored surface positions. Replay updates compact qstore/retrieved plaques as the object and then the subject are retrieved, following the source figure rather than drawing covert movement.',
    sentence: 'Someone saw everyone',
    data: cooperStorageTree,
    derivationStages: [
      stage(
        'I6a',
        'Both quantifiers enter storage while the surface tree stays unchanged.',
        'CooperStorage records everyone in the VP store and both quantifiers in the sentence store. Nothing moves in the syntax tree.',
        [
          {
            relation: 'CooperStorage',
            anchors: { scope: 'vp_cooper_storage', quantifier: 'np_everyone_cooper_storage' },
            values: { category: 'VP', qstore: ['everyone'] }
          },
          {
            relation: 'CooperStorage',
            anchors: {
              scope: 's_cooper_storage',
              quantifiers: ['np_everyone_cooper_storage', 'np_someone_cooper_storage']
            },
            values: { category: 'S', qstore: ['everyone', 'someone'] }
          }
        ],
        cooperStorageTree
      ),
      stage(
        'I6b',
        'Everyone is retrieved while someone remains in storage.',
        'The sentence plaque now records qstore [someone] and retrieved [everyone]. The authored tree is still unchanged.',
        [{
          relation: 'CooperStorage',
          anchors: { scope: 's_cooper_storage', quantifier: 'np_someone_cooper_storage' },
          values: { category: 'S', qstore: ['someone'], retrieved: ['everyone'] }
        }],
        cooperStorageTree
      ),
      stage(
        'I6c',
        'Someone is retrieved from the remaining store.',
        'The final sentence plaque has an empty qstore and records someone as the retrieved quantifier at this step.',
        [{
          relation: 'CooperStorage',
          anchors: { scope: 's_cooper_storage', quantifier: 'np_someone_cooper_storage' },
          values: { category: 'S', retrieved: ['someone'] }
        }],
        cooperStorageTree
      )
    ],
    lensLabel: 'Cooper storage lens'
  },
  {
    archetype: 'I7. Polarity / negative concord',
    title: 'Negative Concord / Accord',
    status: 'The source marks matching indexed [POL−] features on I and the n-word DP, then links them with one dashed directed elbow. It is an Accord dependency, not head movement and not a generic Agree arrow.',
    sentence: 'Ma-saw even one',
    data: negativeConcordAccordTree,
    derivationStages: [
      stage(
        'I7',
        'The negative I head licenses the postverbal n-word.',
        'Accord relates I to the n-word DP. Babel draws the source\'s matching boxed index, [POL−] values, and dashed directed elbow without altering the tree.',
        [{
          relation: 'Accord',
          anchors: { source: 'i_neg_accord', goal: 'dp_nword_accord' },
          values: { index: '1', feature: 'POL', value: '−' }
        }],
        negativeConcordAccordTree
      )
    ],
    lensLabel: 'Accord lens'
  },
  {
    archetype: 'I8. Polarity / strong NPI licensing',
    title: 'Strong-NPI Licensing',
    status: 'This is the source\'s successful path-containment configuration: the focus associate c-commands the following NPI. One unheaded curve links only to its focus associate; a larger nested curve links Exh[D] to NPI[D].',
    sentence: 'Only Mia lifted a finger',
    data: strongNpiLicensingTree,
    derivationStages: [
      stage(
        'I8-0',
        'The exhaustifier, focus operator, associate, and NPI are assembled in one clause.',
        'All four licensing participants occupy their authored positions before the two semantic dependency paths are introduced.',
        [],
        strongNpiLicensingTree
      ),
      stage(
        'I8',
        'The exhaustifier licenses the NPI while only associates with the subject focus.',
        'StrongNPILicensing names Exh, the NPI, only, and the distinct focus associate. The two unheaded paths are nested, not crossed, matching the source\'s successful derivation.',
        [{
          relation: 'StrongNPILicensing',
          anchors: {
            licensor: 'exh_strong_npi',
            npi: 'dp_finger_strong_npi',
            focusOperator: 'only_strong_npi',
            focusAssociate: 'dp_mia_strong_npi'
          },
          values: { feature: 'D' }
        }],
        strongNpiLicensingTree
      )
    ],
    lensLabel: 'Strong-NPI lens'
  },
  {
    archetype: 'I9. Information structure / F-projection',
    title: 'F-Projection',
    status: 'H* marks the accent-bearing terminal. F labels and short dashed upward arrows project that focus through the predicate and its dominating nodes exactly as in the source, without creating a prosodic tier outside the syntax tree.',
    sentence: 'She praised John',
    data: fProjectionTree,
    derivationStages: [
      stage(
        'I9',
        'Accent on John licenses focus projection through the predicate.',
        'FProjection names the accent bearer and the ordered syntax nodes that inherit F-marking. Babel adds H*, F subscripts, and the source\'s dashed upward propagation arrows.',
        [{
          relation: 'FProjection',
          anchors: {
            accentBearer: 'd_john_f_projection',
            projections: [
              'v_praised_f_projection',
              'vp_f_projection',
              'ibar_f_projection',
              'ip_f_projection'
            ]
          },
          values: { accent: 'H*', feature: 'F' }
        }],
        fProjectionTree
      )
    ],
    lensLabel: 'F-projection lens'
  },
  {
    archetype: 'I1b. Scope / LF / operator-variable',
    title: 'Operator / Variable Binding',
    sentence: 'Every critic told some author that every editor filed their report with their notes in their office',
    status: 'Each OperatorVariableBinding instance composes a scope domain, a source-like binding path from an overt variable to its operator, and a shared index. No movement, copy, trace, or silent variable is authored.',
    data: operatorVariableBindingTree,
    derivationStages: [
      stage(
        'I1b',
        'Three quantifiers bind overt possessive variables in nested semantic domains.',
        'Each OperatorVariableBinding names one operator, one pronounced variable, and the scope domain interpreted under that operator. Babel derives nesting, seasonal depth, relation indices, and source-like binding geometry without introducing movement structure.',
        [
          {
            relation: 'OperatorVariableBinding',
            anchors: {
              operator: 'qp_every_critic_ovb',
              variable: 'd_their_report_ovb',
              scopeDomain: 'tbar_scope_outer_body_ovb'
            }
          },
          {
            relation: 'OperatorVariableBinding',
            anchors: {
              operator: 'qp_some_author_ovb',
              variable: 'd_their_notes_ovb',
              scopeDomain: 'cp_scope_middle_ovb'
            }
          },
          {
            relation: 'OperatorVariableBinding',
            anchors: {
              operator: 'qp_every_editor_ovb',
              variable: 'd_their_office_ovb',
              scopeDomain: 'tbar_scope_inner_body_ovb'
            }
          }
        ],
        operatorVariableBindingTree
      )
    ],
    lensLabel: 'Nested scope lens'
  },
  {
    archetype: 'I1c. Scope / LF / operator-variable',
    title: 'Operator / Variable Binding (subject variable)',
    status: 'The same semantic composition with one authored scope: one emerald domain, one variable-to-operator binding path, and one shared relation index.',
    sentence: 'Who left',
    data: subjectOperatorVariableTree,
    derivationStages: [
      stage(
        'I1c',
        'Who binds the subject variable at LF.',
        'OperatorVariableBinding names the operator, the silent subject variable, its exact trace witness, and the TP interpreted in the operator scope. A single scope receives the first seasonal color: emerald.',
        [{
          relation: 'OperatorVariableBinding',
          anchors: {
            operator: 'dp_who_opvar2',
            variable: 'dp_who_variable_opvar2',
            traceWitness: 'who_variable_trace_opvar2',
            scopeDomain: 'tp_opvar2'
          }
        }],
        subjectOperatorVariableTree
      )
    ]
  },
  {
    archetype: 'I2. Scope / LF / reconstruction',
    title: 'LF Reconstruction',
    sentence: 'Which picture of himself did every student file',
    status: 'Reconstruction draws no connector of any kind: per the source convention the two copies are linked by a shared subscript alone, with the neglected higher copy struck/ghosted and the interpreted lower copy retained.',
    data: lfReconstructionTree,
    derivationStages: [
      stage(
        'I2-0',
        'The complete wh-DP is merged in the lower object position.',
        'Which picture of himself remains pronounced below every student. The higher CP occurrence and the LF copy-selection relation do not yet exist.',
        [],
        movementBaseTree(lfReconstructionTree, 'dp_picture_high_lf', 'dp_picture_low_lf', ['cp_reconstruction_lf'])
      ),
      stage(
        'I2-1',
        'The complete wh-DP A-bar moves to Spec,CP.',
        'AbarMove creates the pronounced higher DP and leaves the complete lower DP silent before LF copy selection applies.',
        [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_picture_low_lf',
            traceWitness: 'd_which_picture_low_lf',
            pronouncedCopy: 'dp_picture_high_lf'
          }
        }],
        lfReconstructionTree
      ),
      stage(
        'I2',
        'The moved DP is interpreted in a lower position for binding at LF.',
        'LFReconstruction interprets the lower copy of which picture of himselfᵢ while preserving the higher wh-DP as the pronounced PF occurrence.',
        [{ relation: 'LFReconstruction', anchors: { neglectedCopy: 'dp_picture_high_lf', interpretedCopy: 'dp_picture_low_lf', binder: 'dp_every_student_lf' } }],
        lfReconstructionTree
      )
    ],
    lensLabel: 'LF reconstruction lens'
  },
  {
    archetype: 'I2b. Scope / LF / reconstruction',
    title: 'LF Reconstruction (predicate AP)',
    sentence: 'How proud of himself does John seem to be',
    status: 'The same LF copy-selection drawing now operates over a fronted AP: the pronounced higher AP is neglected for interpretation while its complete silent predicate copy is interpreted below the binder. As in the first card, the copies are linked by shared subscript only — no connector is drawn.',
    data: lfPredicateReconstructionTree,
    derivationStages: [
      stage(
        'I2b-0',
        'The complete predicate AP is merged in its lower position below John.',
        'How proud of himself remains pronounced as the infinitival predicate. The higher CP occurrence and the LF copy-selection relation do not yet exist.',
        [],
        movementBaseTree(lfPredicateReconstructionTree, 'ap_proud_high_lf', 'ap_proud_low_lf', ['cp_proud_reconstruction_lf'])
      ),
      stage(
        'I2b',
        'The fronted AP is interpreted in its lower predicate position for binding at LF.',
        'LFReconstruction interprets the lower copy of how proud of himself while preserving the higher AP as the pronounced PF occurrence. John binds himself only in the lower interpreted copy.',
        [{
          relation: 'LFReconstruction',
          anchors: {
            neglectedCopy: 'ap_proud_high_lf',
            interpretedCopy: 'ap_proud_low_lf',
            binder: 'dp_john_proud_reconstruction_lf'
          }
        }],
        lfPredicateReconstructionTree
      )
    ],
    lensLabel: 'LF reconstruction lens'
  },
  {
    archetype: 'I4. Focus / prominence',
    title: 'Focus Marking (subject focus)',
    sentence: 'Mia read the book',
    status: 'Focus is drawn as branch strength: the focused branch is promoted and its background sister is demoted to a dotted line. The mark is prominence only; it asserts nothing about which operator, if any, associates with the focus.',
    data: focusMarkingTree,
    derivationStages: [
      stage(
        'I4-0',
        'The clause is assembled without focus prominence.',
        'The subject and predicate occupy their ordinary branches before a focus contrast is introduced.',
        [],
        focusMarkingTree
      ),
      stage(
        'I4',
        'The subject is the focus of the clause.',
        'FocusMarking names the focused constituent, its background sister, and the domain the contrast holds in. Babel promotes the focused branch and demotes its sister.',
        [{ relation: 'FocusMarking', anchors: { focus: 'mia_focus', background: 'tbar_focus', domain: 'tp_focus' } }],
        focusMarkingTree
      )
    ],
    lensLabel: 'Focus lens'
  },
  {
    archetype: 'I4b. Focus / prominence',
    title: 'Focus Marking (object focus)',
    sentence: 'Mia read the book',
    status: 'The same sentence with the focus authored lower in the tree. The promoted and demoted branches follow the authored focus and background anchors, so the drawing generalizes past one position rather than being tuned to one example.',
    data: focusMarkingTree,
    derivationStages: [
      stage(
        'I4b-0',
        'The clause is assembled without focus prominence.',
        'The object and verb occupy their ordinary branches before a focus contrast is introduced.',
        [],
        focusMarkingTree
      ),
      stage(
        'I4b',
        'The object is the focus of the clause.',
        'FocusMarking names the object as the focus, the verb as its background sister, and the VP as the domain. The same promotion and demotion applies one level down.',
        [{ relation: 'FocusMarking', anchors: { focus: 'dp_book_focus', background: 'v_read_focus', domain: 'vp_focus' } }],
        focusMarkingTree
      )
    ],
    lensLabel: 'Focus lens'
  },
  {
    archetype: 'I4c. Focus / prominence',
    title: 'Focus Marking (embedded focus)',
    status: 'A different sentence, with the focus inside an embedded clause. The promoted and demoted branches sit within the embedded domain and leave the matrix clause unmarked, so the contrast is local to the authored domain.',
    sentence: 'Noa said Mia left',
    data: embeddedFocusTree,
    derivationStages: [
      stage(
        'I4c-0',
        'The matrix and embedded clauses are assembled without focus prominence.',
        'Mia and the embedded predicate occupy their ordinary branches before the embedded contrast is introduced.',
        [],
        embeddedFocusTree
      ),
      stage(
        'I4c',
        'The embedded subject is the focus of the embedded clause.',
        'FocusMarking names the embedded subject as the focus, its sister as the background, and the embedded TP as the domain the contrast holds in.',
        [{
          relation: 'FocusMarking',
          anchors: { focus: 'mia_focus3', background: 'tbar_emb_focus3', domain: 'tp_emb_focus3' }
        }],
        embeddedFocusTree
      )
    ],
    lensLabel: 'Focus lens'
  },
  {
    archetype: 'J. Theta / argument structure',
    title: 'Theta Roles / Argument Grid',
    sentence: 'Ray gave a grape to Bill',
    status: 'Theta-role assignment is drawn as predicate-argument role labeling: a compact theta grid near the predicate plus role labels at the anchored arguments.',
    data: thetaRoleTree,
    derivationStages: [
      stage(
        'J-0',
        'The ditransitive predicate is assembled with all three arguments.',
        'Ray, a grape, and the goal PP occupy their argument positions before the predicate assigns the authored theta roles.',
        [],
        thetaRoleTree
      ),
      stage(
        'J',
        'The predicate gave assigns theta roles to its arguments.',
        'ThetaAssignment relates the predicate to its Agent, Theme, and Goal arguments; Babel renders the relation as a theta grid and anchored role labels, not as movement.',
        [{ relation: 'ThetaAssignment', anchors: { predicate: 'v_gave_theta', agent: 'agent_ray_theta', theme: 'dp_grape_theta', goal: 'pp_goal_theta' } }],
        thetaRoleTree
      )
    ],
    lensLabel: 'Theta lens'
  },
  {
    archetype: 'J2. Theta / argument structure',
    title: 'Theta Roles / Unaccusative',
    status: 'The single Theme is first merged as the complement of broke and then A-moves to Spec,TP. Replay shows theta assignment at the base position before movement.',
    sentence: 'The vase broke',
    data: unaccusativeThetaTree,
    derivationStages: [
      stage(
        'J2a',
        'The predicate first merges its Theme in the VP-internal object position.',
        'ThetaAssignment relates broke to the lower DP Theme. No Agent is authored, so none is drawn.',
        [{
          relation: 'ThetaAssignment',
          anchors: { predicate: 'v_broke_theta2', theme: 'dp_vase_low_theta2' }
        }],
        unaccusativeThetaBaseTree
      ),
      stage(
        'J2b',
        'The complete Theme DP A-moves to Spec,TP.',
        'AMove relates the VP-internal Theme occurrence to the pronounced subject occurrence while preserving the theta relation.',
        [{
          relation: 'AMove',
          anchors: {
            lowerCopy: 'dp_vase_low_theta2',
            traceWitness: 'd_the_low_theta2',
            pronouncedCopy: 'dp_vase_high_theta2'
          }
        }],
        unaccusativeThetaTree
      )
    ],
    lensLabel: 'Theta lens'
  },
  {
    archetype: 'K. Locality / intervention',
    title: 'Intervention / Relativized Minimality',
    sentence: 'What do you wonder which student bought',
    status: "Shlonsky, Villata, and Franck's inverse-inclusion configuration: the embedded subject which student first reaches its local CP edge. The object what then forms the illicit matrix A-bar chain required by the deviant input, and Intervention separately marks that completed chain as blocked by the closer wh phrase.",
    wide: true,
    data: interventionTree,
    derivationStages: [
      stage(
        'K-0',
        'Both wh-phrases remain in their lower positions before either dependency is evaluated.',
        'Which student is the embedded subject and what is the embedded object. Neither CP-edge occurrence nor the blocked matrix dependency exists yet.',
        [],
        interventionBothBaseTree
      ),
      stage(
        'K-1',
        'The embedded subject A-bar moves to its local CP edge.',
        'AbarMove establishes the licensed which student chain before the matrix object dependency is built.',
        [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_wh_subject_intervention_low',
            traceWitness: 'd_wh_subject_intervention_low',
            pronouncedCopy: 'dp_wh_subject_intervention_high'
          }
        }],
        interventionObjectBaseTree
      ),
      stage(
        'K-2',
        'The object wh-DP A-bar moves to the matrix CP edge.',
        'AbarMove creates the completed what chain required by the deviant surface input. Its locality judgment is not yet applied.',
        [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_what_intervention_low',
            traceWitness: 'd_what_intervention_low',
            pronouncedCopy: 'dp_what_intervention_high'
          }
        }],
        interventionTree
      ),
      stage(
        'K-3',
        'The closer wh-phrase blocks the completed object A-bar chain.',
        'Intervention judges the what chain illicit because it crosses the closer which student occurrence in the inverse-inclusion configuration. It adds no syntax and performs no movement. IllicitAnalysis marks the complete derivation with the authored star.',
        [
          {
            relation: 'Intervention',
            anchors: {
              target: 'dp_what_intervention_low',
              landing: 'dp_what_intervention_high',
              intervener: 'dp_wh_subject_intervention_high'
            },
            values: { outcome: 'blocked', featureRelation: 'inverse inclusion' }
          },
          {
            relation: 'IllicitAnalysis',
            anchors: { analysis: 'cp_intervention' },
            values: { judgment: '*' }
          }
        ],
        interventionTree
      )
    ],
    lensLabel: 'Intervention lens'
  },
  {
    archetype: 'K2. Locality / intervention',
    title: 'Intervention / Superiority',
    status: 'Two wh-phrases rather than two arguments of one predicate. The subject wh has moved and is licensed; the object wh stays in place because the closer subject blocks it. The blocked path is marked as a diagnostic, not drawn as a licensed chain.',
    sentence: 'Who bought what',
    data: superiorityTree,
    derivationStages: [
      stage(
        'K2-0',
        'Both wh-DPs are merged in their argument positions.',
        'Who remains in subject position and what remains in object position. The CP-edge occurrence and superiority diagnostic do not yet exist.',
        [],
        movementBaseTree(superiorityTree, 'dp_who_sup', 'dp_who_low_sup', ['cp_sup'])
      ),
      stage(
        'K2',
        'The subject wh moves to the CP edge; the object wh cannot cross it.',
        'AbarMove draws the licensed subject chain. Intervention compares the in-situ object wh with the closer subject occurrence and marks only the blocked path.',
        [
          {
            relation: 'AbarMove',
            anchors: {
              lowerCopy: 'dp_who_low_sup',
              traceWitness: 'd_who_low_sup',
              pronouncedCopy: 'dp_who_sup'
            }
          },
          {
            relation: 'Intervention',
            anchors: {
              landing: 'dp_who_sup',
              intervener: 'dp_who_low_sup',
              target: 'dp_what_sup'
            }
          }
        ],
        superiorityTree
      )
    ],
    lensLabel: 'Superiority lens'
  },
  {
    archetype: 'L1. Trajectory / remnant',
    title: 'Remnant Movement',
    status: "German remnant VP topicalization, on den Besten and Webelhuth's analysis (GLOW 1987; 'Stranding', in Scrambling and Barriers, 1990; Müller, Incomplete Category Fronting, 1998, gives partial VP fronting the same remnant treatment). Four words front as one VP — a PP and a participle — while the object stays behind above `nicht`. So the object left the VP first, and what fronted is what was left. The landing is the phrase as it is pronounced. The position it came from keeps the same structure with a trace under each of the four preterminals. The object's own gap belongs to the earlier step and is drawn in that panel. Whether the evacuation is scrambling in particular is contested in later work; this card draws the derivation it names.",
    sentence: 'Auf den Tisch gelegt hat er das Buch nicht',
    wide: true,

    /*
     * The derivation accumulates. The second step does not undo the first, so
     * the panel that draws the VP fronting still draws the evacuation that made
     * it a remnant, and still shows where the object went.
     */

    data: remnantMovementTree,
    derivationStages: [
      stage(
        'L1-0',
        'The object DP is merged in its VP-internal argument position.',
        'Das Buch is base-generated inside the VP. Its higher middle-field occurrence and every movement trace are absent.',
        [],
        movementBaseTree(remnantStepOneTree, 'dp_obj_high', 'dp_obj_gap', [])
      ),
      stage(
        'L1a',
        'The object DP leaves the VP and lands above sentential negation.',
        'RemnantMovement first evacuates the object DP from the VP to pronounced `das Buch` in the middle field. The occurrence it leaves keeps the DP\'s own D and N, each over a trace on the object\'s index.',
        [{
          relation: 'RemnantMovement',
          anchors: {
            lowerCopy: 'dp_obj_gap',
            traceWitness: 'd_das_gap',
            pronouncedCopy: 'dp_obj_high'
          },
          values: { phase: 'evacuation' }
        }],
        remnantStepOneTree
      ),
      stage(
        'L1b',
        'The VP that is left — `Auf den Tisch gelegt` — fronts as one constituent.',
        'RemnantMovement relates the lower VP occurrence to the pronounced VP in Spec,CP — shell to shell, not trace to trace. Four words travel together, which is what makes this movement of a phrase, and four traces stay behind: one under each of the P, D, N and V they left. The evacuation stays drawn beside it — its gap is still in the object\'s own argument position inside that lower VP, and `das Buch` is still pronounced above `nicht`.',
        [{
          relation: 'RemnantMovement',
          anchors: {
            lowerCopy: 'vp_rt_low',
            traceWitness: 'v_gelegt_low',
            pronouncedCopy: 'vp_rt_high'
          },
          values: { phase: 'fronting' }
        }],
        remnantMovementTree
      )
    ],
    lensLabel: 'Remnant lens'
  },
  {
    archetype: 'L2. Trajectory / roll-up',
    title: 'Roll-up Movement',
    status: "An ordinary Hebrew DP, laid out by TreeVisualizer with no help from this lab. What the source contributes is the relation convention, not the picture: three ordered phrasal movements, each drawn leaving the lower constituent's own shell sideways and turning up into the higher shell, so the nesting of the steps is visible at a glance. Every vacated position holds a complete, headed silent copy — head and complement skeleton under proper preterminals — no trace sits at a landing, and every pronounced landing copy contains pronounced terminals. Each stage carries its own complete tree.",
    sentence: 'Ha-sfarim ha-adumim ha-gdolim ha-ele',
    wide: true,


    data: rollUpMovementTree,
    derivationStages: [
      stage(
        'L2base',
        'The noun and its modifiers are base-generated in their scope order.',
        'The complete nominal hierarchy is present before movement: DemP contains the demonstrative, both adjectival projections, and the noun phrase. No movement relation has applied.',
        [],
        rollUpBaseTree
      ),
      stage(
        'L2a',
        'The nominal projection raises into the specifier of the innermost adjective.',
        'RollUpMovement relates the base NP to its landing in Spec,AP. This is the first turn: the noun now precedes ha-adumim.',
        [{
          relation: 'RollUpMovement',
          anchors: {
            lowerCopy: 'np_ru',
            traceWitness: 'n_books_ru',
            pronouncedCopy: 'np_ru_hi'
          }
        }],
        rollUpStepOneTree
      ),
      stage(
        'L2b',
        'That constituent raises again, past the outer adjective.',
        'RollUpMovement relates the lower AP to its landing in the outer Spec,AP. What moves is larger than before: the previous landing travels inside it.',
        [{
          relation: 'RollUpMovement',
          anchors: {
            lowerCopy: 'ap_red_ru',
            traceWitness: 'a_red_trace_ru',
            pronouncedCopy: 'ap_red_ru_hi'
          }
        }],
        rollUpStepTwoTree
      ),
      stage(
        'L2c',
        'The whole nominal constituent raises into Spec,DemP, fixing the surface order.',
        'RollUpMovement relates the lower AP to its landing in Spec,DemP. Three steps, three relations, and the accumulated frame shows all three.',
        [{
          relation: 'RollUpMovement',
          anchors: {
            lowerCopy: 'ap_big_ru',
            traceWitness: 'a_big_trace_ru',
            pronouncedCopy: 'ap_big_ru_hi'
          }
        }],
        rollUpMovementTree
      )
    ],
    lensLabel: 'Roll-up lens'
  },
  {
    archetype: 'L3. Trajectory / smuggling',
    title: 'Smuggling',
    status: "Belletti's carrier chunk. The verb phrase holding the internal argument moves as one shaded block to the specifier of the by-phrase, carrying that argument past the external argument that would otherwise be closer. The passenger raises to subject afterwards, as its own relation in a later frame.",
    sentence: 'The book was read by Noa',
    wide: true,


    data: smugglingTree,
    derivationStages: [
      stage(
        'L3a',
        'The verb phrase containing the internal argument moves to the specifier of the by-phrase.',
        'Smuggling relates the lower verb phrase to its landing above the by-phrase. The lower occurrence is shaded as the carrier: the internal argument travels inside it, and the external argument stays outside.',
        [{
          relation: 'Smuggling',
          anchors: {
            lowerCopy: 'vp_carrier_low',
            traceWitness: 'v_read_head_low',
            pronouncedCopy: 'vp_carrier_high',
            passenger: 'dp_book_low_smuggle',
            intervener: 'dp_noa_smuggle'
          }
        }],
        smugglingStepOneTree
      ),
      stage(
        'L3b',
        'The internal argument then A-moves out of the landed carrier to subject position.',
        'AMove relates the argument copy inside the landed carrier to the pronounced subject. Raising to subject is A-movement, drawn with the ordinary phrasal trajectory; smuggling is what made this step local enough to happen.',
        [{
          relation: 'AMove',
          anchors: {
            lowerCopy: 'dp_book_mid_smuggle',
            traceWitness: 'd_the_mid_smuggle',
            pronouncedCopy: 'dp_book_high_smuggle'
          }
        }],
        smugglingTree
      )
    ],
    lensLabel: 'Smuggling lens'
  },
  {
    archetype: 'M1. Multi-anchor / parasitic gap',
    title: 'Parasitic Gap',
    status: 'The ordinary object gap supplies the wh-movement path. A separate unheaded fork shows the filler content interpreted at both gap sites.',
    sentence: 'Which article did Ted file without reading',
    wide: true,

    data: parasiticGapTree,
    derivationStages: [
      stage(
        'M1-0',
        'The wh-DP is merged in the ordinary object position while the adjunct contains its parasitic site.',
        'Which article remains pronounced as the object of file. The parasitic position is structurally present, but matrix Spec,CP and the combined dependency do not yet exist.',
        [],
        movementBaseTree(parasiticGapTree, 'dp_filler_pg', 'dp_real_gap_pg', ['cp_pg'])
      ),
      stage(
        'M1',
        'The wh-filler licenses an ordinary object gap and a parasitic gap in the adjunct.',
        'The ordinary object gap supplies the movement trajectory. A separate unheaded fork shows the filler content interpreted at the complete ordinary-gap DP and the parasitic-gap DP; ParasiticGap adds no second movement arrow.',
        [{
          relation: 'ParasiticGap',
          anchors: {
            filler: 'dp_filler_pg',
            realGap: 'dp_real_gap_pg',
            traceWitness: 'd_real_gap_pg',
            parasiticGap: 'dp_parasitic_gap_pg'
          }
        }],
        parasiticGapTree
      )
    ],
    lensLabel: 'Parasitic gap lens'
  },
  {
    archetype: 'M1B. Multi-anchor / parasitic gap',
    title: 'Parasitic Gap (two adjunct gaps)',
    status: "After Agbayani and Ishii's multiple-parasitic-gap example: one ordinary wh-movement path, two separately anchored parasitic sites, and one shared dependency index. Babel exercises that sourced topology on a different tree; neither parasitic gap becomes a second movement source.",
    sentence: 'Which paper did Lena file without reading before citing',
    wide: true,

    data: multipleParasiticGapTree,
    derivationStages: [
      stage(
        'M1B-0',
        'The wh-DP is merged in the ordinary object position while both adjunct gaps are structurally available.',
        'Which paper remains pronounced as the object of file. Neither matrix Spec,CP nor the one-to-many parasitic dependency exists yet.',
        [],
        movementBaseTree(multipleParasiticGapTree, 'dp_filler_pg_multi', 'dp_real_gap_pg_multi', ['cp_pg_multi'])
      ),
      stage(
        'M1B',
        'One wh-filler licenses the ordinary object gap and two parasitic gaps in nested adjuncts.',
        'ParasiticGap draws one trajectory from the ordinary lower trace witness to the pronounced filler shell. Both authored parasitic gaps receive the shared index and no trajectory.',
        [{
          relation: 'ParasiticGap',
          anchors: {
            filler: 'dp_filler_pg_multi',
            realGap: 'dp_real_gap_pg_multi',
            traceWitness: 'd_real_gap_pg_multi',
            parasiticGaps: ['dp_parasitic_one_pg_multi', 'dp_parasitic_two_pg_multi']
          }
        }],
        multipleParasiticGapTree
      )
    ],
    lensLabel: 'Parasitic gap lens'
  },
  {
    archetype: 'M2. Multi-anchor / across-the-board',
    title: 'Across-the-Board Movement',
    status: "After Torr's ATB figure: the two lower occurrences sit in separate conjuncts and two movement paths converge on one pronounced wh-DP. One relation owns both paths.",
    sentence: 'I know who Jack likes and Mary hates',
    wide: true,

    data: acrossTheBoardTree,
    derivationStages: [
      stage(
        'M2-0',
        'Both conjuncts are assembled with their object positions available before shared extraction.',
        'The completed embedded C-prime is one workspace object. Each conjunct contains a complete lower who occurrence; no trace or shared landing exists yet, and the matrix predicate has not been built.',
        [],
        acrossTheBoardPreMovementTree
      ),
      stage(
        'M2',
        'One wh-DP is extracted across both conjuncts.',
        'AcrossTheBoardMovement relates the two conjunct-internal gaps to one shared landing. Each source is paired with its own trace witness.',
        [{
          relation: 'AcrossTheBoardMovement',
          anchors: {
            sources: ['dp_trace_left_atb', 'dp_trace_right_atb'],
            traceWitnesses: ['d_trace_left_atb', 'd_trace_right_atb'],
            pronouncedCopy: 'dp_who_atb'
          }
        }],
        acrossTheBoardEmbeddedTree
      ),
      stage(
        'M2-2',
        'The completed embedded CP is selected by know.',
        'The matrix I know spine is built only after AcrossTheBoardMovement has converged inside the embedded CP.',
        [],
        acrossTheBoardTree
      )
    ],
    lensLabel: 'Across-the-board lens'
  },
  {
    archetype: 'M2B. Multi-anchor / across-the-board',
    title: 'Across-the-Board Movement (three conjuncts)',
    status: "Torr's convergent-arrow convention generalized to three conjuncts: three lower trace terminals supply three paths, but all paths belong to one relation and meet one pronounced wh-DP shell.",
    sentence: 'Who did Lena praise and Noa thank and Mira call',
    wide: true,

    data: acrossTheBoardThreeTree,
    derivationStages: [
      stage(
        'M2B-0',
        'All three conjuncts are assembled with their object positions available before shared extraction.',
        'The three lower object occurrences are present in separate conjuncts, but matrix Spec,CP and the convergent movement paths do not yet exist.',
        [],
        withoutLandingTree(acrossTheBoardThreeTree, 'dp_who_atb_three', ['cp_atb_three'])
      ),
      stage(
        'M2B',
        'One wh-DP is extracted across three conjuncts.',
        'AcrossTheBoardMovement pairs each conjunct-internal source with its own trace witness and compiles all three paths to one shared landing.',
        [{
          relation: 'AcrossTheBoardMovement',
          anchors: {
            sources: [
              'dp_trace_lena_atb_three',
              'dp_trace_noa_atb_three',
              'dp_trace_mira_atb_three'
            ],
            traceWitnesses: [
              'd_trace_lena_atb_three',
              'd_trace_noa_atb_three',
              'd_trace_mira_atb_three'
            ],
            pronouncedCopy: 'dp_who_atb_three'
          }
        }],
        acrossTheBoardThreeTree
      )
    ],
    lensLabel: 'Across-the-board lens'
  },
  {
    archetype: 'M3. Multi-workspace / sideward',
    title: 'Sideward Movement',
    status: 'Barnickel (2017), example (155), shows the subject moving from an additional workspace into the primary predicate. Babel adapts that derivation to two complete trees; its cross-workspace arc is not a copied source mark.',
    sentence: 'Hinter jedem Löwen steht eine Dompteuse und krault ihm den Rücken',
    wide: true,


    data: sidewardFinalTree,
    derivationStages: [
      {
        statement: 'The primary predicate and the additional predicate are built as separate workspace objects.',
        stageRecord: 'Both rooted objects are present before sideward movement. The additional predicate still contains its pronounced subject, and no movement relation has applied.',
        relations: [],
        workspaceForest: [sidewardPrimaryBaseTree, sidewardAdditionalBaseTree]
      },
      {
        statement: 'The subject is removed from the additional workspace and remerged in the primary predicate.',
        stageRecord: 'SidewardMovement relates the silent subject position in the additional TP to the pronounced DP in the primary vP. The two roots are still separate at this derivational moment.',
        relations: [{
          relation: 'SidewardMovement',
          anchors: {
            lowerCopy: 'dp_tamer_source_sw',
            traceWitness: 'd_tamer_trace_sw',
            pronouncedCopy: 'dp_tamer_landing_sw'
          }
        }],
        workspaceForest: [sidewardPrimaryTree, sidewardAdditionalTree]
      },
      {
        statement: 'The two workspace objects are externally merged as one coordination.',
        stageRecord: 'External Merge forms one final CoordP. The previously established SidewardMovement path remains visible because both its silent source and pronounced landing survive in the final tree.',
        relations: [],
        workspaceForest: [sidewardFinalTree]
      }
    ],
    lensLabel: 'Sideward movement lens'
  },
  {
    archetype: 'M3B. Multi-workspace / sideward',
    title: 'Sideward Movement (parasitic-gap derivation)',
    status: "Nunes's source-derived configuration: which paper is first copied from an independently built adjunct into the matrix object position. After the workspaces merge, ordinary wh-movement carries the matrix occurrence to Spec,CP. The final card retains both paths.",
    sentence: 'Which paper did you file without reading',
    wide: true,


    data: sidewardPgFinalTree,
    derivationStages: [
      {
        statement: 'The adjunct and matrix predicate are built as separate workspace objects.',
        stageRecord: 'The adjunct contains which paper; the independently built matrix predicate has not yet received that object. No movement relation has applied.',
        relations: [],
        workspaceForest: [sidewardPgMatrixBaseTree, sidewardPgAdjunctBaseTree]
      },
      {
        statement: 'Which paper moves sideward from the adjunct workspace into the matrix object position.',
        stageRecord: 'SidewardMovement relates the silent adjunct occurrence to the pronounced matrix object occurrence while the two roots remain separate.',
        relations: [{
          relation: 'SidewardMovement',
          anchors: {
            lowerCopy: 'dp_paper_adj_swpg',
            traceWitness: 'd_paper_adj_swpg',
            pronouncedCopy: 'dp_paper_matrix_swpg'
          }
        }],
        workspaceForest: [sidewardPgMatrixMovedTree, sidewardPgAdjunctMovedTree]
      },
      {
        statement: 'After the workspaces combine, the matrix occurrence undergoes ordinary wh-movement.',
        stageRecord: 'AbarMove relates the silent matrix object occurrence to which paper in Spec,CP. The earlier sideward path persists, so the final frame displays the two ordered movements rather than replacing the first.',
        relations: [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_paper_matrix_swpg',
            traceWitness: 'd_paper_matrix_swpg',
            pronouncedCopy: 'dp_paper_high_swpg'
          }
        }],
        workspaceForest: [sidewardPgFinalTree]
      }
    ],
    lensLabel: 'Sideward movement lens'
  },
  {
    archetype: 'N1. Merge / Pair Merge',
    title: 'Pair Merge (phrasal adjunct)',
    status: 'The VP host and AdvP adjunct keep their ordinary tree branches. Pair Merge highlights both arms of their shared-parent fork with the dotted branch-overlay primitive.',
    sentence: 'Mia read the book quietly',

    data: pairMergePhraseTree,
    derivationStages: [
      {
        statement: 'The VP host and AdvP adjunct are separate workspace objects.',
        stageRecord: 'The two phrases exist independently before Pair Merge, so no relation arc is present.',
        relations: [],
        workspaceForest: [pairMergePhraseHost, pairMergePhraseMember]
      },
      {
        statement: 'The AdvP is Pair-Merged with the VP host.',
        stageRecord: 'PairMerge relates the adjunct phrase to its VP host. The tree retains ordinary dominance; the dotted overlay follows both native branches of their shared-parent fork.',
        relations: [{
          relation: 'PairMerge',
          anchors: {
            pairMember: 'advp_quietly_pair_phrase',
            host: 'vp_host_pair_phrase'
          }
        }],
        workspaceForest: [pairMergePhraseTree]
      }
    ],
    lensLabel: 'Pair-Merge lens'
  },
  {
    archetype: 'N1B. Merge / Pair Merge',
    title: 'Pair Merge (lexical member)',
    status: "The lexical topology uses the same branch overlay: D is Pair-Merged with an NP host, the host alone projects, and both native arms of their shared NP fork are highlighted. The D member projects nothing.",
    sentence: 'the book',

    data: pairMergeLexicalTree,
    derivationStages: [
      {
        statement: 'The determiner is Pair-Merged with the NP host.',
        stageRecord: 'PairMerge relates the lexical pair member to its phrase host. The host alone projects, so the resulting mother is the nominal projection; the member does not project. The dotted overlay follows both native branches of that shared NP fork.',
        relations: [{
          relation: 'PairMerge',
          anchors: {
            pairMember: 'd_the_pair_lexical',
            host: 'np_book_pair_lexical'
          }
        }],
        workspaceForest: [pairMergeLexicalTree]
      }
    ],
    lensLabel: 'Pair-Merge lens'
  },
  {
    archetype: 'N2. Locality / adjunct extraction',
    title: 'Blocked Extraction Diagnostic (temporal adjunct)',
    status: "The deviant wh-question supplies every endpoint independently: Who is pronounced in matrix Spec,CP, its silent object occurrence remains inside the temporal adjunct, and the adjunct CP is the blocking domain. AbarMove owns the chain; BlockedExtraction adds only the existing adjunct diagnostic.",
    sentence: 'Who did Mary cry after John hit',
    wide: true,

    data: temporalBlockedTree,
    derivationStages: [
      {
        statement: 'The temporal adjunct is merged with who in its object position.',
        stageRecord: 'Who is still pronounced as the object of hit inside the temporal adjunct. Matrix Spec,CP has not yet been introduced.',
        relations: [],
        workspaceForest: [movementBaseTree(
          temporalBlockedTree,
          'dp_who_high_temporal_blocked',
          'dp_who_low_temporal_blocked',
          ['cp_blocked_temporal']
        )]
      },
      {
        statement: 'Who A-bar moves from the adjunct object position to matrix Spec,CP.',
        stageRecord: 'AbarMove creates the pronounced matrix occurrence and silent lower occurrence required by the deviant wh-question. The locality judgment is not yet applied.',
        relations: [{
          relation: 'AbarMove',
          anchors: {
            lowerCopy: 'dp_who_low_temporal_blocked',
            traceWitness: 'd_who_low_temporal_blocked',
            pronouncedCopy: 'dp_who_high_temporal_blocked'
          }
        }],
        workspaceForest: [temporalBlockedTree]
      },
      {
        statement: 'Extraction from inside the temporal adjunct is blocked.',
        stageRecord: 'BlockedExtraction judges the completed who chain illicit because its lower occurrence is inside the temporal adjunct CP. It adds no syntax and performs no movement. IllicitAnalysis marks the complete derivation with the authored star.',
        relations: [
          {
            relation: 'BlockedExtraction',
            anchors: {
              source: 'dp_who_low_temporal_blocked',
              target: 'dp_who_high_temporal_blocked',
              adjunctDomain: 'cp_temporal_blocked'
            },
            values: {
              outcome: 'blocked'
            }
          },
          {
            relation: 'IllicitAnalysis',
            anchors: { analysis: 'cp_blocked_temporal' },
            values: { judgment: '*', label: 'extraction' }
          }
        ],
        workspaceForest: [temporalBlockedTree]
      }
    ],
    lensLabel: 'Blocked-extraction lens'
  },
  {
    archetype: 'N2B. Locality / adjunct extraction',
    title: 'Blocked Extraction Diagnostic (participial adjunct)',
    status: 'The same failed-dependency diagnostic generalizes to a PP adjunct and a deeper nominal source. Its higher endpoint is CP, not the silent C head; the authored adjunct anchor determines which attachment branch becomes dashed.',
    sentence: 'The critic praised the book without reading the article',
    wide: true,

    data: participialBlockedTree,
    derivationStages: [
      {
        statement: 'The participial PP adjunct is merged with the lower predicate.',
        stageRecord: 'The article remains the object of reading inside the adjunct. No extraction relation has been attempted.',
        relations: [],
        workspaceForest: [participialBlockedLowerTree]
      },
      {
        statement: 'Extraction from inside the participial adjunct is blocked.',
        stageRecord: 'BlockedExtraction names the embedded DP, intended CP-edge target, and PP adjunct domain. The source-backed curve marks a dependency that cannot be formed; it is not a completed movement path.',
        relations: [
          {
            relation: 'BlockedExtraction',
            anchors: {
              source: 'dp_article_participial_blocked',
              target: 'cp_blocked_participial',
              adjunctDomain: 'pp_participial_blocked'
            },
            values: { outcome: 'blocked' }
          },
          {
            relation: 'IllicitAnalysis',
            anchors: { analysis: 'cp_blocked_participial' },
            values: { judgment: '*', label: 'extraction' }
          }
        ],
        workspaceForest: [participialBlockedTree]
      }
    ],
    lensLabel: 'Blocked-extraction lens'
  },
  {
    archetype: 'N3. Interpretation / idiom chunk',
    title: 'Idiom-Chunk Cointerpretation (object idiom)',
    status: "After Ahn's source convention: only cooked and the books are underlined. A square bracket immediately outside VP spans their interpretation domain and excludes the subject; no connector is drawn between the chunks.",
    sentence: 'Julie cooked the books',

    data: cookBooksIdiomTree,
    derivationStages: [
      {
        statement: 'The subject and predicate are assembled as an ordinary clause.',
        stageRecord: 'Cooked and the books occupy their ordinary VP positions before idiomatic cointerpretation is introduced.',
        relations: [],
        workspaceForest: [cookBooksIdiomTree]
      },
      {
        statement: 'Cooked and the books are interpreted together as an idiom inside VP.',
        stageRecord: 'IdiomChunkCointerpretation names two chunk anchors and their VP interpretation domain. Babel underlines the chunk terminals and brackets only that domain.',
        relations: [{
          relation: 'IdiomChunkCointerpretation',
          anchors: {
            predicateChunk: 'v_cooked_idiom_cook_books',
            argumentChunk: 'dp_books_idiom_cook_books',
            interpretationDomain: 'vp_idiom_cook_books'
          }
        }],
        workspaceForest: [cookBooksIdiomTree]
      }
    ],
    lensLabel: 'Idiom-domain lens'
  },
  {
    archetype: 'N3B. Interpretation / idiom chunk',
    title: 'Idiom-Chunk Cointerpretation (subject idiom)',
    status: "Ahn's second configuration changes the domain, not the primitive: The travel bug and bit are underlined, while the square bracket spans TP because the cointerpreted chunks cross the subject-predicate boundary.",
    sentence: 'The travel bug bit me',

    data: travelBugIdiomTree,
    derivationStages: [
      {
        statement: 'The subject idiom material and predicate are assembled as an ordinary clause.',
        stageRecord: 'The travel bug, bit, and the object occupy their ordinary TP positions before idiomatic cointerpretation is introduced.',
        relations: [],
        workspaceForest: [travelBugIdiomTree]
      },
      {
        statement: 'The travel bug and bit are interpreted together across the clause.',
        stageRecord: 'IdiomChunkCointerpretation names the subject chunk, predicate chunk, and TP interpretation domain. The object remains inside the bracket but is not underlined.',
        relations: [{
          relation: 'IdiomChunkCointerpretation',
          anchors: {
            subjectChunk: 'dp_travel_bug_idiom',
            predicateChunk: 'v_bit_idiom_travel_bug',
            interpretationDomain: 'tp_idiom_travel_bug'
          }
        }],
        workspaceForest: [travelBugIdiomTree]
      }
    ],
    lensLabel: 'Idiom-domain lens'
  },
  {
    archetype: 'O1. PF / zero realization',
    title: 'Zero Realization (atomic pro)',
    status: 'The syntax contains a complete atomic pro-DP. PF maps that one terminal to ∅; no constituent is deleted and no internal DP material is reconstructed by the renderer.',
    sentence: 'Arrived',

    data: zeroRealizationTree,
    derivationStages: [
      stage(
        'O1-0',
        'The syntax contains an atomic pro subject before PF realization.',
        'The pro terminal occupies the complete subject DP and remains available as the input to PF. No zero exponent has yet been selected.',
        [],
        revealPronouncedDomain(zeroRealizationTree, 'd_pro_zero_realization')
      ),
      stage(
        'O1',
        'The atomic pro subject receives no pronounced exponent.',
        'PFRealization maps the authored pro terminal to ∅. The tree remains intact.',
        [
          {
            relation: 'PFRealization',
            anchors: { terminal: 'd_pro_zero_realization' },
            values: { input: 'pro', output: '∅' }
          }
        ],
        zeroRealizationTree
      )
    ],
    lensLabel: 'Zero-realization lens'
  },
  {
    archetype: 'O1B. PF / deletion',
    title: 'Deletion (structured DP)',
    status: 'The complete DP remains structurally visible. Deletion strikes its terminal material without ghosting or removing the tree.',
    sentence: 'The students arrived',

    data: deletionContrastTree,
    derivationStages: [
      stage(
        'O1B-0',
        'The complete subject DP is assembled with all of its material pronounced.',
        'The determiner, NP, and noun remain visible inside the subject DP before PF selects the constituent for deletion.',
        [],
        revealPronouncedDomain(deletionContrastTree, 'dp_students_deletion_contrast')
      ),
      stage(
        'O1B',
        'The complete subject DP is unpronounced.',
        'EllipsisDeletion selects the authored DP domain and strikes its terminal material. The syntax remains visible and no ghosting is added.',
        [{ relation: 'EllipsisDeletion', anchors: { domain: 'dp_students_deletion_contrast' } }],
        deletionContrastTree
      )
    ],
    lensLabel: 'Deletion lens'
  },
  {
    archetype: 'O2. Parasitic gap / island path',
    title: 'Parasitic Gap in a Subject Island (connected)',
    status: "Phillips's path convention on a complete Babel tree: circles mark the primary filler-to-real-gap path, squares mark the secondary path through the subject's infinitival complement, and the paths remain connected. The ordinary wh-path is still the single movement trajectory.",
    sentence: 'Which monument did the plan to preserve ultimately endanger',
    wide: true,

    data: pgIslandLicensedTree,
    derivationStages: [
      stage(
        'O2-0',
        'The wh-DP is merged in the ordinary matrix object position while the subject contains its parasitic site.',
        'Which monument remains pronounced as the object of endanger. Matrix Spec,CP and the connected primary and secondary paths do not yet exist.',
        [],
        movementBaseTree(pgIslandLicensedTree, 'dp_filler_pg_island_licensed', 'dp_real_pg_island_licensed', ['cp_pg_island_licensed'])
      ),
      stage(
        'O2',
        'The filler has an ordinary object trace and a connected parasitic path inside the subject DP.',
        'ParasiticGap names the ordinary trace, parasitic gap, primary circular path and secondary square path. No blocked edge is authored.',
        [{
          relation: 'ParasiticGap',
          anchors: {
            filler: 'dp_filler_pg_island_licensed',
            realGap: 'dp_real_pg_island_licensed',
            traceWitness: 'd_real_pg_island_licensed',
            parasiticGap: 'dp_parasitic_pg_island_licensed',
            primaryPath: [
              'cp_pg_island_licensed',
              'cbar_pg_island_licensed',
              'tp_pg_island_licensed',
              'tbar_matrix_pg_island_licensed',
              'vp_matrix_pg_island_licensed',
              'vp_harm_pg_island_licensed',
              'dp_real_pg_island_licensed'
            ],
            secondaryPath: [
              'dp_subject_pg_island_licensed',
              'np_plan_pg_island_licensed',
              'tp_infinitive_pg_island_licensed',
              'tbar_infinitive_pg_island_licensed',
              'vp_infinitive_pg_island_licensed',
              'dp_parasitic_pg_island_licensed'
            ]
          },
          values: { outcome: 'licensed' }
        }],
        pgIslandLicensedTree
      )
    ],
    lensLabel: 'Connected-path lens'
  },
  {
    archetype: 'O2B. Parasitic gap / island path',
    title: 'Parasitic Gap in a Subject Island (blocked)',
    status: "The finite relative-clause CP interrupts Phillips's secondary square path. Babel keeps the ordinary wh-movement trajectory, circles the primary path, squares the secondary path, and copies the source's double slash onto the one authored blocked edge.",
    sentence: 'Which monument did the plan that donors preserve ultimately endanger',
    wide: true,

    data: pgIslandBlockedTree,
    derivationStages: [
      stage(
        'O2B-0',
        'The wh-DP is merged in the ordinary matrix object position while the subject relative clause contains the secondary site.',
        'Which monument remains pronounced as the object of endanger. Matrix Spec,CP and the blocked secondary-path diagnostic do not yet exist.',
        [],
        movementBaseTree(pgIslandBlockedTree, 'dp_filler_pg_island_blocked', 'dp_real_pg_island_blocked', ['cp_pg_island_blocked'])
      ),
      stage(
        'O2B',
        'The ordinary wh-chain is available, but the secondary path into the finite relative clause is blocked.',
        'ParasiticGap names the same two path classes and the relative CP as the blocked edge. The slash diagnoses that edge; it is not a second movement arrow.',
        [{
          relation: 'ParasiticGap',
          anchors: {
            filler: 'dp_filler_pg_island_blocked',
            realGap: 'dp_real_pg_island_blocked',
            traceWitness: 'd_real_pg_island_blocked',
            parasiticGap: 'dp_parasitic_pg_island_blocked',
            primaryPath: [
              'cp_pg_island_blocked',
              'cbar_pg_island_blocked',
              'tp_pg_island_blocked',
              'tbar_matrix_pg_island_blocked',
              'vp_matrix_pg_island_blocked',
              'vp_harm_pg_island_blocked',
              'dp_real_pg_island_blocked'
            ],
            secondaryPath: [
              'dp_subject_pg_island_blocked',
              'np_plan_pg_island_blocked',
              'cp_relative_pg_island_blocked',
              'tp_relative_pg_island_blocked',
              'tbar_relative_pg_island_blocked',
              'vp_relative_pg_island_blocked',
              'dp_parasitic_pg_island_blocked'
            ],
            blockedEdge: 'cp_relative_pg_island_blocked'
          },
          values: { outcome: 'blocked' }
        }],
        pgIslandBlockedTree
      )
    ],
    lensLabel: 'Blocked-path lens'
  },
  {
    archetype: 'O4. Scope / antecedent-contained deletion',
    title: 'Antecedent-Contained Deletion',
    status: 'Internal composition fixture: the surface frame shows the elided relative-clause VP contained in its antecedent; successive resolved frames independently author covert QP scope and ellipsis ghosting. ACD adds no third visual primitive.',
    sentence: 'John read every report that Mary did',
    wide: true,

    data: acdTree,
    derivationStages: [
      stage(
        'O4-1',
        'On the surface, the elided relative-clause VP is contained inside its own antecedent.',
        'The object QP sits inside the matrix VP, and the relative clause it contains holds a silent VP whose only possible antecedent is that same matrix VP. The relative operator binds the object gap inside the silent VP. No resolution relation can be stated yet: the antecedent still contains the ellipsis site.',
        [],
        acdSurfaceTree
      ),
      stage(
        'O4-2',
        'Raising the containing quantifier makes antecedent-contained deletion recoverable.',
        'QuantifierRaising relates the pronounced object QP to its LF occurrence. The raised configuration removes the antecedent-containment problem; no separate ACD visual relation is introduced.',
        [
          {
            relation: 'QuantifierRaising',
            anchors: {
              pronouncedQP: 'qp_low_acd',
              lfQP: 'qp_high_acd',
              scopeDomain: 'tp_surface_acd'
            }
          }
        ],
        acdTree
      ),
      stage(
        'O4-3',
        'The silent relative-clause VP is recovered from the matrix VP.',
        'Ellipsis independently ghosts the silent VP inside the raised QP and identifies the matrix VP as its antecedent. The completed fixture is exactly QuantifierRaising plus Ellipsis.',
        [
          {
            relation: 'Ellipsis',
            anchors: {
              domain: 'vp_ellipsis_high_acd',
              antecedent: 'vp_matrix_acd'
            }
          }
        ],
        acdTree
      )
    ],
    lensLabel: 'Composition lens'
  },
  {
    archetype: 'O5. Case / ordered stacking',
    title: 'Ordered Case Stacking',
    status: 'Babel’s case-stacking fixture shows two ordered CASE slots on one DP occurrence. Replay first shows DAT plus one open slot, then fills the second slot with NOM; no matching source overlay has been verified.',
    sentence: 'Mina arrived',


    data: orderedCaseStackingTree,
    derivationStages: [
      stage(
        'O5a',
        'The DP is first merged in the lower subject position.',
        'The complete DP Mina is present in its lower position before A-movement or Case stacking applies.',
        [],
        orderedCaseStackingBaseTree
      ),
      stage(
        'O5b',
        'The DP A-moves into the higher Case position carrying DAT and an unvalued outer Case slot.',
        'AMove creates the higher occurrence and leaves the complete lower silent copy. FeatureBundle records the first ordered Case state beside the higher DP.',
        [
          {
            relation: 'AMove',
            anchors: {
              lowerCopy: 'dp_mina_low_case_stacking',
              traceWitness: 'n_mina_low_case_stacking',
              pronouncedCopy: 'dp_mina_high_case_stacking'
            }
          },
          {
            relation: 'FeatureBundle',
            anchors: { bearer: 'dp_mina_high_case_stacking' },
            values: { 'CASE 1': 'DAT', 'CASE 2': '--' }
          }
        ],
        orderedCaseStackingTree
      ),
      stage(
        'O5c',
        'The outer Case slot is valued while the inner DAT value persists.',
        'FeatureBundle records the final ordered stack: DAT first, NOM second. No new movement is invented.',
        [{
          relation: 'FeatureBundle',
          anchors: { bearer: 'dp_mina_high_case_stacking' },
          values: { 'CASE 1': 'DAT', 'CASE 2': 'NOM' }
        }],
        orderedCaseStackingTree
      )
    ],
    lensLabel: 'Case-stacking lens'
  },
  {
    archetype: 'O6. Reference / split antecedence',
    title: 'Split Antecedence',
    status: 'The Prague reference convention supplies the extra geometry: a hollow square at the dependent and a separate directed curve from that origin to each antecedent. Babel preserves its own constituency tree and translates only that overlay in mint; no composite index or Agree-style shell fan is drawn.',
    sentence: 'Kyle told Sten about themselves',

    data: splitAntecedenceTree,
    derivationStages: [
      stage(
        'O6-0',
        'The two potential antecedents and reflexive are assembled in one clause.',
        'Kyle and Sten remain distinct nominal occurrences while themselves occupies the complement of about. No composite reference index has yet been assigned.',
        [],
        splitAntecedenceTree
      ),
      stage(
        'O6',
        'The reflexive depends jointly on two antecedents.',
        'SplitAntecedence anchors one coreference origin at the dependent and draws one directed link from the dependent to each authored antecedent.',
        [{
          relation: 'SplitAntecedence',
          anchors: {
            antecedents: ['dp_kyle_split_antecedence', 'dp_sten_split_antecedence'],
            dependent: 'dp_themselves_split_antecedence'
          }
        }],
        splitAntecedenceTree
      )
    ],
    lensLabel: 'Split-antecedence lens'
  },
];

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

/**
 * These are preserved generality examples, contrasts, and stress fixtures.
 * They remain executable for tests and internal research, but are never
 * mounted or linked by the public Atlas.
 */
export const archivedExampleArchetypes = new Set([
  'A3b',
  'B2', 'B3',
  'C1b', 'C3', 'C4b', 'C5b',
  'D2', 'D3b', 'D4b', 'D5b', 'D6b', 'D7b',
  'E1b', 'E3', 'O7', 'E5b', 'E6b',
  'F2', 'F4', 'F4b', 'F5b',
  'G2', 'G3B',
  'H2', 'H6B', 'O1',
  'I1a', 'I1d', 'I1c', 'I2b', 'I4b', 'I4c',
  'J2', 'K2',
  'M1B', 'M2B', 'M3B',
  'N1B', 'N2B', 'N3B',
  'O2B', 'O4'
]);

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
          disableRelationOverlay={false}
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
