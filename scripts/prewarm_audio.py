"""Prepare all reference audios through the same persistent job queue used by the UI."""

import sys

sys.path.insert(0, "backend")
from app.db import Activity, Job, Session
from app.jobs import enqueue
from sqlalchemy import select

with Session() as db:
    for a in db.scalars(select(Activity)):
        if a.data["reference"] and not db.scalar(
            select(Job).where(
                Job.kind == "audio",
                Job.payload["activity_id"].astext == a.id,
                Job.status.in_(["queued", "running", "completed"]),
            )
        ):
            enqueue(db, "audio", {"activity_id": a.id, "background": True})
    db.commit()
print("Audios añadidos a la cola local. Se preparan mientras la aplicación permanece abierta.")
