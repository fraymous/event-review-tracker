import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "../../../../lib/supabase-server";

const allowedRoles = new Set(["manager", "leadership"]);

export async function POST(request) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json(
      { error: "Admin invite API is not configured." },
      { status: 501 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
  }

  const { data: requesterData, error: requesterError } = await supabase.auth.getUser(token);
  if (requesterError || !requesterData.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const { data: requesterProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", requesterData.user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!requesterProfile || requesterProfile.role !== "manager") {
    return NextResponse.json({ error: "Manager access is required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.fullName || "").trim();
  const role = String(body.role || "leadership").trim();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  if (!allowedRoles.has(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const origin = request.headers.get("origin") || new URL(request.url).origin;

  const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo: origin,
      data: {
        full_name: fullName || email,
        role,
      },
    }
  );

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  const invitedUser = inviteData.user;
  if (!invitedUser?.id) {
    return NextResponse.json({ error: "Invite did not return a user." }, { status: 500 });
  }

  const { error: upsertError } = await supabase.from("profiles").upsert({
    id: invitedUser.id,
    organization_id: requesterProfile.organization_id,
    full_name: fullName || email,
    email,
    role,
  });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: invitedUser.id,
      email,
      fullName: fullName || email,
      role,
    },
  });
}
