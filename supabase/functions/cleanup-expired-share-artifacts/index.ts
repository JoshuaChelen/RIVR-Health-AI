/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const nowIso = new Date().toISOString();

    const { data: pkgs, error: pkgErr } = await admin
      .from("share_packages")
      .select("id, payload_json")
      .eq("file_type", "health_profile")
      .is("artifacts_deleted_at", null)
      .lte("expires_at", nowIso);

    if (pkgErr) throw pkgErr;

    let cleaned = 0;
    let filesDeleted = 0;

    for (const pkg of pkgs ?? []) {
      const pdfs = (pkg.payload_json as any)?.pdfs ?? {};
      const paths = Object.values(pdfs).filter(
        (v): v is string => typeof v === "string" && v.length > 0
      );

      if (paths.length > 0) {
        const { error: removeErr } = await admin
          .storage
          .from("share-artifacts")
          .remove(paths);

        if (removeErr) {
          console.error(`Failed removing artifacts for package ${pkg.id}:`, removeErr.message);
          continue;
        }

        filesDeleted += paths.length;
      }

      const { error: updateErr } = await admin
        .from("share_packages")
        .update({ artifacts_deleted_at: new Date().toISOString() })
        .eq("id", pkg.id);

      if (updateErr) {
        console.error(`Failed marking package ${pkg.id} as cleaned:`, updateErr.message);
        continue;
      }

      cleaned += 1;
    }

    return new Response(
      JSON.stringify({ ok: true, cleanedPackages: cleaned, deletedFiles: filesDeleted }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message ?? "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
