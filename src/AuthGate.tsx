import { useEffect, useState, type ReactNode } from "react";
import { clearPrivateCache } from "./private-cache";

type SessionUser = { email: string; fullName?: string };

type GateState =
  | { kind: "checking" }
  | { kind: "anonymous" }
  | { kind: "restricted"; user: SessionUser }
  | { kind: "admitted" }
  | { kind: "offline" }
  | { kind: "error" };

type SessionPayload = {
  authenticated: boolean;
  admitted?: boolean;
  user?: SessionUser;
};

function AuthScreen({ state }: { state: Exclude<GateState, { kind: "admitted" } | { kind: "offline" }> }) {
  const anonymous = state.kind === "anonymous";
  const restricted = state.kind === "restricted";

  return (
    <main className="auth-screen" aria-live="polite" aria-busy={state.kind === "checking"}>
      <section className="auth-card">
        <img className="auth-icon" src="/icons/icon-192.png" alt="" />
        <p className="auth-brand">Icebox</p>
        {state.kind === "checking" ? (
          <>
            <span className="bootstrap-spinner" aria-hidden="true" />
            <h1>Opening Icebox…</h1>
            <p>Checking your ChatGPT account securely.</p>
          </>
        ) : anonymous ? (
          <>
            <h1>Your freezer, clearly organised.</h1>
            <p>Sign in with ChatGPT to open the household inventories shared with you.</p>
            <a className="auth-primary" href="/signin-with-chatgpt?return_to=%2F">Continue with ChatGPT</a>
            <small>Icebox uses your ChatGPT account only to identify you. Inventory stays private to household members.</small>
          </>
        ) : restricted ? (
          <>
            <h1>Icebox is currently invite-only</h1>
            <p className="auth-identity">Signed in as <strong>{state.user.email}</strong></p>
            <p>Ask an Icebox household member or the operator to invite this exact email address.</p>
            <a className="auth-secondary" href="/signout-with-chatgpt?return_to=%2F">Sign out or use another account</a>
          </>
        ) : (
          <>
            <h1>We couldn’t verify your account</h1>
            <p>Icebox received an unexpected response. Your cached inventory has not been opened.</p>
            <button className="auth-primary" type="button" onClick={() => window.location.reload()}>Try again</button>
          </>
        )}
      </section>
    </main>
  );
}

export default function AuthGate({ children, offlineChildren }: { children: ReactNode; offlineChildren: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: "checking" });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
        const contentType = response.headers.get("content-type") ?? "";
        if (import.meta.env.DEV && !contentType.includes("application/json")) {
          if (active) setState({ kind: "admitted" });
          return;
        }
        const payload = contentType.includes("application/json")
          ? await response.json() as SessionPayload
          : null;
        if (response.status === 401 || response.status === 403 || payload?.authenticated === false) {
          await clearPrivateCache();
          if (active) setState({ kind: "anonymous" });
          return;
        }
        if (!response.ok || !payload || payload.authenticated !== true || typeof payload.admitted !== "boolean") {
          if (active) setState({ kind: "error" });
          return;
        }
        if (!payload.admitted) {
          await clearPrivateCache();
          if (active) setState({ kind: "restricted", user: payload.user ?? { email: "your ChatGPT account" } });
          return;
        }
        if (active) setState({ kind: "admitted" });
      } catch {
        if (active) setState({ kind: "offline" });
      }
    })();
    return () => { active = false; };
  }, []);

  if (state.kind === "admitted") return children;
  if (state.kind === "offline") return offlineChildren;
  return <AuthScreen state={state} />;
}
