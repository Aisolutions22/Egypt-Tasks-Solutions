import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedBg } from "@/components/animated-bg";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";


export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — Ai Tasks Solutions" },
      { name: "description", content: "سجّل دخولك إلى Ai Tasks Solutions، نظام إدارة المهام الذكي بالعربية للفرق والشركات." },
      { property: "og:title", content: "تسجيل الدخول — Ai Tasks Solutions" },
      { property: "og:description", content: "سجّل دخولك إلى Ai Tasks Solutions، نظام إدارة المهام الذكي بالعربية للفرق والشركات." },
      { property: "og:url", content: "https://egypt-ai-tasks.lovable.app/login" },
    ],
    links: [
      { rel: "canonical", href: "https://egypt-ai-tasks.lovable.app/login" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error("بيانات الدخول غير صحيحة");
      return;
    }
    toast.success("تم تسجيل الدخول ✓");
    navigate({ to: "/dashboard" });
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative">
      <AnimatedBg />
      <img
        src="/logo.png"
        alt="Ai Tasks Solutions"
        className="mb-6 w-auto"
        style={{ maxWidth: 180, height: "auto" }}
      />
      <div className="glass rounded-3xl p-8 w-full max-w-md shadow-xl">
        <div className="flex flex-col items-center text-center mb-6">
          <h1 className="text-2xl font-bold whitespace-pre-wrap">{"Ai Tasks Solutions\u00a0\nنظام إدارة المهام الذكي"}</h1>
          <p className="text-sm text-muted-foreground mt-1">سجّل دخولك للمتابعة</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input
              id="email" type="email" required dir="ltr"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="password">كلمة المرور</Label>
            <PasswordInput
              id="password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <Button
            type="submit" disabled={loading}
            className="w-full h-11 bg-primary text-primary-foreground hover:opacity-90"
          >
            {loading ? "جاري الدخول..." : "تسجيل الدخول"}
          </Button>
        </form>
      </div>
    </main>
  );
}
