"""Endless number drills: immutable draws and attempts, mutable navigation only."""

import random
from copy import deepcopy
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import Integer, case, cast, func, select

from .db import Activity, Attempt, StudySession, uid
from .learning import add_activity, normalize, number, public_activity

Mode = Literal["write", "speak", "listen", "read", "dictation"]
MODES = [
    {"id": "write", "title": "Escribir", "skill": "writing"},
    {"id": "speak", "title": "Decir el número", "skill": "speaking"},
    {"id": "listen", "title": "Escuchar y elegir", "skill": "listening"},
    {"id": "read", "title": "Leer y elegir", "skill": "reading"},
    {"id": "dictation", "title": "Escuchar y escribir", "skill": "listening"},
]
_rng = random.SystemRandom()


class StartNumbers(BaseModel):
    request_id: str = Field(min_length=16, max_length=100)
    minimum: int = Field(default=1, ge=1, le=500)
    maximum: int = Field(default=10, ge=1, le=500)

    @model_validator(mode="after")
    def valid_range(self):
        if self.maximum < self.minimum:
            raise ValueError("El inicio no puede ser mayor que el final del rango")
        return self


class NextNumber(BaseModel):
    mode: Mode = "write"


class AnswerFormats(BaseModel):
    mode: Literal["write", "read", "listen", "dictation"]
    formats: list[Literal["words", "digits"]] = Field(min_length=1, max_length=2)

    @model_validator(mode="after")
    def distinct(self):
        if len(set(self.formats)) != len(self.formats):
            raise ValueError("Elige formatos distintos y conserva al menos uno activo")
        return self


def formats_for(state, mode):
    stored = state.get("answer_formats", {}).get(mode, ["words", "digits"])
    return [f for f in ("words", "digits") if f in stored] or ["words", "digits"]


def set_formats(session, data):
    if session.source != "numbers-continuous":
        raise ValueError("Los formatos de cifras y letras se aplican a números")
    state = deepcopy(session.state)
    values = [f for f in ("words", "digits") if f in data.formats]
    if values != formats_for(state, data.mode):
        state.setdefault("format_bags", {})[data.mode] = []
    state.setdefault("answer_formats", {})[data.mode] = values
    session.state = state


def accuracy_counts(total, evaluated, correct):
    percent = round(100 * correct / evaluated) if evaluated else None
    return {
        "attempts": total,
        "evaluated": evaluated,
        "correct": correct,
        "percent": percent,
        "color": "none"
        if percent is None
        else "green"
        if percent >= 86
        else "yellow"
        if percent >= 70
        else "red",
    }


def accuracy(attempts):
    values = [a.result["score"] for a in attempts if a.result.get("score") is not None]
    return accuracy_counts(len(attempts), len(values), sum(v == 100 for v in values))


def start(db, data):
    # Serializes retries of Start, including two requests before the first commit.
    from sqlalchemy import text

    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": "numbers:" + data.request_id}
    )
    session = db.scalar(
        select(StudySession).where(StudySession.key == "numbers:" + data.request_id)
    )
    if session:
        if (session.state["minimum"], session.state["maximum"]) != (data.minimum, data.maximum):
            raise ValueError("Este inicio ya pertenece a otro rango; vuelve a iniciar la práctica")
        return session
    session = StudySession(
        key="numbers:" + data.request_id,
        title=f"Números {data.minimum}–{data.maximum} · práctica continua",
        source="numbers-continuous",
        activity_ids=[],
        state={
            "minimum": data.minimum,
            "maximum": data.maximum,
            "active": {},
            "bags": {},
            "last": {},
            "cursors": {},
        },
    )
    db.add(session)
    db.flush()
    return session


def get_session(db, id):
    session = db.scalar(select(StudySession).where(StudySession.id == id).with_for_update())
    if not session or session.source not in ("numbers-continuous", "topics-continuous"):
        raise ValueError("No se encontró esta práctica continua")
    return session


