/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function base64url(bytes: Uint8Array) {
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userRes, error: userErr } = await authed.auth.getUser();
    if (userErr || !userRes.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userRes.user.id;

    const body = await req.json();
    const documentIds: string[] = Array.isArray(body.documentIds) ? body.documentIds : [];
    const fileType: "summary" | "fhir" | "pdf" = body.fileType ?? "summary";

    const expiresInMinutes = Math.max(1, Math.min(60 * 24 * 7, Number(body.expiresInMinutes ?? 60)));
    const maxViews = body.maxViews == null ? null : Number(body.maxViews);
    const pin: string | null = body.pin == null ? null : String(body.pin);

    if (documentIds.length === 0) {
      return new Response(JSON.stringify({ error: "No documents selected" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // Validate docs belong to this user
    const { data: docs, error: docsErr } = await admin
      .from("documents")
      .select("id")
      .in("id", documentIds)
      .eq("user_id", userId);

    if (docsErr) throw docsErr;
    if ((docs ?? []).length !== documentIds.length) {
      return new Response(JSON.stringify({ error: "One or more documents are not yours" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate token, store only hash
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = base64url(tokenBytes);
    const tokenHash = await sha256Hex(token);

    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
    const pinHash = pin && pin.trim().length > 0 ? await sha256Hex(pin.trim()) : null;

    const { data: pkg, error: pkgErr } = await admin
      .from("share_packages")
      .insert({
        owner_id: userId,
        token_hash: tokenHash,
        file_type: fileType,
        expires_at: expiresAt,
        revoked: false,
        max_views: maxViews,
        pin_hash: pinHash,
      })
      .select("id, expires_at")
      .single();

    if (pkgErr) throw pkgErr;

    const items = documentIds.map((document_id) => ({ package_id: pkg.id, document_id }));
    const { error: itemsErr } = await admin.from("share_package_items").insert(items);
    if (itemsErr) throw itemsErr;

    // --- UPDATED SHARE URL LOGIC ---
    // Build share URL using the Functions subdomain (renders HTML correctly)
    const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0]; 
    const shareBase = `https://${projectRef}.functions.supabase.co/share`;
    const shareUrl = `${shareBase}?token=${encodeURIComponent(token)}`;
    // -------------------------------

    return new Response(JSON.stringify({ packageId: pkg.id, shareUrl, expiresAt: pkg.expires_at }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});