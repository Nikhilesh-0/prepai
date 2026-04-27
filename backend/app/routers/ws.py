import json
import base64
import asyncio
import traceback
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.session_manager import session_manager
from app.services.groq_service import transcribe_audio, stream_interviewer_response, generate_scorecard
from app.services.cartesia_service import stream_tts
from app.services.interview_logic import count_filler_words, split_into_tts_chunks
from app.services import supabase_service

router = APIRouter(tags=["websocket"])


def build_state_update(session: dict) -> dict:
    return {
        "type": "state_update",
        "session_id": session["session_id"],
        "current_question_index": session["current_question_index"],
        "total_questions": session["total_questions"],
        "is_ai_speaking": session["is_ai_speaking"],
        "is_listening": session["is_listening"],
        "question_plan": session["question_plan"],
        "conversation_history": session["conversation_history"],
    }


async def send_json(ws: WebSocket, data: dict):
    try:
        await ws.send_text(json.dumps(data))
    except Exception:
        pass


async def tts_for_sentence(sentence: str) -> bytes:
    """
    Run TTS for one sentence. Returns bytes or empty bytes on failure.
    Never raises — callers must not be interrupted by TTS errors.
    """
    try:
        audio = b""
        async for chunk in stream_tts(sentence):
            audio += chunk
        return audio
    except Exception as e:
        print(f"[TTS ERROR] sentence='{sentence[:40]}...' err={e}")
        traceback.print_exc()
        return b""


async def handle_ai_turn(ws: WebSocket, session_id: str):
    """
    Run one full AI turn. Always sends speaking_done at the end,
    even if TTS fails — that way the frontend never gets stuck.
    """
    session = await session_manager.get_session(session_id)
    if not session:
        await send_json(ws, {"type": "error", "message": "Session not found"})
        return

    await session_manager.update_session(session_id, {"is_ai_speaking": True, "is_listening": False})
    await send_json(ws, build_state_update(await session_manager.get_session(session_id)))

    full_response = ""
    sentence_buffer = ""
    tts_failed = False

    try:
        async for text_chunk in stream_interviewer_response(
            conversation_history=session["conversation_history"],
            interview_profile=session["interview_profile"],
            question_plan=session["question_plan"],
            current_index=session["current_question_index"],
        ):
            full_response += text_chunk
            sentence_buffer += text_chunk

            # Stream text to frontend immediately for typewriter display
            await send_json(ws, {"type": "ai_text_chunk", "text": text_chunk})

            # Send complete sentences to TTS as they form
            sentences = split_into_tts_chunks(sentence_buffer)
            if len(sentences) > 1:
                for sentence in sentences[:-1]:
                    s = sentence.strip()
                    if s:
                        audio = await tts_for_sentence(s)
                        if audio:
                            await send_json(ws, {
                                "type": "audio_response_chunk",
                                "audio": base64.b64encode(audio).decode("utf-8"),
                            })
                        else:
                            tts_failed = True
                sentence_buffer = sentences[-1]

        # Flush last sentence
        if sentence_buffer.strip():
            audio = await tts_for_sentence(sentence_buffer.strip())
            if audio:
                await send_json(ws, {
                    "type": "audio_response_chunk",
                    "audio": base64.b64encode(audio).decode("utf-8"),
                })
            else:
                tts_failed = True

    except Exception as e:
        # LLM streaming failed — still need to unblock the frontend
        print(f"[LLM ERROR] {e}")
        traceback.print_exc()
        full_response = full_response or "I encountered an issue. Let's continue — please go ahead."
        await send_json(ws, {"type": "error", "message": f"LLM error: {str(e)}"})

    # Save whatever response we got
    if full_response:
        await session_manager.add_conversation_turn(session_id, "ai", full_response)

    if tts_failed:
        await send_json(ws, {"type": "error", "message": "Audio unavailable — reading text only"})

    # ALWAYS send speaking_done so the frontend can transition to listening
    await send_json(ws, {"type": "speaking_done"})

    await session_manager.update_session(session_id, {
        "is_ai_speaking": False,
        "is_listening": True,
    })
    await send_json(ws, build_state_update(await session_manager.get_session(session_id)))


