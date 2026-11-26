import { test, expect } from "@playwright/test";

// Guides use the real local phonemizer. These tests never change learner data.
test("La guía AFI de números respeta el contexto y sigue disponible con el audio", async ({
  page,
  request,
}) => {
  const proposal = await (
    await request.post("/api/proposals", {
      data: {
        topic: "números",
        preferences: {
          minutes: 15,
          modalities: ["speaking"],
          level: "A1",
          minimum: 10,
          maximum: 10,
          selection: "mixed",
        },
      },
    })
  ).json();
  // This deterministic topic needs no language-model generation.
  let value = proposal;
  if (proposal.job_id) {
    for (let i = 0; i < 120; i++) {
      const job = await (
        await request.get(`/api/jobs/${proposal.job_id}`)
      ).json();
      if (job.status === "completed") {
        value = job.result;
        break;
      }
      if (job.status === "failed") throw Error(job.error);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const session = await (
    await request.post(`/api/proposals/${value.proposal_id ?? value.id}/start`)
  ).json();
  const activity = session.activities.find(
    (a: { reference: string }) => a.reference === "dix",
  );
  expect(activity).toBeTruthy();
  await page.goto(`/session/${session.id}?activity=${activity.id}`);
  await expect(
    page.getByRole("button", { name: "Escuchar referencia", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Guía de pronunciación", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Ver pronunciación (AFI)", exact: true })
    .click();
  const guide = page.getByLabel("Guía de pronunciación", { exact: true });
  await expect(guide.getByLabel("Transcripción fonética AFI")).toHaveText(
    "/dis/",
  );
  await expect(guide).toContainText("sin /k/");
  await expect(guide).toContainText("dix dollars /di dɔlaʁ/");
  await expect(guide).toContainText("dix ans /diz ɑ̃/");
  await page
    .getByRole("button", { name: "Escuchar referencia", exact: true })
    .click();
  await expect(page.getByLabel("Audio de referencia")).toBeVisible({
    timeout: 180000,
  });
  await expect(guide).toBeVisible();
  await page.screenshot({
    path: "../.runtime/screenshots/pronunciation-dix.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Ocultar pronunciación (AFI)", exact: true })
    .click();
  await expect(guide).toHaveCount(0);
});

test("Consultar AFI en memoria cuenta como ayuda, no revela antes y permite reintentar si falla", async ({
  page,
  request,
}) => {
  const session = await (await request.post("/api/days/9/start")).json();
  const activity = session.activities.find(
    (a: { mode: string }) => a.mode === "exact",
  );
  await page.goto(`/session/${session.id}?activity=${activity.id}`);
  await expect(
    page.getByLabel("Guía de pronunciación", { exact: true }),
  ).toHaveCount(0);
  let fail = true;
  await page.route(
    `**/api/activities/${activity.id}/pronunciation`,
    async (route) => {
      if (fail) {
        fail = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Guía temporalmente no disponible" }),
        });
      } else await route.continue();
    },
  );
  await page
    .getByRole("button", { name: "Ver pronunciación (AFI)", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "temporalmente no disponible",
  );
  await expect(
    page.getByRole("button", { name: "Escuchar referencia", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Ver pronunciación (AFI)", exact: true })
    .click();
  const guide = page.getByLabel("Guía de pronunciación", { exact: true });
  await expect(guide).toBeVisible();
  const french = (await guide.locator('p[lang="fr"]').textContent())!;
  await page.getByLabel("Tu respuesta en francés").fill(french);
  await page
    .getByRole("button", { name: "Guardar y revisar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Respuesta correcta · 100%" }),
  ).toBeVisible();
  const history = await (
    await request.get(
      `/api/attempt-history?session_id=${session.id}&activity_id=${activity.id}`,
    )
  ).json();
  expect(history.items[0].evidence.hint).toBe(true);
  await page
    .getByRole("button", { name: "Nuevo intento", exact: true })
    .click();
  await expect(
    page.getByLabel("Guía de pronunciación", { exact: true }),
  ).toHaveCount(0);
});

test("Las referencias de escucha y las frases nuevas tienen guía sin mezclar actividades", async ({
  page,
  request,
}) => {
  const session = await (await request.post("/api/days/10/start")).json();
  const listening = session.activities.find(
    (a: { skill: string }) => a.skill === "listening",
  );
  const repeating = session.activities.find((a: { key: string }) =>
    a.key.endsWith(":repeat"),
  );
  const spontaneous = session.activities.find((a: { key: string }) =>
    a.key.endsWith(":speak"),
  );
  await page.goto(`/session/${session.id}?activity=${listening.id}`);
  await expect(
    page.getByRole("button", { name: "Ver pronunciación (AFI)", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ver pronunciación (AFI)", exact: true })
    .click();
  await expect(
    page.getByLabel("Guía de pronunciación", { exact: true }),
  ).toBeVisible();
  await page.goto(`/session/${session.id}?activity=${repeating.id}`);
  await expect(
    page.getByLabel("Guía de pronunciación", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Ver pronunciación (AFI)", exact: true })
    .click();
  await expect(
    page.getByLabel("Guía de pronunciación", { exact: true }),
  ).toContainText(repeating.reference);
  await page.goto(`/session/${session.id}?activity=${spontaneous.id}`);
  await expect(
    page.getByRole("button", { name: "Ver pronunciación (AFI)", exact: true }),
  ).toHaveCount(0);
});
