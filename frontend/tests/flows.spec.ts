import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const screenshot = async (
  page: import("@playwright/test").Page,
  name: string,
) => {
  await mkdir(resolve("../.runtime/screenshots"), { recursive: true });
  await page.screenshot({
    path: resolve("../.runtime/screenshots/" + name + ".png"),
    fullPage: true,
  });
};
test("Hoy, 28 días, guardado idempotente y reanudación", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Cada día, un poco más lejos." }),
  ).toBeVisible();
  await screenshot(page, "home");
  await page.getByRole("link", { name: "Mi programa", exact: true }).click();
  await expect(page.locator(".course-day")).toHaveCount(28);
  await page.locator(".course-day").first().click();
  await page
    .getByRole("button", { name: /Frase activa 1 · de memoria/ })
    .click();
  const answer = page.getByLabel("Tu respuesta en francés");
  await answer.fill("Bonjour, je m’appelle Wilson.");
  const before = (await (await request.get("/api/history")).json())[1].length;
  let intercepted = false;
  await page.route("**/api/attempts", async (route) => {
    if (!intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(answer).toHaveValue("Bonjour, je m’appelle Wilson.");
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Respuesta correcta · 100%" }),
  ).toBeVisible();
  const after = (await (await request.get("/api/history")).json())[1].length;
  expect(after - before).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Respuesta correcta · 100%" }),
  ).toBeVisible();
  await expect(page.getByLabel("Tu respuesta en francés")).toHaveValue(
    "Bonjour, je m’appelle Wilson.",
  );
  await screenshot(page, "session");
});
test("Tema, cambios, regeneración y sesión con Kokoro real", async ({
  page,
}) => {
  await page.goto("/practice");
  await page
    .getByRole("button", { name: "Números 100–500", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Preparar propuesta", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Números 100–500", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Pide un cambio").fill("Solo escucha, solo 10 minutos");
  await page
    .getByRole("button", { name: "Aplicar cambios / generar nuevamente" })
    .click();
  await expect(page.locator(".proposal")).toContainText("10 min");
  await expect(page.locator(".proposal .pill")).toHaveCount(3);
  await page.getByRole("button", { name: "Comenzar esta versión" }).click();
  await expect(page.locator(".exercise .pill")).toHaveText("Escucha");
  await page
    .getByRole("button", { name: "Escuchar referencia", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Escuchar referencia", exact: true }),
  ).toBeEnabled({ timeout: 180000 });
  const audio = page.getByLabel("Audio de referencia");
  await expect(audio).toBeVisible();
  await expect
    .poll(() => audio.evaluate((el: HTMLAudioElement) => el.readyState))
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Ver transcripción / ayuda" }).click();
  await expect(page.getByText("AYUDA CONSULTADA")).toBeVisible();
  await screenshot(page, "listening");
});
test("Grabación MediaRecorder, conversión, VAD, ASR e historial", async ({
  page,
  request,
}) => {
  const session = await (await request.post("/api/days/2/start")).json();
  await page.goto("/session/" + session.id);
  await page.getByRole("button", { name: /Hablar · sin leer/ }).click();
  await page
    .getByRole("button", { name: "Grabar mi voz", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Detener grabación", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(5000);
  await page
    .getByRole("button", { name: "Detener grabación", exact: true })
    .click();
  await expect(
    page.getByText("TRANSCRIPCIÓN AUTOMÁTICA", { exact: true }),
  ).toBeVisible({ timeout: 180000 });
  await expect(
    page.getByLabel("Transcripción automática · solo lectura"),
  ).not.toHaveValue("");
  await expect(
    page.getByLabel("Transcripción automática · solo lectura"),
  ).toHaveAttribute("readonly", "");
  await page
    .getByRole("checkbox", { name: "Revisión automática de IA" })
    .uncheck();
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Muestra guardada para revisar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Coincide con lo que dije", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Evaluar antes de guardar", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Grabación guardada")).toBeVisible();
  await screenshot(page, "recording");
});
test("Agenda, meta, historial, exportación y diseño móvil", async ({
  page,
}) => {
  await page.goto("/classes");
  await page.getByLabel("Unidad Édito A1").selectOption("4");
  await page.getByLabel("Páginas anunciadas").fill("59–62");
  await page.getByLabel("Agenda").selectOption("Confirmada");
  await page.getByRole("button", { name: "Guardar y preparar" }).click();
  await expect(
    page.getByRole("heading", { name: "Preparación de clase · U4" }),
  ).toBeVisible({ timeout: 180000 });
  await page.goto("/settings");
  await page.getByLabel(/Meta personal/).fill("90");
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByText("Configuración guardada.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Meta personal/)).toHaveValue("90");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar mis datos" }).click();
  expect((await download).suggestedFilename()).toBe("tuto-export.tar.gz");
  await page.goto("/history");
  await expect(page.locator(".history-entry").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Eliminar grabación", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Añadir nota / rectificar comentario",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto("/");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Cada día, un poco más lejos." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await screenshot(page, "mobile");
});
test("Tema nuevo con Qwen3 real y cambios en lenguaje natural", async ({
  page,
}) => {
  await page.goto("/practice");
  await page
    .getByLabel("Tu tema o situación")
    .fill("Pedir ayuda para reparar una bicicleta");
  await page
    .getByRole("button", { name: "Preparar propuesta", exact: true })
    .click();
  await expect(page.locator(".proposal h2")).toBeVisible({ timeout: 180000 });
  await expect(page.locator(".proposal")).toContainText("Qwen3");
  await page
    .getByLabel("Pide un cambio")
    .fill("Más fácil, solo 10 minutos y solo escritura");
  await page
    .getByRole("button", { name: "Aplicar cambios / generar nuevamente" })
    .click();
  await expect(page.locator(".proposal")).toContainText("10 min", {
    timeout: 180000,
  });
  await expect(page.locator(".proposal .pill")).toHaveCount(3);
  await page.getByRole("button", { name: "Comenzar esta versión" }).click();
  await expect(page.locator(".exercise .pill")).toHaveText("Escritura");
});
test("Silencio real se rechaza antes de transcribir", async ({ request }) => {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(
    resolve("../local-model-tests/audio/silence.wav"),
  );
  const r = await request.post("/api/recordings", {
    multipart: { file: { name: "silence.wav", mimeType: "audio/wav", buffer } },
  });
  expect(r.ok()).toBeTruthy();
  const id = (await r.json()).job_id;
  await expect
    .poll(
      async () => {
        const j = await (await request.get("/api/jobs/" + id)).json();
        if (j.status === "failed") throw new Error(j.error);
        return j.status;
      },
      { timeout: 180000 },
    )
    .toBe("completed");
  const result = (await (await request.get("/api/jobs/" + id)).json()).result;
  expect(result.no_speech).toBe(true);
  expect(result.text).toBe("");
});
test("Vista previa local, descarte y guardado sin transcripción", async ({
  page,
  request,
}) => {
  const s = await (await request.post("/api/days/3/start")).json();
  await page.goto("/session/" + s.id);
  await page.getByRole("button", { name: /Hablar · sin leer/ }).click();
  const automatic = page.getByRole("checkbox", {
    name: "Transcribir automáticamente al detener",
  });
  await automatic.uncheck();
  await expect(automatic).not.toBeChecked();
  let uploads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/recordings") && r.method() === "POST") uploads++;
  });
  await page
    .getByRole("button", { name: "Grabar mi voz", exact: true })
    .click();
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: "Detener grabación", exact: true })
    .click();
  await expect(page.getByLabel("Mi grabación")).toBeVisible();
  expect(uploads).toBe(0);
  await page
    .getByRole("button", { name: "Descartar toma", exact: true })
    .click();
  await expect(page.getByLabel("Mi grabación")).toHaveCount(0);
  expect(uploads).toBe(0);
  await page
    .getByRole("button", { name: "Grabar mi voz", exact: true })
    .click();
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: "Detener grabación", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Usar sin transcripción", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Guardar y revisar", exact: true }),
  ).toBeEnabled();
  expect(uploads).toBe(1);
  await page
    .getByRole("checkbox", { name: "Revisión automática de IA" })
    .uncheck();
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Muestra guardada para revisar" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Grabación guardada")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pedir comentario orientativo" }),
  ).toHaveCount(0);
  expect(
    (await (await request.get("/api/settings")).json()).auto_transcribe,
  ).toBe(false);
});
test("Contador de intentos, historial de actividad y estado sin revisión de IA", async ({
  page,
  request,
}) => {
  const s = await (await request.post("/api/days/4/start")).json();
  await page.goto("/session/" + s.id);
  await page
    .getByRole("button", { name: /Frase activa 1 · de memoria/ })
    .click();
  await page.getByLabel("Tu respuesta en francés").fill("incorrect");
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Vamos a reforzarla · 0%" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Nuevo intento", exact: true })
    .click();
  await page.getByLabel("Tu respuesta en francés").fill("otra respuesta");
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(page.locator(".exercise")).toContainText("2 intentos guardados");
  await expect(page.locator(".exercise")).toContainText("Sin revisión de IA");
  await page
    .getByRole("link", { name: "Ver historial de esta actividad", exact: true })
    .click();
  await expect(page.locator(".history-entry")).toHaveCount(2);
  await expect(
    page.getByText(/2 intentos guardados en esta actividad/),
  ).toBeVisible();
});
test("Historial definitivo y comparación de voz sin modificar registros", async ({
  page,
  request,
}) => {
  const items = (
    await (await request.get("/api/attempt-history?skill=speaking")).json()
  ).items;
  const old = items.find(
    (x: { response: string; media_id: string }) => x.response && x.media_id,
  );
  expect(old).toBeTruthy();
  const before = await (
    await request.get(
      "/api/attempt-history?session_id=" +
        old.session_id +
        "&activity_id=" +
        old.activity_id,
    )
  ).json();
  await page.goto(
    "/history?session=" + old.session_id + "&activity=" + old.activity_id,
  );
  const entry = page.locator('[id="' + old.id + '"]');
  await expect(entry).toBeVisible();
  await expect(
    entry.getByRole("button", { name: /Eliminar|rectificar|Coincide con/ }),
  ).toHaveCount(0);
  await entry
    .getByRole("button", {
      name: "Evaluar con modelos actuales · temporal",
      exact: true,
    })
    .click();
  await expect(
    entry.getByText("Comparación temporal · no guardada", { exact: true }),
  ).toBeVisible({ timeout: 180000 });
  const after = await (
    await request.get(
      "/api/attempt-history?session_id=" +
        old.session_id +
        "&activity_id=" +
        old.activity_id,
    )
  ).json();
  expect(after).toEqual(before);
  expect((await request.delete("/api/media/" + old.media_id)).status()).toBe(
    409,
  );
  await expect(
    entry.getByRole("link", {
      name: "Ir a la actividad y hacer un nuevo intento",
    }),
  ).toBeVisible();
});
test("Evaluar un borrador antes de guardar conserva la revisión como parte del nuevo intento", async ({
  page,
  request,
}) => {
  const session = await (await request.post("/api/days/5/start")).json();
  const a = session.activities.find(
    (x: { mode: string; title: string }) =>
      x.mode === "open" && x.title.includes("Escribir"),
  );
  await page.goto("/session/" + session.id + "?activity=" + a.id);
  await page
    .getByLabel("Tu respuesta en francés")
    .fill(
      "Bonjour, je m'appelle Wilson. J'habite à Vancouver, au Canada. Je parle espagnol et anglais. J'apprends le français. Je travaille à la maison. J'aime lire et écouter de la musique.",
    );
  const before = await (
    await request.get(
      "/api/attempt-history?session_id=" + session.id + "&activity_id=" + a.id,
    )
  ).json();
  await page
    .getByRole("button", { name: "Evaluar antes de guardar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Comentario orientativo del texto" }),
  ).toBeVisible({ timeout: 180000 });
  expect(
    (
      await (
        await request.get(
          "/api/attempt-history?session_id=" +
            session.id +
            "&activity_id=" +
            a.id,
        )
      ).json()
    ).total,
  ).toBe(before.total);
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Muestra guardada para revisar" }),
  ).toBeVisible();
  await expect(
    page.getByText("Revisado por IA · comentario orientativo", { exact: true }),
  ).toBeVisible();
  const after = await (
    await request.get(
      "/api/attempt-history?session_id=" + session.id + "&activity_id=" + a.id,
    )
  ).json();
  expect(after.total).toBe(before.total + 1);
  expect(after.items[0].ai_reviews).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Evaluar antes de guardar", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Nuevo intento", exact: true }),
  ).toBeVisible();
});
