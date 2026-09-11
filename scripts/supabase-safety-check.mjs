import { createClient } from "@supabase/supabase-js";
import { loadSupabaseEnv, parseArgs } from "./lib/supabase-env.mjs";

const requiredTables = ["organizations", "profiles", "event_reviews", "review_attachments", "share_links"];

async function countRows(supabase, table) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile = args.env || ".env.local";
  const { supabaseUrl, serviceRoleKey, projectRef, expectedProjectRef } = loadSupabaseEnv(envFile);
  const expectedRef = args["expected-ref"] || expectedProjectRef;
  const minReviews = Number(args["min-reviews"] || 0);
  const failures = [];

  if (expectedRef && projectRef !== expectedRef) {
    failures.push(`Supabase project ref mismatch. Expected ${expectedRef}, got ${projectRef}.`);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const counts = {};
  for (const table of requiredTables) {
    counts[table] = await countRows(supabase, table);
  }

  if (counts.event_reviews < minReviews) {
    failures.push(`event_reviews count ${counts.event_reviews} is below required minimum ${minReviews}.`);
  }

  const { error: consumptionError } = await supabase.from("event_reviews").select("id, consumption").limit(1);
  if (consumptionError) {
    failures.push(`Consumption column check failed: ${consumptionError.message}`);
  }

  const { error: guestCountError } = await supabase.from("event_reviews").select("id, guest_count").limit(1);
  if (guestCountError) {
    failures.push(`Guest count column check failed: ${guestCountError.message}`);
  }

  const summary = {
    ok: failures.length === 0,
    projectRef,
    expectedProjectRef: expectedRef || null,
    counts,
    checks: {
      tablesReachable: true,
      consumptionColumn: !consumptionError,
      guestCountColumn: !guestCountError,
      minReviews,
    },
    failures,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
