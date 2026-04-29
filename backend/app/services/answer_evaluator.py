import math
import re
from typing import Any
import nltk
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# --- Curated Vocabularies & Markers ---

TECH_TERMS = {
    "api", "database", "cache", "query", "service", "component", "deploy",
    "logs", "trace", "test", "architecture", "scalable", "performance",
    "python", "react", "javascript", "typescript", "node", "sql", "nosql",
    "redis", "aws", "docker", "kubernetes", "ci", "cd", "frontend", "backend",
    "microservices", "serverless", "graphql", "rest", "json", "git",
    "pipeline", "endpoint", "ui", "ux", "html", "css", "tcp", "http",
    "latency", "throughput", "concurrency", "async", "await", "thread",
    "index", "orm", "mvc", "repo", "framework", "library", "sdk", "cloud",
    "algorithm", "data", "scaling", "optimization", "monitoring", "metrics",
    "auth", "authentication", "authorization", "security", "encryption"
}

TRANSITION_CATEGORIES = {
    "sequential": {"first", "then", "next", "finally", "afterward", "before", "initially", "subsequently"},
    "causal": {"because", "so", "therefore", "thus", "consequently", "as a result", "since", "due to"},
    "contrast": {"but", "however", "although", "yet", "instead", "on the other hand", "despite", "while"},
}

STAR_CUES = {
    "situation_task": {"context", "problem", "issue", "goal", "asked to", "needed to", "situation", "challenge", "responsibility", "project", "disagreed", "conflict"},
    "action": {"decided", "implemented", "built", "created", "developed", "wrote", "led", "analyzed", "used", "approach", "discussed", "explained"},
    "result": {"result", "improved", "reduced", "increased", "achieved", "delivered", "outcome", "successfully", "impact", "saved", "decreased"},
}

# Ensure nltk punkt is downloaded (silently)
try:
    nltk.data.find('tokenizers/punkt')
    nltk.data.find('tokenizers/punkt_tab')
except LookupError:
    nltk.download('punkt', quiet=True)
    nltk.download('punkt_tab', quiet=True)


def check_star_structure(text: str) -> dict[str, bool]:
    lower_text = text.lower()
    has_st = any(cue in lower_text for cue in STAR_CUES["situation_task"])
    has_a = any(cue in lower_text for cue in STAR_CUES["action"])
    has_r = any(cue in lower_text for cue in STAR_CUES["result"])
    return {"situation_task": has_st, "action": has_a, "result": has_r}


def check_specificity(text: str) -> dict[str, int]:
    lower_text = text.lower()
    
    # Metrics (numbers + units/magnitudes)
    metrics = len(re.findall(r"\b\d+(?:\.\d+)?\s*(?:%|percent|ms|milliseconds|s|seconds|m|minutes|h|hours|users|requests|mb|gb|tb|k|m)\b", lower_text))
    
    # Tech terms (overlap with curated vocab)
    tokens = set(nltk.word_tokenize(lower_text))
    tech_count = len(tokens.intersection(TECH_TERMS))
    
    # Temporal anchors
    temporal = len(re.findall(r"\b(?:yesterday|today|last (?:week|month|year)|in \d+ (?:days|weeks|months|years)|recently|previously)\b", lower_text))
    
    return {"metrics": metrics, "tech_terms": tech_count, "temporal_anchors": temporal}


def get_root_ttr(text: str) -> float:
    tokens = [t.lower() for t in nltk.word_tokenize(text) if t.isalnum()]
    total = len(tokens)
    if total == 0:
        return 0.0
    unique = len(set(tokens))
    return unique / math.sqrt(total)


def check_coherence(text: str) -> dict[str, Any]:
    lower = text.lower()
    used_categories = set()
    for cat, markers in TRANSITION_CATEGORIES.items():
        if any(m in lower for m in markers):
            used_categories.add(cat)
    return {"categories": list(used_categories), "count": len(used_categories)}


