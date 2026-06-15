import { seedReviews } from "./seed-data";

const REVIEW_KEY = "event-review-tracker.reviews.v1";
const SHARE_KEY = "event-review-tracker.share-links.v1";

export const consumptionGroups = [
  {
    title: "Soda",
    items: [
      { key: "coke", label: "Coke" },
      { key: "dietCoke", label: "Diet Coke" },
      { key: "sprite", label: "Sprite" },
    ],
  },
  {
    title: "Water",
    items: [
      { key: "sparklingWater", label: "Sparkling water" },
      { key: "stillWater", label: "Still water" },
    ],
  },
  {
    title: "Snacks",
    items: [
      { key: "trailMix", label: "Trail Mix" },
      { key: "chips", label: "Chips" },
    ],
  },
  {
    title: "Fruit",
    items: [
      { key: "oranges", label: "Oranges" },
      { key: "bananas", label: "Bananas" },
      { key: "apples", label: "Apples" },
      { key: "pears", label: "Pears" },
    ],
  },
];

export const consumptionItems = consumptionGroups.flatMap((group) => group.items);

export function emptyConsumption() {
  return Object.fromEntries(consumptionItems.map((item) => [item.key, ""]));
}

export function normalizeConsumption(consumption = {}) {
  return Object.fromEntries(
    consumptionItems.map((item) => {
      const value = consumption?.[item.key];
      if (value === "" || value === null || value === undefined) return [item.key, ""];
      const numeric = Number(value);
      return [item.key, Number.isFinite(numeric) && numeric >= 0 ? numeric : ""];
    })
  );
}

export function formatConsumptionSummary(consumption = {}) {
  const normalized = normalizeConsumption(consumption);
  const parts = consumptionItems
    .filter((item) => normalized[item.key] !== "")
    .map((item) => `${item.label}: ${normalized[item.key]}`);

  return parts.length ? parts.join(" | ") : "";
}

export function makeId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function loadReviews() {
  if (typeof window === "undefined") return seedReviews;

  try {
    const stored = window.localStorage.getItem(REVIEW_KEY);
    return stored ? JSON.parse(stored) : seedReviews;
  } catch {
    return seedReviews;
  }
}

export function saveReviews(reviews) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REVIEW_KEY, JSON.stringify(reviews));
}

export function loadShareLinks() {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(SHARE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveShareLinks(links) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SHARE_KEY, JSON.stringify(links));
}

export function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value) {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatFileSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isShareActive(link) {
  if (!link || link.revokedAt) return false;
  return new Date(link.expiresAt).getTime() > Date.now();
}

function localDateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function isActionableFollowUp(review) {
  return review?.followUpStatus === "Needs follow-up";
}

function visibleFollowUpStatus(status) {
  return status === "Needs follow-up" ? "Needs follow-up" : "Draft";
}

export function getReviewDueState(review) {
  if (!isActionableFollowUp(review)) return "inactive";
  if (!review?.followUpDueDate) return "unscheduled";
  if (review.followUpDueDate < localDateKey()) return "overdue";
  if (review.followUpDueDate === localDateKey()) return "today";
  return "upcoming";
}

export function getShareUrl(token) {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("share", token);
  return url.toString();
}

export function getSupabaseStatus() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return {
    configured: Boolean(url && key),
    label: url && key ? "Supabase configured" : "Local demo storage",
  };
}

export function buildCsv(reviews) {
  const headers = [
    "Event",
    "Date",
    "Client Contact",
    "Venue",
    "Type",
    "Manager",
    "Rating",
    "Needs Follow-up",
    "Follow-up Notes",
    "Event Summary",
    "Culinary Notes",
    "Consumption",
    "Operational Notes",
    "Client Feedback",
    "Wins",
    "Issues",
    "Attachment Count",
    "Created At",
    "Updated At",
  ];

  const rows = reviews.map((review) => [
    review.clientName,
    review.eventDate,
    review.clientContact,
    review.venue,
    review.eventType,
    review.managerName,
    review.overallRating ?? "",
    review.followUpStatus === "Needs follow-up" ? "Yes" : "No",
    review.followUpNotes,
    review.summary,
    review.culinaryNotes,
    formatConsumptionSummary(review.consumption),
    review.operationalNotes,
    review.clientFeedback,
    review.wins,
    review.issues,
    (review.attachments || []).length,
    review.createdAt,
    review.updatedAt,
  ]);

  return [headers, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");
}

export function applyReviewFilters(reviews, filters = {}) {
  const normalized = {
    query: "",
    status: "All",
    tag: "All",
    manager: "All",
    due: "All",
    dateFrom: "",
    dateTo: "",
    ...filters,
  };
  const term = String(normalized.query || "").trim().toLowerCase();

  return [...(reviews || [])]
    .filter((review) => {
      const searchText = [
        review.clientName,
        review.clientContact,
        review.venue,
        review.eventType,
        review.managerName,
        review.followUpNotes,
        review.summary,
        review.culinaryNotes,
        formatConsumptionSummary(review.consumption),
        review.operationalNotes,
        review.clientFeedback,
        review.wins,
        review.issues,
        (review.tags || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();

      const matchesTerm = !term || searchText.includes(term);
      const matchesStatus =
        normalized.status === "All" || visibleFollowUpStatus(review.followUpStatus) === normalized.status;
      const matchesTag = normalized.tag === "All" || (review.tags || []).includes(normalized.tag);
      const matchesManager =
        normalized.manager === "All" || review.managerName === normalized.manager;
      const dueState = getReviewDueState(review);
      const matchesDue =
        normalized.due === "All" ||
        (normalized.due === "Overdue" && dueState === "overdue") ||
        (normalized.due === "Due today" && dueState === "today") ||
        (normalized.due === "Upcoming" && dueState === "upcoming") ||
        (normalized.due === "No due date" && dueState === "unscheduled");
      const matchesDateFrom = !normalized.dateFrom || review.eventDate >= normalized.dateFrom;
      const matchesDateTo = !normalized.dateTo || review.eventDate <= normalized.dateTo;

      return matchesTerm && matchesStatus && matchesTag && matchesManager && matchesDue && matchesDateFrom && matchesDateTo;
    })
    .sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));
}
