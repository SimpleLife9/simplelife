import modelData from "./inbox-tfidf-model.json" with { type: "json" };

export const INBOX_MODEL_PROCESSOR_VERSION = "inbox-tfidf-hybrid-v1";
export const INBOX_MODEL_CATEGORIES = [
  "task", "event", "request", "habit", "goal_subgoal", "project", "note_idea", "list",
] as const;

type InboxCategory = typeof INBOX_MODEL_CATEGORIES[number];
type InboxModel = {
  schema: string;
  classes: InboxCategory[];
  wordTerms: string[];
  wordIdf: number[];
  charTerms: string[];
  charIdf: number[];
  coef: number[][];
  intercept: number[];
  decision: { minScore: number; minMargin: number };
};
type ClassificationResult = {
  category: InboxCategory;
  confidence: number;
  requiresClarification: boolean;
  clarificationPrompt: string | null;
  rule: string;
};
export type InboxProposal = {
  partIndex: number;
  startOffset: number;
  endOffset: number;
  originalFragment: string;
  category: InboxCategory;
  confidence: number;
  requiresClarification: boolean;
  clarificationPrompt: string | null;
  interpretation: string;
  partId?: string;
};

const MODEL = modelData as InboxModel;
if (MODEL.schema !== "simplelife-inbox-tfidf-logreg-v1"
  || MODEL.classes.length !== 8
  || MODEL.wordTerms.length !== MODEL.wordIdf.length
  || MODEL.charTerms.length !== MODEL.charIdf.length
  || MODEL.coef.length !== MODEL.classes.length
  || MODEL.coef.some((row) => row.length !== MODEL.wordTerms.length + MODEL.charTerms.length)) {
  throw new Error("Inbox statistical model artifact has an invalid shape.");
}

const WORD_INDEX = new Map(MODEL.wordTerms.map((term, index) => [term, index]));
const CHAR_INDEX = new Map(MODEL.charTerms.map((term, index) => [term, index]));

const CATEGORY_PATTERNS: readonly (readonly [InboxCategory, RegExp])[] = [
  ["request", /\b(por favor|necesito que|solicito|me gustaría que|me gustaria que|puedes|podrías|podrias|please|could you|can you)\b/i],
  ["habit", /\b(cada día|cada dia|todos los días|todos los dias|diariamente|cada semana|semanalmente|rutina|habit)\b/i],
  ["goal_subgoal", /\b(mi meta|mi objetivo|objetivo principal|quiero lograr|me propongo|goal|submeta)\b/i],
  ["event", /\b(hoy|mañana|manana|pasado mañana|pasado manana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|a las \d{1,2}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/i],
  ["project", /\b(proyecto|lanzamiento|implementar|construir|desarrollar|iniciativa|project|launch)\b/i],
  ["task", /\b(comprar|llamar|enviar|pagar|revisar|hacer|terminar|reservar|crear|escribir|buscar|agendar|preparar|actualizar|solicitar|organizar|buy|call|send|pay|review|finish|book|create|write|prepare)\b/i],
];

function normalizeFeatureText(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

function addFeatureCounts(features: string[], index: Map<string, number>, target: Map<number, number>): void {
  for (const feature of features) {
    const featureIndex = index.get(feature);
    if (featureIndex === undefined) continue;
    target.set(featureIndex, (target.get(featureIndex) ?? 0) + 1);
  }
}

function normalizedBranchValues(
  counts: Map<number, number>,
  idf: number[],
  offset: number,
  target: Float64Array,
): void {
  const weighted = new Map<number, number>();
  let squaredNorm = 0;
  for (const [index, count] of counts) {
    const value = (1 + Math.log(count)) * idf[index];
    weighted.set(index, value);
    squaredNorm += value * value;
  }
  if (squaredNorm === 0) return;
  const norm = Math.sqrt(squaredNorm);
  for (const [index, value] of weighted) target[offset + index] = value / norm;
}

function scoreStatisticalModel(text: string): {
  category: InboxCategory;
  score: number;
  margin: number;
  scores: Map<InboxCategory, number>;
} {
  const normalized = normalizeFeatureText(text);
  const tokens = normalized.match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
  const wordFeatures = tokens.slice();
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    wordFeatures.push(tokens[index] + " " + tokens[index + 1]);
  }

  const characters = Array.from(normalized);
  const charFeatures: string[] = [];
  for (let size = 3; size <= 5; size += 1) {
    for (let index = 0; index + size <= characters.length; index += 1) {
      charFeatures.push(characters.slice(index, index + size).join(""));
    }
  }

  const vector = new Float64Array(MODEL.wordTerms.length + MODEL.charTerms.length);
  const wordCounts = new Map<number, number>();
  const charCounts = new Map<number, number>();
  addFeatureCounts(wordFeatures, WORD_INDEX, wordCounts);
  addFeatureCounts(charFeatures, CHAR_INDEX, charCounts);
  normalizedBranchValues(wordCounts, MODEL.wordIdf, 0, vector);
  normalizedBranchValues(charCounts, MODEL.charIdf, MODEL.wordTerms.length, vector);

  const logits = MODEL.coef.map((row, classIndex) => {
    let value = MODEL.intercept[classIndex];
    for (let index = 0; index < row.length; index += 1) value += row[index] * vector[index];
    return value;
  });
  const maxLogit = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maxLogit));
  const denominator = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  const scores = new Map<InboxCategory, number>(
    MODEL.classes.map((category, index) => [category, exponentials[index] / denominator]),
  );
  const ranked = MODEL.classes
    .map((category) => ({ category, score: scores.get(category) ?? 0 }))
    .sort((left, right) => right.score - left.score);
  return {
    category: ranked[0].category,
    score: ranked[0].score,
    margin: ranked[0].score - (ranked[1]?.score ?? 0),
    scores,
  };
}

