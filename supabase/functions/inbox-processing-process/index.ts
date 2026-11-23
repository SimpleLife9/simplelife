import { withSupabase } from "@supabase/server";
import { handleRequest } from "./handler.ts";
export { handleRequest } from "./handler.ts";
async function handleAuthenticatedInboxProcess(request: Request, ctx: unknown): Promise<Response> {
  return handleRequest(request, ctx as Parameters<typeof handleRequest>[1]);
}
export const authenticatedHandler = withSupabase({ auth: "user" }, handleAuthenticatedInboxProcess);
if (import.meta.main) Deno.serve(authenticatedHandler);
