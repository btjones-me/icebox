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
