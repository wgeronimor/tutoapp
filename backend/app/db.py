from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .config import config


def now():
    return datetime.now(timezone.utc)


def uid():
    return str(uuid4())


engine = create_engine(config.database_url, pool_pre_ping=True)
Session = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Settings(Base):
    __tablename__ = "settings"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    data: Mapped[dict] = mapped_column(JSONB)


class Activity(Base):
    __tablename__ = "activities"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    key: Mapped[str] = mapped_column(String)
    version: Mapped[str] = mapped_column(String)
    data: Mapped[dict] = mapped_column(JSONB)
    __table_args__ = (UniqueConstraint("key", "version"),)


class StudySession(Base):
    __tablename__ = "study_sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    key: Mapped[str] = mapped_column(String, unique=True)
    title: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String)
    activity_ids: Mapped[list] = mapped_column(JSONB)
    state: Mapped[dict] = mapped_column(JSONB, default=dict)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Media(Base):
    __tablename__ = "media"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    path: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)
    info: Mapped[dict] = mapped_column(JSONB, default=dict)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Attempt(Base):
    __tablename__ = "attempts"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("study_sessions.id"))
    activity_id: Mapped[str] = mapped_column(ForeignKey("activities.id"))
    media_id: Mapped[str | None] = mapped_column(ForeignKey("media.id"), nullable=True)
    response: Mapped[str] = mapped_column(Text)
    evidence: Mapped[dict] = mapped_column(JSONB)
    result: Mapped[dict] = mapped_column(JSONB)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Memory(Base):
    __tablename__ = "memory"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    item: Mapped[str] = mapped_column(String)
    skill: Mapped[str] = mapped_column(String)
    label: Mapped[str] = mapped_column(String)
    card: Mapped[dict] = mapped_column(JSONB)
    due: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    evidence: Mapped[dict] = mapped_column(JSONB)


class Review(Base):
    __tablename__ = "reviews"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    memory_id: Mapped[str] = mapped_column(ForeignKey("memory.id"))
    attempt_id: Mapped[str] = mapped_column(ForeignKey("attempts.id"), unique=True)
    data: Mapped[dict] = mapped_column(JSONB)


class Proposal(Base):
    __tablename__ = "proposals"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("proposals.id"), nullable=True)
    topic: Mapped[str] = mapped_column(Text)
    preferences: Mapped[dict] = mapped_column(JSONB)
    instruction: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict] = mapped_column(JSONB)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("study_sessions.id"), nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PracticeOrganization(Base):
    __tablename__ = "practice_organization"
    session_id: Mapped[str] = mapped_column(ForeignKey("study_sessions.id"), primary_key=True)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    pin_order: Mapped[int | None] = mapped_column(nullable=True)


class RemovedProposal(Base):
    """Permanent draft removal; keep its internal regeneration lineage intact."""

    __tablename__ = "removed_proposals"
    proposal_id: Mapped[str] = mapped_column(ForeignKey("proposals.id"), primary_key=True)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ClassPlan(Base):
    __tablename__ = "classes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued")
    payload: Mapped[dict] = mapped_column(JSONB)
    result: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Annotation(Base):
    __tablename__ = "annotations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    attempt_id: Mapped[str] = mapped_column(ForeignKey("attempts.id"))
    text: Mapped[str] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(String)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
