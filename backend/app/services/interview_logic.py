import json
import re
from typing import AsyncGenerator
from groq import AsyncGroq
from app.core.config import settings

client = AsyncGroq(api_key=settings.groq_api_key)

# Filler words to detect
FILLER_PATTERNS = [
    r'\bum\b',
    r'\buh\b',
    r'\blike\b(?!\s+to|\s+a|\s+an|\s+the|\s+I|\s+we|\s+they)',  # standalone "like"
    r'\byou know\b',
    r'\bbasically\b',
    r'\bliterally\b',
    r'(?:^|[.!?]\s+)so\b',  # sentence-starting "so"
    r'\bright\?\s*$',       # question-ending "right?"
]

# Common abbreviations that contain periods (to avoid false sentence breaks)
ABBREVIATIONS = {
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'inc',
    'ltd', 'co', 'corp', 'fig', 'vol', 'no', 'pp', 'dept', 'est',
    'approx', 'avg', 'max', 'min', 'e.g', 'i.e', 'a.k.a', 'p.s',
}


async def parse_jd(jd_text: str) -> dict:
    """Parse a job description and extract structured interview profile."""
    prompt = f"""Analyze this job description and extract key information for interview preparation.

Job Description:
{jd_text}

Return ONLY valid JSON (no markdown, no backticks, no explanation) with this exact structure:
{{
  "role_title": "<specific job title from JD>",
  "level": "<junior|mid|senior>",
  "tech_stack": ["<tech1>", "<tech2>", "<tech3>"],
  "domain": "<frontend|backend|fullstack|ml|data|devops|other>",
  "soft_skill_signals": ["<skill1>", "<skill2>", "<skill3>"],
  "company_type": "<startup|enterprise|unknown>"
}}

Be accurate and specific. Extract the actual technologies mentioned. Return ONLY the JSON object."""

    response = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500,
        temperature=0.1,
        stream=False,
    )

    content = response.choices[0].message.content.strip()

    # Strip markdown fences if present
    if content.startswith("```"):
        lines = content.split("\n")
        content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        profile = json.loads(content)
        # Validate and normalize level
        if profile.get("level") not in ["junior", "mid", "senior"]:
            profile["level"] = "mid"
        # Validate domain
        valid_domains = ["frontend", "backend", "fullstack", "ml", "data", "devops", "other"]
        if profile.get("domain") not in valid_domains:
            profile["domain"] = "fullstack"
        # Validate company_type
        if profile.get("company_type") not in ["startup", "enterprise", "unknown"]:
            profile["company_type"] = "unknown"
        return profile
    except json.JSONDecodeError:
        # Return a sensible default
        return {
            "role_title": "Software Engineer",
            "level": "mid",
            "tech_stack": ["Python", "JavaScript"],
            "domain": "fullstack",
            "soft_skill_signals": ["communication", "teamwork", "problem-solving"],
            "company_type": "unknown",
        }


async def generate_question_plan(profile: dict) -> list:
    """Generate a structured interview question plan from the JD profile."""
    tech_stack_str = ", ".join(profile.get("tech_stack", []))

    prompt = f"""Create an interview question plan for a {profile.get('role_title', 'Software Engineer')} ({profile.get('level', 'mid')} level) position.

Tech stack: {tech_stack_str}
Domain: {profile.get('domain', 'fullstack')}
Company type: {profile.get('company_type', 'unknown')}
Soft skill signals: {', '.join(profile.get('soft_skill_signals', []))}

Generate exactly 8-9 interview questions following this structure:
- 2 HR/culture fit questions
- 3-4 technical questions (specific to the tech stack and level)
- 2 behavioral questions (STAR format prompts)
- 1 closing question

Return ONLY a valid JSON array (no markdown, no backticks, no explanation) with this exact structure:
[
  {{
    "question": "<full question text>",
    "type": "<hr|behavioral|technical>",
    "follow_up_hint": "<hint for what to dig into deeper if the answer is shallow>"
  }}
]

Make technical questions genuinely challenging and specific to the tech stack. Return ONLY the JSON array."""

    response = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2000,
        temperature=0.5,
        stream=False,
    )

    content = response.choices[0].message.content.strip()

    # Strip markdown fences if present
    if content.startswith("```"):
        lines = content.split("\n")
        content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        questions = json.loads(content)
        # Validate structure
        validated = []
        seen_questions = set()
        for q in questions:
            if isinstance(q, dict) and "question" in q:
                q_text = q["question"].strip()
                # Deduplicate questions that might be generated twice
                if q_text.lower() in seen_questions:
                    continue
                seen_questions.add(q_text.lower())
                
                q_type = q.get("type", "technical")
                if q_type not in ["hr", "behavioral", "technical"]:
                    q_type = "technical"
                validated.append({
                    "question": q_text,
                    "type": q_type,
                    "follow_up_hint": q.get("follow_up_hint", "Ask for a specific example"),
                })
        return validated if len(validated) >= 4 else _default_question_plan(profile)
    except json.JSONDecodeError:
        return _default_question_plan(profile)


