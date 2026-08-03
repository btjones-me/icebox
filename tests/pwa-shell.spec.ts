import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("anonymous visitors see the dispatch-owned ChatGPT sign-in route", async ({ page }) => {
  await page.route("**/api/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Your freezer, clearly organised." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with ChatGPT" })).toHaveAttribute("href", "/signin-with-chatgpt?return_to=%2F");
  await expect(page.getByText("Alder House", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("native-app-shell")).toHaveCount(0);
});

test("signed-in visitors without admission see the invite-only state", async ({ page }) => {
  await page.route("**/api/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, admitted: false, user: { email: "waiting@example.com", fullName: "Waiting User" } }),
  }));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Icebox is currently invite-only" })).toBeVisible();
  await expect(page.getByText("waiting@example.com", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign out or use another account" })).toHaveAttribute("href", "/signout-with-chatgpt?return_to=%2F");
  await expect(page.getByText("Alder House", { exact: true })).toHaveCount(0);
});

test("authorization failure clears private cache without rendering inventory", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("icebox:last-user-id", "cached-user");
    const request = indexedDB.open("icebox-private-cache-v2", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("bootstrap");
    request.onsuccess = () => {
      const transaction = request.result.transaction("bootstrap", "readwrite");
      transaction.objectStore("bootstrap").put({ user: { id: "cached-user" }, items: [{ label: "Secret cached lasagne" }] }, "cached-user");
      transaction.oncomplete = () => request.result.close();
    };
  });
  await page.route("**/api/session", (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "pilot_access_required" } }),
  }));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Your freezer, clearly organised." })).toBeVisible();
  await expect(page.getByText("Secret cached lasagne", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("icebox:last-user-id"))).toBeNull();
});

