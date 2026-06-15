"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Filter,
  Image as ImageIcon,
  KeyRound,
  Link as LinkIcon,
  Lock,
  LogOut,
  Mail,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Utensils,
  X,
} from "lucide-react";

import { eventTypes, seedReviews } from "../lib/seed-data";
import {
  applyReviewFilters,
  buildCsv,
  formatDate,
  formatDateTime,
  formatFileSize,
  getReviewDueState,
  getShareUrl,
  getSupabaseStatus,
  isShareActive,
  loadReviews,
  loadShareLinks,
  makeId,
  saveReviews,
  saveShareLinks,
} from "../lib/review-store";
import {
  bootstrapManagerProfile,
  createRemoteBriefShareLink,
  createRemoteReportShareLink,
  createRemoteShareLink,
  deleteRemoteAttachments,
  fetchRemoteProfiles,
  fetchRemoteReviews,
  fetchRemoteShareLinks,
  getCurrentProfile,
  getCurrentSession,
  revokeRemoteShareLink,
  uploadRemoteAttachments,
  upsertRemoteReview,
} from "../lib/supabase-data";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";

const roleCopy = {
  manager: { label: "Manager", caption: "Create, edit, attach, share" },
  leadership: { label: "Executive / Director", caption: "Read-only archive and trends" },
};

const demoAccessUsers = [
  { id: "local-manager", fullName: "Michael Frazier", email: "manager@local.demo", role: "manager", createdAt: "2026-06-01T00:00:00.000Z" },
  { id: "local-leadership", fullName: "Executive / Director", email: "leadership@local.demo", role: "leadership", createdAt: "2026-06-01T00:00:00.000Z" },
];

const initialFilters = { query: "", status: "All", tag: "All", manager: "All", due: "All", dateFrom: "", dateTo: "" };
const followUpFilterOptions = ["All", "No", "Yes"];
const shareExpiryOptions = [7, 14, 30, 60, 90];
const backupType = "event-review-tracker-backup";

function blankReview(managerName = "Michael Frazier") {
  return {
    id: "",
    clientName: "",
    clientContact: "",
    eventDate: new Date().toISOString().slice(0, 10),
    venue: "",
    eventType: "Corporate",
    managerName,
    staffInvolved: [],
    overallRating: "",
    summary: "",
    culinaryNotes: "",
    operationalNotes: "",
    clientFeedback: "",
    wins: "",
    issues: "",
    tags: [],
    followUpStatus: "Draft",
    followUpOwner: "",
    followUpDueDate: "",
    followUpNotes: "",
    attachments: [],
    createdAt: "",
    updatedAt: "",
  };
}

function stripAttachmentForStorage(attachment) {
  const { file, isPendingUpload, ...rest } = attachment;
  return rest;
}

function normalizeReview(form, existing) {
  const now = new Date().toISOString();
  return {
    ...form,
    id: existing?.id || form.id || makeId("rev"),
    clientContact: String(form.clientContact || "").trim(),
    staffInvolved: Array.isArray(form.staffInvolved)
      ? form.staffInvolved
      : String(form.staffInvolved || "").split(",").map((item) => item.trim()).filter(Boolean),
    overallRating: form.overallRating === "" ? null : Number(form.overallRating),
    tags: Array.isArray(form.tags) ? form.tags : [],
    followUpStatus: form.followUpStatus === "Needs follow-up" ? "Needs follow-up" : "Draft",
    followUpOwner: "",
    followUpDueDate: "",
    followUpNotes: form.followUpStatus === "Needs follow-up" ? String(form.followUpNotes || "").trim() : "",
    attachments: Array.isArray(form.attachments) ? form.attachments.map(stripAttachmentForStorage) : [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

function safeBackupReviews(reviews) {
  return reviews.map((review) => ({
    ...review,
    attachments: Array.isArray(review.attachments) ? review.attachments.map(stripAttachmentForStorage) : [],
  }));
}

function ratingLabel(value) {
  return value ? `${value}/5` : "N/A";
}

function previewText(value, maxLength = 92) {
  const text = String(value || "").trim();
  if (!text) return "No notes entered.";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function followUpMeta(review) {
  return previewText(review?.followUpNotes, 80);
}

function localDateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function isActionableFollowUp(review) {
  return review?.followUpStatus === "Needs follow-up";
}

function isNeedsFollowUpStatus(status) {
  return status === "Needs follow-up";
}

function followUpFilterToStatus(value) {
  if (value === "Yes") return "Needs follow-up";
  if (value === "No") return "Draft";
  return "All";
}

function statusToFollowUpFilter(status) {
  if (status === "Needs follow-up") return "Yes";
  if (status === "All") return "All";
  return "No";
}

function followUpDisplay(status) {
  return isNeedsFollowUpStatus(status) ? "Yes" : "No";
}

function hasCulinarySignal(review) {
  return String(review?.culinaryNotes || "").trim() || (review?.tags || []).includes("culinary");
}

function getFollowUpDueState(review) {
  return getReviewDueState(review);
}

function followUpQueueText(review) {
  return previewText(review?.followUpNotes || review?.issues || review?.operationalNotes, 90);
}

function sortFollowUps(a, b) {
  const priority = { overdue: 0, today: 1, upcoming: 2, unscheduled: 3, inactive: 4 };
  const dueStateDifference = priority[getFollowUpDueState(a)] - priority[getFollowUpDueState(b)];
  if (dueStateDifference !== 0) return dueStateDifference;
  if (a.followUpDueDate && b.followUpDueDate && a.followUpDueDate !== b.followUpDueDate) {
    return a.followUpDueDate.localeCompare(b.followUpDueDate);
  }
  return new Date(b.eventDate) - new Date(a.eventDate);
}

function isWithinDays(review, days) {
  if (!review?.eventDate) return false;
  const today = new Date(`${localDateKey()}T00:00:00`);
  const eventDate = new Date(`${review.eventDate}T00:00:00`);
  const difference = today.getTime() - eventDate.getTime();
  return difference >= 0 && difference <= days * 24 * 60 * 60 * 1000;
}

function formatReportFilters(filters = {}) {
  const normalized = { ...initialFilters, ...filters };
  const parts = [];
  if (normalized.query) parts.push(`Search: "${normalized.query}"`);
  if (normalized.status !== "All") parts.push(`Needs follow-up: ${followUpDisplay(normalized.status)}`);
  if (normalized.tag !== "All") parts.push(`Tag: ${normalized.tag}`);
  if (normalized.manager !== "All") parts.push(`Manager: ${normalized.manager}`);
  if (normalized.due !== "All") parts.push(`Due: ${normalized.due}`);
  if (normalized.dateFrom) parts.push(`From: ${formatDate(normalized.dateFrom)}`);
  if (normalized.dateTo) parts.push(`To: ${formatDate(normalized.dateTo)}`);
  return parts.length ? parts.join(" | ") : "All reviews";
}

function getToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replaceAll("-", "");
  }
  return makeId("share").replaceAll("-", "");
}

function normalizeShareExpiryDays(value) {
  const days = Number(value);
  return shareExpiryOptions.includes(days) ? days : 30;
}

function getShareExpiryDate(days) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + normalizeShareExpiryDays(days));
  return expiresAt;
}

