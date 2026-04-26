from fastapi import APIRouter, HTTPException
from app.services import supabase_service

router = APIRouter(prefix="/api", tags=["scorecard"])


@router.get("/scorecard/{session_id}")
async def get_scorecard(session_id: str):
    """Fetch scorecard for a session."""
    try:
        scorecard = await supabase_service.get_scorecard(session_id)
        if not scorecard:
            raise HTTPException(status_code=404, detail="Scorecard not found")
        return scorecard
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch scorecard: {str(e)}")