test("a genuine network outage opens authenticated cached inventory read-only", async ({ page }) => {
  await page.goto("/tests/runtime-fixture.html");
  await page.evaluate(async () => {
    const cached = {
      user: { id: "offline-user", email: "offline@example.com", fullName: "Offline User", aiLabelEnabled: true, isOperator: false },
      households: [{ id: "offline-house", name: "Offline House", ownerEmail: "offline@example.com", memberCount: 1 }],
      freezers: [{ id: "offline-freezer", householdId: "offline-house", name: "Offline Freezer", position: 1 }],
      drawers: [{ id: "offline-drawer", freezerId: "offline-freezer", name: "Top Drawer", position: 1 }],
      items: [{ id: "offline-item", freezerId: "offline-freezer", drawerId: "offline-drawer", label: "Cached vegetable soup", frozenOn: "2026-08-01", createdAt: "2026-08-01T12:00:00.000Z", notes: "", version: 1 }],
      invitations: [], defaultHouseholdId: "offline-house", backup: { state: "current", pendingCount: 0 },
    };
    localStorage.setItem("icebox:last-user-id", "offline-user");
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("icebox-private-cache-v2", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("bootstrap");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("bootstrap", "readwrite");
        transaction.objectStore("bootstrap").put(cached, "offline-user");
        transaction.oncomplete = () => { request.result.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.route("**/api/session", (route) => route.abort("internetdisconnected"));
  await page.goto("/");

  await expect(page.getByText("Cached vegetable soup", { exact: true })).toBeVisible();
  await expect(page.getByTestId("add-item-button")).toBeDisabled();
});

test("production app fills a real mobile viewport without simulator chrome", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByTestId("native-app-shell")).toBeVisible();
  await expect(page.getByTestId("phone-frame")).toHaveCount(0);
  await expect(page.getByTestId("device-picker")).toHaveCount(0);
  await expect(page.getByTestId("keyboard-dock")).toHaveCount(0);
  await expect(page.locator(".status-bar")).toHaveCount(0);

  const shellBox = await page.getByTestId("native-app-shell").boundingBox();
  expect(shellBox?.width).toBe(390);
  expect(shellBox?.height).toBe(844);
  await expect(page.getByTestId("add-item-button")).toBeVisible();

  await page.getByTestId("add-item-button").click();
  const sheet = page.getByTestId("bottom-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-runtime", "native");
  await page.getByLabel("Label").click();
  await expect(page.getByTestId("keyboard-dock")).toHaveCount(0);
});

test("shared sheet back control closes item and settings modals", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("add-item-button").click();
  await expect(page.getByRole("dialog", { name: "Add an item" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add an item" })).toBeHidden();

  await page.getByRole("button", { name: /Open settings/ }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
});

test("item label and notes accept real keystrokes without crashing", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("add-item-button").click();

  const label = page.locator("#item-label");
  const notes = page.locator("#item-notes");
  await label.pressSequentially("Test soup");
  await notes.pressSequentially("Two portions. Reheat thoroughly.");

  await expect(label).toHaveValue("Test soup");
  await expect(notes).toHaveValue("Two portions. Reheat thoroughly.");
  await expect(page.getByRole("dialog", { name: "Add an item" })).toBeVisible();
  expect(pageErrors).toEqual([]);

  await page.getByRole("button", { name: "Add to freezer" }).click();
  await expect(page.getByText("Test soup", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("mobile forms prevent Safari focus zoom and keep feedback reachable above the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 695 });
  await page.goto("/");
  await page.getByTestId("add-item-button").click();

  await expect(page.locator("#item-date")).toHaveCSS("font-size", "16px");
  await expect(page.locator("#item-expiry-date")).toHaveCSS("font-size", "16px");
  await expect(page.locator("#item-notes")).toHaveCSS("font-size", "16px");
  await expect(page.locator(".date-grid")).toHaveCSS("max-width", "100%");
  await expect(page.locator("#item-date")).toHaveCSS("max-width", "100%");
  await expect(page.locator("#item-expiry-date")).toHaveCSS("max-width", "100%");
  const dateColumns = await page.locator(".date-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(dateColumns).toBe(1);
  const expectDateFieldsContained = async () => {
    const formBox = await page.locator(".item-form").boundingBox();
    const notesBox = await page.locator("#item-notes").boundingBox();
    for (const selector of ["#item-date", "#item-expiry-date"]) {
      await expect(page.locator(selector)).toHaveCSS("padding-left", "0px");
      await expect(page.locator(selector)).toHaveCSS("padding-right", "0px");
      await expect(page.locator(selector)).toHaveCSS("text-indent", "12px");
      const dateBox = await page.locator(selector).boundingBox();
      expect(dateBox).not.toBeNull();
      expect(formBox).not.toBeNull();
      expect(notesBox).not.toBeNull();
      expect((dateBox?.x ?? 0) + (dateBox?.width ?? 0)).toBeLessThanOrEqual((formBox?.x ?? 0) + (formBox?.width ?? 0) + 0.5);
      expect(dateBox?.width).toBeCloseTo(notesBox?.width ?? 0, 0);
    }
  };
  await expectDateFieldsContained();
  const sheetTouchAction = await page.getByTestId("bottom-sheet").evaluate((element) => getComputedStyle(element).touchAction);
  expect(sheetTouchAction).toContain("pinch-zoom");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit Chicken curry" }).click();
  await expect(page.getByRole("dialog", { name: "Edit item" })).toBeVisible();
  await expectDateFieldsContained();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Open settings/ }).click();
  await page.getByRole("button", { name: "Add feedback" }).click();
  await page.locator("#feedback-message").focus();
  await page.waitForTimeout(350);
  const feedbackScroll = await page.getByRole("dialog", { name: "Add feedback" }).locator(".sheet-content").evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(feedbackScroll.scrollHeight).toBeGreaterThan(feedbackScroll.clientHeight);
});

test("photo upload generates a blank label with a spinner and preserves existing text", async ({ page }) => {
  let mediaCalls = 0;
  let aiCalls = 0;
  let releaseLabel: (() => void) | undefined;
  const labelGate = new Promise<void>((resolve) => { releaseLabel = resolve; });

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "photo-user", email: "photo@example.com", fullName: "Photo User", aiLabelEnabled: true, isOperator: false },
        households: [{ id: "house-photo", name: "Photo House", ownerEmail: "photo@example.com", memberCount: 1 }],
        freezers: [{ id: "freezer-photo", householdId: "house-photo", name: "Kitchen Freezer", position: 1 }],
        drawers: [{ id: "drawer-photo", freezerId: "freezer-photo", name: "Top Drawer", position: 1 }],
        items: [], invitations: [], defaultHouseholdId: "house-photo",
        backup: { state: "current", pendingCount: 0 },
      }),
    });
  });
  await page.route("**/api/media", async (route) => {
    mediaCalls += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: `image-${mediaCalls}`, url: "/assets/food/peas.png" }),
    });
  });
  await page.route("**/api/ai/label", async (route) => {
    aiCalls += 1;
    await labelGate;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ label: "Garden peas", confidence: 0.94 }) });
  });

  await page.goto("/");
  await page.getByTestId("add-item-button").click();
  await page.locator('input[type="file"]').setInputFiles("public/assets/food/peas.png");

  const generating = page.getByRole("button", { name: "Generating label" });
  await expect(generating).toBeVisible();
  await expect(generating.locator(".label-generation-spinner")).toBeVisible();
  await expect(generating).toBeDisabled();
  releaseLabel?.();
  await expect(page.locator("#item-label")).toHaveValue("Garden peas");
  await expect(page.getByRole("button", { name: "Generate label from photo" })).toBeVisible();
  expect(aiCalls).toBe(1);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add an item" })).toBeHidden();
  await page.getByTestId("add-item-button").click();
  const existingLabel = page.locator("#item-label");
  await existingLabel.pressSequentially("Family pizza");
  const secondUpload = page.waitForResponse((response) => response.url().endsWith("/api/media") && response.request().method() === "POST");
  await page.locator('.photo-picker input[type="file"]').setInputFiles("public/assets/food/peas.png");
  await secondUpload;
  await page.waitForTimeout(100);

  await expect(existingLabel).toHaveValue("Family pizza");
  expect(mediaCalls).toBe(2);
  expect(aiCalls).toBe(1);
});

