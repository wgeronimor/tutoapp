export type Skill = "reading" | "listening" | "writing" | "speaking";
export const skillName: Record<Skill, string> = {
  reading: "Lectura",
  listening: "Escucha",
  writing: "Escritura",
  speaking: "Habla",
};
export interface Advice {
  equivalence_note?: string;
  input_text?: string;
  corrected: string;
  feedback: string;
  next_action: string;
  source: string;
}
export interface Result {
  format_mismatch?: boolean;
  score: number | null;
  passed: boolean | null;
  target: number;
  method: string;
  meaning?: string;
  feedback: string;
  reference: string;
  accepted?: string[];
  source: string;
  pronunciation: string;
  criteria?: string[];
  advice?: Advice;
}
export interface AiReview {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  created: string;
  result: Partial<Advice>;
  error: string | null;
  unverified: boolean;
}
export interface Attempt {
  practice_url?: string;
  ai_review_status?:
    "not_requested" | "pending" | "failed" | "reviewed" | "unverified";
  ai_reviews?: AiReview[];
  id: string;
  session_id: string;
  activity_id: string;
  response: string;
  media_id: string | null;
  media_deleted?: boolean;
  transcription?: string;
  recognizer?: string;
  advice_unverified?: boolean;
  legacy_response_differs?: boolean;
  transcription_runs?: {
    id: string;
    text: string;
    model: string;
    revision: string;
    created: string;
    pipeline?: string;
    needs_retry?: boolean;
  }[];
  evidence: {
    seconds: number;
    plays: number;
    hint: boolean;
    transcript: boolean;
    handwritten: boolean;
    transcription_run_id?: string;
    transcript_review?: {
      status: "matches" | "mismatch" | "unsure";
      created: string;
    };
  };
  result: Result;
  created: string;
  title?: string;
  skill?: Skill;
  annotations?: { text: string; origin: string }[];
}
export interface Exercise {
  accuracy?: import("./AccuracyBadge").Accuracy;
  has_audio?: boolean;
  attempt_count?: number;
  id: string;
  key: string;
  version: string;
  title: string;
  skill: Skill;
  mode: "choice" | "exact" | "open" | "speak";
  prompt: string;
  material: string;
  reference?: string;
  options: string[];
  item: string;
  meaning: string;
  variation: string;
  block: string;
  minutes: number;
  origin: string;
  source: {
    number_practice?: boolean;
    continuous_topic?: boolean;
    number_mode?: "write" | "speak" | "listen" | "read" | "dictation";
    answer_format?: "words" | "digits" | "spoken";
    number?: number;
    unit?: number;
    printed_page?: number;
    pdf_page?: number;
    relationship?: string;
  };
  attempt: Attempt | null;
}
export interface PronunciationGuide {
  text: string;
  ipa: string;
  notes: string[];
  sources: { title: string; url: string }[];
  method: string;
  automatic: boolean;
  version: string;
}
export interface StudySession {
  accuracy?: import("./AccuracyBadge").Accuracy;
  attempt_count?: number;
  id: string;
  title: string;
  source: string;
  state: {
    cursor?: number;
    day?: number;
    week?: number;
    goal?: string;
    unit?: number;
    tip?: string;
  };
  activities: Exercise[];
  assessment?: {
    correct: number;
    total: number;
    percent: number;
    target: number;
    passed: boolean;
  };
  done: number;
  total: number;
  percent: number | null;
  seconds: number;
}
export interface Prefs {
  minutes: number;
  modalities: Skill[];
  level: "A0" | "A1" | "A2";
  minimum: number;
  maximum: number;
  selection: "mixed" | "new" | "difficult";
  time_mode: "daily" | "extra";
}
export interface Proposal {
  id: string;
  parent_id: string | null;
  topic: string;
  instruction: string;
  session_id: string | null;
  title: string;
  objective: string;
  level: string;
  minutes: number;
  preferences: Prefs;
  origin: string;
  examples: { french: string; spanish: string }[];
  tip: string;
  activities: { title: string; skill: Skill; prompt: string }[];
}
export interface MemoryItem {
  id: string;
  item: string;
  skill: Skill;
  label: string;
  due: string;
  evidence: {
    attempts: number;
    errors: number;
    autonomous: number;
    learned: boolean;
    last_attempt: string;
  };
}
export interface ClassItem {
  id?: string;
  date: string;
  unit: number;
  pages: string;
  announcement: string;
  agenda: "Estimada" | "Confirmada" | "Vista en clase";
  preparation: "Pendiente" | "Preparada" | "Necesita refuerzo";
  difficulty: string;
  minutes: number;
  session_id?: string;
}
export interface Settings {
  auto_advance_choices?: boolean;
  auto_advance_dictation?: boolean;
  auto_advance_writing?: boolean;
  auto_validate_number_speech?: boolean;
  auto_transcribe?: boolean;
  auto_review?: boolean;
  start_date: string;
  timezone: string;
  target: number;
  academy_unit: number;
  daily_minutes: number;
}
export interface CourseDay {
  day: number;
  week: number;
  title: string;
  goal: string;
  unit: number;
  evaluation: boolean;
  done: number;
  total: number;
  session_id: string | null;
  tip: string;
}
export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed";
  result: Record<string, unknown>;
  error?: string;
}
export interface AnalysisResult {
  temporary: boolean;
  saveable: boolean;
  created: string;
  mode: "draft" | "history";
  input_text: string;
  advice?: Advice;
  advice_error?: string;
  recognition?: {
    text: string;
    model: string;
    revision: string;
    needs_retry?: boolean;
    alternatives?: { text: string; model: string; revision: string }[];
  };
  models: { role: string; repo_id: string; revision: string }[];
}
