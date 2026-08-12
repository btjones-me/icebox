import { HttpError, nowIso, uuid } from "./http.js";

export async function listBootstrap(env, user) {
  const households = await env.DB.prepare(
    `SELECT h.id, h.name, h.owner_user_id AS ownerUserId, owner.email AS ownerEmail,
            COUNT(DISTINCT hm2.user_id) AS memberCount
     FROM household_members hm
     JOIN households h ON h.id = hm.household_id
     JOIN users owner ON owner.id = h.owner_user_id
     LEFT JOIN household_members hm2 ON hm2.household_id = h.id
     WHERE hm.user_id = ? AND h.deleted_at IS NULL
     GROUP BY h.id
     ORDER BY h.name COLLATE NOCASE`,
  )
    .bind(user.id)
    .all();
  const ids = (households.results || []).map((entry) => entry.id);
  let freezers = [];
  let drawers = [];
  let items = [];
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    freezers = (
      await env.DB.prepare(
        `SELECT id, household_id AS householdId, name, position, default_sort_mode AS defaultSortMode
         FROM freezers WHERE household_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY household_id, position`,
      )
        .bind(...ids)
        .all()
    ).results || [];
    const freezerIds = freezers.map((entry) => entry.id);
    if (freezerIds.length) {
      const freezerPlaceholders = freezerIds.map(() => "?").join(",");
      drawers = (
        await env.DB.prepare(
          `SELECT id, freezer_id AS freezerId, name, position, default_sort_mode AS defaultSortMode
           FROM drawers WHERE freezer_id IN (${freezerPlaceholders}) AND deleted_at IS NULL ORDER BY freezer_id, position`,
        )
          .bind(...freezerIds)
          .all()
      ).results || [];
    }
    items = (
      await env.DB.prepare(
        `SELECT i.id, i.household_id AS householdId, i.freezer_id AS freezerId, i.drawer_id AS drawerId,
                i.label, i.frozen_on AS frozenOn, i.expires_on AS expiresOn, i.notes,
                i.image_id AS imageId, i.version, i.created_at AS createdAt,
                CASE WHEN i.image_id IS NULL THEN NULL ELSE '/api/media/' || i.image_id END AS imageUrl
         FROM items i WHERE i.household_id IN (${placeholders}) AND i.deleted_at IS NULL
         ORDER BY i.updated_at DESC`,
      )
        .bind(...ids)
        .all()
    ).results || [];
  }
  const invitations = (
    await env.DB.prepare(
      `SELECT inv.id, inv.household_id AS householdId, h.name AS householdName,
              inviter.email AS invitedBy, inv.expires_at AS expiresAt
       FROM household_invitations inv
       JOIN households h ON h.id = inv.household_id
       JOIN users inviter ON inviter.id = inv.invited_by_user_id
       WHERE inv.email_normalized = ? AND inv.status = 'pending' AND inv.expires_at > ?
       ORDER BY inv.created_at`,
    )
      .bind(user.email_normalized, nowIso())
      .all()
  ).results || [];

  const backup = await backupStatus(env, ids);
  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      aiLabelEnabled: Boolean(user.ai_label_enabled),
      isOperator: Boolean(env.OPERATOR_CHATGPT_USER_ID && user.id === env.OPERATOR_CHATGPT_USER_ID),
    },
    households: households.results || [],
    freezers,
    drawers,
    items,
    invitations,
    defaultHouseholdId: user.default_household_id,
    needsOnboarding: ids.length === 0 && invitations.length === 0,
    backup,
  };
}

export async function backupStatus(env, householdIds = []) {
  const state = await env.DB.prepare(
    "SELECT last_success_at AS lastSuccessAt, last_error_code AS lastErrorCode FROM sheet_sync_state WHERE id = 1",
  ).first();
  let countResult;
  if (householdIds.length) {
    const placeholders = householdIds.map(() => "?").join(",");
    countResult = await env.DB.prepare(
      `SELECT COUNT(*) AS pendingCount, MIN(created_at) AS oldestPendingAt
       FROM sheet_outbox WHERE synced_at IS NULL AND household_id IN (${placeholders})`,
    )
      .bind(...householdIds)
      .first();
  } else {
    countResult = { pendingCount: 0, oldestPendingAt: null };
  }
  const oldest = countResult?.oldestPendingAt ? new Date(countResult.oldestPendingAt).getTime() : null;
  const attention = Boolean(state?.lastErrorCode) || (oldest && Date.now() - oldest > 86_400_000);
  const pending = Number(countResult?.pendingCount || 0);
  return {
    state: attention ? "attention" : pending ? "pending" : "current",
    pendingCount: pending,
    lastSuccessAt: state?.lastSuccessAt || null,
  };
}

