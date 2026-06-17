# Event Review Tracker

A hosted-ready Next.js prototype for banquet and event review tracking.

## What is implemented

- Manager-focused review entry for one event at a time, including Save & New for back-to-back entry
- Executive/director read-only view toggle
- Dashboard with recent events, follow-up queue, attachment count, culinary notes queue, consumption count/activity, event volume, and review signals
- Executive Brief view for a printable 30-day leadership snapshot with attention items, culinary watchlist, consumption watchlist, and recent event notes
- Searchable event archive with follow-up, attachment, consumption, manager, date-range filters, sort controls, row-level file/consumption signals, current-view summary, resettable empty states, and full-note CSV export
- Event detail view with previous/next review navigation, client contact, food/culinary notes, optional consumption counts, operational notes, client feedback, wins, issues, follow-up notes, shared access, and attachments
- Manager quick actions for marking whether a review needs follow-up from the detail view and clearing open follow-ups from archive rows/cards
- Access directory for role-based manager and leadership visibility
- Revocable single-review, executive-brief, follow-up report, and filtered-report share links with manager-selected expiration, searchable status/scope filters, row-level report consumption signals, and visible copy/open fallbacks
- JSON backup and restore for local-demo data while the app is being used before hosted storage is connected
- Confirmation prompts for closing reviews, revoking links, and restoring demo data
- Print-friendly review view for PDF export
- Supabase schema for hosted auth, Postgres persistence, storage, roles, attachments, and share-link records

## Run locally

```powershell
npm install
npm run dev
```

Open the local URL printed by Next.js.

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Create `.env.local` from `.env.example`.
4. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. Add `SUPABASE_SERVICE_ROLE_KEY` as a server-only variable so public share links and manager invites can run.
6. Leave `NEXT_PUBLIC_ALLOW_SIGN_UP=true` for bootstrap. With `SUPABASE_SERVICE_ROLE_KEY` configured, the app automatically hides first-manager sign-up after a profile exists. You can still set it to `false` later for stricter lock-down.
7. Add the deployed app URL to Supabase Auth redirect URLs so invited users return to the review tracker after accepting an invite.

The current app runs with browser local storage when Supabase keys are missing. That makes the prototype easy to try immediately, but real multi-user leadership access needs Supabase connected.

For existing Supabase projects, run new files in `supabase/migrations` from the SQL editor before deploying the matching app changes.

Before Supabase is connected, use Sharing & Access > Data Backup to download a JSON safety copy of local reviews. Local demo share links only work in the same browser data store; use PDF or CSV exports for outside sharing until Vercel and Supabase are connected.

## V1 access model

- Managers create and edit reviews, upload private attachments, invite users, and create share links.
- Executives/directors can view all reviews in read-only mode.
- Follow-up is a simple yes/no flag in V1. When set to yes, managers add follow-up notes.
- Shared links expose one review, the executive brief, or a filtered report and can be revoked or expired.
- The Access Directory shows role-based users in the organization; public share links remain separate from account access.
- Signed-in users without a profile see access pending after bootstrap; they need a manager invite instead of creating a separate workspace.

## Scoring stance

V1 does not use service, setup, or timing sub-scores. Because managers are self-entering event reviews, the app keeps one required overall rating for quick event quality context, but dashboards avoid treating it as a standalone executive KPI. The useful management signals are the written review, culinary notes, client feedback, wins, issues, attachments, and whether follow-up is needed.

## Next production step

Deploy to Vercel, set the Supabase environment variables there, and run a hosted smoke test with one manager and one leadership user.

Use `DEPLOYMENT.md` for the hosted setup checklist.

## Supabase-backed mode added

When `.env.local` contains Supabase keys, the app switches from local demo storage to real Supabase mode:

- Sign in / sign up through Supabase Auth
- First signed-in user can create the initial manager workspace profile
- Managers can create, edit, share, and attach files to reviews
- Executives/directors can read all reviews when their `profiles.role` is set to `leadership`
- Attachments upload to the private `review-attachments` bucket
- Shared review links are read through `/api/shared-review/[token]` using `SUPABASE_SERVICE_ROLE_KEY`
- First-manager sign-up automatically closes after a profile exists when `SUPABASE_SERVICE_ROLE_KEY` is configured; set `NEXT_PUBLIC_ALLOW_SIGN_UP=false` later if you want the environment to block bootstrap sign-up entirely

For v1, managers can invite leadership users through the invite route once `SUPABASE_SERVICE_ROLE_KEY` is configured. Manual profile updates in Supabase are still available as a fallback.

## Deployment readiness check

After deploying or running locally, visit `/api/health`. It returns whether the app is running in local-demo mode or Supabase-backed mode, whether first-manager sign-up is currently available, whether public shared links and manager invites are ready, and whether consumption storage is migrated.

## Manager invites

With Supabase configured, managers can invite leadership or additional managers through the Sharing view or the server route `POST /api/admin/invite-user`. The request must include the signed-in manager's Supabase access token as `Authorization: Bearer <token>` and a JSON body with `email`, `fullName`, and `role` (`manager` or `leadership`).

This route uses `SUPABASE_SERVICE_ROLE_KEY`, so it only works after that environment variable is set on the server. `/api/health` reports `managerInvites: true` when the required environment variables are present.

## Report share links

Share links support three scopes: `single-review`, `executive-brief`, and `filtered-report`. Managers choose an expiration window before creating links. Brief links render the 30-day leadership snapshot. Filtered report links store the archive filters used when the link was created, including follow-up state, attachments, consumption, and date range, and render a read-only event list with summary metrics. The report view displays the saved filter summary so recipients know whether they are seeing all reviews or a specific archive slice, and each event row can open the full read-only review detail.
