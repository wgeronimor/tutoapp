import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

test("El historial distingue tipos pendientes, rondas y cobertura y abre cada tipo", async ({
  page,
  request,
}) => {
  const s = await (
    await request.post("/api/number-practice", {
      data: { request_id: randomUUID(), minimum: 1, maximum: 3 },
    })
  ).json();
  const activity = s.activity;
  const answer =
    activity.source.answer_format === "digits"
      ? String(activity.source.number)
      : (
          await (
            await request.get(`/api/activities/${activity.id}/transcript`)
          ).json()
        ).text;
  await request.post("/api/attempts", {
    data: {
      id: randomUUID(),
      session_id: s.id,
      activity_id: activity.id,
      response: answer,
    },
  });
  await page.goto("/practice?mode=continuous");
  const table = page.getByRole("table", {
    name: "Prácticas continuas anteriores",
  });
  const row = table.getByRole("row").filter({
    has: page.getByRole("link", {
      name: "Números 1–3 · práctica continua",
      exact: true,
    }),
  });
  await expect(row).toContainText("1/5 tipos practicados · 20%");
  await expect(row).toContainText("1 ronda practicada");
  await expect(row.locator("time")).toHaveCount(2);
  await expect(row.getByRole("link", { name: /pendiente/ })).toHaveCount(4);
  await mkdir(resolve("../.runtime/screenshots"), { recursive: true });
  await page.screenshot({
    path: resolve("../.runtime/screenshots/practice-history-continuous.png"),
    fullPage: true,
  });
  await row
    .getByRole("link", {
      name: "Leer y elegir: 0 rondas, pendiente",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/numbers/${s.id}\\?mode=read`));
  await expect(
    page.getByRole("heading", { name: "Leer y elegir", exact: true }),
  ).toBeVisible();
  const current = await (
    await request.get(`/api/number-practice/${s.id}?mode=read`)
  ).json();
  const ref = (
    await (
      await request.get(`/api/activities/${current.activity.id}/transcript`)
    ).json()
  ).text;
  const response =
    current.activity.source.answer_format === "digits"
      ? String(current.activity.source.number)
      : ref;
  await request.post("/api/attempts", {
    data: {
      id: randomUUID(),
      session_id: s.id,
      activity_id: current.activity.id,
      response,
    },
  });
  await page.goto("/practice?mode=continuous");
  await expect(row).toContainText("2/5 tipos practicados · 40%");
  await page.reload();
  await expect(row).toContainText("2/5 tipos practicados · 40%");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row).toContainText("2/5 tipos practicados");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: resolve("../.runtime/screenshots/practice-history-mobile.png"),
    fullPage: true,
  });
});

test("Las propuestas anteriores se revisan y las sesiones se retoman sin recrearlas", async ({
  page,
  request,
}) => {
  const job = await (
    await request.post("/api/proposals", {
      data: {
        topic: "Números 41–43",
        preferences: {
          minutes: 10,
          level: "A1",
          minimum: 41,
          maximum: 43,
          modalities: ["writing"],
          selection: "mixed",
          time_mode: "daily",
        },
      },
    })
  ).json();
  let p: any;
  await expect
    .poll(async () => {
      const j = await (await request.get(`/api/jobs/${job.job_id}`)).json();
      p = j.result;
      return j.status;
    })
    .toBe("completed");
  await page.goto("/practice");
  const row = page
    .getByRole("table", { name: "Sesiones fijas anteriores" })
    .getByRole("row")
    .filter({ hasText: "Números 41–43" });
  await expect(row).toContainText("Preparada, sin iniciar");
  await row
    .getByRole("button", { name: "Revisar propuesta", exact: true })
    .click();
  await expect(page.getByLabel("Tu tema o situación")).toHaveValue(
    "Números 41–43",
  );
  await page
    .getByRole("button", { name: "Comenzar esta versión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/session\//);
  const sid = new URL(page.url()).pathname.split("/").pop();
  const session = await (await request.get(`/api/sessions/${sid}`)).json();
  const a = session.activities[0];
  const answer = (
    await (await request.get(`/api/activities/${a.id}/transcript`)).json()
  ).text;
  await request.post("/api/attempts", {
    data: {
      id: randomUUID(),
      session_id: sid,
      activity_id: a.id,
      response: answer,
    },
  });
  await page.goto("/practice");
  await expect(row).toContainText(`1/${session.activities.length} respondidas`);
  await expect(row.locator("time")).toHaveCount(2);
  await row.getByRole("button", { name: "Ver propuesta", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continuar esta sesión" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve("../.runtime/screenshots/practice-history-fixed.png"),
    fullPage: true,
  });
  await row.getByRole("link", { name: "Continuar", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/session/${sid}$`));
  expect(
    (await (await request.get(`/api/proposals/${p.proposal_id}`)).json())
      .session_id,
  ).toBe(sid);
});
