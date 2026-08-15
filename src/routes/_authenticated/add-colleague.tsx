import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAllProfiles } from "@/lib/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/color-picker";
import { createColleague } from "@/lib/admin.functions";
import { useMyProfile } from "@/lib/use-profile";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/add-colleague")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
    const { data: p } = await supabase.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle();
    if (!p || p.role !== "admin") throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "إضافة موظف — Ai Tasks Solutions" },
      { name: "description", content: "أنشئ حساب موظف جديد في Ai Tasks Solutions، وحدد الصلاحية واللون التعريفي الخاص به." },
      { property: "og:title", content: "إضافة موظف — Ai Tasks Solutions" },
      { property: "og:description", content: "أنشئ حساب موظف جديد في Ai Tasks Solutions، وحدد الصلاحية واللون التعريفي الخاص به." },
      { property: "og:url", content: "https://egypt-ai-tasks.lovable.app/add-colleague" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AddColleaguePage,
});

function AddColleaguePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: profiles = [] } = useAllProfiles();
  const { data: me } = useMyProfile();
  const isOwner = me?.role === "owner";
  const create = useServerFn(createColleague);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<"owner" | "admin" | "employee">("employee");
  const [color, setColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const taken = profiles.map((p) => p.color.toLowerCase());

  async function submit() {
    if (!name.trim()) return toast.error("الاسم مطلوب");
    if (!email.trim()) return toast.error("البريد مطلوب");
    if (password.length < 8) return toast.error("كلمة المرور ٨ أحرف على الأقل");
    // Auto-pick first available color if none selected
    let finalColor = color;
    if (!finalColor) {
      const { COLOR_PALETTE } = await import("@/lib/colors");
      finalColor = COLOR_PALETTE.find((c) => !taken.includes(c.toLowerCase())) ?? null;
      if (!finalColor) return toast.error("جميع الألوان مستخدمة، أضف لوناً جديداً");
    }
    if (taken.includes(finalColor.toLowerCase())) return toast.error("هذا اللون مستخدم بالفعل");
    setSaving(true);
    try {
      await create({ data: { full_name: name.trim(), email: email.trim(), password, role, color: finalColor } });
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success("تم إنشاء الحساب ✓");
      navigate({ to: "/settings" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "حدث خطأ");
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold">إضافة موظف</h1>
      <div className="glass rounded-2xl p-5 space-y-4">
        <div>
          <Label>الاسم الكامل</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label>البريد الإلكتروني</Label>
          <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label>كلمة المرور</Label>
          <div className="relative mt-1.5">
            <Input type={showPw ? "text" : "password"} dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <Label>الصلاحية</Label>
          <div className="mt-2 flex gap-2">
            {(["owner", "admin", "employee"] as const)
              .filter((r) => r !== "owner" || isOwner)
              .map((r) => (
              <button key={r} type="button" onClick={() => setRole(r)}
                className={cn("px-4 h-10 rounded-full border-2 text-sm",
                  role === r ? "border-primary bg-primary/10" : "border-transparent bg-accent")}>
                {r === "owner" ? "Owner" : r === "admin" ? "Admin" : "موظف"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>اللون</Label>
          <div className="mt-2"><ColorPicker value={color} onChange={setColor} takenColors={taken} /></div>
        </div>
        <div className="flex justify-end pt-2">
          <Button onClick={submit} disabled={saving} className="bg-primary text-primary-foreground">
            {saving ? "جاري الحفظ..." : "إنشاء"}
          </Button>
        </div>
      </div>
    </div>
  );
}
