import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, Square, RefreshCw, ArrowRight } from "lucide-react";
import { api, waitJob } from "./api";
import { Button } from "./components/ui/button";
import type { Attempt, Exercise, Result, Settings } from "./types";

interface Preview {
  transcription: string;
  model?: string;
  revision?: string;
  needs_review: boolean;
  alternatives: { id: string; text: string; model: string }[];
  result: Result;
}
interface Props {
  exercise: Exercise;
  sessionId: string;
  onSaved: (attempt: Attempt) => void;
  onNext?: () => void | Promise<void>;
  renderReference: (help: () => void, play: () => void) => ReactNode;
}
export function NumberSpeech({
  exercise: e,
  sessionId,
  onSaved,
  onNext,
  renderReference,
}: Props) {
  const generic = !!e.source?.continuous_topic;
  const cache = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const automatic = settings.data?.auto_validate_number_speech ?? true;
  const autoRef = useRef(automatic);
  autoRef.current = automatic;
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<Attempt | null>(e.attempt);
  const alive = useRef(true);
  const working = useRef(false);
  const recordingNow = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const objectUrl = useRef("");
  const media = useRef("");
  const protectedTake = useRef(!!e.attempt);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(Date.now());
  const hint = useRef(false);
  const plays = useRef(0);
  const continueButton = useRef<HTMLButtonElement>(null);
  const request = useRef<Record<string, unknown> | null>(null);
  const draftId = useRef(crypto.randomUUID());
  useEffect(() => {
    alive.current = true;
    const discard = () => {
      if (media.current && !protectedTake.current)
        void fetch(`/api/recordings/${media.current}/discard`, {
          method: "POST",
          keepalive: true,
        }).catch(() => {});
    };
    window.addEventListener("pagehide", discard);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state === "recording") recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      discard();
      window.removeEventListener("pagehide", discard);
    };
  }, []);
  async function run(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      if (alive.current)
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function discardDraft() {
    if (protectedTake.current)
      throw new Error(
        "El guardado está confirmado o pendiente de confirmación. Pulsa Continuar para resolverlo; esta toma se conserva.",
      );
    if (media.current) {
      await api(`/recordings/${media.current}/discard`, "POST");
      media.current = "";
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
    setUrl("");
    setBlob(null);
    setPreview(null);
    request.current = null;
    draftId.current = crypto.randomUUID();
  }
  async function prepare(
    take: Blob,
    validate: boolean,
  ): Promise<Preview | null> {
    if (media.current) {
      await api(`/recordings/${media.current}/discard`, "POST");
      media.current = "";
    }
    request.current = null;
    draftId.current = crypto.randomUUID();
    const form = new FormData();
    form.append("file", take, "numero");
    form.append("transcribe", String(validate));
    setStatus(
      validate
        ? generic
          ? "Transcribiendo y validando la expresión…"
          : "Transcribiendo y validando el número…"
        : "Preparando el audio sin transcribir ni validar…",
    );
    const upload = await api<{ media_id: string; job_id: string | null }>(
      "/recordings",
      "POST",
      form,
    );
    media.current = upload.media_id;
    if (!alive.current) {
      await api(`/recordings/${upload.media_id}/discard`, "POST");
      return null;
    }
    if (!validate) return null;
    const job = await waitJob(upload.job_id!);
    if (!alive.current) return null;
    if (
      job.result.no_speech ||
      job.result.needs_retry ||
      !String(job.result.text || "").trim()
    ) {
      await api(`/recordings/${upload.media_id}/discard`, "POST");
      media.current = "";
      throw new Error(
        String(
          job.result.quality_reason ||
            "No hay una transcripción fiable. Reintenta la grabación.",
        ),
      );
    }
    const result = await api<Preview>(
      `/number-practice/${sessionId}/speech-preview`,
      "POST",
      { activity_id: e.id, media_id: upload.media_id },
    );
    if (alive.current) {
      setPreview(result);
      setStatus(
        "Borrador validado. Reintentar descarta la toma; Continuar la guarda.",
      );
    }
    return result;
  }
  function stop() {
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
    recordingNow.current = false;
    setRecording(false);
  }
  async function record() {
    if (
      saved ||
      protectedTake.current ||
      settings.isPending ||
      settings.isError
    )
      return;
    await run(async () => {
      await discardDraft();
      if (!navigator.mediaDevices)
        throw new Error(
          "Abre la dirección local de Tuto para usar el micrófono.",
        );
      const capture = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (!alive.current) {
        capture.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = capture;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const native = new MediaRecorder(
        capture,
        mimeType ? { mimeType } : undefined,
      );
      recorder.current = native;
      chunks.current = [];
      native.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      native.onstop = () => {
        capture.getTracks().forEach((t) => t.stop());
        if (!alive.current) return;
        const take = new Blob(chunks.current, { type: native.mimeType });
        if (!take.size) {
          setError("La toma está vacía. Graba de nuevo.");
          return;
        }
        const local = URL.createObjectURL(take);
        objectUrl.current = local;
        setUrl(local);
        setBlob(take);
        if (autoRef.current)
          void run(async () => {
            await prepare(take, true);
          });
        else
          setStatus(
            "Borrador local. Puedes validar manualmente o Continuar para guardar solo el audio, sin nota.",
          );
      };
      started.current = Date.now();
      native.start();
      recordingNow.current = true;
      setRecording(true);
      setStatus("Grabando. Pulsa R o Detener grabación para terminar.");
      timer.current = setTimeout(stop, 120000);
    });
  }
  async function continueRound() {
    if (
      working.current ||
      recordingNow.current ||
      settings.isPending ||
      settings.isError
    )
      return;
    if (saved) {
      await run(async () => {
        await onNext?.();
      });
      return;
    }
    if (!blob || (automatic && !preview && !request.current)) return;
    await run(async () => {
      if (!request.current) {
        if (!media.current) await prepare(blob, false);
        if (!media.current || !alive.current) return;
        request.current = {
          id: draftId.current,
          session_id: sessionId,
          activity_id: e.id,
          media_id: media.current,
          response: preview?.transcription ?? "",
          number_recognition_check: !!preview,
          transcript_matches: false,
          hint: hint.current,
          plays: plays.current,
          seconds: Math.min(
            14400,
            Math.floor((Date.now() - started.current) / 1000),
          ),
        };
      }
      protectedTake.current = true;
      setStatus("Guardando la toma elegida…");
      let attempt: Attempt;
      try {
        attempt = await api<Attempt>("/attempts", "POST", request.current);
      } catch (err) {
        // Resolve an interrupted response before permitting the draft to be discarded.
        try {
          const history = await api<{ items: Attempt[] }>(
            `/attempt-history?session_id=${encodeURIComponent(sessionId)}&activity_id=${encodeURIComponent(e.id)}`,
          );
          const found = history.items.find((a) => a.id === draftId.current);
          if (found) attempt = found;
          else {
            protectedTake.current = false;
            throw err;
          }
        } catch (lookupError) {
          if (protectedTake.current)
            setStatus(
              "No se pudo confirmar el guardado. Continuar reintenta con el mismo identificador; la toma queda protegida.",
            );
          throw lookupError;
        }
      }
      protectedTake.current = true;
      if (!alive.current) return;
      setSaved(attempt);
      onSaved(attempt);
      setStatus("Intento guardado. Continuando…");
      await onNext?.();
    });
  }
  useEffect(() => {
    if (blob && !busy && !recording && (!automatic || preview))
      continueButton.current?.focus({ preventScroll: true });
  }, [blob, busy, recording, automatic, preview]);
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      working.current ||
      event.target instanceof HTMLInputElement
    )
      return;
    if (event.code === "KeyR") {
      event.preventDefault();
      if (recordingNow.current) stop();
      else void record();
    }
    if (
      event.key === "Enter" &&
      !(
        event.target instanceof HTMLElement &&
        event.target.closest("button,a,summary")
      )
    ) {
      event.preventDefault();
      void continueRound();
    }
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  return (
    <article className="card exercise quick-practice number-speech">
      <div className="exercise-meta">
        <span className="pill blue">Habla</span>
        <span>Borrador hasta Continuar</span>
      </div>
      <h2>{e.title}</h2>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={automatic}
          disabled={
            busy ||
            recording ||
            !!saved ||
            settings.isPending ||
            settings.isError ||
            protectedTake.current
          }
          onChange={(event) => {
            const value = event.target.checked;
            void run(async () => {
              const config = await api<Settings>(
                "/settings/number-speech",
                "PATCH",
                { auto_validate_number_speech: value },
              );
              cache.setQueryData(["settings"], config);
              if (value && blob && !preview) await prepare(blob, true);
            });
          }}
        />
        Validar automáticamente al detener
      </label>
      <p className="small">
        {automatic
          ? generic
            ? "Al detener, se transcribe y se compara la expresión reconocida. Puedes repetir antes de guardar."
            : "Al detener, se transcribe y se compara el número reconocido. Puedes repetir antes de guardar."
          : "No se transcribe ni valida automáticamente. Puedes validar manualmente o Continuar con solo el audio, sin nota."}
      </p>
      <p className="instruction">{e.prompt}</p>
      <div className="reading-material">{e.material}</div>
      <details className="quick-help">
        <summary>Referencia y pronunciación (ayuda)</summary>
        {renderReference(
          () => {
            hint.current = true;
          },
          () => {
            hint.current = true;
            plays.current++;
          },
        )}
      </details>
      {url && <audio aria-label="Mi grabación" controls src={url} />}
      <label htmlFor={"speech-transcript-" + e.id}>
        Transcripción automática · solo lectura
      </label>
      <textarea
        id={"speech-transcript-" + e.id}
        readOnly
        value={
          preview?.transcription ??
          saved?.transcription ??
          saved?.response ??
          ""
        }
        placeholder={
          error || "La transcripción aparecerá después de validar esta toma."
        }
      />
      {preview && (
        <section
          className={
            "result speech-preview " +
            (preview.result.score === 100 ? "" : "reinforce")
          }
          role="status"
        >
          <h3>
            {preview.result.score === 100
              ? generic
                ? "El texto reconocido coincide"
                : "El número reconocido coincide"
              : generic
                ? "El texto reconocido no coincide"
                : "El número reconocido no coincide"}
          </h3>
          <p>{preview.result.feedback}</p>
          <small>
            {preview.model} · {preview.revision?.slice(0, 10)}
          </small>
          {preview.needs_review && (
            <p>
              Los reconocedores difieren. Revisa sus lecturas o reintenta la
              toma.
            </p>
          )}
          {preview.alternatives.map((a) => (
            <details key={a.id}>
              <summary>Otra lectura · {a.model}</summary>
              <blockquote>{a.text}</blockquote>
            </details>
          ))}
        </section>
      )}
      {saved && (
        <p className="small">
          Este intento ya está guardado y se conserva. Continuar abre el
          siguiente elemento.
        </p>
      )}
      <p className="small" role="status">
        {status}
      </p>
      {!automatic && blob && !preview && !saved && (
        <Button
          variant="ghost"
          disabled={busy || recording || protectedTake.current}
          onClick={() =>
            void run(async () => {
              await prepare(blob, true);
            })
          }
        >
          Transcribir y validar esta toma
        </Button>
      )}
      {(error || settings.error) && (
        <p className="error" role="alert">
          {error || settings.error?.message}
        </p>
      )}
      <div className="quick-control-bar speech-controls">
        <Button
          variant="secondary"
          disabled={
            busy ||
            !!saved ||
            protectedTake.current ||
            settings.isPending ||
            settings.isError
          }
          onClick={() => {
            if (recording) stop();
            else void record();
          }}
        >
          {recording ? (
            <Square size={16} />
          ) : blob ? (
            <RefreshCw size={16} />
          ) : (
            <Mic size={16} />
          )}{" "}
          {recording
            ? "Detener grabación"
            : blob
              ? "Reintentar"
              : "Grabar mi voz"}
        </Button>
        <Button
          ref={continueButton}
          disabled={
            busy ||
            recording ||
            settings.isPending ||
            settings.isError ||
            (!saved && (!blob || (automatic && !preview && !request.current)))
          }
          onClick={() => void continueRound()}
        >
          {busy ? "Procesando…" : "Continuar"}
          <ArrowRight size={16} />
        </Button>
      </div>
      <p className="small">
        Reintentar descarta el audio provisional y mantiene este elemento. Solo
        Continuar guarda el intento y actualiza el historial. Esta validación
        comprueba el texto reconocido; no mide tu pronunciación ni afirma que
        hayas confirmado la transcripción.
      </p>
    </article>
  );
}
