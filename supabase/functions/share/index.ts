/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function htmlPage() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Shared Files</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto; background:#f7fafc; margin:0; padding:24px;}
    .card{max-width:720px; margin:0 auto; background:#fff; border:1px solid #e6eef5; border-radius:14px; padding:16px;}
    h1{margin:0 0 8px 0; font-size:18px;}
    p{margin:0 0 12px 0; color:#64748b; font-size:13px; line-height:18px;}
    .row{display:flex; gap:10px; align-items:center; margin-top:12px;}
    input{flex:1; padding:10px 12px; border-radius:10px; border:1px solid #e6eef5; font-size:14px;}
    button{padding:10px 12px; border-radius:10px; border:none; background:#2cb9b0; color:#fff; font-weight:700;}
    .err{color:#dc2626; font-weight:700; margin-top:10px; font-size:13px;}
    ul{padding-left:18px;}
    a{color:#2563eb; font-weight:700; word-break:break-all;}
    .meta{margin-top:10px; font-size:12px; color:#94a3b8;}
  </style>
</head>
<body>
  <div class="card">
    <h1>Shared files</h1>
    <p>Links are time limited. If one expires, refresh to generate new ones.</p>

    <div id="pinWrap" style="display:none">
      <p>This share requires a PIN.</p>
      <div class="row">
        <input id="pin" placeholder="Enter PIN" />
        <button id="loadBtn">Open</button>
      </div>
    </div>

    <div id="content"></div>
    <div id="error" class="err" style="display:none"></div>
  </div>

<script>
  const params = new URLSearchParams(location.search);
  const token = params.get("token");

  const content = document.getElementById("content");
  const errEl = document.getElementById("error");
  const pinWrap = document.getElementById("pinWrap");
  const pinInput = document.getElementById("pin");
  const loadBtn = document.getElementById("loadBtn");

  function showError(msg){
    errEl.style.display = "block";
    errEl.textContent = msg;
  }

  async function resolve(pin){
  errEl.style.display = "none";
  content.innerHTML = "Loading...";
  const RESOLVE_URL = "https://vpzywhfrnyyztwylbbzf.functions.supabase.co/share/resolve";

    const res = await fetch(RESOLVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, pin }),
    });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (json && json.pinRequired) return json; // allow UI to show PIN
    throw new Error(json.error || "Failed");
  }
  return json;
}


  function render(items, expiresAt){
    const ul = document.createElement("ul");
    items.forEach(it => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = it.signedUrl;
      a.textContent = it.title || "(untitled)";
      a.target = "_blank";
      li.appendChild(a);
      ul.appendChild(li);
    });
    content.innerHTML = "";
    content.appendChild(ul);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = "Expires at: " + expiresAt;
    content.appendChild(meta);
  }

  (async () => {
    if (!token) return showError("Missing token.");
    try {
      const quick = await resolve(null);
      if (quick.pinRequired) {
        content.innerHTML = "";
        pinWrap.style.display = "block";
        loadBtn.onclick = async () => {
          try {
            const data = await resolve(pinInput.value || "");
            render(data.items, data.expiresAt);
          } catch(e){
            showError(e.message || "Failed to load share.");
            content.innerHTML = "";
          }
        };
        return;
      }
      render(quick.items, quick.expiresAt);
    } catch(e){
      showError(e.message || "Failed to load share.");
      content.innerHTML = "";
    }
  })();
</script>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  const SHARE_WEB_BASE = Deno.env.get("SHARE_WEB_BASE")!; 

if (req.method === "GET") {
  const token = url.searchParams.get("token");
  const target = token
    ? `${SHARE_WEB_BASE}?token=${encodeURIComponent(token)}`
    : SHARE_WEB_BASE;

  return Response.redirect(target, 302);
}

  if (req.method === "POST" && url.pathname.endsWith("/resolve")) {
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

      const body = await req.json();
      const token = String(body.token ?? "");
      const pin = body.pin == null ? null : String(body.pin);

      if (!token || token.length < 20) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokenHash = await sha256Hex(token);

      const { data: pkg, error: pkgErr } = await admin
        .from("share_packages")
        .select("id, owner_id, file_type, expires_at, revoked, max_views, views_count, pin_hash, payload_json, artifacts_deleted_at")
        .eq("token_hash", tokenHash)
        .single();

      if (pkgErr || !pkg) {
        return new Response(JSON.stringify({ error: "Share not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (pkg.revoked) {
        return new Response(JSON.stringify({ error: "This share link was revoked" }), {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (new Date(pkg.expires_at).getTime() <= Date.now()) {
        if (
          pkg.file_type === "health_profile" &&
          !(pkg as any).artifacts_deleted_at
        ) {
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
              console.error("Expired share cleanup failed:", removeErr.message);
            } else {
              await admin
                .from("share_packages")
                .update({ artifacts_deleted_at: new Date().toISOString() })
                .eq("id", pkg.id);
            }
          } else {
            await admin
              .from("share_packages")
              .update({ artifacts_deleted_at: new Date().toISOString() })
              .eq("id", pkg.id);
          }
        }

        return new Response(JSON.stringify({ error: "This share link expired" }), {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // PIN gate
      if (pkg.pin_hash) {
        if (!pin || pin.trim().length === 0) {
          return new Response(JSON.stringify({ pinRequired: true, error: "PIN required" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const pinHash = await sha256Hex(pin.trim());
        if (pinHash !== pkg.pin_hash) {
          return new Response(JSON.stringify({ pinRequired: true, error: "Wrong PIN" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      if (pkg.max_views != null && pkg.views_count >= pkg.max_views) {
        return new Response(JSON.stringify({ error: "View limit reached" }), {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Increment views
      await admin.from("share_packages").update({ views_count: pkg.views_count + 1 }).eq("id", pkg.id);

      // ── Profile-based share: resolve PDFs from share-artifacts bucket ──────
      if (pkg.file_type === "health_profile") {
        const pdfs = (pkg.payload_json as any)?.pdfs ?? {};
        const TYPE_LABELS: Record<string, string> = {
          full_summary:   "Full Health Summary",
          card_3x5:       "3×5 Health Card",
          pre_visit_note: "Pre-Visit Note",
        };

        const items: Array<{ title: string; signedUrl: string; expiresIn: number }> = [];
        for (const [type, storagePath] of Object.entries(pdfs)) {
          const { data: signed } = await admin.storage
            .from("share-artifacts")
            .createSignedUrl(storagePath as string, 120);
          if (signed?.signedUrl) {
            items.push({ title: TYPE_LABELS[type] ?? type, signedUrl: signed.signedUrl, expiresIn: 120 });
          }
        }

        if (items.length === 0) {
          return new Response(JSON.stringify({ error: "No PDF files found for this share" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ items, expiresAt: pkg.expires_at, pinRequired: false }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── Document-based share: generate short-lived signed URLs ─────────────
      const { data: rows, error: rowsErr } = await admin
        .from("share_package_items")
        .select("document_id, documents!inner(id, user_id, title, pdf_path, summary_path, fhir_path)")
        .eq("package_id", pkg.id);

      if (rowsErr) throw rowsErr;

      const docs = (rows ?? [])
        .map((r: any) => r.documents)
        .filter((d: any) => d && d.user_id === pkg.owner_id);

      const bucket = "documents";
      const expiresSec = 60; // short lived

      const items: Array<{ title: string | null; signedUrl: string; expiresIn: number }> = [];

      for (const d of docs) {
        const path =
          pkg.file_type === "fhir" ? d.fhir_path :
          pkg.file_type === "pdf" ? d.pdf_path :
          d.summary_path;

        if (!path) continue;

        const { data: signed, error: signErr } = await admin.storage
          .from(bucket)
          .createSignedUrl(path, expiresSec);

        if (signErr || !signed?.signedUrl) continue;

        items.push({ title: d.title ?? null, signedUrl: signed.signedUrl, expiresIn: expiresSec });
      }

      if (items.length === 0) {
        return new Response(JSON.stringify({ error: "No files available for this share" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ items, expiresAt: pkg.expires_at, pinRequired: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e?.message ?? "Resolve failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
