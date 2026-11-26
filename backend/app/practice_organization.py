"""Mutable personal organization, separate from saved learning artifacts."""

from fastapi import HTTPException
from sqlalchemy import select, text

from .db import PracticeOrganization, Proposal, RemovedProposal, StudySession

PIN_LIMIT = 10


def active_proposal(db, id, *, lock=False):
    query = select(Proposal).where(Proposal.id == id)
    if lock:
        query = query.with_for_update()
    proposal = db.scalar(query)
    if not proposal or db.get(RemovedProposal, id):
        raise HTTPException(404, "La propuesta no está disponible o fue eliminada")
    return proposal


def remove_proposal(db, id):
    # Same row lock as start: a draft cannot be removed while it becomes a practice.
    proposal = db.scalar(select(Proposal).where(Proposal.id == id).with_for_update())
    if not proposal:
        raise HTTPException(404, "Propuesta no encontrada")
    if proposal.session_id:
        raise HTTPException(
            409, "La práctica ya fue iniciada y no puede eliminarse. Puedes ocultarla."
        )
    if not db.get(RemovedProposal, id):
        db.add(RemovedProposal(proposal_id=id))
    db.commit()
    return {"removed": True, "proposal_id": id}


def pins(db):
    return [
        {
            "session_id": session.id,
            "title": session.title,
            "position": org.pin_order,
            "kind": "continuous" if session.source.endswith("-continuous") else "fixed",
            "url": f"/numbers/{session.id}"
            if session.source.endswith("-continuous")
            else f"/session/{session.id}",
        }
        for org, session in db.execute(
            select(PracticeOrganization, StudySession)
            .join(StudySession, StudySession.id == PracticeOrganization.session_id)
            .where(PracticeOrganization.pin_order.is_not(None))
            .order_by(PracticeOrganization.pin_order)
        )
    ]


def organize(db, id, action):
    # Global transaction lock makes the 10-pin cap and order safe across tabs/requests.
    db.execute(text("SELECT pg_advisory_xact_lock(87650033)"))
    session = db.get(StudySession, id)
    if not session or (
        session.source not in ("numbers-continuous", "topics-continuous")
        and not db.scalar(select(Proposal.id).where(Proposal.session_id == id).limit(1))
    ):
        raise HTTPException(404, "Solo puedes organizar prácticas que ya fueron iniciadas")
    org = db.get(PracticeOrganization, id)
    if not org:
        org = PracticeOrganization(session_id=id, hidden=False)
        db.add(org)
    ordered = list(
        db.scalars(
            select(PracticeOrganization)
            .where(PracticeOrganization.pin_order.is_not(None))
            .order_by(PracticeOrganization.pin_order)
        )
    )
    if action == "pin":
        if org.hidden:
            raise HTTPException(409, "Reactiva la práctica antes de fijarla")
        if org not in ordered:
            if len(ordered) >= PIN_LIMIT:
                raise HTTPException(
                    409, "Ya tienes 10 pines. Quita uno antes de fijar otra práctica."
                )
            ordered.append(org)
    elif action in ("unpin", "hide"):
        ordered = [p for p in ordered if p.session_id != id]
        org.pin_order = None
        if action == "hide":
            org.hidden = True
    elif action == "show":
        org.hidden = False
    elif action in ("up", "down"):
        if org not in ordered:
            raise HTTPException(409, "Fija la práctica antes de ordenar su pin")
        index = ordered.index(org)
        target = index + (-1 if action == "up" else 1)
        if 0 <= target < len(ordered):
            ordered[index], ordered[target] = ordered[target], ordered[index]
    for position, pin in enumerate(ordered, 1):
        pin.pin_order = position
    db.commit()
    return {"session_id": id, "hidden": org.hidden, "pin_order": org.pin_order, "pins": pins(db)}
