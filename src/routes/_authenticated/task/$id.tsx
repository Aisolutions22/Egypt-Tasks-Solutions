import { createFileRoute, Link, useParams, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useMyProfile, useAllProfiles } from "@/lib/use-profile";
import { AvatarCircle } from "@/components/avatar-circle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STATUS_META, type TaskStatus } from "@/lib/status";
import { formatArDate, formatArDateTime } from "@/lib/date-ar";
import { ArrowRight, Check, Flag, Reply, X, Send, Paperclip, Link as LinkIcon, FileText, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { archiveMessageToSheet } from "@/lib/sheets-archive.functions";
import { uploadDriveFileNative } from "@/lib/drive-connector-upload.functions";

export const Route = createFileRoute("/_authenticated/task/$id")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
    const { data: p } = await supabase.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle();
    if (p?.role === "owner") throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "تفاصيل المهمة — Ai Tasks Solutions" },
      { name: "description", content: "اعرض تفاصيل المهمة، حالة الإنجاز، المحادثة بين الفريق، والمرفقات في Ai Tasks Solutions." },
      { property: "og:title", content: "تفاصيل المهمة — Ai Tasks Solutions" },
      { property: "og:description", content: "اعرض تفاصيل المهمة، حالة الإنجاز، المحادثة بين الفريق، والمرفقات في Ai Tasks Solutions." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TaskDetail,
});

type Msg = { id: string; task_id: string; sender_id: string; content: string; reply_to_id: string | null; created_at: string };
type Attachment = { id: string; task_id: string; uploaded_by: string; file_name: string; drive_file_id: string | null; drive_view_url: string | null; created_at: string };
type TimelineItem = { kind: "msg"; created_at: string; msg: Msg } | { kind: "att"; created_at: string; att: Attachment };

