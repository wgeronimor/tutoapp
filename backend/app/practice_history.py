"""Practice listings; organization, participation and accuracy stay distinct."""

from sqlalchemy import Integer, case, cast, func, literal, select, union_all

from .db import (
    Activity,
    Attempt,
    PracticeOrganization,
    Proposal,
    RemovedProposal,
    Settings,
    StudySession,
)
from .number_practice import MODES, accuracy_counts
from .practice_organization import PIN_LIMIT, pins


def _summaries(db, session_ids):
    if not session_ids:
        return {}, {}
    score = cast(Attempt.result["score"].astext, Integer)
    rows = db.execute(
        select(
            Attempt.session_id,
            func.count(Attempt.id),
            func.count(func.distinct(Attempt.activity_id)),
            func.count(score),
            func.sum(case((score == 100, 1), else_=0)),
            func.coalesce(func.sum(cast(Attempt.evidence["seconds"].astext, Integer)), 0),
            func.max(Attempt.created),
            func.count(func.distinct(Activity.data["item"].astext)),
        )
        .select_from(Attempt)
        .join(Activity, Attempt.activity_id == Activity.id)
        .where(Attempt.session_id.in_(session_ids))
        .group_by(Attempt.session_id)
    ).all()
    summaries = {
        r[0]: {
            "attempts": r[1],
            "rounds": r[2],
            "accuracy": accuracy_counts(r[1], r[3], r[4]),
            "seconds": r[5],
            "last_activity": r[6].isoformat(),
            "numbers_seen": r[7],
        }
        for r in rows
    }
    category = Activity.data["source"]["number_mode"].astext
    types = {}
    for session_id, mode, rounds in db.execute(
        select(Attempt.session_id, category, func.count(func.distinct(Attempt.activity_id)))
        .select_from(Attempt)
        .join(Activity, Attempt.activity_id == Activity.id)
        .where(Attempt.session_id.in_(session_ids))
        .group_by(Attempt.session_id, category)
    ):
        types.setdefault(session_id, {})[mode] = rounds
    return summaries, types


