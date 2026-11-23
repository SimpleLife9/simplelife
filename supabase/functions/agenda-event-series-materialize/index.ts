import { withSupabase } from "@supabase/server";
import { handleRequest } from "./handler.ts";

export { handleRequest, MAX_REQUEST_BYTES, MAX_SERIES_PER_REQUEST } from "./handler.ts";

async function handleAuthenticatedRecurringEventMaterialize(
  request: Request,
  ctx: unknown,
): Promise<Response> {
  return handleRequest(request, ctx as Parameters<typeof handleRequest>[1]);
}

export const authenticatedHandler = withSupabase(
  { auth: "user" },
  handleAuthenticatedRecurringEventMaterialize,
);

if (import.meta.main) Deno.serve(authenticatedHandler);
