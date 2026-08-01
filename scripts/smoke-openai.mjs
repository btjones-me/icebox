#!/usr/bin/env node
import { readFile } from "node:fs/promises";

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
const imagePath = process.argv[2] || "public/assets/food/chicken-curry.png";
const bytes = await readFile(imagePath);
const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
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
    input: [{ role: "user", content: [
      { type: "input_text", text: "Suggest a concise freezer label for the food. Do not invent details." },
      { type: "input_image", image_url: `data:image/png;base64,${bytes.toString("base64")}`, detail: "high" },
    ] }],
  }),
});
if (!response.ok) {
  const body = await response.json().catch(() => ({}));
  throw new Error(`OpenAI smoke test failed (${response.status}, ${body.error?.code || "unknown"})`);
}
const result = await response.json();
const output = result.output_text || result.output?.flatMap((entry) => entry.content || []).find((entry) => entry.type === "output_text")?.text;
console.log(JSON.stringify({ model: result.model, serviceTier: result.service_tier, suggestion: JSON.parse(output), usage: result.usage }, null, 2));
