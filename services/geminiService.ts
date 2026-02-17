import { GoogleGenAI } from "@google/genai";
import { DerivationStep, ParseBundle, ParseResult, SyntaxNode } from "../types";

const XBAR_INSTRUCTION = `You are a world-class syntactician specializing in Generative syntax, with a focus on X-bar Theory and Government and Binding Theory.

Parse natural language sentences by deriving structure from framework principles, not memorized templates.
Use theoretical notions such as projection, headedness, selection, argument/adjunct distinction, locality, and null elements only when justified.

Output conventions:
- Use X-bar style constituent structure.
- Use labels consistently.
- Use InflP (not TP) for compatibility with this project.
- For finite clause-level parses, use CP as the root projection (unless the input is clearly a non-clausal fragment).
- If clear syntactic ambiguity exists, return two analyses; otherwise return one.

In the explanation, justify major choices in framework terms, not language-specific heuristics.`;

const MINIMALISM_INSTRUCTION = `You are a world-class syntactician specializing in Generative syntax, with a focus on the Minimalist Program and Bare Phrase Structure.

Parse natural language sentences by deriving structure through Merge, Internal Merge, Agree/feature valuation, and locality/phase constraints, not memorized templates.
Use derivational reasoning to justify each major structural choice.

Output conventions:
- Use Bare Phrase Structure style labels (no bar-level prime notation).
- Represent movement with copies/traces where needed.
- Use labels consistently.
- If clear syntactic ambiguity exists, return two analyses; otherwise return one.

In the explanation, justify major choices in framework terms, not language-specific heuristics.`;

const BASE_INSTRUCTION = `Output MUST be a single, valid JSON object.
The JSON structure must be:
{
  "analyses": [
    {
      "tree": {
        "label": "Label",
        "children": [ ... ]
      },
      "explanation": "A concise linguistic derivation note specific to the chosen framework.",
      "partsOfSpeech": [ {"word": "word", "pos": "POS"}, ... ],
      "bracketedNotation": "[Label [Child1] [Child2]]",
      "interpretation": "One short line describing this interpretation.",
      "derivationSteps": [
        {
          "operation": "LexicalSelect|ExternalMerge|InternalMerge|Project|Move|Agree|SpellOut|Other",
          "targetLabel": "Label",
          "sourceLabels": ["Input1", "Input2"],
          "recipe": "Input1 + Input2 -> Label",
          "workspaceAfter": ["Current", "Workspace", "Objects"],
          "note": "Optional short derivation note in framework terms."
        }
      ]
    }
  ],
  "ambiguityNote": "One short line describing how Parse 1 and Parse 2 differ in interpretation."
}

Return exactly one analysis when no clear structural ambiguity exists.
Return exactly two analyses only when clear syntactic ambiguity exists under the selected framework.

For "derivationSteps":
- Use bottom-up derivation order from lexical items to root.
- Include one step per major created syntactic object.
- Use framework-appropriate operations and keep notes concise.
- Keep "workspaceAfter" as the currently available syntactic objects after each step (not full prose).

The "bracketedNotation" field should contain a Labeled Bracketing string compatible with Miles Shang's syntax tree generator.`;

const normalizeSyntaxNode = (value: unknown): SyntaxNode => {
  if (typeof value === "string") {
    const token = value.trim();
    if (!token) {
      throw new Error("Malformed structural components.");
    }
    return { label: token, word: token };
  }

  if (!value || typeof value !== "object") {
    throw new Error("Malformed structural components.");
  }

  const node = value as Partial<SyntaxNode> & { children?: unknown[]; word?: unknown };
  const label = typeof node.label === "string" ? node.label.trim() : "";
  if (!label) {
    throw new Error("Malformed structural components.");
  }

  const normalized: SyntaxNode = { label };
  const children = Array.isArray(node.children)
    ? node.children.map((child) => normalizeSyntaxNode(child))
    : [];

  if (children.length > 0) {
    normalized.children = children;
  } else if (typeof node.word === "string" && node.word.trim()) {
    normalized.word = node.word.trim();
  }

  return normalized;
};

const normalizePartsOfSpeech = (value: unknown): Array<{ word: string; pos: string }> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      word: String((item as any)?.word ?? "").trim(),
      pos: String((item as any)?.pos ?? "").trim()
    }))
    .filter((item) => item.word.length > 0 && item.pos.length > 0);
};

