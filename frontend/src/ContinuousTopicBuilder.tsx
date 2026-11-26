import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "./components/ui/button";
import { NumberPracticeLauncher } from "./ContinuousNumbers";
import { api, waitJob } from "./api";
import type { Skill } from "./types";
import { skillName } from "./types";
interface Entry {
  french: string;
  spanish: string;
}
interface Proposal {
  id: string;
  topic: string;
  title: string;
  objective: string;
  tip: string;
  origin: string;
  level: string;
  entry_count?: number;
  session_id: string | null;
  entries: Entry[];
  session_entries?: Entry[];
  session_modalities?: Skill[];
  preferences: { modalities: Skill[] };
}
export function ContinuousTopicBuilder({
  reviewId,
  removedId,
  minimum = 1,
  maximum = 10,
  numeric = false,
}: {
  reviewId: string | null;
  removedId?: string | null;
  minimum?: number;
  maximum?: number;
  numeric?: boolean;
}) {
  const [numbers, setNumbers] = useState(numeric);
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("A1");
  const [count, setCount] = useState(12);
  const [modalities, setModalities] = useState<Skill[]>([
    "reading",
    "listening",
    "writing",
    "speaking",
  ]);
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const navigate = useNavigate();
  const cache = useQueryClient();
  useEffect(() => {
    if (removedId && proposal?.id === removedId) {
      setProposal(null);
      setEntries([]);
      setError("");
      setStatus("");
    }
  }, [removedId, proposal?.id]);
  async function load(id: string) {
    const p = await api<Proposal>("/proposals/" + id);
    setProposal(p);
    setTopic(p.topic);
    setLevel(p.level);
    setCount(p.entry_count ?? p.entries.length);
    setModalities(p.session_modalities ?? p.preferences.modalities);
    setEntries(p.session_entries ?? p.entries);
    setInstruction("");
    localStorage.setItem("tuto:continuous-proposal", p.id);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }
  useEffect(() => {
    const id = reviewId || localStorage.getItem("tuto:continuous-proposal");
    const job = localStorage.getItem("tuto:continuous-proposal-job");
    if (reviewId) setNumbers(false);
    if (job && !reviewId)
      void run(async () => {
        setStatus("Retomando la propuesta en preparación…");
        const j = await waitJob(job);
        await load(String(j.result.proposal_id));
        localStorage.removeItem("tuto:continuous-proposal-job");
        void cache.invalidateQueries({
          queryKey: ["practice-history", "continuous"],
        });
      });
    else if (id)
      void run(async () => {
        await load(id);
      });
  }, [reviewId]);
  async function generate() {
    await run(async () => {
      setStatus("Preparando el catálogo para practicar…");
      const job = await api<{ job_id: string }>("/proposals", "POST", {
        topic,
        continuous: true,
        entry_count: count,
        parent_id: proposal?.id ?? null,
        instruction,
        preferences: {
          level,
          minutes: 15,
          modalities,
          minimum: 1,
          maximum: 100,
          selection: "mixed",
          time_mode: "daily",
        },
      });
      localStorage.setItem("tuto:continuous-proposal-job", job.job_id);
      const result = await waitJob(job.job_id);
      await load(String(result.result.proposal_id));
      localStorage.removeItem("tuto:continuous-proposal-job");
      void cache.invalidateQueries({
        queryKey: ["practice-history", "continuous"],
      });
    });
  }
  const frozen = !!proposal?.session_id;
  return (
    <>
      <div
        className="practice-mode-switch"
        role="group"
        aria-label="Contenido de práctica continua"
      >
        <Button
          variant={numbers ? "secondary" : "default"}
          onClick={() => setNumbers(false)}
        >
          Por tema
        </Button>
        <Button
          variant={numbers ? "default" : "secondary"}
          onClick={() => setNumbers(true)}
        >
          Por rango de números
        </Button>
      </div>
      {numbers ? (
        <NumberPracticeLauncher minimum={minimum} maximum={maximum} />
      ) : (
        <div
          className="practice-layout continuous-topic-builder"
          id="continuous-practice-builder"
        >
          <section className="card">
            <h2>Prepara una práctica continua</h2>
            <label htmlFor="continuous-topic">
              Tema o situación para practicar sin límite
            </label>
            <textarea
              id="continuous-topic"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                setProposal(null);
                setEntries([]);
              }}
              placeholder="Meses del año, días de la semana, frases para viajar…"
            />
            <div className="chips">
              {[
                "Meses del año",
                "Días de la semana",
                "Meses y días de la semana",
                "Expresiones del aula",
                "Pedir un café",
              ].map((t) => (
                <Button
                  key={t}
                  variant="ghost"
                  onClick={() => {
                    setTopic(t);
                    setProposal(null);
                    setEntries([]);
                    setInstruction("");
                  }}
                >
                  {t}
                </Button>
              ))}
            </div>
            <div className="form-row">
              <div>
                <label htmlFor="continuous-level">Nivel de la propuesta</label>
                <select
                  id="continuous-level"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                >
                  {["A0", "A1", "A2"].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="continuous-count">
                  Elementos para un tema libre
                </label>
                <input
                  id="continuous-count"
                  type="number"
                  min={2}
                  max={60}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </div>
            </div>
            <p className="small">
              Meses y días incluyen sus listas completas. Otros temas preparan
              un catálogo de 2–60 elementos; las rondas no tienen límite.
            </p>
            <fieldset disabled={busy || frozen}>
              <legend>Destrezas del catálogo</legend>
              <div className="chips">
                {(
                  ["reading", "listening", "writing", "speaking"] as Skill[]
                ).map((s) => (
                  <label className="checkbox" key={s}>
                    <input
                      type="checkbox"
                      checked={modalities.includes(s)}
                      disabled={
                        modalities.length === 1 && modalities.includes(s)
                      }
                      onChange={(e) =>
                        setModalities(
                          e.target.checked
                            ? [...modalities, s]
                            : modalities.filter((v) => v !== s),
                        )
                      }
                    />
                    {skillName[s]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor="continuous-change">
              Pide un cambio para la propuesta
            </label>
            <textarea
              id="continuous-change"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Más expresiones de trabajo, frases más cortas…"
            />
            <Button
              disabled={busy || !topic.trim() || count < 2 || count > 60}
              onClick={() => void generate()}
            >
              {busy
                ? "Preparando…"
                : proposal
                  ? "Aplicar cambios / generar otra propuesta"
                  : "Preparar propuesta continua"}
            </Button>
            <p className="small" role="status">
              {status}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
          <section
            className="card continuous-catalog"
            aria-label="Catálogo de práctica continua"
          >
            {proposal ? (
              <>
                <span className="eyebrow">REVISA ANTES DE COMENZAR</span>
                <h2>{proposal.title}</h2>
                <p>{proposal.objective}</p>
                <p className="small">
                  {entries.length} elementos · {proposal.level} ·{" "}
                  {proposal.origin}
                </p>
                <p>{proposal.tip}</p>
                <p className="small">
                  {frozen
                    ? "Este catálogo ya está creado y se conserva. Para cambiarlo, genera otra propuesta."
                    : "Revisa cada traducción. Puedes ajustar el borrador y añadir elementos antes de comenzar; lo guardado se conservará."}
                </p>
                <div className="catalog-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Francés</th>
                        <th>Español</th>
                        {!frozen && <th>Borrador</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e, i) => (
                        <tr key={i}>
                          <td>
                            <input
                              aria-label={`Francés ${i + 1}`}
                              value={e.french}
                              readOnly={frozen}
                              maxLength={240}
                              onChange={(event) =>
                                setEntries((v) =>
                                  v.map((r, k) =>
                                    k === i
                                      ? { ...r, french: event.target.value }
                                      : r,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`Español ${i + 1}`}
                              value={e.spanish}
                              readOnly={frozen}
                              maxLength={240}
                              onChange={(event) =>
                                setEntries((v) =>
                                  v.map((r, k) =>
                                    k === i
                                      ? { ...r, spanish: event.target.value }
                                      : r,
                                  ),
                                )
                              }
                            />
                          </td>
                          {!frozen && (
                            <td>
                              <Button
                                variant="ghost"
                                disabled={entries.length <= 2}
                                onClick={() =>
                                  setEntries((v) => v.filter((_, k) => k !== i))
                                }
                              >
                                Quitar del borrador {i + 1}
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!frozen && (
                  <Button
                    variant="secondary"
                    disabled={entries.length >= 60}
                    onClick={() =>
                      setEntries((v) => [...v, { french: "", spanish: "" }])
                    }
                  >
                    Añadir elemento al borrador
                  </Button>
                )}
                <p className="small">
                  Se recorre todo el catálogo en cada tipo antes de repetir.
                  Cada respuesta guardada conserva su ejercicio y actualiza el
                  historial compartido. La repetición oral comprueba el texto
                  reconocido, sin medir pronunciación.
                </p>
                <Button
                  disabled={
                    busy ||
                    entries.length < 2 ||
                    entries.some((e) => !e.french.trim() || !e.spanish.trim())
                  }
                  onClick={() =>
                    void run(async () => {
                      const s = await api<{ id: string }>(
                        `/proposals/${proposal.id}/start-continuous`,
                        "POST",
                        { entries, modalities },
                      );
                      navigate("/numbers/" + s.id);
                    })
                  }
                >
                  {frozen
                    ? "Continuar esta práctica"
                    : "Comenzar práctica con este catálogo"}
                </Button>
              </>
            ) : (
              <>
                <h2>Tu tema, tantas rondas como quieras</h2>
                <p>
                  Escribe lo que quieres practicar. Verás el catálogo completo y
                  podrás ajustarlo antes de empezar.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
