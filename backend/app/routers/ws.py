import json
import base64
import asyncio
import traceback
import math
import struct
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.session_manager import session_manager
from app.services.groq_service import transcribe_audio, stream_interviewer_response, generate_scorecard
from app.services.cartesia_service import stream_tts, MODEL_ID, VOICE_SPEC, OUTPUT_FORMAT
from cartesia import AsyncCartesia
from app.core.config import settings
from app.services.answer_evaluator import evaluate_answer
from app.services.interview_logic import count_filler_words, split_into_tts_chunks
from app.services import supabase_service

router = APIRouter(tags=["websocket"])

PCM_F32LE_SAMPLE_RATE = 44100
PCM_F32LE_BYTES_PER_SAMPLE = 4


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
        "answer_evaluations": session.get("answer_evaluations", []),
        "follow_up_counts": session.get("follow_up_counts", {}),
    }


async def send_json(ws: WebSocket, data: dict):
    try:
        await ws.send_text(json.dumps(data))
    except Exception:
        pass


# Cartesia TTS Streaming logic is now embedded directly in handle_ai_turn


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
    audio_chunk_count = 0

    try:
        cartesia_client = AsyncCartesia(api_key=settings.cartesia_api_key)
        
        async with cartesia_client.tts.websocket_connect() as ws_cartesia:
            ctx = ws_cartesia.context(
                model_id=MODEL_ID,
                voice=VOICE_SPEC,
                output_format=OUTPUT_FORMAT,
            )

            async def text_sender():
                nonlocal full_response
                from app.services.interview_logic import ABBREVIATIONS
                try:
                    text_buffer = ""
                    async for text_chunk in stream_interviewer_response(
                        conversation_history=session["conversation_history"],
                        interview_profile=session["interview_profile"],
                        question_plan=session["question_plan"],
                        current_index=session["current_question_index"],
                        answer_evaluations=session.get("answer_evaluations", []),
                    ):
                        full_response += text_chunk
                        # Stream text to frontend immediately for typewriter display
                        await send_json(ws, {"type": "ai_text_chunk", "text": text_chunk})
                        
                        text_buffer += text_chunk
                        
                        last_flush_idx = -1
                        
                        # Find the LAST strong punctuation mark followed by space or newline
                        for i in range(len(text_buffer) - 2, -1, -1):
                            if text_buffer[i] in ".?!" and text_buffer[i+1] in " \n":
                                # Check if it's an abbreviation
                                j = i - 1
                                word = ""
                                while j >= 0 and text_buffer[j].isalpha():
                                    word = text_buffer[j] + word
                                    j -= 1
                                if word.lower() not in ABBREVIATIONS:
                                    last_flush_idx = i + 1  # Include the punctuation and the space
                                    break
                        
                        # If no strong sentence boundary but the buffer is getting too long (e.g. > 150 chars),
                        # fallback to splitting on commas or semi-colons to prevent latency buildup.
                        if last_flush_idx == -1 and len(text_buffer) > 150:
                            for i in range(len(text_buffer) - 2, -1, -1):
                                if text_buffer[i] in ",;:" and text_buffer[i+1] in " \n":
                                    last_flush_idx = i + 1
                                    break
                                    
                            # Extreme fallback: split on the last space if no punctuation at all and very long
                            if last_flush_idx == -1 and len(text_buffer) > 200:
                                for i in range(len(text_buffer) - 1, -1, -1):
                                    if text_buffer[i] in " \n":
                                        last_flush_idx = i
                                        break
                                        
                        if last_flush_idx != -1:
                            to_send = text_buffer[:last_flush_idx+1]
                            text_buffer = text_buffer[last_flush_idx+1:]
                            if to_send.strip():
                                await ctx.send(
                                    model_id=MODEL_ID,
                                    voice=VOICE_SPEC,
                                    output_format=OUTPUT_FORMAT,
                                    transcript=to_send,
                                    continue_=True
                                )
                                
                    # Send any remaining text
                    if text_buffer:
                        await ctx.send(
                            model_id=MODEL_ID,
                            voice=VOICE_SPEC,
                            output_format=OUTPUT_FORMAT,
                            transcript=text_buffer,
                            continue_=True
                        )
                except Exception as e:
                    print(f"[LLM STREAM ERROR] {e}")
                finally:
                    # Signal to Cartesia that the text stream is complete
                    await ctx.no_more_inputs()

            async def audio_receiver():
                buffer = b""
                try:
                    async for response in ctx.receive():
                        # Handle both object and dict response types based on Cartesia SDK version
                        resp_type = response.get("type") if isinstance(response, dict) else getattr(response, "type", None)
                        if resp_type == "chunk":
                            audio = response.get("audio") if isinstance(response, dict) else getattr(response, "audio", None)
                            if audio:
                                buffer += audio
                                if len(buffer) >= 4096:
                                    remainder = len(buffer) % 4
                                    valid_length = len(buffer) - remainder
                                    if valid_length > 0:
                                        await send_json(ws, {
                                            "type": "audio_response_chunk",
                                            "audio": base64.b64encode(buffer[:valid_length]).decode("utf-8"),
                                        })
                                        buffer = buffer[valid_length:]
                    
                    # Flush final padded buffer
                    if buffer:
                        remainder = len(buffer) % 4
                        if remainder != 0:
                            buffer += b"\x00" * (4 - remainder)
                        await send_json(ws, {
                            "type": "audio_response_chunk",
                            "audio": base64.b64encode(buffer).decode("utf-8"),
                        })
                except Exception as e:
                    print(f"[AUDIO RECEIVER ERROR] {e}")

            # Run LLM text streaming and Cartesia audio receiving concurrently
            await asyncio.gather(text_sender(), audio_receiver())

    except Exception as e:
        # LLM streaming failed — still need to unblock the frontend
        print(f"[LLM/TTS ERROR] {e}")
        traceback.print_exc()
        full_response = full_response or "I encountered an issue. Let's continue — please go ahead."
        await send_json(ws, {"type": "error", "message": f"LLM/TTS error: {str(e)}"})

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



