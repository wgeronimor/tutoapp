import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--disable-features=AudioServiceSandbox",
      "--disable-audio-output",
      "--use-file-for-fake-audio-capture=" +
        resolve("tests/fixtures/quiet-dix.wav"),
    ],
  },
});
async function start(request: APIRequestContext, number = 10, auto = true) {
  await request.patch("/api/settings/number-speech", {
    data: { auto_validate_number_speech: auto },
  });
  const s = await (
    await request.post("/api/number-practice", {
      data: { request_id: randomUUID(), minimum: number, maximum: number },
    })
  ).json();
  return (
    await request.post(`/api/number-practice/${s.id}/next`, {
      data: { mode: "speak" },
    })
  ).json();
}
async function history(request: APIRequestContext, id: string) {
  return (await request.get(`/api/attempt-history?session_id=${id}`)).json();
}
async function record(page: Page, retry = false) {
  await page
    .getByRole("button", {
      name: retry ? "Reintentar" : "Grabar mi voz",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Detener grabación", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(3500);
  await page
    .getByRole("button", { name: "Detener grabación", exact: true })
    .click();
}
const text = (page: Page) =>
  page.getByRole("textbox", {
    name: "Transcripción automática · solo lectura",
    exact: true,
  });

test("Reintentar conserva el número, descarta el audio y no guarda; Continuar congela la toma final", async ({
  page,
  request,
}) => {
  const s = await start(request);
  const previews: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/speech-preview"))
      previews.push(r.postDataJSON().media_id);
  });
  await page.goto(`/numbers/${s.id}?mode=speak`);
  await record(page);
  await expect(text(page)).toHaveValue("10", { timeout: 180000 });
  await expect(text(page)).toHaveAttribute("readonly", "");
  await expect(
    page.getByRole("heading", {
      name: "El número reconocido coincide",
      exact: true,
    }),
  ).toBeVisible();
  expect((await history(request, s.id)).total).toBe(0);
  const before = await (
    await request.get(`/api/number-practice/${s.id}?mode=speak`)
  ).json();
  expect(before.activity.id).toBe(s.activity.id);
  await record(page, true);
  expect((await request.get(`/api/media/${previews[0]}`)).status()).toBe(410);
  await expect(text(page)).toHaveValue("10", { timeout: 180000 });
  expect((await history(request, s.id)).total).toBe(0);
  await expect(page.locator(".reading-material")).toHaveText("10");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.locator(".previous-round-result")).toContainText(
    "Correcto",
  );
  const h = await history(request, s.id);
  expect(h.total).toBe(1);
  expect(h.items[0].media_id).toBe(previews[1]);
  expect(h.items[0].result.score).toBe(100);
  expect(h.items[0].evidence.transcript_matches).toBe(false);
  expect(h.items[0].evidence.number_recognition_check).toBe(true);
  expect((await request.get(`/api/media/${previews[1]}`)).ok()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Grabar mi voz", exact: true }),
  ).toBeVisible();
  const after = await (
    await request.get(`/api/number-practice/${s.id}?mode=speak`)
  ).json();
  expect(after.activity.id).not.toBe(s.activity.id);
});

test("Una transcripción de otro número recibe feedback antes de guardar y conserva la respuesta al continuar", async ({
  page,
  request,
}) => {
  const s = await start(request, 7);
  await page.goto(`/numbers/${s.id}?mode=speak`);
  await record(page);
  await expect(
    page.getByRole("heading", {
      name: "El número reconocido no coincide",
      exact: true,
    }),
  ).toBeVisible({ timeout: 180000 });
  await expect(text(page)).toHaveValue("10");
  await expect(page.locator(".speech-preview")).toContainText("sept");
  expect((await history(request, s.id)).total).toBe(0);
  await mkdir(resolve("../.runtime/screenshots"), { recursive: true });
  await page.screenshot({
    path: resolve("../.runtime/screenshots/number-speech-preview.png"),
    fullPage: true,
  });
  await page.keyboard.press("Enter");
  await expect(
    page.locator(".previous-round-result .previous-response"),
  ).toHaveText("10");
  await expect(
    page.locator(".previous-round-result .previous-expected"),
  ).toHaveText("sept");
  expect((await history(request, s.id)).items[0].result.score).toBe(0);
});

test("Desactivar evita subir o reconocer hasta elegir y permite guardar solo el audio sin nota", async ({
  page,
  request,
}) => {
  const s = await start(request, 10, false);
  let uploads = 0,
    validations = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/recordings")) uploads++;
    if (r.url().endsWith("/speech-preview")) validations++;
  });
  await page.goto(`/numbers/${s.id}?mode=speak`);
  await expect(
    page.getByRole("checkbox", {
      name: "Validar automáticamente al detener",
      exact: true,
    }),
  ).not.toBeChecked();
  await record(page);
  expect(uploads).toBe(0);
  expect(validations).toBe(0);
  expect((await history(request, s.id)).total).toBe(0);
  await expect(text(page)).toHaveValue("");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.locator(".previous-round-result")).toContainText(
    "Sin validación",
  );
  expect(uploads).toBe(1);
  expect(validations).toBe(0);
  const h = await history(request, s.id);
  expect(h.total).toBe(1);
  expect(h.items[0].result.score).toBeNull();
  expect(h.items[0].evidence.transcription_status).toBe("not_requested");
});

test("Una respuesta de guardado perdida se recupera sin duplicar ni descartar el audio guardado", async ({
  page,
  request,
}) => {
  const s = await start(request);
  let calls = 0;
  await page.goto(`/numbers/${s.id}?mode=speak`);
  await record(page);
  await expect(text(page)).toHaveValue("10", { timeout: 180000 });
  await page.route("**/api/attempts", async (route) => {
    calls++;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.locator(".previous-round-result")).toContainText(
    "Correcto",
  );
  const h = await history(request, s.id);
  expect(h.total).toBe(1);
  expect(calls).toBe(1);
  expect((await request.get(`/api/media/${h.items[0].media_id}`)).ok()).toBe(
    true,
  );
  expect(
    (
      await request.post(`/api/recordings/${h.items[0].media_id}/discard`)
    ).status(),
  ).toBe(409);
});
