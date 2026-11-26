import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const label = "Avanzar automáticamente al elegir";
async function start(request: APIRequestContext, mode: "listen" | "read") {
  await request.patch("/api/settings/practice", {
    data: { auto_advance_choices: true },
  });
  const s = await (
    await request.post("/api/number-practice", {
      data: { request_id: randomUUID(), minimum: 1, maximum: 10 },
    })
  ).json();
  return (
    await request.post(`/api/number-practice/${s.id}/next`, { data: { mode } })
  ).json();
}
async function snapshot(request: APIRequestContext, id: string, mode: string) {
  return (await request.get(`/api/number-practice/${id}?mode=${mode}`)).json();
}
async function answer(request: APIRequestContext, s: any) {
  return s.activity.source.answer_format === "digits"
    ? String(s.activity.source.number)
    : (
        await (
          await request.get(`/api/activities/${s.activity.id}/transcript`)
        ).json()
      ).text;
}

test("Elegir avanza en escucha y lectura con ratón o teclado y conserva cada intento", async ({
  page,
  request,
}) => {
  const s = await start(request, "listen");
  await page.goto(`/numbers/${s.id}?mode=listen`);
  await expect(
    page.getByRole("checkbox", { name: label, exact: true }),
  ).toBeChecked();
  await page
    .locator(".options input")
    .nth(s.activity.options.indexOf(await answer(request, s)))
    .check();
  await expect
    .poll(async () => (await snapshot(request, s.id, "listen")).activity.id)
    .not.toBe(s.activity.id);
  await expect(page.locator(".previous-round-result")).toContainText(
    "Ronda anterior: Correcto",
  );
  await expect(
    page.locator(".previous-round-result .previous-response"),
  ).toHaveText(await answer(request, s));
  await expect(
    page.locator(".previous-round-result .previous-expected"),
  ).toHaveText(await answer(request, s));
  await expect(page.locator(".continuous-top")).toContainText(
    "1 intentos guardados",
  );
  await expect(page.locator(".options input:checked")).toHaveCount(0);
  await page
    .locator(".session-outline")
    .getByRole("button", { name: /^Leer y elegir/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Leer y elegir", exact: true }),
  ).toBeVisible();
  const r = await snapshot(request, s.id, "read");
  const expected = await answer(request, r);
  const wrong = r.activity.options.find((x: string) => x !== expected);
  await page.keyboard.press(String(r.activity.options.indexOf(wrong) + 1));
  await expect
    .poll(async () => (await snapshot(request, s.id, "read")).activity.id)
    .not.toBe(r.activity.id);
  await expect(page.locator(".previous-round-result")).toContainText(
    "Vamos a reforzarlo",
  );
  await expect(
    page.locator(".previous-round-result .previous-response"),
  ).toHaveText(wrong);
  await expect(
    page.locator(".previous-round-result .previous-expected"),
  ).toHaveText(expected);
  await expect(page.locator(".continuous-top")).toContainText(
    "2 intentos guardados",
  );
  await expect(page.locator(".continuous-top .accuracy-badge")).toHaveText(
    "50%",
  );
  await mkdir(resolve("../.runtime/screenshots"), { recursive: true });
  await page.screenshot({
    path: resolve("../.runtime/screenshots/auto-advance-choice.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: label, exact: true }),
  ).toBeChecked();
  expect((await snapshot(request, s.id, "read")).accuracy.attempts).toBe(2);
});

test("Desactivar recuerda el avance manual en ambos tipos y revierte si falla la preferencia", async ({
  page,
  request,
}) => {
  const s = await start(request, "read");
  await page.goto(`/numbers/${s.id}?mode=read`);
  const checkbox = page.getByRole("checkbox", { name: label, exact: true });
  await checkbox.uncheck();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/settings")).json())
          .auto_advance_choices,
    )
    .toBe(false);
  await page.reload();
  await expect(checkbox).not.toBeChecked();
  await page
    .locator(".options input")
    .nth(s.activity.options.indexOf(await answer(request, s)))
    .check();
  await expect(
    page.getByRole("heading", { name: "Correcto", exact: true }),
  ).toBeVisible();
  expect((await snapshot(request, s.id, "read")).activity.id).toBe(
    s.activity.id,
  );
  await page
    .getByRole("button", { name: "Siguiente número · Enter", exact: true })
    .click();
  await expect
    .poll(async () => (await snapshot(request, s.id, "read")).activity.id)
    .not.toBe(s.activity.id);
  await page
    .locator(".session-outline")
    .getByRole("button", { name: /^Escuchar y elegir/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Escuchar y elegir", exact: true }),
  ).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await page.route("**/api/settings/practice", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "No se pudo guardar la preferencia" }),
    }),
  );
  await checkbox.check();
  await expect(page.getByRole("alert")).toContainText(
    "No se pudo guardar la preferencia",
  );
  await expect(checkbox).not.toBeChecked();
  await page.unroute("**/api/settings/practice");
  await checkbox.check();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/settings")).json())
          .auto_advance_choices,
    )
    .toBe(true);
});

test("Un fallo de respuesta de guardado no avanza ni duplica al reintentar", async ({
  page,
  request,
}) => {
  const s = await start(request, "read");
  await page.goto(`/numbers/${s.id}?mode=read`);
  let posts = 0;
  await page.route("**/api/attempts", async (route) => {
    posts++;
    if (posts === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  const option = s.activity.options.indexOf(await answer(request, s));
  await page.locator(".options input").nth(option).check();
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await snapshot(request, s.id, "read")).activity.id).toBe(
    s.activity.id,
  );
  expect((await snapshot(request, s.id, "read")).accuracy.attempts).toBe(1);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await snapshot(request, s.id, "read")).activity.id)
    .not.toBe(s.activity.id);
  await expect(page.locator(".previous-round-result")).toContainText(
    "Correcto",
  );
  expect((await snapshot(request, s.id, "read")).accuracy.attempts).toBe(1);
  expect(posts).toBe(2);
});

test("Si falla la siguiente ronda, conserva el resultado guardado y permite continuar", async ({
  page,
  request,
}) => {
  const s = await start(request, "read");
  await page.goto(`/numbers/${s.id}?mode=read`);
  await page.route(`**/api/number-practice/${s.id}/next`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "No se pudo abrir la siguiente ronda" }),
    }),
  );
  await page
    .locator(".options input")
    .nth(s.activity.options.indexOf(await answer(request, s)))
    .check();
  await expect(page.getByRole("alert")).toContainText(
    "No se pudo abrir la siguiente ronda",
  );
  await expect(
    page.getByRole("heading", { name: "Correcto", exact: true }),
  ).toBeVisible();
  expect((await snapshot(request, s.id, "read")).accuracy.attempts).toBe(1);
  await page.unroute(`**/api/number-practice/${s.id}/next`);
  await page
    .getByRole("button", { name: "Siguiente número · Enter", exact: true })
    .click();
  await expect
    .poll(async () => (await snapshot(request, s.id, "read")).activity.id)
    .not.toBe(s.activity.id);
  expect((await snapshot(request, s.id, "read")).accuracy.attempts).toBe(1);
});