function TaskDetail() {
  const { id } = useParams({ from: "/_authenticated/task/$id" });
  const qc = useQueryClient();
  const { data: me } = useMyProfile();
  const { data: profiles = [] } = useAllProfiles();
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const isAdmin = me?.role === "admin";
  const isOwner = me?.role === "owner";


  const { data: task } = useQuery({
    queryKey: ["task", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, task_assignments(*)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["task-messages", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_messages")
        .select("*")
        .eq("task_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Msg[];
    },
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ["task-attachments", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_attachments")
        .select("*")
        .eq("task_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Attachment[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("tmsg-" + id)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_messages", filter: `task_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["task-messages", id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_attachments", filter: `task_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["task-attachments", id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [attachMode, setAttachMode] = useState<"file" | "link">("file");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [closingPulse, setClosingPulse] = useState(0);
  const [highlightAttId, setHighlightAttId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const archiveToSheet = useServerFn(archiveMessageToSheet);
  const uploadFile = useServerFn(uploadDriveFileNative);
  const myAssignment = task?.task_assignments?.find((a: { user_id: string }) => a.user_id === me?.id);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const timeline = useMemo(() => {
    return ([
      ...messages.map((m) => ({ kind: "msg" as const, created_at: m.created_at, msg: m })),
      ...attachments.map((a) => ({ kind: "att" as const, created_at: a.created_at, att: a })),
    ] as TimelineItem[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [messages, attachments]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timeline.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);

  if (!task) return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <Skeleton className="h-16 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );

  const s = STATUS_META[task.status as TaskStatus];
  const closed = task.status === "closed";

  async function send() {
    if (!content.trim() || !me) return;
    const { error } = await supabase.from("task_messages").insert({
      task_id: id, sender_id: me.id, content: content.trim(), reply_to_id: replyTo?.id ?? null,
    });
    if (error) { toast.error("تعذر الإرسال"); return; }
    qc.invalidateQueries({ queryKey: ["task-messages", id] });
    // Fire-and-forget archive to Google Sheets — never blocks UX
    const messageText = content.trim();
    const archiveContent = replyTo
      ? `رد على "${replyTo.content.slice(0, 60)}": ${messageText}`
      : messageText;
    archiveToSheet({
      data: {
        taskTitle: task?.title ?? "",
        taskDetails: "",
        type: "رسالة",
        senderName: me.full_name,
        content: archiveContent,
        whenText: formatArDateTime(new Date()),
      },
    }).catch(() => {});
    // Notify admins on employee message
    if (me.role === "employee") {
      const admins = profiles.filter((p) => p.role === "admin" || p.role === "owner");
      if (admins.length) {
        await supabase.from("notifications").insert(
          admins.map((a) => ({
            recipient_id: a.id, task_id: id, type: "new_message" as const,
            message: `${me.full_name} أرسل رسالة في: ${task?.title ?? ""}`,
          })),
        );
      }
    }
    setContent(""); setReplyTo(null);
  }

  async function markDone() {
    if (!me) return;
    if (!confirm("هل أنت متأكد من إغلاق هذه المهمة؟")) return;
    await supabase.from("tasks")
      .update({ status: "closed", is_active: false, closed_by: me.id, closed_at: new Date().toISOString(), finished_late: false })
      .eq("id", id);
    archiveToSheet({
      data: {
        taskTitle: task?.title ?? "",
        taskDetails: "",
        type: "تم الإغلاق",
        senderName: me.full_name,
        content: `تم الإغلاق في ${formatArDateTime(new Date())}`,
        whenText: formatArDateTime(new Date()),
      },
    }).catch(() => {});
    toast.success("تم الإغلاق ✓");
    setClosingPulse((n) => n + 1);
    qc.invalidateQueries({ queryKey: ["task", id] });
    qc.invalidateQueries({ queryKey: ["dashboard-tasks"] });
  }
  async function markDoneLate() {
    if (!me) return;
    if (!confirm("هل أنت متأكد من إغلاق هذه المهمة كمتأخرة؟")) return;
    await supabase.from("tasks")
      .update({ status: "closed", is_active: false, closed_by: me.id, closed_at: new Date().toISOString(), finished_late: true })
      .eq("id", id);
    archiveToSheet({
      data: {
        taskTitle: task?.title ?? "",
        taskDetails: "",
        type: "تم الإغلاق متأخراً",
        senderName: me.full_name,
        content: `تم الإغلاق متأخراً في ${formatArDateTime(new Date())}`,
        whenText: formatArDateTime(new Date()),
      },
    }).catch(() => {});
    toast.success("تم الإغلاق ✓");
    setClosingPulse((n) => n + 1);
    qc.invalidateQueries({ queryKey: ["task", id] });
    qc.invalidateQueries({ queryKey: ["dashboard-tasks"] });
  }
  async function markLate() {
    if (!task) return;
    await supabase.from("tasks").update({ status: "late" }).eq("id", id);
    toast.success("تم تعليمه كمتأخر");
    const assignees = task.task_assignments?.map((a: { user_id: string }) => a.user_id) ?? [];
    if (assignees.length) {
      await supabase.from("notifications").insert(
        assignees.map((uid: string) => ({
          recipient_id: uid, task_id: id, type: "task_late" as const,
          message: `تم تعليم المهمة "${task.title}" كمتأخر`,
        })),
      );
    }
    qc.invalidateQueries({ queryKey: ["task", id] });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !me) return;
    if (file.size > 100 * 1024 * 1024) {
      toast.error("الملف أكبر من ١٠٠ ميجا");
      return;
    }
    const dot = file.name.lastIndexOf(".");
    const base = dot > 0 ? file.name.slice(0, dot) : file.name;
    setAttachMode("file");
    setPendingFile(file);
    setDisplayName(base);
  }

  function openLinkDialog() {
    setAttachMode("link");
    setLinkUrl("");
    setDisplayName("");
    setLinkDialogOpen(true);
  }

  function cancelUpload() {
    if (uploading) return;
    setPendingFile(null);
    setDisplayName("");
    setLinkUrl("");
    setLinkDialogOpen(false);
  }

  async function confirmLink() {
    if (!me) return;
    const name = displayName.trim();
    const url = linkUrl.trim();
    if (!name) { toast.error("أدخل اسم الملف"); return; }
    if (!url || !url.toLowerCase().startsWith("http")) { toast.error("أدخل رابطاً صحيحاً"); return; }
    setUploading(true);
    try {
      const { data: inserted, error: insErr } = await supabase.from("task_attachments").insert({
        task_id: id,
        uploaded_by: me.id,
        file_name: name,
        file_url: url,
        drive_file_id: null,
        drive_view_url: url,
      }).select("id").single();
      if (insErr) { toast.error("فشل حفظ المرفق"); return; }
      toast.success("تم رفع الملف ✓");
      if (inserted?.id) {
        setHighlightAttId(inserted.id);
        setTimeout(() => setHighlightAttId(null), 1200);
      }
      qc.invalidateQueries({ queryKey: ["task-attachments", id] });
      setLinkUrl("");
      setDisplayName("");
      setLinkDialogOpen(false);
    } catch {
      toast.error("فشل حفظ المرفق");
    } finally {
      setUploading(false);
    }
  }

  async function confirmUpload() {
    if (!pendingFile || !me) return;
    const name = displayName.trim();
    if (!name) {
      toast.error("أدخل اسم الملف");
      return;
    }
    setUploading(true);
    try {
      const file = pendingFile;
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const idx = result.indexOf(",");
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await uploadFile({
        data: {
          taskTitle: task?.title ?? "",
          fileName: file.name,
          displayName: name,
          mimeType: file.type || "application/octet-stream",
          base64Data,
        },
      });
      if (!res.ok) {
        toast.error(res.error || "فشل رفع الملف إلى Google Drive");
        return;
      }
      const { data: inserted, error: insErr } = await supabase.from("task_attachments").insert({
        task_id: id,
        uploaded_by: me.id,
        file_name: name,
        file_url: res.viewUrl,
        drive_file_id: res.driveFileId,
        drive_view_url: res.viewUrl,
      }).select("id").single();
      if (insErr) {
        toast.error("فشل حفظ المرفق");
        return;
      }
      toast.success("تم رفع الملف ✓");
      if (inserted?.id) {
        setHighlightAttId(inserted.id);
        setTimeout(() => setHighlightAttId(null), 1200);
      }
      qc.invalidateQueries({ queryKey: ["task-attachments", id] });
      setPendingFile(null);
      setDisplayName("");
    } catch (err) {
      toast.error(`فشل رفع الملف: ${(err as Error)?.message ?? "خطأ غير متوقع"}`);
    } finally {
      setUploading(false);
    }
  }


  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="glass rounded-2xl p-4 md:p-5 flex items-center gap-3 flex-wrap">
        <Button asChild variant="ghost" size="sm">
          <Link to="/dashboard"><ArrowRight className="h-4 w-4" />رجوع</Link>
        </Button>
        <h1 className="text-lg md:text-xl font-bold flex-1 min-w-0">{task.title}</h1>
        <span
          key={`badge-${closingPulse}`}
          className={cn(
            "px-2.5 py-1 rounded-full text-xs font-bold transition-transform",
            closingPulse > 0 && "animate-scale-in",
          )}
          style={{ background: s.color, color: s.textOn }}
        >
          {s.label}
        </span>
        {isAdmin && !closed && (
          <div className="flex gap-2">
            <Button size="sm" onClick={markDone} className="bg-success text-white hover:opacity-90">
              <Check className="h-4 w-4" />Done
            </Button>
            {task.status === "late" ? (
              <Button
                size="sm"
                onClick={markDoneLate}
                className="text-white hover:opacity-90"
                style={{ backgroundColor: "#D97706" }}
              >
                <Flag className="h-4 w-4" />انتهت متأخر
              </Button>
            ) : (
              <Button size="sm" onClick={markLate} variant="destructive">
                <Flag className="h-4 w-4" />متأخر
              </Button>
            )}
          </div>
        )}
      </div>

      {closed && task.closed_at && (
        <div className="glass rounded-2xl p-3 md:p-4 text-sm text-muted-foreground">
          أُغلق بواسطة {profileById.get(task.closed_by ?? "")?.full_name ?? "—"} في {formatArDateTime(task.closed_at)}
        </div>
      )}

      {/* Info */}
      <div className="glass rounded-2xl p-4 md:p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-muted-foreground text-xs mb-1.5">منسوب إلى</div>
          <div className="flex flex-wrap gap-2">
            {task.task_assignments?.map((a: { id: string; user_id: string }) => {
              const p = profileById.get(a.user_id);
              if (!p) return null;
              return (
                <span key={a.id} className="inline-flex items-center gap-1.5 bg-accent rounded-full pl-3 pr-1 py-0.5">
                  <span>{p.full_name}</span>
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                </span>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs mb-1.5">التواريخ</div>
          <div>تاريخ الإنشاء: {formatArDateTime(task.created_at)}</div>
          <div className="text-warning">Deadline: {formatArDate(task.deadline)}</div>
        </div>
        {task.description && (
          <div className="md:col-span-2">
            <div className="text-muted-foreground text-xs mb-1.5">التفاصيل</div>
            <div className="whitespace-pre-wrap leading-relaxed">{task.description}</div>
          </div>
        )}
      </div>

      {/* Conversation */}
      <div className="glass rounded-2xl p-4 md:p-5 flex flex-col gap-3">
        <div className="font-bold">المحادثة</div>
        <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          {messages.length === 0 && attachments.length === 0 && (
            <div className="text-sm text-muted-foreground">لا توجد رسائل بعد</div>
          )}
          {timeline.map((item) => {
              if (item.kind === "msg") {
                const m = item.msg;
                const sender = profileById.get(m.sender_id);
                const isMine = m.sender_id === me?.id;
                const replied = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
                return (
                  <div key={`m-${m.id}`} className="flex gap-2.5 animate-fade-in transition-all duration-200">

                    <AvatarCircle name={sender?.full_name ?? "؟"} color={sender?.color ?? "#999"} avatarUrl={sender?.avatar_url} size={56} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-bold text-sm" style={{ color: sender?.color }}>{sender?.full_name}</span>
                        <span className="text-[11px] text-muted-foreground">{formatArDateTime(m.created_at)}</span>
                      </div>
                      {replied && (
                        <div className="mt-1 text-xs bg-accent/50 border-r-2 border-primary px-2 py-1 rounded text-muted-foreground line-clamp-2">
                          {replied.content}
                        </div>
                      )}
                      <div className={cn(
                        "mt-1 rounded-xl px-3 py-2 text-sm inline-block max-w-full text-foreground",
                        isMine ? "bg-primary/10" : "bg-accent",
                      )}>
                        {m.content}
                      </div>
                      <button
                        className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1 mt-1 transition-transform duration-150 hover:scale-105 active:scale-95"
                        onClick={() => setReplyTo(m)}
                      >
                        <Reply className="h-3 w-3" />رد
                      </button>
                    </div>
                  </div>
                );
              }
              const a = item.att;
              const up = profileById.get(a.uploaded_by);
              const href = a.drive_view_url ?? "";
              return (
                <div key={`a-${a.id}`} className="flex gap-2.5 animate-fade-in transition-all duration-200">
                  <AvatarCircle name={up?.full_name ?? "؟"} color={up?.color ?? "#999"} avatarUrl={up?.avatar_url} size={56} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-bold text-sm" style={{ color: up?.color }}>{up?.full_name}</span>
                      <span className="text-[11px] text-muted-foreground">{formatArDateTime(a.created_at)}</span>
                    </div>
                    <div className={cn(
                      "mt-1 inline-flex items-center gap-3 rounded-xl border bg-accent/40 px-3 py-2 max-w-full transition-all duration-300",
                      highlightAttId === a.id && "ring-2 ring-primary scale-[1.02] bg-primary/10",
                    )}>
                      <FileText className="h-5 w-5 text-primary shrink-0" />
                      <span className="text-sm truncate flex-1 min-w-0">{a.file_name}</span>
                      {href && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline shrink-0"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />فتح الملف
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          <div ref={bottomRef} />
        </div>

        {!closed && (
          <div className="border-t pt-3 space-y-2">
            {replyTo && (
              <div className="flex items-start gap-2 bg-accent/40 rounded-lg px-3 py-2 text-xs">
                <div className="flex-1 line-clamp-2 text-muted-foreground">رد على: {replyTo.content}</div>
                <button onClick={() => setReplyTo(null)} aria-label="إلغاء الرد"><X className="h-3.5 w-3.5" /></button>
              </div>
            )}
            <Textarea
              value={content} onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="اكتب ردك هنا... (Enter للإرسال، Shift+Enter لسطر جديد)" rows={3}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={onPickFile}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                aria-label="إرفاق ملف"
                title="إرفاق ملف"
              >
                <Paperclip className="h-4 w-4" />
                إرفاق ملف
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={openLinkDialog}
                disabled={uploading}
                aria-label="إرفاق رابط"
                title="إرفاق رابط"
              >
                <LinkIcon className="h-4 w-4" />
                إرفاق رابط
              </Button>
              <Button onClick={send} disabled={!content.trim()} className="bg-primary text-primary-foreground">
                <Send className="h-4 w-4" />إرسال
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!pendingFile} onOpenChange={(o) => { if (!o) cancelUpload(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رفع ملف</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              الملف المختار: <span className="font-medium text-foreground">{pendingFile?.name}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attachment-display-name">اسم الملف على الداشبورد</Label>
              <Input
                id="attachment-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={uploading}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelUpload} disabled={uploading}>إلغاء</Button>
            <Button
              onClick={confirmUpload}
              disabled={uploading || !displayName.trim()}
              className="bg-primary text-primary-foreground"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {uploading ? "جاري الرفع..." : "رفع"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkDialogOpen} onOpenChange={(o) => { if (!o) cancelUpload(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إرفاق رابط</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="attachment-link-url">الرابط</Label>
              <Input
                id="attachment-link-url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                disabled={uploading}
                autoFocus
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attachment-link-name">اسم الملف على الداشبورد</Label>
              <Input
                id="attachment-link-name"
                value={attachMode === "link" ? displayName : ""}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={uploading}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelUpload} disabled={uploading}>إلغاء</Button>
            <Button
              onClick={confirmLink}
              disabled={uploading || !displayName.trim() || !linkUrl.trim()}
              className="bg-primary text-primary-foreground"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {uploading ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
