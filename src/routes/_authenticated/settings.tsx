import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useMyProfile, useAllProfiles, useProfileEmails } from "@/lib/use-profile";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ColorPicker } from "@/components/color-picker";
import { AvatarCircle } from "@/components/avatar-circle";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import Cropper, { type Area } from "react-easy-crop";
import { offboardColleague, resetColleaguePassword, backfillProfileEmails } from "@/lib/admin.functions";
import { uploadDriveFileNative } from "@/lib/drive-connector-upload.functions";

import { toast } from "sonner";
import { UserX, Moon, Sun, KeyRound, Camera } from "lucide-react";
import { useRef } from "react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Ai Tasks Solutions" },
      { name: "description", content: "إدارة ملفك الشخصي، الإعدادات العامة، وإدارة الموظفين في Ai Tasks Solutions." },
      { property: "og:title", content: "Settings — Ai Tasks Solutions" },
      { property: "og:description", content: "إدارة ملفك الشخصي، الإعدادات العامة، وإدارة الموظفين في Ai Tasks Solutions." },
      { property: "og:url", content: "https://egypt-ai-tasks.lovable.app/settings" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: me } = useMyProfile();
  const { data: profiles = [] } = useAllProfiles();
  const qc = useQueryClient();
  const offboard = useServerFn(offboardColleague);
  const resetPw = useServerFn(resetColleaguePassword);
  const backfillEmails = useServerFn(backfillProfileEmails);
  const uploadAvatarFile = useServerFn(uploadDriveFileNative);

  const isAdmin = me?.role === "admin" || me?.role === "owner";
  const isAdminOnly = me?.role === "admin";
  const { data: emailById } = useProfileEmails(isAdmin);

  useEffect(() => {
    if (isAdminOnly) {
      backfillEmails()
        .then(() => qc.invalidateQueries({ queryKey: ["profile-emails"] }))
        .catch(() => {});
    }
  }, [isAdminOnly]);

  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confPw, setConfPw] = useState("");
  const [dark, setDark] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedPixels(pixels);
  }, []);

  async function getCroppedBlob(src: string, area: Area): Promise<Blob> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("فشل تحميل الصورة"));
      i.src = src;
    });
    const TARGET = Math.min(400, Math.round(area.width));
    const canvas = document.createElement("canvas");
    canvas.width = TARGET;
    canvas.height = TARGET;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas غير متاح");
    ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, TARGET, TARGET);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("فشل ضغط الصورة"))), "image/jpeg", 0.85);
    });
  }

  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !me) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.onerror = () => toast.error("فشل قراءة الملف");
    reader.readAsDataURL(file);
  }

  async function saveCroppedAvatar() {
    if (!cropSrc || !croppedPixels || !me) return;
    setUploading(true);
    try {
      const blob = await getCroppedBlob(cropSrc, croppedPixels);
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const idx = result.indexOf(",");
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const res = await uploadAvatarFile({
        data: {
          taskTitle: "",
          fileName: "profile-photo.jpg",
          displayName: `${me.full_name} - Profile Photo`,
          mimeType: "image/jpeg",
          base64Data,
        },
      });
      if (!res.ok) {
        toast.error(res.error || "فشل رفع الصورة إلى Google Drive");
        return;
      }
      const url = `https://drive.google.com/thumbnail?id=${res.driveFileId}&sz=w400`;
      const { error: updErr } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", me.id);
      if (updErr) throw updErr;
      toast.success("تم تحديث الصورة");
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["profiles"] });
      setCropSrc(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "فشل رفع الصورة إلى Google Drive");
    } finally {
      setUploading(false);
    }
  }


  async function removeAvatar() {
    if (!me) return;
    const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", me.id);
    if (error) return toast.error(error.message);
    toast.success("تمت الإزالة");
    qc.invalidateQueries({ queryKey: ["my-profile"] });
    qc.invalidateQueries({ queryKey: ["profiles"] });
  }

  useEffect(() => {
    if (me) { setName(me.full_name); setColor(me.color); }
  }, [me?.id]);

  useEffect(() => {
    const v = typeof window !== "undefined" && localStorage.getItem("theme") === "dark";
    setDark(v);
    if (v) document.documentElement.classList.add("dark");
  }, []);

  function toggleDark() {
    const next = !dark; setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  const { data: settings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => (await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle()).data,
  });
  const [defaultDays, setDefaultDays] = useState(2);
  useEffect(() => { if (settings) setDefaultDays(settings.default_deadline_days); }, [settings?.default_deadline_days]);

  async function saveProfile() {
    if (!me || !color) return;
    if (color !== me.color && profiles.some((p) => p.color === color && p.id !== me.id)) {
      return toast.error("هذا اللون محجوز لموظف آخر");
    }
    const { error } = await supabase.from("profiles").update({ full_name: name.trim(), color }).eq("id", me.id);
    if (error) toast.error(error.message); else { toast.success("تم الحفظ ✓"); qc.invalidateQueries(); }
  }

  async function changePassword() {
    if (newPw.length < 8) return toast.error("٨ أحرف على الأقل");
    if (newPw !== confPw) return toast.error("التأكيد غير مطابق");
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) toast.error(error.message); else { toast.success("تم تغيير كلمة المرور"); setCurPw(""); setNewPw(""); setConfPw(""); }
  }

  async function saveSettings(days: number) {
    await supabase.from("app_settings").update({ default_deadline_days: days }).eq("id", 1);
    toast.success("تم الحفظ ✓");
    qc.invalidateQueries({ queryKey: ["app-settings"] });
  }

  async function offboardCol(id: string, full_name: string) {
    if (!confirm(`إقالة ${full_name}؟ سيُمنع من تسجيل الدخول لكن بياناته ومهامه ستبقى محفوظة.`)) return;
    try { await offboard({ data: { profile_id: id } }); toast.success("تمت الإقالة"); qc.invalidateQueries(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "خطأ"); }
  }

  async function resetColleaguePw(id: string, full_name: string) {
    const pw = prompt(`كلمة المرور الجديدة للموظف ${full_name} (8 أحرف على الأقل):`);
    if (!pw) return;
    if (pw.length < 8) return toast.error("٨ أحرف على الأقل");
    try {
      await resetPw({ data: { profile_id: id, password: pw } });
      toast.success(`تم تعيين كلمة مرور جديدة لـ ${full_name} بنجاح`);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "خطأ"); }
  }


  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="glass rounded-2xl p-5 space-y-4">
        <h2 className="font-bold">حسابي</h2>
        {me && (
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <AvatarCircle name={me.full_name} color={me.color} avatarUrl={me.avatar_url} size={96} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="absolute bottom-0 left-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md border-2 border-background disabled:opacity-50 cursor-pointer transition-transform duration-150 hover:scale-110 hover:bg-primary/90 active:scale-95"
                aria-label="تغيير الصورة"
              >
                <Camera className="h-4 w-4" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickAvatar}
              />
            </div>
            {me.avatar_url && (
              <button type="button" onClick={removeAvatar} className="text-xs text-muted-foreground hover:text-destructive underline">
                إزالة الصورة
              </button>
            )}
          </div>
        )}
        <div><Label>الاسم</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" /></div>
        <div>
          <Label>اللون</Label>
          <div className="mt-2"><ColorPicker value={color} onChange={setColor} takenColors={profiles.filter((p) => p.is_active).map((p) => p.color)} allowSelf={me?.color} /></div>
        </div>
        <div className="flex justify-end"><Button onClick={saveProfile} className="bg-primary text-primary-foreground">حفظ</Button></div>
      </section>

      {me?.role !== "owner" && (
        <section className="glass rounded-2xl p-5 space-y-4">
          <h2 className="font-bold">تغيير كلمة المرور</h2>
          <PasswordInput placeholder="الحالية (غير مطلوبة هنا)" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
          <PasswordInput placeholder="الجديدة" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <PasswordInput placeholder="تأكيد الجديدة" value={confPw} onChange={(e) => setConfPw(e.target.value)} />
          <div className="flex justify-end"><Button onClick={changePassword} variant="secondary">تغيير</Button></div>
        </section>
      )}

      <section className="glass rounded-2xl p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {dark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          <div>
            <div className="font-bold">المظهر</div>
            <div className="text-xs text-muted-foreground">{dark ? "وضع داكن" : "وضع فاتح"}</div>
          </div>
        </div>
        <Button onClick={toggleDark} variant="outline">{dark ? "تفعيل الفاتح" : "تفعيل الداكن"}</Button>
      </section>

      {isAdminOnly && (
        <section className="glass rounded-2xl p-5 space-y-4">
          <h2 className="font-bold">إعدادات النظام</h2>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <Label>Default Deadline Days</Label>
              <span className="font-bold">{defaultDays}</span>
            </div>
            <Slider min={1} max={7} step={1} value={[defaultDays]}
              onValueChange={(v) => setDefaultDays(v[0])}
              onValueCommit={(v) => saveSettings(v[0])} />
          </div>
        </section>
      )}

      {isAdminOnly && (
        <section className="glass rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">الموظفون</h2>
            <Button asChild size="sm" variant="secondary"><a href="/add-colleague">إضافة موظف</a></Button>
          </div>
          <div className="divide-y">
            {profiles.filter((p) => p.is_active).map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2">
                <AvatarCircle name={p.full_name} color={p.color} avatarUrl={p.avatar_url} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{p.full_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.role === "owner" ? "Owner" : p.role === "admin" ? "Admin" : "موظف"}
                  </div>
                  {isAdminOnly && emailById?.get(p.id) && (
                    <div dir="ltr" className="text-[11px] text-muted-foreground truncate text-left">{emailById.get(p.id)}</div>
                  )}
                </div>
                {isAdminOnly && p.role !== "owner" && (
                  <Button size="icon" variant="ghost" onClick={() => resetColleaguePw(p.id, p.full_name)} title="إعادة تعيين كلمة المرور">
                    <KeyRound className="h-4 w-4" />
                  </Button>
                )}
                {isAdminOnly && p.role !== "owner" && (
                  <Button size="icon" variant="ghost" onClick={() => offboardCol(p.id, p.full_name)} title="إقالة الزميل">
                    <UserX className="h-4 w-4 text-destructive" />
                  </Button>
                )}

              </div>
            ))}
          </div>
          {profiles.some((p) => !p.is_active) && (
            <details className="pt-2">
              <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">موظفون سابقون</summary>
              <div className="divide-y mt-2">
                {profiles.filter((p) => !p.is_active).map((p) => (
                  <div key={p.id} className="flex items-center gap-3 py-2 opacity-70">
                    <AvatarCircle name={p.full_name} color={p.color} avatarUrl={p.avatar_url} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{p.full_name}</div>
                      {isAdminOnly && emailById?.get(p.id) && (
                        <div dir="ltr" className="text-[11px] text-muted-foreground truncate text-left">{emailById.get(p.id)}</div>
                      )}
                    </div>
                    <span className="text-xs rounded-full bg-accent px-2 py-0.5">
                      {p.role === "admin" ? "Admin" : "موظف"}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      <Dialog open={!!cropSrc} onOpenChange={(o) => { if (!o && !uploading) setCropSrc(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>اقتصاص الصورة</DialogTitle>
          </DialogHeader>
          <div className="relative w-full h-72 bg-muted rounded-lg overflow-hidden">
            {cropSrc && (
              <Cropper
                image={cropSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            )}
          </div>
          <div>
            <Label className="text-xs">التكبير</Label>
            <Slider min={1} max={3} step={0.01} value={[zoom]} onValueChange={(v) => setZoom(v[0])} className="mt-2" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCropSrc(null)} disabled={uploading}>إلغاء</Button>
            <Button onClick={saveCroppedAvatar} disabled={uploading} className="bg-primary text-primary-foreground">حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
