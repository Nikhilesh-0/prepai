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
    """Send JSON message safely."""
    try:
        await ws.send_text(json.dumps(data))
    except Exception:
        pass


async def send_binary(ws: WebSocket, data: bytes):
    """Send binary message safely."""
    try:
        await ws.send_bytes(data)
    except Exception:
        pass


async def handle_ai_turn(ws: WebSocket, session_id: str):
    """
    Run a full AI turn:
    1. Stream LLM response
    2. Split into TTS chunks sentence by sentence
    3. Send text chunks and audio chunks to client
    """
    session = await session_manager.get_session(session_id)
    if not session:
        await send_json(ws, {"type": "error", "message": "Session not found"})
        return

    await session_manager.update_session(session_id, {"is_ai_speaking": True, "is_listening": False})
    await send_json(ws, {"type": "state_update", **build_state_update(await session_manager.get_session(session_id))})

    # Accumulate full LLM response while streaming text chunks to client
    full_response = ""
    sentence_buffer = ""
    tts_tasks = []

    try:
        async for text_chunk in stream_interviewer_response(
            conversation_history=session["conversation_history"],
            interview_profile=session["interview_profile"],
            question_plan=session["question_plan"],
            current_index=session["current_question_index"],
        ):
            full_response += text_chunk
            sentence_buffer += text_chunk

            # Send text chunk for live display
            await send_json(ws, {"type": "ai_text_chunk", "text": text_chunk})

            # Check for sentence boundaries and flush to TTS
            sentences = split_into_tts_chunks(sentence_buffer)
            if len(sentences) > 1:
                # All but the last are complete sentences
                for sentence in sentences[:-1]:
                    if sentence.strip():
                        # Stream TTS for this sentence
                        audio_chunks = []
                        async for audio_chunk in stream_tts(sentence):
                            audio_chunks.append(audio_chunk)

                        if audio_chunks:
                            combined = b"".join(audio_chunks)
                            encoded = base64.b64encode(combined).decode("utf-8")
                            await send_json(ws, {
                                "type": "audio_response_chunk",
                                "audio": encoded,
                            })

                # Keep the last (incomplete) sentence in buffer
                sentence_buffer = sentences[-1]

        # Flush remaining buffer
        if sentence_buffer.strip():
            audio_chunks = []
            async for audio_chunk in stream_tts(sentence_buffer.strip()):
                audio_chunks.append(audio_chunk)

            if audio_chunks:
                combined = b"".join(audio_chunks)
                encoded = base64.b64encode(combined).decode("utf-8")
                await send_json(ws, {
                    "type": "audio_response_chunk",
                    "audio": encoded,
                })

        # Add AI response to conversation history
        await session_manager.add_conversation_turn(session_id, "ai", full_response)

        # Signal that AI is done speaking
        await send_json(ws, {"type": "speaking_done"})

        # Update state to listening
        await session_manager.update_session(session_id, {
            "is_ai_speaking": False,
            "is_listening": True,
        })

        updated_session = await session_manager.get_session(session_id)
        await send_json(ws, build_state_update(updated_session))

    except Exception as e:
        await send_json(ws, {"type": "error", "message": f"AI turn failed: {str(e)}"})
        await session_manager.update_session(session_id, {
            "is_ai_speaking": False,
            "is_listening": True,
        })


