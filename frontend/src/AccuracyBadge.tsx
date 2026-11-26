import { CircleCheck, CircleAlert, Circle } from "lucide-react";

export interface Accuracy {
  attempts: number;
  evaluated: number;
  correct: number;
  percent: number | null;
  color: "none" | "red" | "yellow" | "green";
}
export function AccuracyBadge({ value }: { value?: Accuracy }) {
  if (!value) return null;
  const Icon =
    value.color === "green"
      ? CircleCheck
      : value.color === "none"
        ? Circle
        : CircleAlert;
  return (
    <span
      className={`accuracy-badge ${value.color}`}
      title={`${value.correct} aciertos de ${value.evaluated} intentos evaluables. ${value.attempts - value.evaluated} sin nota.`}
      aria-label={
        value.percent === null
          ? "Sin intentos evaluables"
          : `${value.percent}% de aciertos, ${value.correct} de ${value.evaluated} evaluables`
      }
    >
      <Icon size={14} aria-hidden="true" />{" "}
      {value.percent === null ? "Sin evaluar" : `${value.percent}%`}
    </span>
  );
}
