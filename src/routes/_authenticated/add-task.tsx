import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useMyProfile, useAllProfiles } from "@/lib/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AvatarCircle } from "@/components/avatar-circle";
import { sendTaskEmailGmail } from "@/lib/gmail-send.functions";
import { archiveMessageToSheet } from "@/lib/sheets-archive.functions";
import { formatArDateTime } from "@/lib/date-ar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/add-task")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
    const { data: p } = await supabase.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle();
    if (!p || p.role !== "admin") throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "إضافة مهمة — Ai Tasks Solutions" },
      { name: "description", content: "أنشئ مهمة جديدة، حدد الموظفين المسؤولين، وحدد الموعد النهائي في Ai Tasks Solutions." },
      { property: "og:title", content: "إضافة مهمة — Ai Tasks Solutions" },
      { property: "og:description", content: "أنشئ مهمة جديدة، حدد الموظفين المسؤولين، وحدد الموعد النهائي في Ai Tasks Solutions." },
      { property: "og:url", content: "https://ai-tasks-solutions.lovable.app/add-task" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AddTaskPage,
});

function AddTaskPage() {
  const navigate = useNavigate();
  const { data: me } = useMyProfile();
  const { data: profiles = [] } = useAllProfiles();
  const employees = profiles.filter((p) => p.is_active && (p.role === "employee" || p.role === "admin"));
  const sendEmail = useServerFn(sendTaskEmailGmail);
  const archiveToSheet = useServerFn(archiveMessageToSheet);
  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [deadline, setDeadline] = useState("");
  const [kind, setKind] = useState<"task" | "home">("task");
  const [hmDays, setHmDays] = useState(2);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const d = new Date();
    d.setDate(d.getDate() + (settings.default_deadline_days ?? 2));
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    setDeadline(d.toISOString().slice(0, 16));
  }, [settings]);

  function toggle(id: string) {
    setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function submit() {
    if (!title.trim()) return toast.error("العنوان مطلوب");
    if (!description.trim()) return toast.error("التفاصيل مطلوبة");
    if (kind === "task" && picked.size === 0) return toast.error("اختر موظفاً واحداً على الأقل");
    if (!deadline) return toast.error("Deadline مطلوب");
    if (!me) return;

    setSaving(true);
    const deadlineIso = new Date(deadline).toISOString();

    if (kind === "home") {
      const exp = new Date(); exp.setDate(exp.getDate() + hmDays);
      const { error: hmErr } = await supabase.from("home_messages").insert({
        title: title.trim(), content: description.trim(),
        created_by: me.id, expires_at: exp.toISOString(), is_active: true,
      });
      if (hmErr) { setSaving(false); toast.error("فشل الإنشاء"); return; }
      setSaving(false);
      qc.invalidateQueries({ queryKey: ["dashboard-tasks"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("تم النشر ✓");
      navigate({ to: "/dashboard" });
      return;
    }

    const { data: t, error } = await supabase.from("tasks")
      .insert({ title: title.trim(), description: description.trim(), deadline: deadlineIso, created_by: me.id, status: "new", is_active: true })
      .select("id").single();
    if (error || !t) { setSaving(false); toast.error("فشل الإنشاء"); return; }

    const ids = Array.from(picked);
    if (ids.length) {
      await supabase.from("task_assignments").insert(
        ids.map((uid) => ({ task_id: t.id, user_id: uid, completion_percentage: 0, employee_status: "new" as const })),
      );
    }

    // Fire-and-forget archive to Google Sheets — never blocks UX
    const assigneeNames = profiles.filter((p) => ids.includes(p.id)).map((p) => p.full_name).join("، ");
    archiveToSheet({
      data: {
        taskTitle: title.trim(),
        taskDetails: description.trim(),
        type: "مهمة جديدة",
        senderName: me.full_name,
        content: `الموعد النهائي: ${new Date(deadlineIso).toLocaleString("ar-EG")} | المسؤول: ${assigneeNames}`,
        whenText: formatArDateTime(new Date()),
      },
    }).catch(() => {});


    // Notifications + email
    await supabase.from("notifications").insert(
      ids.map((uid) => ({
        recipient_id: uid, task_id: t.id, type: "new_task" as const,
        message: `تم تكليفك بمهمة جديدة: ${title.trim()}`,
      })),
    );

    // Email via Apps Script — awaited so we can surface delivery failures
    try {
      const { data: rows, error: rpcErr } = await supabase.rpc("get_profile_emails");
      if (rpcErr) console.error("get_profile_emails error", rpcErr);
      const emailById = new Map<string, string>((rows ?? []).map((r: { id: string; email: string | null }) => [r.id, r.email ?? ""]));
      const assignees = profiles.filter((p) => ids.includes(p.id));
      const valid = assignees
        .map((p) => ({ email: emailById.get(p.id) ?? "", name: p.full_name }))
        .filter((e) => e.email);
      const missing = assignees.length - valid.length;
      const deadlineText = new Date(deadlineIso).toLocaleString("ar-EG");
      const results = await Promise.allSettled(
        valid.map((r) => sendEmail({ data: { to: r.email, name: r.name, taskTitle: title.trim(), deadlineText } })),
      );
      const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !(r.value as { ok: boolean }).ok)).length;
      if (missing > 0) toast.warning(`${missing} موظف بدون بريد إلكتروني`);
      if (failed > 0) toast.error(`فشل إرسال ${failed} بريد إلكتروني`);
      else if (valid.length > 0) toast.success(`تم إرسال ${valid.length} بريد إلكتروني ✓`);
    } catch (e) {
      console.error("email dispatch failed", e);
      toast.error("فشل إرسال البريد الإلكتروني");
    }

    setSaving(false);
    qc.invalidateQueries({ queryKey: ["dashboard-tasks"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    toast.success("تم إنشاء المهمة ✓");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold">إضافة مهمة جديدة</h1>
      <div className="glass rounded-2xl p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left column */}
        <div className="space-y-4">
          <div>
            <Label>عنوان المهمة</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1.5" maxLength={200} />
          </div>
          <div>
            <Label>تفاصيل المهمة</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1.5" rows={10} />
          </div>
        </div>
        {/* Right column */}
        <div className="space-y-4">
          {kind === "task" && (
            <div>
              <Label>منسوب إلى</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {employees.length === 0 && <p className="text-sm text-muted-foreground">لا يوجد موظفون. أضف موظفاً أولاً.</p>}
                {employees.map((e) => {
                  const sel = picked.has(e.id);
                  return (
                    <button key={e.id} type="button" onClick={() => toggle(e.id)}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full pl-3 pr-1 py-1 border-2 transition",
                        sel ? "border-primary bg-primary/10" : "border-transparent bg-accent hover:bg-accent/80",
                      )}>
                      <span className="text-sm">{e.full_name}</span>
                      <AvatarCircle name={e.full_name} color={e.color} avatarUrl={e.avatar_url} size={40} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <Label>Deadline</Label>
            <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1.5" dir="ltr" />
          </div>
          <div>
            <Label>نوع المهمة</Label>
            <div className="mt-2 flex gap-2 flex-wrap">
              <button type="button" onClick={() => setKind("task")}
                className={cn("px-4 h-10 rounded-lg border-2 text-sm transition active:scale-95", kind === "task" ? "border-primary bg-primary/10" : "border-transparent bg-accent hover:bg-accent/80")}>
                مهمة عادية
              </button>
              <button type="button" onClick={() => setKind("home")}
                className={cn("px-4 h-10 rounded-lg border-2 text-sm transition active:scale-95", kind === "home" ? "border-primary bg-primary/10" : "border-transparent bg-accent hover:bg-accent/80")}>
                Home Message — إعلان عام
              </button>
            </div>
            {kind === "home" && (
              <div className="mt-3">
                <Label>مدة الظهور (أيام)</Label>
                <Input type="number" min={1} max={7} value={hmDays} onChange={(e) => setHmDays(+e.target.value)}
                  className="mt-1.5 w-32" dir="ltr" />
              </div>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={submit} disabled={saving} className="bg-primary text-primary-foreground hover:opacity-90 active:scale-95">
              {saving ? "جاري الحفظ..." : "إنشاء المهمة"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
