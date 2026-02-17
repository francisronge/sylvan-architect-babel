export interface SyntaxNode {
  label: string;
  children?: SyntaxNode[];
  word?: string;
  id?: string; // Optional ID for D3 indexing
}

export type DerivationOperation =
  | 'LexicalSelect'
  | 'ExternalMerge'
  | 'InternalMerge'
  | 'Project'
  | 'Label'
  | 'Move'
  | 'Agree'
  | 'SpellOut'
  | 'Other';

export interface DerivationStep {
  operation: DerivationOperation;
  targetLabel?: string;
  targetNodeId?: string;
  sourceLabels?: string[];
  recipe?: string;
  workspaceAfter?: string[];
  note?: string;
}

export interface ParseResult {
  tree: SyntaxNode;
  explanation: string;
  partsOfSpeech: Array<{ word: string; pos: string }>;
  bracketedNotation?: string;
  interpretation?: string;
  derivationSteps?: DerivationStep[];
}

export interface ParseBundle {
  analyses: ParseResult[];
  ambiguityDetected: boolean;
  ambiguityNote?: string;
}
