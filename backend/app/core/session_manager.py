import asyncio
from typing import Optional
from datetime import datetime


class SessionManager:
    def __init__(self):
        self._sessions: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    async def create_session(self, session_id: str, user_id: str, interview_profile: dict, question_plan: list) -> dict:
        async with self._lock:
            session_state = {
                "session_id": session_id,
                "user_id": user_id,
                "interview_profile": interview_profile,
                "question_plan": question_plan,
                "conversation_history": [],
                "current_question_index": 0,
                "response_scores": [],
                "is_ai_speaking": False,
                "is_listening": False,
                "total_questions": len(question_plan),
                "filler_word_counts": [],
            }
            self._sessions[session_id] = session_state
            return session_state



    async def get_session(self, session_id: str) -> Optional[dict]:
        async with self._lock:
            return self._sessions.get(session_id)

    async def update_session(self, session_id: str, updates: dict) -> Optional[dict]:
        async with self._lock:
            if session_id not in self._sessions:
                return None
            self._sessions[session_id].update(updates)
            return self._sessions[session_id]

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
                    "timestamp": datetime.utcnow().isoformat(),
                })

    async def increment_question_index(self, session_id: str) -> int:
        async with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id]["current_question_index"] += 1
                return self._sessions[session_id]["current_question_index"]
            return 0


session_manager = SessionManager()
