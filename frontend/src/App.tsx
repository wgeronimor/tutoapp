import manifest from "../package.json";
import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  NavLink,
  Routes,
  Route,
  Link,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Headphones,
  History as HistoryIcon,
  Layers,
  Mic,
  Play,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  TrendingUp,
  Volume2,
  X,
  Square,
  CircleHelp,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { AccuracyBadge } from "./AccuracyBadge";
import { PracticeHistory } from "./PracticeHistory";
import { NumberSpeech } from "./NumberSpeech";
import { ContinuousTopicBuilder } from "./ContinuousTopicBuilder";
import { ContinuousNumbers } from "./ContinuousNumbers";
import { api, waitJob, waitAnalysis } from "./api";
import type {
  AnalysisResult,
  Attempt,
  ClassItem,
  CourseDay,
  Exercise,
  MemoryItem,
  Prefs,
  PronunciationGuide,
  Proposal,
  Settings,
  Skill,
  StudySession,
} from "./types";
import { skillName } from "./types";

const fmt = (date: string) =>
  new Date(date).toLocaleString("es-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
function editingText(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      (target instanceof HTMLTextAreaElement && !target.readOnly) ||
      (target instanceof HTMLInputElement &&
        ["text", "number", "search", "email"].includes(target.type) &&
        !target.readOnly))
  );
}
function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="error">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
function Loading() {
  return <div className="card loading">Preparando tu espacio de estudio…</div>;
}
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}
const nav = [
  ["/", "Hoy", CalendarDays],
  ["/course", "Mi programa", BookOpen],
  ["/practice", "Practicar un tema", Sparkles],
  ["/classes", "Mis clases", Layers],
  ["/reviews", "Frases y repasos", RefreshCw],
  ["/history", "Historial", HistoryIcon],
  ["/progress", "Mi progreso", TrendingUp],
  ["/settings", "Configuración", SettingsIcon],
] as const;
export default function App() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () =>
      api<{
        version: string;
        postgres: string;
        ollama: boolean;
        audio: boolean;
        ffmpeg: boolean;
      }>("/health"),
    refetchInterval: 30000,
  });
  const location = useLocation();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/">
          <span className="brand-mark">t.</span>
          <span>
            tuto<span className="brand-dot">.</span>
            <small>LE FRANÇAIS, CHAQUE JOUR</small>
          </span>
        </Link>
        <div className="nav-label">TU ESPACIO DE APRENDIZAJE</div>
        <nav>
          {nav.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className={"status-dot " + (health.data ? "online" : "")} />
          {health.data
            ? "Guardado local · PostgreSQL"
            : "Conectando con tu Mac"}
          <small>
            Primera versión · {health.data?.version || manifest.version}
          </small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            MON ESPACE <b>/</b>{" "}
            {nav.find(([p]) => p === location.pathname)?.[1] ||
              "Sesión de práctica"}
          </span>
          <span className="local-pill">
            <span className="status-dot online" />
            En tu Mac
          </span>
        </header>
        <main>
          <ErrorBox error={health.error} />
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/course" element={<Course />} />
            <Route path="/session/:id" element={<SessionPage />} />
            <Route path="/practice" element={<Practice />} />
            <Route
              path="/numbers/:id"
              element={
                <ContinuousNumbers
                  renderActivity={(props) => (
                    <ActivityPanel key={props.exercise.id} {...props} quick />
                  )}
                />
              }
            />
            <Route path="/classes" element={<Classes />} />
            <Route path="/reviews" element={<Reviews />} />
            <Route path="/history" element={<History />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="*"
              element={
                <p>
                  Página no encontrada. <Link to="/">Volver a Hoy</Link>
                </p>
              }
            />
          </Routes>
        </main>
        <footer>
          Un poco de francés. Un paso más cerca.
          <span>Tuto · Programa personal de 39 semanas</span>
        </footer>
      </div>
    </div>
  );
}
function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}
function Today() {
  const navigate = useNavigate();
  const action = useAction();
  const data = useQuery({
    queryKey: ["today"],
    queryFn: () =>
      api<{
        day: number;
        suggested_day: number;
        due: number;
        missed: number[];
        budget: number;
        review_minutes: number;
        new_minutes: number;
        week: number;
        studied_minutes: number;
        extra_minutes: number;
        remaining_minutes: number;
        message: string;
      }>("/today"),
  });
  const course = useQuery({
    queryKey: ["course"],
    queryFn: () => api<{ days: CourseDay[] }>("/course"),
  });
  const history = useQuery({
    queryKey: ["history"],
    queryFn: () =>
      api<
        [
          { session_id: string; title: string; practice_url?: string }[],
          Attempt[],
        ]
      >("/history"),
  });
  if (!data.data || !course.data)
    return (
      <>
        <ErrorBox error={data.error || course.error} />
        <Loading />
      </>
    );
  const t = data.data,
    day = course.data.days.find((d) => d.day === t.suggested_day)!,
    current = course.data.days.filter((x) => x.week === day.week);
  async function start() {
    await action.run(async () => {
      const s = await api<StudySession>("/days/" + day.day + "/start", "POST");
      navigate("/session/" + s.id);
    });
  }
  return (
    <>
      <PageTitle
        eyebrow="BONJOUR · TU MOMENTO DE FRANCÉS"
        title="Cada día, un poco más lejos."
        description="Tu programa, tus clases y lo que necesitas recordar. Todo en un lugar."
      />
      <div className="hero-grid">
        <section className="hero">
          <div className="hero-kicker">
            <span className="pill light">A0 → A1</span>
            <span>SEMANA {day.week} / 39</span>
          </div>
          <div className="hero-number" aria-hidden="true">
            {String(day.day).padStart(2, "0")}
          </div>
          <p className="eyebrow">TU SIGUIENTE SESIÓN · DÍA {day.day}</p>
          <h2>{day.title}</h2>
          <p className="hero-goal">{day.goal}</p>
          <div className="hero-meta">
            <span>
              <Clock3 size={16} />
              {t.budget} min personales
            </span>
            <span>
              <BookOpen size={16} />
              Édito A1 · Unidad {day.unit}
            </span>
          </div>
          <Button disabled={action.busy} onClick={start}>
            {day.done ? "Retomar mi sesión" : "Comenzar mi sesión"}
            <ArrowRight size={18} />
          </Button>
          <p className="hero-foot">
            {day.done} de {day.total} actividades guardadas
          </p>
        </section>
        <div className="side-cards">
          <section className="card memory-card">
            <div className="round-icon">
              <RefreshCw size={20} />
            </div>
            <span className="eyebrow">DARLE TIEMPO A LA MEMORIA</span>
            <h3>{t.due} repasos pendientes</h3>
            <p>Recupera lo aprendido antes de añadir algo nuevo.</p>
            <Link className="text-link" to="/reviews">
              Ir a mis repasos <ArrowRight size={16} />
            </Link>
          </section>
          <section className="card class-card">
            <span className="eyebrow">ANTES DE LEVANTAR LA MANO</span>
            <h3>Llega a clase con una idea.</h3>
            <p>Confirma la unidad y prepara las expresiones que vas a usar.</p>
            <Link className="text-link" to="/classes">
              Preparar mi clase <ArrowRight size={16} />
            </Link>
          </section>
        </div>
      </div>
      <ErrorBox error={action.error} />
      <div className="section-heading">
        <h2>Tu semana, paso a paso</h2>
        <Link to="/course" className="text-link">
          Ver el programa <ArrowRight size={16} />
        </Link>
      </div>
      <div className="week-strip">
        {current.map((d) => (
          <button
            key={d.day}
            className={"day-tile " + (d.day === day.day ? "selected" : "")}
            onClick={() =>
              action.run(async () => {
                const s = await api<StudySession>(
                  "/days/" + d.day + "/start",
                  "POST",
                );
                navigate("/session/" + s.id);
              })
            }
          >
            <span>DÍA {d.day}</span>
            <b>
              {d.done === d.total ? (
                <Check size={20} />
              ) : (
                String(d.day).padStart(2, "0")
              )}
            </b>
            <small>{d.title}</small>
            <div className="mini-track">
              <i style={{ width: (100 * d.done) / d.total + "%" }} />
            </div>
          </button>
        ))}
      </div>
      <div className="bottom-grid">
        <section className="card">
          <span className="eyebrow">UN RITMO QUE PUEDES SOSTENER</span>
          <h3>
            {t.review_minutes} min de repaso + {t.new_minutes} min de sesión
          </h3>
          <p>{t.message}</p>
          <p className="small">
            Hoy: {t.studied_minutes} min personales + {t.extra_minutes} min
            adicionales. Quedan {t.remaining_minutes} min de tu disponibilidad
            personal; puedes pausar y retomar mañana.
          </p>
          <p className="small">
            Las 2 horas de academia de lunes a jueves se registran aparte. Si
            retomas trabajo pendiente, la app reduce contenido nuevo.
          </p>
        </section>
        <section className="card">
          <span className="eyebrow">TU ÚLTIMO PASO</span>
          {history.data?.[0][0] ? (
            <>
              <h3>{history.data[0][0].title}</h3>
              <Link
                to={
                  history.data[0][0].practice_url ||
                  "/session/" + history.data[0][0].session_id
                }
                className="text-link"
              >
                Continuar donde lo dejaste <ArrowRight size={16} />
              </Link>
            </>
          ) : (
            <>
              <h3>Tu historial empieza contigo.</h3>
              <p>
                Cada respuesta, corrección y grabación tendrá su lugar aquí.
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
function Course() {
  const q = useQuery({
    queryKey: ["course"],
    queryFn: () => api<{ days: CourseDay[]; total_weeks: number }>("/course"),
  });
  const a = useAction();
  const navigate = useNavigate();
  return (
    <>
      <PageTitle
        eyebrow="UNE BASE SOLIDE"
        title="Mi programa"
        description="Cuatro semanas preparadas. Un camino de 39 semanas que crecerá con tu aprendizaje."
      />
      <ErrorBox error={q.error || a.error} />
      {[1, 2, 3, 4].map((w) => (
        <section key={w} className="course-week">
          <div className="section-heading">
            <h2>Semana {w}</h2>
            <Button
              variant="secondary"
              disabled={a.busy}
              onClick={() =>
                a.run(async () => {
                  const s = await api<StudySession>(
                    "/evaluations/" + w + "/start",
                    "POST",
                  );
                  navigate("/session/" + s.id);
                })
              }
            >
              Evaluar semana {w}
            </Button>
            <span className="pill">
              {
                [
                  "Presentarse y comprender",
                  "Familia, vivienda y gustos",
                  "Compras y desplazamientos",
                  "Descripción y planes",
                ][w - 1]
              }
            </span>
          </div>
          <div className="course-grid">
            {q.data?.days
              .filter((d) => d.week === w)
              .map((d) => (
                <button
                  className="card course-day"
                  key={d.day}
                  onClick={() =>
                    a.run(async () => {
                      const s = await api<StudySession>(
                        "/days/" + d.day + "/start",
                        "POST",
                      );
                      navigate("/session/" + s.id);
                    })
                  }
                >
                  <span className="eyebrow">
                    DÍA {d.day} · U{d.unit}
                    {d.evaluation ? " · EVALUACIÓN" : ""}
                  </span>
                  <h3>{d.title}</h3>
                  <p>{d.goal}</p>
                  <div className="course-foot">
                    <span>
                      {d.done}/{d.total} actividades
                    </span>
                    <ArrowRight size={18} />
                  </div>
                </button>
              ))}
          </div>
        </section>
      ))}
      <section className="card">
        <h3>Semanas 5–39 · siguiente ampliación</h3>
        <p>
          A1 hasta la semana 9; A2 10–17; B1 18–24; B2 25–30; preparación TCF
          31; consolidación 32–39. El nivel real se comprobará por destreza.
        </p>
      </section>
    </>
  );
}
function SessionPage() {
  const { id } = useParams();
  const route = useLocation();
  const requestedActivity = new URLSearchParams(route.search).get("activity");
  const q = useQuery({
    queryKey: ["session", id],
    queryFn: () => api<StudySession>("/sessions/" + id),
  });
  const qc = useQueryClient();
  const [index, setIndex] = useState<number | null>(null);
  useEffect(() => setIndex(null), [id]);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const s = q.data;
  const requestedIndex = requestedActivity
    ? s.activities.findIndex((a) => a.id === requestedActivity)
    : -1;
  const idx =
    index ?? (requestedIndex >= 0 ? requestedIndex : (s.state.cursor ?? 0));
  const current = s.activities[idx] || s.activities[0];
  const blocks = [...new Set(s.activities.map((x) => x.block))];
  function select(i: number) {
    setIndex(i);
    void api("/sessions/" + id, "PATCH", { cursor: i }).catch(() => {});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return (
    <>
      <div className="session-top">
        <Link to="/" className="text-link">
          <ChevronLeft size={16} />
          Volver a Hoy
        </Link>
        <span className="pill">
          {s.done}/{s.total} actividades · {s.attempt_count ?? 0} intentos
          guardados · {Math.round(s.seconds / 60)} min reales
          <AccuracyBadge value={s.accuracy} />
        </span>
      </div>
      <PageTitle
        eyebrow={s.source === "topic" ? "PRATIQUE LIBRE" : "TA SÉANCE"}
        title={s.title}
        description={s.state.goal}
      />
      {/^Números\s+\d+/.test(s.title) &&
        (() => {
          const range = s.title.match(/(\d+)\D+(\d+)/);
          return range ? (
            <p>
              <Link
                className="text-link"
                to={`/practice?mode=continuous&min=${range[1]}&max=${range[2]}`}
              >
                Practicar este rango sin límite →
              </Link>
            </p>
          ) : null;
        })()}
      <div className="session-layout">
        <aside className="session-outline">
          <div className="progress-track">
            <i style={{ width: (100 * s.done) / s.total + "%" }} />
          </div>
          {blocks.map((b) => (
            <div key={b}>
              <h4>{b}</h4>
              {s.activities.map(
                (act, i) =>
                  act.block === b && (
                    <button
                      key={act.id}
                      className={idx === i ? "active" : ""}
                      onClick={() => select(i)}
                    >
                      <span
                        className={
                          "outline-dot " + (act.attempt ? "complete" : "")
                        }
                      >
                        {act.attempt ? <Check size={12} /> : i + 1}
                      </span>
                      <span>
                        {act.title}
                        <small>
                          {skillName[act.skill]} · {act.minutes} min
                        </small>
                      </span>
                    </button>
                  ),
              )}
            </div>
          ))}
        </aside>
        <div>
          <ActivityPanel
            key={current.id}
            exercise={current}
            sessionId={s.id}
            onSaved={() => {
              void qc.invalidateQueries();
            }}
          />
          {s.assessment && (
            <section className="card summary">
              <h3>
                {s.assessment.correct} / {s.assessment.total} ·{" "}
                {s.assessment.percent}% de aciertos
              </h3>
              <p>
                Meta histórica: {s.assessment.target}%.{" "}
                {s.assessment.passed
                  ? "Meta cumplida en comprensión y ejercicios cerrados."
                  : "Requiere refuerzo para tu meta."}{" "}
                La producción abierta se revisa con su rúbrica.
              </p>
            </section>
          )}
          {s.done === s.total && (
            <section className="card success summary">
              <h3>Sesión guardada. Bien joué !</h3>
              <p>
                {s.percent === null
                  ? "Tus muestras de producción están conservadas para revisar."
                  : `${s.percent}% de aciertos en las preguntas cerradas respondidas. Revisa los intentos y repite sin ayudas.`}
              </p>
              <Link className="text-link" to="/progress">
                Ver mi progreso <ArrowRight size={16} />
              </Link>
            </section>
          )}
          <div className="activity-nav">
            <Button
              variant="secondary"
              disabled={idx === 0}
              onClick={() => select(idx - 1)}
            >
              <ChevronLeft size={16} />
              Anterior
            </Button>
            <span>
              {idx + 1} / {s.total}
            </span>
            <Button
              disabled={idx >= s.total - 1}
              onClick={() => select(idx + 1)}
            >
              Siguiente
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
function AudioReference({
  exercise,
  onPlay,
  onTranscript,
  onHelp,
  quick = false,
  autoPlay = false,
}: {
  exercise: Exercise;
  onPlay: () => void;
  onTranscript: (text: string) => void;
  onHelp: () => void;
  quick?: boolean;
  autoPlay?: boolean;
}) {
  const action = useAction();
  const guideAction = useAction();
  const [guide, setGuide] = useState<PronunciationGuide | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [url, setUrl] = useState<string>();
  const [status, setStatus] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  async function play() {
    await action.run(async () => {
      if (url) {
        await audio.current?.play();
        return;
      }
      setStatus("Preparando la voz de Kokoro…");
      const task = await api<{ job_id: string }>(
        "/activities/" + exercise.id + "/audio",
        "POST",
      );
      const job = await waitJob(task.job_id);
      setUrl(job.result.url as string);
      setStatus("");
    });
  }
  const playShortcut = useRef(play);
  playShortcut.current = play;
  useEffect(() => {
    if (!quick) return;
    const listener = (event: KeyboardEvent) => {
      if (
        event.code === "KeyL" &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !editingText(event.target)
      ) {
        event.preventDefault();
        if (!action.busy) void playShortcut.current();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [quick, action.busy]);
  useEffect(() => {
    if (autoPlay) void playShortcut.current();
  }, [autoPlay, exercise.id]);
  useEffect(() => {
    if (url) {
      void audio.current
        ?.play()
        .catch(() => setStatus("Pulsa reproducir para escuchar."));
    }
  }, [url]);
  return (
    <div className="audio-box">
      <div className="audio-main">
        <span className="audio-icon">
          <Headphones size={22} />
        </span>
        <div>
          <b>Écoute et essaie.</b>
          <small>Kokoro · voz francesa · ff_siwis</small>
        </div>
        <Button variant="secondary" disabled={action.busy} onClick={play}>
          <Volume2 size={17} />
          {action.busy ? "Preparando…" : "Escuchar referencia"}
        </Button>
      </div>
      {url && (
        <audio
          aria-label="Audio de referencia"
          ref={audio}
          controls
          src={url}
          onPlay={onPlay}
        />
      )}
      <small>{status}</small>
      <Button
        variant="ghost"
        disabled={guideAction.busy}
        aria-expanded={showGuide}
        aria-controls={"pronunciation-" + exercise.id}
        onClick={() => {
          if (showGuide) {
            setShowGuide(false);
            return;
          }
          void guideAction.run(async () => {
            if (!guide) {
              const value = await api<PronunciationGuide>(
                "/activities/" + exercise.id + "/pronunciation",
              );
              setGuide(value);
            }
            onHelp();
            setShowGuide(true);
          });
        }}
      >
        <CircleHelp size={14} />
        {guideAction.busy
          ? "Preparando pronunciación…"
          : showGuide
            ? "Ocultar pronunciación (AFI)"
            : "Ver pronunciación (AFI)"}
      </Button>
      {showGuide && guide && (
        <section
          className="pronunciation-guide"
          id={"pronunciation-" + exercise.id}
          aria-label="Guía de pronunciación"
        >
          <h3>Pronunciación · Alfabeto Fonético Internacional</h3>
          <p lang="fr">{guide.text}</p>
          <p className="ipa" aria-label="Transcripción fonética AFI">
            /{guide.ipa}/
          </p>
          <ul>
            {guide.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <small>
            Guía generada automáticamente para esta referencia. Puede requerir
            revisión en nombres propios o expresiones poco habituales. Escucha
            también el audio; no es una evaluación de tu pronunciación.
          </small>
          <details>
            <summary>Acerca de esta guía</summary>
            <p className="small">{guide.method}</p>
            {guide.sources.map((source) => (
              <p key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              </p>
            ))}
          </details>
        </section>
      )}
      {(exercise.mode === "choice" || exercise.mode === "exact") && (
        <small>
          Consultar la pronunciación cuenta como ayuda en este intento.
        </small>
      )}
      <Button
        variant="ghost"
        onClick={() =>
          action.run(async () => {
            const r = await api<{ text: string }>(
              "/activities/" + exercise.id + "/transcript",
            );
            onTranscript(r.text);
          })
        }
      >
        <CircleHelp size={14} />
        Ver transcripción / ayuda
      </Button>
      <ErrorBox error={action.error} />
      <ErrorBox error={guideAction.error} />
    </div>
  );
}
function Recorder({
  onReady,
  quick = false,
}: {
  onReady: (media: string, text: string, notice?: string) => void;
  quick?: boolean;
}) {
  const cfg = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const [automatic, setAutomatic] = useState<boolean | null>(null);
  const auto = automatic ?? cfg.data?.auto_transcribe ?? true;
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [alternatives, setAlternatives] = useState<
    { text: string; model: string; revision: string }[]
  >([]);
  const [chosen, setChosen] = useState(false);
  const action = useAction();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef("");
  const objectUrl = useRef("");
  const mounted = useRef(true);
  const notify = useRef(onReady);
  notify.current = onReady;
  useEffect(() => {
    mounted.current = true;
    function discardOnLeave() {
      if (pending.current)
        void fetch("/api/recordings/" + pending.current + "/discard", {
          method: "POST",
          keepalive: true,
        }).catch(() => {});
    }
    window.addEventListener("pagehide", discardOnLeave);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", discardOnLeave);
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      discardOnLeave();
    };
  }, []);
  async function clearTake() {
    if (pending.current) {
      await api("/recordings/" + pending.current + "/discard", "POST");
      pending.current = "";
    }
    notify.current("", "");
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
    setUrl("");
    setBlob(null);
    setTranscript("");
    setAlternatives([]);
    setChosen(false);
    setStatus("Toma descartada. No se añadió al historial.");
  }
  async function start() {
    await action.run(async () => {
      if (blob || pending.current) await clearTake();
      if (!navigator.mediaDevices)
        throw new Error(
          "Abre la dirección local de Tuto para usar el micrófono.",
        );
      let expired = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const capture = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      try {
        stream.current = await Promise.race([
          capture,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              expired = true;
              reject(
                new Error(
                  "El micrófono no respondió. Revisa los permisos del navegador y macOS.",
                ),
              );
            }, 30000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
        if (expired)
          void capture
            .then((s) => s.getTracks().forEach((t) => t.stop()))
            .catch(() => {});
      }
      if (!mounted.current) {
        stream.current.getTracks().forEach((t) => t.stop());
        return;
      }
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const m = new MediaRecorder(
        stream.current,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = m;
      chunks.current = [];
      m.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      m.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        const local = new Blob(chunks.current, { type: m.mimeType });
        setBlob(local);
        const object = URL.createObjectURL(local);
        objectUrl.current = object;
        setUrl(object);
        setStatus(
          auto
            ? "Preparando la transcripción automática; después puedes descartar la toma."
            : "Escucha la toma y elige qué hacer. Permanece solo en este navegador.",
        );
        if (auto) void useTake(local, true);
      };
      m.start();
      setRecording(true);
      setTranscript("");
      setAlternatives([]);
      setStatus("Grabando. Habla con calma.");
      timer.current = setTimeout(finish, 120000);
    });
  }
  function finish() {
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
    setRecording(false);
  }
  const recordShortcut = useRef(() => {});
  recordShortcut.current = () => {
    if (!action.busy) {
      if (recording) finish();
      else void start();
    }
  };
  useEffect(() => {
    if (!quick) return;
    const listener = (event: KeyboardEvent) => {
      if (
        event.code === "KeyR" &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !editingText(event.target)
      ) {
        event.preventDefault();
        recordShortcut.current();
        if (event.target instanceof HTMLElement) event.target.blur();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [quick]);
  async function useTake(take: Blob, transcribe: boolean) {
    await action.run(async () => {
      if (pending.current) {
        await api("/recordings/" + pending.current + "/discard", "POST");
        pending.current = "";
      }
      setStatus(
        transcribe
          ? "Reconociendo la voz; el texto generado será de solo lectura…"
          : "Preparando esta toma sin solicitar reconocimiento…",
      );
      const form = new FormData();
      form.append("file", take, "intento");
      form.append("transcribe", String(transcribe));
      const r = await api<{ media_id: string; job_id: string | null }>(
        "/recordings",
        "POST",
        form,
      );
      pending.current = r.media_id;
      if (!mounted.current) {
        await api("/recordings/" + r.media_id + "/discard", "POST");
        return;
      }
      if (!transcribe) {
        setChosen(true);
        setStatus(
          "Toma elegida sin transcripción. Pulsa Guardar y revisar para conservarla con el intento.",
        );
        notify.current(r.media_id, "");
        return;
      }
      const j = await waitJob(r.job_id!);
      if (!mounted.current) return;
      if (j.result.no_speech || j.result.needs_retry) {
        await api("/recordings/" + r.media_id + "/discard", "POST");
        pending.current = "";
        const reason = String(
          j.result.quality_reason ||
            "No se generó una transcripción: no se detectó voz suficiente. Escucha y vuelve a grabar.",
        );
        setStatus(reason);
        notify.current("", "", reason);
        return;
      }
      const text = String(j.result.text || "");
      setTranscript(text);
      setAlternatives(
        (j.result.alternatives ?? []) as {
          text: string;
          model: string;
          revision: string;
        }[],
      );
      setChosen(true);
      const notice = text.trim()
        ? ""
        : "El reconocimiento terminó sin texto. Puedes repetir la toma o usarla sin transcripción.";
      notify.current(r.media_id, text, notice);
      setStatus(
        notice ||
          (j.result.needs_review
            ? "Los reconocedores difieren. Compara las lecturas antes de guardar; puedes descartar esta toma."
            : "Transcripción disponible sin edición. Puedes guardar el intento o descartar la toma."),
      );
    });
  }
  return (
    <section className="recorder">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={auto}
          disabled={recording || action.busy}
          onChange={(e) => {
            const value = e.target.checked;
            setAutomatic(value);
            void action.run(() =>
              api("/settings/audio", "PATCH", { auto_transcribe: value }),
            );
          }}
        />
        Transcribir automáticamente al detener
      </label>
      <p className="small">
        {auto
          ? "Activado: al detener se solicita la transcripción automáticamente."
          : "Desactivado: no se solicita reconocimiento hasta que lo elijas."}{" "}
        Los modelos funcionan en tu Mac.
      </p>
      <div className="row">
        <Button
          variant={recording ? "destructive" : "default"}
          disabled={action.busy}
          onClick={recording ? finish : start}
        >
          {recording ? <Square size={17} /> : <Mic size={17} />}{" "}
          {recording
            ? "Detener grabación"
            : blob
              ? "Grabar de nuevo"
              : "Grabar mi voz"}
        </Button>
        <span>Máximo 2 minutos por toma</span>
      </div>
      <p className="small" role="status">
        {status}
      </p>
      {url && (
        <>
          <label>Escuchar mi toma antes de guardar</label>
          <audio aria-label="Mi grabación" controls src={url} />
          <div className="row">
            {!chosen && (
              <>
                <Button
                  variant="secondary"
                  disabled={action.busy}
                  onClick={() => blob && useTake(blob, true)}
                >
                  Transcribir esta toma
                </Button>
                <Button
                  variant="secondary"
                  disabled={action.busy}
                  onClick={() => blob && useTake(blob, false)}
                >
                  Usar sin transcripción
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              disabled={action.busy}
              onClick={() => action.run(clearTake)}
            >
              Descartar toma
            </Button>
          </div>
        </>
      )}
      {transcript && (
        <blockquote>
          <small>TRANSCRIPCIÓN AUTOMÁTICA</small>
          {transcript}
        </blockquote>
      )}
      {alternatives.map((r, i) => (
        <details key={i}>
          <summary>Otra lectura de la toma · {r.model}</summary>
          <blockquote>{r.text}</blockquote>
          <small>{r.revision}</small>
        </details>
      ))}
      <p className="small">
        Solo Guardar y revisar incorpora el intento al historial. Las tomas
        descartadas o abandonadas no conservan archivos de audio. El
        reconocimiento no mide la pronunciación.
      </p>
      <ErrorBox error={action.error} />
    </section>
  );
}
function AiReviewStatus({ attempt: a }: { attempt: Attempt }) {
  const labels = {
    not_requested: "Sin revisión de IA",
    pending: "Revisión de IA en curso",
    failed: "Revisión de IA no completada",
    reviewed: "Revisado por IA · comentario orientativo",
    unverified: "Comentario de IA anterior sin verificar",
  };
  return (
    <p className="small ai-status">
      <strong>{labels[a.ai_review_status ?? "not_requested"]}</strong>
      {a.result.score !== null && " · Corrección por clave revisada"}
    </p>
  );
}
function AiReviewHistory({ attempt: a }: { attempt: Attempt }) {
  return (
    <div>
      <AiReviewStatus attempt={a} />
      {a.ai_reviews?.map((review, i) => (
        <details className="ai-review" key={review.id}>
          <summary>
            Revisión {i + 1} · {fmt(review.created)} ·{" "}
            {review.status === "completed"
              ? review.unverified
                ? "Sin verificar"
                : "Disponible"
              : review.status === "failed"
                ? "Fallida"
                : "En curso"}
          </summary>
          {review.unverified && (
            <p className="small">
              Se conserva para trazabilidad. No permite concluir cómo
              pronunciaste.
            </p>
          )}
          {review.result.input_text && (
            <blockquote>
              Texto reconocido valorado: {review.result.input_text}
            </blockquote>
          )}
          {review.result.corrected && (
            <p lang="fr">{review.result.corrected}</p>
          )}
          {review.result.feedback && <p>{review.result.feedback}</p>}
          {review.result.next_action && <p>{review.result.next_action}</p>}
          {review.error && <p className="error">{review.error}</p>}
          <small>{review.result.source}</small>
        </details>
      ))}
    </div>
  );
}
function AdviceView({ attempt: a }: { attempt: Attempt }) {
  const advice = a.result.advice;
  if (!advice) return null;
  if (a.advice_unverified)
    return (
      <div className="error">
        <b>Comentario anterior sin transcripción verificada.</b>
        <p>
          No permite concluir cómo pronunciaste. Se conserva para rastrear lo
          que produjo el sistema.
        </p>
        <details>
          <summary>Ver comentario original sin validar</summary>
          <p>{advice.feedback}</p>
          <p>{advice.corrected}</p>
        </details>
      </div>
    );
  return (
    <div className="advice">
      <strong>
        {a.media_id
          ? "Comentario sobre el texto reconocido que confirmaste · sin evaluación acústica"
          : "Propuesta de corrección"}
      </strong>
      {a.media_id && advice.input_text && (
        <blockquote>Texto reconocido valorado: {advice.input_text}</blockquote>
      )}
      <p lang="fr">{advice.corrected}</p>
      <p>{advice.feedback}</p>
      {advice.equivalence_note && (
        <p className="small">{advice.equivalence_note}</p>
      )}
      <p>{advice.next_action}</p>
      <small>{advice.source}</small>
    </div>
  );
}
function SavedSpeechSnapshot({ attempt: a }: { attempt: Attempt }) {
  return (
    <section className="speech-review">
      <p className="small">
        Registro guardado de solo lectura. Las lecturas y revisiones siguientes
        son las que se conservaron con este intento.
      </p>
      {a.transcription_runs && a.transcription_runs.length > 0 && (
        <details>
          <summary>Lecturas guardadas · {a.transcription_runs.length}</summary>
          {a.transcription_runs.map((r) => (
            <div className="transcription-run" key={r.id}>
              <blockquote>{r.text || "Sin texto reconocido"}</blockquote>
              <small>
                {r.model} · {r.revision.slice(0, 10)} · {fmt(r.created)}
              </small>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
function AnalysisResultView({ result: r }: { result: AnalysisResult }) {
  return (
    <div className="advice">
      {r.recognition && (
        <>
          <h3>Reconocimiento con modelos actuales</h3>
          <blockquote>
            {r.recognition.text ||
              "No hay texto fiable; la señal necesita repetirse."}
          </blockquote>
          <small>
            {r.recognition.model} · {r.recognition.revision.slice(0, 10)}
          </small>
          {r.recognition.alternatives?.map((x, i) => (
            <details key={i}>
              <summary>Otra lectura · {x.model}</summary>
              <blockquote>{x.text}</blockquote>
              <small>{x.revision}</small>
            </details>
          ))}
        </>
      )}
      {r.advice && (
        <>
          <h3>Comentario orientativo del texto</h3>
          <p lang="fr">{r.advice.corrected}</p>
          <p>{r.advice.feedback}</p>
          {r.advice.equivalence_note && (
            <p className="small">{r.advice.equivalence_note}</p>
          )}
          <p>{r.advice.next_action}</p>
          <small>{r.advice.source}</small>
        </>
      )}
      {r.advice_error && (
        <div className="error" role="alert">
          <strong>No se pudo validar el comentario de IA</strong>
          <p>{r.advice_error}</p>
        </div>
      )}
      <p className="small">
        Este resultado no mide la pronunciación ni sustituye el registro
        original.
      </p>
    </div>
  );
}
function TemporaryComparison({ attempt: a }: { attempt: Attempt }) {
  const action = useAction();
  const [value, setValue] = useState<AnalysisResult | null>(null);
  return (
    <section className="temporary-comparison">
      <Button
        variant="secondary"
        disabled={action.busy}
        onClick={() =>
          action.run(async () => {
            const task = await api<{ analysis_id: string }>(
              "/analyses",
              "POST",
              { mode: "history", attempt_id: a.id },
            );
            const result = await waitAnalysis(task.analysis_id);
            setValue(result.result);
          })
        }
      >
        {action.busy
          ? "Comparando…"
          : "Evaluar con modelos actuales · temporal"}
      </Button>
      <p className="small">
        Solo para comparar en esta pantalla. No modifica ni añade resultados al
        historial.
      </p>
      {value && (
        <>
          <strong>Comparación temporal · no guardada</strong>
          <AnalysisResultView result={value} />
          <Button variant="ghost" onClick={() => setValue(null)}>
            Cerrar comparación
          </Button>
        </>
      )}
      <Link
        className="text-link"
        to={
          a.practice_url ||
          "/session/" + a.session_id + "?activity=" + a.activity_id
        }
      >
        Ir a la actividad y hacer un nuevo intento
        <ArrowRight size={15} />
      </Link>
      <ErrorBox error={action.error} />
    </section>
  );
}
type DraftReview = { id: string; result: AnalysisResult; identity: string };
type ActivityPanelProps = {
  exercise: Exercise;
  sessionId: string;
  onSaved: (attempt: Attempt) => void;
  quick?: boolean;
  onNext?: () => void | Promise<void>;
  formatControls?: ReactNode;
};
function ActivityPanel(props: ActivityPanelProps) {
  if (props.quick && props.exercise.source?.number_mode === "speak")
    return (
      <NumberSpeech
        {...props}
        renderReference={(help, play) => (
          <AudioReference
            exercise={props.exercise}
            quick
            onPlay={play}
            onHelp={help}
            onTranscript={help}
          />
        )}
      />
    );
  return <StandardActivityPanel {...props} />;
}

function StandardActivityPanel({
  exercise: e,
  sessionId,
  onSaved,
  quick = false,
  onNext,
  formatControls,
}: {
  exercise: Exercise;
  sessionId: string;
  onSaved: (attempt: Attempt) => void;
  quick?: boolean;
  onNext?: () => void | Promise<void>;
  formatControls?: ReactNode;
}) {
  const draftKey = "tuto:draft:" + sessionId + ":" + e.id;
  const initial = () => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) || "{}");
    } catch {
      return {};
    }
  };
  const [answer, setAnswer] = useState<string>(
    e.mode === "speak"
      ? (e.attempt?.transcription ?? e.attempt?.response ?? "")
      : (initial().answer ?? e.attempt?.response ?? ""),
  );
  const [media, setMedia] = useState<string>(
    e.mode === "speak"
      ? (e.attempt?.media_id ?? "")
      : (initial().media ?? e.attempt?.media_id ?? ""),
  );
  const [plays, setPlays] = useState<number>(initial().plays ?? 0);
  const [hint, setHint] = useState(initial().hint ?? false);
  const [handwritten, setHandwritten] = useState(
    initial().handwritten ?? false,
  );
  const [transcript, setTranscript] = useState(initial().transcript ?? "");
  const [result, setResult] = useState<Attempt | null>(e.attempt);
  const retrying = useRef(false);
  const action = useAction();
  const queryClient = useQueryClient();
  const reviewSettings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const [reviewPreference, setReviewPreference] = useState<boolean | null>(
    null,
  );
  const [advancePreference, setAdvancePreference] = useState<boolean | null>(
    null,
  );
  const continuousDictation =
    quick && e.mode === "exact" && e.source?.number_mode === "dictation";
  const continuousWriting =
    quick && e.mode === "exact" && e.source?.number_mode === "write";
  const continuousChoice = quick && e.mode === "choice";
  const nextItem = e.source?.continuous_topic
    ? "la siguiente expresión"
    : "el siguiente número";
  const automaticRounds =
    continuousChoice || continuousDictation || continuousWriting;
  const autoAdvance =
    advancePreference ??
    (continuousDictation
      ? reviewSettings.data?.auto_advance_dictation
      : continuousWriting
        ? reviewSettings.data?.auto_advance_writing
        : reviewSettings.data?.auto_advance_choices) ??
    true;
  const saving = useRef(false);
  const writtenNumberFormat =
    e.mode === "exact" &&
    e.source?.number_practice &&
    (e.source.answer_format === "digits" || e.source.answer_format === "words")
      ? e.source.answer_format
      : null;

  const autoReview =
    reviewPreference ?? reviewSettings.data?.auto_review ?? true;
  const canReview = e.mode === "open" || e.mode === "speak";
  const [savePhase, setSavePhase] = useState("");
  const elapsed = useRef<number>(initial().seconds ?? 0);
  const activeAt = useRef(Date.now());
  const idempotency = useRef(
    e.mode === "speak"
      ? crypto.randomUUID()
      : initial().id || crypto.randomUUID(),
  );
  const [transcriptMatches, setTranscriptMatches] = useState(false);
  const [recognitionNotice, setRecognitionNotice] = useState("");
  const [prepared, setPrepared] = useState<DraftReview | null>(null);
  const preparedRef = useRef<DraftReview | null>(null);
  const inFlightReview = useRef<{
    identity: string;
    promise: Promise<DraftReview>;
  } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<unknown>(null);
  const autoAttempted = useRef("");
  const draftIdentity = useRef("");
  draftIdentity.current = JSON.stringify([
    idempotency.current,
    answer,
    media,
    transcriptMatches,
    autoReview,
  ]);
  useEffect(() => {
    setPrepared(null);
    preparedRef.current = null;
    autoAttempted.current = "";
    setReviewError(null);
    setReviewBusy(false);
  }, [answer, media, transcriptMatches, autoReview]);
  const evaluateRef = useRef((): Promise<DraftReview> =>
    Promise.reject(new Error("Revisión no disponible")),
  );
  useEffect(() => {
    if (
      result ||
      !canReview ||
      !autoReview ||
      reviewSettings.isPending ||
      reviewSettings.isError ||
      !answer.trim() ||
      (e.mode === "speak" && (!media || !transcriptMatches))
    )
      return;
    const identity = draftIdentity.current;
    if (
      preparedRef.current?.identity === identity ||
      autoAttempted.current === identity
    )
      return;
    const timer = setTimeout(
      () => {
        autoAttempted.current = identity;
        void evaluateRef.current().catch(() => {});
      },
      e.mode === "speak" ? 0 : 1200,
    );
    return () => clearTimeout(timer);
  }, [
    answer,
    media,
    transcriptMatches,
    autoReview,
    result,
    canReview,
    e.mode,
    reviewSettings.isPending,
    reviewSettings.isError,
  ]);
  useEffect(() => {
    setTranscriptMatches(false);
  }, [media]);
  useEffect(() => {
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        answer,
        media,
        plays,
        hint,
        handwritten,
        transcript,
        id: idempotency.current,
        seconds: elapsed.current,
      }),
    );
  }, [answer, media, plays, hint, handwritten, transcript, draftKey]);
  useEffect(() => {
    if (e.attempt && !retrying.current) {
      setResult(e.attempt);
      if (e.mode === "speak")
        setAnswer(e.attempt.transcription ?? e.attempt.response);
    }
  }, [e.attempt]);
  useEffect(() => {
    const touch = () => {
      activeAt.current = Date.now();
    };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    const timer = setInterval(() => {
      if (
        !document.hidden &&
        Date.now() - activeAt.current < 120000 &&
        !result
      ) {
        elapsed.current += 1;
        try {
          const draft = JSON.parse(localStorage.getItem(draftKey) || "{}");
          localStorage.setItem(
            draftKey,
            JSON.stringify({ ...draft, seconds: elapsed.current }),
          );
        } catch {
          /* Keep the in-memory answer available. */
        }
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [draftKey, result]);
  useEffect(() => {
    if (e.mode === "speak" && media && !result) {
      void api<NonNullable<Attempt["transcription_runs"]>>(
        "/media/" + media + "/transcriptions",
      )
        .then((values) => {
          if (values[0]) setAnswer(values[0].text);
        })
        .catch(() => {});
    }
  }, [media, e.mode, result]);
  async function save(
    override?: string,
    advance = automaticRounds && autoAdvance,
  ) {
    if (
      saving.current ||
      action.busy ||
      result ||
      (automaticRounds && (reviewSettings.isPending || reviewSettings.isError))
    )
      return;
    saving.current = true;
    await action.run(async () => {
      let evaluation =
        preparedRef.current?.identity === draftIdentity.current
          ? preparedRef.current
          : null;
      if (canReview && autoReview && !evaluation) {
        if (!answer.trim() || (e.mode === "speak" && !transcriptMatches))
          throw new Error(
            "Para revisar con IA, confirma que la transcripción coincide con lo que dijiste. Si no hay una lectura fiable, desactiva la revisión automática para guardar solo la muestra.",
          );
        setSavePhase("Revisando con IA…");
        evaluation = await evaluateDraft();
      }
      setSavePhase("Guardando…");
      const value = await api<Attempt>("/attempts", "POST", {
        id: idempotency.current,
        session_id: sessionId,
        activity_id: e.id,
        response: override ?? answer,
        media_id: media || null,
        seconds: Math.min(14400, elapsed.current),
        plays,
        hint,
        transcript: !!transcript,
        handwritten,
        evaluation_id: evaluation?.id || null,
        transcript_matches: transcriptMatches,
      });
      retrying.current = false;
      setResult(value);
      localStorage.removeItem(draftKey);
      onSaved(value);
      if (advance) await onNext?.();
    });
    saving.current = false;
    setSavePhase("");
  }
  function evaluateDraft(force = false): Promise<DraftReview> {
    const identity = draftIdentity.current;
    if (inFlightReview.current?.identity === identity)
      return inFlightReview.current.promise;
    if (!force && preparedRef.current?.identity === identity)
      return Promise.resolve(preparedRef.current);
    preparedRef.current = null;
    setPrepared(null);
    setReviewBusy(true);
    setReviewError(null);
    const promise = (async () => {
      const task = await api<{ analysis_id: string }>("/analyses", "POST", {
        mode: "draft",
        draft_attempt_id: idempotency.current,
        session_id: sessionId,
        activity_id: e.id,
        response: answer,
        media_id: media || null,
        transcript_matches: transcriptMatches,
      });
      const value = await waitAnalysis(task.analysis_id);
      if (identity !== draftIdentity.current)
        throw new Error("La respuesta cambió. Se revisará el nuevo borrador.");
      const evaluation = {
        id: task.analysis_id,
        result: value.result,
        identity,
      };
      preparedRef.current = evaluation;
      setPrepared(evaluation);
      return evaluation;
    })()
      .catch((error) => {
        if (identity === draftIdentity.current) setReviewError(error);
        throw error;
      })
      .finally(() => {
        if (inFlightReview.current?.identity === identity) {
          inFlightReview.current = null;
          setReviewBusy(false);
        }
      });
    inFlightReview.current = { identity, promise };
    return promise;
  }
  evaluateRef.current = evaluateDraft;
  async function prepareEvaluation() {
    await action.run(async () => {
      await evaluateDraft(true);
    });
  }
  function retry() {
    retrying.current = true;
    setResult(null);
    setPrepared(null);
    preparedRef.current = null;
    setReviewError(null);
    setTranscriptMatches(false);
    setRecognitionNotice("");
    setAnswer("");
    setMedia("");
    setPlays(0);
    setHint(false);
    setTranscript("");
    idempotency.current = crypto.randomUUID();
    elapsed.current = 0;
    activeAt.current = Date.now();
  }
  const quickKey = useRef<(event: KeyboardEvent) => void>(() => {});
  quickKey.current = (event) => {
    if (
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      action.busy
    )
      return;
    if (event.key === "Enter") {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button,a,summary")
      )
        return;
      event.preventDefault();
      if (result) onNext?.();
      else if (answer.trim() || media) void save();
    } else if (
      e.mode === "speak" &&
      !result &&
      media &&
      answer &&
      event.code === "KeyC" &&
      !editingText(event.target)
    ) {
      event.preventDefault();
      if (event.target instanceof HTMLElement) event.target.blur();
      setTranscriptMatches((v) => !v);
    } else if (
      !result &&
      e.mode === "choice" &&
      /^[1-4]$/.test(event.key) &&
      !editingText(event.target)
    ) {
      const option = e.options[Number(event.key) - 1];
      if (option && !reviewSettings.isPending && !reviewSettings.isError) {
        event.preventDefault();
        if (event.target instanceof HTMLElement) event.target.blur();
        setAnswer(option);
        void save(option, autoAdvance);
      }
    }
  };
  useEffect(() => {
    if (!quick) return;
    const listener = (event: KeyboardEvent) => quickKey.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [quick]);
  return (
    <article className={"card exercise" + (quick ? " quick-practice" : "")}>
      <div className="exercise-meta">
        <span className="pill blue">{skillName[e.skill]}</span>
        <span>
          <Clock3 size={14} />
          {e.minutes} min sugeridos
        </span>
      </div>
      <h2>{e.title}</h2>
      {formatControls}
      {automaticRounds && (
        <div className="choice-advance-preference">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={autoAdvance}
              disabled={
                action.busy ||
                reviewSettings.isPending ||
                reviewSettings.isError
              }
              onChange={(event) => {
                const previous = autoAdvance;
                const value = event.target.checked;
                setAdvancePreference(value);
                void action.run(async () => {
                  try {
                    const settings = await api<Settings>(
                      continuousDictation
                        ? "/settings/dictation"
                        : continuousWriting
                          ? "/settings/writing"
                          : "/settings/practice",
                      "PATCH",
                      continuousDictation
                        ? { auto_advance_dictation: value }
                        : continuousWriting
                          ? { auto_advance_writing: value }
                          : { auto_advance_choices: value },
                    );
                    queryClient.setQueryData(["settings"], settings);
                    setAdvancePreference(null);
                  } catch (error) {
                    setAdvancePreference(previous);
                    throw error;
                  }
                });
              }}
            />
            {continuousDictation || continuousWriting
              ? "Avanzar automáticamente al comprobar"
              : "Avanzar automáticamente al elegir"}
          </label>
          <p className="small">
            {continuousDictation || continuousWriting
              ? autoAdvance
                ? `Un Enter o Comprobar guarda tu respuesta y abre ${nextItem}.`
                : "Enter o Comprobar guarda tu respuesta. Pulsa Siguiente número o Enter otra vez para continuar."
              : autoAdvance
                ? `Elegir con el ratón o con 1–4 guarda tu respuesta y abre ${nextItem}.`
                : "Elegir guarda tu respuesta. Pulsa Siguiente número o Enter para continuar."}{" "}
            {continuousDictation
              ? "Se recuerda para Escuchar y escribir."
              : continuousWriting
                ? "Se recuerda para Escribir."
                : "Se recuerda para las prácticas de selección."}
          </p>
          <ErrorBox error={reviewSettings.error} />
        </div>
      )}
      {!quick && (
        <p className="small">
          {e.attempt_count ?? 0} intentos guardados ·{" "}
          <AccuracyBadge value={e.accuracy} />{" "}
          <Link
            className="text-link"
            to={"/history?session=" + sessionId + "&activity=" + e.id}
          >
            Ver historial de esta actividad
          </Link>
        </p>
      )}
      <p className="instruction">{e.prompt}</p>
      {e.material && <div className="reading-material">{e.material}</div>}
      {(e.has_audio ?? !!e.reference) &&
        (!quick || e.skill === "listening") && (
          <AudioReference
            key={idempotency.current}
            exercise={e}
            quick={quick}
            autoPlay={quick && e.skill === "listening" && !result}
            onPlay={() => setPlays((v) => v + 1)}
            onTranscript={(t) => {
              setTranscript(t);
              setHint(true);
            }}
            onHelp={() => setHint(true)}
          />
        )}
      {quick && e.skill !== "listening" && (e.has_audio ?? !!e.reference) && (
        <details className="quick-help">
          <summary>Referencia y pronunciación (ayuda)</summary>
          <AudioReference
            exercise={e}
            quick
            onPlay={() => {
              setPlays((v) => v + 1);
              setHint(true);
            }}
            onTranscript={(t) => {
              setTranscript(t);
              setHint(true);
            }}
            onHelp={() => setHint(true)}
          />
        </details>
      )}
      {transcript && (
        <blockquote>
          <small>AYUDA CONSULTADA</small>
          {transcript}
        </blockquote>
      )}
      <fieldset
        className="activity-inputs"
        disabled={
          action.busy ||
          (automaticRounds &&
            (reviewSettings.isPending || reviewSettings.isError))
        }
      >
        {e.mode === "choice" ? (
          <div className="options">
            {e.options.map((o, i) => (
              <label className={answer === o ? "picked" : ""} key={o}>
                <input
                  type="radio"
                  name={e.id}
                  value={o}
                  checked={answer === o}
                  onChange={() => {
                    setAnswer(o);
                    if (quick) void save(o, autoAdvance);
                  }}
                  disabled={!!result}
                />
                <span className="option-letter">
                  {quick ? i + 1 : String.fromCharCode(65 + i)}
                </span>
                {o}
              </label>
            ))}
          </div>
        ) : e.mode === "speak" ? (
          <>
            {!result && (
              <Recorder
                quick={quick}
                onReady={(m, t, notice) => {
                  setMedia(m);
                  setAnswer(t);
                  setRecognitionNotice(notice || "");
                }}
              />
            )}
            <label htmlFor={"answer-" + e.id}>
              Transcripción automática · solo lectura
            </label>
            <textarea
              id={"answer-" + e.id}
              value={answer}
              readOnly
              placeholder={
                recognitionNotice ||
                "Aquí aparecerá exactamente lo que extrajo el reconocedor. No se modifica manualmente."
              }
            />
            {!result && recognitionNotice && (
              <p className="small" role="status">
                {recognitionNotice}
              </p>
            )}
          </>
        ) : (
          <>
            <label
              className={
                writtenNumberFormat ? "number-answer-label" : undefined
              }
              htmlFor={"answer-" + e.id}
            >
              {writtenNumberFormat === "digits"
                ? "Escribe en cifras (0–9)"
                : writtenNumberFormat === "words"
                  ? "Escribe en letras francesas"
                  : "Tu respuesta en francés"}
            </label>
            {writtenNumberFormat && (
              <p className="number-answer-note" id={"answer-format-" + e.id}>
                {writtenNumberFormat === "digits"
                  ? "Esta ronda pide solo dígitos del 0 al 9."
                  : "Esta ronda pide el nombre del número escrito con palabras en francés."}
                {e.skill === "listening" &&
                  " El audio siempre pronuncia el número en francés; responde en el formato indicado aquí."}
              </p>
            )}
            <textarea
              id={"answer-" + e.id}
              value={answer}
              disabled={!!result}
              onChange={(ev) => setAnswer(ev.target.value)}
              aria-describedby={
                writtenNumberFormat ? "answer-format-" + e.id : undefined
              }
              inputMode={writtenNumberFormat === "digits" ? "numeric" : "text"}
              placeholder={
                writtenNumberFormat === "digits"
                  ? "Solo cifras (0–9)"
                  : writtenNumberFormat === "words"
                    ? "El número escrito con palabras en francés"
                    : e.mode === "exact"
                      ? "Écris de mémoire…"
                      : "Escribe tu respuesta. Se conservará el original."
              }
              rows={quick ? 1 : e.mode === "open" ? 6 : 3}
              autoFocus={quick}
            />
          </>
        )}
        {e.mode === "exact" && !quick && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={handwritten}
              disabled={!!result}
              onChange={(ev) => setHandwritten(ev.target.checked)}
            />
            También la escribí a mano en mi cuaderno
          </label>
        )}
        {!result && e.mode === "speak" && media && answer && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={transcriptMatches}
              onChange={(ev) => setTranscriptMatches(ev.target.checked)}
            />
            {quick
              ? "Confirmar: la transcripción coincide con lo que dije · C"
              : "La transcripción coincide con lo que dije"}
          </label>
        )}
        {!result && canReview && (
          <section className="draft-evaluation">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={autoReview}
                disabled={reviewSettings.isPending || reviewSettings.isError}
                onChange={(ev) => {
                  const value = ev.target.checked;
                  const previous = autoReview;
                  setReviewPreference(value);
                  void action.run(async () => {
                    try {
                      await queryClient.cancelQueries({
                        queryKey: ["settings"],
                      });
                      const settings = await api<Settings>(
                        "/settings/review",
                        "PATCH",
                        { auto_review: value },
                      );
                      queryClient.setQueryData(["settings"], settings);
                      setReviewPreference(null);
                    } catch (error) {
                      setReviewPreference(previous);
                      throw error;
                    }
                  });
                }}
              />
              Revisión automática de IA
            </label>
            <p className="small">
              {e.mode === "speak"
                ? "Al confirmar la transcripción, la IA revisa automáticamente el borrador."
                : "La IA revisa automáticamente el borrador cuando haces una pausa al escribir."}{" "}
              Al guardar, el comentario se conserva junto al nuevo intento.
              Puedes desactivarlo; se recordará tu preferencia.
            </p>
            {e.mode === "speak" && autoReview && !transcriptMatches && (
              <p className="small">
                Confirma la transcripción para recibir un comentario sobre su
                contenido. Sin una lectura fiable, desactiva esta opción para
                guardar solo el audio. Esto no evalúa la pronunciación.
              </p>
            )}
            <Button
              variant="secondary"
              disabled={
                action.busy ||
                reviewBusy ||
                !answer.trim() ||
                (e.mode === "speak" && !transcriptMatches)
              }
              onClick={prepareEvaluation}
            >
              {prepared?.result.advice_error || reviewError
                ? "Reintentar revisión de IA"
                : prepared
                  ? "Revisar de nuevo"
                  : "Evaluar antes de guardar"}
            </Button>
            {reviewBusy && (
              <p className="small" role="status">
                Revisando con IA… Puedes guardar cuando quieras; se conservará
                esta misma revisión.
              </p>
            )}
            <ErrorBox error={action.error ? null : reviewError} />
            {prepared && (
              <>
                <AnalysisResultView result={prepared.result} />
                <Button
                  variant="ghost"
                  onClick={() => {
                    void action.run(async () => {
                      const settings = await api<Settings>(
                        "/settings/review",
                        "PATCH",
                        { auto_review: false },
                      );
                      queryClient.setQueryData(["settings"], settings);
                      setReviewPreference(null);
                      preparedRef.current = null;
                      setPrepared(null);
                    });
                  }}
                >
                  Guardar sin esta evaluación
                </Button>
              </>
            )}
          </section>
        )}
      </fieldset>
      {!result && canReview && <ErrorBox error={reviewSettings.error} />}
      <ErrorBox error={action.error} />
      {result && quick ? (
        <section
          className={
            "result quick-result " +
            (result.result.score === 0 ? "reinforce" : "")
          }
          role="status"
        >
          <h3>
            {result.result.format_mismatch
              ? "Número correcto · formato distinto"
              : result.result.score === 100
                ? "Correcto"
                : result.result.score === 0
                  ? "Vamos a reforzarlo"
                  : "Sin resultado evaluable"}
          </h3>
          <p>{result.result.feedback}</p>
          <details>
            <summary>Ver detalles de este intento</summary>
            <p className="small">{result.result.method}</p>
            <AiReviewStatus attempt={result} />
            <AdviceView attempt={result} />
            {result.media_id && (
              <audio
                controls
                aria-label="Grabación guardada"
                src={"/api/media/" + result.media_id}
              />
            )}
          </details>
          <Link className="text-link" to={"/history?session=" + sessionId}>
            Ver historial
          </Link>
        </section>
      ) : result ? (
        <div
          className={"result " + (result.result.score === 0 ? "reinforce" : "")}
          role="status"
        >
          <div className="row">
            <span className="result-icon">
              {result.result.score === null ? (
                <BookOpen size={20} />
              ) : result.result.score === 100 ? (
                <Check size={20} />
              ) : (
                <RefreshCw size={20} />
              )}
            </span>
            <h3>
              {result.result.score === null
                ? "Muestra guardada para revisar"
                : result.result.passed
                  ? "Respuesta correcta · 100%"
                  : "Vamos a reforzarla · 0%"}
            </h3>
          </div>
          <p>{result.result.feedback}</p>
          <AiReviewStatus attempt={result} />
          {result.result.accepted && (
            <p className="reference-answer">{result.result.accepted[0]}</p>
          )}
          <small>
            {result.result.method} · Meta de este intento:{" "}
            {result.result.target}/100. {result.result.meaning}
          </small>
          {result.result.criteria && (
            <p className="small">
              Criterios: {result.result.criteria.join(" · ")}
            </p>
          )}
          {result.media_id && !result.media_deleted && (
            <audio
              controls
              aria-label="Grabación guardada"
              src={"/api/media/" + result.media_id}
            />
          )}
          {result.media_id && <SavedSpeechSnapshot attempt={result} />}
          <div className="row">
            <Button variant="secondary" onClick={retry}>
              <RefreshCw size={15} />
              Nuevo intento
            </Button>
          </div>
          <AdviceView attempt={result} />
          <TemporaryComparison attempt={result} />
          {e.variation && (
            <p className="small">Siguiente paso: {e.variation}</p>
          )}
        </div>
      ) : (
        !quick && (
          <Button
            className={quick ? "quick-submit" : undefined}
            disabled={
              action.busy ||
              (!answer.trim() && !media) ||
              (canReview &&
                (reviewSettings.isPending || reviewSettings.isError))
            }
            onClick={() => void save()}
          >
            <Check size={17} />
            {action.busy
              ? savePhase || "Preparando…"
              : quick
                ? "Comprobar · Enter"
                : "Guardar y revisar"}
          </Button>
        )
      )}
      {quick && (
        <div className="quick-control-bar">
          <Button
            className="quick-submit"
            disabled={
              action.busy ||
              (!result &&
                ((!answer.trim() && !media) ||
                  (canReview &&
                    (reviewSettings.isPending || reviewSettings.isError))))
            }
            onClick={() => {
              if (result) onNext?.();
              else void save();
            }}
          >
            {action.busy
              ? savePhase || "Preparando…"
              : result
                ? e.source?.continuous_topic
                  ? "Siguiente expresión · Enter"
                  : "Siguiente número · Enter"
                : "Comprobar · Enter"}
            <ArrowRight size={16} />
          </Button>
        </div>
      )}
      <div className="exercise-provenance">
        <small>{e.origin}</small>
        {e.source?.unit !== undefined && (
          <a
            href={"/api/pdfs/" + e.source.unit}
            target="_blank"
            rel="noreferrer"
          >
            Consultar PDF U{e.source.unit} · p. impresa {e.source.printed_page},
            PDF {e.source.pdf_page}
          </a>
        )}
      </div>
    </article>
  );
}
function Practice() {
  const practiceCache = useQueryClient();
  const navigate = useNavigate();
  const action = useAction();
  const location = useLocation();
  const numberParams = new URLSearchParams(location.search);
  const [continuousProposalId, setContinuousProposalId] = useState<
    string | null
  >(null);
  const [continuous, setContinuous] = useState(
    numberParams.get("mode") === "continuous",
  );
  const [topic, setTopic] = useState("");
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [removedProposalId, setRemovedProposalId] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState("");
  const [prefs, setPrefs] = useState<Prefs>({
    minutes: 15,
    modalities: ["reading", "listening", "writing", "speaking"],
    level: "A1",
    minimum: 1,
    maximum: 100,
    selection: "mixed",
    time_mode: "daily",
  });
  useEffect(() => {
    const saved = localStorage.getItem("tuto:proposal");
    if (saved)
      void api<Proposal>("/proposals/" + saved)
        .then((p) => {
          setProposal(p);
          setTopic(p.topic);
          setPrefs(p.preferences);
        })
        .catch(() => {});
  }, []);
  async function reviewProposal(id: string) {
    await action.run(async () => {
      const p = await api<Proposal>("/proposals/" + id);
      setProposal(p);
      setTopic(p.topic);
      setPrefs(p.preferences);
      setInstruction("");
      setStatus("");
      localStorage.setItem("tuto:proposal", p.id);
      document
        .getElementById("fixed-practice-builder")
        ?.scrollIntoView({ behavior: "smooth" });
    });
  }
  async function generate() {
    await action.run(async () => {
      setStatus("Preparando tu propuesta con recursos locales…");
      const r = await api<{ job_id: string }>("/proposals", "POST", {
        topic,
        parent_id: proposal?.id || null,
        instruction,
        preferences: prefs,
      });
      localStorage.setItem("tuto:proposal-job", r.job_id);
      const j = await waitJob(r.job_id);
      const p = await api<Proposal>("/proposals/" + j.result.proposal_id);
      setProposal(p);
      setPrefs(p.preferences);
      localStorage.setItem("tuto:proposal", p.id);
      localStorage.removeItem("tuto:proposal-job");
      void practiceCache.invalidateQueries({
        queryKey: ["practice-history", "fixed"],
      });
      setInstruction("");
      setStatus("");
    });
  }
  useEffect(() => {
    const job = localStorage.getItem("tuto:proposal-job");
    if (job)
      void action.run(async () => {
        setStatus("Retomando la propuesta en preparación…");
        const j = await waitJob(job);
        const p = await api<Proposal>("/proposals/" + j.result.proposal_id);
        setProposal(p);
        setTopic(p.topic);
        setPrefs(p.preferences);
        localStorage.setItem("tuto:proposal", p.id);
        localStorage.removeItem("tuto:proposal-job");
        void practiceCache.invalidateQueries({
          queryKey: ["practice-history", "fixed"],
        });
        setStatus("");
      });
  }, []);
  function preset(label: string, min = 1, max = 100) {
    setTopic(label);
    setProposal(null);
    setPrefs((p) => ({ ...p, minimum: min, maximum: max }));
    localStorage.removeItem("tuto:proposal");
  }
  return (
    <>
      <PageTitle
        eyebrow="À TOI DE CHOISIR"
        title="¿Qué quieres practicar?"
        description="Escribe una situación, revisa la propuesta y ajústala antes de comenzar."
      />
      <div
        className="practice-mode-switch"
        role="group"
        aria-label="Modalidad de práctica"
      >
        <Button
          variant={continuous ? "secondary" : "default"}
          onClick={() => setContinuous(false)}
        >
          Sesiones fijas
        </Button>
        <Button
          variant={continuous ? "default" : "secondary"}
          onClick={() => setContinuous(true)}
        >
          Práctica continua
        </Button>
      </div>
      <PracticeHistory
        key={continuous ? "continuous" : "fixed"}
        kind={continuous ? "continuous" : "fixed"}
        onReview={
          continuous
            ? (id) => setContinuousProposalId(id)
            : (id) => void reviewProposal(id)
        }
        busy={action.busy}
        onRemoved={(id) => {
          setRemovedProposalId(id);
          setProposal((p) => (p?.id === id ? null : p));
          setContinuousProposalId((current) =>
            current === id ? null : current,
          );
        }}
      />
      {continuous ? (
        <ContinuousTopicBuilder
          reviewId={continuousProposalId}
          removedId={removedProposalId}
          numeric={numberParams.has("min") || numberParams.has("max")}
          minimum={Number(numberParams.get("min")) || 1}
          maximum={Number(numberParams.get("max")) || 10}
        />
      ) : (
        <div className="practice-layout" id="fixed-practice-builder">
          <section className="card">
            <label htmlFor="topic">Tu tema o situación</label>
            <textarea
              id="topic"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                const nums = e.target.value.match(/\d+/g);
                if (
                  /númer|numer|number/i.test(e.target.value) &&
                  nums &&
                  nums.length >= 2
                )
                  setPrefs((p) => ({
                    ...p,
                    minimum: +nums[0],
                    maximum: +nums[1],
                  }));
              }}
              placeholder="Quiero aprender a pedir comida en un restaurante…"
            />
            <div className="chips">
              {[
                "Números 1–100",
                "Números 100–500",
                "Expresiones del aula",
                "Pedir un café",
                "Hablar de mi familia",
              ].map((l, i) => (
                <button
                  key={l}
                  onClick={() =>
                    preset(l, i === 1 ? 100 : 1, i === 1 ? 500 : 100)
                  }
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="form-grid">
              <label>
                Duración
                <select
                  value={prefs.minutes}
                  onChange={(e) =>
                    setPrefs({ ...prefs, minutes: +e.target.value })
                  }
                >
                  {[5, 10, 15, 20, 30, 60, 120].map((n) => (
                    <option key={n} value={n}>
                      {n} minutos
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nivel
                <select
                  value={prefs.level}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      level: e.target.value as Prefs["level"],
                    })
                  }
                >
                  {["A0", "A1", "A2"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            {/númer|numer|number/i.test(topic) && (
              <>
                <div className="form-grid">
                  <label>
                    Desde (incluido)
                    <input
                      aria-label="Desde"
                      type="number"
                      min="1"
                      max="500"
                      value={prefs.minimum}
                      onChange={(e) =>
                        setPrefs({ ...prefs, minimum: +e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Hasta (incluido)
                    <input
                      aria-label="Hasta"
                      type="number"
                      min="1"
                      max="500"
                      value={prefs.maximum}
                      onChange={(e) =>
                        setPrefs({ ...prefs, maximum: +e.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  Selección
                  <select
                    value={prefs.selection}
                    onChange={(e) =>
                      setPrefs({
                        ...prefs,
                        selection: e.target.value as Prefs["selection"],
                      })
                    }
                  >
                    <option value="mixed">Mezclar nuevos y repasos</option>
                    <option value="new">Priorizar nuevos</option>
                    <option value="difficult">Priorizar dificultades</option>
                  </select>
                </label>
              </>
            )}
            <label>
              Cómo contar esta práctica
              <select
                value={prefs.time_mode || "daily"}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    time_mode: e.target.value as Prefs["time_mode"],
                  })
                }
              >
                <option value="daily">
                  Dentro de mis dos horas personales
                </option>
                <option value="extra">Como práctica adicional</option>
              </select>
            </label>
            <fieldset>
              <legend>Destrezas</legend>
              <div className="chips">
                {(Object.keys(skillName) as Skill[]).map((s) => (
                  <label className="checkbox" key={s}>
                    <input
                      type="checkbox"
                      checked={prefs.modalities.includes(s)}
                      onChange={(e) =>
                        setPrefs({
                          ...prefs,
                          modalities: e.target.checked
                            ? [...prefs.modalities, s]
                            : prefs.modalities.filter((x) => x !== s),
                        })
                      }
                    />
                    {skillName[s]}
                  </label>
                ))}
              </div>
            </fieldset>
            {proposal && (
              <>
                <label htmlFor="changes">Pide un cambio</label>
                <textarea
                  id="changes"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Más escucha, solo 15 minutos, más fácil o situaciones de trabajo…"
                  rows={3}
                />
              </>
            )}
            <Button
              disabled={
                action.busy || topic.length < 2 || !prefs.modalities.length
              }
              onClick={generate}
            >
              <Sparkles size={17} />
              {action.busy
                ? "Preparando…"
                : proposal
                  ? "Aplicar cambios / generar nuevamente"
                  : "Preparar propuesta"}
            </Button>
            <p className="small" role="status">
              {status}
            </p>
            <ErrorBox error={action.error} />
          </section>
          {proposal ? (
            <section className="card proposal">
              <span className="eyebrow">REVISA ANTES DE COMENZAR</span>
              <h2>{proposal.title}</h2>
              <p>{proposal.objective}</p>
              <div className="chips">
                <span className="pill">{proposal.level}</span>
                <span className="pill">{proposal.minutes} min</span>
                {proposal.preferences.modalities.map((s) => (
                  <span className="pill" key={s}>
                    {skillName[s]}
                  </span>
                ))}
              </div>
              <p>{proposal.tip}</p>
              <h3>Una muestra del contenido</h3>
              {proposal.examples.map((e) => (
                <blockquote key={e.french}>
                  <strong lang="fr">{e.french}</strong>
                  <small>{e.spanish}</small>
                </blockquote>
              ))}
              <h3>Tu práctica incluye</h3>
              <ul>
                {proposal.activities.map((a, i) => (
                  <li key={i}>
                    {skillName[a.skill]} · {a.prompt}
                  </li>
                ))}
              </ul>
              <p className="small">
                {proposal.origin}. Puedes ajustar esta propuesta las veces que
                necesites. Puedes retomarla desde la lista de prácticas
                anteriores; los intentos se guardan cuando respondes.
              </p>
              <Button
                disabled={action.busy}
                onClick={() =>
                  action.run(async () => {
                    const s = await api<StudySession>(
                      "/proposals/" + proposal.id + "/start",
                      "POST",
                    );
                    navigate("/session/" + s.id);
                  })
                }
              >
                {proposal.session_id
                  ? "Continuar esta sesión"
                  : "Comenzar esta versión"}
                <ArrowRight size={17} />
              </Button>
            </section>
          ) : (
            <section className="practice-empty">
              <div className="illustration">
                <span>bonjour</span>
                <span>c’est combien ?</span>
                <span>à bientôt !</span>
              </div>
              <h2>Una práctica hecha para tu día.</h2>
              <p>
                Desde los números hasta una conversación en el trabajo. Elige el
                tema; tu progreso se sumará al mismo historial.
              </p>
            </section>
          )}
        </div>
      )}
    </>
  );
}
function Classes() {
  const cfg = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const initialized = useRef(false);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["classes"],
    queryFn: () => api<ClassItem[]>("/classes"),
  });
  const navigate = useNavigate();
  const a = useAction();
  const [c, setC] = useState<ClassItem>({
    date: new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Vancouver",
    }),
    unit: 0,
    pages: "",
    announcement: "",
    agenda: "Estimada",
    preparation: "Pendiente",
    difficulty: "",
    minutes: 0,
  });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (cfg.data && !initialized.current) {
      initialized.current = true;
      setC((x) => ({ ...x, unit: cfg.data!.academy_unit }));
    }
  }, [cfg.data]);
  async function save(prepare = false) {
    await a.run(async () => {
      await api("/classes", "PUT", c);
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ["classes"] });
      if (prepare) {
        if (c.pages.trim() || c.announcement.trim()) {
          const r = await api<{ session_id?: string; job_id?: string }>(
            "/classes/" + c.date + "/tailor",
            "POST",
          );
          const sessionId =
            r.session_id ||
            String((await waitJob(r.job_id!)).result.session_id);
          navigate("/session/" + sessionId);
        } else {
          const s = await api<StudySession>(
            "/classes/" + c.date + "/prepare",
            "POST",
          );
          navigate("/session/" + s.id);
        }
      }
    });
  }
  return (
    <>
      <PageTitle
        eyebrow="PRÉPARER · PARTICIPER · CONSOLIDER"
        title="Mis clases"
        description="La agenda de la academia acompaña tu programa personal. Puedes actualizarla en cualquier momento."
      />
      <div className="practice-layout" id="fixed-practice-builder">
        <section className="card">
          <div className="form-grid">
            <label>
              Fecha
              <input
                type="date"
                value={c.date}
                onChange={(e) => setC({ ...c, date: e.target.value })}
              />
            </label>
            <label>
              Unidad Édito A1
              <select
                value={c.unit}
                onChange={(e) => setC({ ...c, unit: +e.target.value })}
              >
                {Array.from({ length: 11 }, (_, i) => (
                  <option key={i} value={i}>
                    Unidad {i}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Páginas anunciadas
            <input
              value={c.pages}
              onChange={(e) => setC({ ...c, pages: e.target.value })}
              placeholder="Por ejemplo: 17–20"
            />
          </label>
          <label>
            Anuncio del profesor
            <textarea
              value={c.announcement}
              onChange={(e) => setC({ ...c, announcement: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label>
              Agenda
              <select
                value={c.agenda}
                onChange={(e) =>
                  setC({ ...c, agenda: e.target.value as ClassItem["agenda"] })
                }
              >
                {["Estimada", "Confirmada", "Vista en clase"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Preparación
              <select
                value={c.preparation}
                onChange={(e) =>
                  setC({
                    ...c,
                    preparation: e.target.value as ClassItem["preparation"],
                  })
                }
              >
                {["Pendiente", "Preparada", "Necesita refuerzo"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            ¿Qué te resultó difícil?
            <textarea
              value={c.difficulty}
              onChange={(e) => setC({ ...c, difficulty: e.target.value })}
              rows={2}
            />
          </label>
          <label>
            Minutos reales de academia
            <input
              type="number"
              min="0"
              max="240"
              value={c.minutes}
              onChange={(e) => setC({ ...c, minutes: +e.target.value })}
            />
          </label>
          <div className="row">
            <Button disabled={a.busy} onClick={() => save(true)}>
              {a.busy ? "Preparando con tus materiales…" : "Guardar y preparar"}
              <ArrowRight size={16} />
            </Button>
            <Button
              variant="secondary"
              disabled={a.busy}
              onClick={() => save()}
            >
              Guardar agenda
            </Button>
          </div>
          {saved && (
            <p role="status" className="success-text">
              Agenda guardada.
            </p>
          )}
          <ErrorBox error={a.error} />
        </section>
        <section>
          <div className="card">
            <h3>Un pequeño ensayo antes de clase</h3>
            <p>
              25 minutos para anticipar vocabulario y preguntas. Después, 15
              minutos para recuperar lo aprendido y detectar qué reforzar.
            </p>
            <p className="small">
              Los PDF disponibles son de A1. Las actividades de la app son
              originales, alineadas con sus unidades. Sin anuncio, la
              preparación se muestra como estimada.
            </p>
            <a
              href={"/api/pdfs/" + c.unit}
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              Abrir PDF de la unidad {c.unit}
              <BookOpen size={16} />
            </a>
          </div>
          {q.data?.map((x) => (
            <button
              className="card class-history"
              key={x.id}
              onClick={() => {
                setC(x);
                setSaved(false);
              }}
            >
              <span>
                {x.date} · U{x.unit}
              </span>
              <strong>{x.agenda}</strong>
              <small>
                Preparación: {x.preparation} · {x.minutes} min de clase
              </small>
            </button>
          ))}
        </section>
      </div>
    </>
  );
}
function Reviews() {
  const q = useQuery({
    queryKey: ["memory"],
    queryFn: () => api<MemoryItem[]>("/memory"),
  });
  const a = useAction();
  const navigate = useNavigate();
  const due = q.data?.filter((x) => new Date(x.due) <= new Date()) || [];
  return (
    <>
      <PageTitle
        eyebrow="RETROUVER, PUIS RETENIR"
        title="Frases y repasos"
        description="Cada elemento comparte historial entre programa, clases y temas. La memoria se comprueba con el tiempo."
      >
        <Button
          disabled={!due.length || a.busy}
          onClick={() =>
            a.run(async () => {
              const s = await api<StudySession>("/reviews/start", "POST");
              navigate("/session/" + s.id);
            })
          }
        >
          Repasar {due.length} pendientes
          <RefreshCw size={16} />
        </Button>
      </PageTitle>
      <ErrorBox error={q.error || a.error} />
      <section className="card">
        <p>
          FSRS ajusta cada próximo repaso: error → volver antes; acierto con
          ayudas → práctica asistida; acierto autónomo → ampliar intervalo. La
          meta 70–90 es independiente del calendario de memoria.
        </p>
      </section>
      <div className="memory-grid">
        {q.data?.map((m) => (
          <section className="card" key={m.id}>
            <span className="pill">{skillName[m.skill]}</span>
            <h3 lang="fr">{m.label}</h3>
            <p>
              {m.evidence.learned ? "Retención comprobada" : "En aprendizaje"} ·{" "}
              {m.evidence.attempts} intentos · {m.evidence.errors} errores
            </p>
            <small>Próximo repaso: {fmt(m.due)}</small>
            <Link
              className="text-link"
              to={"/history#" + m.evidence.last_attempt}
            >
              Ver evidencia
              <ArrowRight size={15} />
            </Link>
          </section>
        ))}
      </div>
      {!q.data?.length && (
        <div className="card empty">
          <h3>Tu memoria empieza en la práctica.</h3>
          <p>Responde una actividad para crear tu primer repaso.</p>
          <Link to="/">Comenzar</Link>
        </div>
      )}
    </>
  );
}
function History() {
  const recordings = useQuery({
    queryKey: ["recordings"],
    queryFn: () =>
      api<
        {
          id: string;
          created: string;
          linked: boolean;
          info: { deleted?: boolean; no_speech?: boolean; text?: string };
        }[]
      >("/recordings"),
  });
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const sessionFilter = search.get("session") || "";
  const activityFilter = search.get("activity") || "";
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("all");
  const params = new URLSearchParams({
    offset: String(offset),
    limit: "50",
    skill: filter,
  });
  if (sessionFilter) params.set("session_id", sessionFilter);
  if (activityFilter) params.set("activity_id", activityFilter);
  const q = useQuery({
    queryKey: ["history", sessionFilter, activityFilter, filter, offset],
    queryFn: () =>
      api<{ total: number; items: Attempt[] }>("/attempt-history?" + params),
  });
  const a = useAction();
  const qc = useQueryClient();
  return (
    <>
      <PageTitle
        eyebrow="CHAQUE ESSAI COMPTE"
        title="Mi historial"
        description="Tus respuestas originales, correcciones y grabaciones se conservan juntas."
      />
      <ErrorBox error={q.error || a.error} />
      <p className="small">
        {q.data?.total ?? 0} intentos guardados
        {activityFilter
          ? " en esta actividad"
          : sessionFilter
            ? " en esta sesión"
            : ""}
        . Las tomas descartadas no cuentan.
      </p>
      {(sessionFilter || activityFilter) && (
        <Link className="text-link" to="/history">
          Ver todo mi historial
        </Link>
      )}
      {recordings.data
        ?.filter((r) => !r.linked && !r.info.deleted)
        .map((r) => (
          <section className="card" key={r.id}>
            <h3>
              {r.info.no_speech
                ? "Toma sin voz detectada"
                : "Grabación pendiente de asociar a un intento"}
            </h3>
            <small>{fmt(r.created)}</small>
            <p>
              {r.info.no_speech
                ? "Se conservó el motivo de repetición. Puedes eliminar esta toma."
                : r.info.text || "Revisa esta toma antes de volver a grabar."}
            </p>
            <audio controls src={"/api/media/" + r.id} />
            <Button
              variant="ghost"
              onClick={() =>
                a.run(async () => {
                  await api("/media/" + r.id, "DELETE");
                  void qc.invalidateQueries();
                })
              }
            >
              Descartar borrador
            </Button>
          </section>
        ))}
      <div className="chips">
        <button
          onClick={() => {
            setFilter("all");
            setOffset(0);
          }}
          className={filter === "all" ? "active" : ""}
        >
          Todos los intentos
        </button>
        {(Object.keys(skillName) as Skill[]).map((s) => (
          <button
            key={s}
            onClick={() => {
              setFilter(s);
              setOffset(0);
            }}
            className={filter === s ? "active" : ""}
          >
            {skillName[s]}
          </button>
        ))}
      </div>
      {q.data?.items.map((x) => (
        <article className="card history-entry" id={x.id} key={x.id}>
          <div className="row between">
            <span className="pill">{skillName[x.skill!]}</span>
            <small>{fmt(x.created)}</small>
          </div>
          <h3>{x.title}</h3>
          <blockquote>
            {x.media_id
              ? (x.transcription ?? x.response)
              : x.response || "Grabación oral sin texto"}
          </blockquote>
          {x.legacy_response_differs && (
            <details>
              <summary>
                Texto enviado en la versión anterior (distinto al
                reconocimiento)
              </summary>
              <p>{x.response}</p>
            </details>
          )}
          <p>{x.result.feedback}</p>
          {x.result.score !== null && (
            <p>
              {x.result.score}% · Meta histórica {x.result.target} ·{" "}
              {x.result.method}
            </p>
          )}
          <small>
            {x.evidence.plays} reproducciones ·{" "}
            {x.evidence.hint ? "Con ayuda" : "Sin pistas"} ·{" "}
            {x.evidence.seconds} segundos
          </small>
          <AiReviewHistory attempt={x} />
          {x.media_id && <SavedSpeechSnapshot attempt={x} />}
          {x.media_deleted && (
            <p className="small">
              Grabación eliminada. El texto y las correcciones se conservan.
            </p>
          )}
          {x.media_id && !x.media_deleted && (
            <>
              <audio
                controls
                aria-label="Grabación del historial"
                src={"/api/media/" + x.media_id}
              />
            </>
          )}
          <div className="row">
            <Link
              className="text-link"
              to={x.practice_url || "/session/" + x.session_id}
            >
              Abrir sesión
              <ArrowRight size={14} />
            </Link>
          </div>
          {x.annotations?.map((n, i) => (
            <p className="annotation" key={i}>
              <b>{n.origin}:</b> {n.text}
            </p>
          ))}
          <TemporaryComparison attempt={x} />
        </article>
      ))}
      {q.data?.total === 0 && (
        <section className="card empty">
          <h3>Todavía no hay intentos.</h3>
          <p>Tu primera respuesta aparecerá aquí automáticamente.</p>
        </section>
      )}
      {q.data && q.data.total > 50 && (
        <div className="activity-nav">
          <Button
            variant="secondary"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Anteriores
          </Button>
          <span>
            {offset + 1}–{Math.min(offset + 50, q.data.total)} de {q.data.total}
          </span>
          <Button
            variant="secondary"
            disabled={offset + 50 >= q.data.total}
            onClick={() => setOffset(offset + 50)}
          >
            Siguientes
          </Button>
        </div>
      )}
    </>
  );
}
interface ProgressData {
  skills: Record<
    Skill,
    { attempts: number; correct: number; evaluable: number; seconds: number }
  >;
  practiced: number;
  learned: number;
  numbers: number;
  expressions: number;
  priorities: {
    label: string;
    skill: Skill;
    errors: number;
    attempt_id: string;
  }[];
  samples: { initial: Attempt[]; week4: Attempt[] };
  total_seconds: number;
  retention_note: string;
}
function Progress() {
  const q = useQuery({
    queryKey: ["progress"],
    queryFn: () => api<ProgressData>("/progress"),
  });
  if (!q.data)
    return (
      <>
        <ErrorBox error={q.error} />
        <Loading />
      </>
    );
  const p = q.data;
  return (
    <>
      <PageTitle
        eyebrow="DES PREUVES, PAS DES IMPRESSIONS"
        title="Mi progreso"
        description="Mira qué puedes hacer, dónde necesitas apoyo y qué logras recordar después."
      />
      <div className="metric-grid">
        {[
          [Math.round(p.total_seconds / 60), "Minutos personales reales"],
          [p.practiced, "Elementos practicados"],
          [p.learned, "Retención comprobada"],
          [p.numbers, "Números aprendidos"],
        ].map(([n, l]) => (
          <section className="card metric" key={l}>
            <span>{l}</span>
            <b>{n}</b>
          </section>
        ))}
      </div>
      <div className="section-heading">
        <h2>Las cuatro destrezas</h2>
        <span className="small">
          Resultados de práctica · sin equivalencia directa a NCLC
        </span>
      </div>
      <div className="skill-grid">
        {(Object.keys(skillName) as Skill[]).map((s) => {
          const d = p.skills[s];
          return (
            <section className="card" key={s}>
              <span className="eyebrow">{skillName[s]}</span>
              <h3>
                {d.evaluable
                  ? Math.round((100 * d.correct) / d.evaluable) +
                    "% de aciertos"
                  : d.attempts
                    ? "Muestras conservadas"
                    : "Por comenzar"}
              </h3>
              <div className="progress-track">
                <i
                  style={{
                    width: d.evaluable
                      ? (100 * d.correct) / d.evaluable + "%"
                      : "0%",
                  }}
                />
              </div>
              <p>
                {d.attempts} intentos · {Math.round(d.seconds / 60)} min
              </p>
              <small>
                {d.evaluable
                  ? "Preguntas cerradas: aciertos / total."
                  : "La producción abierta requiere revisar la rúbrica."}
              </small>
            </section>
          );
        })}
      </div>
      <div className="bottom-grid">
        <section className="card">
          <h3>Dos prioridades para esta semana</h3>
          {p.priorities.length ? (
            p.priorities.map((x) => (
              <div className="priority" key={x.attempt_id}>
                <b>{x.label}</b>
                <p>
                  {skillName[x.skill]} · {x.errors} errores registrados
                </p>
                <Link className="text-link" to={"/history#" + x.attempt_id}>
                  Abrir intento
                  <ArrowRight size={15} />
                </Link>
              </div>
            ))
          ) : (
            <p>
              Las dificultades aparecerán a partir de tus respuestas. Elige una
              práctica nueva para comprobar transferencia.
            </p>
          )}
        </section>
        <section className="card">
          <h3>De la muestra inicial a la semana 4</h3>
          <p>
            {p.samples.initial.length} intentos iniciales ·{" "}
            {p.samples.week4.length} intentos del control de semana 4.
          </p>
          <p>
            Compara cumplimiento, claridad, vocabulario y autonomía. Conserva
            correcciones del tutor en el historial.
          </p>
          <Link className="text-link" to="/history">
            Comparar mis muestras
            <ArrowRight size={15} />
          </Link>
        </section>
      </div>
      <section className="card">
        <h3>¿Qué significa «aprendido»?</h3>
        <p>{p.retention_note}</p>
        <p>
          Has retenido {p.expressions} expresiones y {p.numbers} números.
          Seleccionar un rango no suma automáticamente palabras conocidas.
        </p>
      </section>
      <section className="card">
        <h3>Evaluaciones de la primera versión</h3>
        <p>
          Muestra inicial: día 1. Controles semanales: días 6, 13 y 20. Control
          amplio con situación nueva: día 27. Las cuatro destrezas se conservan
          para comparación.
        </p>
        <Link className="text-link" to="/course">
          Abrir mis evaluaciones
          <ArrowRight size={15} />
        </Link>
      </section>
    </>
  );
}
function SettingsPage() {
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () =>
      api<{
        version: string;
        postgres: string;
        ollama: boolean;
        audio: boolean;
        ffmpeg: boolean;
      }>("/health"),
  });
  const qc = useQueryClient();
  const a = useAction();
  const [s, setS] = useState<Settings>();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (q.data) setS(q.data);
  }, [q.data]);
  async function exportData() {
    await a.run(async () => {
      const r = await fetch("/api/export", { method: "POST" });
      if (!r.ok)
        throw new Error(
          "No se pudo exportar. Revisa la conexión con PostgreSQL.",
        );
      const url = URL.createObjectURL(await r.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "tuto-export.tar.gz";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  }
  return (
    <>
      <PageTitle
        eyebrow="À TON RYTHME"
        title="Configuración"
        description="Ajusta el calendario y la meta sin cambiar los resultados de tus intentos anteriores."
      />
      <div className="practice-layout" id="fixed-practice-builder">
        <section className="card">
          {s && (
            <>
              <label>
                Fecha de inicio del programa
                <input
                  type="date"
                  value={s.start_date}
                  onChange={(e) => setS({ ...s, start_date: e.target.value })}
                />
              </label>
              <label>
                Zona horaria
                <input
                  value={s.timezone}
                  onChange={(e) => setS({ ...s, timezone: e.target.value })}
                />
              </label>
              <label>
                Meta personal: {s.target}%
                <input
                  type="range"
                  min="70"
                  max="90"
                  step="1"
                  value={s.target}
                  onChange={(e) => setS({ ...s, target: +e.target.value })}
                />
              </label>
              <p className="small">
                Porcentaje de aciertos en ejercicios cerrados. La pronunciación
                acústica sigue pendiente de validación.
              </p>
              <label>
                Unidad actual de academia
                <select
                  value={s.academy_unit}
                  onChange={(e) =>
                    setS({ ...s, academy_unit: +e.target.value })
                  }
                >
                  {Array.from({ length: 11 }, (_, i) => (
                    <option key={i} value={i}>
                      Unidad {i}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Minutos personales diarios
                <input
                  type="number"
                  min="15"
                  max="240"
                  value={s.daily_minutes}
                  onChange={(e) =>
                    setS({ ...s, daily_minutes: +e.target.value })
                  }
                />
              </label>
              <Button
                disabled={a.busy}
                onClick={() =>
                  a.run(async () => {
                    await api("/settings", "PUT", s);
                    setSaved(true);
                    void qc.invalidateQueries();
                  })
                }
              >
                Guardar configuración
                <Check size={16} />
              </Button>
              {saved && (
                <p role="status" className="success-text">
                  Configuración guardada.
                </p>
              )}
            </>
          )}
          <ErrorBox error={a.error || q.error} />
        </section>
        <section>
          <div className="card">
            <h3>Todo funciona en tu Mac</h3>
            <ul className="service-list">
              <li>
                PostgreSQL{" "}
                <span className="pill">
                  {health.data?.postgres || "Comprobando…"}
                </span>
              </li>
              <li>
                Ollama · Qwen3:8b{" "}
                <span>
                  {health.data?.ollama ? "Disponible" : "Revisar Ollama"}
                </span>
              </li>
              <li>
                Kokoro · Whisper y Qwen3-ASR{" "}
                <span>
                  {health.data?.audio ? "Instalados" : "Revisar modelos"}
                </span>
              </li>
              <li>
                Conversión de grabaciones{" "}
                <span>
                  {health.data?.ffmpeg ? "Disponible" : "Falta FFmpeg"}
                </span>
              </li>
            </ul>
          </div>
          <div className="card">
            <h3>Tu historial te pertenece.</h3>
            <p>
              Exporta la base de datos, los audios y las grabaciones con sus
              relaciones. Las instrucciones de recuperación están en el
              proyecto.
            </p>
            <Button variant="secondary" disabled={a.busy} onClick={exportData}>
              <Download size={16} />
              Exportar mis datos
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
