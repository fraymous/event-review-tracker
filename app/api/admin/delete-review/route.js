import { NextResponse } from "next/server";

import { REVIEW_BUCKET } from "../../../../lib/supabase-data";
import { getSupabaseAdminClient } from "../../../../lib/supabase-server";

export async function POST(request) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json(
      { error: "Admin delete API is not configured." },
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
  const reviewId = String(body.reviewId || "").trim();

  if (!reviewId) {
    return NextResponse.json({ error: "Review id is required." }, { status: 400 });
  }

  const { data: review, error: reviewError } = await supabase
    .from("event_reviews")
    .select("id, event_name, organization_id")
    .eq("id", reviewId)
    .eq("organization_id", requesterProfile.organization_id)
    .maybeSingle();

  if (reviewError) {
    return NextResponse.json({ error: reviewError.message }, { status: 500 });
  }

  if (!review) {
    return NextResponse.json({ error: "Review was not found." }, { status: 404 });
  }

  const { data: attachments, error: attachmentError } = await supabase
    .from("review_attachments")
    .select("file_path")
    .eq("review_id", reviewId)
    .eq("organization_id", requesterProfile.organization_id);

  if (attachmentError) {
    return NextResponse.json({ error: attachmentError.message }, { status: 500 });
  }

  const paths = (attachments || []).map((attachment) => attachment.file_path).filter(Boolean);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(REVIEW_BUCKET).remove(paths);
    if (storageError) {
      return NextResponse.json({ error: storageError.message }, { status: 500 });
    }
  }

  const { error: deleteError } = await supabase
    .from("event_reviews")
    .delete()
    .eq("id", reviewId)
    .eq("organization_id", requesterProfile.organization_id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    deletedReviewId: reviewId,
    deletedAttachmentCount: paths.length,
    deletedName: review.event_name,
  });
}
