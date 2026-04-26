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
) -> AsyncGenerator[str, None]:
    """Stream LLM response for the interviewer turn."""

    tech_stack_str = ", ".join(interview_profile.get("tech_stack", []))
    soft_skills_str = ", ".join(interview_profile.get("soft_skill_signals", []))
    total_questions = len(question_plan)

    question_plan_formatted = "\n".join([
        f"{i+1}. [{q['type'].upper()}] {q['question']} (follow-up hint: {q.get('follow_up_hint', 'N/A')})"
        for i, q in enumerate(question_plan)
    ])

    conversation_formatted = "\n".join([
        f"{turn['role'].upper()}: {turn['content']}"
        for turn in conversation_history
    ])

    system_prompt = f"""You are Alex, a senior technical interviewer at a top-tier tech company. You are conducting a mock interview for the role of {interview_profile.get('role_title', 'Software Engineer')} ({interview_profile.get('level', 'mid')} level) at a {interview_profile.get('company_type', 'tech')} company.

Interview profile:
- Tech stack: {tech_stack_str}
- Domain: {interview_profile.get('domain', 'fullstack')}
- Soft skill signals detected: {soft_skills_str}

Question plan (your guide, not a rigid script):
{question_plan_formatted}

Conversation so far:
{conversation_formatted}

Current question index: {current_index} of {total_questions}

Your instructions:
- You are calm, professional, and slightly formal. Never sycophantic. Do not say "great answer" or "excellent".
- Speak in short, clear sentences. Never ramble.
- After the user responds, decide: if they said something worth digging into, ask ONE targeted follow-up. If the response was complete, advance to the next planned question.
- When advancing, transition naturally: "Let's move on to..." or "Next, I'd like to ask..."
- If this is the final question (index equals total), end with: "That concludes our interview. Thank you for your time." and nothing else.
- Never break character. Never mention you are an AI.
- Never ask multiple questions at once.
- Keep responses under 80 words unless the question requires a longer setup.

Respond with your next interviewer turn only. No preamble, no labels."""

    # Build messages: if no conversation yet, start the interview
    if not conversation_history:
        messages = [
            {"role": "user", "content": "Begin the interview. Start with your first question."}
        ]
    else:
        # Convert conversation history to OpenAI format
        messages = []
        for turn in conversation_history:
            role = "assistant" if turn["role"] == "ai" else "user"
            messages.append({"role": role, "content": turn["content"]})

    stream = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "system", "content": system_prompt}] + messages,
        max_tokens=300,
        temperature=0.7,
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
) -> dict:
    """Generate a scorecard from the completed interview."""

    total_fillers = sum(filler_counts) if filler_counts else 0

    conversation_formatted = "\n".join([
        f"{turn['role'].upper()}: {turn['content']}"
        for turn in conversation_history
    ])

    prompt = f"""You are evaluating a mock interview for the role of {interview_profile.get('role_title', 'Software Engineer')} ({interview_profile.get('level', 'mid')} level).

Here is the complete interview transcript:

{conversation_formatted}

Total filler words detected: {total_fillers}

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
