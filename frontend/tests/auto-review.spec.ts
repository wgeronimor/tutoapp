import { test, expect } from "@playwright/test";

const reviewLabel = "Revisión automática de IA";
const response =
  "Bonjour, je m'appelle Wilson. J'habite à Vancouver, au Canada. Je parle espagnol et anglais. J'apprends le français. Je travaille à la maison. J'aime lire et écouter de la musique.";

test("Guardar revisa automáticamente y un reintento de red conserva una sola revisión", async ({
  page,
  request,
}) => {
  await request.patch("/api/settings/review", { data: { auto_review: true } });
  const session = await (await request.post("/api/days/6/start")).json();
  const activity = session.activities.find(
    (a: { mode: string; title: string }) =>
      a.mode === "open" && a.title.includes("Escribir"),
  );
  await page.goto(`/session/${session.id}?activity=${activity.id}`);
  await expect(page.getByRole("checkbox", { name: reviewLabel })).toBeChecked();
  await page.getByLabel("Tu respuesta en francés").fill(response);
  let analyses = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/analyses") && r.method() === "POST") analyses++;
  });
  let interrupted = false;
  await page.route("**/api/attempts", async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Revisando con IA…", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Tu respuesta en francés")).toBeDisabled();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 180000 });
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(
    page.getByText("Revisado por IA · comentario orientativo", { exact: true }),
  ).toBeVisible();
  expect(analyses).toBe(1);
  const history = await (
    await request.get(
      `/api/attempt-history?session_id=${session.id}&activity_id=${activity.id}`,
    )
  ).json();
  expect(history.total).toBe(1);
  expect(history.items[0].ai_reviews).toHaveLength(1);
  expect(history.items[0].result.advice.feedback).toBeTruthy();
  await page.reload();
  await expect(
    page.getByText("Revisado por IA · comentario orientativo", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Nuevo intento", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: reviewLabel })).toBeChecked();
});

test("Desactivar la revisión persiste y guardar no solicita IA; un fallo conserva el borrador", async ({
  page,
  request,
}) => {
  await request.patch("/api/settings/review", { data: { auto_review: true } });
  const session = await (await request.post("/api/days/7/start")).json();
  const activity = session.activities.find(
    (a: { mode: string; title: string }) =>
      a.mode === "open" && a.title.includes("Escribir"),
  );
  const url = `/session/${session.id}?activity=${activity.id}`;
  await page.goto(url);
  await page.getByLabel("Tu respuesta en francés").fill(response);
  let analyses = 0;
  await page.route("**/api/analyses", async (route) => {
    analyses++;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "IA no disponible en esta prueba" }),
    });
  });
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("IA no disponible");
  await expect(page.getByLabel("Tu respuesta en francés")).toHaveValue(
    response,
  );
  const before = await (
    await request.get(
      `/api/attempt-history?session_id=${session.id}&activity_id=${activity.id}`,
    )
  ).json();
  expect(before.total).toBe(0);
  await page.getByRole("checkbox", { name: reviewLabel }).uncheck();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/settings")).json()).auto_review,
    )
    .toBe(false);
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: reviewLabel }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(
    page.getByText("Sin revisión de IA", { exact: true }),
  ).toBeVisible();
  expect(analyses).toBe(1);
  const after = await (
    await request.get(
      `/api/attempt-history?session_id=${session.id}&activity_id=${activity.id}`,
    )
  ).json();
  expect(after.total).toBe(1);
  expect(after.items[0].ai_reviews).toHaveLength(0);
});

test("Habla conserva la confirmación de lectura y revisa al guardar", async ({
  page,
  request,
}) => {
  await request.patch("/api/settings/review", { data: { auto_review: true } });
  await request.patch("/api/settings/audio", {
    data: { auto_transcribe: true },
  });
  const session = await (await request.post("/api/days/8/start")).json();
  const activity = session.activities.find(
    (a: { mode: string }) => a.mode === "speak",
  );
  await page.goto(`/session/${session.id}?activity=${activity.id}`);
  await page
    .getByRole("button", { name: "Grabar mi voz", exact: true })
    .click();
  await page.waitForTimeout(5000);
  await page
    .getByRole("button", { name: "Detener grabación", exact: true })
    .click();
  await expect(
    page.getByLabel("Transcripción automática · solo lectura"),
  ).not.toHaveValue("", { timeout: 180000 });
  let analyses = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/analyses") && r.method() === "POST") analyses++;
  });
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "confirma que la transcripción",
  );
  expect(analyses).toBe(0);
  await page
    .getByRole("checkbox", {
      name: "La transcripción coincide con lo que dije",
    })
    .check();
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Muestra guardada para revisar" }),
  ).toBeVisible({ timeout: 180000 });
  expect(analyses).toBe(1);
  const history = await (
    await request.get(
      `/api/attempt-history?session_id=${session.id}&activity_id=${activity.id}`,
    )
  ).json();
  expect(history.total).toBe(1);
  expect(history.items[0].ai_reviews).toHaveLength(1);
  expect(history.items[0].evidence.transcript_review.status).toBe("matches");
});
