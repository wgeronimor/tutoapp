import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Infinity as InfinityIcon } from "lucide-react";
import { api } from "./api";
import { Button } from "./components/ui/button";
import { AccuracyBadge, type Accuracy } from "./AccuracyBadge";
import type { Attempt, Exercise } from "./types";

type NumberMode = "write" | "speak" | "listen" | "read" | "dictation";
type AnswerFormat = "words" | "digits";
interface ContinuousSession {
  topic?: boolean;
  id: string;
  title: string;
  minimum: number;
  maximum: number;
  mode: NumberMode;
  answer_formats: Partial<Record<NumberMode, AnswerFormat[]>>;
  accuracy: Accuracy;
  modes: {
    id: NumberMode;
    title: string;
    skill: string;
    accuracy: Accuracy;
    seen: number;
  }[];
  activity: Exercise | null;
}
export interface QuickActivityProps {
  exercise: Exercise;
  sessionId: string;
  onSaved: (attempt: Attempt) => void;
  onNext: () => void | Promise<void>;
  formatControls?: ReactNode;
}

export function NumberPracticeLauncher({
  minimum = 1,
  maximum = 10,
}: {
  minimum?: number;
  maximum?: number;
}) {
  const [min, setMin] = useState(minimum);
  const [max, setMax] = useState(maximum);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const startId = useRef(crypto.randomUUID());
  const navigate = useNavigate();
  async function start() {
    setBusy(true);
    setError("");
    try {
      const session = await api<ContinuousSession>("/number-practice", "POST", {
        request_id: startId.current,
        minimum: min,
        maximum: max,
      });
      navigate("/numbers/" + session.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card continuous-launch">
      <span className="eyebrow">A TU RITMO · SIN LÍMITE DE RONDAS</span>
      <h2>Práctica continua de números</h2>
      <p>
        Cinco tipos de ejercicios, todo el rango y nuevos números en cada ronda.
        Puedes parar y volver cuando quieras.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <fieldset disabled={busy} className="activity-inputs">
          <div className="form-grid">
            <label>
              Desde (incluido)
              <input
                aria-label="Desde"
                type="number"
                min={1}
                max={500}
                required
                value={min}
                onChange={(e) => {
                  setMin(+e.target.value);
                  startId.current = crypto.randomUUID();
                }}
              />
            </label>
            <label>
              Hasta (incluido)
              <input
                aria-label="Hasta"
                type="number"
                min={min || 1}
                max={500}
                required
                value={max}
                onChange={(e) => {
                  setMax(+e.target.value);
                  startId.current = crypto.randomUUID();
                }}
              />
            </label>
          </div>
          <p className="small">
            Escribir · Decir el número · Escuchar y elegir · Leer y elegir ·
            Escuchar y escribir
          </p>
          <Button type="submit">
            <InfinityIcon size={18} />
            {busy ? "Preparando…" : "Comenzar práctica continua"}
          </Button>
        </fieldset>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="small">
        En cada tipo se mezclan los números sin repetir hasta recorrer el rango
        completo. Luego empieza otra vuelta. Las direcciones cifra ↔ letras se
        mezclan.
      </p>
    </section>
  );
}

export function ContinuousNumbers({
  renderActivity,
}: {
  renderActivity: (props: QuickActivityProps) => ReactNode;
}) {
  const { id } = useParams();
  const location = useLocation();
  const [selected, setSelected] = useState(
    new URLSearchParams(location.search).get("mode") || "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cache = useQueryClient();
  const [previousRound, setPreviousRound] = useState<{
    attempt: Attempt;
    mode: string;
  } | null>(null);
  const [pendingFormats, setPendingFormats] = useState<{
    mode: NumberMode;
    values: AnswerFormat[];
  } | null>(null);
  const key = ["number-practice", id];
  const session = useQuery({
    queryKey: key,
    queryFn: () =>
      api<ContinuousSession>(
        "/number-practice/" + id + (selected ? "?mode=" + selected : ""),
      ),
  });
  async function next(mode: NumberMode) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await cache.cancelQueries({ queryKey: key });
      const value = await api<ContinuousSession>(
        `/number-practice/${id}/next`,
        "POST",
        { mode },
      );
      setSelected(mode);
      cache.setQueryData(key, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeFormats(mode: NumberMode, values: AnswerFormat[]) {
    if (busy || !values.length || mode === "speak") return;
    setPendingFormats({ mode, values });
    setBusy(true);
    setError("");
    try {
      await cache.cancelQueries({ queryKey: key });
      const value = await api<ContinuousSession>(
        `/number-practice/${id}/formats`,
        "PATCH",
        { mode, formats: values },
      );
      await cache.cancelQueries({ queryKey: key });
      cache.setQueryData(key, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingFormats(null);
      setBusy(false);
    }
  }
  useEffect(() => {
    if (session.data && !session.data.activity && !busy)
      void next(session.data.mode);
  }, [session.data?.mode, session.data?.activity?.id]);
  if (session.error)
    return (
      <p className="error" role="alert">
        {session.error.message}
      </p>
    );
  if (!session.data) return <p>Cargando tu práctica…</p>;
  const s = session.data;
  const formats =
    pendingFormats?.mode === s.mode
      ? pendingFormats.values
      : (s.answer_formats?.[s.mode] ?? ["words", "digits"]);
  const formatControls =
    s.mode === "speak" || s.topic ? undefined : (
      <fieldset className="format-preferences" disabled={busy}>
        <legend>Formato de respuesta</legend>
        <div className="format-options-row">
          {(["words", "digits"] as AnswerFormat[]).map((format) => (
            <label className="checkbox" key={format}>
              <input
                type="checkbox"
                checked={formats.includes(format)}
                disabled={formats.length === 1 && formats.includes(format)}
                onChange={(event) => {
                  const values = event.target.checked
                    ? [...formats, format]
                    : formats.filter((f) => f !== format);
                  void changeFormats(s.mode, values);
                }}
              />
              {s.mode === "write" || s.mode === "dictation"
                ? "Escribe"
                : "Elige"}{" "}
              en {format === "words" ? "letras" : "cifras"}
            </label>
          ))}
        </div>
        <p className="small">
          Las casillas eligen los formatos que pueden salir; cada ronda pide
          uno. Al menos un formato activo. Se aplica al siguiente número; la
          ronda actual se conserva. Se recuerda para este tipo de ejercicio.
        </p>
      </fieldset>
    );
  return (
    <>
      <div className="continuous-top">
        <Link className="text-link" to="/practice?mode=continuous">
          <ArrowLeft size={15} />
          Cambiar rango o modalidad
        </Link>
        <span>
          {s.accuracy.attempts} intentos guardados{" "}
          <AccuracyBadge value={s.accuracy} />
        </span>
      </div>
      <header className="page-title">
        <span className="eyebrow">PRÁCTICA CONTINUA · A TU RITMO</span>
        <h1>
          {s.topic ? (
            s.title
          ) : (
            <>
              Números {s.minimum}–{s.maximum}
            </>
          )}
        </h1>
        <p>Elige un tipo y practica tantas rondas como quieras.</p>
      </header>
      <div className="session-layout continuous-layout">
        <aside className="session-outline">
          <h3>TIPOS DE PRÁCTICA</h3>
          {s.modes.map((mode) => (
            <button
              key={mode.id}
              className={s.mode === mode.id ? "active" : ""}
              disabled={busy}
              onClick={() => void next(mode.id)}
            >
              <span>
                <b>{mode.title}</b>
                <small>
                  {mode.accuracy.attempts} intentos{" "}
                  <AccuracyBadge value={mode.accuracy} />
                </small>
                <small>
                  {mode.seen}/{s.maximum - s.minimum + 1}{" "}
                  {s.topic ? "expresiones practicadas" : "números practicados"}
                </small>
              </span>
            </button>
          ))}
          <Link className="text-link" to={"/history?session=" + s.id}>
            Ver todo el historial
          </Link>
        </aside>
        <div className="continuous-workspace" aria-busy={busy}>
          <p className="quick-shortcuts">
            {s.mode === "speak" ? (
              <>
                {" "}
                <kbd>R</kbd> grabar / detener / reintentar · <kbd>Enter</kbd>{" "}
                guardar y continuar{" "}
              </>
            ) : (
              <>
                <kbd>Enter</kbd> comprobar / siguiente · <kbd>1</kbd>–
                <kbd>4</kbd> elegir · <kbd>R</kbd> grabar / detener ·{" "}
                <kbd>C</kbd> confirmar lectura · <kbd>L</kbd> escuchar
              </>
            )}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {previousRound &&
            previousRound.mode === s.mode &&
            previousRound.attempt.activity_id !== s.activity?.id && (
              <div
                className={
                  "previous-round-result " +
                  (previousRound.attempt.result.score === 100
                    ? "correct"
                    : "reinforce")
                }
                role="status"
              >
                <strong>
                  Ronda anterior:{" "}
                  {previousRound.attempt.result.format_mismatch
                    ? "Número correcto · formato distinto"
                    : previousRound.attempt.result.score === 100
                      ? "Correcto"
                      : previousRound.attempt.result.score === null
                        ? "Sin validación"
                        : "Vamos a reforzarlo"}
                </strong>
                <span className="previous-round-answer">
                  <b>
                    {previousRound.mode === "speak"
                      ? "Transcripción"
                      : previousRound.mode === "dictation" ||
                          previousRound.mode === "write"
                        ? "Escribiste"
                        : "Elegiste"}
                    :
                  </b>{" "}
                  <span className="previous-response">
                    {previousRound.attempt.response}
                  </span>
                  {" · "}
                  <b>Se esperaba:</b>{" "}
                  <span className="previous-expected">
                    {previousRound.attempt.result.accepted?.[0] ??
                      previousRound.attempt.result.reference}
                  </span>
                </span>
                <span>{previousRound.attempt.result.feedback}</span>
                <Link className="text-link" to={"/history?session=" + s.id}>
                  Ver historial
                </Link>
              </div>
            )}
          {s.activity && (
            <div className={busy ? "quick-loading" : ""}>
              {renderActivity({
                exercise: s.activity,
                sessionId: s.id,
                onSaved: (attempt) => {
                  if (s.activity) setPreviousRound({ attempt, mode: s.mode });
                  void session.refetch();
                },
                onNext: () => next(s.mode),
                formatControls,
              })}
            </div>
          )}
          <p className="small continuous-meaning">
            Aciertos = respuestas correctas / intentos evaluables. Los intentos
            sin nota no cuentan como errores. En habla se compara el número del
            reconocimiento con el solicitado, sin puntuar pronunciación.
            Consultar ayudas no convierte un acierto en dominio consolidado.{" "}
            Rojo: menos de 70%; amarillo: 70–85%; verde: 86–100%.
          </p>
        </div>
      </div>
    </>
  );
}
