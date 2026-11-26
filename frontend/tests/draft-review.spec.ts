import { test, expect } from "@playwright/test";
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

test("Confirmar 10 dispara IA sin botón manual y Guardar reutiliza la revisión en curso", async ({
  page,
  request,
}) => {
  await request.patch("/api/settings/review", { data: { auto_review: true } });
  await request.patch("/api/settings/audio", {
    data: { auto_transcribe: true },
  });
  const task = await (
    await request.post("/api/proposals", {
      data: {
        topic: "números",
        preferences: {
          minimum: 10,
          maximum: 10,
          minutes: 5,
          modalities: ["speaking"],
        },
      },
    })
  ).json();
  let proposal = "";
  await expect
    .poll(async () => {
      const job = await (await request.get(`/api/jobs/${task.job_id}`)).json();
      if (job.status === "failed") throw Error(job.error);
      proposal = job.result.proposal_id;
      return job.status;
    })
    .toBe("completed");
  const session = await (
    await request.post(`/api/proposals/${proposal}/start`)
  ).json();
  const activity = session.activities[0];
  await page.goto(`/session/${session.id}?activity=${activity.id}`);
  await page
    .getByRole("button", { name: "Grabar mi voz", exact: true })
    .click();
  await page.waitForTimeout(3500);
  await page
    .getByRole("button", { name: "Detener grabación", exact: true })
    .click();
  await expect(
    page.getByLabel("Transcripción automática · solo lectura"),
  ).toHaveValue("10", { timeout: 180000 });
  let requests = 0;
  await page.route("**/api/analyses", async (route) => {
    requests++;
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ response });
  });
  await page
    .getByRole("checkbox", {
      name: "La transcripción coincide con lo que dije",
    })
    .check();
  await expect.poll(() => requests).toBe(1);
  await expect(
    page.getByText(/Revisando con IA… Puedes guardar/),
  ).toBeVisible();
  const before = await (
    await request.get(
      `/api/attempt-history?session_id=${session.id}&activity_id=${activity.id}`,
    )
  ).json();
  expect(before.total).toBe(0);
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(
    page.getByText("Revisado por IA · comentario orientativo", { exact: true }),
  ).toBeVisible({ timeout: 180000 });
  expect(requests).toBe(1);
  await expect(page.locator(".result")).toContainText("dix");
  const after = await (
    await request.get(
      `/api/attempt-history?session_id=${session.id}&activity_id=${activity.id}`,
    )
  ).json();
  expect(after.total).toBe(1);
  expect(after.items[0].ai_reviews).toHaveLength(1);
  expect(after.items[0].result.advice.input_text).toBe("10");
  await page.screenshot({
    path: "../.runtime/screenshots/automatic-dix-feedback.png",
    fullPage: true,
  });
});

test("La pausa de escritura revisa sin guardar; una edición descarta el comentario anterior", async ({
  page,
  request,
}) => {
  await request.patch("/api/settings/review", { data: { auto_review: true } });
  const session = await (await request.post("/api/days/15/start")).json();
  const activity = session.activities.find(
    (a: { mode: string; title: string }) =>
      a.mode === "open" && a.title.includes("Escribir"),
  );
  await page.goto(`/session/${session.id}?activity=${activity.id}`);
  const requests: string[] = [];
  let releaseFirst: () => void = () => {};
  const firstReady = new Promise<void>((r) => (releaseFirst = r));
  await page.route("**/api/analyses", async (route) => {
    const data = route.request().postDataJSON();
    requests.push(data.response);
    await route.fulfill({
      json: { analysis_id: requests.length === 1 ? "old-test" : "new-test" },
    });
  });
  await page.route("**/api/analyses/*", async (route) => {
    const old = route.request().url().endsWith("old-test");
    if (old) await firstReady;
    const text = old ? "Bonjour." : "Bonsoir.";
    await route.fulfill({
      json: {
        status: "completed",
        result: {
          mode: "draft",
          temporary: true,
          saveable: true,
          input_text: text,
          advice: {
            input_text: text,
            corrected: text,
            feedback: old ? "Comentario anterior" : "Comentario actualizado",
            next_action: "Continúa.",
            source: "Respuesta controlada para comprobar cambios del borrador",
          },
        },
      },
    });
  });
  await page.getByLabel("Tu respuesta en francés").fill("Bonjour.");
  await expect.poll(() => requests.length).toBe(1);
  await page.getByLabel("Tu respuesta en francés").fill("Bonsoir.");
  await expect(
    page.getByText("Comentario actualizado", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Revisar de nuevo", exact: true }),
  ).toBeEnabled();
  const previousResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/analyses/old-test"),
  );
  releaseFirst();
  await (await previousResponse).finished();
  await page.waitForTimeout(100);
  await expect(
    page.getByText("Comentario anterior", { exact: true }),
  ).toHaveCount(0);
  expect(requests).toEqual(["Bonjour.", "Bonsoir."]);
  const history = await (
    await request.get(
      `/api/attempt-history?session_id=${session.id}&activity_id=${activity.id}`,
    )
  ).json();
  expect(history.total).toBe(0);
});

test("El rechazo explica el cambio de contenido y deja reintentar la revisión", async ({
  page,
  request,
}) => {
  await request.patch("/api/settings/review", { data: { auto_review: true } });
  const session = await (await request.post("/api/days/16/start")).json();
  const activity = session.activities.find(
    (a: { mode: string; title: string }) =>
      a.mode === "open" && a.title.includes("Escribir"),
  );
  await page.goto(`/session/${session.id}?activity=${activity.id}`);
  await page.route("**/api/analyses", (route) =>
    route.fulfill({ json: { analysis_id: "failed-feedback" } }),
  );
  await page.route("**/api/analyses/failed-feedback", (route) =>
    route.fulfill({
      json: {
        status: "completed",
        result: {
          mode: "draft",
          temporary: true,
          saveable: true,
          input_text: "10",
          advice_error:
            "La IA indicó que no había errores, pero propuso cambiar «10» por «deux», que tiene otro contenido. Se pidió una nueva revisión y el resultado siguió siendo incoherente. Esto es un fallo del revisor, no una nota negativa sobre tu respuesta. Puedes reintentar la revisión o guardar sin comentario de IA.",
        },
      },
    }),
  );
  await page.getByLabel("Tu respuesta en francés").fill("10");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("No se pudo validar el comentario de IA");
  await expect(alert).toContainText("«10» por «deux»");
  await expect(alert).toContainText("no una nota negativa");
  await expect(
    page.getByRole("button", {
      name: "Reintentar revisión de IA",
      exact: true,
    }),
  ).toBeEnabled();
});
