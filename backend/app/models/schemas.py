from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime


# ── Session models ──────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    user_id: str
    jd_text: str


class SessionResponse(BaseModel):
    session_id: str
    interview_profile: dict
    question_plan: list
    total_questions: int


# ── JD / Interview profile ──────────────────────────────────────────────────

class JDProfile(BaseModel):
    role_title: str
    level: str  # junior | mid | senior
    tech_stack: List[str]
    domain: str  # frontend | backend | fullstack | ml | data | devops | other
    soft_skill_signals: List[str]
    company_type: str  # startup | enterprise | unknown


class Question(BaseModel):
    question: str
    type: str  # hr | behavioral | technical
    follow_up_hint: str


# ── Interview turn ──────────────────────────────────────────────────────────

class InterviewTurn(BaseModel):
    role: str  # ai | user
    content: str
    timestamp: Optional[str] = None


# ── Scorecard ───────────────────────────────────────────────────────────────

class ScorecardResponse(BaseModel):
    id: Optional[str] = None
    session_id: str
    overall_score: int
    communication_score: int
    technical_score: int
    confidence_score: int
    filler_word_count: int
    strengths: List[str]
    improvements: List[str]
    summary: str
    detailed_feedback: Optional[dict] = None
    created_at: Optional[datetime] = None


# ── WebSocket message types ─────────────────────────────────────────────────

class WSMessageBase(BaseModel):
    type: str


class WSInit(WSMessageBase):
    type: str = "init"
    session_id: str


class WSAudioChunk(WSMessageBase):
    type: str = "audio_chunk"
    # binary data handled separately


class WSAudioEnd(WSMessageBase):
    type: str = "audio_end"


class WSTranscript(WSMessageBase):
    type: str = "transcript"
    text: str


class WSAITextChunk(WSMessageBase):
    type: str = "ai_text_chunk"
    text: str


class WSAudioResponseChunk(WSMessageBase):
    type: str = "audio_response_chunk"
    audio: str  # base64 encoded


class WSStateUpdate(WSMessageBase):
    type: str = "state_update"
    session_id: str
    current_question_index: int
    total_questions: int
    is_ai_speaking: bool
    is_listening: bool
    question_plan: list
    conversation_history: list
    answer_evaluations: list = Field(default_factory=list)
    follow_up_counts: dict = Field(default_factory=dict)


class WSInterviewComplete(WSMessageBase):
    type: str = "interview_complete"
    session_id: str
    scorecard: Optional[dict] = None


class WSError(WSMessageBase):
    type: str = "error"
    message: str


class WSSpeakingDone(WSMessageBase):
    type: str = "speaking_done"


class WSProcessingStart(WSMessageBase):
    type: str = "processing_start"