async def restore_session_from_db(session_id: str) -> bool:
    try:
        client = supabase_service.get_client()
        session_res = client.table("sessions").select("*").eq("id", session_id).execute()
        if not session_res.data:
            return False
        session_data = session_res.data[0]

        if session_data["status"] != "in_progress":
            return False

        questions_res = client.table("questions").select("*").eq("session_id", session_id).order("order_index").execute()
        if not questions_res.data:
            return False
        questions = questions_res.data

        responses_res = client.table("responses").select("*").eq("session_id", session_id).execute()
        responses = responses_res.data or []

        current_index = len(responses)
        if current_index >= len(questions):
            return False

        interview_profile = {
            "role_title": session_data.get("role_title"),
            "level": session_data.get("level"),
            "domain": session_data.get("domain"),
            "tech_stack": session_data.get("tech_stack", []),
        }

        question_plan = []
        for q in questions:
            question_plan.append({
                "question": q["question_text"],
                "type": q["question_type"],
                "follow_up_hint": q.get("follow_up_hint"),
            })

        await session_manager.create_session(
            session_id=session_id,
            user_id=session_data["user_id"],
            interview_profile=interview_profile,
            question_plan=question_plan,
        )

        history = []
        for i in range(current_index):
            history.append({
                "role": "ai",
                "content": questions[i]["question_text"],
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            q_id = questions[i]["id"]
            resp = next((r for r in responses if r["question_id"] == q_id), None)
            if resp:
                history.append({
                    "role": "user",
                    "content": resp["transcript"],
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })

        await session_manager.update_session(session_id, {
            "current_question_index": current_index,
            "conversation_history": history,
        })

        return True
    except Exception as e:
        print(f"[WS] Error restoring session: {e}")
        return False


@router.websocket("/ws/interview/{session_id}")
async def interview_websocket(ws: WebSocket, session_id: str):
    await ws.accept()

    audio_buffer = bytearray()
    failed_listen_attempts = 0  # tracks consecutive failed transcriptions per question
    MAX_LISTEN_RETRIES = 3

    session = await session_manager.get_session(session_id)

    if not session:
        restored = await restore_session_from_db(session_id)
        if restored:
            session = await session_manager.get_session(session_id)
        else:
            await send_json(ws, {"type": "error", "message": "Session not found. Please create a new session."})
            await ws.close()
            return

    await send_json(ws, build_state_update(session))

    # Helper: handle the case where we couldn't get valid audio
    async def handle_failed_listen():
        nonlocal failed_listen_attempts
        failed_listen_attempts += 1

        if failed_listen_attempts >= MAX_LISTEN_RETRIES:
            # Give up — record a "no response" and advance to next question
            failed_listen_attempts = 0
            current_session = await session_manager.get_session(session_id)
            current_idx = current_session["current_question_index"]
            current_question = ""
            if current_idx < len(current_session.get("question_plan", [])):
                current_question = current_session["question_plan"][current_idx].get("question", "")
            answer_evaluation = evaluate_answer(
                question=current_question,
                transcript="(no response)",
                interview_profile=current_session.get("interview_profile", {}),
            )
            answer_evaluations = current_session.get("answer_evaluations", [])
            answer_evaluations.append(answer_evaluation)
            await session_manager.update_session(session_id, {"answer_evaluations": answer_evaluations})
            await session_manager.add_conversation_turn(session_id, "user", "(no response)")

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
                    answer_evaluations=final_session.get("answer_evaluations", []),
                )
                scorecard_data["session_id"] = session_id
                scorecard_data["answer_evaluations"] = final_session.get("answer_evaluations", [])
                scorecard_data["question_plan"] = final_session.get("question_plan", [])

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
                return False  # signal to break from main loop
        else:
            # Still have retries — tell the user and restart listening
            remaining = MAX_LISTEN_RETRIES - failed_listen_attempts
            await send_json(ws, {
                "type": "error",
                "message": f"I couldn't hear you clearly — please try again. ({remaining} attempt{'s' if remaining != 1 else ''} left)",
            })
            await session_manager.update_session(session_id, {"is_listening": True})
            await send_json(ws, {"type": "speaking_done"})
            await send_json(ws, build_state_update(await session_manager.get_session(session_id)))

        return True  # signal to continue main loop

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
                    print("[WS] audio_end received but buffer is empty")
                    should_continue = await handle_failed_listen()
                    if not should_continue:
                        break
                    continue

                # Minimum size check — tiny buffers are just mic noise, not speech.
                if len(audio_buffer) < 2000:
                    print(f"[WS] audio buffer too small ({len(audio_buffer)} bytes)")
                    audio_buffer.clear()
                    should_continue = await handle_failed_listen()
                    if not should_continue:
                        break
                    continue

                await session_manager.update_session(session_id, {"is_listening": False})
                await send_json(ws, {"type": "processing_start"})

                try:
                    audio_bytes = bytes(audio_buffer)
                    audio_buffer.clear()

                    transcript = await transcribe_audio(audio_bytes, "audio/webm")

                    if not transcript or not transcript.strip():
                        print("[WS] Empty transcript")
                        should_continue = await handle_failed_listen()
                        if not should_continue:
                            break
                        continue

                    # SUCCESS — reset retry counter
                    failed_listen_attempts = 0

                    await send_json(ws, {"type": "transcript", "text": transcript})

                    filler_count = count_filler_words(transcript)
                    current_session = await session_manager.get_session(session_id)
                    current_idx = current_session["current_question_index"]
                    current_question = ""
                    if current_idx < len(current_session.get("question_plan", [])):
                        current_question = current_session["question_plan"][current_idx].get("question", "")

                    answer_evaluation = evaluate_answer(
                        question=current_question,
                        transcript=transcript,
                        interview_profile=current_session.get("interview_profile", {}),
                    )
                    answer_evaluations = current_session.get("answer_evaluations", [])
                    answer_evaluations.append(answer_evaluation)
                    follow_up_counts = current_session.get("follow_up_counts", {})
                    follow_up_key = str(current_idx)
                    follow_ups_used = int(follow_up_counts.get(follow_up_key, 0))
                    should_hold_for_follow_up = bool(
                        answer_evaluation.get("should_follow_up") and follow_ups_used < 1
                    )
                    if should_hold_for_follow_up:
                        follow_up_counts[follow_up_key] = follow_ups_used + 1
                    await session_manager.update_session(session_id, {
                        "answer_evaluations": answer_evaluations,
                        "follow_up_counts": follow_up_counts,
                    })
                    await send_json(ws, {"type": "answer_evaluation", "evaluation": answer_evaluation})

                    await session_manager.add_conversation_turn(session_id, "user", transcript)

                    current_session = await session_manager.get_session(session_id)
                    filler_counts = current_session.get("filler_word_counts", [])
                    filler_counts.append(filler_count)
                    await session_manager.update_session(session_id, {"filler_word_counts": filler_counts})

                    # Persist to Supabase (fire and forget)
                    try:
                        question_ids = await supabase_service.get_question_ids(session_id)
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
                    if should_hold_for_follow_up:
                        is_last = False
                    else:
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
                            answer_evaluations=final_session.get("answer_evaluations", []),
                        )
                        scorecard_data["session_id"] = session_id
                        scorecard_data["answer_evaluations"] = final_session.get("answer_evaluations", [])
                        scorecard_data["question_plan"] = final_session.get("question_plan", [])

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
                    error_str = str(e).lower()
                    audio_buffer.clear()

                    # Groq can't parse the audio file — treat as failed listen
                    if "could not process file" in error_str or "invalid" in error_str:
                        print(f"[WS] Invalid audio file sent to STT")
                        should_continue = await handle_failed_listen()
                        if not should_continue:
                            break
                    else:
                        print(f"[WS] audio_end processing error: {e}")
                        traceback.print_exc()
                        should_continue = await handle_failed_listen()
                        if not should_continue:
                            break



            elif msg_type == "end_interview":
                try:
                    # Try to generate a partial scorecard if there's conversation history
                    final_session = await session_manager.get_session(session_id)
                    if final_session and len(final_session.get("conversation_history", [])) > 1:
                        try:
                            scorecard_data = await generate_scorecard(
                                conversation_history=final_session["conversation_history"],
                                interview_profile=final_session["interview_profile"],
                                filler_counts=final_session.get("filler_word_counts", []),
                                answer_evaluations=final_session.get("answer_evaluations", []),
                            )
                            scorecard_data["session_id"] = session_id
                            scorecard_data["answer_evaluations"] = final_session.get("answer_evaluations", [])
                            scorecard_data["question_plan"] = final_session.get("question_plan", [])
                            await supabase_service.save_scorecard(scorecard_data)
                            await supabase_service.update_session_status(
                                session_id, "completed", datetime.now(timezone.utc)
                            )
                        except Exception as e:
                            print(f"[WS] Failed to generate partial scorecard: {e}")
                            await supabase_service.update_session_status(session_id, "abandoned")
                    else:
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
