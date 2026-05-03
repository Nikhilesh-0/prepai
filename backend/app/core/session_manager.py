import asyncio
import copy
from typing import Optional
from datetime import datetime, timezone, timedelta


class SessionManager:
    def __init__(self):
        self._sessions: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    async def create_session(self, session_id: str, user_id: str, interview_profile: dict, question_plan: list) -> dict:
        await self._cleanup_stale_sessions()
        async with self._lock:
            session_state = {
                "session_id": session_id,
                "user_id": user_id,
                "interview_profile": interview_profile,
                "question_plan": question_plan,
                "conversation_history": [],
                "current_question_index": 0,
                "answer_evaluations": [],
                "follow_up_counts": {},
                "is_ai_speaking": False,
                "is_listening": False,
                "total_questions": len(question_plan),
                "filler_word_counts": [],
                "last_accessed_at": datetime.now(timezone.utc),
            }
            self._sessions[session_id] = session_state
            return copy.deepcopy(session_state)



    async def get_session(self, session_id: str) -> Optional[dict]:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session["last_accessed_at"] = datetime.now(timezone.utc)
                return copy.deepcopy(session)
            return None

    async def update_session(self, session_id: str, updates: dict) -> Optional[dict]:
        async with self._lock:
            if session_id not in self._sessions:
                return None
            self._sessions[session_id].update(updates)
            self._sessions[session_id]["last_accessed_at"] = datetime.now(timezone.utc)
            return copy.deepcopy(self._sessions[session_id])

    async def delete_session(self, session_id: str) -> bool:
        async with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                return True
            return False

    async def add_conversation_turn(self, session_id: str, role: str, content: str) -> None:
        async with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id]["conversation_history"].append({
                    "role": role,
                    "content": content,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                self._sessions[session_id]["last_accessed_at"] = datetime.now(timezone.utc)

    async def increment_question_index(self, session_id: str) -> int:
        async with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id]["current_question_index"] += 1
                self._sessions[session_id]["last_accessed_at"] = datetime.now(timezone.utc)
                return self._sessions[session_id]["current_question_index"]
            return 0

    async def _cleanup_stale_sessions(self) -> None:
        """Evicts sessions that haven't been accessed in over 2 hours to prevent memory leaks."""
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=2)
        async with self._lock:
            stale_ids = [
                sid for sid, session in self._sessions.items()
                if session.get("last_accessed_at", datetime.min.replace(tzinfo=timezone.utc)) < cutoff_time
            ]
            for sid in stale_ids:
                del self._sessions[sid]


session_manager = SessionManager()