export default function Home() {
  const [hydrated, setHydrated] = useState(false);
  const [reviews, setReviews] = useState(seedReviews);
  const [shareLinks, setShareLinks] = useState([]);
  const [accessUsers, setAccessUsers] = useState(demoAccessUsers);
  const [role, setRole] = useState("manager");
  const [activeView, setActiveView] = useState("dashboard");
  const [selectedId, setSelectedId] = useState(seedReviews[0]?.id || "");
  const [editingReview, setEditingReview] = useState(null);
  const [filters, setFilters] = useState(initialFilters);
  const [shareExpiryDays, setShareExpiryDays] = useState(30);
  const [notice, setNotice] = useState("");
  const [errorNotice, setErrorNotice] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [shareToken, setShareToken] = useState("");
  const [lastShareUrl, setLastShareUrl] = useState("");
  const [supabaseClient, setSupabaseClient] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMode, setAuthMode] = useState("sign-in");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [setupForm, setSetupForm] = useState({ fullName: "", organizationName: "Live Oak" });
  const [remoteShared, setRemoteShared] = useState({ loading: false, link: null, review: null, report: null, brief: null, error: "" });
  const [healthStatus, setHealthStatus] = useState(null);
  const supabaseStatus = getSupabaseStatus();
  const remoteMode = Boolean(supabaseClient);
  const envAllowsSignUp = process.env.NEXT_PUBLIC_ALLOW_SIGN_UP !== "false";
  const allowSignUp = envAllowsSignUp && (!remoteMode || healthStatus?.features?.firstManagerSignup === true);
  const effectiveRole = remoteMode ? profile?.role || "manager" : role;

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    setSupabaseClient(client);
    if (!client) {
      setReviews(loadReviews());
      setShareLinks(loadShareLinks());
      setAccessUsers(demoAccessUsers);
    }
    const params = new URLSearchParams(window.location.search);
    setShareToken(params.get("share") || "");
    setHydrated(true);
    if (!client) return undefined;
    getCurrentSession(client).then((currentSession) => setSession(currentSession)).catch((error) => setErrorNotice(error.message));
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch("/api/health")
      .then((response) => response.json())
      .then((payload) => {
        if (!ignore) setHealthStatus(payload);
      })
      .catch(() => {
        if (!ignore) setHealthStatus({ ok: false });
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || remoteMode) return;
    saveReviews(reviews);
  }, [hydrated, remoteMode, reviews]);

  useEffect(() => {
    if (!hydrated || remoteMode) return;
    saveShareLinks(shareLinks);
  }, [hydrated, remoteMode, shareLinks]);

  useEffect(() => {
    if (!notice && !errorNotice) return undefined;
    const timer = window.setTimeout(() => {
      setNotice("");
      setErrorNotice("");
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [notice, errorNotice]);

  useEffect(() => {
    if (!allowSignUp && authMode === "sign-up") setAuthMode("sign-in");
  }, [allowSignUp, authMode]);

  useEffect(() => {
    if (!remoteMode || !supabaseClient) return;
    if (!session) {
      setProfile(null);
      setReviews([]);
      setShareLinks([]);
      setAccessUsers([]);
      setSelectedId("");
      return;
    }
    refreshRemoteData();
  }, [remoteMode, supabaseClient, session]);

  useEffect(() => {
    if (!shareToken || !remoteMode) return;
    setRemoteShared({ loading: true, link: null, review: null, report: null, brief: null, error: "" });
    fetch(`/api/shared-review/${shareToken}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Shared review unavailable.");
        return payload;
      })
      .then((payload) => setRemoteShared({ loading: false, link: payload.link, review: payload.review || null, report: payload.report || null, brief: payload.brief || null, error: "" }))
      .catch((error) => setRemoteShared({ loading: false, link: null, review: null, report: null, brief: null, error: error.message }));
  }, [remoteMode, shareToken]);

  async function refreshRemoteData(options = {}) {
    if (!supabaseClient) return;
    setRemoteLoading(true);
    setErrorNotice("");
    try {
      const currentProfile = await getCurrentProfile(supabaseClient);
      setProfile(currentProfile);
      if (!currentProfile) {
        setReviews([]);
        setShareLinks([]);
        setAccessUsers([]);
        return;
      }
      setRole(currentProfile.role === "leadership" ? "leadership" : "manager");
      const [remoteReviews, remoteLinks, remoteProfiles] = await Promise.all([
        fetchRemoteReviews(supabaseClient),
        fetchRemoteShareLinks(supabaseClient),
        fetchRemoteProfiles(supabaseClient),
      ]);
      setReviews(remoteReviews);
      setShareLinks(remoteLinks);
      setAccessUsers(remoteProfiles);
      setSelectedId(options.selectId || remoteReviews[0]?.id || "");
    } catch (error) {
      setErrorNotice(error.message);
    } finally {
      setRemoteLoading(false);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (!supabaseClient) return;
    setAuthLoading(true);
    setErrorNotice("");
    try {
      const isCreatingAccount = allowSignUp && authMode === "sign-up";
      const payload = { email: authForm.email.trim(), password: authForm.password };
      const result = isCreatingAccount ? await supabaseClient.auth.signUp(payload) : await supabaseClient.auth.signInWithPassword(payload);
      if (result.error) throw result.error;
      setNotice(isCreatingAccount ? "Account created. Check email confirmation if required." : "Signed in.");
    } catch (error) {
      setErrorNotice(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function submitProfileSetup(event) {
    event.preventDefault();
    if (!supabaseClient) return;
    setAuthLoading(true);
    setErrorNotice("");
    try {
      await bootstrapManagerProfile(supabaseClient, setupForm.fullName.trim(), setupForm.organizationName.trim());
      setNotice("Workspace profile created.");
      await refreshRemoteData();
    } catch (error) {
      setErrorNotice(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    setNotice("Signed out.");
  }

  const managers = useMemo(() => Array.from(new Set(reviews.map((review) => review.managerName))).sort(), [reviews]);

  const filteredReviews = useMemo(() => applyReviewFilters(reviews, filters), [filters, reviews]);

  const selectedReview = useMemo(() => reviews.find((review) => review.id === selectedId) || filteredReviews[0] || reviews[0], [filteredReviews, reviews, selectedId]);
  const stats = useMemo(() => getStats(reviews), [reviews]);
  const sharedLink = useMemo(() => shareToken ? shareLinks.find((link) => link.token === shareToken) : null, [shareLinks, shareToken]);
  const sharedReview = useMemo(() => {
    if (!sharedLink || !isShareActive(sharedLink)) return null;
    return reviews.find((review) => review.id === sharedLink.reviewId);
  }, [reviews, sharedLink]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function startNewReview() {
    if (effectiveRole !== "manager") return false;
    setEditingReview(blankReview(profile?.full_name || "Michael Frazier"));
    setActiveView("form");
  }

  function startEdit(review) {
    if (effectiveRole !== "manager") return false;
    setEditingReview(review);
    setActiveView("form");
  }

  async function saveReview(form) {
    const existing = reviews.find((review) => review.id === form.id);
    if (remoteMode && supabaseClient && profile) {
      if (effectiveRole !== "manager") return false;
      setRemoteLoading(true);
      setErrorNotice("");
      try {
        const normalized = normalizeReview(form, existing);
        const pendingAttachments = (form.attachments || []).filter((attachment) => attachment.file);
        const retainedIds = new Set((form.attachments || []).filter((attachment) => !attachment.file).map((attachment) => attachment.id));
        const removedAttachments = existing ? existing.attachments.filter((attachment) => !retainedIds.has(attachment.id)) : [];
        const saved = await upsertRemoteReview(supabaseClient, normalized, profile);
        await deleteRemoteAttachments(supabaseClient, removedAttachments);
        await uploadRemoteAttachments(supabaseClient, saved.id, pendingAttachments, profile);
        await refreshRemoteData({ selectId: saved.id });
        setEditingReview(null);
        setActiveView("detail");
        setNotice(existing ? "Review updated." : "Review created.");
      } catch (error) {
        setErrorNotice(error.message);
      } finally {
        setRemoteLoading(false);
      }
      return;
    }

    const normalized = normalizeReview(form, existing);
    setReviews((current) => existing ? current.map((review) => review.id === existing.id ? normalized : review) : [normalized, ...current]);
    setSelectedId(normalized.id);
    setEditingReview(null);
    setActiveView("detail");
    setNotice(existing ? "Review updated." : "Review created.");
  }

  async function updateReviewStatus(reviewId, followUpStatus) {
    if (effectiveRole !== "manager") return false;
    const review = reviews.find((item) => item.id === reviewId);
    if (!review) return;
    await saveReview({
      ...review,
      followUpStatus,
      followUpNotes: followUpStatus === "Needs follow-up" ? review.followUpNotes : "",
    });
  }

  async function createShareLink(review) {
    if (effectiveRole !== "manager") return false;
    if (remoteMode && supabaseClient && profile) {
      try {
        const link = await createRemoteShareLink(supabaseClient, review.id, profile, shareExpiryDays);
        setShareLinks((current) => [link, ...current]);
        await copyShareUrl(link.token, "Share link copied.");
      } catch (error) {
        setErrorNotice(error.message);
      }
      return;
    }

    const createdAt = new Date();
    const expiresAt = getShareExpiryDate(shareExpiryDays);
    const link = { id: makeId("link"), token: getToken(), reviewId: review.id, scope: "single-review", createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), revokedAt: null };
    setShareLinks((current) => [link, ...current]);
    await copyShareUrl(link.token, "Share link copied.");
  }


  async function createReportShareLink(reportFilters = filters) {
    if (effectiveRole !== "manager") return false;
    const sourceFilters = reportFilters?.currentTarget ? filters : reportFilters;
    const normalizedFilters = { ...initialFilters, ...sourceFilters };

    if (remoteMode && supabaseClient && profile) {
      try {
        const link = await createRemoteReportShareLink(supabaseClient, normalizedFilters, profile, shareExpiryDays);
        setShareLinks((current) => [link, ...current]);
        await copyShareUrl(link.token, "Report link copied.");
      } catch (error) {
        setErrorNotice(error.message);
      }
      return;
    }

    const createdAt = new Date();
    const expiresAt = getShareExpiryDate(shareExpiryDays);
    const link = {
      id: makeId("link"),
      token: getToken(),
      reviewId: null,
      scope: "filtered-report",
      filters: normalizedFilters,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    };
    setShareLinks((current) => [link, ...current]);
    await copyShareUrl(link.token, "Report link copied.");
  }

  async function createBriefShareLink() {
    if (effectiveRole !== "manager") return false;
    if (remoteMode && supabaseClient && profile) {
      try {
        const link = await createRemoteBriefShareLink(supabaseClient, profile, shareExpiryDays);
        setShareLinks((current) => [link, ...current]);
        await copyShareUrl(link.token, "Brief link copied.");
      } catch (error) {
        setErrorNotice(error.message);
      }
      return;
    }

    const createdAt = new Date();
    const expiresAt = getShareExpiryDate(shareExpiryDays);
    const link = {
      id: makeId("link"),
      token: getToken(),
      reviewId: null,
      scope: "executive-brief",
      filters: { windowDays: 30 },
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    };
    setShareLinks((current) => [link, ...current]);
    await copyShareUrl(link.token, "Brief link copied.");
  }

  async function revokeShareLink(linkId) {
    const link = shareLinks.find((item) => item.id === linkId);
    if (!link) return;
    if (remoteMode && supabaseClient) {
      try {
        await revokeRemoteShareLink(supabaseClient, linkId);
        setShareLinks((current) => current.map((item) => item.id === linkId ? { ...item, revokedAt: new Date().toISOString() } : item));
        setNotice("Share link revoked.");
      } catch (error) {
        setErrorNotice(error.message);
      }
      return;
    }
    setShareLinks((current) => current.map((item) => item.id === linkId ? { ...item, revokedAt: new Date().toISOString() } : item));
    setNotice("Share link revoked.");
  }

  function requestRevokeShareLink(linkId) {
    const link = shareLinks.find((item) => item.id === linkId);
    if (!link) return;
    const review = reviews.find((item) => item.id === link.reviewId);
    const name = link.scope === "executive-brief" ? "Executive Brief" : link.scope === "filtered-report" ? "Filtered Report" : review?.clientName || "shared review";
    setConfirmation({
      title: "Revoke share link?",
      message: `${name} will no longer open for anyone with this link.`,
      confirmLabel: "Revoke Link",
      tone: "danger",
      onConfirm: () => revokeShareLink(linkId),
    });
  }

  async function copyShareUrl(token, message = "Share link copied.") {
    const url = getShareUrl(token);
    setLastShareUrl(url);
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Clipboard permission can be unavailable in some browsers.
      }
    }
    setNotice(message);
  }

  function openShareUrl(token) {
    const url = getShareUrl(token);
    setLastShareUrl(url);
    window.open(url, "_blank", "noopener,noreferrer");
  }


  async function inviteUser(payload) {
    if (!remoteMode || !session?.access_token) {
      setNotice("Connect Supabase before sending invites.");
      return false;
    }
    if (effectiveRole !== "manager") return false;

    setRemoteLoading(true);
    setErrorNotice("");
    try {
      const response = await fetch("/api/admin/invite-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Invite failed.");
      setNotice(`Invite sent to ${result.user.email}.`);
      await refreshRemoteData({ selectId: selectedId });
      return true;
    } catch (error) {
      setErrorNotice(error.message);
      return false;
    } finally {
      setRemoteLoading(false);
    }
  }
  function exportCsv() {
    downloadFile(`event-reviews-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(filteredReviews), "text/csv");
  }

  function downloadFile(filename, contents, type) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportBackup() {
    const payload = {
      type: backupType,
      version: 1,
      exportedAt: new Date().toISOString(),
      storageMode: remoteMode ? "supabase" : "local-demo",
      reviews: safeBackupReviews(reviews),
      shareLinks,
    };
    downloadFile(
      `event-review-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
    setNotice("Backup downloaded.");
  }

  function normalizeBackupPayload(payload) {
    if (!payload || typeof payload !== "object") throw new Error("Backup file is not valid JSON.");
    if (payload.type && payload.type !== backupType) throw new Error("This is not an Event Review Tracker backup.");
    if (!Array.isArray(payload.reviews)) throw new Error("Backup file does not include reviews.");
    return {
      reviews: payload.reviews.filter((review) => review && typeof review === "object"),
      shareLinks: Array.isArray(payload.shareLinks) ? payload.shareLinks.filter((link) => link && typeof link === "object") : [],
    };
  }

  function restoreBackup(backup) {
    setReviews(backup.reviews);
    setShareLinks(backup.shareLinks);
    setSelectedId(backup.reviews[0]?.id || "");
    setFilters(initialFilters);
    setActiveView("dashboard");
    setNotice(`Backup restored with ${backup.reviews.length} reviews.`);
  }

  function importBackupFile(file) {
    if (!file) return;
    if (remoteMode) {
      setNotice("Backup restore is only available in local demo mode.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const backup = normalizeBackupPayload(JSON.parse(String(reader.result || "{}")));
        setConfirmation({
          title: "Restore backup?",
          message: `This replaces local reviews and share links with ${backup.reviews.length} reviews from the backup file.`,
          confirmLabel: "Restore Backup",
          tone: "warning",
          onConfirm: () => restoreBackup(backup),
        });
      } catch (error) {
        setErrorNotice(error.message);
      }
    };
    reader.onerror = () => setErrorNotice("Backup file could not be read.");
    reader.readAsText(file);
  }

  function resetDemoData() {
    if (remoteMode) {
      setNotice("Demo reset is only available before Supabase is configured.");
      return;
    }
    setReviews(seedReviews);
    setShareLinks([]);
    setSelectedId(seedReviews[0]?.id || "");
    setNotice("Demo data restored.");
  }

  function requestResetDemoData() {
    setConfirmation({
      title: "Restore demo data?",
      message: "This replaces local demo reviews and removes local demo share links.",
      confirmLabel: "Restore Demo Data",
      tone: "danger",
      onConfirm: resetDemoData,
    });
  }

  async function confirmSelectedAction() {
    const action = confirmation?.onConfirm;
    setConfirmation(null);
    if (action) await action();
  }

  if (shareToken) {
    const link = remoteMode ? remoteShared.link : sharedLink;
    const review = remoteMode ? remoteShared.review : sharedReview;
    const report = remoteMode
      ? remoteShared.report
      : sharedLink?.scope === "filtered-report"
        ? {
            filters: sharedLink.filters || initialFilters,
            reviews: applyReviewFilters(reviews, sharedLink.filters || initialFilters),
          }
        : null;
    const brief = remoteMode
      ? remoteShared.brief
      : sharedLink?.scope === "executive-brief"
        ? { reviews, windowDays: 30 }
        : null;
    return (
      <SharedReviewView
        error={remoteMode ? remoteShared.error : ""}
        brief={brief}
        link={link}
        loading={remoteMode ? remoteShared.loading : false}
        report={report}
        review={review}
        onPrint={() => window.print()}
        onExit={() => {
          window.history.replaceState({}, "", window.location.pathname);
          setShareToken("");
        }}
      />
    );
  }

  if (remoteMode && !session) {
    return (
      <AuthShell
        allowSignUp={allowSignUp}
        authForm={authForm}
        authLoading={authLoading}
        authMode={authMode}
        errorNotice={errorNotice}
        notice={notice}
        onAuthForm={setAuthForm}
        onAuthMode={setAuthMode}
        onSubmit={submitAuth}
      />
    );
  }

  if (remoteMode && session && !profile && !remoteLoading) {
    return (
      <SetupShell
        errorNotice={errorNotice}
        form={setupForm}
        loading={authLoading}
        notice={notice}
        onForm={setSetupForm}
        onSignOut={signOut}
        onSubmit={submitProfileSetup}
      />
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark"><ClipboardList size={22} /></div>
          <div><p className="eyebrow">Live Oak</p><h1>Event Reviews</h1></div>
        </div>

        <nav className="nav-stack" aria-label="Main navigation">
          <NavButton active={activeView === "dashboard"} icon={<BarChart3 size={18} />} label="Dashboard" onClick={() => setActiveView("dashboard")} />
          <NavButton active={activeView === "brief"} icon={<FileText size={18} />} label="Brief" onClick={() => setActiveView("brief")} />
          <NavButton active={activeView === "archive"} icon={<Archive size={18} />} label="Archive" onClick={() => setActiveView("archive")} />
          <NavButton active={activeView === "detail"} icon={<Eye size={18} />} label="Review Detail" onClick={() => setActiveView("detail")} />
          <NavButton active={activeView === "sharing"} icon={<Share2 size={18} />} label="Sharing" onClick={() => setActiveView("sharing")} />
        </nav>

        <div className="role-box">
          <p className="section-label">Access</p>
          {remoteMode ? (
            <div className="segmented"><button className="selected" type="button">{roleCopy[effectiveRole].label}</button></div>
          ) : (
            <div className="segmented">
              {Object.entries(roleCopy).map(([key, item]) => <button key={key} className={role === key ? "selected" : ""} onClick={() => setRole(key)} type="button">{item.label}</button>)}
            </div>
          )}
          <p className="small-muted">{roleCopy[effectiveRole].caption}</p>
          {remoteMode && profile && <p className="small-muted">{profile.full_name}</p>}
        </div>

        <div className="status-box"><Lock size={16} /><span>{remoteMode ? "Supabase connected" : supabaseStatus.label}</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{roleCopy[effectiveRole].label} view</p><h2>{viewTitle(activeView)}</h2></div>
          <div className="topbar-actions">
            {effectiveRole === "manager" && <button className="primary-button" onClick={startNewReview} type="button"><Plus size={18} />New Review</button>}
            <button className="icon-button" onClick={() => window.print()} title="Print" type="button"><Printer size={18} /></button>
            {remoteMode && <button className="icon-button" onClick={signOut} title="Sign out" type="button"><LogOut size={18} /></button>}
          </div>
        </header>

        {notice && <Notice tone="success" text={notice} />}
        {errorNotice && <Notice tone="error" text={errorNotice} />}
        {remoteLoading && <Notice tone="neutral" text="Syncing Supabase data..." />}
        <ConfirmDialog confirmation={confirmation} onCancel={() => setConfirmation(null)} onConfirm={confirmSelectedAction} />

        {activeView === "dashboard" && <Dashboard stats={stats} reviews={reviews} role={effectiveRole} onSelect={(review) => { setSelectedId(review.id); setActiveView("detail"); }} />}

        {activeView === "brief" && <ExecutiveBrief reviews={reviews} onSelect={(review) => { setSelectedId(review.id); setActiveView("detail"); }} />}

        {activeView === "archive" && (
          <ArchiveView
            filters={filters}
            filteredReviews={filteredReviews}
            managers={managers}
            role={effectiveRole}
            onCreateShare={createShareLink}
            onCreateReportShare={createReportShareLink}
            onEdit={startEdit}
            onExport={exportCsv}
            onFilter={updateFilter}
            onResetFilters={() => setFilters(initialFilters)}
            onSelect={(review) => { setSelectedId(review.id); setActiveView("detail"); }}
          />
        )}

        {activeView === "detail" && (
          <ReviewDetail
            review={selectedReview}
            role={effectiveRole}
            links={shareLinks.filter((link) => link.reviewId === selectedReview?.id)}
            onCreateShare={createShareLink}
            onCreateReportShare={createReportShareLink}
            onEdit={startEdit}
            onPrint={() => window.print()}
            onSetStatus={updateReviewStatus}
          />
        )}

        {activeView === "form" && effectiveRole === "manager" && (
          <ReviewForm
            review={editingReview || blankReview(profile?.full_name || "Michael Frazier")}
            onCancel={() => { setEditingReview(null); setActiveView(selectedReview ? "detail" : "dashboard"); }}
            onSave={saveReview}
          />
        )}

        {activeView === "sharing" && (
          <SharingView
            accessUsers={accessUsers}
            healthStatus={healthStatus}
            lastShareUrl={lastShareUrl}
            links={shareLinks}
            reviews={reviews}
            role={effectiveRole}
            remoteMode={remoteMode}
            onCopy={copyShareUrl}
            onCreateBriefShare={createBriefShareLink}
            onCreateShare={createShareLink}
            onCreateReportShare={() => createReportShareLink(initialFilters)}
            onExportBackup={exportBackup}
            onImportBackup={importBackupFile}
            onInvite={inviteUser}
            onOpen={openShareUrl}
            onReset={requestResetDemoData}
            onRevoke={requestRevokeShareLink}
            onShareExpiryDays={setShareExpiryDays}
            shareExpiryDays={shareExpiryDays}
            supabaseStatus={supabaseStatus}
          />
        )}
      </section>
    </main>
  );
}

function viewTitle(view) {
  if (view === "brief") return "Executive Brief";
  if (view === "archive") return "Event Archive";
  if (view === "detail") return "Review Detail";
  if (view === "sharing") return "Sharing & Access";
  if (view === "form") return "Event Review Entry";
  return "Leadership Dashboard";
}

function getStats(reviews) {
  const openFollowUps = reviews.filter(isActionableFollowUp).length;
  const attachmentCount = reviews.reduce((total, review) => total + (review.attachments || []).length, 0);
  const culinaryFlagCount = reviews.filter(hasCulinarySignal).length;
  const months = reviews.reduce((acc, review) => {
    const key = review.eventDate.slice(0, 7);
    if (!acc[key]) acc[key] = { label: key, count: 0, ratingCount: 0 };
    acc[key].count += 1;
    if (review.overallRating) {
      acc[key].ratingCount += 1;
    }
    return acc;
  }, {});
  return {
    total: reviews.length,
    openFollowUps,
    attachmentCount,
    culinaryFlagCount,
    monthlyTrend: Object.values(months).sort((a, b) => a.label.localeCompare(b.label)).slice(-6),
  };
}

function Notice({ text, tone }) {
  return <div className={`notice ${tone}`} role="status">{tone === "error" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}<span>{text}</span></div>;
}

function ConfirmDialog({ confirmation, onCancel, onConfirm }) {
  if (!confirmation) return null;
  const tone = confirmation.tone || "warning";
  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="confirm-title" aria-modal="true" className={`confirm-dialog ${tone}`} role="dialog">
        <button className="dialog-close" onClick={onCancel} title="Cancel" type="button"><X size={16} /></button>
        <div className="dialog-icon"><AlertTriangle size={20} /></div>
        <div><h3 id="confirm-title">{confirmation.title}</h3><p>{confirmation.message}</p></div>
        <div className="dialog-actions"><button className="secondary-button" onClick={onCancel} type="button">Cancel</button><button className={`primary-button ${tone === "danger" ? "danger" : ""}`} onClick={onConfirm} type="button">{confirmation.confirmLabel}</button></div>
      </section>
    </div>
  );
}

function AuthShell({ allowSignUp, authForm, authLoading, authMode, errorNotice, notice, onAuthForm, onAuthMode, onSubmit }) {
  const isSignUp = allowSignUp && authMode === "sign-up";
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-block auth-brand"><div className="brand-mark"><ClipboardList size={22} /></div><div><p className="eyebrow">Live Oak</p><h1>Event Reviews</h1></div></div>
        <div><h2>{isSignUp ? "Create manager account" : "Sign in"}</h2><p>Managers enter reviews. Executives and directors view the archive in read-only mode.</p></div>
        {notice && <Notice tone="success" text={notice} />}
        {errorNotice && <Notice tone="error" text={errorNotice} />}
        <form className="auth-form" onSubmit={onSubmit}>
          <label className="field"><span>Email</span><div className="input-with-icon"><Mail size={18} /><input autoComplete="email" onChange={(event) => onAuthForm((current) => ({ ...current, email: event.target.value }))} required type="email" value={authForm.email} /></div></label>
          <label className="field"><span>Password</span><div className="input-with-icon"><KeyRound size={18} /><input autoComplete={isSignUp ? "new-password" : "current-password"} minLength={6} onChange={(event) => onAuthForm((current) => ({ ...current, password: event.target.value }))} required type="password" value={authForm.password} /></div></label>
          <button className="primary-button" disabled={authLoading} type="submit">{authLoading ? "Working..." : isSignUp ? "Create Account" : "Sign In"}</button>
        </form>
        {allowSignUp && <button className="text-button" onClick={() => onAuthMode(isSignUp ? "sign-in" : "sign-up")} type="button">{isSignUp ? "Use an existing account" : "Create the first manager account"}</button>}
      </section>
    </main>
  );
}

function SetupShell({ errorNotice, form, loading, notice, onForm, onSignOut, onSubmit }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-block auth-brand"><div className="brand-mark"><ClipboardList size={22} /></div><div><p className="eyebrow">Setup</p><h1>Workspace Profile</h1></div></div>
        <p>This creates the first manager profile for the organization. Leadership users can be added later by creating a profile with the leadership role.</p>
        {notice && <Notice tone="success" text={notice} />}
        {errorNotice && <Notice tone="error" text={errorNotice} />}
        <form className="auth-form" onSubmit={onSubmit}>
          <TextInput label="Your Name" onChange={(value) => onForm((current) => ({ ...current, fullName: value }))} required value={form.fullName} />
          <TextInput label="Organization" onChange={(value) => onForm((current) => ({ ...current, organizationName: value }))} required value={form.organizationName} />
          <button className="primary-button" disabled={loading} type="submit">{loading ? "Creating..." : "Create Workspace"}</button>
        </form>
        <button className="text-button" onClick={onSignOut} type="button">Sign out</button>
      </section>
    </main>
  );
}

function NavButton({ active, icon, label, onClick }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} type="button">{icon}<span>{label}</span></button>;
}

function Dashboard({ stats, reviews, role, onSelect }) {
  const recent = [...reviews].sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate)).slice(0, 5);
  const followUps = reviews.filter(isActionableFollowUp).sort(sortFollowUps).slice(0, 5);
  const culinaryReviews = reviews.filter(hasCulinarySignal).sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate)).slice(0, 5);
  const maxTrendCount = Math.max(1, ...stats.monthlyTrend.map((item) => item.count));
  return (
    <div className="view-grid">
      <section className="metric-grid"><MetricCard icon={<CalendarDays />} label="Events" value={stats.total} /><MetricCard icon={<ClipboardList />} label="Open follow-ups" value={stats.openFollowUps} /><MetricCard icon={<FileText />} label="Attachments" value={stats.attachmentCount} /><MetricCard icon={<Utensils />} label="Culinary notes" value={stats.culinaryFlagCount} /></section>
      <section className="content-band two-column">
        <div><div className="section-heading"><h3>Recent Reviews</h3><span>{role === "leadership" ? "Read-only" : "Manager entry"}</span></div><div className="review-list">{recent.map((review) => <button className="review-row" key={review.id} onClick={() => onSelect(review)} type="button"><div><strong>{review.clientName}</strong><span>{formatDate(review.eventDate)} - {review.venue}</span></div><StatusPill status={review.followUpStatus} /></button>)}{recent.length === 0 && <EmptyState title="No reviews yet" />}</div></div>
        <div><div className="section-heading"><h3>Review Signals</h3><span>Current view</span></div><div className="tag-counts"><div className="tag-count"><span>Rated reviews</span><strong>{reviews.filter((review) => review.overallRating).length}</strong></div><div className="tag-count"><span>Attachments</span><strong>{stats.attachmentCount}</strong></div><div className="tag-count"><span>Needs follow-up</span><strong>{stats.openFollowUps}</strong></div></div></div>
      </section>
      <section className="content-band two-column">
        <div><div className="section-heading"><h3>Follow-up Queue</h3><span>{followUps.length} shown</span></div><div className="review-list">{followUps.map((review) => <button className="review-row" key={review.id} onClick={() => onSelect(review)} type="button"><div><strong>{review.clientName}</strong><span>{followUpQueueText(review)}</span></div><div className="queue-pills"><StatusPill status={review.followUpStatus} /></div></button>)}{followUps.length === 0 && <p className="small-muted">No open follow-ups.</p>}</div></div>
        <div><div className="section-heading"><h3>Culinary Notes</h3><span>Entered notes</span></div><div className="review-list">{culinaryReviews.map((review) => <button className="review-row" key={review.id} onClick={() => onSelect(review)} type="button"><div><strong>{review.clientName}</strong><span>{previewText(review.culinaryNotes)}</span></div><StatusPill status={review.followUpStatus} /></button>)}{culinaryReviews.length === 0 && <p className="small-muted">No culinary notes entered.</p>}</div></div>
      </section>
      <section className="content-band"><div className="section-heading"><h3>Event Volume</h3><span>Rating required</span></div><div className="trend-grid">{stats.monthlyTrend.map((item) => <div className="trend-item" key={item.label}><span>{item.label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(8, (item.count / maxTrendCount) * 100)}%` }} /></div><strong>{item.count}</strong><em>{item.ratingCount ? `${item.ratingCount} rated` : "No rating"}</em></div>)}{stats.monthlyTrend.length === 0 && <p className="small-muted">Trend data appears after reviews are added.</p>}</div></section>
    </div>
  );
}

