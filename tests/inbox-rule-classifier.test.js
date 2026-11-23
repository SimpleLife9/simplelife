import test from "node:test";
import assert from "node:assert/strict";
import { classifyInboxCapture } from "../supabase/functions/_shared/inbox-rule-classifier.ts";

test("rules engine proposes conservative category labels", () => {
  assert.equal(classifyInboxCapture("Comprar leche")[0].category, "task");
  assert.equal(classifyInboxCapture("Mañana a las 9 reunión con Ana")[0].category, "event");
  assert.equal(classifyInboxCapture("Mi objetivo es correr 5 km")[0].category, "goal_subgoal");
  assert.equal(classifyInboxCapture("No olvidar la idea del menú")[0].category, "note_idea");
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
