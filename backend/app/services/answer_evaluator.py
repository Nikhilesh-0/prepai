import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


LABELS = ["no_response", "too_short", "off_topic", "vague", "adequate", "strong"]
MODEL_PATH = Path(__file__).resolve().parents[1] / "ml" / "answer_evaluator_model.json"

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "could", "did",
    "do", "for", "from", "how", "i", "in", "is", "it", "of", "on", "or",
    "our", "that", "the", "their", "this", "to", "was", "we", "what",
    "when", "where", "which", "with", "would", "you", "your",
}

TRAINING_EXAMPLES = [
    ("no_response", ""),
    ("no_response", "I do not know."),
    ("no_response", "Sorry, I have no answer."),
    ("no_response", "I am not sure."),
    ("too_short", "Yes, I have done that before."),
    ("too_short", "I used Python for it."),
    ("too_short", "Mostly teamwork and communication."),
    ("too_short", "I would check the logs."),
    ("off_topic", "My hobby is music and I like travelling with friends."),
    ("off_topic", "The weather was nice and I enjoyed the office location."),
    ("off_topic", "I prefer tea over coffee and usually work in the morning."),
    ("off_topic", "I watched a video about this once but cannot remember."),
    ("vague", "I worked on many projects and handled different tasks successfully."),
    ("vague", "I would try to debug it by checking things and fixing the problem."),
    ("vague", "I helped the team and made sure the project was completed on time."),
    ("vague", "I generally use best practices and make the code scalable."),
    ("adequate", "I would start by reproducing the issue, checking logs, and isolating the failing service before making a small fix."),
    ("adequate", "In one project I built an API endpoint, added tests, and coordinated with the frontend team to ship it."),
    ("adequate", "For conflict, I listened to the concern, clarified the tradeoff, and agreed on a measurable next step."),
    ("adequate", "I used React state carefully, split components, and reviewed performance when the page became slow."),
    ("strong", "In my last project, I reduced API latency from 900 milliseconds to 250 milliseconds by adding Redis caching, measuring slow queries, and moving one expensive aggregation to a background job."),
    ("strong", "When a production deploy failed, I rolled back, compared traces, found a missing migration, wrote a regression test, and added a checklist item so it would not repeat."),
    ("strong", "For a React dashboard, I used memoization only after profiling, moved derived state out of render, and reduced unnecessary network calls by batching requests."),
    ("strong", "A teammate and I disagreed on architecture, so I wrote a short design doc with tradeoffs, we reviewed failure modes, and picked the simpler option based on expected traffic."),
]


def _tokenize(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOPWORDS]