test("a rejected photo upload removes its temporary preview before the item is saved", async ({ page }) => {
  let savedBody: Record<string, unknown> | null = null;
  await page.route("**/api/bootstrap", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: "photo-error-user", email: "photo-error@example.com", fullName: "Photo Error User", aiLabelEnabled: true, isOperator: false },
      households: [{ id: "house-photo-error", name: "Photo House", ownerEmail: "photo-error@example.com", memberCount: 1 }],
      freezers: [{ id: "freezer-photo-error", householdId: "house-photo-error", name: "Kitchen Freezer", position: 1 }],
      drawers: [{ id: "drawer-photo-error", freezerId: "freezer-photo-error", name: "Top Drawer", position: 1 }],
      items: [], invitations: [], defaultHouseholdId: "house-photo-error",
      backup: { state: "current", pendingCount: 0 },
    }),
  }));
  await page.route("**/api/media", (route) => route.fulfill({
    status: 400,
    contentType: "application/json",
    body: JSON.stringify({ requestId: "server-photo-error", error: { code: "invalid_image", message: "Use a valid JPEG, PNG, or WebP image" } }),
  }));
  await page.route("**/api/items", async (route) => {
    savedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        item: {
          id: "item-photo-error", freezerId: "freezer-photo-error", drawerId: "drawer-photo-error",
          label: savedBody.label, frozenOn: savedBody.frozenOn, notes: "", version: 1,
          createdAt: "2026-08-03T12:00:00.000Z", imageId: null,
        },
        backupPending: true,
      }),
    });
  });

  await page.goto("/");
  await page.getByTestId("add-item-button").click();
  await page.locator("#item-label").fill("Peas");
  await page.locator('.photo-picker input[type="file"]').setInputFiles("public/assets/food/peas.png");

  await expect(page.getByText("Use a valid JPEG, PNG, or WebP image", { exact: true })).toBeVisible();
  await expect(page.locator(".photo-picker img")).toHaveCount(0);
  await expect(page.getByText("Add photo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate label from photo" })).toHaveCount(0);

  await page.getByRole("button", { name: "Add to freezer" }).click();
  await expect(page.getByText("Peas", { exact: true })).toBeVisible();
  expect(savedBody).toMatchObject({ imageId: null, label: "Peas" });
});