def get_relevance(question: str, answer: str) -> float:
    if not answer.strip():
        return 0.0
    try:
        vectorizer = TfidfVectorizer(stop_words='english')
        tfidf = vectorizer.fit_transform([question, answer])
        similarity = cosine_similarity(tfidf[0:1], tfidf[1:2])[0][0]
        return round(float(similarity), 3)
    except ValueError:
        return 0.0


def evaluate_answer(
    question: str,
    transcript: str,
    interview_profile: dict | None = None,
) -> dict[str, Any]:
    """Evaluate one answer using deterministic rules instead of an ML classifier."""
    clean = (transcript or "").strip()
    word_count = len([t for t in clean.split() if t.strip()])
    
    # Base cases for no response or extremely short answer
    if not clean or clean.lower() in {"(no response)", "no response"} or word_count < 6:
        return {
            "label": "too_short" if word_count > 0 else "no_response",
            "confidence": 1.0,
            "word_count": word_count,
            "keyword_overlap": 0.0,
            "scores": {"relevance": 0, "depth": 0, "structure": 0, "specificity": 0},
            "overall_answer_score": 0,
            "should_follow_up": True,
            "reason": "The answer is missing or too short to evaluate.",
        }

    # Deterministic Measurements
    star = check_star_structure(clean)
    specificity = check_specificity(clean)
    ttr = get_root_ttr(clean)
    coherence = check_coherence(clean)
    relevance_score = get_relevance(question, clean)
    
    follow_up_reasons = []
    
    # Missing Result (Critical for behavioral or comprehensive answers)
    if not star["result"]:
        follow_up_reasons.append("The answer lacks a measurable outcome or result.")
        
    # Vague Specificity
    if specificity["metrics"] == 0 and specificity["tech_terms"] < 2:
        follow_up_reasons.append("The answer is vague and needs concrete metrics or technical details.")
        
    # Low Discourse Coherence
    if coherence["count"] == 0:
        follow_up_reasons.append("The answer lacks logical flow and transition markers.")
        
    # Low Relevance to Question
    if relevance_score < 0.01 and specificity["tech_terms"] == 0 and word_count > 10:
        follow_up_reasons.append("The answer appears off-topic and lacks relevant terminology.")

    should_follow_up = len(follow_up_reasons) > 0
    final_reason = " ".join(follow_up_reasons) if should_follow_up else "The answer is specific, structured, and relevant."
    
    label = "adequate"
    if not should_follow_up:
        if specificity["metrics"] > 0 and star["result"]:
            label = "strong"
    else:
        if relevance_score < 0.01 and specificity["tech_terms"] == 0:
            label = "off_topic"
        elif specificity["metrics"] == 0 and specificity["tech_terms"] < 2:
            label = "vague"

    # Compute deterministic component scores (0-100 scale)
    relevance_metric = min(100, int(relevance_score * 500))  # Scale TF-IDF to 0-100
    depth_metric = min(100, int((specificity["tech_terms"] * 10) + (specificity["metrics"] * 15) + (ttr * 5)))
    structure_metric = min(100, int((coherence["count"] * 20) + (sum(star.values()) * 15)))
    specificity_metric = min(100, int((specificity["metrics"] * 20) + (specificity["tech_terms"] * 10) + (specificity["temporal_anchors"] * 5)))
    
    scores = {
        "relevance": relevance_metric,
        "depth": depth_metric,
        "structure": structure_metric,
        "specificity": specificity_metric,
    }
    avg_score = round(sum(scores.values()) / 4)
    if avg_score < 55:
        should_follow_up = True

    return {
        "label": label,
        "confidence": 1.0,
        "word_count": word_count,
        "keyword_overlap": relevance_score, # maintain interface field name, but mapped to tf-idf score
        "scores": scores,
        "overall_answer_score": avg_score,
        "should_follow_up": should_follow_up,
        "reason": final_reason or "The answer requires a follow-up for more depth.",
    }
