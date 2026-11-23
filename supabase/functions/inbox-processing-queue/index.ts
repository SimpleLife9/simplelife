import { withSupabase } from "@supabase/server";
import { handleRequest } from "./handler.ts";

export { handleRequest, MAX_REQUEST_BYTES, PROCESSOR_VERSION } from "./handler.ts";

async function handleAuthenticatedInboxQueue(request: Request, ctx: unknown): Promise<Response> {
  return handleRequest(request, ctx as Parameters<typeof handleRequest>[1]);
}

export const authenticatedHandler = withSupabase(
  { auth: "user" },
  handleAuthenticatedInboxQueue,
);

if (import.meta.main) Deno.serve(authenticatedHandler);