function ExecutiveBrief({ reviews, onSelect, showPrintButton = true }) {
  const last30 = reviews.filter((review) => isWithinDays(review, 30)).sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));
  const briefStats = getStats(last30);
  const attentionItems = reviews.filter(isActionableFollowUp).sort(sortFollowUps).slice(0, 4);
  const culinaryItems = last30.filter((review) => (review.tags || []).includes("culinary") || String(review.culinaryNotes || "").trim()).slice(0, 4);
  const recentNotes = last30.slice(0, 5);

  return (
    <div className="view-grid executive-brief">
      <section className="brief-hero">
        <div><p className="eyebrow">Last 30 days</p><h3>{briefStats.total} events reviewed</h3><span>{briefStats.openFollowUps} open follow-ups | {briefStats.attachmentCount} attachments | {briefStats.culinaryFlagCount} culinary notes</span></div>
        {showPrintButton && <button className="secondary-button" onClick={() => window.print()} type="button"><Printer size={16} />PDF</button>}
      </section>
      <section className="metric-grid"><MetricCard icon={<CalendarDays />} label="Recent events" value={briefStats.total} /><MetricCard icon={<ClipboardList />} label="Open follow-ups" value={briefStats.openFollowUps} /><MetricCard icon={<FileText />} label="Attachments" value={briefStats.attachmentCount} /><MetricCard icon={<Utensils />} label="Culinary notes" value={briefStats.culinaryFlagCount} /></section>
      <section className="content-band two-column">
        <div><div className="section-heading"><h3>Attention Items</h3><span>{attentionItems.length} active</span></div><div className="brief-list">{attentionItems.map((review) => <button className="brief-row" key={review.id} onClick={() => onSelect(review)} type="button"><div><strong>{review.clientName}</strong><span>{followUpMeta(review)}</span><p>{previewText(review.issues || review.operationalNotes)}</p></div><StatusPill status={review.followUpStatus} /></button>)}{attentionItems.length === 0 && <p className="small-muted">No open follow-ups.</p>}</div></div>
        <div><div className="section-heading"><h3>Culinary Watchlist</h3><span>{culinaryItems.length} noted</span></div><div className="brief-list">{culinaryItems.map((review) => <button className="brief-row" key={review.id} onClick={() => onSelect(review)} type="button"><div><strong>{review.clientName}</strong><span>{formatDate(review.eventDate)} | {review.venue}</span><p>{previewText(review.culinaryNotes)}</p></div><StatusPill status={review.followUpStatus} /></button>)}{culinaryItems.length === 0 && <p className="small-muted">No culinary notes in the last 30 days.</p>}</div></div>
      </section>
      <section className="content-band">
        <div className="section-heading"><h3>Recent Event Notes</h3><span>{recentNotes.length} shown</span></div>
        <div className="brief-note-grid">{recentNotes.map((review) => <button className="brief-note" key={review.id} onClick={() => onSelect(review)} type="button"><div><span>{formatDate(review.eventDate)}</span><strong>{review.clientName}</strong><em>{review.eventType} | {review.managerName}</em></div><p>{previewText(review.summary || review.wins, 140)}</p><small>{review.issues ? `Issue: ${previewText(review.issues, 110)}` : "No issue note entered."}</small></button>)}{recentNotes.length === 0 && <EmptyState title="No recent reviews" />}</div>
      </section>
    </div>
  );
}

