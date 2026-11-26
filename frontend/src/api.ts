import type { Job } from "./types";
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({
      detail: "No se pudo conectar. Tu respuesta permanece en esta pantalla.",
    }));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : Array.isArray(data.detail)
          ? data.detail
              .map((item: { msg?: string }) =>
                (item.msg || "Revisa los datos de la propuesta").replace(
                  /^Value error, /,
                  "",
                ),
              )
              .join(" ")
          : JSON.stringify(data.detail),
    );
  }
  return response.json();
}
export async function waitJob(
  id: string,
  onState?: (state: string) => void,
): Promise<Job> {
  for (let n = 0; n < 480; n++) {
    const j = await api<Job>("/jobs/" + id);
    onState?.(j.status);
    if (j.status === "completed") return j;
    if (j.status === "failed")
      throw new Error(j.error || "No se pudo completar. Vuelve a intentarlo.");
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(
    "El trabajo sigue en curso. Puedes retomarlo desde la misma pantalla.",
  );
}
export async function waitAnalysis(id: string): Promise<{
  id: string;
  status: string;
  result: import("./types").AnalysisResult;
  error?: string;
}> {
  for (let n = 0; n < 480; n++) {
    const value = await api<{
      id: string;
      status: string;
      result: import("./types").AnalysisResult;
      error?: string;
    }>("/analyses/" + id);
    if (value.status === "completed") return value;
    if (value.status === "failed")
      throw new Error(value.error || "No se pudo completar la comparación.");
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(
    "La comparación temporal tardó demasiado. Tu historial no ha cambiado.",
  );
}
