import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyProfile, useAllProfiles, type Profile } from "@/lib/use-profile";
import { HomeMessageBanner } from "@/components/home-message-banner";
import { TaskCard, type TaskCardData } from "@/components/task-card";
import { AvatarCircle } from "@/components/avatar-circle";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Plus, ListTodo, Clock, AlertTriangle, CheckCircle2, Inbox } from "lucide-react";
import { TaskPieChart } from "@/components/task-pie-chart";
import { formatArDate, toArabicDigits } from "@/lib/date-ar";
import type { TaskStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Ai Tasks Solutions" },
      { name: "description", content: "لوحة التحكم: تابع مهام الفريق، حالة الإنجاز، والمهام المتأخرة في Ai Tasks Solutions." },
      { property: "og:title", content: "Dashboard — Ai Tasks Solutions" },
      { property: "og:description", content: "لوحة التحكم: تابع مهام الفريق، حالة الإنجاز، والمهام المتأخرة في Ai Tasks Solutions." },
      { property: "og:url", content: "https://egypt-ai-tasks.lovable.app/dashboard" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

type TaskRow = {
  id: string; title: string; status: TaskStatus;
  created_at: string; deadline: string; is_active: boolean;
  finished_late: boolean;
  task_assignments: { user_id: string }[];
};

function Dashboard() {
  const { data: me } = useMyProfile();
  const { data: profiles = [] } = useAllProfiles();
  const isAdmin = me?.role === "admin";
  const isOwner = me?.role === "owner";
  const canSeeAll = isAdmin || isOwner;
  const isMobile = useIsMobile();
  const pieSize = isMobile ? 90 : 120;
  const qc = useQueryClient();

  // Fetch ALL tasks (including closed/archived) so counters reflect everything.
  const { data: allTasksRaw = [], isLoading } = useQuery({
    queryKey: ["dashboard-tasks", me?.id, canSeeAll],
    enabled: !!me?.id,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, status, created_at, deadline, is_active, finished_late, task_assignments(user_id)")
        .order("deadline", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TaskRow[];
    },
  });

  // Auto-mark overdue tasks as 'late' (admin only — owner is read-only).
  useEffect(() => {
    if (!isAdmin || allTasksRaw.length === 0) return;
    const nowIso = new Date().toISOString();
    const overdue = allTasksRaw.filter(
      (t) => t.deadline < nowIso && t.is_active && t.status !== "closed" && t.status !== "done" && t.status !== "late",
    );
    if (overdue.length === 0) return;
    (async () => {
      await supabase.from("tasks").update({ status: "late" }).in("id", overdue.map((t) => t.id));
      qc.invalidateQueries({ queryKey: ["dashboard-tasks"] });
    })();
  }, [allTasksRaw, isAdmin, qc]);

  const [filter, setFilter] = useState<"all" | "inProgress" | "late" | "done">("all");

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  // Counters per spec
  const total = allTasksRaw.length;
  const inProgress = allTasksRaw.filter(
    (t) => t.is_active && (t.status === "new" || t.status === "inProgress" || t.status === "late"),
  ).length;
  const late = allTasksRaw.filter((t) => t.status === "late" && t.is_active).length;
  const done = allTasksRaw.filter((t) => t.status === "closed").length;
  const pieInProgress = inProgress - late;

  // Dashboard list shows tasks where is_active = true.
  const activeTasks = useMemo(() => allTasksRaw.filter((t) => t.is_active), [allTasksRaw]);

  const tasks = useMemo(() => {
    if (filter === "all") return activeTasks;
    if (filter === "done") return allTasksRaw.filter((t) => t.status === "closed");
    if (filter === "inProgress") return activeTasks.filter((t) => t.status === "new" || t.status === "inProgress");
    return activeTasks.filter((t) => t.status === filter);
  }, [activeTasks, allTasksRaw, filter]);

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <HomeMessageBanner />

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">لوحة التحكم</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {formatArDate(new Date())} · {toArabicDigits(total)} مهمة نشطة
          </p>
        </div>
        {isAdmin && (
          <Button asChild className="bg-primary text-primary-foreground hover:opacity-90 active:scale-95">
            <Link to="/add-task"><Plus className="h-4 w-4" />مهمة جديدة</Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={ListTodo}     label="إجمالي المهام" value={total}      tint="#2563EB" active={filter === "all"}        onClick={() => setFilter("all")} />
        <StatCard icon={Clock}        label="قيد التنفيذ"    value={pieInProgress} tint="#D97706" active={filter === "inProgress"} onClick={() => setFilter(filter === "inProgress" ? "all" : "inProgress")} />
        <StatCard icon={AlertTriangle} label="متأخرة"       value={late}       tint="#DC2626" active={filter === "late"}       onClick={() => setFilter(filter === "late" ? "all" : "late")} />
        <StatCard icon={CheckCircle2} label="منتهية"        value={done}       tint="#059669" active={filter === "done"}       onClick={() => setFilter(filter === "done" ? "all" : "done")} />
      </div>

      {canSeeAll && (
        <div className="glass rounded-2xl p-5">
          <h2 className="text-lg font-bold mb-3">نظرة عامة</h2>
          <TaskPieChart done={done} inProgress={pieInProgress} late={late} size={pieSize} showLegend />
        </div>
      )}

      {isLoading && (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(270px,1fr))]">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && tasks.length === 0 && (
        <div className="glass rounded-2xl p-10 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">لا توجد مهام حالياً</p>
          {isAdmin && (
            <Button asChild className="mt-4 bg-primary text-primary-foreground hover:opacity-90 active:scale-95">
              <Link to="/add-task"><Plus className="h-4 w-4" />إضافة مهمة جديدة</Link>
            </Button>
          )}
        </div>
      )}

      {canSeeAll ? (
        filter === "all" ? (
          <AnalyticsView profiles={profiles} allTasks={allTasksRaw} />
        ) : (
          <TaskFlatGrid tasks={tasks} profileById={profileById} disableLink={isOwner} />
        )
      ) : (
        <PersonalView allTasks={allTasksRaw} tasks={tasks} me={me ?? undefined} isOwner={isOwner} pieSize={pieSize} />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tint, active, onClick }: { icon: typeof ListTodo; label: string; value: number; tint: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "glass rounded-xl p-4 flex items-center gap-3 text-right transition-all hover:-translate-y-0.5 active:scale-[0.98] w-full",
        active && "ring-2 ring-primary",
      )}
    >
      <div className="h-11 w-11 rounded-xl flex items-center justify-center" style={{ background: tint + "22", color: tint }}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold text-foreground">{toArabicDigits(value)}</div>
      </div>
    </button>
  );
}


function TaskFlatGrid({ tasks, profileById, disableLink }: {
  tasks: TaskRow[]; profileById: Map<string, Profile>; disableLink?: boolean;
}) {
  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(270px,1fr))]">
      {tasks.map((t) => (
        <TaskCard key={t.id} task={toCard(t, taskColor(t, profileById))} disableLink={disableLink} />
      ))}
    </div>
  );
}

