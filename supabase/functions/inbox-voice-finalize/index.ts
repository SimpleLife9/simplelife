import { withSupabase } from "@supabase/server";
import { handleRequest } from "./handler.ts";

export { handleRequest, MAX_REQUEST_BYTES, MAX_AUDIO_BYTES } from "./handler.ts";

async function handleAuthenticatedVoiceFinalize(request: Request, ctx: unknown): Promise<Response> {
  return handleRequest(request, ctx as Parameters<typeof handleRequest>[1]);
}

export const authenticatedHandler = withSupabase(
  { auth: "user" },
  handleAuthenticatedVoiceFinalize,
);

if (import.meta.main) Deno.serve(authenticatedHandler);
