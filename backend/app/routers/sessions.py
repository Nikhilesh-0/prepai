from fastapi import APIRouter, HTTPException
from app.models.schemas import SessionCreate, SessionResponse
from app.services.interview_logic import parse_jd, generate_question_plan
from app.services import supabase_service
from app.core.session_manager import session_manager

router = APIRouter(prefix="/api", tags=["sessions"])


@router.post("/sessions", response_model=SessionResponse)
async def create_session(body: SessionCreate):
    """
    Parse the JD, generate a question plan, persist to Supabase,
    create in-memory session state, return session details.
    """
    try:
        # Parse the JD
        interview_profile = await parse_jd(body.jd_text)

        # Generate question plan
        question_plan = await generate_question_plan(interview_profile)

        # Save session to Supabase
        session_data = await supabase_service.save_session({
            "user_id": body.user_id,
            "jd_text": body.jd_text,
            "role_title": interview_profile.get("role_title"),
            "level": interview_profile.get("level"),
            "domain": interview_profile.get("domain"),
            "tech_stack": interview_profile.get("tech_stack", []),
        })

        session_id = session_data.get("id")
        if not session_id:
            raise HTTPException(status_code=500, detail="Failed to create session in database")

        # Save questions to Supabase
        for i, question in enumerate(question_plan):
            await supabase_service.save_question({
                "session_id": session_id,
                "question_text": question["question"],
                "question_type": question["type"],
                "order_index": i,
                "follow_up_hint": question.get("follow_up_hint"),
            })

        # Create in-memory session state
        await session_manager.create_session(
            session_id=session_id,
            user_id=body.user_id,
            interview_profile=interview_profile,
            question_plan=question_plan,
        )

        return SessionResponse(
            session_id=session_id,
            interview_profile=interview_profile,
            question_plan=question_plan,
            total_questions=len(question_plan),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")


@router.get("/sessions/{user_id}")
async def get_sessions(user_id: str):
    """Return all sessions for a user with scorecard data joined."""
    try:
        sessions = await supabase_service.get_user_sessions(user_id)
        return {"sessions": sessions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch sessions: {str(e)}")
