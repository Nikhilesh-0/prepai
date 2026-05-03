import asyncio
from app.services.cartesia_service import stream_tts

async def test():
    chunks = []
    print("Starting TTS stream...")
    try:
        async for c in stream_tts('Testing cartesia TTS.'):
            chunks.append(c)
        print(f"Received {len(chunks)} chunks, total size: {sum(len(c) for c in chunks)}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test())
