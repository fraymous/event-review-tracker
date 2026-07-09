# Deployment Checklist

Use this when moving the review tracker from local demo mode to hosted V1.

## 0. Data Safety

Production data lives in Supabase, so code deployments should not erase reviews. Before every production deploy, schema change, Supabase reconnect, or integration change:

1. Run `npm run data:backup`.
2. Confirm the backup JSON was written under `backups/`.
3. Run `npm run data:check -- --expected-ref mwykznfkejoecyqkblhp`.
4. If reviews already exist, include a minimum count from the latest backup, for example `npm run data:check -- --expected-ref mwykznfkejoecyqkblhp --min-reviews 25`.
5. Run `npm run release:guard` before pushing or deploying when practical.
6. Do not remove, disconnect, reset, truncate, or replace a Supabase resource without a fresh backup and explicit approval.

The current production Supabase resource is `event-review-tracker-db`, project ref `mwykznfkejoecyqkblhp`. If production is intentionally moved to a different Supabase project, update the expected ref in this checklist and in local `EXPECTED_SUPABASE_PROJECT_REF`.

## 1. Supabase

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. For existing projects, run any files in `supabase/migrations`.
4. Confirm the private `review-attachments` bucket exists.
5. In Supabase Auth, add the Vercel app URL to allowed redirect URLs.

## 2. Environment Variables

Set these in Vercel project settings:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_ALLOW_SIGN_UP=true
```

Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.

## 3. First Manager

1. Deploy with `NEXT_PUBLIC_ALLOW_SIGN_UP=true`.
2. Create the first manager account from the app.
3. Complete workspace profile setup.
4. Invite leadership/director users from Sharing & Access.
5. Confirm `/api/health` shows `firstManagerSignup: false` after the profile exists.
6. Optional hardening: change `NEXT_PUBLIC_ALLOW_SIGN_UP=false` and redeploy so bootstrap sign-up is disabled at the environment level too.

## 4. Smoke Test

1. Visit `/api/health`.
2. Confirm `storageMode` is `supabase`.
3. Confirm `publicSharedLinks` and `managerInvites` are `true`.
4. Confirm `consumptionStorage` is `true` after running the consumption migration.
5. Confirm `firstManagerSignup` is `false` after the first manager profile exists.
6. Create one review with culinary notes, optional consumption counts, and follow-up notes.
7. Confirm the dashboard and archive call out reviews that need follow-up.
8. Upload one attachment.
9. Create an executive brief share link and open it in a private browser.
10. Create a single-review share link and open it in a private browser.
11. Create a filtered report link with a date range and open it in a private browser.
12. Sign in as a leadership user and confirm read-only access.
