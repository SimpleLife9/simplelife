export const INBOX_RULE_PROCESSOR_VERSION = "inbox-rules-v1";
export const INBOX_RULE_CATEGORIES = Object.freeze([
  "task", "event", "request", "habit", "goal_subgoal", "project", "note_idea", "list",
]);

const CATEGORY_PATTERNS = [
  ["request", /\b(por favor|necesito que|solicito|me gustaría que|me gustaria que|puedes|podrías|podrias|please|could you|can you)\b/i, 0.76],
  ["habit", /\b(cada día|cada dia|todos los días|todos los dias|diariamente|cada semana|semanalmente|rutina|habit)\b/i, 0.78],
  ["goal_subgoal", /\b(mi meta|mi objetivo|objetivo principal|quiero lograr|me propongo|goal|submeta)\b/i, 0.76],
  ["event", /\b(hoy|mañana|manana|pasado mañana|pasado manana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|a las \d{1,2}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/i, 0.72],
  ["project", /\b(proyecto|lanzamiento|implementar|construir|desarrollar|iniciativa|project|launch)\b/i, 0.70],
  ["task", /\b(comprar|llamar|enviar|pagar|revisar|hacer|terminar|reservar|crear|escribir|buscar|agendar|preparar|actualizar|solicitar|organizar|buy|call|send|pay|review|finish|book|create|write|prepare)\b/i, 0.68],
];

function classifyFragment(fragment) {
  const text = fragment.trim();
  const lower = text.toLocaleLowerCase("es");
  if (/^(lista|pendientes|checklist|to do)\s*:?$/i.test(text)) {
    return { category: "list", confidence: 0.78, requiresClarification: false, rule: "list-heading" };
  }
  const matches = CATEGORY_PATTERNS.filter(([, pattern]) => pattern.test(lower));
  if (matches.length > 1) {
    const [category] = matches[0];
    return { category, confidence: 0.60, requiresClarification: true, rule: "overlapping-cues" };
  }
  if (matches.length === 1) {
    const [category, , confidence] = matches[0];
    return { category, confidence, requiresClarification: false, rule: "phrase-cue" };
  }
  return { category: "note_idea", confidence: 0.42, requiresClarification: true, rule: "unclassified-fallback" };
}

/**
 * Conservative provider-free suggestions. Offsets use JS UTF-16 code units.
 * Only explicit bullet/list lines are split; otherwise the full source remains
 * one part. Every source character, including whitespace, is retained.
 * Confidence is heuristic affinity, never a calibrated probability.
 */
export function classifyInboxCapture(contentOriginal) {
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
  const proposals = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startOffset = boundaries[index];
    const endOffset = boundaries[index + 1];
    const originalFragment = contentOriginal.slice(startOffset, endOffset);
    if (!originalFragment.trim()) {
      if (proposals.length) proposals[proposals.length - 1].originalFragment += originalFragment;
      continue;
    }
    const result = classifyFragment(originalFragment);
    proposals.push({
      partIndex: proposals.length,
      startOffset,
      endOffset,
      originalFragment,
      category: result.category,
      confidence: result.confidence,
      requiresClarification: result.requiresClarification,
      interpretation: "Sugerencia heurística (" + result.rule + "). Requiere revisión y confirmación del usuario.",
    });
  }
  if (!proposals.length) {
    const result = classifyFragment(contentOriginal);
    proposals.push({
      partIndex: 0, startOffset: 0, endOffset: contentOriginal.length,
      originalFragment: contentOriginal, category: result.category, confidence: result.confidence,
      requiresClarification: result.requiresClarification,
      interpretation: "Sugerencia heurística (" + result.rule + "). Requiere revisión y confirmación del usuario.",
    });
  }
  proposals.forEach((proposal, index) => { proposal.partIndex = index; });
  if (proposals.map((item) => item.originalFragment).join("") !== contentOriginal) {
    throw new Error("The deterministic classifier did not preserve the exact source.");
  }
  return proposals;
}
