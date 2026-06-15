# Deployment Checklist

Use this when moving the review tracker from local demo mode to hosted V1.

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
4. Confirm `firstManagerSignup` is `false` after the first manager profile exists.
5. Create one review with culinary notes, consumption counts, and follow-up notes.
6. Confirm the dashboard and archive call out reviews that need follow-up.
7. Upload one attachment.
8. Create an executive brief share link and open it in a private browser.
9. Create a single-review share link and open it in a private browser.
10. Create a filtered report link with a date range and open it in a private browser.
11. Sign in as a leadership user and confirm read-only access.