export async function createHousehold(env, userId, input) {
  const owned = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM households WHERE owner_user_id = ? AND deleted_at IS NULL",
  )
    .bind(userId)
    .first();
  if (Number(owned?.count || 0) >= 3) throw new HttpError(409, "household_limit", "You can create up to three households");
  const now = nowIso();
  const householdId = uuid();
  const statements = [
    env.DB.prepare("INSERT INTO households (id, name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(
      householdId,
      input.name,
      userId,
      now,
      now,
    ),
    env.DB.prepare("INSERT INTO household_members (household_id, user_id, joined_at) VALUES (?, ?, ?)").bind(
      householdId,
      userId,
      now,
    ),
    env.DB.prepare("UPDATE users SET default_household_id = COALESCE(default_household_id, ?), updated_at = ? WHERE id = ?").bind(
      householdId,
      now,
      userId,
    ),
  ];
  const createdFreezers = [];
  const createdDrawers = [];
  input.freezers.forEach((freezer, freezerIndex) => {
    const freezerId = uuid();
    const position = freezerIndex + 1;
    createdFreezers.push({ id: freezerId, householdId, name: freezer.name || `Freezer ${position}`, position, defaultSortMode: "added" });
    statements.push(
      env.DB.prepare("INSERT INTO freezers (id, household_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
        freezerId,
        householdId,
        freezer.name || `Freezer ${position}`,
        position,
        now,
        now,
      ),
    );
    for (let drawerIndex = 0; drawerIndex < freezer.drawerCount; drawerIndex += 1) {
      const drawerId = uuid();
      const drawerPosition = drawerIndex + 1;
      createdDrawers.push({ id: drawerId, freezerId, name: `Drawer ${drawerPosition}`, position: drawerPosition, defaultSortMode: "added" });
      statements.push(
        env.DB.prepare("INSERT INTO drawers (id, freezer_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
          drawerId,
          freezerId,
          `Drawer ${drawerPosition}`,
          drawerPosition,
          now,
          now,
        ),
      );
    }
  });
  await env.DB.batch(statements);
  return {
    household: { id: householdId, name: input.name, ownerUserId: userId, memberCount: 1 },
    freezers: createdFreezers,
    drawers: createdDrawers,
  };
}

export async function validateItemLocation(env, householdId, freezerId, drawerId) {
  const row = await env.DB.prepare(
    `SELECT d.id FROM drawers d JOIN freezers f ON f.id = d.freezer_id
     WHERE d.id = ? AND f.id = ? AND f.household_id = ?
       AND d.deleted_at IS NULL AND f.deleted_at IS NULL`,
  )
    .bind(drawerId, freezerId, householdId)
    .first();
  if (!row) throw new HttpError(400, "invalid_location", "Choose a valid freezer drawer");
}

export async function mirrorRowForItem(env, itemId, statusOverride) {
  const row = await env.DB.prepare(
    `SELECT i.id AS item_id, i.version AS item_version,
            CASE WHEN i.deleted_at IS NULL THEN 'active' ELSE 'deleted' END AS status,
            h.id AS household_id, h.name AS household_name, owner.email AS household_owner_email,
            f.id AS freezer_id, f.name AS freezer_name,
            d.id AS drawer_id, d.name AS drawer_name, d.position AS drawer_position,
            i.label, i.frozen_on, i.expires_on, i.notes,
            m.id AS image_id, m.r2_key AS image_storage_key,
            CASE WHEN m.id IS NULL THEN 'false' ELSE 'true' END AS image_present,
            i.created_at AS created_at_utc, i.updated_at AS updated_at_utc,
            i.deleted_at AS deleted_at_utc
     FROM items i
     JOIN households h ON h.id = i.household_id
     JOIN users owner ON owner.id = h.owner_user_id
     JOIN freezers f ON f.id = i.freezer_id
     JOIN drawers d ON d.id = i.drawer_id
     LEFT JOIN media m ON m.id = i.image_id
     WHERE i.id = ?`,
  )
    .bind(itemId)
    .first();
  if (!row) throw new HttpError(404, "item_not_found", "Item not found");
  const mirroredAt = nowIso();
  const object = {
    schema_version: 3,
    ...row,
    status: statusOverride || row.status,
    expires_on: row.expires_on || "",
    mirrored_at_utc: mirroredAt,
  };
  return { object, values: Object.values(object) };
}

export async function enqueueMirror(env, itemId, householdId, version, row) {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO sheet_outbox
       (item_id, household_id, item_version, payload_json, attempt_count, next_attempt_at, created_at, updated_at, synced_at, last_error_code)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, NULL, NULL)
     ON CONFLICT(item_id) DO UPDATE SET
       household_id = excluded.household_id,
       item_version = excluded.item_version,
       payload_json = excluded.payload_json,
       attempt_count = 0,
       next_attempt_at = excluded.next_attempt_at,
       updated_at = excluded.updated_at,
       synced_at = NULL,
       last_error_code = NULL
     WHERE excluded.item_version >= sheet_outbox.item_version`,
  )
    .bind(itemId, householdId, version, JSON.stringify(row), now, now, now)
    .run();
}

export async function getItemForUser(env, itemId, userId) {
  const item = await env.DB.prepare(
    `SELECT i.* FROM items i
     JOIN household_members hm ON hm.household_id = i.household_id
     WHERE i.id = ? AND hm.user_id = ? AND i.deleted_at IS NULL`,
  )
    .bind(itemId, userId)
    .first();
  if (!item) throw new HttpError(404, "item_not_found", "Item not found");
  return item;
}

export async function serializeItem(env, itemId) {
  return env.DB.prepare(
    `SELECT i.id, i.household_id AS householdId, i.freezer_id AS freezerId, i.drawer_id AS drawerId,
            i.label, i.frozen_on AS frozenOn, i.expires_on AS expiresOn, i.notes,
            i.image_id AS imageId, i.version, i.created_at AS createdAt,
            CASE WHEN i.image_id IS NULL THEN NULL ELSE '/api/media/' || i.image_id END AS imageUrl
     FROM items i WHERE i.id = ?`,
  )
    .bind(itemId)
    .first();
}