def _default_question_plan(profile: dict) -> list:
    """Return a default question plan if LLM parsing fails."""
    role = profile.get("role_title", "Software Engineer")
    return [
        {"question": f"Tell me about yourself and why you're interested in the {role} role.", "type": "hr", "follow_up_hint": "Ask about specific motivations"},
        {"question": "What's your preferred working style — independent or collaborative?", "type": "hr", "follow_up_hint": "Explore team dynamics"},
        {"question": "Walk me through a challenging technical problem you solved recently.", "type": "technical", "follow_up_hint": "Dig into the technical decisions made"},
        {"question": "How do you approach debugging a production issue?", "type": "technical", "follow_up_hint": "Ask about specific tools and methodologies"},
        {"question": "Describe your experience with system design and scalability.", "type": "technical", "follow_up_hint": "Ask about specific trade-offs they've made"},
        {"question": "Tell me about a time you had a conflict with a teammate and how you resolved it.", "type": "behavioral", "follow_up_hint": "Probe the resolution and learnings"},
        {"question": "Describe a project where you had to learn something entirely new under time pressure.", "type": "behavioral", "follow_up_hint": "Ask about the learning strategy"},
        {"question": "Where do you see your career heading in the next 2-3 years?", "type": "hr", "follow_up_hint": "Align with company growth"},
    ]


def count_filler_words(transcript: str) -> int:
    """Count filler words in a transcript."""
    if not transcript:
        return 0

    text = transcript.lower()
    total = 0

    for pattern in FILLER_PATTERNS:
        matches = re.findall(pattern, text, re.MULTILINE)
        total += len(matches)

    return total


def detect_sentence_boundaries(text: str) -> list[str]:
    """
    Split text into sentences at . ? ! boundaries.
    Handles abbreviations to avoid false splits.
    Returns list of sentences.
    """
    sentences = []
    current = ""
    i = 0

    while i < len(text):
        char = text[i]
        current += char

        if char in ".!?":
            # Check if this is an abbreviation
            word_before = ""
            j = i - 1
            while j >= 0 and text[j].isalpha():
                word_before = text[j] + word_before
                j -= 1

            is_abbreviation = word_before.lower() in ABBREVIATIONS

            # Check for multiple punctuation (e.g., ...)
            if i + 1 < len(text) and text[i + 1] in ".!?":
                i += 1
                continue

            if not is_abbreviation:
                # Check if followed by space or end of string
                if i + 1 >= len(text) or text[i + 1] == " " or text[i + 1] == "\n":
                    sentence = current.strip()
                    if sentence:
                        sentences.append(sentence)
                    current = ""

        i += 1

    # Add any remaining text
    if current.strip():
        sentences.append(current.strip())

    return sentences


def split_into_tts_chunks(text: str) -> list[str]:
    """
    Split text into chunks suitable for TTS — sentence by sentence.
    Merge very short sentences with the next one.
    """
    sentences = detect_sentence_boundaries(text)
    chunks = []
    buffer = ""

    for sentence in sentences:
        if not sentence.strip():
            continue
        if len(buffer) + len(sentence) < 20 and buffer:
            buffer += " " + sentence
        else:
            if buffer:
                chunks.append(buffer.strip())
            buffer = sentence

    if buffer.strip():
        chunks.append(buffer.strip())

    return chunks if chunks else [text]
