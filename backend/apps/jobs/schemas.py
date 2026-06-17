"""Pydantic v2 schemas for AI job evaluation and extraction results.

These schemas define the exact structure of OpenAI structured-output responses.
Every field name, type, optionality, enum value, and constraint maps directly to the
TypeScript Zod definitions in worker/src/schemas.ts to ensure parity.
"""

from typing import Optional, List, Literal
from enum import Enum

from pydantic import BaseModel, Field


class DatePrecision(str, Enum):
    """Precision level for timeline event dates."""
    day = "day"
    month = "month"
    year = "year"


class KV(BaseModel):
    """Generic key-value pair."""
    key: str
    value: str


class TimelineEvent(BaseModel):
    """Timeline event extracted from health documents."""
    occurred_at: Optional[str] = None
    date_precision: Optional[DatePrecision] = None
    title: str
    event_type: Optional[str] = None
    category: Optional[str] = None
    source: Optional[str] = None
    summary: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    data_kv: List[KV] = Field(default_factory=list)


class Allergy(BaseModel):
    """Allergy information."""
    substance: str
    reaction: Optional[str] = None
    severity: Literal["low", "medium", "high", "unknown"]
    type: Literal["allergy", "intolerance"] = "allergy"
    source_quote: Optional[str] = None
    confidence_0_to_1: Optional[float] = Field(default=None, ge=0, le=1)


class Medication(BaseModel):
    """Current medication."""
    name: str
    dose: Optional[str] = None
    frequency: Optional[str] = None
    notes: Optional[str] = None
    source_quote: Optional[str] = None
    confidence_0_to_1: Optional[float] = Field(default=None, ge=0, le=1)


class Condition(BaseModel):
    """Medical condition."""
    name: str
    status: Optional[str] = None
    notes: Optional[str] = None
    source_quote: Optional[str] = None
    confidence_0_to_1: Optional[float] = Field(default=None, ge=0, le=1)


class SurgeryProcedure(BaseModel):
    """Surgery or procedure record."""
    name: str
    when: Optional[str] = None
    notes: Optional[str] = None
    source_quote: Optional[str] = None
    confidence_0_to_1: Optional[float] = Field(default=None, ge=0, le=1)


class LabVital(BaseModel):
    """Laboratory test or vital sign."""
    name: str
    value: Optional[str] = None
    when: Optional[str] = None


class KeyFacts(BaseModel):
    """Key health facts extracted from a document."""
    blood_type: Optional[str] = None
    allergies: List[Allergy] = Field(default_factory=list)
    medications: List[Medication] = Field(default_factory=list)
    conditions: List[Condition] = Field(default_factory=list)
    surgeries_procedures: List[SurgeryProcedure] = Field(default_factory=list)
    implants_devices: List[str] = Field(default_factory=list)
    key_labs_vitals: List[LabVital] = Field(default_factory=list)
    extra_notes: List[str] = Field(default_factory=list)


class DocumentFacts(BaseModel):
    """Complete facts extracted from a health document."""
    document_id: str
    title: Optional[str] = None
    key_facts: KeyFacts
    timeline_events: List[TimelineEvent] = Field(default_factory=list)
    confidence_0_to_1: float = Field(..., ge=0, le=1)


class RecommendationCategory(str, Enum):
    """Recommendation category."""
    follow_up = "follow_up"
    missing_info = "missing_info"
    monitoring = "monitoring"
    lifestyle = "lifestyle"
    safety = "safety"
    medication = "medication"
    preventive = "preventive"


class RecommendationPriority(str, Enum):
    """Recommendation priority level."""
    high = "high"
    medium = "medium"
    low = "low"


class Recommendation(BaseModel):
    """Clinical recommendation for patient."""
    id: str
    title: str
    body: str
    details: Optional[str] = None
    full_title: Optional[str] = None
    full_body: Optional[str] = None
    category: RecommendationCategory
    priority: RecommendationPriority
    source: str
    action_label: Optional[str] = None
    action_type: Optional[str] = None


class EmergencyContact(BaseModel):
    """Emergency contact information."""
    name: Optional[str] = None
    phone: Optional[str] = None


class ThreeByFiveCard(BaseModel):
    """Emergency reference card (3x5) with critical health info."""
    blood_type: Optional[str] = None
    major_conditions: List[str] = Field(default_factory=list)
    major_surgeries: List[str] = Field(default_factory=list)
    current_meds: List[str] = Field(default_factory=list)
    allergies: List[str] = Field(default_factory=list)
    implants_devices: List[str] = Field(default_factory=list)
    anticoagulants: List[str] = Field(default_factory=list)
    anesthesia_notes: List[str] = Field(default_factory=list)
    emergency_contact: EmergencyContact
    one_line_summary: str


class HealthEvaluation(BaseModel):
    """Complete health evaluation result from AI."""
    score_0_to_100: int = Field(..., ge=0, le=100)
    score_label: str
    overview: str
    highlights: List[str]
    risk_flags: List[str]
    missing_info: List[str]
    suggested_next_steps: List[str]
    recommendations: List[Recommendation]
    three_by_five_card: ThreeByFiveCard
    full_summary_markdown: str
    disclaimer: str


class QASource(BaseModel):
    """A cited source for a QA answer."""
    title: str
    type: str  # "document" | "timeline" | "health_summary"
    detail: Optional[str] = None


class QAAnswer(BaseModel):
    """Answer to a patient health question, with sources."""
    answer: str
    sources: List[QASource] = Field(default_factory=list)
