import hashlib
import json
import re
import unicodedata
from datetime import datetime, timedelta

from fsrs import Card, Rating, Scheduler
from sqlalchemy import select

from .config import ROOT
from .db import Activity, Memory, Review, Settings, StudySession, now
from .schemas import Exercise

UNITS = [
    "zéro",
    "un",
    "deux",
    "trois",
    "quatre",
    "cinq",
    "six",
    "sept",
    "huit",
    "neuf",
    "dix",
    "onze",
    "douze",
    "treize",
    "quatorze",
    "quinze",
    "seize",
]


def number(n):
    if not 0 <= n <= 500:
        raise ValueError("Rango disponible: 0–500")
    if n < 17:
        return UNITS[n]
    if n < 20:
        return "dix-" + UNITS[n - 10]
    if n < 70:
        tens = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"][n // 10]
        r = n % 10
        return tens + (" et un" if r == 1 else "-" + number(r) if r else "")
    if n < 80:
        return "soixante" + (" et onze" if n == 71 else "-" + number(n - 60))
    if n < 100:
        return "quatre-vingts" if n == 80 else "quatre-vingt-" + number(n - 80)
    h, r = divmod(n, 100)
    prefix = ("" if h == 1 else UNITS[h] + " ") + "cent" + ("s" if h > 1 and r == 0 else "")
    return prefix + (" " + number(r) if r else "")


def normalize(text):
    return " ".join(
        re.findall(r"\w+", unicodedata.normalize("NFC", text).lower().replace("’", "'"))
    )


def item_id(text):
    return "fr:expression:" + hashlib.sha256(normalize(text).encode()).hexdigest()[:20]


def settings(db):
    row = db.get(Settings, 1)
    if row is None:
        from zoneinfo import ZoneInfo

        row = Settings(
            id=1,
            data={
                "start_date": now().astimezone(ZoneInfo("America/Vancouver")).date().isoformat(),
                "timezone": "America/Vancouver",
                "target": 70,
                "academy_unit": 0,
                "daily_minutes": 120,
            },
        )
        db.add(row)
        db.flush()
    return row


def import_course(db):
    course = json.loads((ROOT / "content/course-v1.json").read_text())
    for day in course["days"]:
        for data in day["activities"]:
            validated = Exercise.model_validate(data).model_dump()
            # Shared canonical phrase identity is consistent in every context.
            if validated["item"].startswith("fr:expression:"):
                validated["item"] = item_id(validated["reference"])
            version = (
                course["version"]
                + ":"
                + hashlib.sha256(
                    json.dumps(validated, sort_keys=True, ensure_ascii=False).encode()
                ).hexdigest()[:12]
            )
            exists = db.scalar(
                select(Activity).where(
                    Activity.key == validated["key"], Activity.version == version
                )
            )
            if not exists:
                db.add(Activity(key=validated["key"], version=version, data=validated))
    settings(db)
    db.commit()
    return course


def add_activity(db, data, version):
    data = Exercise.model_validate(data).model_dump()
    obj = db.scalar(
        select(Activity).where(Activity.key == data["key"], Activity.version == version)
    )
    if obj:
        return obj
    obj = Activity(key=data["key"], version=version, data=data)
    db.add(obj)
    db.flush()
    return obj


def snapshot_session(db, key, title, source, activities, state=None):
    obj = db.scalar(select(StudySession).where(StudySession.key == key))
    if obj:
        return obj
    obj = StudySession(
        key=key,
        title=title,
        source=source,
        activity_ids=[a.id for a in activities],
        state=state or {},
    )
    db.add(obj)
    db.flush()
    return obj


def public_activity(obj, reveal=False):
    data = dict(obj.data)
    data.update(id=obj.id, version=obj.version)
    data["has_audio"] = bool(data.get("reference"))
    data.pop("accepted", None)
    data.pop("explanation", None)
    if data["skill"] == "listening":
        data["material"] = ""
    if not reveal and data["mode"] in ("choice", "exact"):
        data.pop("reference", None)
    return data


