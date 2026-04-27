import json
import base64
import asyncio
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


async def handle_ai_turn(ws: WebSocket, session_id: str):
    """
    Run one full AI turn:
      1. Stream LLM text, split at sentence boundaries
      2. Send each sentence to Cartesia TTS
      3. Stream text chunks + base64 audio chunks to client
      4. Send speaking_done when all audio is sent
    """
    session = await session_manager.get_session(session_id)
    if not session:
        await send_json(ws, {"type": "error", "message": "Session not found"})
        return

    await session_manager.update_session(session_id, {"is_ai_speaking": True, "is_listening": False})
    await send_json(ws, build_state_update(await session_manager.get_session(session_id)))

    full_response = ""
    sentence_buffer = ""

    try:
        async for text_chunk in stream_interviewer_response(
            conversation_history=session["conversation_history"],
            interview_profile=session["interview_profile"],
            question_plan=session["question_plan"],
            current_index=session["current_question_index"],
        ):
            full_response += text_chunk
            sentence_buffer += text_chunk

            # Send text chunk for live typewriter display
            await send_json(ws, {"type": "ai_text_chunk", "text": text_chunk})

            # Flush complete sentences to TTS as they arrive
            sentences = split_into_tts_chunks(sentence_buffer)
            if len(sentences) > 1:
                for sentence in sentences[:-1]:
                    if sentence.strip():
                        audio_bytes = b""
                        async for chunk in stream_tts(sentence.strip()):
                            audio_bytes += chunk
                        if audio_bytes:
                            await send_json(ws, {
                                "type": "audio_response_chunk",
                                "audio": base64.b64encode(audio_bytes).decode("utf-8"),
                            })
                sentence_buffer = sentences[-1]

        # Flush remaining text
        if sentence_buffer.strip():
            audio_bytes = b""
            async for chunk in stream_tts(sentence_buffer.strip()):
                audio_bytes += chunk
            if audio_bytes:
                await send_json(ws, {
                    "type": "audio_response_chunk",
                    "audio": base64.b64encode(audio_bytes).decode("utf-8"),
                })

        # Save AI turn to conversation history
        await session_manager.add_conversation_turn(session_id, "ai", full_response)

        # Signal client that all audio has been sent
        await send_json(ws, {"type": "speaking_done"})

        # Update state: AI done, now listening
        await session_manager.update_session(session_id, {
            "is_ai_speaking": False,
            "is_listening": True,
        })
        await send_json(ws, build_state_update(await session_manager.get_session(session_id)))

    except Exception as e:
        await send_json(ws, {"type": "error", "message": f"AI turn failed: {str(e)}"})
        await session_manager.update_session(session_id, {
            "is_ai_speaking": False,
            "is_listening": True,
        })


@router.websocket("/ws/interview/{session_id}")
async def interview_websocket(ws: WebSocket, session_id: str):
    await ws.accept()

    audio_buffer = bytearray()

    session = await session_manager.get_session(session_id)
    if not session:
        await send_json(ws, {"type": "error", "message": "Session not found. Please create a new session."})
        await ws.close()
        return

    # Send initial state so frontend knows the session exists
    await send_json(ws, build_state_update(session))

    # ── Wait for client to signal it is ready before starting AI ──────────────
    # This decouples AudioContext/mic initialisation (user gesture) from WS connect.
    # Client sends {"type": "client_ready"} after beginInterview() succeeds.
    client_ready = False

    try:
        while True:
            try:
                message = await ws.receive()
            except WebSocketDisconnect:
                return

            if message["type"] == "websocket.disconnect":
                return

            # Binary audio chunk — accumulate
            if "bytes" in message and message["bytes"] is not None:
                audio_buffer.extend(message["bytes"])
                continue

            # Text / JSON message
            if "text" not in message or not message["text"]:
                continue

            try:
                data = json.loads(message["text"])
            except json.JSONDecodeError:
                await send_json(ws, {"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = data.get("type")

            # ── Client signals it is ready → fire first AI turn ───────────────
            if msg_type == "client_ready" and not client_ready:
                client_ready = True
                await handle_ai_turn(ws, session_id)
                continue

            if msg_type == "ping":
                await send_json(ws, {"type": "pong"})
                continue

            # ── End of user audio → transcribe → AI responds ──────────────────
            if msg_type == "audio_end":
                if len(audio_buffer) == 0:
                    await send_json(ws, {"type": "error", "message": "No audio received"})
                    # Re-signal listening so client can try again
                    await session_manager.update_session(session_id, {"is_listening": True})
                    await send_json(ws, build_state_update(await session_manager.get_session(session_id)))
                    continue

                await session_manager.update_session(session_id, {"is_listening": False})
                await send_json(ws, {"type": "processing_start"})

                try:
                    audio_bytes = bytes(audio_buffer)
                    audio_buffer.clear()

                    transcript = await transcribe_audio(audio_bytes, "audio/webm")

                    if not transcript or not transcript.strip():
                        await send_json(ws, {"type": "error", "message": "Could not transcribe audio. Please speak clearly and try again."})
                        await session_manager.update_session(session_id, {"is_listening": True})
                        await send_json(ws, build_state_update(await session_manager.get_session(session_id)))
                        continue

                    await send_json(ws, {"type": "transcript", "text": transcript})

                    # Count filler words
                    filler_count = count_filler_words(transcript)

                    # Save user turn
                    await session_manager.add_conversation_turn(session_id, "user", transcript)

                    # Update filler counts
                    current_session = await session_manager.get_session(session_id)
                    filler_counts = current_session.get("filler_word_counts", [])
                    filler_counts.append(filler_count)
                    await session_manager.update_session(session_id, {"filler_word_counts": filler_counts})

                    # Persist response to Supabase (non-blocking, ignore failures)
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

                    # Advance question index
                    current_session = await session_manager.get_session(session_id)
                    old_index = current_session["current_question_index"]
                    total = current_session["total_questions"]
                    await session_manager.increment_question_index(session_id)

                    # Check if interview is done
                    is_last = old_index >= total - 1

                    # AI responds (closing remark if last question)
                    await handle_ai_turn(ws, session_id)

                    if is_last:
                        # Generate and save scorecard
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
                    audio_buffer.clear()
                    await send_json(ws, {"type": "error", "message": f"Processing failed: {str(e)}"})
                    await session_manager.update_session(session_id, {"is_listening": True})
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