import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

async function makeProposal(request: APIRequestContext, continuous: boolean) {
  const result = await request.post("/api/proposals", {
    data: {
      topic: continuous ? "Días de la semana" : "Números 311–313",
      continuous,
      preferences: {
        minimum: 311,
        maximum: 313,
        modalities: ["writing", "reading"],
      },
    },
  });
  expect(result.ok()).toBeTruthy();
  const job = await result.json();
  let proposalId = "";
  await expect
    .poll(async () => {
      const j = await (await request.get(`/api/jobs/${job.job_id}`)).json();
      proposalId = j.result.proposal_id;
      return j.status;
    })
    .toBe("completed");
  return (await request.get(`/api/proposals/${proposalId}`)).json();
}

test.beforeEach(async ({ request }) => {
  const history = await (await request.get("/api/practice-history")).json();
  for (const pin of history.pins) {
    expect(
      (
        await request.patch(`/api/practice-history/${pin.session_id}`, {
          data: { action: "unpin" },
        })
      ).ok(),
    ).toBeTruthy();
  }
});

for (const continuous of [false, true]) {
  test(`Historial ${continuous ? "continuo" : "fijo"}: fijar, ocultar, reactivar y remover solo propuestas`, async ({
    page,
    request,
  }) => {
    const kind = continuous ? "continuous" : "fixed";
    const p = await makeProposal(request, continuous);
    await page.goto(`/practice${continuous ? "?mode=continuous" : ""}`);
    const history = page.locator("section.practice-history");
    const preparedId = continuous
      ? `continuous:proposal:${p.id}`
      : `fixed:${p.id}`;
    const prepared = history.locator(`[data-practice-id="${preparedId}"]`);
    await expect(
      prepared.getByRole("button", { name: "Eliminar propuesta", exact: true }),
    ).toBeVisible();
    await expect(
      prepared.getByRole("button", { name: "Fijar", exact: true }),
    ).toHaveCount(0);
    await expect(
      prepared.getByRole("button", { name: "Ocultar", exact: true }),
    ).toHaveCount(0);
    await prepared
      .getByRole("button", { name: "Revisar propuesta", exact: true })
      .click();
    const begin = page.getByRole("button", {
      name: continuous
        ? "Comenzar práctica con este catálogo"
        : "Comenzar esta versión",
      exact: true,
    });
    await expect(begin).toBeVisible();
    await prepared
      .getByRole("button", { name: "Eliminar propuesta", exact: true })
      .click();
    await history
      .getByRole("button", { name: "Cancelar", exact: true })
      .click();
    await expect(prepared).toBeVisible();
    await prepared
      .getByRole("button", { name: "Eliminar propuesta", exact: true })
      .click();
    await history
      .getByRole("button", { name: "Confirmar eliminación", exact: true })
      .click();
    await expect(prepared).toHaveCount(0);
    await expect(begin).toHaveCount(0); // currently open builder cleared, cannot revive removed draft
    expect((await request.get(`/api/proposals/${p.id}`)).status()).toBe(404);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        continuous ? "tuto:continuous-proposal" : "tuto:proposal",
      ),
    ).toBeNull();

    const started = await makeProposal(request, continuous);
    const start = await request.post(
      `/api/proposals/${started.id}/${continuous ? "start-continuous" : "start"}`,
      continuous
        ? {
            data: {
              entries: started.entries,
              modalities: started.preferences.modalities,
            },
          }
        : {},
    );
    expect(start.ok()).toBeTruthy();
    const s = await start.json();
    const sessionBefore = await (
      await request.get(
        continuous ? `/api/number-practice/${s.id}` : `/api/sessions/${s.id}`,
      )
    ).json();
    await page.reload();
    const rowId = continuous ? `continuous:${s.id}` : `fixed:${started.id}`;
    const row = history.locator(`[data-practice-id="${rowId}"]`);
    await expect(
      row.getByRole("button", { name: "Eliminar propuesta", exact: true }),
    ).toHaveCount(0);
    await row.getByRole("button", { name: "Fijar", exact: true }).click();
    await expect(row).toContainText("Fijada · 1");
    await page.reload();
    await expect(history.locator("tbody > tr").first()).toHaveAttribute(
      "data-practice-id",
      rowId,
    );
    await row.getByRole("button", { name: "Ocultar", exact: true }).click();
    await expect(row).toHaveCount(0);
    await history
      .getByRole("checkbox", { name: "Mostrar inactivas", exact: true })
      .check();
    await expect(row).toContainText("Inactiva");
    await expect(
      row.getByRole("button", { name: "Fijar", exact: true }),
    ).toBeDisabled();
    await expect(history.locator("summary")).toHaveText(
      "Organizar pines (0/10)",
    );
    await row.getByRole("button", { name: "Reactivar", exact: true }).click();
    await expect(row).not.toContainText("Inactiva");
    await page.reload();
    await expect(
      history.getByRole("checkbox", { name: "Mostrar inactivas", exact: true }),
    ).not.toBeChecked();
    await expect(row).toBeVisible();
    expect(
      (await request.delete(`/api/proposals/${started.id}`)).status(),
    ).toBe(409);
    const sessionAfter = await (
      await request.get(
        continuous ? `/api/number-practice/${s.id}` : `/api/sessions/${s.id}`,
      )
    ).json();
    expect(sessionAfter).toEqual(sessionBefore);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mkdir(resolve("../.runtime/screenshots"), { recursive: true });
    await page.screenshot({
      path: resolve(`../.runtime/screenshots/history-organization-${kind}.png`),
      fullPage: true,
    });
  });
}