function MetricCard({ icon, label, value }) {
  return <div className="metric-card"><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong></div>;
}

function ArchiveView({ filters, filteredReviews, managers, role, onCreateShare, onCreateReportShare, onEdit, onExport, onFilter, onResetFilters, onSelect }) {
  const archiveStats = getStats(filteredReviews);
  const filterSummary = formatReportFilters(filters);
  return (
    <div className="view-grid">
      <section className="filter-bar">
        <label className="search-box"><Search size={18} /><input aria-label="Search reviews" onChange={(event) => onFilter("query", event.target.value)} placeholder="Search client, contact, venue, notes" value={filters.query} /></label>
        <Select icon={<Filter size={16} />} label="Needs Follow-up" onChange={(value) => onFilter("status", followUpFilterToStatus(value))} options={followUpFilterOptions} value={statusToFollowUpFilter(filters.status)} />
        <Select icon={<Users size={16} />} label="Manager" onChange={(value) => onFilter("manager", value)} options={["All", ...managers]} value={filters.manager} />
        <DateFilter label="From" onChange={(value) => onFilter("dateFrom", value)} value={filters.dateFrom} />
        <DateFilter label="To" onChange={(value) => onFilter("dateTo", value)} value={filters.dateTo} />
        <button className="secondary-button" onClick={onResetFilters} type="button"><RotateCcw size={16} />Reset</button>
        <button className="secondary-button" onClick={onExport} type="button"><Download size={16} />CSV</button>
        {role === "manager" && <button className="secondary-button" onClick={() => onCreateReportShare()} type="button"><Share2 size={16} />Report</button>}
      </section>
      <section className="archive-summary"><div><p className="eyebrow">Current View</p><strong>{filterSummary}</strong></div><div className="archive-summary-metrics"><span>{archiveStats.total} matching</span><span>{archiveStats.openFollowUps} open</span><span>{archiveStats.attachmentCount} attachments</span><span>{archiveStats.culinaryFlagCount} culinary</span></div></section>
      <section className="content-band archive-results"><div className="table-wrap"><table className="archive-table"><thead><tr><th>Event</th><th>Date</th><th>Contact</th><th>Venue</th><th>Manager</th><th>Rating</th><th>Needs Follow-up</th><th>Follow-up Notes</th><th>Actions</th></tr></thead><tbody>{filteredReviews.map((review) => <tr key={review.id}><td><button className="link-button" onClick={() => onSelect(review)} type="button">{review.clientName}</button></td><td>{formatDate(review.eventDate)}</td><td>{review.clientContact || "N/A"}</td><td>{review.venue}</td><td>{review.managerName}</td><td>{ratingLabel(review.overallRating)}</td><td><StatusPill status={review.followUpStatus} /></td><td><FollowUpCell review={review} /></td><td><div className="row-actions"><button className="icon-button" onClick={() => onSelect(review)} title="View" type="button"><Eye size={16} /></button>{role === "manager" && <><button className="icon-button" onClick={() => onEdit(review)} title="Edit" type="button"><Pencil size={16} /></button><button className="icon-button" onClick={() => onCreateShare(review)} title="Share" type="button"><LinkIcon size={16} /></button></>}</div></td></tr>)}</tbody></table></div><MobileReviewList onCreateShare={onCreateShare} onEdit={onEdit} onSelect={onSelect} reviews={filteredReviews} role={role} />{filteredReviews.length === 0 && <EmptyState title="No matching reviews" />}</section>
    </div>
  );
}

