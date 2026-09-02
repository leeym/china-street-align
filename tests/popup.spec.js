const { test, expect } = require("@playwright/test");
const { version: EXT_VERSION } = require("../manifest.json");
const { WUZHANGYUAN } = require("./fixtures/overlay-landmarks");
const {
  launchExtensionContext,
  extensionId,
  openPopup,
  readAlignModeStorage,
  setModeViaPopup,
  setModeViaAlignBar,
  waitForModeBar,
  dismissConsent,
  waitForOverlayOff
} = require("./helpers/maps-e2e");

test.describe.serial("toolbar popup", () => {
  let context;
  let extId;
  let mapsPage;

  test.beforeAll(async () => {
    context = await launchExtensionContext();
    extId = await extensionId(context);
    mapsPage = await context.newPage();
    await mapsPage.goto(WUZHANGYUAN.mapHref, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(mapsPage);
    await mapsPage.waitForTimeout(2000);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("loads with version, Hybrid/Off modes, and default Hybrid selected", async () => {
    const popup = await openPopup(context, extId);
    await expect(popup.locator("h1")).toHaveText("China Street Align");
    await expect(popup.locator("#version")).toHaveText(`v${EXT_VERSION}`);
    await expect(popup.locator("#current")).toHaveText("Hybrid");
    await expect(popup.locator('input[value="hybrid"]')).toBeChecked();
    await expect(popup.locator("#error")).toBeHidden();
    await popup.close();
  });

  test("writes Off to storage and updates the active label", async () => {
    const popup = await openPopup(context, extId);
    await popup.locator('input[value="off"]').check();
    await expect(popup.locator("#current")).toHaveText("Off");
    expect(await readAlignModeStorage(popup)).toBe("off");
    await popup.close();
  });

  test("applies popup mode to an open Maps tab via storage", async () => {
    await setModeViaPopup(context, extId, "hybrid");
    await waitForModeBar(mapsPage, "hybrid");

    await setModeViaPopup(context, extId, "off");
    await waitForModeBar(mapsPage, "off");
    await waitForOverlayOff(mapsPage);

    await setModeViaPopup(context, extId, "hybrid");
    await waitForModeBar(mapsPage, "hybrid");
  });

  test("migrates legacy streets storage value to hybrid in the popup UI", async () => {
    const popup = await openPopup(context, extId);
    await popup.evaluate(() => new Promise((resolve) => {
      const payload = { alignMode: "on" };
      chrome.storage.sync.set(payload, () => {
        chrome.storage.local.set(payload, resolve);
      });
    }));
    await popup.reload({ waitUntil: "domcontentloaded" });
    await popup.waitForSelector("#modes");
    await expect(popup.locator('input[value="hybrid"]')).toBeChecked();
    await expect(popup.locator("#current")).toHaveText("Hybrid");
    expect(await readAlignModeStorage(popup)).toBe("hybrid");
    await popup.close();
  });

  test("popup mode survives content-script bootstrap on a fresh Maps tab", async () => {
    await setModeViaPopup(context, extId, "off");
    const fresh = await context.newPage();
    await fresh.goto(WUZHANGYUAN.mapHref, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(fresh);
    await fresh.waitForSelector("#gcj02-aligner-modebar", { timeout: 60000 });
    await waitForModeBar(fresh, "off");
    await fresh.close();
  });

  test("open popup stays in sync when the Maps Align bar changes mode", async () => {
    await setModeViaPopup(context, extId, "hybrid");
    await waitForModeBar(mapsPage, "hybrid");
    const popup = await openPopup(context, extId);
    await expect(popup.locator('input[value="hybrid"]')).toBeChecked();

    await setModeViaAlignBar(mapsPage, "off");
    await expect(popup.locator('input[value="off"]')).toBeChecked({ timeout: 10000 });
    await expect(popup.locator("#current")).toHaveText("Off");

    await setModeViaAlignBar(mapsPage, "hybrid");
    await expect(popup.locator('input[value="hybrid"]')).toBeChecked({ timeout: 10000 });
    await expect(popup.locator("#current")).toHaveText("Hybrid");
    await popup.close();
  });
});
