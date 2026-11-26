import { withSupabase } from "@supabase/server";
import { handleRequest } from "./handler.ts";

export { handleRequest, MAX_REQUEST_BYTES, MAX_AUDIO_BYTES } from "./handler.ts";

async function handleSecretVoiceWorker(request: Request, ctx: unknown): Promise<Response> {
  return handleRequest(request, ctx as Parameters<typeof handleRequest>[1]);
}

export const secretHandler = withSupabase(
  { auth: "secret" },
  handleSecretVoiceWorker,
);

if (import.meta.main) Deno.serve(secretHandler);