test.describe("image input processing", () => {
  test.use({ serviceWorkers: "block" });

  test("iPhone HEIC photos and large source files are converted to compact JPEG uploads", async ({ page }) => {
    test.setTimeout(45_000);
    const uploadBodies: Buffer[] = [];
    let mediaCalls = 0;

    await page.route("**/api/bootstrap", (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "image-user", email: "image@example.com", fullName: "Image User", aiLabelEnabled: true, isOperator: false },
        households: [{ id: "house-image", name: "Image House", ownerEmail: "image@example.com", memberCount: 1 }],
        freezers: [{ id: "freezer-image", householdId: "house-image", name: "Kitchen Freezer", position: 1 }],
        drawers: [{ id: "drawer-image", freezerId: "freezer-image", name: "Top Drawer", position: 1 }],
        items: [], invitations: [], defaultHouseholdId: "house-image",
        backup: { state: "current", pendingCount: 0 },
      }),
    }));
    await page.route("**/api/media", async (route) => {
      uploadBodies.push(route.request().postDataBuffer() || Buffer.alloc(0));
      mediaCalls += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: `processed-${mediaCalls}`, url: "/assets/food/peas.png" }),
      });
    });
    await page.route("**/api/ai/label", (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ label: "Garden peas", confidence: 0.94 }),
    }));

    const heicBase64 = await readFile(new URL("./fixtures/peas.heic.b64", import.meta.url), "utf8");
    await page.goto("/");
    await page.getByTestId("add-item-button").click();
    await page.locator('.photo-picker input[type="file"]').setInputFiles({
      name: "peas.heic",
      mimeType: "image/heic",
      buffer: Buffer.from(heicBase64.trim(), "base64"),
    });
    await expect.poll(() => mediaCalls, { timeout: 30_000 }).toBe(1);
    await expect(page.getByText(/could not be (read|converted|compressed)/i)).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Add an item" })).toBeHidden();
    await page.getByTestId("add-item-button").click();
    await expect(page.getByRole("dialog", { name: "Add an item" })).toBeVisible();
    await page.locator("#item-label").fill("Large source photo");
    const png = await readFile(new URL("../public/assets/food/peas.png", import.meta.url));
    const largeSource = Buffer.concat([png, Buffer.alloc(9 * 1024 * 1024)]);
    await page.locator('.photo-picker input[type="file"]').setInputFiles({
      name: "large-source.png",
      mimeType: "image/png",
      buffer: largeSource,
    });
    await expect.poll(() => mediaCalls, { timeout: 20_000 }).toBe(2);
    await expect(page.locator("#item-label")).toHaveValue("Large source photo");

    expect(uploadBodies).toHaveLength(2);
    for (const body of uploadBodies) {
      const multipart = body.toString("latin1");
      expect(multipart).toContain("Content-Type: image/jpeg");
      expect(multipart).toContain('.jpg"');
      expect(body.byteLength).toBeLessThan(5 * 1024 * 1024 + 16 * 1024);
    }
  });
});

test("desktop app uses a responsive content canvas and desktop dialog width", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");

  const appBox = await page.getByTestId("icebox-app").boundingBox();
  expect(appBox?.width).toBeGreaterThan(850);
  expect(appBox?.width).toBeLessThanOrEqual(922);

  const addBox = await page.getByTestId("add-item-button").boundingBox();
  expect(addBox?.width).toBeLessThan(280);
  await page.getByTestId("add-item-button").click();
  const sheetBox = await page.getByTestId("bottom-sheet").boundingBox();
  expect(sheetBox?.width).toBeLessThanOrEqual(640);
  expect(sheetBox?.width).toBeGreaterThan(560);
});

test("empty drawers offer to add the first item", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Upper Drawer" }).click();
  await expect(page.getByRole("button", { name: "Add first item" })).toBeVisible();
  await expect(page.getByText("Add its first item", { exact: true })).toHaveCount(0);
});

