import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Agenda Event Create requires Supabase gateway JWT verification", () => {
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(
    config,
    /^\[functions\.agenda-event-create\]\s*\nverify_jwt\s*=\s*true\s*$/m,
    "Event Create must keep per-function verify_jwt enabled",
  );
});
