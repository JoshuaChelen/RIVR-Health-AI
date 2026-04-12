/**
 * Utility script: list share-artifacts bucket contents.
 *
 * Usage:
 *   SUPABASE_URL=https://your-project.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
 *   node scripts/empty-share-artifacts.mjs
 *
 * Both environment variables are REQUIRED — this script will not start
 * without them. Never hardcode credentials here.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "ERROR: Missing required environment variables.\n" +
    "  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.\n" +
    "  Example:\n" +
    "    SUPABASE_URL=https://your-project.supabase.co \\\n" +
    "    SUPABASE_SERVICE_ROLE_KEY=your-key \\\n" +
    "    node scripts/empty-share-artifacts.mjs"
  );
  process.exit(1);
}

console.log("SUPABASE_URL =", url);
console.log("KEY prefix =", key?.slice(0, 20) + "…");

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
console.log("listBuckets error =", listErr);
console.log("buckets =", buckets?.map((b) => b.id));

const { data: bucket, error: getErr } = await supabase.storage.getBucket("share-artifacts");
console.log("getBucket error =", getErr);
console.log("bucket =", bucket);
