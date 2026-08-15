import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  taskTitle: z.string(),
  fileName: z.string(),
  displayName: z.string(),
  mimeType: z.string(),
  base64Data: z.string(),
});

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";

export const uploadDriveFileNative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const lovableKey = process.env['LOVABLE_API_KEY'];
    const driveKey = process.env['GOOGLE_DRIVE_API_KEY'];
    if (!lovableKey || !driveKey) {
      console.error("[drive-native] missing credentials", {
        hasLovableKey: Boolean(lovableKey),
        hasGoogleDriveKey: Boolean(driveKey),
      });
      return { ok: false as const, error: "تكامل Google Drive غير مُفعّل. برجاء إعادة ربط Google Drive من الإعدادات." };
    }

    const authHeaders = {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": driveKey,
    };

    try {
      if (data.base64Data.length * 0.75 > 100 * 1024 * 1024) {
        return { ok: false as const, error: "الملف كبير جداً (الحد الأقصى 100 ميجابايت)." };
      }

      const { data: settings } = await context.supabase
        .from("app_settings")
        .select("company_name, drive_folder_id")
        .eq("id", 1)
        .single();
      const companyName =
        (settings as { company_name?: string } | null)?.company_name ?? "Ai Tasks Solutions";
      const cachedFolderId =
        (settings as { drive_folder_id?: string | null } | null)?.drive_folder_id ?? undefined;

      const dotIdx = data.fileName.lastIndexOf(".");
      const extension = dotIdx >= 0 ? data.fileName.slice(dotIdx) : "";
      const finalName = `${data.displayName}${extension}`;

      // Use the cached company folder when available — skips both extra round trips.
      let folderId: string | undefined = cachedFolderId || undefined;

      if (!folderId) {
        // Find or create the company folder (only folders this app created are visible with drive.file scope).
        const q = encodeURIComponent(
          `mimeType='application/vnd.google-apps.folder' and name='${companyName.replace(/'/g, "\\'")}' and trashed=false`,
        );
        const listRes = await fetch(`${GATEWAY}/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`, {
          headers: authHeaders,
        });
        if (listRes.ok) {
          const listJson = (await listRes.json()) as { files?: Array<{ id: string }> };
          folderId = listJson.files?.[0]?.id;
        } else {
          console.error("[drive-native] folder list failed", listRes.status, (await listRes.text()).slice(0, 500));
        }

        if (!folderId) {
          const createRes = await fetch(`${GATEWAY}/drive/v3/files?fields=id`, {
            method: "POST",
            headers: { ...authHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ name: companyName, mimeType: "application/vnd.google-apps.folder" }),
          });
          if (createRes.ok) {
            folderId = ((await createRes.json()) as { id?: string }).id;
          } else {
            console.error("[drive-native] folder create failed", createRes.status, (await createRes.text()).slice(0, 500));
          }
        }

        if (folderId) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { error: cacheErr } = await supabaseAdmin
              .from("app_settings")
              .update({ drive_folder_id: folderId })
              .eq("id", 1);
            if (cacheErr) {
              console.error("[drive-native] folder cache save failed", cacheErr.message);
            }
          } catch (e) {
            console.error("[drive-native] folder cache save error", (e as Error).message);
          }
        }
      }

      // Multipart upload
      const boundary = `lovable-${crypto.randomUUID()}`;
      const metadata = {
        name: finalName,
        description: data.taskTitle ? `Task: ${data.taskTitle}` : undefined,
        ...(folderId ? { parents: [folderId] } : {}),
      };
      const bytes = Uint8Array.from(atob(data.base64Data), (c) => c.charCodeAt(0));
      const enc = new TextEncoder();
      const head = enc.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: ${data.mimeType || "application/octet-stream"}\r\n\r\n`,
      );
      const tail = enc.encode(`\r\n--${boundary}--\r\n`);
      const body = new Uint8Array(head.length + bytes.length + tail.length);
      body.set(head, 0);
      body.set(bytes, head.length);
      body.set(tail, head.length + bytes.length);

      const uploadRes = await fetch(
        `${GATEWAY}/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`,
        {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": `multipart/related; boundary=${boundary}` },
          body,
        },
      );

      const text = await uploadRes.text();
      if (!uploadRes.ok) {
        console.error("[drive-native] upload failed", uploadRes.status, text.slice(0, 1000));
        if (uploadRes.status === 401 || uploadRes.status === 403) {
          return {
            ok: false as const,
            error: "لا توجد صلاحية للرفع على Google Drive. برجاء إعادة ربط حساب Google Drive.",
          };
        }
        if (uploadRes.status === 429) {
          return { ok: false as const, error: "تم تجاوز الحد المسموح من الرفع مؤقتاً. حاول بعد قليل." };
        }
        return { ok: false as const, error: `فشل رفع الملف إلى Google Drive (رمز ${uploadRes.status}).` };
      }

      let json: { id?: string; webViewLink?: string };
      try {
        json = JSON.parse(text);
      } catch {
        console.error("[drive-native] bad JSON", text.slice(0, 500));
        return { ok: false as const, error: "استجابة غير صالحة من Google Drive أثناء الرفع." };
      }
      if (!json.id) {
        return { ok: false as const, error: "لم يتم إنشاء الملف على Google Drive." };
      }

      // Make the file viewable by anyone with the link (best effort).
      try {
        const permRes = await fetch(`${GATEWAY}/drive/v3/files/${json.id}/permissions`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ role: "reader", type: "anyone" }),
        });
        if (!permRes.ok) {
          console.error("[drive-native] permission failed", permRes.status, (await permRes.text()).slice(0, 300));
        }
      } catch (e) {
        console.error("[drive-native] permission error", (e as Error).message);
      }

      const viewUrl = json.webViewLink ?? `https://drive.google.com/file/d/${json.id}/view`;
      return { ok: true as const, driveFileId: json.id, viewUrl };
    } catch (err) {
      const e = err as Error;
      console.error("[drive-native] exception", { name: e?.name, message: e?.message });
      return { ok: false as const, error: `تعذر رفع الملف: ${e?.message ?? "خطأ غير معروف"}` };
    }
  });