function ReviewDetail({ review, role, links, onCreateShare, onEdit, onPrint, onSetStatus = () => {} }) {
  if (!review) {
    return (
      <section className="content-band unavailable">
        <ClipboardList size={28} />
        <h2>No review selected</h2>
        <p>Create a review or choose one from the archive.</p>
      </section>
    );
  }

  return (
    <div className="detail-layout">
      <section className="detail-header"><div><p className="eyebrow">{review.eventType}</p><h3>{review.clientName}</h3><div className="meta-line"><span><CalendarDays size={16} />{formatDate(review.eventDate)}</span><span><Building2 size={16} />{review.venue}</span><span><Users size={16} />{review.managerName}</span>{review.clientContact && <span><Mail size={16} />{review.clientContact}</span>}</div></div><div className="detail-actions"><StatusPill status={review.followUpStatus} /><button className="secondary-button" onClick={onPrint} type="button"><Printer size={16} />PDF</button>{role === "manager" && <><button className="secondary-button" onClick={() => onCreateShare(review)} type="button"><Share2 size={16} />Share</button><button className="primary-button" onClick={() => onEdit(review)} type="button"><Pencil size={16} />Edit</button></>}</div></section>
      <section className="detail-grid"><DetailBlock title="Event Summary" value={review.summary} /><DetailBlock title="Client Contact" value={review.clientContact} icon={<Mail />} /><DetailBlock title="Food / Culinary Notes" value={review.culinaryNotes} icon={<Utensils />} /><DetailBlock title="Operational Notes" value={review.operationalNotes} /><DetailBlock title="Client Feedback" value={review.clientFeedback} />{isActionableFollowUp(review) && <DetailBlock title="Follow-up Notes" value={review.followUpNotes} tone="warning" />}<DetailBlock title="Wins" value={review.wins} /><DetailBlock title="Issues" value={review.issues} tone="warning" /></section>
      <section className="content-band two-column"><div><div className="section-heading"><h3>Review Signals</h3><span>Rating {ratingLabel(review.overallRating)}</span></div><div className="people-list"><span>{isActionableFollowUp(review) ? "Needs follow-up" : "No follow-up needed"}</span><span>{hasCulinarySignal(review) ? "Culinary notes entered" : "No culinary note"}</span></div></div><AttachmentList attachments={review.attachments || []} /></section>
      <section className="content-band"><div className="section-heading"><h3>Shared Access</h3><span>{links.filter(isShareActive).length} active</span></div><div className="share-mini-list">{links.length === 0 && <p className="small-muted">No links created.</p>}{links.slice(0, 3).map((link) => <div className="share-mini" key={link.id}><span>{isShareActive(link) ? "Active" : "Inactive"}</span><em>Expires {formatDate(link.expiresAt.slice(0, 10))}</em></div>)}</div></section>
      {role === "manager" && <div className="sticky-actions status-actions">{review.followUpStatus !== "Needs follow-up" ? <button className="secondary-button" onClick={() => onEdit({ ...review, followUpStatus: "Needs follow-up" })} type="button"><AlertTriangle size={16} />Add Follow-up</button> : <button className="secondary-button" onClick={() => onSetStatus(review.id, "Draft")} type="button"><CheckCircle2 size={16} />No Follow-up</button>}</div>}
    </div>
  );
}

