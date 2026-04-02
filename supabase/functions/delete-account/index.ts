/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * List ALL files in a storage bucket/prefix, handling pagination.
 * Supabase storage .list() returns at most `limit` items per call.
 */
async function listAllFiles(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const PAGE = 1000;
  const allPaths: string[] = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset });

    if (error || !data || data.length === 0) break;

    for (const f of data) {
      // Supabase .list() may return "folder" entries (id === null).
      // We skip those since .remove() only operates on files.
      if (f.id != null) {
        allPaths.push(`${prefix}${f.name}`);
      }
    }

    if (data.length < PAGE) break;   // last page
    offset += PAGE;
  }

  return allPaths;
}

/**
 * Recursively delete all files under a bucket/prefix, including
 * nested subdirectories of arbitrary depth.
 */
async function deleteStoragePrefix(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<void> {
  // Ensure prefix ends with /
  const p = prefix.endsWith("/") ? prefix : `${prefix}/`;

  // List items at this level
  const { data } = await admin.storage.from(bucket).list(p, { limit: 1000 });
  if (!data || data.length === 0) return;

  const filePaths: string[] = [];
  const subdirs: string[] = [];

  for (const item of data) {
    if (item.id == null) {
      // This is a folder entry — recurse into it
      subdirs.push(`${p}${item.name}/`);
    } else {
      filePaths.push(`${p}${item.name}`);
    }
  }

  // Recurse into subdirectories first
  for (const sub of subdirs) {
    await deleteStoragePrefix(admin, bucket, sub);
  }

  // Delete files at this level (in batches of 1000)
  for (let i = 0; i < filePaths.length; i += 1000) {
    const batch = filePaths.slice(i, i + 1000);
    await admin.storage.from(bucket).remove(batch);
  }

  // If there were more than 1000 items at this level, paginate
  if (data.length >= 1000) {
    // Recurse to catch remaining items after the first page was deleted
    await deleteStoragePrefix(admin, bucket, p);
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

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

    // 1. Share package items (FK → share_packages) + collect artifact paths
    const { data: packages } = await admin
      .from("share_packages")
      .select("id, payload_json")
      .eq("owner_id", userId);

    const artifactPaths: string[] = [];
    if (packages && packages.length > 0) {
      const pkgIds = packages.map((p: { id: string }) => p.id);
      await admin.from("share_package_items").delete().in("package_id", pkgIds);

      // Collect share-artifact storage paths from payload_json
      for (const pkg of packages) {
        const payload = pkg.payload_json;
        if (payload?.pdfs && typeof payload.pdfs === "object") {
          for (const pdfPath of Object.values(payload.pdfs)) {
            if (typeof pdfPath === "string" && pdfPath.length > 0) {
              artifactPaths.push(pdfPath);
            }
          }
        }
      }
    }

    // 2. Share packages
    await admin.from("share_packages").delete().eq("owner_id", userId);

    // 3. Storage: documents bucket — all user files recursively
    //    Covers: medical-documents, medical-images, voice-notes,
    //    processed/{docId}/*, ai/evaluation/*, and any root-level files
    await deleteStoragePrefix(admin, "documents", `${userId}/`);

    // 4. Storage: share-artifacts bucket
    //    Share artifacts use random UUID folders (not userId-prefixed),
    //    so we delete the specific paths collected from payload_json above.
    if (artifactPaths.length > 0) {
      for (let i = 0; i < artifactPaths.length; i += 1000) {
        const batch = artifactPaths.slice(i, i + 1000);
        await admin.storage.from("share-artifacts").remove(batch);
      }
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
