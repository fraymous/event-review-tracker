import { NextResponse } from "next/server";

import { REVIEW_BUCKET, dbReviewToUi } from "../../../../lib/supabase-data";
import { applyReviewFilters } from "../../../../lib/review-store";
import { getSupabaseAdminClient } from "../../../../lib/supabase-server";

function stripInternalAttachmentPaths(review) {
  return {
    ...review,
    attachments: (review.attachments || []).map(({ filePath, ...attachment }) => attachment),
  };
}

function dateKeyDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function GET(_request, context) {
  const supabase = getSupabaseAdminClient();
  const { token } = await context.params;

  if (!supabase) {
    return NextResponse.json(
      { error: "Shared review API is not configured." },
      { status: 501 }
    );
  }

  const { data: link, error: linkError } = await supabase
    .from("share_links")
    .select("*")
    .eq("token", token)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  if (!link) {
    return NextResponse.json({ error: "Link unavailable." }, { status: 404 });
  }

  const normalizedLink = {
    id: link.id,
    token: link.token,
    reviewId: link.review_id,
    scope: link.scope,
    filters: link.filters || {},
    createdAt: link.created_at,
    expiresAt: link.expires_at,
    revokedAt: link.revoked_at,
  };

  if (link.scope === "filtered-report" || link.scope === "executive-brief") {
    let query = supabase
      .from("event_reviews")
      .select("*, review_attachments(*)")
      .eq("organization_id", link.organization_id);

    if (link.scope === "executive-brief") {
      query = query.gte("event_date", dateKeyDaysAgo(30));
    }

    const { data: reviews, error: reportError } = await query.order("event_date", { ascending: false });

    if (reportError) {
      return NextResponse.json({ error: reportError.message }, { status: 500 });
    }

    const uiReviews = (reviews || []).map((review) => stripInternalAttachmentPaths(dbReviewToUi(review)));

    if (link.scope === "executive-brief") {
      return NextResponse.json({
        link: normalizedLink,
        brief: {
          reviews: uiReviews,
          windowDays: 30,
        },
      });
    }

    return NextResponse.json({
      link: normalizedLink,
      report: {
        filters: normalizedLink.filters,
        reviews: applyReviewFilters(uiReviews, normalizedLink.filters),
      },
    });
  }

  if (!link.review_id) {
    return NextResponse.json({ error: "Review unavailable." }, { status: 404 });
  }

  const { data: review, error: reviewError } = await supabase
    .from("event_reviews")
    .select("*, review_attachments(*)")
    .eq("id", link.review_id)
    .eq("organization_id", link.organization_id)
    .maybeSingle();

  if (reviewError) {
    return NextResponse.json({ error: reviewError.message }, { status: 500 });
  }

  if (!review) {
    return NextResponse.json({ error: "Review unavailable." }, { status: 404 });
  }

  const signedUrls = {};
  for (const attachment of review.review_attachments || []) {
    const { data } = await supabase.storage
      .from(REVIEW_BUCKET)
      .createSignedUrl(attachment.file_path, 60 * 60);
    signedUrls[attachment.file_path] = data?.signedUrl || "";
  }

  return NextResponse.json({
    link: normalizedLink,
    review: stripInternalAttachmentPaths(dbReviewToUi(review, signedUrls)),
  });
}
