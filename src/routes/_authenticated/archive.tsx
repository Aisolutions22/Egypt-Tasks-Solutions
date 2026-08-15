import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAllProfiles, useMyProfile } from "@/lib/use-profile";
import { Input } from "@/components/ui/input";
import { AvatarCircle } from "@/components/avatar-circle";
import { Skeleton } from "@/components/ui/skeleton";
import { formatArDate, formatArDateTime } from "@/lib/date-ar";
import { Search, ArchiveX } from "lucide-react";

export const Route = createFileRoute("/_authenticated/archive")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
    const { data: p } = await supabase.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle();
    if (!p || (p.role !== "admin" && p.role !== "owner" && p.role !== "employee")) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Archive — Ai Tasks Solutions" },
      { name: "description", content: "تصفح أرشيف المهام المغلقة، ابحث وراجع سجل الفريق في Ai Tasks Solutions." },
      { property: "og:title", content: "Archive — Ai Tasks Solutions" },
      { property: "og:description", content: "تصفح أرشيف المهام المغلقة، ابحث وراجع سجل الفريق في Ai Tasks Solutions." },
      { property: "og:url", content: "https://egypt-ai-tasks.lovable.app/archive" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ArchivePage,
});

function ArchivePage() {
  const { data: profiles = [] } = useAllProfiles();
  const { data: me } = useMyProfile();
  const isOwner = me?.role === "owner";
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const [q, setQ] = useState("");

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["archive-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, created_at, deadline, closed_by, closed_at, finished_late, task_assignments(user_id)")
        .eq("status", "closed")
        .order("closed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = tasks.filter((t) => {
    if (!q.trim()) return true;
    const ql = q.toLowerCase();
    if (t.title.toLowerCase().includes(ql)) return true;
    return t.task_assignments?.some((a: { user_id: string }) =>
      profileById.get(a.user_id)?.full_name.toLowerCase().includes(ql),
    );
  });

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold">Archive</h1>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="ابحث عن مهمة أو موظف..." className="pr-10" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="glass rounded-2xl p-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center text-muted-foreground">
          <ArchiveX className="h-10 w-10 mx-auto mb-2 opacity-50" />
          لا توجد مهام مؤرشفة
        </div>
      ) : (
        <div className="glass rounded-2xl divide-y">
          {filtered.map((t) => {
            const closer = t.closed_by ? profileById.get(t.closed_by) : null;
            const rowClass = "flex items-center gap-3 p-3 transition-colors";
            const inner = (
              <>
                <div className="flex -space-x-2 rtl:space-x-reverse">
                  {t.task_assignments?.slice(0, 3).map((a: { user_id: string }) => {
                    const p = profileById.get(a.user_id);
                    return p ? <AvatarCircle key={a.user_id} name={p.full_name} color={p.color} avatarUrl={p.avatar_url} size={44} /> : null;
                  })}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{t.title}</div>
                  <div className="text-xs text-muted-foreground">{formatArDate(t.created_at)}</div>
                  {t.closed_at && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      أُغلق بواسطة {closer?.full_name ?? "—"} في {formatArDateTime(t.closed_at)}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Done</span>
                  {t.finished_late && (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "#D97706", color: "#fff" }}
                    >
                      ⚑ انتهت متأخرة
                    </span>
                  )}
                </div>
              </>
            );
            return isOwner ? (
              <div key={t.id} className={rowClass}>{inner}</div>
            ) : (
              <Link key={t.id} to="/task/$id" params={{ id: t.id }} className={rowClass + " hover:bg-accent/50"}>
                {inner}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
