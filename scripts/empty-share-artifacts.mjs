import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || "https://vpzywhfrnyyztwylbbzf.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwenl3aGZybnl5enR3eWxiYnpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNzYzMDIsImV4cCI6MjA4MTY1MjMwMn0.HaikV_Z5_qUYQoo2JRqAfLeGyaRF7tgz75i4qP4lVP8";

console.log("SUPABASE_URL =", url);
console.log("KEY prefix =", key?.slice(0, 20));

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
console.log("listBuckets error =", listErr);
console.log("buckets =", buckets?.map((b) => b.id));

const { data: bucket, error: getErr } = await supabase.storage.getBucket("share-artifacts");
console.log("getBucket error =", getErr);
console.log("bucket =", bucket);
