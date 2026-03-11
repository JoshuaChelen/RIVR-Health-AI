/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildFullSummaryPdf,
  buildCard3x5Pdf,
  buildPreVisitNotePdf,
  buildFullTimelinePdf,
} from "../_shared/pdf-builders.ts";

const PROFILE_TYPES = new Set(["full_summary", "card_3x5", "pre_visit_note", "full_timeline"]);

function computeAge(dob: string | null): number | null {
  if (!dob) return null;
  try {
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  } catch { return null; }
}

function base64url(bytes: Uint8Array): string {
  const str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ──────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth: verify_jwt = false, so we do our own check ─────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing or malformed Authorization header" }), {
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
    const admin  = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const body             = await req.json();
    // Enforce fixed limits regardless of client request
    const expiresInMinutes = 1;
    const maxViews         = 2;
    const pin: string | null = body.pin ? String(body.pin) : null;

    // ── Detect share style ────────────────────────────────────────────────────

    const shareTypes: string[] = Array.isArray(body.shareTypes)
      ? body.shareTypes.filter((t: string) => PROFILE_TYPES.has(t))
      : [];
    const isProfileShare = shareTypes.length > 0;

    // Legacy document share
    const documentIds: string[]                      = Array.isArray(body.documentIds) ? body.documentIds : [];
    const legacyFileType: "summary" | "fhir" | "pdf" = body.fileType ?? "summary";

    if (!isProfileShare && documentIds.length === 0) {
      return new Response(JSON.stringify({ error: "No share types or documents specified" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Token ─────────────────────────────────────────────────────────────────

    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token     = base64url(tokenBytes);
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
    const pinHash   = pin?.trim() ? await sha256Hex(pin.trim()) : null;

    // ── Profile share: snapshot data, generate PDFs, upload ──────────────────

    let fileType    = isProfileShare ? "health_profile" : legacyFileType;
    let payloadJson: Record<string, unknown> | null = null;

    if (isProfileShare) {
      // 1. Fetch source data
      let profileRow: any = null;
      const needsProfile  = shareTypes.includes("full_summary") || shareTypes.includes("card_3x5");
      if (needsProfile) {
        const { data } = await admin
          .from("health_profiles")
          .select("score, score_label, summary_json, card_json")
          .eq("user_id", userId)
          .maybeSingle();
        profileRow = data;
      }

      // Fetch user profile for demographics and manually-entered medical data
      const { data: userProfileData } = await admin
        .from("user_profiles")
        .select("first_name, last_name, date_of_birth, sex_or_gender, allergies, medications, emergency_contact_name, emergency_contact_phone")
        .eq("user_id", userId)
        .maybeSingle();
      const userProfile: any = userProfileData;

      // Derived patient info helpers (story_answers intentionally excluded)
      const patientFullName = userProfile
        ? [userProfile.first_name, userProfile.last_name].filter(Boolean).join(" ") || null
        : null;

      let eventsRows: any[] = [];
      if (shareTypes.includes("pre_visit_note")) {
        const { data } = await admin
          .from("timeline_events")
          .select("id, occurred_at, date_precision, title, category, source, summary")
          .eq("user_id", userId)
          .eq("included_in_previsit", true)
          .order("occurred_at", { ascending: false });
        eventsRows = data ?? [];
      }

      let fullTimelineRows: any[] = [];
      if (shareTypes.includes("full_timeline")) {
        const { data } = await admin
          .from("timeline_events")
          .select("id, occurred_at, date_precision, title, category, source, summary")
          .eq("user_id", userId)
          .order("occurred_at", { ascending: false });
        fullTimelineRows = data ?? [];
      }

      // 2. Build data payloads for each type
      const snapshots: Record<string, any> = {};
      if (shareTypes.includes("full_summary") && profileRow) {
        const sj = profileRow.summary_json ?? {};
        const age = computeAge(userProfile?.date_of_birth ?? null);
        const demoParts: string[] = [];
        if (age != null) demoParts.push(`${age} y/o`);
        if (userProfile?.sex_or_gender) demoParts.push(userProfile.sex_or_gender);
        snapshots.full_summary = {
          score:                 profileRow.score,
          label:                 profileRow.score_label,
          overview:              sj.overview ?? null,
          full_summary_markdown: sj.full_summary_markdown ?? null,
          disclaimer:            sj.disclaimer ?? null,
          patient_name:          patientFullName,
          patient_demographics:  demoParts.length ? demoParts.join("  ·  ") : null,
        };
      }
      if (shareTypes.includes("card_3x5") && profileRow) {
        // health_profiles.card_json is the canonical source: the worker's
        // mergeCardWithProfile() already merged manual allergies, medications,
        // and emergency contact into card_json at evaluation time.
        //
        // The three gap-fills below are backward-compat safety nets for rows
        // written before mergeCardWithProfile was introduced. They do NOT run
        // when the card already has values.
        //
        // Important: only truly manual items (non ai_ prefix) are used here.
        // AI-backfilled items (id starts with "ai_") are already present in
        // card_json via the model's PROFILE_BACKFILL / DOCUMENT_FACTS output
        // and must not be re-inserted here as if they were patient-verified.
        const card: Record<string, any> = { ...(profileRow.card_json ?? {}) };
        if (userProfile) {
          // Emergency contact backward-compat
          if (!card.emergency_contact?.name && userProfile.emergency_contact_name) {
            card.emergency_contact = {
              name:  userProfile.emergency_contact_name,
              phone: userProfile.emergency_contact_phone ?? "",
            };
          }

          // Allergies backward-compat: manual items only
          const manualAllergies = Array.isArray(userProfile.allergies)
            ? userProfile.allergies.filter(
                (a: any) => typeof a.id !== "string" || !a.id.startsWith("ai_")
              )
            : [];
          if ((!card.allergies || card.allergies.length === 0) && manualAllergies.length > 0) {
            card.allergies = manualAllergies
              .map((a: any) => [a.allergen, a.reaction].filter(Boolean).join(" — "))
              .filter(Boolean);
          }

          // Medications backward-compat: manual items only
          const manualMedications = Array.isArray(userProfile.medications)
            ? userProfile.medications.filter(
                (m: any) => typeof m.id !== "string" || !m.id.startsWith("ai_")
              )
            : [];
          if ((!card.current_meds || card.current_meds.length === 0) && manualMedications.length > 0) {
            card.current_meds = manualMedications
              .map((m: any) => [m.name, m.dose, m.frequency].filter(Boolean).join(" "))
              .filter(Boolean);
          }

          if (patientFullName) card.patient_name = patientFullName;
        }
        snapshots.card_3x5 = card;
      }
      if (shareTypes.includes("pre_visit_note")) {
        snapshots.pre_visit_note = {
          generated_at: new Date().toISOString(),
          events:        eventsRows,
          patient_name:  patientFullName,
        };
      }
      if (shareTypes.includes("full_timeline")) {
        snapshots.full_timeline = {
          generated_at: new Date().toISOString(),
          events:        fullTimelineRows,
          patient_name:  patientFullName,
        };
      }

      // 3. Generate PDFs and upload to share-artifacts bucket
      const artifactFolder = crypto.randomUUID();
      const pdfPaths: Record<string, string> = {};

      for (const type of shareTypes) {
        let pdfBytes: Uint8Array | null = null;

        try {
          if (type === "full_summary" && snapshots.full_summary) {
            pdfBytes = await buildFullSummaryPdf(snapshots.full_summary);
          } else if (type === "card_3x5" && snapshots.card_3x5) {
            pdfBytes = await buildCard3x5Pdf(snapshots.card_3x5);
          } else if (type === "pre_visit_note" && snapshots.pre_visit_note) {
            pdfBytes = await buildPreVisitNotePdf(snapshots.pre_visit_note);
          } else if (type === "full_timeline" && snapshots.full_timeline) {
            pdfBytes = await buildFullTimelinePdf(snapshots.full_timeline);
          }
        } catch (pdfErr: any) {
          console.error(`PDF generation failed for ${type}:`, pdfErr?.message);
          continue;
        }

        if (!pdfBytes) continue;

        const storagePath = `${artifactFolder}/${type}.pdf`;
        const blob        = new Blob([pdfBytes], { type: "application/pdf" });

        const { error: uploadErr } = await admin.storage
          .from("share-artifacts")
          .upload(storagePath, blob, { contentType: "application/pdf", upsert: false });

        if (uploadErr) {
          console.error(`Storage upload failed for ${type}:`, uploadErr.message);
          continue;
        }

        pdfPaths[type] = storagePath;
      }

      if (Object.keys(pdfPaths).length === 0) {
        return new Response(
          JSON.stringify({ error: "Failed to generate any PDF for the selected share types. Ensure your health profile and timeline are generated first." }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      payloadJson = { types: shareTypes, pdfs: pdfPaths };
    } else {
      // Legacy: validate docs belong to this user
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
    }

    // ── Insert share package ──────────────────────────────────────────────────

    const { data: pkg, error: pkgErr } = await admin
      .from("share_packages")
      .insert({
        owner_id:   userId,
        token_hash: tokenHash,
        file_type:  fileType,
        expires_at: expiresAt,
        revoked:    false,
        max_views:  maxViews,
        pin_hash:   pinHash,
        ...(payloadJson ? { payload_json: payloadJson } : {}),
      })
      .select("id, expires_at")
      .single();

    if (pkgErr) throw pkgErr;

    // Legacy: insert document items
    if (!isProfileShare) {
      const items = documentIds.map((document_id) => ({ package_id: pkg.id, document_id }));
      const { error: itemsErr } = await admin.from("share_package_items").insert(items);
      if (itemsErr) throw itemsErr;
    }

    // ── Build share URL ───────────────────────────────────────────────────────

    const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
    const shareUrl   = `https://${projectRef}.functions.supabase.co/share?token=${encodeURIComponent(token)}`;

    return new Response(
      JSON.stringify({ packageId: pkg.id, shareUrl, expiresAt: pkg.expires_at }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
