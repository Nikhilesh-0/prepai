import os
import json
import random
import joblib
import numpy as np
from pathlib import Path
from sklearn.ensemble import RandomForestRegressor

MODEL_DIR = Path(__file__).resolve().parents[1] / "app" / "ml"
MODEL_PATH = MODEL_DIR / "final_grader.joblib"

def generate_synthetic_data(num_samples=1000):
    """
    Generate synthetic deterministic features for an interview.
    Features:
    - avg_ttr (0.0 to 1.0)
    - total_tech_terms (0 to 20+)
    - total_metrics (0 to 10+)
    - avg_relevance (0.0 to 1.0)
    - star_completion_rate (0.0 to 1.0)
    - coherence_categories (0 to 3)
    
    Targets:
    - overall_score (0-100)
    - technical_score (0-100)
    - communication_score (0-100)
    """
    X = []
    Y = []
    
    for _ in range(num_samples):
        # Generate random base capabilities
        is_strong = random.random() > 0.6
        is_weak = random.random() < 0.2
        
        if is_strong:
            ttr = random.uniform(0.7, 0.95)
            tech = random.randint(5, 15)
            metrics = random.randint(2, 6)
            relevance = random.uniform(0.4, 0.9)
            star = random.uniform(0.7, 1.0)
            coherence = random.randint(2, 3)
        elif is_weak:
            ttr = random.uniform(0.3, 0.6)
            tech = random.randint(0, 3)
            metrics = random.randint(0, 1)
            relevance = random.uniform(0.0, 0.3)
            star = random.uniform(0.0, 0.4)
            coherence = random.randint(0, 1)
        else:
            ttr = random.uniform(0.5, 0.8)
            tech = random.randint(2, 8)
            metrics = random.randint(0, 3)
            relevance = random.uniform(0.2, 0.6)
            star = random.uniform(0.4, 0.8)
            coherence = random.randint(1, 2)
            
        # Target logic: deterministic function mimicking ATS grading
        technical = min(100, int((tech * 6) + (metrics * 8) + (relevance * 20)))
        communication = min(100, int((ttr * 50) + (star * 30) + (coherence * 10)))
        overall = int((technical * 0.6) + (communication * 0.4))
        
        # Add some noise to make the random forest actually learn relationships rather than exact formulas
        technical = min(100, max(0, technical + random.randint(-5, 5)))
        communication = min(100, max(0, communication + random.randint(-5, 5)))
        overall = min(100, max(0, overall + random.randint(-3, 3)))
        
        X.append([ttr, tech, metrics, relevance, star, coherence])
        Y.append([overall, technical, communication])
        
    return np.array(X), np.array(Y)

def train_and_save():
    print("Generating 2,000 synthetic deterministic interview profiles...")
    X, Y = generate_synthetic_data(2000)
    
    print("Training RandomForestRegressor (multi-output)...")
    # Using a shallow forest so it's blazing fast
    model = RandomForestRegressor(n_estimators=50, max_depth=8, random_state=42)
    model.fit(X, Y)
    
    score = model.score(X, Y)
    print(f"R^2 Score on training data: {score:.3f}")
    
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    print(f"Model saved to {MODEL_PATH}")
    
if __name__ == "__main__":
    train_and_save()
