import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  taskTitle: z.string(),
  taskDetails: z.string().optional().default(""),
  type: z.enum(["مهمة جديدة", "رسالة", "تم الإغلاق", "تم الإغلاق متأخراً"]),
  senderName: z.string(),
  content: z.string(),
  whenText: z.string(),
});

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlFromString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s));
}

export function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function getAccessToken(
  clientEmail: string,
  privateKeyPem: string,
  scope: string,
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: clientEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  };
  const signingInput = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(claims))}`;

  const der = pemToDer(privateKeyPem.replace(/\\n/g, "\n"));
  const derBuf = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    derBuf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64urlFromBytes(new Uint8Array(sigBuf))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets";

export const archiveMessageToSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const sheetsKey = process.env["GOOGLE_SHEETS_API_KEY"];
    const rawSheetId = process.env["GOOGLE_SHEET_ID"];

    if (!lovableKey || !sheetsKey) {
      console.error("[sheets-archive] missing credentials", {
        hasLovableKey: Boolean(lovableKey),
        hasGoogleSheetsKey: Boolean(sheetsKey),
      });
      return { ok: false as const, error: "تكامل Google Sheets غير مُفعّل. برجاء ربط Google Sheets من الإعدادات." };
    }
    if (!rawSheetId) {
      console.error("[sheets-archive] missing GOOGLE_SHEET_ID");
      return { ok: false as const, error: "لم يتم تحديد ملف الأرشيف (GOOGLE_SHEET_ID)." };
    }

    const urlMatch = rawSheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const sheetId = (urlMatch ? urlMatch[1] : rawSheetId).trim();

    try {
      const res = await fetch(
        `${GATEWAY}/v4/spreadsheets/${sheetId}/values/Sheet1!A:F:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            "X-Connection-Api-Key": sheetsKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            values: [[data.whenText, data.taskTitle, data.taskDetails, data.type, data.senderName, data.content]],
          }),
        },
      );

      const text = await res.text();
      if (!res.ok) {
        console.error(`[sheets-archive] append failed status=${res.status} body=${text.slice(0, 800)}`);
        if (res.status === 401 || res.status === 403) {
          return { ok: false as const, error: "لا توجد صلاحية للكتابة في Google Sheets. برجاء إعادة ربط الحساب." };
        }
        if (res.status === 404) {
          return { ok: false as const, error: "لم يتم العثور على ملف الأرشيف على Google Sheets." };
        }
        if (res.status === 429) {
          return { ok: false as const, error: "تم تجاوز الحد المسموح مؤقتاً. حاول بعد قليل." };
        }
        return { ok: false as const, error: `فشل الأرشفة في Google Sheets (رمز ${res.status}).` };
      }

      try {
        JSON.parse(text);
      } catch {
        console.error(`[sheets-archive] invalid JSON response body=${text.slice(0, 500)}`);
        return { ok: false as const, error: "استجابة غير صالحة من Google Sheets." };
      }

      return { ok: true as const };
    } catch (err) {
      const e = err as Error;
      console.error("[sheets-archive] exception", { name: e?.name, message: e?.message });
      return { ok: false as const, error: `تعذر الأرشفة: ${e?.message ?? "خطأ غير معروف"}` };
    }
  });

