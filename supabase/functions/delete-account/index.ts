/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Verify caller ────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    // ── Admin client for privileged operations ───────────────────────────────
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // ── Delete user data in dependency order ─────────────────────────────────

    // 1. Share package items (FK → share_packages)
    const { data: packages } = await admin
      .from("share_packages")
      .select("id")
      .eq("owner_id", userId);
    if (packages && packages.length > 0) {
      const pkgIds = packages.map((p: { id: string }) => p.id);
      await admin.from("share_package_items").delete().in("package_id", pkgIds);
    }

    // 2. Share packages
    await admin.from("share_packages").delete().eq("owner_id", userId);

    // 3. Storage: documents bucket
    const { data: docFiles } = await admin.storage
      .from("documents")
      .list(`${userId}/`, { limit: 1000 });
    if (docFiles && docFiles.length > 0) {
      const paths = docFiles.map((f: { name: string }) => `${userId}/${f.name}`);
      await admin.storage.from("documents").remove(paths);
    }
    // Also check subdirectories
    for (const subdir of ["medical-documents", "medical-images"]) {
      const { data: subFiles } = await admin.storage
        .from("documents")
        .list(`${userId}/${subdir}`, { limit: 1000 });
      if (subFiles && subFiles.length > 0) {
        const subPaths = subFiles.map(
          (f: { name: string }) => `${userId}/${subdir}/${f.name}`
        );
        await admin.storage.from("documents").remove(subPaths);
      }
    }

    // 4. Storage: share-artifacts bucket
    const { data: shareFiles } = await admin.storage
      .from("share-artifacts")
      .list(`${userId}/`, { limit: 1000 });
    if (shareFiles && shareFiles.length > 0) {
      const sharePaths = shareFiles.map(
        (f: { name: string }) => `${userId}/${f.name}`
      );
      await admin.storage.from("share-artifacts").remove(sharePaths);
    }

    // 5. AI job events (FK → ai_jobs)
    const { data: jobs } = await admin
      .from("ai_jobs")
      .select("id")
      .eq("user_id", userId);
    if (jobs && jobs.length > 0) {
      const jobIds = jobs.map((j: { id: string }) => j.id);
      await admin.from("ai_job_events").delete().in("job_id", jobIds);
    }

    // 6. AI jobs
    await admin.from("ai_jobs").delete().eq("user_id", userId);

    // 7. Document facts
    await admin.from("document_facts").delete().eq("user_id", userId);

    // 8. Timeline events
    await admin.from("timeline_events").delete().eq("user_id", userId);

    // 9. Health evaluations
    await admin.from("health_evaluations").delete().eq("user_id", userId);

    // 10. Health profiles
    await admin.from("health_profiles").delete().eq("user_id", userId);

    // 11. Documents
    await admin.from("documents").delete().eq("user_id", userId);

    // 12. User profile
    await admin.from("user_profiles").delete().eq("user_id", userId);

    // 13. Delete the auth user
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) throw deleteErr;

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