def train_model(examples: list[tuple[str, str]] | None = None) -> dict[str, Any]:
    """Train a tiny multinomial Naive Bayes model from labeled examples."""
    examples = examples or TRAINING_EXAMPLES
    label_counts = Counter()
    token_counts: dict[str, Counter] = defaultdict(Counter)
    vocabulary = set()

    for label, text in examples:
        if label not in LABELS:
            raise ValueError(f"Unknown label: {label}")
        label_counts[label] += 1
        tokens = _tokenize(text)
        token_counts[label].update(tokens)
        vocabulary.update(tokens)

    vocab_size = max(1, len(vocabulary))
    total_examples = sum(label_counts.values())

    return {
        "version": 1,
        "labels": LABELS,
        "priors": {
            label: math.log((label_counts[label] + 1) / (total_examples + len(LABELS)))
            for label in LABELS
        },
        "token_counts": {label: dict(token_counts[label]) for label in LABELS},
        "label_token_totals": {
            label: sum(token_counts[label].values())
            for label in LABELS
        },
        "vocabulary": sorted(vocabulary),
        "vocab_size": vocab_size,
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


def _predict_label(text: str, model: dict[str, Any]) -> tuple[str, float]:
    tokens = _tokenize(text)
    if not tokens:
        return "no_response", 0.98

    vocab_size = int(model.get("vocab_size") or 1)
    scores = {}
    for label in model.get("labels", LABELS):
        score = float(model["priors"].get(label, -10.0))
        counts = model["token_counts"].get(label, {})
        total = int(model["label_token_totals"].get(label, 0))
        for token in tokens:
            score += math.log((counts.get(token, 0) + 1) / (total + vocab_size))
        scores[label] = score

    max_score = max(scores.values())
    probs = {label: math.exp(score - max_score) for label, score in scores.items()}
    total_prob = sum(probs.values()) or 1.0
    probs = {label: prob / total_prob for label, prob in probs.items()}
    label = max(probs, key=probs.get)
    return label, round(probs[label], 3)


def _keyword_overlap(question: str, transcript: str, profile: dict | None) -> float:
    question_tokens = set(_tokenize(question))
    profile_terms = set()
    if profile:
        profile_terms.update(_tokenize(profile.get("role_title") or ""))
        profile_terms.update(_tokenize(profile.get("domain") or ""))
        for tech in profile.get("tech_stack") or []:
            profile_terms.update(_tokenize(str(tech)))

    expected = question_tokens | profile_terms
    answer_tokens = set(_tokenize(transcript))
    if not expected or not answer_tokens:
        return 0.0
    return len(expected & answer_tokens) / len(expected)


def _score_answer(question: str, transcript: str, profile: dict | None) -> dict[str, int]:
    words = _tokenize(transcript)
    word_count = len(words)
    overlap = _keyword_overlap(question, transcript, profile)
    lower = transcript.lower()

    structure_markers = sum(marker in lower for marker in [
        "first", "then", "because", "so that", "result", "tradeoff", "for example",
        "in my last", "when i", "i would", "i did",
    ])
    specificity_markers = len(re.findall(r"\d+|percent|ms|milliseconds|users|requests|latency|error|test|metric", lower))
    technical_markers = sum(marker in lower for marker in [
        "api", "database", "cache", "query", "service", "component", "deploy",
        "logs", "trace", "test", "architecture", "scalable", "performance",
    ])

    relevance = min(100, int(35 + overlap * 130 + min(word_count, 80) * 0.35))
    depth = min(100, int(20 + min(word_count, 110) * 0.45 + technical_markers * 8 + specificity_markers * 6))
    structure = min(100, int(25 + structure_markers * 14 + min(word_count, 90) * 0.3))
    specificity = min(100, int(20 + specificity_markers * 12 + technical_markers * 5 + overlap * 40))

    if word_count < 8:
        relevance = min(relevance, 35)
        depth = min(depth, 25)
        structure = min(structure, 30)
        specificity = min(specificity, 25)

    return {
        "relevance": relevance,
        "depth": depth,
        "structure": structure,
        "specificity": specificity,
    }


def evaluate_answer(
    question: str,
    transcript: str,
    interview_profile: dict | None = None,
) -> dict[str, Any]:
    """Evaluate one answer with a small trained classifier plus deterministic guardrails."""
    clean = (transcript or "").strip()
    words = _tokenize(clean)
    word_count = len(words)
    model = _load_model()
    label, confidence = _predict_label(clean, model)
    overlap = _keyword_overlap(question, clean, interview_profile)

    if not clean or clean.lower() in {"(no response)", "no response"}:
        label, confidence = "no_response", 0.99
    elif word_count < 6:
        label, confidence = "too_short", max(confidence, 0.9)
    elif word_count >= 10 and overlap < 0.03 and label not in {"adequate", "strong"}:
        label, confidence = "off_topic", max(confidence, 0.82)
    elif label == "strong" and word_count < 28:
        label = "adequate"

    scores = _score_answer(question, clean, interview_profile)
    avg_score = round(sum(scores.values()) / len(scores))

    should_follow_up = label in {"no_response", "too_short", "off_topic", "vague"} or avg_score < 55
    reasons = {
        "no_response": "The candidate did not provide a usable answer.",
        "too_short": "The answer is too short to judge depth.",
        "off_topic": "The answer appears weakly related to the question.",
        "vague": "The answer needs a concrete example, metric, or technical detail.",
        "adequate": "The answer is usable but could be deeper.",
        "strong": "The answer is specific and structured enough to move on.",
    }

    return {
        "label": label,
        "confidence": confidence,
        "word_count": word_count,
        "keyword_overlap": round(overlap, 3),
        "scores": scores,
        "overall_answer_score": avg_score,
        "should_follow_up": should_follow_up,
        "reason": reasons[label],
    }
