import os
import tempfile
from typing import AsyncGenerator
from groq import AsyncGroq
from app.core.config import settings

client = AsyncGroq(api_key=settings.groq_api_key)


async def transcribe_audio(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    """Transcribe audio bytes using Groq Whisper large-v3."""
    tmp_path = None
    try:
        suffix = ".webm"
        if "ogg" in mime_type:
            suffix = ".ogg"
        elif "mp4" in mime_type:
            suffix = ".mp4"
        elif "wav" in mime_type:
            suffix = ".wav"

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        with open(tmp_path, "rb") as audio_file:
            transcription = await client.audio.transcriptions.create(
                file=(os.path.basename(tmp_path), audio_file, mime_type),
                model="whisper-large-v3",
                response_format="text",
                language="en",
            )

        if isinstance(transcription, str):
            return transcription.strip()
        return transcription.text.strip() if hasattr(transcription, "text") else str(transcription).strip()

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


async def stream_interviewer_response(
    conversation_history: list,
    interview_profile: dict,
    question_plan: list,
    current_index: int,
    answer_evaluations: list | None = None,
) -> AsyncGenerator[str, None]:
    """Stream LLM response for the interviewer turn."""

    tech_stack_str = ", ".join(interview_profile.get("tech_stack", []))
    total_questions = len(question_plan)

    question_plan_formatted = "\n".join([
        f"{i+1}. [{q['type'].upper()}] {q['question']} (follow-up hint: {q.get('follow_up_hint', 'N/A')})"
        for i, q in enumerate(question_plan)
    ])

    # Determine what the AI should do this turn
    if not conversation_history:
        turn_instruction = (
            f"This is the start of the interview. Greet the candidate briefly (one short sentence), "
            f"then ask the first question: \"{question_plan[0]['question']}\""
        )
    else:
        last_user_turn = next((t for t in reversed(conversation_history) if t['role'] == 'user'), None)
        last_user_text = last_user_turn['content'] if last_user_turn else ""
        next_q_index = min(current_index, len(question_plan) - 1)
        next_q = question_plan[next_q_index]['question'] if question_plan else ""

        if current_index >= total_questions:
            turn_instruction = (
                "The interview is complete. Briefly thank the candidate for their time and "
                "say the interview is concluded. Keep it to 1-2 sentences."
            )
        else:
            latest_eval = (answer_evaluations or [])[-1] if answer_evaluations else None
            evaluator_note = ""
            if latest_eval:
                evaluator_note = (
                    "\n\nPrivate evaluator signal for the candidate's last answer:\n"
                    f"- Label: {latest_eval.get('label')} "
                    f"(confidence {latest_eval.get('confidence')})\n"
                    f"- Answer score: {latest_eval.get('overall_answer_score')}/100\n"
                    f"- Should follow up: {latest_eval.get('should_follow_up')}\n"
                    f"- Reason: {latest_eval.get('reason')}\n"
                    "Use this signal quietly to decide whether to probe or move on. "
                    "Do not mention the label, score, evaluator, or rubric to the candidate."
                )
            turn_instruction = (
                f"The candidate's last response was: \"{last_user_text[:300]}\"\n\n"
                f"Do the following in order:\n"
                f"1. Briefly react to their answer (1 sentence — acknowledge what they said specifically, "
                f"note if it was vague, or probe a gap you noticed). Do NOT be sycophantic.\n"
                f"2. Then either:\n"
                f"   a) Ask ONE targeted follow-up if their answer was too vague or missed the point, OR\n"
                f"   b) Transition naturally to the next question: \"{next_q}\"\n"
                f"\nUse the follow-up hint for question {next_q_index}: "
                f"\"{question_plan[next_q_index].get('follow_up_hint', 'Ask for a specific example')}\""
                f"{evaluator_note}"
            )

    system_prompt = f"""You are Alex, a senior technical interviewer. You are conducting a live mock interview.

Role: {interview_profile.get('role_title', 'Software Engineer')} ({interview_profile.get('level', 'mid')} level)
Company type: {interview_profile.get('company_type', 'tech')}
Tech stack: {tech_stack_str}
Domain: {interview_profile.get('domain', 'fullstack')}

Question plan (for reference):
{question_plan_formatted}

PERSONA:
- You are professional but warm — like a real senior engineer who genuinely wants to help the candidate show their best.
- You speak naturally in complete sentences, as if talking to a person face-to-face.
- You actively listen: reference specific things the candidate said in your responses.
- If the candidate gives a weak or off-topic answer, you gently redirect or ask them to elaborate.
- If the candidate didn't answer or gave gibberish, say something like "I didn't quite catch that — could you try again?" or "Let's move on" and ask the next question.

RULES:
1. Keep your total response under 80 words.
2. Never ask more than one question per turn.
3. Never be sycophantic ("great answer!", "excellent!", "that's perfect!"). Instead, be neutral-professional.
4. Never mention you are an AI.
5. Respond with spoken words only — no labels, headers, or formatting.

Your task this turn: {turn_instruction}"""

    # Build message history
    if not conversation_history:
        messages = [{"role": "user", "content": "Start the interview."}]
    else:
        messages = []
        for turn in conversation_history:
            role = "assistant" if turn["role"] == "ai" else "user"
            messages.append({"role": role, "content": turn["content"]})

    stream = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "system", "content": system_prompt}] + messages,
        max_tokens=250,
        temperature=0.4,
        stream=True,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta and delta.content:
            yield delta.content


