const { test, expect } = require("@playwright/test");
const { version: EXT_VERSION } = require("../manifest.json");
const { WUZHANGYUAN } = require("./fixtures/overlay-landmarks");
const {
  launchExtensionContext,
  extensionId,
  openPopup,
  readAlignModeStorage,
  setModeViaPopup,
  waitForAlignMode,
  dismissConsent,
  waitForOverlayOff
} = require("./helpers/maps-e2e");

test.describe.serial("toolbar popup", () => {
  test.setTimeout(180000);

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
    await waitForAlignMode(mapsPage, "hybrid");
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("loads with version, On/Off modes, and default On selected", async () => {
    const popup = await openPopup(context, extId);
    await expect(popup.locator("h1")).toHaveText("China Street Align");
    await expect(popup.locator("#version")).toHaveText(`v${EXT_VERSION}`);
    await expect(popup.locator("#current")).toHaveText("On");
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
    await waitForAlignMode(mapsPage, "hybrid");

    await setModeViaPopup(context, extId, "off");
    await waitForAlignMode(mapsPage, "off");
    await waitForOverlayOff(mapsPage);

    await setModeViaPopup(context, extId, "hybrid");
    await waitForAlignMode(mapsPage, "hybrid");
  });

  test("migrates legacy on storage value to hybrid in the popup UI", async () => {
    const popup = await openPopup(context, extId);
    await popup.evaluate(() => new Promise((resolve) => {
      chrome.storage.local.set({ alignMode: "on" }, resolve);
    }));
    await popup.reload({ waitUntil: "domcontentloaded" });
    await popup.waitForSelector("#modes");
    await expect(popup.locator('input[value="hybrid"]')).toBeChecked();
    await expect(popup.locator("#current")).toHaveText("On");
    expect(await readAlignModeStorage(popup)).toBe("hybrid");
    await popup.close();
  });

  test("popup mode survives content-script bootstrap on a fresh Maps tab", async () => {
    await setModeViaPopup(context, extId, "off");
    const fresh = await context.newPage();
    await fresh.goto(WUZHANGYUAN.mapHref, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsent(fresh);
    await waitForAlignMode(fresh, "off");
    await waitForOverlayOff(fresh);
    await fresh.close();
    await setModeViaPopup(context, extId, "hybrid");
  });
});
