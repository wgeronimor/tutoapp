import { test, expect } from "@playwright/test";

// These regressions exercise the optional manual flow; automatic rounds have their own tests.
test.beforeEach(async ({ request }) => {
  await request.patch("/api/settings/writing", {
    data: { auto_advance_writing: false },
  });
});
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

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

async function snapshot(
  request: import("@playwright/test").APIRequestContext,
  id: string,
  mode?: string,
) {
  return (
    await request.get(
      `/api/number-practice/${id}${mode ? "?mode=" + mode : ""}`,
    )
  ).json();
}
async function expected(
  request: import("@playwright/test").APIRequestContext,
  s: any,
) {
  return s.activity.source.answer_format === "digits"
    ? String(s.activity.source.number)
    : (
        await (
          await request.get(`/api/activities/${s.activity.id}/transcript`)
        ).json()
      ).text;
}
async function start(
  request: import("@playwright/test").APIRequestContext,
  lo: number,
  hi: number,
  mode: string,
) {
  const s = await (
    await request.post("/api/number-practice", {
      data: { request_id: randomUUID(), minimum: lo, maximum: hi },
    })
  ).json();
  return (
    await request.post(`/api/number-practice/${s.id}/next`, { data: { mode } })
  ).json();
}

test("Doce rondas de teclado recorren el rango completo, continúan y se reanudan", async ({
  page,
  request,
}) => {
  await page.goto("/practice");
  await page
    .getByRole("button", { name: "Práctica continua", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Por rango de números", exact: true })
    .click();
  await page.getByLabel("Desde", { exact: true }).fill("1");
  await page.getByLabel("Hasta", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: "Comenzar práctica continua", exact: true })
    .click();
  await expect(page).toHaveURL(/\/numbers\//);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.locator(".session-outline>button")).toHaveCount(5);
  const numbers: number[] = [];
  for (let i = 0; i < 12; i++) {
    await expect(
      page.getByRole("textbox", { name: /^Escribe en/ }),
    ).toBeEditable();
    const s = await snapshot(request, id);
    numbers.push(s.activity.source.number);
    await page
      .getByRole("textbox", { name: /^Escribe en/ })
      .fill(await expected(request, s));
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Correcto", exact: true }),
    ).toBeVisible();
    if (i < 11) {
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "Correcto", exact: true }),
      ).toHaveCount(0);
    }
  }
  expect(new Set(numbers.slice(0, 10)).size).toBe(10);
  await expect(page.locator(".continuous-top")).toContainText(
    "12 intentos guardados",
  );
  await expect(page.locator(".continuous-top .accuracy-badge")).toHaveText(
    "100%",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Correcto", exact: true }),
  ).toBeVisible();
  expect((await snapshot(request, id)).accuracy.attempts).toBe(12);
  await page.screenshot({
    path: "../.runtime/screenshots/continuous-writing.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".session-outline>button")).toHaveCount(5);
  await page.screenshot({
    path: "../.runtime/screenshots/continuous-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/practice");
  await expect(
    page.getByRole("button", { name: "Preparar propuesta", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Práctica continua", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: /Números 1–10/ }).first(),
  ).toBeVisible();
});

test("Leer permite elegir con número o ratón y escuchar reproduce la referencia", async ({
  page,
  request,
}) => {
  const initial = await start(request, 88, 100, "read");
  const id = initial.id;
  await page.goto(`/numbers/${id}?mode=read`);
  await expect(page.locator(".options label")).toHaveCount(4);
  let s = await snapshot(request, id, "read");
  await page
    .getByRole("checkbox", {
      name: "Avanzar automáticamente al elegir",
      exact: true,
    })
    .uncheck();
  await expect(
    page.getByRole("checkbox", {
      name: "Avanzar automáticamente al elegir",
      exact: true,
    }),
  ).toBeEnabled();
  const answer = await expected(request, s);
  const index = s.activity.options.indexOf(answer);
  await page.keyboard.press(String(index + 1));
  await expect(
    page.getByRole("heading", { name: "Correcto", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Correcto", exact: true }),
  ).toHaveCount(0);
  s = await snapshot(request, id, "read");
  const correct = await expected(request, s);
  const wrong = s.activity.options.find((x: string) => x !== correct);
  await page
    .locator(".options label")
    .filter({ hasText: new RegExp("^.*" + wrong + "$") })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Vamos a reforzarlo", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".continuous-top .accuracy-badge")).toHaveText(
    "50%",
  );
  await expect(page.locator(".continuous-top .accuracy-badge")).toHaveClass(
    /red/,
  );
  await page
    .locator(".session-outline")
    .getByRole("button", { name: /^Escuchar y elegir/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Escuchar y elegir", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Audio de referencia")).toBeVisible({
    timeout: 180000,
  });
  await expect(page.locator(".options label")).toHaveCount(4);
  s = await snapshot(request, id, "listen");
  const chosen = await expected(request, s);
  await page
    .locator(".options label")
    .filter({ hasText: chosen })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Correcto", exact: true }),
  ).toBeVisible();
  await page
    .locator(".session-outline")
    .getByRole("button", { name: /^Escuchar y escribir/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Escuchar y escribir", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Audio de referencia")).toBeVisible({
    timeout: 180000,
  });
  const dictationAuto = page.getByRole("checkbox", {
    name: "Avanzar automáticamente al comprobar",
    exact: true,
  });
  await dictationAuto.uncheck();
  await expect(dictationAuto).toBeEnabled();
  s = await snapshot(request, id, "dictation");
  await page
    .getByRole("textbox", { name: /^Escribe en/ })
    .fill(await expected(request, s));
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Correcto", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../.runtime/screenshots/continuous-listening.png",
    fullPage: true,
  });
});

test("Habla valida el borrador y solo Continuar conserva el audio al avanzar", async ({
  page,
  request,
}) => {
  await request.patch("/api/settings/audio", {
    data: { auto_transcribe: true },
  });
  await request.patch("/api/settings/review", { data: { auto_review: true } });
  const initial = await start(request, 10, 10, "speak");
  const id = initial.id;
  await page.goto(`/numbers/${id}?mode=speak`);
  await expect(
    page.getByRole("button", { name: "Grabar mi voz", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Grabar mi voz", exact: true })
    .focus();
  await page.keyboard.press("r");
  await expect(
    page.getByRole("button", { name: "Detener grabación", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(3500);
  await page.keyboard.press("r");
  await expect(
    page.getByLabel("Transcripción automática · solo lectura"),
  ).toHaveValue("10", { timeout: 180000 });
  await expect(
    page.getByRole("heading", {
      name: "El número reconocido coincide",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await request.get(`/api/attempt-history?session_id=${id}`)).ok(),
  ).toBe(true);
  expect(
    (await (await request.get(`/api/attempt-history?session_id=${id}`)).json())
      .total,
  ).toBe(0);
  await page.keyboard.press("Enter");
  await expect(page.locator(".previous-round-result")).toContainText(
    "Correcto",
  );
  const history = await (
    await request.get(`/api/attempt-history?session_id=${id}`)
  ).json();
  expect(history.total).toBe(1);
  expect(history.items[0].result.score).toBe(100);
  expect(history.items[0].result.method).toContain("sin nota de pronunciación");
  const media = history.items[0].media_id;
  expect((await request.get(`/api/media/${media}`)).ok()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Grabar mi voz", exact: true }),
  ).toBeVisible();
  expect((await request.get(`/api/media/${media}`)).ok()).toBe(true);
  expect((await snapshot(request, id)).accuracy).toMatchObject({
    attempts: 1,
    evaluated: 1,
    correct: 1,
    percent: 100,
  });
});
