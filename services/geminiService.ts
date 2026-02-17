import { GoogleGenAI } from "@google/genai";
import { ParseResult } from "../types";

const XBAR_INSTRUCTION = `You are a world-class linguistic expert specializing in Generative Grammar and X-bar theory. 
Your task is to parse English sentences into formal X-bar syntax trees.

Rules for X-bar labels:
1. Use standard labels: CP, InflP, DP, NP, VP, PP, AdjP, AdvP.
2. Use 'InflP' instead of 'TP'.
3. Follow X-bar schema: XP -> (Specifier) X'; X' -> X' (Adjunct) OR X' -> X (Head) (Complement).
4. Always label intermediate projections with a prime (e.g., N', V', Infl').
5. Mark null/silent heads (C, Infl, V) with the symbol ∅.`;

const MINIMALISM_INSTRUCTION = `You are a world-class linguistic expert specializing in The Minimalist Program (Minimalism) and Bare Phrase Structure (BPS).
Your task is to parse English sentences focusing on Merge, Move (Internal Merge), and Feature-checking operations.

Rules for Minimalist labels:
1. STRICTLY FOLLOW BARE PHRASE STRUCTURE (BPS). 
2. DO NOT use "prime" notation (e.g., V', T', v') or "bar" levels. Minimalism eliminates these categories.
3. Non-terminal nodes resulting from Merge should simply be the label of the Head (e.g., V, T, C, D) or the Maximal Projection label (VP, TP, CP, DP) to indicate the completed phase/phrase.
4. Represent movement via copies or traces (marked as <word> or t).
5. Focus explanation on feature valuation (e.g., [uCase], [EPP], [uPhi]) and the derivation via Merge/Move.
6. Use vP/VP shells for transitive structures without intermediate bar levels.`;

const BASE_INSTRUCTION = `Output MUST be a single, valid JSON object.
The JSON structure must be:
{
  "tree": {
    "label": "Label",
    "children": [ ... ]
  },
  "explanation": "A concise linguistic derivation note specific to the chosen framework.",
  "partsOfSpeech": [ {"word": "word", "pos": "POS"}, ... ],
  "bracketedNotation": "[Label [Child1] [Child2]]"
}

The "bracketedNotation" field should contain a Labeled Bracketing string compatible with Miles Shang's syntax tree generator.`;

export const parseSentence = async (sentence: string, framework: 'xbar' | 'minimalism' = 'xbar'): Promise<ParseResult> => {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }

  const ai = new GoogleGenAI({ apiKey });
  const systemInstruction = (framework === 'xbar' ? XBAR_INSTRUCTION : MINIMALISM_INSTRUCTION) + "\n\n" + BASE_INSTRUCTION;
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `Analyze the sentence: "${sentence}" and return a complete syntactic analysis using ${framework === 'xbar' ? 'X-Bar Theory' : 'The Minimalist Program (Bare Phrase Structure)'} in the specified JSON format.`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 16000 }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty model response.");
    }
    
    try {
      const parsed = JSON.parse(text);
      if (!parsed.tree || !parsed.explanation) {
        throw new Error("Malformed structural components.");
      }
      return parsed as ParseResult;
    } catch (parseErr) {
      console.error("JSON Parse Error:", text);
      throw new Error("Linguistic result malformed. Please try again.");
    }
  } catch (error: any) {
    console.error("Syntactic Parsing Error:", error);
    const msg = error.message || "";
    const errorDetails = JSON.stringify(error);
    
    if (
      msg.includes("API key expired") || 
      msg.includes("API_KEY_INVALID") || 
      errorDetails.includes("API_KEY_INVALID") ||
      msg.includes("400") || 
      msg.includes("INVALID_ARGUMENT") && !msg.includes("Budget")
    ) {
      throw new Error("API_KEY_EXPIRED");
    }
    
    if (msg.includes("403") || msg.includes("not found")) {
      throw new Error("API_KEY_INVALID");
    }
    
    throw new Error(msg || "Syntactic parsing failed. Check connection.");
  }
};