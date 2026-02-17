export interface SyntaxNode {
  label: string;
  children?: SyntaxNode[];
  word?: string;
  id?: string; // Optional ID for D3 indexing
}

export interface ParseResult {
  tree: SyntaxNode;
  explanation: string;
  partsOfSpeech: Array<{ word: string; pos: string }>;
  bracketedNotation?: string;
}