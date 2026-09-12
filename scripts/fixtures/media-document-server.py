"""Local PCM -> native media ingestion -> durable transcript/audio browser evidence."""
import asyncio
import io
from pathlib import Path
import shutil
import sys
import wave

import uvicorn
from fastapi.responses import HTMLResponse
from scone_memory import HashEmbedder, MemoryEngine
from scone_memory.api import create_app
from scone_memory.backends import SqliteDocumentStore, SqliteVectorIndex
from scone_memory.backends.blobs import FileBlobStore
from scone_memory.ingestion.document_media import DocumentMedia
from scone_memory.ingestion.files import ingest_document
from scone_memory.ingestion.formats.media import MediaDocumentParser, TranscriptionSegment


async def main():
    state, html, port = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
    ffmpeg = shutil.which('ffmpeg')
    assert ffmpeg, 'the media fixture requires an installed local ffmpeg'
    chunked = len(sys.argv) > 4 and sys.argv[4] == 'windows'
    observed_audio = []
    async def transcribe(audio):
        with (state / 'transcription-calls').open('a') as output:
            output.write('transcribe\n')
        observed_audio.append(audio)
        if chunked and len(observed_audio) == 2:
            return ()
        return (TranscriptionSegment(text='Café launch is Friday.', start_seconds=-0.0, end_seconds=0.25),
                TranscriptionSegment(text='Inspect the recorded source.', start_seconds=0.5, end_seconds=0.9))
    media = DocumentMedia(MediaDocumentParser(transcribe, ffmpeg_executable=ffmpeg, chunk_seconds=1 if chunked else None), revision='fixture-v1')
    memory = await MemoryEngine(SqliteDocumentStore(state/'memory.db'), SqliteVectorIndex(state/'memory.db'),
                                HashEmbedder(), blobs=FileBlobStore(state/'blobs')).open()
    if not (state / 'episode-id').exists():
        output = io.BytesIO()
        with wave.open(output, 'wb') as audio:
            audio.setnchannels(2)
            audio.setsampwidth(2)
            audio.setframerate(48000)
            audio.writeframes(b'\0' * 192000 * (3 if chunked else 1))
        saved = await ingest_document(memory, 'alpha', output.getvalue(), filename='café.wav', parser=media.parser())
        combined = io.BytesIO()
        with wave.open(combined, 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(b''.join(part[44:] for part in observed_audio))
        (state / 'transcribed.wav').write_bytes(combined.getvalue())
        (state / 'episode-id').write_text(str(saved.added.episode_id))
    app = create_app(memory, {'media-reader':'alpha', 'media-admin':'alpha'},
                     roles={'media-reader':'read'}, document_media=media)
    @app.get('/memory/sources/{identity}')
    async def console(identity: int):
        return HTMLResponse(html.read_text().replace('__SCONE_TOKEN__', 'media-reader'))
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning'))
    async def commands():
        await asyncio.to_thread(sys.stdin.readline)
        server.should_exit = True
    task = asyncio.create_task(commands())
    try:
        await server.serve()
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await memory.close()


if __name__ == '__main__':
    asyncio.run(main())
