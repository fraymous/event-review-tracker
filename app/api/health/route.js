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

export async function GET() {
  const allowPublicSignUp = process.env.NEXT_PUBLIC_ALLOW_SIGN_UP !== "false";
  const checks = {
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    allowPublicSignUp,
  };

  const supabaseReady = checks.supabaseUrl && checks.supabaseAnonKey;
  const sharedLinksReady = supabaseReady && checks.supabaseServiceRoleKey;
  const hasProfiles = await getProfilePresence(sharedLinksReady);
  const firstManagerSignup = allowPublicSignUp && hasProfiles !== true;

  return NextResponse.json({
    ok: true,
    storageMode: supabaseReady ? "supabase" : "local-demo",
    checks: {
      ...checks,
      hasProfiles,
    },
    features: {
      authAndDatabase: supabaseReady,
      firstManagerSignup,
      publicSharedLinks: sharedLinksReady,
      managerInvites: sharedLinksReady,
    },
  });
}
