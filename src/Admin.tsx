import {
  ArchiveIcon,
  ChatBubbleIcon,
  CheckCircledIcon,
  ChevronLeftIcon,
  CubeIcon,
  HomeIcon,
  Pencil1Icon,
  PersonIcon,
  PlusIcon,
  ReloadIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import "./admin.css";

type AdminHousehold = {
  id: string;
  name: string;
  ownerEmail: string;
  ownerName?: string | null;
  memberCount: number;
  freezerCount: number;
  drawerCount: number;
  activeItemCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  members: AdminHouseholdMember[];
  pendingInvitations: AdminHouseholdInvitation[];
};

type AdminHouseholdMember = {
  id: string;
  email: string;
  fullName?: string | null;
  joinedAt: string;
  isOwner: boolean;
};

type AdminHouseholdInvitation = {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
};

type AdminOverview = {
  operator: { email: string; fullName?: string | null };
  households: AdminHousehold[];
  totals: {
    activeHouseholds: number;
    activeItems: number;
    members: number;
    pendingBackup: number;
    feedback: number;
  };
  feedback: AdminFeedback[];
  backup: {
    state: "current" | "pending" | "attention";
    pendingCount: number;
    oldestPendingAt?: string | null;
    lastSuccessAt?: string | null;
    lastErrorCode?: string | null;
  };
};

type AdminFeedback = {
  id: string;
  reference: string;
  message: string;
  sessionId: string;
  appContext: Record<string, unknown>;
  recentEvents: Array<{ type?: string; level?: string; occurredAt?: string; metadata?: Record<string, unknown> }>;
  createdAt: string;
  userEmail: string;
  userName?: string | null;
  householdId?: string | null;
  householdName?: string | null;
  attachmentCount: number;
};

type Confirmation = {
  householdId: string;
  action: "reset" | "delete";
  typedName: string;
};

type PilotAccessEntry = {
  email: string;
  createdAt: string;
  addedByEmail?: string | null;
  hasMembership: boolean;
  hasPendingInvitation: boolean;
};

async function adminRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "The admin action could not be completed");
  }
  return payload as T;
}