def grade(exercise, response, target, evidence):
    data = exercise.data
    if data.get("source", {}).get("continuous_topic"):
        from .continuous_topics import grade as grade_topic

        return grade_topic(data, response, target, evidence)
    if data.get("source", {}).get("number_practice"):
        from .number_practice import grade_number

        return grade_number(data, response, target, evidence)
    if data["mode"] in ("choice", "exact"):
        accepted = data["accepted"]
        actual = normalize(response)
        if data["item"].startswith("fr:cardinal:"):
            n = int(data["item"].split(":")[-1])
            accepted = accepted + [str(n), number(n)]
        score = 100 if actual in {normalize(x) for x in accepted} else 0
        return {
            "score": score,
            "passed": score >= target,
            "target": target,
            "method": "Respuesta admitida · v1",
            "meaning": "Acierto de esta pregunta; en el resumen se calcula aciertos/total.",
            "source": data["origin"],
            "feedback": data["explanation"],
            "accepted": accepted,
            "reference": data["reference"],
            "pronunciation": "Pendiente de validación acústica",
        }
    return {
        "score": None,
        "passed": None,
        "target": target,
        "method": "Rúbrica orientativa · v1",
        "source": "Criterios del curso",
        "feedback": data["explanation"],
        "reference": data["reference"],
        "criteria": [
            "Cumplimiento de la consigna",
            "Claridad del mensaje",
            "Vocabulario y forma",
            "Autonomía y transferencia",
        ],
        "pronunciation": "Pendiente de validación acústica",
    }


scheduler = Scheduler(
    enable_fuzzing=False,
    learning_steps=(timedelta(days=1),),
    relearning_steps=(timedelta(days=1),),
)


def update_memory(db, attempt, exercise):
    if attempt.result.get("score") is None:
        # Preserve separate production evidence without manufacturing a grade.
        key = exercise.data["item"] + "|" + exercise.data["skill"]
        from sqlalchemy import text

        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": key})
        mem = db.get(Memory, key)
        if mem is None:
            mem = Memory(
                id=key,
                item=exercise.data["item"],
                skill=exercise.data["skill"],
                label=exercise.data["reference"] or exercise.data["title"],
                card=Card().to_dict(),
                due=attempt.created + timedelta(days=1),
                evidence={
                    "success_dates": [],
                    "attempts": 0,
                    "errors": 0,
                    "autonomous": 0,
                    "activity_id": exercise.id,
                    "learned": False,
                    "evaluation": "Producción conservada; sin nota automática",
                },
            )
            db.add(mem)
        ev = dict(mem.evidence)
        ev["attempts"] += 1
        ev["last_attempt"] = attempt.id
        ev["activity_id"] = exercise.id
        mem.evidence = ev
        mem.due = attempt.created + timedelta(days=1)
        return
    e = attempt.evidence
    rating = (
        Rating.Again
        if attempt.result["score"] == 0
        else Rating.Hard
        if e["hint"]
        or e["transcript"]
        or e["plays"] > 1
        or (exercise.data["skill"] != "listening" and e["plays"] > 0)
        else Rating.Good
    )
    key = exercise.data["item"] + "|" + exercise.data["skill"]
    # PostgreSQL advisory lock also serializes the first review when no row exists yet.
    from sqlalchemy import text

    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": key})
    mem = db.get(Memory, key)
    when = attempt.created
    if mem is None:
        mem = Memory(
            id=key,
            item=exercise.data["item"],
            skill=exercise.data["skill"],
            label=exercise.data["reference"] or exercise.data["title"],
            card=Card().to_dict(),
            due=when,
            evidence={
                "success_dates": [],
                "attempts": 0,
                "errors": 0,
                "autonomous": 0,
                "activity_id": exercise.id,
                "learned": False,
            },
        )
        db.add(mem)
    card = Card.from_dict(mem.card)
    previous = card.last_review
    card, log = scheduler.review_card(
        card, rating, review_datetime=when, review_duration=e["seconds"] * 1000
    )
    ev = dict(mem.evidence)
    ev["attempts"] += 1
    if rating == Rating.Again:
        ev["errors"] += 1
        ev["learned"] = False
        ev["prior_success_dates"] = [
            *ev.get("prior_success_dates", []),
            *ev["success_dates"],
        ]
        ev["success_dates"] = []
    # Successes must be separated by a day, without aids, to count as retained.
    if rating == Rating.Good:
        ev["autonomous"] += 1
        dates = list(ev["success_dates"])
        if not dates or (when - datetime.fromisoformat(dates[-1])).total_seconds() >= 86400:
            dates.append(when.isoformat())
        ev["success_dates"] = dates
        ev["learned"] = len(dates) >= 2
    ev["activity_id"] = exercise.id
    ev["last_attempt"] = attempt.id
    mem.card = card.to_dict()
    mem.due = card.due
    mem.evidence = ev
    db.add(
        Review(
            memory_id=key,
            attempt_id=attempt.id,
            data={
                "rating": rating.name,
                "fsrs": log.to_dict(),
                "previous_review": previous.isoformat() if previous else None,
                "method": "fsrs-6.3.3; Again error, Hard con ayudas, Good autónomo; pasos de 1 día",
            },
        )
    )
