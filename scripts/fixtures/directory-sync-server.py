"""Private native directory host; pause only the parser to exercise recovery."""
import asyncio
import json
import os
from pathlib import Path
import sys

import uvicorn
from fastapi.responses import HTMLResponse
from scone_memory import HashEmbedder, MemoryEngine
from scone_memory.api.__main__ import build_app
from scone_memory.backends import SqliteDocumentStore, SqliteVectorIndex
from scone_memory.backends.blobs import FileBlobStore
from scone_memory.runtime.config import Settings


async def main():
    state, html, port = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
    root = state / 'notes'
    root.mkdir(exist_ok=True)
    config = state / 'directory.json'
    if not config.exists():
        for index in range(21):
            (root / f'note-{index:02}.txt').write_text(f'Local document {index} for directory synchronization.')
        config.write_text(json.dumps({'schema_version': 1, 'state_dir': 'sync-state',
            'key_env': 'SCONE_FIXTURE_SYNC_KEY', 'store_id': 'directory-browser-fixture',
            'collections': [{'collection_id': 'notes', 'label': 'Local notes', 'root': 'notes',
                'space': 'alpha', 'parser_revision': 'fixture-v1', 'allow_delete_missing': True}]}))
        config.chmod(0o600)
    os.environ['SCONE_FIXTURE_SYNC_KEY'] = 'ab' * 32
    memory = await MemoryEngine(SqliteDocumentStore(state/'memory.db'), SqliteVectorIndex(state/'memory.db'),
                                HashEmbedder(), blobs=FileBlobStore(state/'blobs')).open()
    settings = Settings.from_env({'SCONE_API_KEYS': 'directory-writer:alpha',
                                  'SCONE_DIRECTORY_SYNC_CONFIG': str(config)})
    app = build_app(settings, memory)
    service = app.state.directory_sync_service
    parser = service._collections[('alpha', 'notes')].sync.parser
    original = parser.parse
    async def counted(*args, **kwargs):
        with (state / 'parser-calls').open('a') as output:
            output.write('parse\n')
        while (state / 'pause').exists():
            await asyncio.sleep(.02)
        return await original(*args, **kwargs)
    parser.parse = counted
    @app.get('/memory')
    async def console():
        return HTMLResponse(html.read_text().replace('__SCONE_TOKEN__', 'directory-writer'))
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
        await service.aclose()
        await memory.close()


if __name__ == '__main__':
    asyncio.run(main())
