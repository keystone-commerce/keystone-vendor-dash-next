import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { UserDto, UserRole } from "@shared";
import { usersApi } from "@/lib/api";
import { apiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Modal } from "@/components/Modal";
import ProgressButton from "@/components/ui/progress-button";

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  PROCUREMENT_MEMBER: "Procurement",
  VIEWER: "Viewer",
};

export function TeamModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("PROCUREMENT_MEMBER");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: usersApi.list,
  });

  const add = useMutation({
    mutationFn: () => usersApi.create({ email, name: name || undefined, role }),
    onSuccess: (u) => {
      toast.success(`Added ${u.email}. They can sign in with an email code now.`);
      setEmail("");
      setName("");
      setRole("PROCUREMENT_MEMBER");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(apiError(err, "Couldn't add member")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      toast("Member removed.");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(apiError(err, "Couldn't remove member")),
  });

  return (
    <Modal title="Team members" onClose={onClose}>
      <div className="space-y-5">
        <p className="text-sm text-muted">
          Add a teammate's email and role. They sign in with a one-time code emailed to them — no
          password to set or remember.
        </p>

        {/* Add member */}
        <form
          className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_140px_auto] gap-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <label className="block">
            <span className="label">Email *</span>
            <input
              className="input mt-1"
              type="email"
              placeholder="name@keystonecommerce.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="label">Name</span>
            <input
              className="input mt-1"
              placeholder="(optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">Role</span>
            <select
              className="input mt-1"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              <option value="PROCUREMENT_MEMBER">Procurement</option>
              <option value="ADMIN">Admin</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </label>
          <ProgressButton
            type="submit"
            label="Add"
            loadingLabel="Adding…"
            loading={add.isPending}
            className="!rounded-keystone h-[38px] text-sm"
          />
        </form>

        {/* Member list */}
        <div className="border-t border-border pt-3">
          {isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <ul className="divide-y divide-border">
              {users.map((u: UserDto) => (
                <li key={u.id} className="flex items-center gap-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {u.name}{" "}
                      {u.id === meId && <span className="text-xs text-muted">(you)</span>}
                    </div>
                    <div className="text-xs text-muted truncate">{u.email}</div>
                  </div>
                  <span className="chip bg-orange-light text-orange-deep">{ROLE_LABELS[u.role]}</span>
                  <button
                    className="btn-danger py-1 disabled:opacity-40"
                    disabled={u.id === meId || remove.isPending}
                    title={u.id === meId ? "You can't remove yourself" : "Remove member"}
                    onClick={() => {
                      if (confirm(`Remove ${u.email}? They'll lose access immediately.`)) {
                        remove.mutate(u.id);
                      }
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
