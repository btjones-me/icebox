import { expect, test } from "@playwright/test";

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
  await page.locator('input[type="file"]').setInputFiles("public/assets/food/peas.png");
  await expect.poll(() => mediaCalls).toBe(2);
  await page.waitForTimeout(100);

  await expect(existingLabel).toHaveValue("Family pizza");
  expect(aiCalls).toBe(1);
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

test("admin route renders operator household controls", async ({ page }) => {
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
        }],
        totals: { activeHouseholds: 1, activeItems: 8, members: 3, pendingBackup: 0 },
        backup: { state: "current", pendingCount: 0, lastSuccessAt: "2026-08-01T12:00:00.000Z" },
      }),
    });
  });
  await page.goto("/#/admin");

  await expect(page.getByRole("heading", { name: "Households", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alder House" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset inventory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
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