test("sort options remain reachable on a short mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 430 });
  await page.goto("/");
  await page.getByRole("button", { name: /Sort inventory/ }).click();

  const sheetContent = page.locator(".sheet-content");
  const before = await sheetContent.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(before.overflowY).toBe("auto");
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

  await sheetContent.hover();
  await page.mouse.wheel(0, 320);
  await expect.poll(() => sheetContent.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole("radio", { name: /Default freezer view/ })).toBeVisible();
  await expect(page.locator(".sort-option strong").last()).toHaveText("Default freezer view");
});

test("sort choices open a household-wide flat list with complete locations", async ({ page }) => {
  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "sort-user", email: "sort@example.com", fullName: "Sort User", aiLabelEnabled: true, isOperator: false },
        households: [{ id: "sort-house", name: "Sort House", ownerEmail: "sort@example.com", memberCount: 1 }],
        freezers: [
          { id: "kitchen", householdId: "sort-house", name: "Kitchen Freezer", position: 1 },
          { id: "garage", householdId: "sort-house", name: "Garage Freezer", position: 2 },
        ],
        drawers: [
          { id: "top", freezerId: "kitchen", name: "Top Drawer", position: 1 },
          { id: "basket", freezerId: "garage", name: "Bottom Basket", position: 1 },
        ],
        items: [
          { id: "apple", freezerId: "kitchen", drawerId: "top", label: "Apple crumble", frozenOn: "2026-08-01", expiresOn: "2026-09-10", createdAt: "2026-08-01T10:00:00.000Z", notes: "dessert", version: 1 },
          { id: "bananas", freezerId: "garage", drawerId: "basket", label: "Bananas", frozenOn: "2026-08-03", createdAt: "2026-08-03T10:00:00.000Z", notes: "smoothies", version: 1 },
          { id: "curry", freezerId: "garage", drawerId: "basket", label: "Curry", frozenOn: "2026-08-02", expiresOn: "2026-08-12", createdAt: "2026-08-02T10:00:00.000Z", notes: "tomato", version: 1 },
        ],
        invitations: [],
        defaultHouseholdId: "sort-house",
        backup: { state: "current", pendingCount: 0 },
      }),
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: /Sort inventory/ }).click();
  await expect(page.locator(".sort-option strong").last()).toHaveText("Default freezer view");
  await page.getByRole("radio", { name: /Alphabetical/ }).click();

  const results = page.getByTestId("inventory-results");
  const resultLabels = results.locator(".item-row strong");
  await expect(results.getByText("Alphabetical", { exact: true })).toBeVisible();
  await expect(resultLabels).toHaveText(["Apple crumble", "Bananas", "Curry"]);
  await expect(results.getByText("Kitchen Freezer · Top Drawer", { exact: true })).toBeVisible();
  await expect(results.getByText("Garage Freezer · Bottom Basket", { exact: true }).first()).toBeVisible();
  await expect(results.getByRole("button", { name: "Edit Curry in Garage Freezer, Bottom Basket" })).toBeVisible();
  await expect(page.locator(".freezer-accordion")).toHaveCount(0);
  await expect(page.getByTestId("add-item-button")).toHaveText("Add item");

  await page.getByLabel("Search inventory").fill("tomato");
  await expect(resultLabels).toHaveText(["Curry"]);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(resultLabels).toHaveText(["Apple crumble", "Bananas", "Curry"]);
  await results.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".freezer-accordion")).toBeVisible();
  const defaultSortButton = page.getByRole("button", { name: "Sort inventory: Default freezer view" });
  await expect(defaultSortButton).toBeVisible();
  await expect(defaultSortButton).toBeFocused();

  await page.getByLabel("Search inventory").fill("smoothies");
  await expect(page.getByTestId("inventory-results").getByText("Garage Freezer · Bottom Basket", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Sort inventory/ }).click();
  await page.getByRole("radio", { name: /Added date/ }).click();
  await expect(page.getByTestId("inventory-results").locator(".item-row strong")).toHaveText(["Bananas", "Curry", "Apple crumble"]);
  await page.getByTestId("inventory-results").getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: /Sort inventory/ }).click();
  await page.getByRole("radio", { name: /Expiring soonest/ }).click();
  await expect(page.getByTestId("inventory-results").locator(".item-row strong")).toHaveText(["Curry", "Apple crumble", "Bananas"]);
  await page.getByRole("button", { name: /Sort inventory/ }).click();
  await page.getByRole("radio", { name: /Default freezer view/ }).click();
  await expect(page.locator(".freezer-accordion")).toBeVisible();
});