function ReviewForm({ review, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({ ...blankReview(), ...review }));
  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }
  function setNeedsFollowUp(value) {
    setForm((current) => ({
      ...current,
      followUpStatus: value === "Yes" ? "Needs follow-up" : "Draft",
      followUpNotes: value === "Yes" ? current.followUpNotes : "",
    }));
  }
  function addAttachments(files) {
    const mapped = Array.from(files || []).map((file) => ({ id: makeId("att"), name: file.name, type: file.type || "application/octet-stream", size: file.size, uploadedAt: new Date().toISOString(), isPendingUpload: true, file }));
    setForm((current) => ({ ...current, attachments: [...current.attachments, ...mapped] }));
  }
  function removeAttachment(id) { setForm((current) => ({ ...current, attachments: current.attachments.filter((attachment) => attachment.id !== id) })); }
  function submit(event) { event.preventDefault(); onSave(form); }
  const needsFollowUp = form.followUpStatus === "Needs follow-up";
  return (
    <form className="review-form" onSubmit={submit}>
      <section className="form-section"><div className="section-heading"><h3>Event</h3><span>{form.id ? "Edit" : "New"}</span></div><div className="form-grid"><TextInput label="Date" onChange={(value) => update("eventDate", value)} required type="date" value={form.eventDate} /><TextInput label="Event / Client" onChange={(value) => update("clientName", value)} required value={form.clientName} /><TextInput label="Client Contact" onChange={(value) => update("clientContact", value)} value={form.clientContact || ""} /><TextInput label="Venue / Location" onChange={(value) => update("venue", value)} required value={form.venue} /><SelectInput label="Event Type" onChange={(value) => update("eventType", value)} options={eventTypes} value={form.eventType} /><TextInput label="Manager" onChange={(value) => update("managerName", value)} required value={form.managerName} /></div></section>
      <section className="form-section"><div className="section-heading"><h3>Review</h3><span>Rating required</span></div><div className="form-grid"><SelectInput label="Overall Rating" onChange={(value) => update("overallRating", value)} options={["", "1", "2", "3", "4", "5"]} renderOption={(value) => (value ? `${value}/5` : "Select rating")} required value={String(form.overallRating ?? "")} /><SelectInput label="Needs Follow-up" onChange={setNeedsFollowUp} options={["No", "Yes"]} value={needsFollowUp ? "Yes" : "No"} /></div>{needsFollowUp && <TextArea label="Follow-up Notes" onChange={(value) => update("followUpNotes", value)} required value={form.followUpNotes || ""} />}<TextArea label="Event Summary" onChange={(value) => update("summary", value)} value={form.summary} /><TextArea label="Food / Culinary Notes" onChange={(value) => update("culinaryNotes", value)} value={form.culinaryNotes} /><TextArea label="Operational Notes" onChange={(value) => update("operationalNotes", value)} value={form.operationalNotes} /><TextArea label="Client Feedback" onChange={(value) => update("clientFeedback", value)} value={form.clientFeedback} /><div className="form-grid"><TextArea label="Wins" onChange={(value) => update("wins", value)} value={form.wins} /><TextArea label="Issues" onChange={(value) => update("issues", value)} value={form.issues} /></div></section>
      <section className="form-section"><div className="section-heading"><h3>Files</h3><span>{form.attachments.length} attachments</span></div><label className="upload-box"><Upload size={20} /><span>Attach PDFs or photos</span><input accept=".pdf,image/*" multiple onChange={(event) => addAttachments(event.target.files)} type="file" /></label><div className="attachment-editor">{form.attachments.map((attachment) => <div className="attachment-row" key={attachment.id}>{attachment.type.includes("pdf") ? <FileText size={18} /> : <ImageIcon size={18} />}<span>{attachment.name}</span><em>{formatFileSize(attachment.size)}{attachment.isPendingUpload ? " pending" : ""}</em><button type="button" onClick={() => removeAttachment(attachment.id)} title="Remove"><X size={16} /></button></div>)}</div></section>
      <div className="form-actions"><button className="secondary-button" onClick={onCancel} type="button"><X size={16} />Cancel</button><button className="primary-button" type="submit"><Save size={16} />Save Review</button></div>
    </form>
  );
}

