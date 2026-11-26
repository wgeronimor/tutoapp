import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
async function start(request: APIRequestContext, mode: string) {
  const s = await (
    await request.post("/api/number-practice", {
      data: { request_id: randomUUID(), minimum: 3, maximum: 3 },
    })
  ).json();
  if (mode === "write") {
    const response =
      s.activity.source.answer_format === "words" ? "trois" : "3";
    await request.post("/api/attempts", {
      data: {
        id: randomUUID(),
        session_id: s.id,
        activity_id: s.activity.id,
        response,
      },
    });
  }
  await request.patch(`/api/number-practice/${s.id}/formats`, {
    data: { mode, formats: ["digits"] },
  });
  await request.post(`/api/number-practice/${s.id}/next`, { data: { mode } });
  return s.id;
}
for (const mode of ["dictation", "write"]) {
  test(`${mode}: indica el formato al responder y explica trois frente a 3`, async ({
    page,
    request,
  }) => {
    const id = await start(request, mode);
    await page.goto(`/numbers/${id}?mode=${mode}`);
    {
      const auto = page.getByRole("checkbox", {
        name: "Avanzar automáticamente al comprobar",
        exact: true,
      });
      await auto.uncheck();
      await expect(auto).toBeEnabled();
    }
    const digits = page.getByRole("textbox", {
      name: "Escribe en cifras (0–9)",
      exact: true,
    });
    await expect(digits).toBeEditable();
    await expect(digits).toHaveAttribute("placeholder", "Solo cifras (0–9)");
    await expect(digits).toHaveAttribute("inputmode", "numeric");
    await expect(page.locator(".number-answer-note")).toContainText(
      "solo dígitos",
    );
    if (mode === "dictation")
      await expect(page.locator(".number-answer-note")).toContainText(
        "El audio siempre pronuncia el número en francés",
      );
    // Changing allowed formats must not relabel this frozen question.
    await page
      .getByRole("checkbox", { name: "Escribe en letras", exact: true })
      .check();
    await page
      .getByRole("checkbox", { name: "Escribe en cifras", exact: true })
      .uncheck();
    await expect(digits).toBeVisible();
    await digits.fill("trois");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", {
        name: "Número correcto · formato distinto",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".quick-result")).toContainText(
      "esta ronda pedía cifras",
    );
    await expect(page.locator(".quick-result")).toContainText(
      "se esperaba «3»",
    );
    await mkdir(resolve("../.runtime/screenshots"), { recursive: true });
    if (mode === "dictation")
      await page.screenshot({
        path: resolve("../.runtime/screenshots/answer-format-dictation.png"),
        fullPage: true,
      });
    await page
      .getByRole("button", { name: "Siguiente número · Enter", exact: true })
      .click();
    const words = page.getByRole("textbox", {
      name: "Escribe en letras francesas",
      exact: true,
    });
    await expect(words).toBeEditable();
    await expect(words).toHaveAttribute(
      "placeholder",
      "El número escrito con palabras en francés",
    );
    await expect(words).toHaveAttribute("inputmode", "text");
    await page.reload();
    await expect(words).toBeEditable();
    await words.fill("3");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", {
        name: "Número correcto · formato distinto",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".quick-result")).toContainText(
      "pedía letras francesas",
    );
    await expect(page.locator(".quick-result")).toContainText(
      "se esperaba «trois»",
    );
    await page
      .getByRole("button", { name: "Siguiente número · Enter", exact: true })
      .click();
    await expect(words).toBeEditable();
    await words.fill("trois");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Correcto", exact: true }),
    ).toBeVisible();
  });
}
