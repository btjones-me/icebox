import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://icebox.example";

function identityHeaders(id, email, extra = {}) {
  return {
    "oai-authenticated-user-id": id,
    "oai-authenticated-user-email": email,
    ...extra,
  };
}

function mutationHeaders(id, email) {
  return identityHeaders(id, email, { origin, "content-type": "application/json" });
}

test("public Sites session and pilot admission remain server-authoritative", async (context) => {
  const miniflare = new Miniflare({
    rootPath: projectRoot,
    scriptPath: "worker/index.js",
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-08-01",
    bindings: {
      PILOT_ALLOWED_EMAILS: "environment@example.com",
      OPERATOR_CHATGPT_USER_ID: "operator-user",
    },
    d1Databases: { DB: "icebox-auth-test" },
    r2Buckets: { MEDIA: "icebox-auth-media" },
    d1Persist: false,
    r2Persist: false,
  });
  context.after(() => miniflare.dispose());

  let response = await miniflare.dispatchFetch(`${origin}/api/session`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });

  response = await miniflare.dispatchFetch(`${origin}/api/session`, {
    headers: identityHeaders("stranger-user", "stranger@example.com"),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authenticated: true,
    admitted: false,
    user: { email: "stranger@example.com", fullName: null },
  });

  response = await miniflare.dispatchFetch(`${origin}/api/bootstrap`, {
    headers: identityHeaders("stranger-user", "stranger@example.com"),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "pilot_access_required");

  response = await miniflare.dispatchFetch(`${origin}/api/session`, {
    headers: identityHeaders("environment-user", "environment@example.com"),
  });
  assert.equal((await response.json()).admitted, true);

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/access`, {
    method: "POST",
    headers: mutationHeaders("operator-user", "operator@example.com"),
    body: JSON.stringify({ email: "  Pilot.User@Example.com  " }),
  });
  const added = await response.json();
  assert.equal(response.status, 201);
  assert.equal(added.entry.email, "pilot.user@example.com");
  assert.equal(added.created, true);

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/access`, {
    method: "POST",
    headers: mutationHeaders("operator-user", "operator@example.com"),
    body: JSON.stringify({ email: "pilot.user@example.com" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).created, false);

  response = await miniflare.dispatchFetch(`${origin}/api/session`, {
    headers: identityHeaders("pilot-user", "pilot.user@example.com"),
  });
  assert.equal((await response.json()).admitted, true);

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/access`, {
    headers: identityHeaders("operator-user", "operator@example.com"),
  });
  const accessList = await response.json();
  assert.equal(response.status, 200);
  assert.equal(accessList.entries[0].email, "pilot.user@example.com");

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/access`, {
    headers: identityHeaders("pilot-user", "pilot.user@example.com"),
  });
  assert.equal(response.status, 403);

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/access/${encodeURIComponent("pilot.user@example.com")}`, {
    method: "DELETE",
    headers: mutationHeaders("operator-user", "operator@example.com"),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    removed: true,
    hasMembership: false,
    hasPendingInvitation: false,
    remainsAdmitted: false,
  });

  response = await miniflare.dispatchFetch(`${origin}/api/session`, {
    headers: identityHeaders("pilot-user", "pilot.user@example.com"),
  });
  assert.equal((await response.json()).admitted, false);

  response = await miniflare.dispatchFetch(`${origin}/api/households`, {
    method: "POST",
    headers: mutationHeaders("operator-user", "operator@example.com"),
    body: JSON.stringify({ name: "Invite House", freezers: [{ name: "Kitchen", drawerCount: 1 }] }),
  });
  const household = await response.json();
  assert.equal(response.status, 201);

  response = await miniflare.dispatchFetch(`${origin}/api/households/${household.household.id}/invitations`, {
    method: "POST",
    headers: mutationHeaders("operator-user", "operator@example.com"),
    body: JSON.stringify({ email: "member@example.com" }),
  });
  const invitation = await response.json();
  assert.equal(response.status, 201);

  response = await miniflare.dispatchFetch(`${origin}/api/session`, {
    headers: identityHeaders("member-user", "member@example.com"),
  });
  assert.equal((await response.json()).admitted, true);

  response = await miniflare.dispatchFetch(`${origin}/api/bootstrap`, {
    headers: identityHeaders("member-user", "member@example.com"),
  });
  const invitedBootstrap = await response.json();
  assert.equal(response.status, 200);
  assert.equal(invitedBootstrap.invitations[0].id, invitation.invitation.id);

  response = await miniflare.dispatchFetch(`${origin}/api/invitations/${invitation.invitation.id}/accept`, {
    method: "POST",
    headers: mutationHeaders("member-user", "member@example.com"),
    body: "{}",
  });
  assert.equal(response.status, 200);

  response = await miniflare.dispatchFetch(`${origin}/api/session`, {
    headers: identityHeaders("member-user", "member@example.com"),
  });
  assert.equal((await response.json()).admitted, true);

  response = await miniflare.dispatchFetch(`${origin}/api/bootstrap`, {
    headers: identityHeaders("member-user", "member@example.com"),
  });
  const memberBootstrap = await response.json();
  assert.equal(response.status, 200);
  assert.equal(memberBootstrap.households[0].id, household.household.id);
});