function SharingView({ accessUsers, healthStatus, lastShareUrl, links, reviews, role, remoteMode, onCopy, onCreateBriefShare, onCreateShare, onCreateReportShare, onExportBackup, onImportBackup, onInvite, onOpen, onReset, onRevoke, onShareExpiryDays, shareExpiryDays, supabaseStatus }) {
  const activeLinks = links.filter(isShareActive);
  const invitesReady = Boolean(healthStatus?.features?.managerInvites);
  const inviteMetric = remoteMode ? (invitesReady ? "Ready" : "Setup") : "Local";
  const sharingNote = remoteMode
    ? "Managers create and edit. Executives and directors view all reviews in read-only mode. Shared links expose one review, the executive brief, or a filtered report and can be revoked."
    : "Local mode is ready for personal tracking. Use PDF or CSV for outside sharing until Supabase and Vercel are connected.";
  return (
    <div className="view-grid">
      <section className="metric-grid"><MetricCard icon={<ShieldCheck />} label="Active links" value={activeLinks.length} /><MetricCard icon={<Eye />} label="Role access" value="Read-only" /><MetricCard icon={<Mail />} label="Manager invites" value={inviteMetric} /><MetricCard icon={<Lock />} label="Storage" value={remoteMode || supabaseStatus.configured ? "Cloud" : "Local"} /></section>
      <section className="content-band"><div className="section-heading"><h3>Review Links</h3><span>Custom expiration</span></div><div className="share-list">{links.length === 0 && <EmptyState title="No share links yet" />}{links.map((link) => { const review = reviews.find((item) => item.id === link.reviewId); const isReport = link.scope === "filtered-report"; const isBrief = link.scope === "executive-brief"; const name = isBrief ? "Executive Brief" : isReport ? "Filtered Report" : review?.clientName || "Unknown review"; const description = isBrief ? "30-day leadership snapshot" : isReport ? formatReportFilters(link.filters) : "Single review public link"; const scopeClass = isBrief ? "brief" : isReport ? "report" : "review"; const scopeLabel = isBrief ? "Brief" : isReport ? "Report" : "Review"; return <div className="share-row" key={link.id}><div><strong>{name}</strong><span>{isShareActive(link) ? "Active" : "Inactive"} - Expires {formatDate(link.expiresAt.slice(0, 10))}</span><em>{description}</em></div><span className={`share-scope ${scopeClass}`}>{scopeLabel}</span><div className="row-actions"><button className="icon-button" onClick={() => onOpen(link.token)} title="Open" type="button"><ExternalLink size={16} /></button><button className="icon-button" onClick={() => onCopy(link.token)} title="Copy" type="button"><Copy size={16} /></button>{role === "manager" && !link.revokedAt && <button className="icon-button" onClick={() => onRevoke(link.id)} title="Revoke" type="button"><Trash2 size={16} /></button>}</div></div>; })}</div></section>
      {lastShareUrl && <section className="content-band"><div className="section-heading"><h3>Last Share URL</h3><span>Copy fallback</span></div><label className="share-url-box"><LinkIcon size={16} /><input onFocus={(event) => event.target.select()} readOnly value={lastShareUrl} /></label></section>}
      {role === "manager" && <section className="content-band"><div className="section-heading"><h3>Create Link</h3><span>Expires in {shareExpiryDays} days</span></div><div className="share-controls"><SelectInput label="Link Expires" onChange={(value) => onShareExpiryDays(normalizeShareExpiryDays(value))} options={shareExpiryOptions.map(String)} renderOption={(value) => `${value} days`} value={String(shareExpiryDays)} /></div><div className="quick-share-grid"><button className="quick-share" onClick={onCreateBriefShare} type="button"><span>Executive Brief</span><FileText size={16} /></button><button className="quick-share" onClick={onCreateReportShare} type="button"><span>All Reviews Report</span><Share2 size={16} /></button>{reviews.slice(0, 6).map((review) => <button className="quick-share" key={review.id} onClick={() => onCreateShare(review)} type="button"><span>{review.clientName}</span><LinkIcon size={16} /></button>)}</div></section>}
      <section className="content-band">
        <div className="section-heading"><h3>Data Backup</h3><span>{remoteMode ? "Cloud copy" : "Local safety copy"}</span></div>
        <div className="backup-actions">
          <button className="secondary-button" onClick={onExportBackup} type="button"><Download size={16} />Backup JSON</button>
          {!remoteMode && <label className="secondary-button file-button"><Upload size={16} />Restore JSON<input accept=".json,application/json" onChange={(event) => { onImportBackup(event.target.files?.[0]); event.target.value = ""; }} type="file" /></label>}
        </div>
      </section>
      <AccessDirectory users={accessUsers} />
      {role === "manager" && <InvitePanel healthStatus={healthStatus} remoteMode={remoteMode} onInvite={onInvite} />}
      <section className="content-band access-notes"><div><h3>V1 Access Model</h3><p>{sharingNote}</p></div><button className="secondary-button" onClick={onReset} type="button"><RotateCcw size={16} />{remoteMode ? "Demo Reset Off" : "Restore Demo Data"}</button></section>
    </div>
  );
}


function AccessDirectory({ users }) {
  return (
    <section className="content-band">
      <div className="section-heading"><h3>Access Directory</h3><span>{users.length} role users</span></div>
      <div className="access-directory">
        {users.length === 0 && <EmptyState title="No role users yet" />}
        {users.map((user) => (
          <div className="access-user" key={user.id}>
            <div><strong>{user.fullName || user.email || "Unnamed user"}</strong><span>{user.email || "Profile email pending"}</span></div>
            <span className={`role-pill ${user.role}`}>{roleCopy[user.role]?.label || user.role}</span>
          </div>
        ))}
      </div>
    </section>
  );
}


function InvitePanel({ healthStatus, remoteMode, onInvite }) {
  const [form, setForm] = useState({ email: "", fullName: "", role: "leadership" });
  const [sending, setSending] = useState(false);
  const invitesReady = Boolean(remoteMode && healthStatus?.features?.managerInvites);
  const statusLabel = !remoteMode ? "Local demo" : !healthStatus ? "Checking" : invitesReady ? "Ready" : "Needs service role";
  const statusText = !remoteMode
    ? "Invites become available after Supabase environment variables are added."
    : !healthStatus
      ? "Checking server invite configuration."
      : invitesReady
        ? "Managers can invite leadership users or additional managers."
        : "Add SUPABASE_SERVICE_ROLE_KEY on the server to enable invites.";

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!invitesReady || sending) return;
    setSending(true);
    try {
      const ok = await onInvite(form);
      if (ok) setForm({ email: "", fullName: "", role: "leadership" });
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="content-band">
      <div className="section-heading"><h3>Invite Access</h3><span>{statusLabel}</span></div>
      <div className="access-status"><ShieldCheck size={18} /><div><strong>{statusLabel}</strong><span>{statusText}</span></div></div>
      <form className="invite-form" onSubmit={submit}>
        <TextInput disabled={!invitesReady || sending} label="Email" onChange={(value) => update("email", value)} required type="email" value={form.email} />
        <TextInput disabled={!invitesReady || sending} label="Full Name" onChange={(value) => update("fullName", value)} value={form.fullName} />
        <SelectInput disabled={!invitesReady || sending} label="Role" onChange={(value) => update("role", value)} options={["leadership", "manager"]} renderOption={(value) => roleCopy[value]?.label || value} value={form.role} />
        <button className="primary-button" disabled={!invitesReady || sending} type="submit"><Mail size={16} />{sending ? "Sending..." : "Send Invite"}</button>
      </form>
    </section>
  );
}
function SharedReviewView({ brief, error, link, loading, report, review, onExit, onPrint }) {
  const isReport = link?.scope === "filtered-report";
  const isBrief = link?.scope === "executive-brief";
  const inactive = !loading && (!link || !isShareActive(link) || (!review && !report && !brief));
  const eyebrow = isBrief ? "Shared brief" : isReport ? "Shared report" : "Shared review";
  const title = isBrief ? "Executive Brief" : isReport ? "Event Review Report" : review?.clientName || "Unavailable";
  return (
    <main className="shared-shell">
      <header className="shared-topbar"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div><div className="topbar-actions"><button className="secondary-button" onClick={onPrint} type="button"><Printer size={16} />PDF</button><button className="secondary-button" onClick={onExit} type="button"><X size={16} />Exit</button></div></header>
      {loading ? <section className="content-band unavailable"><ClipboardList size={28} /><h2>Loading link</h2></section> : inactive ? <section className="content-band unavailable"><AlertTriangle size={28} /><h2>Link unavailable</h2><p>{error || "This link is expired, revoked, or not present in this review store."}</p></section> : isBrief ? <SharedBriefView brief={brief} onPrint={onPrint} /> : isReport ? <SharedReportView link={link} report={report} onPrint={onPrint} /> : <ReviewDetail links={[link]} onCreateShare={() => {}} onEdit={() => {}} onPrint={onPrint} review={review} role="leadership" />}
    </main>
  );
}