test("settings feedback submits a privacy-light diagnostic bundle", async ({ page }) => {
  let feedbackBody: Record<string, unknown> | undefined;
  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "feedback-user", email: "feedback@example.com", fullName: "Feedback User", aiLabelEnabled: true, isOperator: false },
        households: [{ id: "house-feedback", name: "Feedback House", ownerEmail: "feedback@example.com", memberCount: 1 }],
        freezers: [{ id: "freezer-feedback", householdId: "house-feedback", name: "Kitchen", position: 1 }],
        drawers: [{ id: "drawer-feedback", freezerId: "freezer-feedback", name: "Top Drawer", position: 1 }],
        items: [{ id: "private-item", freezerId: "freezer-feedback", drawerId: "drawer-feedback", label: "Private lasagne label", frozenOn: "2026-08-01", createdAt: "2026-08-01T12:00:00.000Z", notes: "Private reheating notes", version: 1 }],
        invitations: [], defaultHouseholdId: "house-feedback", backup: { state: "current", pendingCount: 0 },
      }),
    });
  });
  await page.route("**/api/telemetry", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ accepted: 1 }) });
  });
  await page.route("**/api/feedback", async (route) => {
    feedbackBody = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "feedback-1", reference: "ICE-A1B2C3D4" }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Open settings/ }).click();
  await page.getByRole("button", { name: "Add feedback" }).click();
  await page.locator("#feedback-message").fill("The sort menu could not scroll on my phone.");
  await page.getByRole("button", { name: "Send feedback" }).click();

  await expect(page.getByText("ICE-A1B2C3D4", { exact: true })).toBeVisible();
  expect(feedbackBody?.sessionId).toEqual(expect.any(String));
  expect(feedbackBody?.householdId).toBe("house-feedback");
  expect(Array.isArray(feedbackBody?.recentEvents)).toBe(true);
  const serialized = JSON.stringify(feedbackBody);
  expect(serialized).not.toContain("Private lasagne label");
  expect(serialized).not.toContain("Private reheating notes");
});

test("feedback can include one explicitly selected private photo", async ({ page }) => {
  let feedbackBody: Record<string, unknown> | undefined;
  let photoContentType = "";
  let photoBytes = 0;
  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "feedback-photo-user", email: "photo-feedback@example.com", fullName: "Photo Feedback", aiLabelEnabled: true, isOperator: false },
        households: [{ id: "house-feedback-photo", name: "Photo House", ownerEmail: "photo-feedback@example.com", memberCount: 1 }],
        freezers: [{ id: "freezer-feedback-photo", householdId: "house-feedback-photo", name: "Kitchen", position: 1 }],
        drawers: [{ id: "drawer-feedback-photo", freezerId: "freezer-feedback-photo", name: "Top Drawer", position: 1 }],
        items: [{ id: "private-photo-item", freezerId: "freezer-feedback-photo", drawerId: "drawer-feedback-photo", label: "Secret pie", frozenOn: "2026-08-01", createdAt: "2026-08-01T12:00:00.000Z", notes: "Secret notes", version: 1 }],
        invitations: [], defaultHouseholdId: "house-feedback-photo", backup: { state: "current", pendingCount: 0 },
      }),
    });
  });
  await page.route("**/api/telemetry", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }));
  await page.route("**/api/feedback", async (route) => {
    feedbackBody = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "feedback-photo-1", reference: "ICE-F00DBA11", attachment: true }) });
  });
  await page.route("**/api/feedback/feedback-photo-1/photo", async (route) => {
    photoContentType = route.request().headers()["content-type"] || "";
    photoBytes = route.request().postDataBuffer()?.length || 0;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ attached: true, byteSize: photoBytes, mimeType: photoContentType }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Open settings/ }).click();
  await page.getByRole("button", { name: "Add feedback" }).click();
  await page.locator(".feedback-photo-picker input[type=file]").setInputFiles({
    name: "camera-original.unusual",
    mimeType: "image/x-icebox-camera",
    buffer: Buffer.from("an unusual camera format that the browser cannot decode"),
  });
  await expect(page.getByText("Photo attached", { exact: true })).toBeVisible();
  await expect(page.getByText(/Original format/)).toBeVisible();
  await page.locator("#feedback-message").fill("The dates overlapped on my phone.");
  await page.getByRole("button", { name: "Send feedback" }).click();

  await expect(page.getByText("ICE-F00DBA11", { exact: true })).toBeVisible();
  expect(photoContentType).toBe("image/x-icebox-camera");
  expect(photoBytes).toBeGreaterThan(0);
  expect(feedbackBody?.message).toBe("The dates overlapped on my phone.");
  expect(JSON.stringify(feedbackBody)).not.toContain("Secret pie");
  expect(JSON.stringify(feedbackBody)).not.toContain("Secret notes");
});

