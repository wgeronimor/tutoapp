import { test, expect } from "@playwright/test";

// These regressions exercise the optional manual flow; automatic rounds have their own tests.
test.beforeEach(async ({ request }) => {
  await request.patch("/api/settings/writing", {
    data: { auto_advance_writing: false },
  });
});
import { randomUUID } from "node:crypto";

async function start(request: import("@playwright/test").APIRequestContext) {
  return (
    await request.post("/api/number-practice", {
      data: { request_id: randomUUID(), minimum: 1, maximum: 20 },
    })
  ).json();
}
async function snapshot(
  request: import("@playwright/test").APIRequestContext,
  id: string,
  mode = "write",
) {
  return (await request.get(`/api/number-practice/${id}?mode=${mode}`)).json();
}
async function finishAndNext(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  id: string,
) {
  const s = await snapshot(request, id);
  const answer =
    s.activity.source.answer_format === "digits"
      ? String(s.activity.source.number)
      : (
          await (
            await request.get(`/api/activities/${s.activity.id}/transcript`)
          ).json()
        ).text;
  await page.getByRole("textbox", { name: /^Escribe en/ }).fill(answer);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Correcto", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: /^Escribe en/ }),
  ).toBeEditable();
  await expect(page.getByRole("textbox", { name: /^Escribe en/ })).toHaveValue(
    "",
  );
}

test("Elegir solo cifras o letras afecta las siguientes rondas, conserva la actual y se recuerda", async ({
  page,
  request,
}) => {
  const s = await start(request);
  const id = s.id;
  await page.goto(`/numbers/${id}`);
  const words = page.getByRole("checkbox", {
    name: "Escribe en letras",
    exact: true,
  });
  const digits = page.getByRole("checkbox", {
    name: "Escribe en cifras",
    exact: true,
  });
  await expect(words).toBeChecked();
  await expect(digits).toBeChecked();
  await words.uncheck();
  await expect(words).not.toBeChecked();
  await expect(digits).toBeChecked();
  await expect(digits).toBeDisabled();
  await expect
    .poll(async () => (await snapshot(request, id)).answer_formats.write)
    .toEqual(["digits"]);
  expect((await snapshot(request, id)).activity.id).toBe(s.activity.id);
  await finishAndNext(page, request, id);
  for (let i = 0; i < 5; i++) {
    expect((await snapshot(request, id)).activity.source.answer_format).toBe(
      "digits",
    );
    await expect(page.locator(".instruction")).toContainText(
      "Escribe en cifras",
    );
    await finishAndNext(page, request, id);
  }
  await words.check();
  await digits.uncheck();
  await expect(words).toBeDisabled();
  await expect(digits).not.toBeChecked();
  await expect
    .poll(async () => (await snapshot(request, id)).answer_formats.write)
    .toEqual(["words"]);
  await finishAndNext(page, request, id);
  expect((await snapshot(request, id)).activity.source.answer_format).toBe(
    "words",
  );
  await page.reload();
  await expect(words).toBeChecked();
  await expect(words).toBeDisabled();
  await expect(digits).not.toBeChecked();
  await expect(page.locator(".instruction")).toContainText("Escribe en letras");
  await page.screenshot({
    path: "../.runtime/screenshots/number-formats-writing.png",
    fullPage: true,
  });
});

test("Los formatos son independientes por tipo y un fallo al guardarlos revierte la casilla", async ({
  page,
  request,
}) => {
  const s = await start(request);
  const id = s.id;
  await page.goto(`/numbers/${id}`);
  const words = page.getByRole("checkbox", {
    name: "Escribe en letras",
    exact: true,
  });
  await expect(words).toBeChecked();
  await page.route(`**/api/number-practice/${id}/formats`, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "No se pudo guardar la preferencia" },
    }),
  );
  await words.uncheck();
  await expect(page.getByRole("alert")).toContainText(
    "No se pudo guardar la preferencia",
  );
  await expect(words).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Escribe en cifras", exact: true }),
  ).toBeChecked();
  await page.unroute(`**/api/number-practice/${id}/formats`);
  await page
    .getByRole("checkbox", { name: "Escribe en cifras", exact: true })
    .uncheck();
  await page
    .locator(".session-outline")
    .getByRole("button", { name: /^Leer y elegir/ })
    .click();
  const pickWords = page.getByRole("checkbox", {
    name: "Elige en letras",
    exact: true,
  });
  await expect(pickWords).toBeChecked();
  await pickWords.uncheck();
  await expect(
    page.getByRole("checkbox", { name: "Elige en cifras", exact: true }),
  ).toBeDisabled();
  await page
    .locator(".session-outline")
    .getByRole("button", { name: /^Escuchar y elegir/ })
    .click();
  await expect(pickWords).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Elige en cifras", exact: true }),
  ).toBeChecked();
  await page
    .locator(".session-outline")
    .getByRole("button", { name: /^Escuchar y escribir/ })
    .click();
  await expect(words).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Escribe en cifras", exact: true })
    .uncheck();
  await expect(words).toBeDisabled();
  await page
    .locator(".session-outline")
    .getByRole("button", { name: /^Decir el número/ })
    .click();
  await expect(
    page.getByRole("group", { name: "Formato de respuesta" }),
  ).toHaveCount(0);
  await page
    .locator(".session-outline")
    .getByRole("button", { name: /^Escribir/ })
    .click();
  await expect(words).toBeDisabled();
  const result = await snapshot(request, id);
  expect(result.answer_formats).toEqual({
    write: ["words"],
    read: ["digits"],
    listen: ["words", "digits"],
    dictation: ["words"],
  });
  expect(
    (
      await request.patch(`/api/number-practice/${id}/formats`, {
        data: { mode: "write", formats: [] },
      })
    ).status(),
  ).toBe(422);
});