@router.websocket("/ws/interview/{session_id}")
async def interview_websocket(ws: WebSocket, session_id: str):
    await ws.accept()

    audio_buffer = bytearray()

    session = await session_manager.get_session(session_id)
    if not session:
        await send_json(ws, {"type": "error", "message": "Session not found. Please create a new session."})
        await ws.close()
        return

    await send_json(ws, build_state_update(session))

    try:
        while True:
            try:
                message = await ws.receive()
            except WebSocketDisconnect:
                return

            if message["type"] == "websocket.disconnect":
                return

            if "bytes" in message and message["bytes"] is not None:
                audio_buffer.extend(message["bytes"])
                continue

            if "text" not in message or not message["text"]:
                continue

            try:
                data = json.loads(message["text"])
            except json.JSONDecodeError:
                await send_json(ws, {"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = data.get("type")

            if msg_type == "client_ready":
                await handle_ai_turn(ws, session_id)
                continue

            if msg_type == "ping":
                await send_json(ws, {"type": "pong"})
                continue

            if msg_type == "audio_end":
                if len(audio_buffer) == 0:
                    # Empty buffer — just restart listening without error
                    print("[WS] audio_end received but buffer is empty — re-signaling listen")
                    await session_manager.update_session(session_id, {"is_listening": True})
                    await send_json(ws, {"type": "speaking_done"})
                    await send_json(ws, build_state_update(await session_manager.get_session(session_id)))
                    continue

                await session_manager.update_session(session_id, {"is_listening": False})
                await send_json(ws, {"type": "processing_start"})

                try:
                    audio_bytes = bytes(audio_buffer)
                    audio_buffer.clear()

                    transcript = await transcribe_audio(audio_bytes, "audio/webm")

                    if not transcript or not transcript.strip():
                        # No speech detected — restart listening silently
                        print("[WS] Empty transcript — restarting listen")
                        await session_manager.update_session(session_id, {"is_listening": True})
                        await send_json(ws, {"type": "speaking_done"})
                        await send_json(ws, build_state_update(await session_manager.get_session(session_id)))
                        continue

                    await send_json(ws, {"type": "transcript", "text": transcript})

                    filler_count = count_filler_words(transcript)
                    await session_manager.add_conversation_turn(session_id, "user", transcript)

                    current_session = await session_manager.get_session(session_id)
                    filler_counts = current_session.get("filler_word_counts", [])
                    filler_counts.append(filler_count)
                    await session_manager.update_session(session_id, {"filler_word_counts": filler_counts})

                    # Persist to Supabase (fire and forget)
                    try:
                        question_ids = await supabase_service.get_question_ids(session_id)
                        current_idx = current_session["current_question_index"]
                        if question_ids and current_idx < len(question_ids):
                            await supabase_service.save_response({
                                "session_id": session_id,
                                "question_id": question_ids[current_idx]["id"],
                                "transcript": transcript,
                            })
                    except Exception:
                        pass

                    current_session = await session_manager.get_session(session_id)
                    old_index = current_session["current_question_index"]
                    total = current_session["total_questions"]
                    await session_manager.increment_question_index(session_id)

                    is_last = old_index >= total - 1

                    await handle_ai_turn(ws, session_id)

                    if is_last:
                        await send_json(ws, {"type": "processing_start"})
                        final_session = await session_manager.get_session(session_id)

                        scorecard_data = await generate_scorecard(
                            conversation_history=final_session["conversation_history"],
                            interview_profile=final_session["interview_profile"],
                            filler_counts=final_session.get("filler_word_counts", []),
                        )
                        scorecard_data["session_id"] = session_id

                        try:
                            await supabase_service.save_scorecard(scorecard_data)
                            await supabase_service.update_session_status(
                                session_id, "completed", datetime.now(timezone.utc)
                            )
                        except Exception:
                            pass

                        await send_json(ws, {
                            "type": "interview_complete",
                            "session_id": session_id,
                            "scorecard": scorecard_data,
                        })
                        break

                except Exception as e:
                    print(f"[WS] audio_end processing error: {e}")
                    traceback.print_exc()
                    audio_buffer.clear()
                    await send_json(ws, {"type": "error", "message": f"Processing failed: {str(e)}"})
                    # Restart listening so user isn't stuck
                    await session_manager.update_session(session_id, {"is_listening": True})
                    await send_json(ws, {"type": "speaking_done"})
                    await send_json(ws, build_state_update(await session_manager.get_session(session_id)))

            elif msg_type == "end_interview":
                try:
                    await supabase_service.update_session_status(session_id, "abandoned")
                except Exception:
                    pass
                await send_json(ws, {"type": "interview_complete", "session_id": session_id})
                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await send_json(ws, {"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        audio_buffer.clear()