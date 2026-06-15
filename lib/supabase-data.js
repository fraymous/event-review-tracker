import { makeId } from "./review-store";

export const REVIEW_BUCKET = "review-attachments";
const SHARE_EXPIRY_OPTIONS = [7, 14, 30, 60, 90];

function shareExpiryDate(days = 30) {
  const expiresAt = new Date();
  const normalizedDays = SHARE_EXPIRY_OPTIONS.includes(Number(days)) ? Number(days) : 30;
  expiresAt.setDate(expiresAt.getDate() + normalizedDays);
  return expiresAt;
}

function cleanFileName(name) {
  return String(name || "attachment")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function dbAttachmentToUi(row, signedUrl) {
  return {
    id: row.id,
    name: row.file_name,
    type: row.file_type,
    size: row.file_size,
    filePath: row.file_path,
    uploadedAt: row.uploaded_at,
    downloadUrl: signedUrl || "",
  };
}

export function dbReviewToUi(row, signedUrls = {}) {
  const attachments = row.review_attachments || row.attachments || [];

  return {
    id: row.id,
    organizationId: row.organization_id,
    clientName: row.event_name,
    eventDate: row.event_date,
    venue: row.venue,
    eventType: row.event_type,
    managerName: row.manager_name,
    staffInvolved: row.staff_involved || [],
    overallRating: row.overall_rating,
    summary: row.event_summary || "",
    culinaryNotes: row.culinary_notes || "",
    operationalNotes: row.operational_notes || "",
    clientFeedback: row.client_feedback || "",
    wins: row.wins || "",
    issues: row.issues || "",
    tags: row.tags || [],
    followUpStatus: row.follow_up_status,
    followUpOwner: row.follow_up_owner || "",
    followUpDueDate: row.follow_up_due_date || "",
    attachments: attachments.map((attachment) =>
      dbAttachmentToUi(attachment, signedUrls[attachment.file_path])
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function uiReviewToDb(review, profile) {
  return {
    organization_id: profile.organization_id,
    event_name: review.clientName,
    event_date: review.eventDate,
    venue: review.venue,
    event_type: review.eventType,
    manager_name: review.managerName,
    staff_involved: Array.isArray(review.staffInvolved)
      ? review.staffInvolved
      : String(review.staffInvolved || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
    overall_rating: review.overallRating === "" ? null : review.overallRating,
    event_summary: review.summary,
    culinary_notes: review.culinaryNotes,
    operational_notes: review.operationalNotes,
    client_feedback: review.clientFeedback,
    wins: review.wins,
    issues: review.issues,
    tags: review.tags || [],
    follow_up_status: review.followUpStatus,
    follow_up_owner: review.followUpOwner || "",
    follow_up_due_date: review.followUpDueDate || null,
    updated_at: new Date().toISOString(),
  };
}

async function signedUrlsForAttachments(supabase, rows) {
  const paths = rows.flatMap((row) =>
    (row.review_attachments || []).map((attachment) => attachment.file_path)
  );
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));

  if (uniquePaths.length === 0) return {};

  const pairs = await Promise.all(
    uniquePaths.map(async (path) => {
      const { data } = await supabase.storage
        .from(REVIEW_BUCKET)
        .createSignedUrl(path, 60 * 60);
      return [path, data?.signedUrl || ""];
    })
  );

  return Object.fromEntries(pairs);
}

export async function getCurrentSession(supabase) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentProfile(supabase) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchRemoteProfiles(supabase) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, created_at")
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email || "",
    role: row.role,
    createdAt: row.created_at,
  }));
}

