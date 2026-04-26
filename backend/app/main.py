from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.routers import sessions, scorecard, ws

app = FastAPI(
    title="PrepAI Backend",
    description="Real-time AI mock interviewer API",
    version="0.1.0",
)

# CORS — allow Vercel frontend and local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_url,
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(sessions.router)
app.include_router(scorecard.router)
app.include_router(ws.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {"message": "PrepAI API", "version": "0.1.0"}
