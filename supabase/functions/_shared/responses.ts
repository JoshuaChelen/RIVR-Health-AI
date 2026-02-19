import { corsHeaders } from "./cors.ts";

export function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function bad(message: string, status = 400, extra: any = {}) {
  return ok({ error: message, ...extra }, status);
}
