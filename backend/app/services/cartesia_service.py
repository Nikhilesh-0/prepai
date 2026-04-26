import asyncio
from typing import AsyncGenerator
from app.core.config import settings

# Christopher voice - calm, authoritative
VOICE_ID = "79a125e8-cd45-4c13-8a67-188112f4dd22"
MODEL_ID = "sonic-english"


async def stream_tts(text: str) -> AsyncGenerator[bytes, None]:
    """Stream TTS audio bytes from Cartesia."""
    try:
        from cartesia import AsyncCartesia

        client = AsyncCartesia(api_key=settings.cartesia_api_key)

        # Use the bytes streaming API
        async with client.tts.bytes(
            model_id=MODEL_ID,
            transcript=text,
            voice={"id": VOICE_ID},
            output_format={
                "container": "raw",
                "encoding": "pcm_f32le",
                "sample_rate": 44100,
            },
        ) as response:
            async for chunk in response:
                if chunk:
                    yield chunk

    except Exception as e:
        # Try alternative API shape if the above fails
        try:
            from cartesia import AsyncCartesia

            client = AsyncCartesia(api_key=settings.cartesia_api_key)

            output = await client.tts.bytes(
                model_id=MODEL_ID,
                transcript=text,
                voice={"id": VOICE_ID},
                output_format={
                    "container": "raw",
                    "encoding": "pcm_f32le",
                    "sample_rate": 44100,
                },
            )

            if isinstance(output, bytes):
                # Return in chunks
                chunk_size = 4096
                for i in range(0, len(output), chunk_size):
                    yield output[i:i + chunk_size]
            else:
                async for chunk in output:
                    if chunk:
                        yield chunk

        except Exception as inner_e:
            # Final fallback: try SSE streaming
            try:
                from cartesia import AsyncCartesia

                client = AsyncCartesia(api_key=settings.cartesia_api_key)

                async for event in client.tts.sse(
                    model_id=MODEL_ID,
                    transcript=text,
                    voice={"id": VOICE_ID},
                    output_format={
                        "container": "raw",
                        "encoding": "pcm_f32le",
                        "sample_rate": 44100,
                    },
                ):
                    if hasattr(event, "audio") and event.audio:
                        yield event.audio
                    elif isinstance(event, bytes):
                        yield event

            except Exception as final_e:
                raise RuntimeError(
                    f"All Cartesia TTS attempts failed. Original: {e}, Inner: {inner_e}, Final: {final_e}"
                )
