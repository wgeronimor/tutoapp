import { test, expect, type APIRequestContext } from "@playwright/test";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
test.beforeEach(async ({ request }) => {
  await request.patch("/api/settings/writing", {
    data: { auto_advance_writing: true },
  });
  await request.patch("/api/settings/practice", {
    data: { auto_advance_choices: true },
  });
});
async function snapshot(request: APIRequestContext, id: string, mode?: string) {
  return (
    await request.get(
      `/api/number-practice/${id}${mode ? "?mode=" + mode : ""}`,
    )
  ).json();
}

test("Meses completos, edición previa, rondas continuas e historial sin modificar el catálogo creado", async ({
  page,
  request,
}) => {
  await page.goto("/practice");
  await page
    .getByRole("button", { name: "Práctica continua", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Meses del año", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Preparar propuesta continua", exact: true })
    .click();
  const catalog = page.getByRole("region", {
    name: "Catálogo de práctica continua",
  });
  await expect(
    catalog.getByRole("heading", { name: "Meses del año", exact: true }),
  ).toBeVisible();
  await expect(catalog.getByRole("textbox", { name: /^Francés / })).toHaveCount(
    12,
  );
  await expect(
    page.getByRole("textbox", { name: "Francés 12", exact: true }),
  ).toHaveValue("décembre");
  await page
    .getByRole("textbox", { name: "Francés 1", exact: true })
    .fill("le mois de janvier");
  await page
    .getByRole("textbox", { name: "Español 1", exact: true })
    .fill("el mes de enero");
  await page
    .getByRole("button", {
      name: "Comenzar práctica con este catálogo",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/numbers\//);
  await expect(
    page.getByRole("heading", { name: "Meses del año", exact: true }),
  ).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.locator(".session-outline>button")).toHaveCount(5);
  for (let i = 0; i < 3; i++) {
    const s = await snapshot(request, id);
    const response = (
      await (
        await request.get(`/api/activities/${s.activity.id}/transcript`)
      ).json()
    ).text;
    await page
      .getByRole("textbox", { name: "Tu respuesta en francés", exact: true })
      .fill(response);
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await snapshot(request, id)).activity.id)
      .not.toBe(s.activity.id);
    await expect(
      page.locator(".previous-round-result .previous-response"),
    ).toHaveText(response);
  }
  await expect(page.locator(".continuous-top")).toContainText(
    "3 intentos guardados",
  );
  await page.goto("/practice?mode=continuous");
  const row = page
    .getByRole("table", { name: "Prácticas continuas anteriores" })
    .getByRole("row")
    .filter({
      has: page.getByRole("link", { name: "Meses del año", exact: true }),
    });
  await expect(row).toContainText("1/5 tipos practicados · 20%");
  await expect(row).toContainText("3/12 expresiones");
  await row.getByRole("button", { name: "Ver propuesta", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Francés 1", exact: true }),
  ).toHaveValue("le mois de janvier");
  await expect(
    page.getByRole("textbox", { name: "Francés 1", exact: true }),
  ).not.toBeEditable();
  await mkdir(resolve("../.runtime/screenshots"), { recursive: true });
  await page.screenshot({
    path: resolve("../.runtime/screenshots/continuous-months-catalog.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Continuar esta práctica", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/numbers/${id}$`));
  expect((await snapshot(request, id)).accuracy.attempts).toBe(3);
});

test("Los siete días funcionan en selección con audio y en lectura con sus tipos elegidos", async ({
  page,
  request,
}) => {
  await page.goto("/practice?mode=continuous");
  await page
    .getByRole("button", { name: "Días de la semana", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Escritura", exact: true })
    .uncheck();
  await page.getByRole("checkbox", { name: "Habla", exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Preparar propuesta continua", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: /^Francés / })).toHaveCount(7);
  const pool = await page
    .getByRole("textbox", { name: /^Francés / })
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLInputElement).value));
  expect(pool).toEqual([
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
    "dimanche",
  ]);
  const translations = [
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
    "domingo",
  ];
  await page
    .getByRole("button", {
      name: "Comenzar práctica con este catálogo",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/numbers\//);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.locator(".session-outline>button")).toHaveCount(3);
  await expect(page.getByLabel("Audio de referencia")).toBeVisible({
    timeout: 180000,
  });
  for (const mode of ["listen", "read"]) {
    if (mode === "read") {
      await page
        .locator(".session-outline")
        .getByRole("button", { name: /^Leer y elegir/ })
        .click();
      await expect(
        page.getByRole("heading", { name: "Leer y elegir", exact: true }),
      ).toBeVisible();
    }
    const s = await snapshot(request, id, mode);
    const french = (
      await (
        await request.get(`/api/activities/${s.activity.id}/transcript`)
      ).json()
    ).text;
    const expected = translations[pool.indexOf(french)];
    await page
      .locator(".options input")
      .nth(s.activity.options.indexOf(expected))
      .check();
    await expect(
      page.locator(".previous-round-result .previous-expected"),
    ).toHaveText(expected);
    await expect
      .poll(async () => (await snapshot(request, id, mode)).activity.id)
      .not.toBe(s.activity.id);
  }
  await page.goto("/practice?mode=continuous");
  const row = page
    .getByRole("table", { name: "Prácticas continuas anteriores" })
    .getByRole("row")
    .filter({
      has: page.getByRole("link", { name: "Días de la semana", exact: true }),
    });
  await expect(row).toContainText("2/3 tipos practicados · 67%");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Un tema libre se genera con Qwen local, permite otra propuesta y conserva las versiones previas", async ({
  page,
  request,
}) => {
  await page.goto("/practice?mode=continuous");
  await page
    .getByRole("textbox", {
      name: "Tema o situación para practicar sin límite",
      exact: true,
    })
    .fill("Expresiones de cortesía para saludar y despedirse");
  await page
    .getByLabel("Elementos para un tema libre", { exact: true })
    .fill("4");
  await page
    .getByRole("button", { name: "Preparar propuesta continua", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: /^(Aplicar cambios \/ generar otra propuesta|Preparar propuesta continua)$/,
    }),
  ).toBeEnabled({ timeout: 180000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^Francés / })).toHaveCount(4);
  const first = await page.evaluate(() =>
    localStorage.getItem("tuto:continuous-proposal"),
  );
  await page
    .getByRole("textbox", {
      name: "Pide un cambio para la propuesta",
      exact: true,
    })
    .fill("Solo frases breves para despedirse, conserva cuatro elementos.");
  await page
    .getByRole("button", {
      name: "Aplicar cambios / generar otra propuesta",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Aplicar cambios / generar otra propuesta",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 180000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("tuto:continuous-proposal")),
  ).not.toBe(first);
  await expect(page.getByRole("textbox", { name: /^Francés / })).toHaveCount(4);
  expect((await request.get("/api/proposals/" + first)).ok()).toBe(true);
  await page
    .getByRole("button", {
      name: "Comenzar práctica con este catálogo",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/numbers\//);
  await expect(page).toHaveURL(/\/numbers\//);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  expect((await snapshot(request, id)).topic).toBe(true);
});