function classifyFragment(fragment: string): ClassificationResult {
  const text = fragment.trim();
  const statistical = scoreStatisticalModel(text);
  if (/^(lista|pendientes|checklist|to do)\s*:?$/i.test(text)) {
    return {
      category: "list",
      confidence: statistical.scores.get("list") ?? statistical.score,
      requiresClarification: false,
      clarificationPrompt: null,
      rule: "explicit-list-heading",
    };
  }

  const matches = CATEGORY_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([category]) => category);

  if (matches.length > 1) {
    const labels = matches.join(", ");
    return {
      category: statistical.category,
      confidence: statistical.score,
      requiresClarification: true,
      clarificationPrompt: "La captura contiene señales de más de una categoría (" + labels
        + "). La sugerencia estadística es " + statistical.category
        + ". ¿Cuál interpretación debe quedar registrada?",
      rule: "statistical-model-with-overlapping-cues",
    };
  }

  if (matches.length === 1) {
    const category = matches[0];
    return {
      category,
      confidence: statistical.scores.get(category) ?? 0,
      requiresClarification: false,
      clarificationPrompt: null,
      rule: "explicit-category-cue-with-statistical-score",
    };
  }

  const needsClarification = statistical.score < MODEL.decision.minScore
    || statistical.margin < MODEL.decision.minMargin;
  return {
    category: statistical.category,
    confidence: statistical.score,
    requiresClarification: needsClarification,
    clarificationPrompt: needsClarification
      ? "La sugerencia estadística es " + statistical.category + ", pero la puntuación orientativa o la separación entre categorías es baja. ¿Qué quieres hacer o recordar con este texto?"
      : null,
    rule: needsClarification ? "statistical-model-needs-clarification" : "statistical-model",
  };
}

/**
 * First-party, provider-free statistical suggestions. The compact TF-IDF model
 * was trained only on synthetic Spanish/English fixtures. Softmax scores are
 * ranking metadata, not calibrated probabilities. Explicit category cues may
 * override the statistical ranking; all proposals remain advisory and unreviewed.
 *
 * Offsets use JS UTF-16 code units. Only explicit bullet/list lines are split;
 * otherwise the full source remains one part. Every source character,
 * including whitespace, is retained.
 */
export function classifyInboxCapture(contentOriginal: string): InboxProposal[] {
  if (typeof contentOriginal !== "string" || !contentOriginal.trim()) {
    throw new TypeError("A non-empty original capture is required.");
  }
  const lines = contentOriginal.match(/.*(?:\r\n|\n|$)/gu) || [contentOriginal];
  const starts = [0];
  let offset = 0;
  let hasBullet = false;
  for (const line of lines) {
    const visible = line.replace(/^\s+/, "");
    const isBullet = /^(?:[-*•]|\d+[.)])\s+\S/u.test(visible);
    if (isBullet) {
      hasBullet = true;
      if (offset > 0 && starts[starts.length - 1] !== offset) starts.push(offset);
    }
    offset += line.length;
  }
  if (!hasBullet || starts.length < 2) starts.splice(0, starts.length, 0);

  const boundaries = [...starts, contentOriginal.length];
  const proposals: InboxProposal[] = [];
  let pendingPrefix = "";
  let pendingStartOffset: number | null = null;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startOffset = boundaries[index];
    const endOffset = boundaries[index + 1];
    const segment = contentOriginal.slice(startOffset, endOffset);
    if (!segment.trim()) {
      if (proposals.length) {
        proposals[proposals.length - 1].originalFragment += segment;
        proposals[proposals.length - 1].endOffset = endOffset;
      } else {
        if (pendingStartOffset === null) pendingStartOffset = startOffset;
        pendingPrefix += segment;
      }
      continue;
    }
    const originalFragment = pendingPrefix + segment;
    const result = classifyFragment(originalFragment);
    proposals.push({
      partIndex: proposals.length,
      startOffset: pendingStartOffset ?? startOffset,
      endOffset,
      originalFragment,
      category: result.category,
      confidence: result.confidence,
      requiresClarification: result.requiresClarification,
      clarificationPrompt: result.clarificationPrompt,
      interpretation: "Sugerencia estadística de primer nivel (" + result.rule
        + "). Puntuación orientativa, no probabilidad calibrada; requiere revisión y confirmación del usuario.",
    });
    pendingPrefix = "";
    pendingStartOffset = null;
  }
  if (!proposals.length) {
    const result = classifyFragment(contentOriginal);
    proposals.push({
      partIndex: 0, startOffset: 0, endOffset: contentOriginal.length,
      originalFragment: contentOriginal, category: result.category, confidence: result.confidence,
      requiresClarification: result.requiresClarification,
      clarificationPrompt: result.clarificationPrompt,
      interpretation: "Sugerencia estadística de primer nivel (" + result.rule
        + "). Puntuación orientativa, no probabilidad calibrada; requiere revisión y confirmación del usuario.",
    });
  }
  proposals.forEach((proposal, index) => { proposal.partIndex = index; });
  if (proposals.map((item) => item.originalFragment).join("") !== contentOriginal) {
    throw new Error("The statistical classifier did not preserve the exact source.");
  }
  return proposals;
}
