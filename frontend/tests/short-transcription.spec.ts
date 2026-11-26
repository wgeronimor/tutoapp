import { test, expect, chromium } from "@playwright/test";
import { resolve } from "node:path";

const captureArgs = (file: string) => [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--disable-features=AudioServiceSandbox",
  "--disable-audio-output",
  "--use-file-for-fake-audio-capture=" + resolve(file),
];

test.use({
  launchOptions: { args: captureArgs("tests/fixtures/quiet-dix.wav") },
});

test.describe("Palabra corta y suave con pausas", () => {
  for (const automatic of [true, false]) {
    test(`La transcripción ${automatic ? "automática" : "manual"} llega al cuadro de solo lectura`, async ({
      page,
      request,
    }) => {
      await request.patch("/api/settings/audio", {
        data: { auto_transcribe: automatic },
      });
      const session = await (
        await request.post(`/api/days/${automatic ? 11 : 12}/start`)
      ).json();
      const activity = session.activities.find(
        (a: { mode: string }) => a.mode === "speak",
      );
      await page.goto(`/session/${session.id}?activity=${activity.id}`);
      const box = page.getByLabel("Transcripción automática · solo lectura");
      await expect(
        page.getByRole("checkbox", {
          name: "Transcribir automáticamente al detener",
        }),
      ).toBeChecked({ checked: automatic });
      let reading: Record<string, any> | undefined;
      page.on("response", async (response) => {
        if (/\/api\/jobs\//.test(response.url()) && response.ok()) {
          const job = await response.json();
          if (job.kind === "transcribe" && job.status === "completed")
            reading = job.result;
        }
      });
      await page
        .getByRole("button", { name: "Grabar mi voz", exact: true })
        .click();
      await page.waitForTimeout(3500);
      await page
        .getByRole("button", { name: "Detener grabación", exact: true })
        .click();
      if (!automatic) {
        await expect(page.getByLabel("Mi grabación")).toBeVisible();
        await expect(box).toHaveValue("");
        expect(reading).toBeUndefined();
        await page
          .getByRole("button", { name: "Transcribir esta toma", exact: true })
          .click();
      }
      await expect(box).not.toHaveValue("", { timeout: 180000 });
      await expect(box).toHaveAttribute("readonly", "");
      await expect.poll(() => reading?.text).toBeTruthy();
      await expect(box).toHaveValue(reading!.text);
      expect(reading!.rms_dbfs).toBeLessThan(-40);
      expect(reading!.voiced_rms_dbfs).toBeGreaterThan(-40);
      expect(reading!.needs_retry).toBe(false);
      await page.screenshot({
        path: `../.runtime/screenshots/short-transcription-${automatic ? "auto" : "manual"}.png`,
        fullPage: true,
      });
      const history = await (
        await request.get(
          `/api/attempt-history?session_id=${session.id}&activity_id=${activity.id}`,
        )
      ).json();
      expect(history.total).toBe(0);
      await page
        .getByRole("button", { name: "Descartar toma", exact: true })
        .click();
      await expect(box).toHaveValue("");
    });
  }
});

test("El silencio muestra el motivo junto al cuadro", async ({ request }) => {
  const browser = await chromium.launch({
    args: captureArgs("../local-model-tests/audio/silence.wav"),
  });
  try {
    const context = await browser.newContext({
      permissions: ["microphone"],
      baseURL: "http://127.0.0.1:8766",
    });
    const page = await context.newPage();
    await request.patch("/api/settings/audio", {
      data: { auto_transcribe: true },
    });
    const session = await (await request.post("/api/days/13/start")).json();
    const activity = session.activities.find(
      (a: { mode: string }) => a.mode === "speak",
    );
    await page.goto(`/session/${session.id}?activity=${activity.id}`);
    await page
      .getByRole("button", { name: "Grabar mi voz", exact: true })
      .click();
    await page.waitForTimeout(1200);
    await page
      .getByRole("button", { name: "Detener grabación", exact: true })
      .click();
    const box = page.getByLabel("Transcripción automática · solo lectura");
    await expect(box).toHaveAttribute("placeholder", /voz/, {
      timeout: 180000,
    });
    await expect(box).toHaveValue("");
    await expect(box.locator("xpath=following-sibling::p[1]")).toContainText(
      "voz",
    );
    await expect(
      page.getByRole("button", { name: "Transcribir esta toma", exact: true }),
    ).toBeEnabled();
  } finally {
    await browser.close();
  }
});
