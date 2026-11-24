import test from "node:test";
import assert from "node:assert/strict";
import { classifyInboxCapture } from "../supabase/functions/_shared/inbox-rule-classifier.ts";

test("rules engine proposes conservative category labels", () => {
  assert.equal(classifyInboxCapture("Comprar leche")[0].category, "task");
  assert.equal(classifyInboxCapture("Mañana a las 9 reunión con Ana")[0].category, "event");
  assert.equal(classifyInboxCapture("Mi objetivo es correr 5 km")[0].category, "goal_subgoal");
  assert.equal(classifyInboxCapture("No olvidar la idea del menú")[0].category, "note_idea");
});

test("all eight Inbox categories have explicit deterministic classification coverage", () => {
  const cases = [
    ["task", "Comprar leche"],
    ["event", "Mañana reunión con Ana"],
    ["request", "Por favor, coordina con Ana"],
    ["habit", "Todos los días entrenar treinta minutos"],
    ["goal_subgoal", "Mi objetivo es correr cinco kilómetros"],
    ["project", "Desarrollar un nuevo sistema de ventas"],
    ["note_idea", "No olvidar la idea del menú"],
    ["list", "Lista"],
  ];
  for (const [expectedCategory, source] of cases) {
    const [proposal] = classifyInboxCapture(source);
    assert.equal(proposal.category, expectedCategory, source);
    assert.ok(proposal.confidence >= 0 && proposal.confidence <= 1, source);
    assert.equal(typeof proposal.requiresClarification, "boolean", source);
  }
});

test("multi-bullet input is split into reviewable parts without changing a character", () => {
  const source = "Pendientes:\n- Comprar café ☕\n- Llamar a Ana\n";
  const parts = classifyInboxCapture(source);
  assert.equal(parts.length, 3);
  assert.equal(parts.map((part) => part.originalFragment).join(""), source);
  assert.deepEqual(parts.map((part) => part.partIndex), [0, 1, 2]);
  assert.ok(parts.every((part) => part.confidence >= 0 && part.confidence <= 1
    && typeof part.requiresClarification === "boolean"));
});

test("leading and trailing whitespace around a multi-line capture is preserved exactly", () => {
  const source = "  \n- Comprar café ☕\n- Llamar a Ana\n  ";
  const parts = classifyInboxCapture(source);
  assert.equal(parts.map((part) => part.originalFragment).join(""), source);
  assert.equal(parts[0].originalFragment.startsWith("  \n"), true);
  assert.equal(parts.at(-1).originalFragment.endsWith("\n  "), true);
});


test("ambiguous category matches return a contextual clarification prompt", () => {
  const [overlapping] = classifyInboxCapture("Mañana comprar leche");
  assert.equal(overlapping.requiresClarification, true);
  assert.match(overlapping.clarificationPrompt, /más de una categoría/);

  const [unclassified] = classifyInboxCapture("No olvidar la idea del menú");
  assert.equal(unclassified.requiresClarification, true);
  assert.match(unclassified.clarificationPrompt, /qué quieres hacer o recordar/i);
});

test("clear category matches do not request unnecessary clarification", () => {
  const [task] = classifyInboxCapture("Comprar leche");
  assert.equal(task.requiresClarification, false);
  assert.equal(task.clarificationPrompt, null);
});
