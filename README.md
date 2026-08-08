# Ai Tasks Solutions

A white-label, Arabic-first (RTL) internal task-management platform built for managers who need a lightweight, permission-aware system to assign, track, and archive their team's work.

Built on Lovable, backed by Supabase, with archiving to Google Sheets and file/email handling via a Google Apps Script Web App.

## Roles

- **Owner**: read-only — dashboard + archive visibility, zero action buttons
- **Admin**: full control — create/close tasks, manage employees, reset passwords
- **Employee**: sees only assigned tasks, can chat/attach/update own status

## Tech Stack

- Frontend/backend: TanStack Start (React 19)
- Database/Auth/Realtime: Supabase, RLS enforced at DB level
- External archive: Google Sheets API (Service Account JWT via Web Crypto API)
- File storage + email: Google Apps Script Web App (shared-secret authenticated)
- Styling: Tailwind CSS + shadcn/ui, dark "Technicolor" animated theme
- Font: Tajawal

## Environment Secrets Required

- GOOGLE_SERVICE_ACCOUNT_JSON
- GOOGLE_SHEET_ID
- GOOGLE_APPS_SCRIPT_URL
- GOOGLE_APPS_SCRIPT_SECRET
- SEED_OWNER_TOKEN, SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD
- RESEND_API_KEY

## Setup for a New Client

1. Remix this project in Lovable
2. Configure all secrets above
3. Share the Google Sheet with the service account email; set the Apps Script Drive folder
4. Visit /api/public/seed-owner?token=... once to bootstrap the Owner account
5. Set company logo from in-app Settings

## Security Notes

- The seed-owner endpoint is self-disabling: it refuses to run if an Owner profile already exists, and compares tokens with a timing-safe check
- Never commit .env — use platform secrets only

## License

Proprietary — private client delivery template, not for redistribution.