def listing(db, kind, offset=0, limit=20, show_inactive=False):
    from .continuous_topics import modes as session_modes

    if kind == "fixed":
        query = (
            select(Proposal)
            .outerjoin(PracticeOrganization, Proposal.session_id == PracticeOrganization.session_id)
            .where(
                func.coalesce(Proposal.data["kind"].astext, "fixed") != "continuous",
                ~Proposal.id.in_(select(RemovedProposal.proposal_id)),
            )
        )
        if not show_inactive:
            query = query.where(func.coalesce(PracticeOrganization.hidden, False).is_(False))
        total = db.scalar(select(func.count()).select_from(query.subquery()))
        proposals = list(
            db.scalars(
                query.order_by(
                    PracticeOrganization.pin_order.asc().nulls_last(),
                    Proposal.created.desc(),
                    Proposal.id.desc(),
                )
                .offset(offset)
                .limit(limit)
            )
        )
        ids = [p.session_id for p in proposals if p.session_id]
        sessions = (
            {s.id: s for s in db.scalars(select(StudySession).where(StudySession.id.in_(ids)))}
            if ids
            else {}
        )
        entries = [(p, sessions.get(p.session_id)) for p in proposals]
    else:
        all_entries = union_all(
            select(
                StudySession.id.label("id"),
                StudySession.created.label("created"),
                literal("session").label("entity"),
                PracticeOrganization.pin_order.label("pin_order"),
                func.coalesce(PracticeOrganization.hidden, False).label("hidden"),
            )
            .outerjoin(PracticeOrganization, StudySession.id == PracticeOrganization.session_id)
            .where(StudySession.source.in_(["numbers-continuous", "topics-continuous"])),
            select(
                Proposal.id,
                Proposal.created,
                literal("proposal"),
                cast(literal(None), Integer),
                literal(False),
            ).where(
                Proposal.data["kind"].astext == "continuous",
                Proposal.session_id.is_(None),
                ~Proposal.id.in_(select(RemovedProposal.proposal_id)),
            ),
        ).subquery()
        query = select(all_entries)
        if not show_inactive:
            query = query.where(all_entries.c.hidden.is_(False))
        total = db.scalar(select(func.count()).select_from(query.subquery()))
        rows = (
            db.execute(
                query.order_by(
                    all_entries.c.pin_order.asc().nulls_last(),
                    all_entries.c.created.desc(),
                    all_entries.c.id.desc(),
                )
                .offset(offset)
                .limit(limit)
            )
            .mappings()
            .all()
        )
        ids = [r["id"] for r in rows if r["entity"] == "session"]
        sessions = (
            {s.id: s for s in db.scalars(select(StudySession).where(StudySession.id.in_(ids)))}
            if ids
            else {}
        )
        pids = [r["id"] for r in rows if r["entity"] == "proposal"] + [
            s.state["proposal_id"] for s in sessions.values() if s.state.get("proposal_id")
        ]
        proposals = (
            {p.id: p for p in db.scalars(select(Proposal).where(Proposal.id.in_(pids)))}
            if pids
            else {}
        )
        entries = [
            (proposals.get(r["id"]), None)
            if r["entity"] == "proposal"
            else (proposals.get(sessions[r["id"]].state.get("proposal_id")), sessions[r["id"]])
            for r in rows
        ]
    summaries, types = _summaries(db, ids)
    organization = (
        {
            o.session_id: o
            for o in db.scalars(
                select(PracticeOrganization).where(PracticeOrganization.session_id.in_(ids))
            )
        }
        if ids
        else {}
    )
    result = []
    for proposal, session in entries:
        org = organization.get(session.id) if session else None
        stats = summaries.get(
            session.id if session else None,
            {
                "attempts": 0,
                "rounds": 0,
                "accuracy": accuracy_counts(0, 0, 0),
                "seconds": 0,
                "last_activity": None,
                "numbers_seen": 0,
            },
        )
        continuous = kind == "continuous"
        topic = bool(
            (session and session.source == "topics-continuous")
            or (proposal and proposal.data.get("kind") == "continuous")
        )
        available = (
            session_modes(session)
            if session
            else session_modes(modalities=proposal.preferences["modalities"])
            if continuous
            else MODES
        )
        total_activities = (
            len(session.activity_ids) if session else len(proposal.data.get("activities", []))
        )
        completion = round(100 * stats["rounds"] / total_activities) if total_activities else 0
        mode_counts = types.get(session.id, {}) if continuous and session else {}
        practiced = sum(mode_counts.get(m["id"], 0) > 0 for m in available)
        range_size = (
            (
                session.state["maximum"] - session.state["minimum"] + 1
                if session
                else len(proposal.data["entries"])
            )
            if continuous
            else None
        )
        result.append(
            {
                "id": ("continuous:" + (session.id if session else "proposal:" + proposal.id))
                if continuous
                else "fixed:" + proposal.id,
                "kind": kind,
                "hidden": bool(org and org.hidden),
                "pin_order": org.pin_order if org else None,
                "title": session.title if session else proposal.data.get("title", proposal.topic),
                "created": (
                    session.created if continuous and session else proposal.created
                ).isoformat(),
                "started": session.created.isoformat() if session else None,
                **stats,
                "status": "prepared"
                if not session
                else "continuous"
                if continuous
                else "not_started"
                if not stats["rounds"]
                else "completed"
                if stats["rounds"] >= total_activities
                else "in_progress",
                "total_activities": None if continuous else total_activities,
                "completed_activities": None if continuous else stats["rounds"],
                "completion_percent": None if continuous else completion,
                "types_practiced": practiced if continuous else None,
                "types_total": len(available) if continuous else None,
                "types_percent": round(100 * practiced / len(available)) if continuous else None,
                "types": [
                    {
                        **m,
                        "rounds": mode_counts.get(m["id"], 0),
                        "url": f"/numbers/{session.id}?mode={m['id']}",
                    }
                    for m in available
                ]
                if continuous and session
                else [],
                "range_size": range_size,
                "range_percent": round(100 * stats["numbers_seen"] / range_size)
                if continuous
                else None,
                "coverage_label": "expresiones" if topic else "números",
                "level": proposal.data.get("level") if proposal else None,
                "planned_minutes": proposal.preferences.get("minutes", proposal.data.get("minutes"))
                if proposal and not continuous
                else None,
                "proposal_id": proposal.id if proposal else None,
                "session_id": session.id if session else None,
                "practice_url": (
                    f"/numbers/{session.id}" if continuous else f"/session/{session.id}"
                )
                if session
                else None,
                "history_url": f"/history?session={session.id}" if session else None,
            }
        )
    config = db.get(Settings, 1)
    return {
        "items": result,
        "total": total,
        "offset": offset,
        "limit": limit,
        "pins": pins(db),
        "pin_limit": PIN_LIMIT,
        "timezone": config.data.get("timezone", "America/Vancouver")
        if config
        else "America/Vancouver",
    }
