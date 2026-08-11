import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

/**
 * TEMPORARY diagnostic endpoint. Reports whether the Apps Script secrets are
 * configured, without exposing their full values. Not linked from any page.
 */
export const Route = createFileRoute("/api/public/debug-apps-script")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.SEED_OWNER_TOKEN;
        const provided = new URL(request.url).searchParams.get("token") ?? "";
        if (!expected) {
          return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
        }

        const url = process.env.GOOGLE_APPS_SCRIPT_URL;
        const secret = process.env.GOOGLE_APPS_SCRIPT_SECRET;

        return Response.json({
          urlConfigured: Boolean(url),
          urlLast25Chars: url ? url.slice(-25) : null,
          secretConfigured: Boolean(secret),
          secretLength: secret ? secret.length : null,
        });
      },
    },
  },
});
