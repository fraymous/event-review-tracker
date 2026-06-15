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
export const consumptionAppliesKey = "applies";

export function emptyConsumption(applies = false) {
  return {
    [consumptionAppliesKey]: Boolean(applies),
    ...Object.fromEntries(consumptionItems.map((item) => [item.key, ""])),
  };
}

export function hasConsumptionValues(consumption = {}) {
  return consumptionItems.some((item) => {
    const value = consumption?.[item.key];
    return value !== "" && value !== null && value !== undefined && Number(value) >= 0;
  });
}

export function getConsumptionApplies(consumption = {}) {
  return Boolean(consumption?.[consumptionAppliesKey]) || hasConsumptionValues(consumption);
}

export function normalizeConsumption(consumption = {}, applies = getConsumptionApplies(consumption)) {
  const normalizedItems = Object.fromEntries(
    consumptionItems.map((item) => {
      const value = consumption?.[item.key];
      if (value === "" || value === null || value === undefined) return [item.key, ""];
      const numeric = Number(value);
      return [item.key, Number.isFinite(numeric) && numeric >= 0 ? numeric : ""];
    })
  );

  return {
    [consumptionAppliesKey]: Boolean(applies) || hasConsumptionValues(normalizedItems),
    ...normalizedItems,
  };
}

export function formatConsumptionSummary(consumption = {}) {
  const normalized = normalizeConsumption(consumption);
  const parts = consumptionItems
    .filter((item) => normalized[item.key] !== "")
    .map((item) => `${item.label}: ${normalized[item.key]}`);

  if (!getConsumptionApplies(normalized)) return "";
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

function newestFirst(a, b) {
  return new Date(b.eventDate) - new Date(a.eventDate);
}

function oldestFirst(a, b) {
  return new Date(a.eventDate) - new Date(b.eventDate);
}

function ratingHighFirst(a, b) {
  const aRating = a.overallRating ? Number(a.overallRating) : -1;
  const bRating = b.overallRating ? Number(b.overallRating) : -1;
  return bRating - aRating || newestFirst(a, b);
}

function ratingLowFirst(a, b) {
  const aRating = a.overallRating ? Number(a.overallRating) : Number.POSITIVE_INFINITY;
  const bRating = b.overallRating ? Number(b.overallRating) : Number.POSITIVE_INFINITY;
  return aRating - bRating || newestFirst(a, b);
}

function followUpFirst(a, b) {
  const priority = { overdue: 0, today: 1, upcoming: 2, unscheduled: 3, inactive: 4 };
  const dueStateDifference = priority[getReviewDueState(a)] - priority[getReviewDueState(b)];
  if (dueStateDifference !== 0) return dueStateDifference;
  if (a.followUpDueDate && b.followUpDueDate && a.followUpDueDate !== b.followUpDueDate) {
    return a.followUpDueDate.localeCompare(b.followUpDueDate);
  }
  return newestFirst(a, b);
}

export function sortReviewList(reviews, sortMode = "Date newest") {
  const sorted = [...(reviews || [])];
  if (sortMode === "Date oldest") return sorted.sort(oldestFirst);
  if (sortMode === "Rating high") return sorted.sort(ratingHighFirst);
  if (sortMode === "Rating low") return sorted.sort(ratingLowFirst);
  if (sortMode === "Needs follow-up") return sorted.sort(followUpFirst);
  return sorted.sort(newestFirst);
}
