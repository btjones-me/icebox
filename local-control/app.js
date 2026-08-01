const labels = {
  onboarding: "Fresh onboarding",
  "empty-household": "Empty household",
  "demo-inventory": "Demo inventory",
};

const ids = {
  households: "household-count",
  freezers: "freezer-count",
  drawers: "drawer-count",
  items: "item-count",
  images: "image-count",
  aiCalls: "ai-count",
};

const message = document.querySelector("#message");
const actionButtons = [...document.querySelectorAll("[data-action]")];

function setBusy(busy) {
  for (const button of actionButtons) button.disabled = busy;
  document.querySelector("#refresh").disabled = busy;
}

function render(state) {
  document.querySelector("#fixture").textContent = labels[state.fixture] || state.fixture;
  document.querySelector("#status-dot").dataset.ready = "true";
  document.querySelector("#api-status").textContent = state.openaiConfigured
    ? "D1 + R2 ready · OpenAI configured"
    : "D1 + R2 ready · OpenAI key missing";
  for (const [key, id] of Object.entries(ids)) {
    document.querySelector(`#${id}`).textContent = state.counts[key] ?? 0;
  }
}

async function request(action, method = "GET") {
  const response = await fetch(`/api/${action}`, { method });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status})`);
  return data;
}

async function refresh() {
  setBusy(true);
  try {
    render(await request("state"));
  } catch (error) {
    document.querySelector("#fixture").textContent = "API unavailable";
    document.querySelector("#api-status").textContent = error.message;
    document.querySelector("#status-dot").dataset.ready = "false";
  } finally {
    setBusy(false);
  }
}

for (const button of actionButtons) {
  button.addEventListener("click", async () => {
    const action = button.dataset.action;
    const label = button.querySelector("strong").textContent;
    if (!window.confirm(`${label}? This replaces all current local Icebox data.`)) return;
    setBusy(true);
    message.textContent = "Updating the local fixture…";
    try {
      render(await request(action, "POST"));
      message.textContent = `${label} complete. Reload Icebox to use the new state.`;
    } catch (error) {
      message.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });
}

document.querySelector("#refresh").addEventListener("click", refresh);
void refresh();