function SharedBriefView({ brief, onPrint }) {
  const [selectedReview, setSelectedReview] = useState(null);
  if (selectedReview) {
    return (
      <div className="view-grid">
        <div className="sticky-actions shared-brief-actions"><button className="secondary-button" onClick={() => setSelectedReview(null)} type="button"><FileText size={16} />Back to Brief</button></div>
        <ReviewDetail links={[]} onCreateShare={() => {}} onEdit={() => {}} onPrint={onPrint} review={selectedReview} role="leadership" />
      </div>
    );
  }

  return <ExecutiveBrief reviews={brief?.reviews || []} onSelect={setSelectedReview} showPrintButton={false} />;
}


function SharedReportView({ link, report, onPrint }) {
  const reviews = report?.reviews || [];
  const [selectedReview, setSelectedReview] = useState(null);
  const stats = getStats(reviews);
  if (selectedReview) {
    return (
      <div className="view-grid">
        <div className="sticky-actions shared-brief-actions"><button className="secondary-button" onClick={() => setSelectedReview(null)} type="button"><FileText size={16} />Back to Report</button></div>
        <ReviewDetail links={[]} onCreateShare={() => {}} onEdit={() => {}} onPrint={onPrint} review={selectedReview} role="leadership" />
      </div>
    );
  }

  return (
    <div className="view-grid">
      <section className="metric-grid"><MetricCard icon={<CalendarDays />} label="Events" value={stats.total} /><MetricCard icon={<ClipboardList />} label="Open follow-ups" value={stats.openFollowUps} /><MetricCard icon={<FileText />} label="Attachments" value={stats.attachmentCount} /><MetricCard icon={<Utensils />} label="Culinary notes" value={stats.culinaryFlagCount} /></section>
      <section className="content-band">
        <div className="section-heading"><h3>Shared Report</h3><span>Expires {formatDate(link.expiresAt.slice(0, 10))}</span></div>
        <div className="report-filter-summary"><Filter size={16} /><span>{formatReportFilters(report?.filters)}</span></div>
        <div className="table-wrap"><table className="archive-table"><thead><tr><th>Event</th><th>Date</th><th>Contact</th><th>Venue</th><th>Manager</th><th>Rating</th><th>Needs Follow-up</th><th>Follow-up Notes</th></tr></thead><tbody>{reviews.map((review) => <tr key={review.id}><td><button className="link-button" onClick={() => setSelectedReview(review)} type="button">{review.clientName}</button></td><td>{formatDate(review.eventDate)}</td><td>{review.clientContact || "N/A"}</td><td>{review.venue}</td><td>{review.managerName}</td><td>{ratingLabel(review.overallRating)}</td><td><StatusPill status={review.followUpStatus} /></td><td><FollowUpCell review={review} /></td></tr>)}</tbody></table></div>
        <MobileReviewList onSelect={setSelectedReview} reviews={reviews} role="leadership" />
        {reviews.length === 0 && <EmptyState title="No reviews in this report" />}
      </section>
      <div className="sticky-actions"><button className="secondary-button" onClick={onPrint} type="button"><Printer size={16} />PDF</button></div>
    </div>
  );
}

function MobileReviewList({ onCreateShare = () => {}, onEdit = () => {}, onSelect, reviews, role }) {
  return (
    <div className="mobile-review-list">
      {reviews.map((review) => (
        <article className="mobile-review-card" key={review.id}>
          <div className="mobile-review-card-header">
            <button className="link-button" onClick={() => onSelect(review)} type="button">{review.clientName}</button>
            <StatusPill status={review.followUpStatus} />
          </div>
          <div className="mobile-review-meta"><span>{formatDate(review.eventDate)}</span><span>{review.venue}</span><span>{review.managerName}</span></div>
          <div className="mobile-review-fields">
            <span><strong>Contact</strong>{review.clientContact || "N/A"}</span>
            <span><strong>Rating</strong>{ratingLabel(review.overallRating)}</span>
          </div>
          <p>{isActionableFollowUp(review) ? followUpMeta(review) : previewText(review.summary || review.wins, 120)}</p>
          <div className="row-actions"><button className="icon-button" onClick={() => onSelect(review)} title="View" type="button"><Eye size={16} /></button>{role === "manager" && <><button className="icon-button" onClick={() => onEdit(review)} title="Edit" type="button"><Pencil size={16} /></button><button className="icon-button" onClick={() => onCreateShare(review)} title="Share" type="button"><LinkIcon size={16} /></button></>}</div>
        </article>
      ))}
    </div>
  );
}

function DetailBlock({ icon, title, value, tone }) {
  return <article className={`detail-block ${tone || ""}`}><div className="detail-block-title">{icon}<h4>{title}</h4></div><p>{value || "N/A"}</p></article>;
}

function AttachmentList({ attachments }) {
  return (
    <div>
      <div className="section-heading"><h3>Attachments</h3><span>{attachments.length}</span></div>
      <div className="attachment-list">
        {attachments.length === 0 && <p className="small-muted">No attachments.</p>}
        {attachments.map((attachment) => <div className="attachment-row" key={attachment.id}>{attachment.type.includes("pdf") ? <FileText size={18} /> : <ImageIcon size={18} />}{attachment.downloadUrl ? <a href={attachment.downloadUrl} rel="noreferrer" target="_blank">{attachment.name}</a> : <span>{attachment.name}</span>}<em>{formatFileSize(attachment.size)}</em><small>{formatDateTime(attachment.uploadedAt)}</small></div>)}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const displayStatus = isNeedsFollowUpStatus(status) ? "Needs follow-up" : "No follow-up";
  const key = displayStatus.toLowerCase().replaceAll(" ", "-");
  return <span className={`status-pill ${key}`}>{displayStatus}</span>;
}

function FollowUpCell({ review }) {
  return <div className="follow-up-cell"><span>{isActionableFollowUp(review) ? followUpMeta(review) : "No"}</span></div>;
}

function EmptyState({ title }) {
  return <div className="empty-state"><ClipboardList size={28} /><strong>{title}</strong></div>;
}

function Select({ icon, label, options, value, onChange }) {
  return <label className="select-box">{icon}<span>{label}</span><select onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function DateFilter({ label, value, onChange }) {
  return <label className="date-box"><CalendarDays size={16} /><span>{label}</span><input onChange={(event) => onChange(event.target.value)} type="date" value={value} /></label>;
}

function TextInput({ disabled = false, label, onChange, required, type = "text", value }) {
  return <label className="field"><span>{label}</span><input disabled={disabled} onChange={(event) => onChange(event.target.value)} required={required} type={type} value={value} /></label>;
}

function SelectInput({ disabled = false, label, onChange, options, renderOption, required = false, value }) {
  return <label className="field"><span>{label}</span><select disabled={disabled} onChange={(event) => onChange(event.target.value)} required={required} value={value}>{options.map((option) => <option key={option || "blank"} value={option}>{renderOption ? renderOption(option) : option}</option>)}</select></label>;
}

function TextArea({ label, onChange, required = false, value }) {
  return <label className="field field-wide"><span>{label}</span><textarea onChange={(event) => onChange(event.target.value)} required={required} rows={4} value={value} /></label>;
}
