import json
import re
from pathlib import Path
from typing import Any


MODEL_PATH = Path(__file__).resolve().parents[1] / "ml" / "jd_profile_model.json"

TECH_KEYWORDS = {
    "Python": ["python", "django", "fastapi", "flask"],
    "JavaScript": ["javascript", "node.js", "nodejs", "express"],
    "TypeScript": ["typescript", "ts"],
    "React": ["react", "next.js", "nextjs"],
    "Vue": ["vue", "nuxt"],
    "Angular": ["angular"],
    "Java": ["java", "spring", "spring boot"],
    "Go": ["golang", " go "],
    "C#": ["c#", ".net", "dotnet"],
    "SQL": ["sql", "postgres", "postgresql", "mysql", "database"],
    "MongoDB": ["mongodb", "mongo"],
    "Redis": ["redis", "cache"],
    "AWS": ["aws", "lambda", "ecs", "s3"],
    "Azure": ["azure"],
    "GCP": ["gcp", "google cloud"],
    "Docker": ["docker", "container"],
    "Kubernetes": ["kubernetes", "k8s"],
    "Machine Learning": ["machine learning", "ml", "scikit", "pytorch", "tensorflow"],
    "Data Engineering": ["spark", "airflow", "etl", "data pipeline"],
}

DOMAIN_KEYWORDS = {
    "frontend": ["frontend", "front-end", "react", "vue", "angular", "ui", "ux", "css"],
    "backend": ["backend", "back-end", "api", "microservice", "server", "database"],
    "fullstack": ["fullstack", "full-stack", "front end and back end", "end-to-end"],
    "ml": ["machine learning", "ml engineer", "model training", "pytorch", "tensorflow"],
    "data": ["data engineer", "analytics", "etl", "warehouse", "spark"],
    "devops": ["devops", "platform", "sre", "kubernetes", "ci/cd", "infrastructure"],
}

LEVEL_KEYWORDS = {
    "senior": ["senior", "lead", "principal", "staff", "architect", "7+ years", "8+ years", "10+ years"],
    "mid": ["mid", "3+ years", "4+ years", "5+ years", "6+ years"],
    "junior": ["junior", "entry level", "graduate", "intern", "0-2 years", "1+ years"],
}

SOFT_SKILL_KEYWORDS = {
    "communication": ["communication", "communicate", "stakeholder", "presentation"],
    "teamwork": ["team", "collaborate", "cross-functional", "partner"],
    "ownership": ["ownership", "own", "accountable", "drive"],
    "problem-solving": ["problem solving", "debug", "troubleshoot", "analytical"],
    "leadership": ["mentor", "lead", "coach", "manage"],
}


def train_model() -> dict[str, Any]:
    return {
        "version": 1,
        "tech_keywords": TECH_KEYWORDS,
        "domain_keywords": DOMAIN_KEYWORDS,
        "level_keywords": LEVEL_KEYWORDS,
        "soft_skill_keywords": SOFT_SKILL_KEYWORDS,
    }


def save_model(path: Path = MODEL_PATH, model: dict[str, Any] | None = None) -> Path:
    model = model or train_model()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(model, indent=2, sort_keys=True), encoding="utf-8")
    return path


def _load_model() -> dict[str, Any]:
    if MODEL_PATH.exists():
        try:
            return json.loads(MODEL_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return train_model()


def _contains(text: str, phrase: str) -> bool:
    if phrase.strip() != phrase:
        return phrase in f" {text} "
    return phrase in text


def _score_keywords(text: str, keyword_map: dict[str, list[str]]) -> dict[str, int]:
    scores = {}
    for label, keywords in keyword_map.items():
        score = sum(1 for kw in keywords if _contains(text, kw.lower()))
        if score:
            scores[label] = score
    return scores


def _extract_role_title(jd_text: str, domain: str) -> str:
    lines = [line.strip(" -:\t") for line in jd_text.splitlines() if line.strip()]
    for line in lines[:8]:
        lower = line.lower()
        if any(token in lower for token in ["engineer", "developer", "architect", "scientist", "analyst"]):
            cleaned = re.sub(r"(?i)^(job title|role|position)\s*[:\-]\s*", "", line)
            return cleaned[:80]

    fallback = {
        "frontend": "Frontend Engineer",
        "backend": "Backend Engineer",
        "fullstack": "Full Stack Engineer",
        "ml": "Machine Learning Engineer",
        "data": "Data Engineer",
        "devops": "DevOps Engineer",
    }
    return fallback.get(domain, "Software Engineer")


def infer_jd_profile(jd_text: str) -> dict[str, Any]:
    text = f" {jd_text.lower()} "
    model = _load_model()

    tech_scores = _score_keywords(text, model["tech_keywords"])
    domain_scores = _score_keywords(text, model["domain_keywords"])
    level_scores = _score_keywords(text, model["level_keywords"])
    soft_scores = _score_keywords(text, model["soft_skill_keywords"])

    tech_stack = [name for name, _ in sorted(tech_scores.items(), key=lambda item: (-item[1], item[0]))[:6]]
    domain = max(domain_scores, key=domain_scores.get) if domain_scores else "fullstack"
    level = max(level_scores, key=level_scores.get) if level_scores else "mid"
    if any(word in text for word in [" senior ", " lead ", " principal ", " staff "]):
        level = "senior"
    elif any(word in text for word in [" junior ", " entry level ", " graduate ", " intern "]):
        level = "junior"
    soft_skill_signals = [
        name for name, _ in sorted(soft_scores.items(), key=lambda item: (-item[1], item[0]))[:4]
    ] or ["communication", "teamwork", "problem-solving"]

    company_type = "unknown"
    if any(word in text for word in ["startup", "early stage", "founding"]):
        company_type = "startup"
    elif any(word in text for word in ["enterprise", "fortune", "global company", "large scale"]):
        company_type = "enterprise"

    confidence = 0.0
    confidence += min(len(tech_stack), 4) * 0.12
    confidence += 0.18 if domain_scores else 0
    confidence += 0.14 if level_scores else 0
    confidence += min(len(soft_skill_signals), 3) * 0.06
    confidence = round(min(confidence, 0.92), 2)

    return {
        "role_title": _extract_role_title(jd_text, domain),
        "level": level,
        "tech_stack": tech_stack or ["Python", "JavaScript"],
        "domain": domain,
        "soft_skill_signals": soft_skill_signals,
        "company_type": company_type,
        "_local_model_confidence": confidence,
    }
