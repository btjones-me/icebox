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

  const protectedRequests = [
    { path: "/api/items?householdId=house-x", method: "GET" },
    { path: "/api/media/image-x", method: "GET" },
    { path: "/api/feedback", method: "POST", body: "{}" },
    { path: "/api/feedback/feedback-test/photo", method: "POST", body: "camera-bytes" },
    { path: "/api/operator/admin/households", method: "GET" },
  ];
  for (const request of protectedRequests) {
    response = await miniflare.dispatchFetch(`${origin}${request.path}`, {
      method: request.method,
      headers: request.method === "POST" ? { origin, "content-type": "application/json" } : {},
      body: request.body,
    });
    assert.equal(response.status, 401, `${request.path} must reject anonymous callers`);

    response = await miniflare.dispatchFetch(`${origin}${request.path}`, {
      method: request.method,
      headers: request.method === "POST"
        ? mutationHeaders("stranger-user", "stranger@example.com")
        : identityHeaders("stranger-user", "stranger@example.com"),
      body: request.body,
    });
    assert.equal(response.status, 403, `${request.path} must reject unapproved callers`);
  }

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

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/households`, {
    headers: identityHeaders("operator-user", "operator@example.com"),
  });
  let adminOverview = await response.json();
  const managedHousehold = adminOverview.households.find((entry) => entry.id === household.household.id);
  assert.equal(response.status, 200);
  assert.equal(managedHousehold.members.length, 2);
  assert.equal(managedHousehold.members.find((entry) => entry.id === "operator-user").isOwner, true);
  assert.equal(managedHousehold.members.find((entry) => entry.id === "member-user").email, "member@example.com");

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/households/${household.household.id}/members/operator-user`, {
    method: "DELETE",
    headers: mutationHeaders("operator-user", "operator@example.com"),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "cannot_remove_owner");

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/households/${household.household.id}/members/member-user`, {
    method: "DELETE",
    headers: mutationHeaders("operator-user", "operator@example.com"),
  });
  assert.equal(response.status, 200);

  response = await miniflare.dispatchFetch(`${origin}/api/session`, {
    headers: identityHeaders("member-user", "member@example.com"),
  });
  assert.equal((await response.json()).admitted, false);

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/households/${household.household.id}/members`, {
    method: "POST",
    headers: mutationHeaders("operator-user", "operator@example.com"),
    body: JSON.stringify({ email: "member@example.com" }),
  });
  const restoredMember = await response.json();
  assert.equal(response.status, 201);
  assert.equal(restoredMember.status, "member");
  assert.equal(restoredMember.member.id, "member-user");

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/households/${household.household.id}/members`, {
    method: "POST",
    headers: mutationHeaders("operator-user", "operator@example.com"),
    body: JSON.stringify({ email: "new.person@example.com" }),
  });
  const pendingMembership = await response.json();
  assert.equal(response.status, 201);
  assert.equal(pendingMembership.status, "invitation");

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/households`, {
    headers: identityHeaders("operator-user", "operator@example.com"),
  });
  adminOverview = await response.json();
  assert.equal(adminOverview.households.find((entry) => entry.id === household.household.id).pendingInvitations[0].email, "new.person@example.com");

  response = await miniflare.dispatchFetch(`${origin}/api/operator/admin/households/${household.household.id}/invitations/${pendingMembership.invitation.id}`, {
    method: "DELETE",
    headers: mutationHeaders("operator-user", "operator@example.com"),
  });
  assert.equal(response.status, 200);

  response = await miniflare.dispatchFetch(`${origin}/api/session`, {
    headers: identityHeaders("new-person", "new.person@example.com"),
  });
  assert.equal((await response.json()).admitted, false);
});
