export type RelationRenderFamily = string & {};

export type RelationTrajectoryKind = 'head' | 'phrasal';

export interface ResolvedRelationAnchor {
  role: string;
  /** Original role when the registered drawing uses an equivalent lookup key. */
  authoredRole?: string;
  nodeId?: string;
  value?: string;
}

export interface ResolvedRelationLink {
  relationIndex?: string;
  relation?: string;
  anchors?: ResolvedRelationAnchor[];
  /** Authored previous-stage witnesses, carried verbatim when authored. */
  priorAnchors?: Record<string, string | string[]>;
  /** Authored literal payload, carried verbatim when authored. */
  values?: Record<string, string | string[]>;
  sourceNodeId?: string;
  targetNodeId?: string;
  witnessNodeId?: string;
  sourcePhraseId?: string;
  stepIndex?: number;
  operation?: string;
  renderFamily?: RelationRenderFamily;
  trajectoryKind?: RelationTrajectoryKind;
  movedSurface?: string;
  chainId?: string;
  note?: string;
}
