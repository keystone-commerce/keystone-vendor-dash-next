import { useState } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/lib/auth-store";
import { authApi } from "@/lib/api";
import { TeamModal } from "@/features/team/TeamModal";
import { AnimatedThemeToggle } from "@/components/ui/animated-theme-toggle";

export function Header() {
  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const clear = useAuthStore((s) => s.clear);
  const [teamOpen, setTeamOpen] = useState(false);

  async function signOut() {
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } catch {
      /* non-fatal */
    }
    clear();
    toast("Signed out.");
  }

  return (
    <header className="bg-card border-b border-border">
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center gap-4">
        {/* Liwip mark. The SVG is orange/rust on transparent, so it reads on both the
            light and dark themes without needing a filter. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/liwip-logo.svg"
          alt="Liwip"
          width={56}
          height={56}
          className="w-14 h-14 shrink-0"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3">
            <div className="text-xs tracking-[0.25em] text-muted">LIWIP</div>
            <div className="text-xs tracking-widest text-muted">KEYSTONE COMMERCE</div>
          </div>
          <h1 className="text-xl md:text-2xl font-bold leading-tight">Vendor Dashboard</h1>
          <p className="text-xs text-muted mt-0.5">
            Procurement pipeline, catalogues &amp; bills — one place, always current.
          </p>
        </div>

        {/* Compass motif from the prototype */}
        <div className="hidden md:block text-rust text-2xl">✦</div>

        <div className="flex items-center gap-3">
          {user && (
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium leading-tight">{user.name}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted">{user.role}</div>
            </div>
          )}
          <AnimatedThemeToggle className="h-[38px] !rounded-keystone border-border text-ink" />
          {user?.role === "ADMIN" && (
            <button className="btn" onClick={() => setTeamOpen(true)}>
              Team
            </button>
          )}
          <button className="btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
      {teamOpen && <TeamModal onClose={() => setTeamOpen(false)} />}
    </header>
  );
}
