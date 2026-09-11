import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";

async function getProfilePresence(canCheckProfiles) {
  if (!canCheckProfiles) return null;

  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });

  if (error) return null;
  return Number(count || 0) > 0;
}

async function getReviewColumnPresence(canCheckStorage, column) {
  if (!canCheckStorage) return null;

  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { error } = await supabase
    .from("event_reviews")
    .select(column, { head: true })
    .limit(1);

  return !error;
}

export async function GET() {
  const allowPublicSignUp = process.env.NEXT_PUBLIC_ALLOW_SIGN_UP !== "false";
  const configuredChecks = {
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    allowPublicSignUp,
  };

  const supabaseConfigured = configuredChecks.supabaseUrl && configuredChecks.supabaseAnonKey;
  const canCheckDatabase = supabaseConfigured && configuredChecks.supabaseServiceRoleKey;
  const hasProfiles = await getProfilePresence(canCheckDatabase);
  const consumptionStorage = await getReviewColumnPresence(canCheckDatabase, "consumption");
  const guestCountStorage = await getReviewColumnPresence(canCheckDatabase, "guest_count");
  const databaseReachable = canCheckDatabase ? hasProfiles !== null : null;
  const supabaseReady = supabaseConfigured && databaseReachable !== false;
  const sharedLinksReady = supabaseReady && configuredChecks.supabaseServiceRoleKey;
  const firstManagerSignup = supabaseReady && allowPublicSignUp && hasProfiles !== true;

  return NextResponse.json({
    ok: true,
    storageMode: supabaseReady ? "supabase" : "local-demo",
    checks: {
      ...configuredChecks,
      databaseReachable,
      hasProfiles,
      consumptionStorage,
      guestCountStorage,
    },
    features: {
      authAndDatabase: supabaseReady,
      firstManagerSignup,
      publicSharedLinks: sharedLinksReady,
      managerInvites: sharedLinksReady,
      consumptionStorage: databaseReachable !== false && consumptionStorage !== false,
      guestCountStorage: databaseReachable !== false && guestCountStorage !== false,
    },
  });
}