@router.websocket("/ws/interview/{session_id}")
async def interview_websocket(ws: WebSocket, session_id: str):
    await ws.accept()

    # Audio accumulation buffer per connection
    audio_buffer = bytearray()

    session = await session_manager.get_session(session_id)
    if not session:
        await send_json(ws, {"type": "error", "message": "Session not found. Create a session first."})
        await ws.close()
        return

    # Send initial state
    await send_json(ws, build_state_update(session))

    # Start the interview — AI speaks first
    await handle_ai_turn(ws, session_id)

    try:
        while True:
            try:
                # Try to receive a message (binary or text)
                message = await ws.receive()
            except WebSocketDisconnect:
                break

            if message["type"] == "websocket.disconnect":
                break

            # Handle binary audio chunk
            if "bytes" in message and message["bytes"] is not None:
                audio_buffer.extend(message["bytes"])
                continue

            # Handle text/JSON messages
            if "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    await send_json(ws, {"type": "error", "message": "Invalid JSON"})
                    continue

                msg_type = data.get("type")

                if msg_type == "audio_end":
                    # Process accumulated audio
                    if len(audio_buffer) == 0:
                        await send_json(ws, {"type": "error", "message": "No audio received"})
                        continue

                    await session_manager.update_session(session_id, {"is_listening": False})

                    # Send processing indicator
                    await send_json(ws, {"type": "processing_start"})

                    try:
                        # Transcribe audio
                        audio_bytes = bytes(audio_buffer)
                        audio_buffer.clear()

                        transcript = await transcribe_audio(audio_bytes, "audio/webm")

                        if not transcript:
                            await send_json(ws, {"type": "error", "message": "Could not transcribe audio"})
                            await session_manager.update_session(session_id, {"is_listening": True})
                            continue

                        # Send transcript to client
                        await send_json(ws, {"type": "transcript", "text": transcript})

                        # Count filler words
                        filler_count = count_filler_words(transcript)

                        # Add user response to conversation
                        await session_manager.add_conversation_turn(session_id, "user", transcript)

                        # Update filler counts
                        session = await session_manager.get_session(session_id)
                        filler_counts = session.get("filler_word_counts", [])
                        filler_counts.append(filler_count)
                        await session_manager.update_session(session_id, {
                            "filler_word_counts": filler_counts
                        })

                        # Save response to Supabase
                        try:
                            session = await session_manager.get_session(session_id)
                            question_ids = await supabase_service.get_question_ids(session_id)
                            current_idx = session["current_question_index"]
                            if question_ids and current_idx < len(question_ids):
                                question_id = question_ids[current_idx]["id"]
                                await supabase_service.save_response({
                                    "session_id": session_id,
                                    "question_id": question_id,
                                    "transcript": transcript,
                                })
                        except Exception:
                            pass  # Don't fail the interview on DB errors

                        # Check if this was the last question
                        session = await session_manager.get_session(session_id)
                        current_idx = session["current_question_index"]
                        total = session["total_questions"]

                        # Increment question index
                        await session_manager.increment_question_index(session_id)

                        session = await session_manager.get_session(session_id)

                        if current_idx >= total - 1:
                            # This was the last question — AI gives closing and we end
                            await handle_ai_turn(ws, session_id)

                            # Generate scorecard
                            await send_json(ws, {"type": "processing_start"})

                            session = await session_manager.get_session(session_id)
                            scorecard_data = await generate_scorecard(
                                conversation_history=session["conversation_history"],
                                interview_profile=session["interview_profile"],
                                filler_counts=session.get("filler_word_counts", []),
                            )

                            scorecard_data["session_id"] = session_id

                            # Save scorecard to Supabase
                            try:
                                await supabase_service.save_scorecard(scorecard_data)
                                await supabase_service.update_session_status(
                                    session_id,
                                    "completed",
                                    datetime.now(timezone.utc),
                                )
                            except Exception:
                                pass

                            await send_json(ws, {
                                "type": "interview_complete",
                                "session_id": session_id,
                                "scorecard": scorecard_data,
                            })
                            break

                        else:
                            # Continue interview — AI responds
                            await handle_ai_turn(ws, session_id)

                    except Exception as e:
                        audio_buffer.clear()
                        await send_json(ws, {"type": "error", "message": f"Processing failed: {str(e)}"})
                        await session_manager.update_session(session_id, {"is_listening": True})

                elif msg_type == "end_interview":
                    # User manually ended interview
                    try:
                        await supabase_service.update_session_status(session_id, "abandoned")
                    except Exception:
                        pass
                    await send_json(ws, {"type": "interview_complete", "session_id": session_id})
                    break

                elif msg_type == "ping":
                    await send_json(ws, {"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await send_json(ws, {"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        # Clean up audio buffer
        audio_buffer.clear()
