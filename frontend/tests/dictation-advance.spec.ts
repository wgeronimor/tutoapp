import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const autoLabel = "Avanzar automáticamente al comprobar";
async function start(request: APIRequestContext) {
  await request.patch("/api/settings/dictation", {
    data: { auto_advance_dictation: true },
  });
  const s = await (
    await request.post("/api/number-practice", {
      data: { request_id: randomUUID(), minimum: 3, maximum: 3 },
    })
  ).json();
  await request.patch(`/api/number-practice/${s.id}/formats`, {
    data: { mode: "dictation", formats: ["words"] },
  });
  return (
    await request.post(`/api/number-practice/${s.id}/next`, {
      data: { mode: "dictation" },
    })
  ).json();
}
async function snapshot(request: APIRequestContext, id: string) {
  return (
    await request.get(`/api/number-practice/${id}?mode=dictation`)
  ).json();
}

test("Un Enter comprueba y avanza en dictado con el último intento y su respuesta arriba", async ({
  page,
  request,
}) => {
  const s = await start(request);
  await page.goto(`/numbers/${s.id}?mode=dictation`);
  const field = page.getByRole("textbox", {
    name: "Escribe en letras francesas",
    exact: true,
  });
  await expect(
    page.getByRole("checkbox", { name: autoLabel, exact: true }),
  ).toBeChecked();
  await field.fill("trois");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await snapshot(request, s.id)).activity.id)
    .not.toBe(s.activity.id);
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  const banner = page.locator(".previous-round-result");
  await expect(banner).toContainText("Ronda anterior: Correcto");
  await expect(banner).toContainText("Escribiste:");
  await expect(banner.locator(".previous-response")).toHaveText("trois");
  await expect(banner.locator(".previous-expected")).toHaveText("trois");
  const next = await snapshot(request, s.id);
  await field.fill("3");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await snapshot(request, s.id)).activity.id)
    .not.toBe(next.activity.id);
  await expect(banner).toContainText("Número correcto · formato distinto");
  await expect(banner.locator(".previous-response")).toHaveText("3");
  await expect(banner.locator(".previous-expected")).toHaveText("trois");
  await expect(page.locator(".continuous-top")).toContainText(
    "2 intentos guardados",
  );
  await expect(page.locator(".continuous-top .accuracy-badge")).toHaveText(
    "50%",
  );
  await mkdir(resolve("../.runtime/screenshots"), { recursive: true });
  await page.screenshot({
    path: resolve("../.runtime/screenshots/dictation-auto-advance.png"),
    fullPage: true,
  });
});

test("Desactivado recuerda el dictado manual y permite reactivar para comprobar con ratón", async ({
  page,
  request,
}) => {
  const s = await start(request);
  await page.goto(`/numbers/${s.id}?mode=dictation`);
  const auto = page.getByRole("checkbox", { name: autoLabel, exact: true });
  await auto.uncheck();
  await expect(auto).toBeEnabled();
  await page.reload();
  await expect(auto).not.toBeChecked();
  const field = page.getByRole("textbox", {
    name: "Escribe en letras francesas",
    exact: true,
  });
  await field.fill("trois");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Correcto", exact: true }),
  ).toBeVisible();
  expect((await snapshot(request, s.id)).activity.id).toBe(s.activity.id);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await snapshot(request, s.id)).activity.id)
    .not.toBe(s.activity.id);
  const current = await snapshot(request, s.id);
  await auto.check();
  await expect(auto).toBeEnabled();
  await field.fill("trois");
  await page
    .getByRole("button", { name: "Comprobar · Enter", exact: true })
    .click();
  await expect
    .poll(async () => (await snapshot(request, s.id)).activity.id)
    .not.toBe(current.activity.id);
  await expect(
    page.locator(".previous-round-result .previous-response"),
  ).toHaveText("trois");
});

test("Dictado conserva la toma escrita ante una respuesta de guardado perdida y no duplica al reintentar", async ({
  page,
  request,
}) => {
  const s = await start(request);
  await page.goto(`/numbers/${s.id}?mode=dictation`);
  let posts = 0;
  await page.route("**/api/attempts", async (route) => {
    posts++;
    if (posts === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  const field = page.getByRole("textbox", {
    name: "Escribe en letras francesas",
    exact: true,
  });
  await field.fill("trois");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(field).toHaveValue("trois");
  expect((await snapshot(request, s.id)).activity.id).toBe(s.activity.id);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await snapshot(request, s.id)).activity.id)
    .not.toBe(s.activity.id);
  expect((await snapshot(request, s.id)).accuracy.attempts).toBe(1);
  expect(posts).toBe(2);
  await expect(
    page.locator(".previous-round-result .previous-response"),
  ).toHaveText("trois");
});