function compactDate(value?: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function plural(count: number, singular: string) {
  return `${count.toLocaleString()} ${singular}${count === 1 ? "" : "s"}`;
}

export default function Admin() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [accessEntries, setAccessEntries] = useState<PilotAccessEntry[]>([]);
  const [accessEmail, setAccessEmail] = useState("");
  const [membershipEmails, setMembershipEmails] = useState<Record<string, string>>({});
  const [memberRemoval, setMemberRemoval] = useState<{ householdId: string; memberId: string } | null>(null);

  async function loadOverview() {
    setError(null);
    try {
      const [nextOverview, access] = await Promise.all([
        adminRequest<AdminOverview>("/api/operator/admin/households"),
        adminRequest<{ entries: PilotAccessEntry[] }>("/api/operator/admin/access"),
      ]);
      setOverview(nextOverview);
      setAccessEntries(access.entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Admin is unavailable");
    } finally {
      setLoading(false);
    }
  }

  async function addPilotAccess(event: FormEvent) {
    event.preventDefault();
    const email = accessEmail.trim();
    if (!email) return;
    setBusy("access:add");
    setError(null);
    setNotice(null);
    try {
      const result = await adminRequest<{ entry: PilotAccessEntry; created: boolean }>("/api/operator/admin/access", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setAccessEmail("");
      setNotice(result.created ? `${result.entry.email} can now sign in to Icebox.` : `${result.entry.email} already had pilot access.`);
      await loadOverview();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Pilot access could not be added");
    } finally {
      setBusy(null);
    }
  }

  async function removePilotAccess(entry: PilotAccessEntry) {
    setBusy(`access:remove:${entry.email}`);
    setError(null);
    setNotice(null);
    try {
      const result = await adminRequest<{ remainsAdmitted: boolean }>(`/api/operator/admin/access/${encodeURIComponent(entry.email)}`, {
        method: "DELETE",
      });
      setNotice(result.remainsAdmitted
        ? `${entry.email} was removed from preapproval, but still has access through a household or invitation.`
        : `${entry.email} was removed from pilot access.`);
      await loadOverview();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Pilot access could not be removed");
    } finally {
      setBusy(null);
    }
  }

  async function addHouseholdMembership(event: FormEvent, household: AdminHousehold) {
    event.preventDefault();
    const email = (membershipEmails[household.id] || "").trim();
    if (!email) return;
    setBusy(`member:add:${household.id}`);
    setError(null);
    setNotice(null);
    try {
      const result = await adminRequest<{ status: "member" | "invitation"; created: boolean }>(`/api/operator/admin/households/${household.id}/members`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMembershipEmails((current) => ({ ...current, [household.id]: "" }));
      setNotice(result.status === "member"
        ? `${email} is now a member of ${household.name}.`
        : `An invitation to ${household.name} is ready for ${email}.`);
      await loadOverview();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The membership could not be added");
    } finally {
      setBusy(null);
    }
  }

  async function removeHouseholdMembership(household: AdminHousehold, member: AdminHouseholdMember) {
    if (member.isOwner) return;
    if (memberRemoval?.householdId !== household.id || memberRemoval.memberId !== member.id) {
      setMemberRemoval({ householdId: household.id, memberId: member.id });
      return;
    }
    setBusy(`member:remove:${household.id}:${member.id}`);
    setError(null);
    setNotice(null);
    try {
      await adminRequest(`/api/operator/admin/households/${household.id}/members/${member.id}`, { method: "DELETE" });
      setMemberRemoval(null);
      setNotice(`${member.fullName || member.email} was removed from ${household.name}.`);
      await loadOverview();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The member could not be removed");
    } finally {
      setBusy(null);
    }
  }

  async function revokeHouseholdInvitation(household: AdminHousehold, invitation: AdminHouseholdInvitation) {
    setBusy(`invitation:revoke:${invitation.id}`);
    setError(null);
    setNotice(null);
    try {
      await adminRequest(`/api/operator/admin/households/${household.id}/invitations/${invitation.id}`, { method: "DELETE" });
      setNotice(`The invitation for ${invitation.email} was revoked.`);
      await loadOverview();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The invitation could not be revoked");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  const activeHouseholds = useMemo(
    () => overview?.households.filter((household) => !household.deletedAt) ?? [],
    [overview],
  );
  const archivedHouseholds = useMemo(
    () => overview?.households.filter((household) => household.deletedAt) ?? [],
    [overview],
  );

  async function renameHousehold(event: FormEvent, household: AdminHousehold) {
    event.preventDefault();
    const name = nameDraft.trim();
    if (!name || name === household.name) {
      setEditingId(null);
      return;
    }
    setBusy(`rename:${household.id}`);
    setNotice(null);
    try {
      await adminRequest(`/api/operator/admin/households/${household.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setNotice(`${household.name} was renamed to ${name}.`);
      setEditingId(null);
      await loadOverview();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The household could not be renamed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmHouseholdAction(household: AdminHousehold) {
    if (!confirmation || confirmation.typedName !== household.name) return;
    const action = confirmation.action;
    setBusy(`${action}:${household.id}`);
    setNotice(null);
    setError(null);
    try {
      if (action === "reset") {
        const result = await adminRequest<{ itemsReset: number }>(
          `/api/operator/admin/households/${household.id}/reset`,
          { method: "POST", body: JSON.stringify({ confirmName: household.name }) },
        );
        setNotice(`${household.name} was reset. ${plural(result.itemsReset, "item")} removed; its structure and members were kept.`);
      } else {
        await adminRequest(`/api/operator/admin/households/${household.id}`, {
          method: "DELETE",
          body: JSON.stringify({ confirmName: household.name }),
        });
        setNotice(`${household.name} was archived and removed from members’ inventories.`);
      }
      setConfirmation(null);
      await loadOverview();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The household action failed");
    } finally {
      setBusy(null);
    }
  }

  async function runBackupAction(action: "retry" | "schema" | "reconcile") {
    setBusy(`backup:${action}`);
    setNotice(null);
    setError(null);
    try {
      await adminRequest(`/api/operator/backup/${action}`, {
        method: "POST",
        body: action === "schema" ? JSON.stringify({ repair: false }) : undefined,
      });
      setNotice(action === "retry" ? "Pending backup rows were retried." : action === "schema" ? "The backup Sheet schema is valid." : "Backup reconciliation completed.");
      await loadOverview();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The backup action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div className="admin-header-inner">
          <a className="admin-back" href="/"><ChevronLeftIcon /> Inventory</a>
          <div>
            <p className="admin-brand">Icebox</p>
            <p className="admin-kicker">Operator console</p>
          </div>
          <div className="admin-identity">
            <span className="admin-avatar"><PersonIcon /></span>
            <span><strong>{overview?.operator.fullName || "Operator"}</strong><small>{overview?.operator.email || "Signed in with ChatGPT"}</small></span>
          </div>
        </div>
      </header>

      <main className="admin-main">
        <section className="admin-intro">
          <div>
            <p className="admin-eyebrow">Private operations</p>
            <h1>Households</h1>
            <p>Inspect active households, clear an inventory while keeping its structure, or archive a household completely.</p>
          </div>
          <button type="button" className="admin-refresh" onClick={() => void loadOverview()} disabled={loading || Boolean(busy)}><ReloadIcon /> Refresh</button>
        </section>

        {notice ? <div className="admin-notice" role="status"><CheckCircledIcon />{notice}</div> : null}
        {error ? <div className="admin-error" role="alert">{error}</div> : null}

        {loading ? (
          <div className="admin-loading" aria-live="polite">Loading household operations…</div>
        ) : overview ? (
          <>
            <section className="admin-stats" aria-label="Icebox totals">
              <article><HomeIcon /><span><strong>{overview.totals.activeHouseholds.toLocaleString()}</strong><small>Active households</small></span></article>
              <article><CubeIcon /><span><strong>{overview.totals.activeItems.toLocaleString()}</strong><small>Inventory items</small></span></article>
              <article><PersonIcon /><span><strong>{overview.totals.members.toLocaleString()}</strong><small>Household members</small></span></article>
              <article data-state={overview.backup.state}><ArchiveIcon /><span><strong>{overview.totals.pendingBackup.toLocaleString()}</strong><small>Pending backup rows</small></span></article>
            </section>

            <section className="admin-section admin-access-section">
              <div className="admin-section-heading">
                <div><h2>Pilot access</h2><p>Preapprove a ChatGPT account email to pass the invite-only gate</p></div>
                <span className="admin-feedback-count">{plural(accessEntries.length, "address")}</span>
              </div>
              <form className="admin-access-form" onSubmit={(event) => void addPilotAccess(event)}>
                <label htmlFor="pilot-access-email">ChatGPT account email</label>
                <div>
                  <input id="pilot-access-email" type="email" value={accessEmail} onChange={(event) => setAccessEmail(event.currentTarget.value)} placeholder="name@example.com" autoCapitalize="none" autoComplete="email" required />
                  <button type="submit" disabled={!accessEmail.trim() || busy === "access:add"}><PlusIcon /> Add access</button>
                </div>
                <small>Access to an existing household still requires a separate household invitation.</small>
              </form>
              <div className="admin-access-list">
                {accessEntries.map((entry) => (
                  <article key={entry.email}>
                    <div>
                      <strong>{entry.email}</strong>
                      <small>Added {compactDate(entry.createdAt)}{entry.addedByEmail ? ` by ${entry.addedByEmail}` : ""}</small>
                    </div>
                    <div className="admin-access-badges">
                      {entry.hasMembership ? <span>Household member</span> : null}
                      {entry.hasPendingInvitation ? <span>Invitation pending</span> : null}
                    </div>
                    <button type="button" className="admin-access-remove" onClick={() => void removePilotAccess(entry)} disabled={busy === `access:remove:${entry.email}`} aria-label={`Remove pilot access for ${entry.email}`}><TrashIcon /> Remove</button>
                  </article>
                ))}
                {accessEntries.length === 0 ? <div className="admin-empty">No email addresses have been preapproved yet.</div> : null}
              </div>
            </section>

            <section className="admin-section">
              <div className="admin-section-heading">
                <div><h2>Active households</h2><p>{plural(activeHouseholds.length, "household")}</p></div>
              </div>
              <div className="admin-household-list">
                {activeHouseholds.map((household) => (
                  <article className="admin-household" key={household.id}>
                    <div className="admin-household-summary">
                      <span className="admin-household-icon"><HomeIcon /></span>
                      <div className="admin-household-title">
                        <h3>{household.name}</h3>
                        <p>{household.ownerName || household.ownerEmail}<span>{household.ownerName ? household.ownerEmail : "Owner"}</span></p>
                      </div>
                      <dl className="admin-household-counts">
                        <div><dt>Items</dt><dd>{household.activeItemCount}</dd></div>
                        <div><dt>Freezers</dt><dd>{household.freezerCount}</dd></div>
                        <div><dt>Drawers</dt><dd>{household.drawerCount}</dd></div>
                        <div><dt>Members</dt><dd>{household.memberCount}</dd></div>
                      </dl>
                    </div>

                    <div className="admin-household-meta">Created {compactDate(household.createdAt)} · Updated {compactDate(household.updatedAt)}</div>

                    <details className="admin-membership">
                      <summary><span><PersonIcon /> Membership</span><small>{plural(household.memberCount, "member")}{household.pendingInvitations?.length ? ` · ${plural(household.pendingInvitations.length, "invitation")}` : ""}</small></summary>
                      <div className="admin-membership-body">
                        <form className="admin-membership-form" onSubmit={(event) => void addHouseholdMembership(event, household)}>
                          <label htmlFor={`membership-email-${household.id}`}>Add an existing user or create an invitation</label>
                          <div>
                            <input id={`membership-email-${household.id}`} type="email" value={membershipEmails[household.id] || ""} onChange={(event) => setMembershipEmails((current) => ({ ...current, [household.id]: event.currentTarget.value }))} placeholder="ChatGPT account email" autoCapitalize="none" required />
                            <button type="submit" disabled={busy === `member:add:${household.id}`}><PlusIcon /> Add or invite</button>
                          </div>
                        </form>
                        <div className="admin-member-list">
                          {(household.members || []).map((member) => {
                            const armed = memberRemoval?.householdId === household.id && memberRemoval.memberId === member.id;
                            return (
                              <article key={member.id}>
                                <span className="admin-member-avatar"><PersonIcon /></span>
                                <div><strong>{member.fullName || member.email}</strong><small>{member.email} · {member.isOwner ? "Owner" : `Joined ${compactDate(member.joinedAt)}`}</small></div>
                                {member.isOwner ? <span className="admin-owner-badge">Owner</span> : (
                                  <button className={armed ? "armed" : ""} type="button" disabled={busy === `member:remove:${household.id}:${member.id}`} onClick={() => void removeHouseholdMembership(household, member)}>{armed ? "Confirm remove" : <><TrashIcon /> Remove</>}</button>
                                )}
                              </article>
                            );
                          })}
                        </div>
                        {household.pendingInvitations?.length ? (
                          <div className="admin-pending-invitations">
                            <strong>Pending invitations</strong>
                            {household.pendingInvitations.map((invitation) => (
                              <article key={invitation.id}>
                                <div><strong>{invitation.email}</strong><small>Expires {compactDate(invitation.expiresAt)}</small></div>
                                <button type="button" disabled={busy === `invitation:revoke:${invitation.id}`} onClick={() => void revokeHouseholdInvitation(household, invitation)}><TrashIcon /> Revoke</button>
                              </article>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </details>

                    {editingId === household.id ? (
                      <form className="admin-inline-form" onSubmit={(event) => void renameHousehold(event, household)}>
                        <label><span>Household name</span><input value={nameDraft} onChange={(event) => setNameDraft(event.currentTarget.value)} maxLength={60} autoFocus /></label>
                        <button type="submit" disabled={busy === `rename:${household.id}`}>Save name</button>
                        <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                      </form>
                    ) : null}

                    {confirmation?.householdId === household.id ? (
                      <div className="admin-confirmation">
                        <div>
                          <strong>{confirmation.action === "reset" ? "Reset this inventory?" : "Archive this household?"}</strong>
                          <p>{confirmation.action === "reset" ? "All active items will become recoverable backup tombstones. Freezers, drawers and members stay in place." : "The household disappears for every member and all active items become backup tombstones."}</p>
                        </div>
                        <label><span>Type <b>{household.name}</b> to confirm</span><input value={confirmation.typedName} onChange={(event) => setConfirmation({ ...confirmation, typedName: event.currentTarget.value })} autoCapitalize="none" /></label>
                        <div>
                          <button type="button" className="admin-danger" disabled={confirmation.typedName !== household.name || Boolean(busy)} onClick={() => void confirmHouseholdAction(household)}>{confirmation.action === "reset" ? "Reset inventory" : "Archive household"}</button>
                          <button type="button" onClick={() => setConfirmation(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="admin-household-actions">
                        <button type="button" onClick={() => { setEditingId(household.id); setNameDraft(household.name); }}><Pencil1Icon /> Rename</button>
                        <button type="button" onClick={() => setConfirmation({ householdId: household.id, action: "reset", typedName: "" })} disabled={household.activeItemCount === 0}><ReloadIcon /> Reset inventory</button>
                        <button type="button" className="admin-danger-link" onClick={() => setConfirmation({ householdId: household.id, action: "delete", typedName: "" })}><TrashIcon /> Archive</button>
                      </div>
                    )}
                  </article>
                ))}
                {activeHouseholds.length === 0 ? <div className="admin-empty">There are no active households.</div> : null}
              </div>
            </section>

            <section className="admin-section admin-feedback-section">
              <div className="admin-section-heading">
                <div><h2>Recent feedback</h2><p>Sanitized diagnostics are retained for 60 days</p></div>
                <span className="admin-feedback-count">{plural(overview.feedback.length, "report")}</span>
              </div>
              {overview.feedback.length ? (
                <div className="admin-feedback-list">
                  {overview.feedback.map((report) => {
                    const errors = report.recentEvents.filter((event) => event.level === "error");
                    const viewport = report.appContext.viewport as { width?: number; height?: number } | undefined;
                    return (
                      <article className="admin-feedback" key={report.id}>
                        <span className="admin-feedback-icon"><ChatBubbleIcon /></span>
                        <div className="admin-feedback-body">
                          <div className="admin-feedback-meta">
                            <strong>{report.reference}</strong>
                            <span>{compactDate(report.createdAt)}</span>
                          </div>
                          <p>{report.message}</p>
                          <small>{report.userName || report.userEmail} · {report.householdName || "No active household"}{report.attachmentCount ? " · Photo attached" : ""}</small>
                          <details>
                            <summary>Technical context</summary>
                            <dl>
                              <div><dt>Session</dt><dd>{report.sessionId.slice(0, 12)}…</dd></div>
                              <div><dt>Display</dt><dd>{String(report.appContext.displayMode || "unknown")}</dd></div>
                              <div><dt>Viewport</dt><dd>{viewport?.width && viewport?.height ? `${viewport.width} × ${viewport.height}` : "unknown"}</dd></div>
                              <div><dt>Recent events</dt><dd>{report.recentEvents.length}</dd></div>
                              <div><dt>Recent errors</dt><dd>{errors.length}</dd></div>
                              <div><dt>Attachments</dt><dd>{report.attachmentCount}</dd></div>
                            </dl>
                          </details>
                        </div>
                        <a className="admin-feedback-download" href={`/api/operator/admin/feedback/${report.id}/export`} download>Download diagnostics</a>
                      </article>
                    );
                  })}
                </div>
              ) : <div className="admin-empty">No feedback has been submitted in the last 60 days.</div>}
            </section>

            <section className="admin-section admin-backup-section">
              <div className="admin-section-heading">
                <div><h2>Backup operations</h2><p>Last successful mirror: {compactDate(overview.backup.lastSuccessAt)}</p></div>
                <span className="admin-backup-state" data-state={overview.backup.state}>{overview.backup.state === "current" ? "Up to date" : overview.backup.state === "pending" ? "Pending" : "Attention required"}</span>
              </div>
              <div className="admin-backup-actions">
                <button type="button" onClick={() => void runBackupAction("retry")} disabled={Boolean(busy)}><ReloadIcon /> Retry pending</button>
                <button type="button" onClick={() => void runBackupAction("schema")} disabled={Boolean(busy)}><CheckCircledIcon /> Verify Sheet</button>
                <button type="button" onClick={() => void runBackupAction("reconcile")} disabled={Boolean(busy)}><ArchiveIcon /> Reconcile all</button>
              </div>
            </section>

            {archivedHouseholds.length ? (
              <section className="admin-section admin-archived-section">
                <div className="admin-section-heading"><div><h2>Archived households</h2><p>Read-only operational history</p></div></div>
                <div className="admin-archived-list">
                  {archivedHouseholds.map((household) => <div key={household.id}><span><strong>{household.name}</strong><small>{household.ownerEmail}</small></span><span>Archived {compactDate(household.deletedAt)}</span></div>)}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
