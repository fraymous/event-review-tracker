import { NextResponse } from "next/server";

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

  return NextResponse.json({
    ok: true,
    storageMode: supabaseReady ? "supabase" : "local-demo",
    checks,
    features: {
      authAndDatabase: supabaseReady,
      firstManagerSignup: allowPublicSignUp,
      publicSharedLinks: sharedLinksReady,
      managerInvites: sharedLinksReady,
    },
  });
}
