from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Exercise(BaseModel):
    key: str
    title: str
    skill: Literal["reading", "listening", "writing", "speaking"]
    mode: Literal["choice", "exact", "open", "speak"]
    prompt: str
    material: str = ""
    reference: str = ""
    accepted: list[str] = []
    options: list[str] = []
    explanation: str = ""
    item: str
    meaning: str = ""
    variation: str = ""
    block: str = "Programa propio"
    minutes: int = Field(default=10, ge=1, le=120)
    origin: str = "Contenido original revisado"
    source: dict = {}

    @model_validator(mode="after")
    def coherent(self):
        if self.mode in ("choice", "exact") and not self.accepted:
            raise ValueError("Faltan respuestas admitidas")
        if self.mode == "choice" and any(a not in self.options for a in self.accepted):
            raise ValueError("La solución debe figurar entre las opciones")
        if self.skill == "listening" and not self.reference:
            raise ValueError("Falta referencia de audio")
        return self


class AttemptInput(BaseModel):
    id: str = Field(min_length=16, max_length=100)
    session_id: str
    activity_id: str
    response: str = Field(max_length=10000)
    media_id: str | None = None
    transcription_run_id: str | None = None
    seconds: int = Field(default=0, ge=0, le=14400)
    plays: int = Field(default=0, ge=0, le=1000)
    hint: bool = False
    transcript: bool = False
    handwritten: bool = False
    evaluation_id: str | None = None
    transcript_matches: bool = False
    number_recognition_check: bool = False


class Preferences(BaseModel):
    minutes: int = Field(default=15, ge=5, le=120)
    modalities: list[Literal["reading", "listening", "writing", "speaking"]] = [
        "reading",
        "listening",
        "writing",
        "speaking",
    ]
    level: Literal["A0", "A1", "A2"] = "A1"
    minimum: int = Field(default=1, ge=1, le=500)
    maximum: int = Field(default=100, ge=1, le=500)
    selection: Literal["mixed", "new", "difficult"] = "mixed"
    time_mode: Literal["daily", "extra"] = "daily"

    @model_validator(mode="after")
    def valid_range(self):
        if self.minimum > self.maximum or not self.modalities:
            raise ValueError("Revisa el rango y las modalidades")
        return self


class ProposalInput(BaseModel):
    continuous: bool = False
    entry_count: int = Field(default=12, ge=2, le=60)
    topic: str = Field(min_length=2, max_length=1500)
    parent_id: str | None = None
    instruction: str = Field(default="", max_length=1500)
    preferences: Preferences = Preferences()


class Phrase(BaseModel):
    french: str = Field(min_length=2, max_length=200)
    spanish: str = Field(min_length=2, max_length=250)
    variant: str = Field(min_length=2, max_length=200)


class GeneratedTopic(BaseModel):
    title: str
    objective: str
    phrases: list[Phrase] = Field(min_length=3, max_length=8)
    scenario: str
    tip: str


class ContentCheck(BaseModel):
    valid: bool
    issue: str
