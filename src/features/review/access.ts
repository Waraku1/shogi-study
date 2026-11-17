import { useEffect, useState } from "react";
import { accountNamespace, guestNamespace } from "../learning/types";
// Set by the dedicated Vite guest mode, whose server rejects all /api routes.
// Never infer guest status from a failed request or a URL/localStorage toggle.
declare const __SHOGI_GUEST_ONLY__: boolean;
export const guestOnly =
  typeof __SHOGI_GUEST_ONLY__ !== "undefined" && __SHOGI_GUEST_ONLY__;
export type Access = {
  checking: boolean;
  blocked: boolean;
  namespace: string | null;
  activeRooms: string[];
  reason: string;
};
const key = "shogi-study-live-match";
const locked = () => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return true;
  }
};
let value: Access = {
  checking: true,
  blocked: false,
  namespace: null,
  activeRooms: [],
  reason: "",
};
const listeners = new Set<() => void>();
let pending: Promise<Access> | null = null;
let epoch = 0;
const emit = () => listeners.forEach((f) => f());
function remember(blocked: boolean) {
  try {
    if (blocked) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* uncertain status remains fail-closed in memory */
  }
}
export function observeOnline(id: string, status: string, room: string) {
  if (status === "active") {
    epoch++;
    remember(true);
    value = {
      checking: false,
      blocked: true,
      namespace: accountNamespace(id),
      activeRooms: [room],
      reason:
        "Finish your online match before using engine assistance or Review.",
    };
    emit();
  } else if (status === "finished") {
    epoch++;
    if (pending) void pending.finally(() => refreshAccess());
    else void refreshAccess();
  }
}
export function refreshAccess(): Promise<Access> {
  if (guestOnly) {
    value = { checking: false, blocked: false, namespace: guestNamespace,
      activeRooms: [], reason: "Guest-local only. Online accounts and rooms are unavailable in this mode." };
    emit();
    return Promise.resolve(value);
  }
  if (pending) return pending;
  const generation = epoch;
  pending = (async () => {
    try {
      const r = await fetch("/api/play-status", {
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (generation !== epoch) return value;
      if (r.status === 401) {
        value = {
          checking: false,
          blocked: locked(),
          namespace: guestNamespace,
          activeRooms: [],
          reason: locked()
            ? "Sign in again to confirm that your previous match has finished."
            : "",
        };
      } else {
        let b;
        try {
          b = await r.json();
        } catch {
          throw new Error("Offline");
        }
        if (!r.ok || typeof b?.user?.id !== "string" || !b.user.id ||
            !Array.isArray(b.activeRooms) || b.activeRooms.length > 32 ||
            b.activeRooms.some((id: unknown) => typeof id !== "string" || !id)) {
          value = {
            ...value,
            checking: false,
            blocked: true,
            namespace: null,
            reason:
              "Cannot confirm online status. Reconnect before using Review or engine assistance.",
          };
        } else if (generation === epoch) {
          remember(b.activeRooms.length > 0);
          value = {
            checking: false,
            blocked: b.activeRooms.length > 0,
            namespace: accountNamespace(b.user.id),
            activeRooms: b.activeRooms,
            reason: b.activeRooms.length
              ? "Finish your online match before using engine assistance or Review."
              : "",
          };
        }
      }
    } catch {
      if (generation === epoch)
        value = {
          checking: false,
          blocked: true,
          namespace: null,
          activeRooms: value.activeRooms,
          reason: "Cannot confirm online status. Reconnect before using Review or engine assistance.",
        };
    }
    emit();
    return value;
  })().finally(() => {
    pending = null;
  });
  return pending;
}
export async function assertAnalysisAllowed() {
  const state = await refreshAccess();
  if (state.blocked || state.checking)
    throw new Error(state.reason || "Online status is being checked");
}
export function useAccess() {
  const [state, setState] = useState(value);
  useEffect(() => {
    const update = () => setState({ ...value });
    listeners.add(update);
    void refreshAccess();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storageChanged);
    return () => {
      listeners.delete(update);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storageChanged);
    };
  }, []);
  return state;
}
function refresh() {
  void refreshAccess();
}

function storageChanged(e: StorageEvent) {
  if (e.key !== key && e.key !== null) return;
  epoch++;
  if (locked()) {
    value = {
      ...value,
      blocked: true,
      reason: "An online match is active in another view.",
    };
    emit();
  }
  if (pending) void pending.finally(() => refreshAccess());
  else void refreshAccess();
}
