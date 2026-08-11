import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  to: z.string().email(),
  name: z.string(),
  taskTitle: z.string(),
  deadlineText: z.string(),
});

export const sendTaskEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const url = process.env.GOOGLE_APPS_SCRIPT_URL;
    const secret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
    if (!url || !secret) {
      console.error("[apps-script-email] missing GOOGLE_APPS_SCRIPT_URL or GOOGLE_APPS_SCRIPT_SECRET");
      return { ok: false, error: "missing_secrets" };
    }

    const htmlBody = `<div dir="rtl" style="font-family:Tajawal,Arial,sans-serif">
      <h2>مرحباً ${data.name}،</h2>
      <p>تم تكليفك بمهمة جديدة: <strong>${data.taskTitle}</strong></p>
      <p>الموعد النهائي: ${data.deadlineText}</p>
      <p>يرجى الدخول لعرض التفاصيل.</p></div>`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          action: "sendEmail",
          to: data.to,
          subject: "مهمة جديدة بانتظارك",
          htmlBody,
        }),
        redirect: "follow",
      });
      const text = await res.text().catch(() => "");
      console.log(`[apps-script-email] to=${data.to} status=${res.status} body=${text.slice(0, 300)}`);

      // Don't trust the HTTP status alone — Google's login/permission pages
      // also return 200. Parse the body as JSON and check the `ok` field,
      // mirroring the validation already done in drive-upload.functions.ts.
      if (!res.ok) {
        return { ok: false, error: `apps-script http ${res.status}` };
      }

      let json: { ok?: boolean; error?: string };
      try {
        json = JSON.parse(text);
      } catch {
        console.error(`[apps-script-email] JSON parse failed to=${data.to} body=${text.slice(0, 300)}`);
        return { ok: false, error: "استجابة غير صالحة من خادم الإيميل" };
      }

      if (!json.ok) {
        console.error(`[apps-script-email] apps-script ok:false to=${data.to}`, json);
        return { ok: false, error: json.error || "فشل إرسال الإيميل" };
      }

      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[apps-script-email] fetch failed to=${data.to} err=${msg}`);
      return { ok: false, error: msg };
    }
  });