function taskColor(t: TaskRow, profileById: Map<string, Profile>): string {
  const firstAssignee = t.task_assignments[0]?.user_id;
  return firstAssignee ? (profileById.get(firstAssignee)?.color ?? "#64748B") : "#64748B";
}

function PersonalView({ allTasks, tasks, me, isOwner, pieSize }: {
  allTasks: TaskRow[]; tasks: TaskRow[]; me: Profile | undefined; isOwner: boolean; pieSize: number;
}) {
  if (!me) return null;
  const mine = allTasks.filter((t) => t.task_assignments.some((a) => a.user_id === me.id));
  const myDone = mine.filter((t) => t.status === "closed").length;
  const myLate = mine.filter((t) => t.status === "late" && t.is_active).length;
  const myInProgress = mine.filter((t) => t.is_active && (t.status === "new" || t.status === "inProgress")).length;
  return (
    <>
      <div className="glass rounded-2xl p-5">
        <h2 className="text-lg font-bold mb-3">نظرة عامة</h2>
        <TaskPieChart done={myDone} inProgress={myInProgress} late={myLate} size={pieSize} showLegend />
      </div>
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(270px,1fr))]">
        {tasks
          .filter((t) => t.task_assignments.some((a) => a.user_id === me.id))
          .map((t) => (
            <TaskCard key={t.id} task={toCard(t, me.color)} disableLink={isOwner} />
          ))}
      </div>
    </>
  );
}

function toCard(t: TaskRow, color: string): TaskCardData {
  return {
    id: t.id, title: t.title, status: t.status,
    created_at: t.created_at, deadline: t.deadline,
    borderColor: color,
    finished_late: t.finished_late,
  };
}

function AnalyticsView({ profiles, allTasks }: { profiles: Profile[]; allTasks: TaskRow[] }) {
  const employees = profiles.filter((p) => p.role === "employee" && p.is_active);
  if (employees.length === 0) {
    return (
      <div className="glass rounded-2xl p-10 text-center">
        <Inbox className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-foreground font-medium">لا يوجد موظفون بعد</p>
      </div>
    );
  }
  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      {employees.map((emp) => {
        const empAll = allTasks.filter((t) => t.task_assignments.some((a) => a.user_id === emp.id));
        const empDone = empAll.filter((t) => t.status === "closed").length;
        const empLate = empAll.filter((t) => t.status === "late" && t.is_active).length;
        const empInProgress = empAll.filter((t) => t.is_active && (t.status === "new" || t.status === "inProgress")).length;
        const breakdown = [
          { color: "#059669", label: "منتهية", value: empDone },
          { color: "#D97706", label: "قيد التنفيذ", value: empInProgress },
          { color: "#DC2626", label: "متأخرة", value: empLate },
        ];
        return (
          <div key={emp.id} className="flex items-center gap-4 p-3 rounded-xl bg-card/40">
            <AvatarCircle name={emp.full_name} color={emp.color} avatarUrl={emp.avatar_url} size={48} />
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm truncate text-foreground">{emp.full_name}</div>
              <div className="text-[11px] text-muted-foreground">{toArabicDigits(empAll.length)} مهمة</div>
            </div>
            <TaskPieChart done={empDone} inProgress={empInProgress} late={empLate} size={56} />
            <ul className="space-y-1 text-xs min-w-[110px]">
              {breakdown.map((b) => (
                <li key={b.label} className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: b.color }} />
                  <span className="text-foreground">{b.label}</span>
                  <span className="text-muted-foreground">{toArabicDigits(b.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

