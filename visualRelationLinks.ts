export type VisualRelationRenderFamily =
  | 'trajectory'
  | 'identity'
  | 'dependency'
  | 'feature'
  | 'domain'
  | 'silence'
  | 'sharing'
  | 'morphology'
  | 'linearization'
  | 'scope'
  | 'unknown';

export type VisualRelationTrajectoryKind = 'head' | 'phrasal';

export interface ResolvedVisualRelationAnchor {
  role: string;
  nodeId?: string;
  value?: string;
}

export interface ResolvedVisualRelation {
  relationIndex?: string;
  relation?: string;
  anchors?: ResolvedVisualRelationAnchor[];
  sourceNodeId?: string;
  targetNodeId?: string;
  witnessNodeId?: string;
  sourcePhraseId?: string;
  stepIndex?: number;
  operation?: string;
  renderFamily?: VisualRelationRenderFamily;
  trajectoryKind?: VisualRelationTrajectoryKind;
  chainId?: string;
  note?: string;

  /**
   * Compatibility aliases for the current arrow renderer.
   * New visual-relation code should prefer relationIndex/sourceNodeId/
   * targetNodeId/witnessNodeId/renderFamily/trajectoryKind.
   */
  relationIndex?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  witnessNodeId?: string;
  trajectoryKind?: VisualRelationTrajectoryKind;
}