def next_draw(db, session, mode):
    if session.source == "topics-continuous":
        from .continuous_topics import draw

        return draw(db, session, mode)
    state = deepcopy(session.state)
    active = state["active"].get(mode)
    if active and not db.scalar(
        select(Attempt.id)
        .where(Attempt.session_id == session.id, Attempt.activity_id == active)
        .limit(1)
    ):
        session.state = {**state, "selected_mode": mode}
        return db.get(Activity, active)
    bag = state["bags"].get(mode, [])
    if not bag:
        bag = list(range(state["minimum"], state["maximum"] + 1))
        _rng.shuffle(bag)
        if len(bag) > 1 and bag[-1] == state["last"].get(mode):
            bag[0], bag[-1] = bag[-1], bag[0]
    n = bag.pop()
    state["bags"][mode] = bag
    state["last"][mode] = n
    cursor = state["cursors"].get(mode, 0)
    state["cursors"][mode] = cursor + 1
    # Balanced randomized pairs exercise both directions without a predictable order.
    allowed = formats_for(state, mode) if mode != "speak" else ["words"]
    formats = [
        v
        for v in state.setdefault("format_bags", {}).get(mode, [])
        if ("words" if v else "digits") in allowed
    ]
    if not formats:
        formats = [f == "words" for f in allowed]
        _rng.shuffle(formats)
    words = formats.pop()
    state["format_bags"][mode] = formats
    fmt = "words" if words else "digits"
    french = number(n)
    title = next(m["title"] for m in MODES if m["id"] == mode)
    skill = next(m["skill"] for m in MODES if m["id"] == mode)
    options = []
    accepted = [french if words else str(n)]
    prompt = f"Escribe en letras francesas: {n}" if words else f"Escribe en cifras: {french}"
    material = ""
    exercise_mode = "exact"
    if mode in ("listen", "dictation"):
        prompt = (
            "Escucha y "
            + ("elige" if mode == "listen" else "escribe")
            + (" el número en letras." if words else " el número en cifras.")
        )
    if mode in ("listen", "read"):
        exercise_mode = "choice"
        alternatives = [x for x in range(state["minimum"], state["maximum"] + 1) if x != n]
        _rng.shuffle(alternatives)
        candidates = [n, *alternatives[:3]]
        _rng.shuffle(candidates)
        options = [number(x) if words else str(x) for x in candidates]
        if mode == "read":
            material = str(n) if words else french
            prompt = (
                "Elige el mismo número en letras." if words else "Elige el mismo número en cifras."
            )
    if mode == "speak":
        exercise_mode = "speak"
        fmt = "spoken"
        prompt = f"Di este número en francés: {n}"
        material = str(n)
        accepted = []
    data = {
        "key": f"number-round:{session.id}:{uid()}",
        "title": title,
        "skill": skill,
        "mode": exercise_mode,
        "prompt": prompt,
        "material": material,
        "reference": french,
        "options": options,
        "accepted": accepted,
        "explanation": f"{n} = {french}.",
        "item": f"fr:cardinal:{n}",
        "meaning": str(n),
        "minutes": 1,
        "origin": "Práctica continua · reglas numéricas revisadas",
        "block": "Práctica continua",
        "source": {"number_practice": True, "number_mode": mode, "answer_format": fmt, "number": n},
    }
    activity = add_activity(db, data, "number-practice-v1")
    session.activity_ids = [*session.activity_ids, activity.id]
    state["active"][mode] = activity.id
    state["selected_mode"] = mode
    session.state = state
    db.flush()
    return activity