const normalizeDerivationSteps = (value: unknown): DerivationStep[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const steps = value
    .map((item): DerivationStep | null => {
      if (!item || typeof item !== "object") return null;
      const step = item as any;
      const operation = String(step.operation || "").trim();
      if (!operation) return null;
      return {
        operation: operation as DerivationStep["operation"],
        targetLabel: typeof step.targetLabel === "string" ? step.targetLabel : undefined,
        targetNodeId: typeof step.targetNodeId === "string" ? step.targetNodeId : undefined,
        sourceLabels: Array.isArray(step.sourceLabels)
          ? step.sourceLabels
              .map((label: unknown) => String(label || "").trim())
              .filter((label: string) => label.length > 0)
          : undefined,
        recipe: typeof step.recipe === "string" ? step.recipe : undefined,
        workspaceAfter: Array.isArray(step.workspaceAfter)
          ? step.workspaceAfter
              .map((label: unknown) => String(label || "").trim())
              .filter((label: string) => label.length > 0)
          : undefined,
        note: typeof step.note === "string" ? step.note : undefined
      };
    })
    .filter((step): step is DerivationStep => Boolean(step));

  return steps.length > 0 ? steps : undefined;
};

const normalizeParseResult = (value: unknown): ParseResult => {
  const parsed = value as Partial<ParseResult> | null | undefined;
  if (!parsed) {
    throw new Error("Malformed structural components.");
  }

  const explanation = typeof parsed.explanation === "string" && parsed.explanation.trim()
    ? parsed.explanation
    : "No explanation provided.";

  return {
    tree: normalizeSyntaxNode(parsed.tree),
    explanation,
    partsOfSpeech: normalizePartsOfSpeech(parsed.partsOfSpeech),
    bracketedNotation: typeof parsed.bracketedNotation === "string" ? parsed.bracketedNotation : undefined,
    interpretation: typeof (parsed as any).interpretation === "string" ? (parsed as any).interpretation : undefined,
    derivationSteps: normalizeDerivationSteps((parsed as any).derivationSteps)
  };
};

const normalizeParseBundle = (value: unknown): ParseBundle => {
  const parsed = value as any;
  const analysesSource = Array.isArray(parsed?.analyses)
    ? parsed.analyses
    : parsed
      ? [parsed]
      : [];

  const analyses = analysesSource
    .map((analysis: unknown) => normalizeParseResult(analysis))
    .slice(0, 2);

  if (analyses.length === 0) {
    throw new Error("Malformed structural components.");
  }

  return {
    analyses,
    ambiguityDetected: analyses.length === 2,
    ambiguityNote: typeof parsed?.ambiguityNote === "string" ? parsed.ambiguityNote : undefined
  };
};

export const parseSentence = async (sentence: string, framework: 'xbar' | 'minimalism' = 'xbar'): Promise<ParseBundle> => {
  const apiKey = __GEMINI_API_KEY__ || "";
  
  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }

  const ai = new GoogleGenAI({ apiKey });
  const systemInstruction = (framework === 'xbar' ? XBAR_INSTRUCTION : MINIMALISM_INSTRUCTION) + "\n\n" + BASE_INSTRUCTION;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Analyze the sentence: "${sentence}" and return a complete syntactic analysis using ${framework === 'xbar' ? 'X-Bar Theory' : 'The Minimalist Program (Bare Phrase Structure)'} in the specified JSON format.`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.2
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty model response.");
    }
    
    try {
      return normalizeParseBundle(JSON.parse(text));
    } catch (parseErr) {
      console.error("JSON Parse Error:", text);
      throw new Error("Linguistic result malformed. Please try again.");
    }
  } catch (error: any) {
    console.error("Syntactic Parsing Error:", error);
    const msg = String(error?.message || "");
    const details = JSON.stringify(error || {});
    const haystack = `${msg}\n${details}`.toLowerCase();
    const statusCode = Number(
      error?.status ??
      error?.response?.status ??
      (typeof error?.code === "number" ? error.code : NaN)
    );

    if (
      haystack.includes("api key expired") ||
      haystack.includes("api_key_expired") ||
      haystack.includes("invalid api key") ||
      haystack.includes("api_key_invalid") ||
      haystack.includes("unauthenticated") ||
      haystack.includes("permission_denied") ||
      statusCode === 401 ||
      statusCode === 403
    ) {
      throw new Error("API_KEY_INVALID");
    }

    if (haystack.includes("resource_exhausted") || haystack.includes("quota") || statusCode === 429) {
      throw new Error("Rate limit or quota reached for this key. Please check your Google AI Studio quota/billing.");
    }

    if (
      statusCode === 404 ||
      (haystack.includes("model") && (
        haystack.includes("not found") ||
        haystack.includes("not available") ||
        haystack.includes("unsupported")
      ))
    ) {
      throw new Error("Requested model is unavailable for this API key/project.");
    }

    if (haystack.includes("invalid_argument") || statusCode === 400) {
      throw new Error("Request was rejected by Gemini (invalid argument). Try again or adjust configuration.");
    }

    throw new Error(msg || "Syntactic parsing failed. Check connection.");
  }
};
