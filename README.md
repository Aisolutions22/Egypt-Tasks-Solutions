# Ai Tasks Solutions

A white-label, Arabic-first (RTL) internal task-management platform built for managers who need a lightweight, permission-aware system to assign, track, and archive their team's work.

Built on Lovable, backed by Supabase, with file storage, email, and archiving handled through the native Google Drive, Gmail, and Google Sheets integrations.

## Roles

- **Owner**: read-only — dashboard + archive visibility, zero action buttons
- **Admin**: full control — create/close tasks, manage employees, reset passwords
- **Employee**: sees only assigned tasks, can chat/attach/update own status

## Tech Stack

- Frontend/backend: TanStack Start (React 19)
- Database/Auth/Realtime: Supabase, RLS enforced at DB level
- External archive: Google Sheets via the native connector
- File storage + email: Google Drive and Gmail via the native connectors
- Styling: Tailwind CSS + shadcn/ui, dark "Technicolor" animated theme
- Font: Tajawal

## Environment Secrets Required

- GOOGLE_SHEET_ID — the spreadsheet (ID or full URL) used as the archive
- SEED_OWNER_TOKEN, SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD — one-time Owner bootstrap

No Google Cloud Console project, Apps Script deployment, or service-account JSON is needed.

## Setup for a New Client

1. Remix this project in Lovable
2. Open Settings → Integrations and click **Connect** on Google Drive, Gmail, and Google Sheets
3. Set GOOGLE_SHEET_ID plus the SEED_OWNER_* secrets
4. Visit /api/public/seed-owner?token=... once to bootstrap the Owner account
5. Set company logo and company name from in-app Settings

## Security Notes

- The seed-owner endpoint is self-disabling: it refuses to run if an Owner profile already exists, and compares tokens with a timing-safe check
- Never commit .env — use platform secrets only

## License

Proprietary — private client delivery template, not for redistribution.