def snapshot(db, session, mode=None, serialize_attempt=None):
    from .continuous_topics import modes as session_modes

    available = session_modes(session)
    mode = mode or session.state.get("selected_mode", available[0]["id"])
    if mode not in {m["id"] for m in available}:
        raise ValueError("Este tipo no está incluido en la práctica")
    score = cast(Attempt.result["score"].astext, Integer)
    category = Activity.data["source"]["number_mode"].astext
    rows = db.execute(
        select(
            category,
            func.count(Attempt.id),
            func.count(score),
            func.sum(case((score == 100, 1), else_=0)),
            func.count(func.distinct(Activity.data["item"].astext)),
        )
        .select_from(Attempt)
        .join(Activity, Attempt.activity_id == Activity.id)
        .where(Attempt.session_id == session.id)
        .group_by(category)
    ).all()
    groups = {row[0]: row[1:] for row in rows}

    def summary(counts):
        total, evaluated, correct, _seen = counts
        return accuracy_counts(total, evaluated, correct)

    totals = tuple(sum(r[i] for r in groups.values()) for i in range(4))
    current_id = session.state["active"].get(mode)
    current = db.get(Activity, current_id) if current_id else None
    saved = (
        db.scalar(
            select(Attempt)
            .where(Attempt.session_id == session.id, Attempt.activity_id == current_id)
            .limit(1)
        )
        if current
        else None
    )
    return {
        "id": session.id,
        "title": session.title,
        "topic": session.source == "topics-continuous",
        "minimum": session.state["minimum"],
        "maximum": session.state["maximum"],
        "mode": mode,
        "answer_formats": {
            m["id"]: formats_for(session.state, m["id"]) for m in available if m["id"] != "speak"
        },
        "accuracy": summary(totals),
        "modes": [
            {
                **m,
                "accuracy": summary(groups.get(m["id"], (0, 0, 0, 0))),
                "seen": groups.get(m["id"], (0, 0, 0, 0))[3],
            }
            for m in available
        ],
        "activity": {
            **public_activity(current),
            "attempt": serialize_attempt(saved, db) if saved and serialize_attempt else None,
            "attempt_count": int(saved is not None),
        }
        if current
        else None,
    }


def grade_number(data, response, target, evidence):
    source = data["source"]
    n = source["number"]
    format_mismatch = False
    feedback = f"{n} = {number(n)}."
    if source["answer_format"] == "spoken":
        from .evaluation import spoken_content

        score = (
            (100 if spoken_content(response) == [str(n)] else 0)
            if (evidence.get("transcript_matches") or evidence.get("number_recognition_check"))
            and response.strip()
            else None
        )
        method = "Número identificado en la transcripción confirmada · sin nota de pronunciación"
        if evidence.get("number_recognition_check"):
            method = "Número identificado automáticamente en la transcripción · sin nota de pronunciación · sin confirmación humana"
            feedback = f"Detectado: «{response}». Se esperaba: «{number(n)}» ({n}). " + (
                "El texto reconocido coincide con el número solicitado."
                if score == 100
                else "El texto reconocido no coincide con el número solicitado; puedes reintentar."
            )

    else:
        expected = str(n) if source["answer_format"] == "digits" else number(n)
        score = 100 if normalize(response) == normalize(expected) else 0
        other_format = number(n) if source["answer_format"] == "digits" else str(n)
        format_mismatch = score == 0 and normalize(response) == normalize(other_format)
        format_label = "cifras" if source["answer_format"] == "digits" else "letras francesas"
        if format_mismatch:
            feedback = (
                f"Identificaste el número correcto, pero esta ronda pedía {format_label}. "
                f"Escribiste «{response}»; se esperaba «{expected}»."
            )
        elif score == 0:
            feedback = f"Esta ronda pedía {format_label}. Respuesta esperada: «{expected}». {n} = {number(n)}."
        else:
            feedback = f"Correcto. Respuesta en {format_label}: «{expected}». {n} = {number(n)}."
        method = "Correspondencia entre cifra y nombre francés · respuesta revisada"
    return {
        "score": score,
        "passed": score >= target if score is not None else None,
        "target": target,
        "method": method,
        "meaning": "Acierto de contenido; no mide pronunciación ni equivale a NCLC.",
        "format_mismatch": format_mismatch,
        "feedback": feedback
        if score is not None
        else "Sin resultado evaluable: falta una transcripción confirmada. No se incluye en el porcentaje.",
        "source": data["origin"],
        "reference": data["reference"],
        "accepted": [number(n) if source["answer_format"] != "digits" else str(n)],
        "pronunciation": "Pendiente de validación acústica",
    }
