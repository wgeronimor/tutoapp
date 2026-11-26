import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  Circle,
  Pin,
  PinOff,
  EyeOff,
  Eye,
  Trash2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { api } from "./api";
import { Button } from "./components/ui/button";
import { AccuracyBadge, type Accuracy } from "./AccuracyBadge";

interface PracticeRow {
  id: string;
  kind: "fixed" | "continuous";
  title: string;
  created: string;
  started: string | null;
  hidden: boolean;
  pin_order: number | null;
  last_activity: string | null;
  status:
    "prepared" | "not_started" | "in_progress" | "completed" | "continuous";
  attempts: number;
  rounds: number;
  seconds: number;
  accuracy: Accuracy;
  total_activities: number | null;
  completed_activities: number | null;
  completion_percent: number | null;
  types_practiced: number | null;
  types_total: number | null;
  types_percent: number | null;
  types: { id: string; title: string; rounds: number; url: string }[];
  numbers_seen: number;
  coverage_label?: string;
  range_size: number | null;
  range_percent: number | null;
  proposal_id: string | null;
  session_id: string | null;
  practice_url: string | null;
  history_url: string | null;
  level: string | null;
  planned_minutes: number | null;
}
interface HistoryPage {
  items: PracticeRow[];
  total: number;
  offset: number;
  limit: number;
  timezone: string;
  pin_limit: number;
  pins: {
    session_id: string;
    title: string;
    position: number;
    kind: string;
    url: string;
  }[];
}
const statusName: Record<PracticeRow["status"], string> = {
  prepared: "Preparada, sin iniciar",
  not_started: "Sin intentos",
  in_progress: "En curso",
  completed: "Todas respondidas",
  continuous: "Sin límite de rondas",
};
function duration(seconds: number) {
  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function PracticeHistory({
  kind,
  onReview,
  onRemoved,
  busy = false,
}: {
  kind: "fixed" | "continuous";
  onReview?: (id: string) => void;
  onRemoved?: (id: string) => void;
  busy?: boolean;
}) {
  const [page, setPage] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const cache = useQueryClient();
  const limit = 20;
  const query = useQuery({
    queryKey: ["practice-history", kind, page, showInactive],
    refetchOnMount: "always",
    queryFn: () =>
      api<HistoryPage>(
        `/practice-history?kind=${kind}&offset=${page * limit}&limit=${limit}&show_inactive=${showInactive}`,
      ),
  });
  async function change(id: string, action: string) {
    setPending(true);
    setError("");
    try {
      await api(`/practice-history/${id}`, "PATCH", { action });
      setPage(0);
      await cache.invalidateQueries({ queryKey: ["practice-history"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  async function remove(id: string) {
    setPending(true);
    setError("");
    try {
      await api(`/proposals/${id}`, "DELETE");
      for (const key of ["tuto:proposal", "tuto:continuous-proposal"]) {
        if (localStorage.getItem(key) === id) localStorage.removeItem(key);
      }
      onRemoved?.(id);
      setRemoveId(null);
      setPage(0);
      await cache.invalidateQueries({ queryKey: ["practice-history"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  const title =
    kind === "fixed"
      ? "Sesiones fijas anteriores"
      : "Prácticas continuas anteriores";
  const date = (value: string) =>
    new Date(value).toLocaleString("es", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: query.data?.timezone || "America/Vancouver",
    });
  return (
    <section
      className="card practice-history"
      aria-labelledby={`practice-history-${kind}`}
    >
      <div className="practice-history-heading">
        <div>
          <h2 id={`practice-history-${kind}`}>{title}</h2>
          <p className="small">
            {kind === "fixed"
              ? "Retoma una sesión, revisa sus intentos o vuelve a ver la propuesta que preparaste."
              : "Comprueba qué tipos has practicado y abre directamente los que quieras trabajar."}
          </p>
        </div>
        {query.data && (
          <span className="pill">
            {query.data.total}{" "}
            {query.data.total === 1 ? "práctica creada" : "prácticas creadas"}
          </span>
        )}
      </div>
      <div className="history-organization-controls">
        <label className="check">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => {
              setShowInactive(e.target.checked);
              setPage(0);
            }}
          />{" "}
          Mostrar inactivas
        </label>
        {query.data && (
          <details className="history-pins">
            <summary>
              Organizar pines ({query.data.pins.length}/{query.data.pin_limit})
            </summary>
            <p className="small">
              Hasta 10 entre sesiones fijas y continuas. Las fijadas aparecen
              primero. Ocultar una práctica también quita su pin.
            </p>
            {query.data.pins.length === 0 ? (
              <p className="small">Todavía no tienes prácticas fijadas.</p>
            ) : (
              <ol>
                {query.data.pins.map((pin, index) => (
                  <li key={pin.session_id}>
                    <Link className="text-link" to={pin.url}>
                      {pin.title}
                    </Link>
                    <span className="small">
                      {pin.kind === "fixed" ? "Fija" : "Continua"}
                    </span>
                    <div>
                      <Button
                        variant="ghost"
                        aria-label={`Subir pin: ${pin.title}`}
                        disabled={pending || busy || index === 0}
                        onClick={() => void change(pin.session_id, "up")}
                      >
                        <ArrowUp size={16} /> Subir
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Bajar pin: ${pin.title}`}
                        disabled={
                          pending ||
                          busy ||
                          index === query.data!.pins.length - 1
                        }
                        onClick={() => void change(pin.session_id, "down")}
                      >
                        <ArrowDown size={16} /> Bajar
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Quitar pin: ${pin.title}`}
                        disabled={pending || busy}
                        onClick={() => void change(pin.session_id, "unpin")}
                      >
                        <PinOff size={16} /> Quitar
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </details>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {query.isLoading && <p>Cargando prácticas anteriores…</p>}
      {query.error && (
        <p className="error" role="alert">
          {query.error.message}
        </p>
      )}
      {query.data && query.data.items.length === 0 && (
        <p className="small">
          {kind === "fixed"
            ? "No hay sesiones fijas visibles. Puedes activar Mostrar inactivas."
            : "No hay prácticas continuas visibles. Puedes activar Mostrar inactivas."}
        </p>
      )}
      {query.data && query.data.items.length > 0 && (
        <>
          <p className="small history-timezone">
            Fijadas primero; después, más recientes · Fechas en{" "}
            {query.data.timezone}.{" "}
            {kind === "continuous"
              ? "Un tipo cuenta como practicado cuando tiene al menos una ronda guardada."
              : "El avance cuenta actividades respondidas; los aciertos se calculan entre intentos evaluables."}
          </p>
          <div className="practice-table-scroll">
            <table aria-label={title}>
              <thead>
                <tr>
                  <th>Práctica</th>
                  <th>Fechas</th>
                  <th>{kind === "fixed" ? "Avance" : "Tipos practicados"}</th>
                  <th>Actividad</th>
                  <th>Aciertos</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((row) => {
                  const progress =
                    kind === "fixed"
                      ? row.completion_percent
                      : row.types_percent;
                  return (
                    <tr key={row.id} data-practice-id={row.id}>
                      <td className="practice-table-title">
                        {row.pin_order !== null && (
                          <span className="pill">
                            <Pin size={13} aria-hidden="true" /> Fijada ·{" "}
                            {row.pin_order}
                          </span>
                        )}
                        {row.hidden && <span className="pill">Inactiva</span>}
                        {row.practice_url ? (
                          <Link className="text-link" to={row.practice_url}>
                            {row.title}
                          </Link>
                        ) : (
                          <button
                            className="text-link history-proposal-link"
                            disabled={busy}
                            onClick={() =>
                              row.proposal_id && onReview?.(row.proposal_id)
                            }
                          >
                            {row.title}
                          </button>
                        )}
                        <small>{statusName[row.status]}</small>
                        {row.level && (
                          <small>
                            {row.level}
                            {row.planned_minutes
                              ? ` · ${row.planned_minutes} min previstos`
                              : ""}
                          </small>
                        )}
                      </td>
                      <td className="practice-table-dates">
                        <small>Creada</small>
                        <time dateTime={row.created}>{date(row.created)}</time>
                        <small>Última actividad</small>
                        {row.last_activity ? (
                          <time dateTime={row.last_activity}>
                            {date(row.last_activity)}
                          </time>
                        ) : (
                          <span>Sin intentos</span>
                        )}
                      </td>
                      <td className="practice-table-progress">
                        <strong>
                          {kind === "fixed"
                            ? `${row.completed_activities}/${row.total_activities} respondidas`
                            : `${row.types_practiced}/${row.types_total} tipos practicados`}{" "}
                          · {progress}%
                        </strong>
                        <progress
                          max={100}
                          value={progress || 0}
                          aria-label={
                            kind === "fixed"
                              ? `Avance de ${row.title}`
                              : `Tipos practicados de ${row.title}`
                          }
                        />
                        {kind === "continuous" && (
                          <div className="practice-type-grid">
                            {row.types.map((type) => {
                              const Icon = type.rounds ? CircleCheck : Circle;
                              return (
                                <Link
                                  key={type.id}
                                  className={
                                    type.rounds ? "practiced" : "pending"
                                  }
                                  to={type.url}
                                  aria-label={`${type.title}: ${type.rounds} ${type.rounds === 1 ? "ronda" : "rondas"}${type.rounds ? "" : ", pendiente"}`}
                                >
                                  <Icon size={13} aria-hidden="true" />
                                  <span>
                                    {type.title}
                                    <small>
                                      {type.rounds
                                        ? `${type.rounds} ${type.rounds === 1 ? "ronda" : "rondas"}`
                                        : "Pendiente · 0 rondas"}
                                    </small>
                                  </span>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="practice-table-activity">
                        <b>
                          {kind === "continuous"
                            ? `${row.rounds} ${row.rounds === 1 ? "ronda practicada" : "rondas practicadas"}`
                            : `${row.attempts} ${row.attempts === 1 ? "intento" : "intentos"}`}
                        </b>
                        <small>{duration(row.seconds)} registrados</small>
                        {kind === "continuous" && (
                          <small>
                            {row.numbers_seen}/{row.range_size}{" "}
                            {row.coverage_label || "números"}{" "}
                            {row.coverage_label === "expresiones"
                              ? "distintas"
                              : "distintos"}{" "}
                            · {row.range_percent}%{" "}
                            {row.coverage_label === "expresiones"
                              ? "del catálogo"
                              : "del rango"}
                          </small>
                        )}
                      </td>
                      <td>
                        <AccuracyBadge value={row.accuracy} />
                        <small>
                          {row.accuracy.correct}/{row.accuracy.evaluated}{" "}
                          evaluables
                        </small>
                      </td>
                      <td className="practice-table-actions">
                        {row.practice_url && (
                          <Link className="btn secondary" to={row.practice_url}>
                            {row.status === "completed"
                              ? "Revisar sesión"
                              : "Continuar"}
                          </Link>
                        )}
                        {row.proposal_id && onReview && (
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() => onReview(row.proposal_id!)}
                          >
                            {row.practice_url
                              ? "Ver propuesta"
                              : "Revisar propuesta"}
                          </Button>
                        )}
                        {row.history_url && row.attempts > 0 && (
                          <Link className="text-link" to={row.history_url}>
                            Ver intentos
                          </Link>
                        )}
                        {row.session_id ? (
                          <>
                            <Button
                              variant="ghost"
                              disabled={
                                busy ||
                                pending ||
                                row.hidden ||
                                (row.pin_order === null &&
                                  query.data!.pins.length >=
                                    query.data!.pin_limit)
                              }
                              onClick={() =>
                                void change(
                                  row.session_id!,
                                  row.pin_order === null ? "pin" : "unpin",
                                )
                              }
                            >
                              {row.pin_order === null ? (
                                <Pin size={15} />
                              ) : (
                                <PinOff size={15} />
                              )}
                              {row.pin_order === null ? "Fijar" : "Quitar pin"}
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={busy || pending}
                              onClick={() =>
                                void change(
                                  row.session_id!,
                                  row.hidden ? "show" : "hide",
                                )
                              }
                            >
                              {row.hidden ? (
                                <Eye size={15} />
                              ) : (
                                <EyeOff size={15} />
                              )}
                              {row.hidden ? "Reactivar" : "Ocultar"}
                            </Button>
                          </>
                        ) : (
                          row.proposal_id &&
                          (removeId === row.proposal_id ? (
                            <div
                              className="history-remove-confirm"
                              role="group"
                              aria-label="Confirmar eliminación de propuesta"
                            >
                              <small>
                                ¿Eliminar esta propuesta sin iniciar?
                              </small>
                              <Button
                                variant="secondary"
                                disabled={busy || pending}
                                onClick={() => void remove(row.proposal_id!)}
                              >
                                Confirmar eliminación
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={pending}
                                onClick={() => setRemoveId(null)}
                              >
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              disabled={busy || pending}
                              onClick={() => setRemoveId(row.proposal_id)}
                            >
                              <Trash2 size={15} /> Eliminar propuesta
                            </Button>
                          ))
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="practice-history-pagination">
            <span className="small">
              {query.data.offset + 1}–
              {query.data.offset + query.data.items.length} de{" "}
              {query.data.total}
            </span>
            <div>
              <Button
                variant="secondary"
                disabled={page === 0 || query.isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                Página anterior
              </Button>
              <Button
                variant="secondary"
                disabled={
                  (page + 1) * limit >= query.data.total || query.isFetching
                }
                onClick={() => setPage((p) => p + 1)}
              >
                Página siguiente
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