export async function bootstrapManagerProfile(supabase, fullName, organizationName) {
  const { data, error } = await supabase.rpc("bootstrap_manager_profile", {
    full_name: fullName,
    organization_name: organizationName,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function fetchRemoteReviews(supabase) {
  const { data, error } = await supabase
    .from("event_reviews")
    .select("*, review_attachments(*)")
    .order("event_date", { ascending: false });

  if (error) throw error;

  const signedUrls = await signedUrlsForAttachments(supabase, data || []);
  return (data || []).map((row) => dbReviewToUi(row, signedUrls));
}

export async function upsertRemoteReview(supabase, review, profile) {
  const payload = uiReviewToDb(review, profile);

  if (review.id) {
    const { data, error } = await supabase
      .from("event_reviews")
      .update(payload)
      .eq("id", review.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("event_reviews")
    .insert({
      ...payload,
      created_by: profile.id,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function uploadRemoteAttachments(supabase, reviewId, files, profile) {
  const pending = (files || []).filter((attachment) => typeof File !== "undefined" && attachment.file instanceof File);
  if (pending.length === 0) return [];

  const uploaded = [];

  for (const attachment of pending) {
    const file = attachment.file;
    const filePath = `${profile.organization_id}/${reviewId}/${Date.now()}-${makeId(
      "file"
    )}-${cleanFileName(file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from(REVIEW_BUCKET)
      .upload(filePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data, error: insertError } = await supabase
      .from("review_attachments")
      .insert({
        organization_id: profile.organization_id,
        review_id: reviewId,
        file_name: file.name,
        file_path: filePath,
        file_type: file.type || "application/octet-stream",
        file_size: file.size,
        uploaded_by: profile.id,
      })
      .select()
      .single();

    if (insertError) {
      await supabase.storage.from(REVIEW_BUCKET).remove([filePath]);
      throw insertError;
    }
    uploaded.push(data);
  }

  return uploaded;
}

export async function deleteRemoteAttachments(supabase, attachments) {
  const existing = (attachments || []).filter((attachment) => attachment.filePath);
  if (existing.length === 0) return;

  const paths = existing.map((attachment) => attachment.filePath);
  const { error: storageError } = await supabase.storage.from(REVIEW_BUCKET).remove(paths);
  if (storageError) throw storageError;

  const { error } = await supabase
    .from("review_attachments")
    .delete()
    .in(
      "id",
      existing.map((attachment) => attachment.id)
    );

  if (error) throw error;
}

export async function fetchRemoteShareLinks(supabase) {
  const { data, error } = await supabase
    .from("share_links")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    token: row.token,
    reviewId: row.review_id,
    scope: row.scope,
    filters: row.filters || {},
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
}

export async function createRemoteShareLink(supabase, reviewId, profile, expiresInDays = 30) {
  const expiresAt = shareExpiryDate(expiresInDays);

  const { data, error } = await supabase
    .from("share_links")
    .insert({
      organization_id: profile.organization_id,
      review_id: reviewId,
      token: makeId("share").replaceAll("-", ""),
      scope: "single-review",
      filters: {},
      expires_at: expiresAt.toISOString(),
      created_by: profile.id,
    })
    .select()
    .single();

  if (error) throw error;

  return {
    id: data.id,
    token: data.token,
    reviewId: data.review_id,
    scope: data.scope,
    filters: data.filters || {},
    createdAt: data.created_at,
    expiresAt: data.expires_at,
    revokedAt: data.revoked_at,
  };
}


export async function createRemoteReportShareLink(supabase, filters, profile, expiresInDays = 30) {
  const expiresAt = shareExpiryDate(expiresInDays);

  const { data, error } = await supabase
    .from("share_links")
    .insert({
      organization_id: profile.organization_id,
      review_id: null,
      token: makeId("share").replaceAll("-", ""),
      scope: "filtered-report",
      filters: filters || {},
      expires_at: expiresAt.toISOString(),
      created_by: profile.id,
    })
    .select()
    .single();

  if (error) throw error;

  return {
    id: data.id,
    token: data.token,
    reviewId: data.review_id,
    scope: data.scope,
    filters: data.filters || {},
    createdAt: data.created_at,
    expiresAt: data.expires_at,
    revokedAt: data.revoked_at,
  };
}

export async function createRemoteBriefShareLink(supabase, profile, expiresInDays = 30) {
  const expiresAt = shareExpiryDate(expiresInDays);

  const { data, error } = await supabase
    .from("share_links")
    .insert({
      organization_id: profile.organization_id,
      review_id: null,
      token: makeId("share").replaceAll("-", ""),
      scope: "executive-brief",
      filters: { windowDays: 30 },
      expires_at: expiresAt.toISOString(),
      created_by: profile.id,
    })
    .select()
    .single();

  if (error) throw error;

  return {
    id: data.id,
    token: data.token,
    reviewId: data.review_id,
    scope: data.scope,
    filters: data.filters || {},
    createdAt: data.created_at,
    expiresAt: data.expires_at,
    revokedAt: data.revoked_at,
  };
}

export async function revokeRemoteShareLink(supabase, linkId) {
  const { error } = await supabase
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId);

  if (error) throw error;
}