async def generate_scorecard(
    conversation_history: list,
    interview_profile: dict,
    filler_counts: list,
    answer_evaluations: list | None = None,
) -> dict:
    """Generate a scorecard from the completed interview."""

    total_fillers = sum(filler_counts) if filler_counts else 0

    conversation_formatted = "\n".join([
        f"{turn['role'].upper()}: {turn['content']}"
        for turn in conversation_history
    ])
    evaluations_formatted = "No per-answer evaluator data available."
    if answer_evaluations:
        evaluations_formatted = "\n".join([
            (
                f"Answer {i+1}: label={ev.get('label')}, "
                f"score={ev.get('overall_answer_score')}, "
                f"reason={ev.get('reason')}"
            )
            for i, ev in enumerate(answer_evaluations)
        ])

    prompt = f"""You are evaluating a mock interview for the role of {interview_profile.get('role_title', 'Software Engineer')} ({interview_profile.get('level', 'mid')} level).

Here is the complete interview transcript:

{conversation_formatted}

Total filler words detected: {total_fillers}

Small custom evaluator signals:
{evaluations_formatted}

Evaluate this interview and return ONLY valid JSON (no markdown, no backticks, no explanation) with this exact structure:
{{
  "overall_score": <integer 0-100>,
  "communication_score": <integer 0-100>,
  "technical_score": <integer 0-100>,
  "confidence_score": <integer 0-100>,
  "filler_word_count": {total_fillers},
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": ["<improvement 1>", "<improvement 2>", "<improvement 3>"],
  "summary": "<2-3 sentence overall assessment>",
  "detailed_feedback": {{
    "communication": "<specific feedback on communication style>",
    "technical": "<specific feedback on technical depth>",
    "confidence": "<specific feedback on confidence and delivery>"
  }}
}}

Be honest and specific. Base scores on actual response quality. Return ONLY the JSON object."""

    response = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1000,
        temperature=0.3,
        stream=False,
    )

    content = response.choices[0].message.content.strip()

    # Strip markdown fences if present
    if content.startswith("```"):
        lines = content.split("\n")
        content = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

    import json
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Return a default scorecard if parsing fails
        return {
            "overall_score": 65,
            "communication_score": 65,
            "technical_score": 60,
            "confidence_score": 65,
            "filler_word_count": total_fillers,
            "strengths": ["Completed the interview", "Engaged with questions", "Showed interest in the role"],
            "improvements": ["Provide more specific examples", "Deepen technical explanations", "Reduce filler words"],
            "summary": "The candidate completed the interview and demonstrated baseline competency. There is room for improvement in technical depth and communication clarity.",
            "detailed_feedback": {
                "communication": "Communication was acceptable but could benefit from more structured responses.",
                "technical": "Technical answers were present but lacked depth and specific examples.",
                "confidence": "Delivery was adequate. Work on reducing filler words for a more confident presentation.",
            },
        }