test("startup telemetry uses the authenticated bootstrap household", async ({ page }) => {
  const telemetryBodies: Array<{ householdId?: string | null }> = [];
  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "telemetry-user", email: "telemetry@example.com", fullName: "Telemetry User", aiLabelEnabled: true, isOperator: false },
        households: [{ id: "real-household", name: "Real House", ownerEmail: "telemetry@example.com", memberCount: 1 }],
        freezers: [{ id: "real-freezer", householdId: "real-household", name: "Kitchen", position: 1 }],
        drawers: [{ id: "real-drawer", freezerId: "real-freezer", name: "Top Drawer", position: 1 }],
        items: [], invitations: [], defaultHouseholdId: "real-household",
        backup: { state: "current", pendingCount: 0 },
      }),
    });
  });
  await page.route("**/api/telemetry", async (route) => {
    telemetryBodies.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ accepted: 1 }) });
  });

  await page.goto("/");
  await expect(page.getByText("Real House", { exact: true })).toBeVisible();
  await expect.poll(() => telemetryBodies.length).toBeGreaterThan(0);
  expect(telemetryBodies[0]?.householdId).toBe("real-household");
});

test("bootstrap hides demo inventory and onboarding uses Icebox controls", async ({ page }) => {
  let releaseBootstrap: (() => void) | undefined;
  await page.route("**/api/bootstrap", async (route) => {
    await new Promise<void>((resolve) => { releaseBootstrap = resolve; });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "new-user", email: "new@example.com", fullName: "New User", aiLabelEnabled: true, isOperator: false },
        households: [], freezers: [], drawers: [], items: [], invitations: [],
        backup: { state: "current", pendingCount: 0 },
      }),
    });
  });

  await page.goto("/");
  await expect(page.getByText("Opening Icebox…", { exact: true })).toBeVisible();
  await expect(page.getByText("Alder House", { exact: true })).toHaveCount(0);
  await expect.poll(() => Boolean(releaseBootstrap)).toBe(true);
  releaseBootstrap?.();

  await expect(page.getByRole("heading", { name: "Where do these freezers live?" })).toBeVisible();
  const householdName = page.getByPlaceholder("e.g. Alder House");
  const finishSetup = page.getByRole("button", { name: "Finish setup" });
  const fieldStyle = await householdName.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderRadius: style.borderRadius, backgroundColor: style.backgroundColor, minHeight: style.minHeight };
  });
  const buttonStyle = await finishSetup.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderRadius: style.borderRadius, backgroundColor: style.backgroundColor, color: style.color };
  });
  expect(fieldStyle.borderRadius).toBe("14px");
  expect(fieldStyle.backgroundColor).toBe("rgb(255, 254, 250)");
  expect(Number.parseFloat(fieldStyle.minHeight)).toBeGreaterThanOrEqual(50);
  expect(buttonStyle.borderRadius).toBe("14px");
  expect(buttonStyle.backgroundColor).toBe("rgb(250, 80, 71)");
  expect(buttonStyle.color).toBe("rgb(255, 255, 255)");
});

test("simulator remains available only as an explicit local preview", async ({ page }) => {
  await page.goto("/?simulator=1");
  await expect(page.getByTestId("phone-frame")).toBeVisible();
  await expect(page.getByTestId("device-picker")).toBeVisible();
  await expect(page.getByTestId("native-app-shell")).toHaveCount(0);
});

