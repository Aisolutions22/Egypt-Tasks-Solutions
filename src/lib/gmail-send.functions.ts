import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  to: z.string().email(),
  name: z.string(),
  taskTitle: z.string(),
  deadlineText: z.string(),
});

const GATEWAY = "https://connector-gateway.lovable.dev/google_mail";

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeHeader(value: string): string {
  // RFC 2047 encoded-word so Arabic subjects render correctly.
  return `=?UTF-8?B?${toBase64Url(value).replace(/-/g, "+").replace(/_/g, "/")}=?=`;
}

export const sendTaskEmailGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const mailKey = process.env["GOOGLE_MAIL_API_KEY"];
    if (!lovableKey || !mailKey) {
      console.error("[gmail-send] missing credentials", {
        hasLovableKey: Boolean(lovableKey),
        hasGoogleMailKey: Boolean(mailKey),
      });
      return {
        ok: false as const,
        error: "تكامل Gmail غير مُفعّل. برجاء ربط حساب Gmail من الإعدادات.",
      };
    }

    const htmlBody = `<div dir="rtl" style="font-family:Tajawal,Arial,sans-serif">
      <h2>مرحباً ${data.name}،</h2>
      <p>تم تكليفك بمهمة جديدة: <strong>${data.taskTitle}</strong></p>
      <p>الموعد النهائي: ${data.deadlineText}</p>
      <p>يرجى الدخول لعرض التفاصيل.</p></div>`;

    const mime = [
      `To: ${data.to}`,
      `Subject: ${encodeHeader("مهمة جديدة بانتظارك")}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      toBase64Url(htmlBody).replace(/-/g, "+").replace(/_/g, "/"),
    ].join("\r\n");

    try {
      const res = await fetch(`${GATEWAY}/gmail/v1/users/me/messages/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": mailKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: toBase64Url(mime) }),
      });

      const text = await res.text();
      if (!res.ok) {
        console.error(`[gmail-send] gateway failed to=${data.to} status=${res.status} body=${text.slice(0, 800)}`);
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false as const,
            error: "لا توجد صلاحية لإرسال البريد عبر Gmail. برجاء إعادة ربط حساب Gmail.",
          };
        }
        if (res.status === 429) {
          return { ok: false as const, error: "تم تجاوز حد الإرسال مؤقتاً. حاول بعد قليل." };
        }
        return { ok: false as const, error: `فشل إرسال البريد (رمز ${res.status}).` };
      }

      let json: { id?: string; error?: { message?: string } };
      try {
        json = JSON.parse(text);
      } catch {
        console.error(`[gmail-send] invalid JSON to=${data.to} body=${text.slice(0, 500)}`);
        return { ok: false as const, error: "استجابة غير صالحة من Gmail." };
      }
      if (!json.id) {
        console.error(`[gmail-send] no message id to=${data.to}`, json);
        return { ok: false as const, error: json.error?.message ?? "لم يتم إرسال البريد." };
      }

      console.log(`[gmail-send] sent to=${data.to} id=${json.id}`);
      return { ok: true as const, messageId: json.id };
    } catch (err) {
      const e = err as Error;
      console.error(`[gmail-send] exception to=${data.to} err=${e?.message}`);
      return { ok: false as const, error: `تعذر إرسال البريد: ${e?.message ?? "خطأ غير معروف"}` };
    }
  });
