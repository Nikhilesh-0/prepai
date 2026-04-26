from typing import AsyncGenerator
from app.core.config import settings

VOICE_ID = "79a125e8-cd45-4c13-8a67-188112f4dd22"  # Christopher — calm, authoritative
MODEL_ID = "sonic-english"

# Output format for tts.bytes() — raw PCM float32 little-endian at 44100 Hz
OUTPUT_FORMAT = {
    "container": "raw",
    "encoding": "pcm_f32le",
    "sample_rate": 44100,
}

# Voice specifier — SDK v3 requires {"id": "...", "mode": "id"}
VOICE_SPEC = {
    "id": VOICE_ID,
    "mode": "id",
}


async def stream_tts(text: str) -> AsyncGenerator[bytes, None]:
    """
    Stream TTS audio bytes from Cartesia using SDK v3.

    cartesia==3.x API:
      client.tts.bytes(model_id, output_format, transcript, voice)
      returns AsyncIterator[bytes] — iterate directly, no context manager needed.
    """
    from cartesia import AsyncCartesia

    client = AsyncCartesia(api_key=settings.cartesia_api_key)

    audio_iter = await client.tts.bytes(
        model_id=MODEL_ID,
        transcript=text,
        voice=VOICE_SPEC,
        output_format=OUTPUT_FORMAT,
    )

    async for chunk in audio_iter:
        if chunk:
            yield chunk