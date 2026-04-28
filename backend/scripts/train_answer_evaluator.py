from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.answer_evaluator import MODEL_PATH, save_model, train_model  # noqa: E402


if __name__ == "__main__":
    path = save_model(MODEL_PATH, train_model())
    print(f"trained answer evaluator -> {path}")
