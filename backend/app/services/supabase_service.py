from datetime import datetime, timezone
from typing import Optional
from supabase import create_client, Client
from app.core.config import settings

# Service role client — bypasses RLS
_client: Optional[Client] = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client


async def save_session(session_data: dict) -> dict:
    """Insert a new session into the sessions table, return the created row."""
    import uuid as _uuid
    client = get_client()

    # Generate the UUID ourselves so we can fetch it back reliably
    session_id = str(_uuid.uuid4())

    client.table("sessions").insert({
        "id": session_id,
        "user_id": session_data["user_id"],
        "jd_text": session_data["jd_text"],
        "role_title": session_data.get("role_title"),
        "level": session_data.get("level"),
        "domain": session_data.get("domain"),
        "tech_stack": session_data.get("tech_stack", []),
        "status": "in_progress",
    }).execute()

    # Fetch the row back using the known id
    fetch = client.table("sessions").select("*").eq("id", session_id).execute()
    if not fetch.data:
        raise RuntimeError(f"Session insert succeeded but fetch returned nothing (id={session_id})")
    return fetch.data[0]


async def save_question(question_data: dict) -> dict:
    """Insert a question record."""
    client = get_client()
    client.table("questions").insert({
        "session_id": question_data["session_id"],
        "question_text": question_data["question_text"],
        "question_type": question_data["question_type"],
        "order_index": question_data["order_index"],
        "follow_up_hint": question_data.get("follow_up_hint"),
    }).execute()
    return {}


async def save_response(response_data: dict) -> dict:
    """Insert a user response record."""
    client = get_client()
    client.table("responses").insert({
        "session_id": response_data["session_id"],
        "question_id": response_data["question_id"],
        "transcript": response_data["transcript"],
        "duration_seconds": response_data.get("duration_seconds"),
    }).execute()
    return {}


async def save_scorecard(scorecard_data: dict) -> dict:
    """Insert a scorecard record."""
    client = get_client()
    client.table("scorecards").insert({
        "session_id": scorecard_data["session_id"],
        "overall_score": scorecard_data.get("overall_score", 0),
        "communication_score": scorecard_data.get("communication_score", 0),
        "technical_score": scorecard_data.get("technical_score", 0),
        "confidence_score": scorecard_data.get("confidence_score", 0),
        "filler_word_count": scorecard_data.get("filler_word_count", 0),
        "strengths": scorecard_data.get("strengths", []),
        "improvements": scorecard_data.get("improvements", []),
        "summary": scorecard_data.get("summary", ""),
        "detailed_feedback": scorecard_data.get("detailed_feedback", {}),
    }).execute()
    return {}


async def update_session_status(
    session_id: str,
    status: str,
    completed_at: Optional[datetime] = None,
) -> dict:
    """Update the status of a session."""
    client = get_client()
    update_data = {"status": status}
    if completed_at:
        update_data["completed_at"] = completed_at.isoformat()
    response = client.table("sessions").update(update_data).eq("id", session_id).execute()
    return response.data[0] if response.data else {}


async def get_user_sessions(user_id: str) -> list:
    """Return all sessions for a user with scorecard scores joined."""
    client = get_client()
    response = (
        client.table("sessions")
        .select("*, scorecards(overall_score, communication_score, technical_score, confidence_score)")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return response.data or []


async def get_scorecard(session_id: str) -> Optional[dict]:
    """Return the scorecard for a session."""
    client = get_client()
    response = (
        client.table("scorecards")
        .select("*")
        .eq("session_id", session_id)
        .single()
        .execute()
    )
    return response.data


async def get_question_ids(session_id: str) -> list:
    """Return question IDs for a session in order."""
    client = get_client()
    response = (
        client.table("questions")
        .select("id, order_index")
        .eq("session_id", session_id)
        .order("order_index")
        .execute()
    )
    return response.data or []