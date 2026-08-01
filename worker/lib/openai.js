import { HttpError, nowIso, sha256Hex, uuid } from "./http.js";
import { requireMembership } from "./auth.js";

const PER_CALL_ESTIMATE_MICROUSD = 50_000;

export function labelLimitReason({ userMinute, userDay, householdDay, ipHour, globalDay, monthlyCost, cap }) {
  if (userMinute >= 5) return "user_minute";
  if (userDay >= 25) return "user_day";
  if (householdDay >= 100) return "household_day";
  if (ipHour >= 30) return "ip_hour";
  if (globalDay >= 500) return "global_day";
  if (monthlyCost + PER_CALL_ESTIMATE_MICROUSD > cap) return "monthly_budget";
  return null;
}

export function validateLabelSuggestion(suggestion) {
  return Boolean(
    typeof suggestion?.label === "string" &&
      suggestion.label.trim() &&
      suggestion.label.length <= 80 &&
      typeof suggestion.confidence === "number" &&
      suggestion.confidence >= 0 &&
      suggestion.confidence <= 1,
  );
}

function startOfUtcDay() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function startOfUtcMonth() {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function usageCount(env, where, bindings) {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ai_usage_events WHERE ${where} AND status = 'started'`,
  )
    .bind(...bindings)
    .first();
  return Number(result?.count || 0);
}

async function recordUsage(env, data) {
  await env.DB.prepare(
    `INSERT INTO ai_usage_events
      (id, user_id, household_id, ip_hash, status, input_tokens, output_tokens, estimated_cost_microusd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uuid(),
      data.userId,
      data.householdId,
      data.ipHash,
      data.status,
      data.inputTokens || 0,
      data.outputTokens || 0,
      data.estimatedCostMicrousd || 0,
      nowIso(),
    )
    .run();
}

async function enforceLimits(env, userId, householdId, ipHash) {
  const [userMinute, userDay, householdDay, ipHour, globalDay, monthly] = await Promise.all([
    usageCount(env, "user_id = ? AND created_at >= ?", [userId, minutesAgo(1)]),
    usageCount(env, "user_id = ? AND created_at >= ?", [userId, startOfUtcDay()]),
    usageCount(env, "household_id = ? AND created_at >= ?", [householdId, startOfUtcDay()]),
    usageCount(env, "ip_hash = ? AND created_at >= ?", [ipHash, minutesAgo(60)]),
    usageCount(env, "created_at >= ?", [startOfUtcDay()]),
    env.DB.prepare(
      "SELECT COALESCE(SUM(estimated_cost_microusd), 0) AS cost FROM ai_usage_events WHERE created_at >= ? AND status = 'succeeded'",
    )
      .bind(startOfUtcMonth())
      .first(),
  ]);

  const cap = Number(env.AI_MONTHLY_CAP_MICROUSD || 25_000_000);
  const reason = labelLimitReason({
    userMinute,
    userDay,
    householdDay,
    ipHour,
    globalDay,
    monthlyCost: Number(monthly?.cost || 0),
    cap,
  });
  if (reason && reason !== "monthly_budget") {
    await recordUsage(env, { userId, householdId, ipHash, status: "rejected" });
    throw new HttpError(429, "label_rate_limited", "Label suggestions are temporarily limited; type a label instead");
  }
  if (reason === "monthly_budget") {
    await recordUsage(env, { userId, householdId, ipHash, status: "rejected" });
    throw new HttpError(503, "label_budget_reached", "AI labels are paused for this month; manual labels still work");
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function outputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const entry of response.output || []) {
    for (const content of entry.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

export async function generateLabel(request, env, user, input) {
  if (!env.OPENAI_API_KEY) throw new HttpError(503, "label_unavailable", "AI labels are not configured");
  await requireMembership(env, user.id, input.householdId);
  const media = await env.DB.prepare(
    `SELECT id, household_id, r2_key, mime_type FROM media
     WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
  )
    .bind(input.imageId, input.householdId)
    .first();
  if (!media) throw new HttpError(404, "image_not_found", "Image not found");
  const object = await env.MEDIA.get(media.r2_key);
  if (!object) throw new HttpError(404, "image_not_found", "Image not found");

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const ipHash = await sha256Hex(`${env.RATE_LIMIT_SALT || "icebox"}:${ip}`);
  await enforceLimits(env, user.id, input.householdId, ipHash);
  await recordUsage(env, {
    userId: user.id,
    householdId: input.householdId,
    ipHash,
    status: "started",
    estimatedCostMicrousd: PER_CALL_ESTIMATE_MICROUSD,
  });

  const bytes = new Uint8Array(await object.arrayBuffer());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        service_tier: "priority",
        store: false,
        reasoning: { effort: "medium" },
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "freezer_label",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string", minLength: 1, maxLength: 80 },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["label", "confidence"],
            },
          },
        },
        max_output_tokens: 200,
        safety_identifier: await sha256Hex(`icebox:${user.id}`),
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Suggest a short, plain-English freezer label for the visible food. Do not invent a brand, quantity, ingredients, contents, or preparation detail that is not clearly visible. Return only the requested structured result.",
              },
              {
                type: "input_image",
                image_url: `data:${media.mime_type};base64,${bytesToBase64(bytes)}`,
                detail: "high",
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    await recordUsage(env, { userId: user.id, householdId: input.householdId, ipHash, status: "failed" });
    if (error?.name === "AbortError") throw new HttpError(504, "label_timeout", "Label generation timed out; type a label instead");
    throw new HttpError(502, "label_failed", "Label generation failed; type a label instead");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    await recordUsage(env, { userId: user.id, householdId: input.householdId, ipHash, status: "failed" });
    console.error(JSON.stringify({ event: "openai_label_failed", status: response.status }));
    throw new HttpError(response.status === 429 ? 429 : 502, "label_failed", "Label generation failed; type a label instead");
  }
  const result = await response.json();
  let suggestion;
  try {
    suggestion = JSON.parse(outputText(result));
  } catch {
    throw new HttpError(502, "label_invalid", "The label response was invalid; type a label instead");
  }
  if (!validateLabelSuggestion(suggestion)) {
    throw new HttpError(502, "label_invalid", "The label response was invalid; type a label instead");
  }
  await recordUsage(env, {
    userId: user.id,
    householdId: input.householdId,
    ipHash,
    status: "succeeded",
    inputTokens: Number(result.usage?.input_tokens || 0),
    outputTokens: Number(result.usage?.output_tokens || 0),
    estimatedCostMicrousd: PER_CALL_ESTIMATE_MICROUSD,
  });
  return { label: suggestion.label.trim(), confidence: suggestion.confidence };
}