test("settings separate freezer setup from household membership and hide admin navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Open settings/ }).click();

  await expect(page.getByRole("button", { name: /Freezer setup Freezers and drawers/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Household setup Name, members, and invitations/ })).toBeVisible();
  await expect(page.getByText("Operator console", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /Freezer setup Freezers and drawers/ }).click();
  await expect(page.getByRole("dialog", { name: "Freezer setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add freezer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite" })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to settings" }).click();

  await page.getByRole("button", { name: /Household setup Name, members, and invitations/ }).click();
  await expect(page.getByRole("dialog", { name: "Household setup" })).toBeVisible();
  await expect(page.getByLabel("Household name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Household setup" }).getByText("Kitchen Freezer", { exact: true })).toHaveCount(0);
});

test("direct admin route renders operator household controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.route("**/api/operator/admin/households", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        operator: { email: "operator@example.com", fullName: "Operator" },
        households: [{
          id: "house-1", name: "Alder House", ownerEmail: "owner@example.com", ownerName: "Owner",
          memberCount: 3, freezerCount: 2, drawerCount: 8, activeItemCount: 8,
          createdAt: "2026-07-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z", deletedAt: null,
          members: [
            { id: "owner-1", email: "owner@example.com", fullName: "Owner", joinedAt: "2026-07-01T12:00:00.000Z", isOwner: true },
            { id: "member-1", email: "member@example.com", fullName: "Member", joinedAt: "2026-07-02T12:00:00.000Z", isOwner: false },
          ],
          pendingInvitations: [{ id: "invite-1", email: "waiting@example.com", expiresAt: "2026-09-01T12:00:00.000Z", createdAt: "2026-08-01T12:00:00.000Z" }],
        }],
        totals: { activeHouseholds: 1, activeItems: 8, members: 3, pendingBackup: 0, feedback: 1 },
        feedback: [{
          id: "feedback-1", reference: "ICE-A1B2C3D4", message: "The sort menu could not scroll.",
          sessionId: "session-123456789", appContext: { displayMode: "standalone", viewport: { width: 390, height: 600 } },
          recentEvents: [{ type: "client_error", level: "error", occurredAt: "2026-08-01T11:59:00.000Z", metadata: { message: "TypeError" } }],
          createdAt: "2026-08-01T12:05:00.000Z", userEmail: "owner@example.com", userName: "Owner",
          householdId: "house-1", householdName: "Alder House", attachmentCount: 1,
        }],
        backup: { state: "current", pendingCount: 0, lastSuccessAt: "2026-08-01T12:00:00.000Z" },
      }),
    });
  });
  await page.route("**/api/operator/admin/access", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ created: true, entry: { email: "john.mcintyre050@gmail.com", createdAt: "2026-08-03T10:00:00.000Z", hasMembership: false, hasPendingInvitation: false } }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ entries: [{ email: "pilot@example.com", createdAt: "2026-08-01T10:00:00.000Z", addedByEmail: "operator@example.com", hasMembership: true, hasPendingInvitation: false }] }) });
  });
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Households", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alder House" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset inventory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent feedback" })).toBeVisible();
  await expect(page.getByText(/Photo attached/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pilot access" })).toBeVisible();
  await expect(page.getByText("pilot@example.com", { exact: true })).toBeVisible();
  await expect(page.getByText("ICE-A1B2C3D4", { exact: true })).toBeVisible();
  await page.getByText("Membership", { exact: true }).click();
  await expect(page.getByText("member@example.com", { exact: false })).toBeVisible();
  await expect(page.getByText("waiting@example.com", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add or invite" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download diagnostics" })).toHaveAttribute("href", "/api/operator/admin/feedback/feedback-1/export");
  const adminPage = page.locator(".admin-page");
  const beforeScroll = await adminPage.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(beforeScroll.overflowY).toBe("auto");
  expect(beforeScroll.scrollHeight).toBeGreaterThan(beforeScroll.clientHeight);
  await adminPage.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  expect(await adminPage.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Reconcile all" })).toBeVisible();
});
