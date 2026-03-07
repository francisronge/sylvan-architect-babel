export interface SyntaxNode {
  label: string;
  children?: SyntaxNode[];
  word?: string;
  surfaceSpan?: [number, number];
  id?: string; // Optional ID for D3 indexing
}

export type DerivationOperation =
  | 'LexicalSelect'
  | 'ExternalMerge'
  | 'InternalMerge'
  | 'HeadMove'
  | 'A-Move'
  | 'AbarMove'
  | 'Project'
  | 'Label'
  | 'Move'
  | 'Agree'
  | 'SpellOut'
  | 'Other';

export interface FeatureCheckEvent {
  feature: string;
  value?: string;
  status?: 'checked' | 'valued' | 'licensed' | 'deleted' | 'failed' | 'other';
  probeNodeId?: string;
  goalNodeId?: string;
  probeLabel?: string;
  goalLabel?: string;
  note?: string;
}

export interface DerivationStep {
  operation: DerivationOperation;
  targetLabel?: string;
  targetNodeId?: string;
  sourceNodeIds?: string[];
  sourceLabels?: string[];
  recipe?: string;
  workspaceAfter?: string[];
  spelloutOrder?: string[];
  featureChecking?: FeatureCheckEvent[];
  note?: string;
}

export interface MovementEvent {
  operation?: 'Move' | 'InternalMerge' | 'HeadMove' | 'A-Move' | 'AbarMove' | 'Other';
  fromNodeId: string;
  toNodeId: string;
  traceNodeId?: string;
  stepIndex?: number;
  note?: string;
}

export interface ParseResult {
  tree: SyntaxNode;
  explanation: string;
  partsOfSpeech: Array<{ word: string; pos: string }>;
  surfaceOrder?: string[];
  bracketedNotation?: string;
  interpretation?: string;
  derivationSteps?: DerivationStep[];
  movementEvents?: MovementEvent[];
}

export interface ParseBundle {
  analyses: ParseResult[];
  ambiguityDetected: boolean;
  ambiguityNote?: string;
  requestedModelRoute?: 'flash-lite' | 'pro';
  modelUsed?: string;
  modelsTried?: string[];
  fallbackUsed?: boolean;
}