test("Diez pines compartidos, ordenables entre menús y persistentes", async ({
  page,
  request,
}) => {
  const fixed = await makeProposal(request, false);
  const fixedSession = await (
    await request.post(`/api/proposals/${fixed.id}/start`)
  ).json();
  const sessions = [fixedSession];
  for (let i = 0; i < 10; i++) {
    const response = await request.post("/api/number-practice", {
      data: { request_id: randomUUID(), minimum: 320 + i, maximum: 321 + i },
    });
    expect(response.ok()).toBeTruthy();
    sessions.push(await response.json());
  }
  for (const s of sessions.slice(0, 10)) {
    expect(
      (
        await request.patch(`/api/practice-history/${s.id}`, {
          data: { action: "pin" },
        })
      ).ok(),
    ).toBeTruthy();
  }
  await page.goto("/practice?mode=continuous");
  const history = page.locator("section.practice-history");
  const last = history.locator(
    `[data-practice-id="continuous:${sessions[10].id}"]`,
  );
  await expect(
    last.getByRole("button", { name: "Fijar", exact: true }),
  ).toBeDisabled();
  await history.locator("summary").click();
  const list = history.locator(".history-pins ol");
  await expect(list.getByRole("listitem")).toHaveCount(10);
  await expect(list.getByRole("listitem").first()).toContainText(
    fixedSession.title,
  );
  await list
    .getByRole("listitem")
    .nth(1)
    .getByRole("button", { name: /Subir pin/ })
    .click();
  await expect(list.getByRole("listitem").first()).toContainText(
    sessions[1].title,
  );
  await page.reload();
  await history.locator("summary").click();
  await expect(list.getByRole("listitem").first()).toContainText(
    sessions[1].title,
  );
  await list
    .getByRole("listitem")
    .first()
    .getByRole("button", { name: /Quitar pin/ })
    .click();
  await expect(
    last.getByRole("button", { name: "Fijar", exact: true }),
  ).toBeEnabled();
  await last.getByRole("button", { name: "Fijar", exact: true }).click();
  await expect(history.locator("summary")).toHaveText(
    "Organizar pines (10/10)",
  );
  await page
    .getByRole("button", { name: "Sesiones fijas", exact: true })
    .click();
  const fixedRow = history.locator(`[data-practice-id="fixed:${fixed.id}"]`);
  await expect(fixedRow).toContainText("Fijada · 1");
  await history.locator("summary").click();
  await expect(list.getByRole("listitem")).toHaveCount(10);
  await expect(list.getByRole("listitem").last()).toContainText(
    sessions[10].title,
  );
  await history.locator("summary").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve("../.runtime/screenshots/history-organization-pins.png"),
  });
});
