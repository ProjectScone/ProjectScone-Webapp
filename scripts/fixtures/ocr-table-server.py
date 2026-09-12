"""Real scanned PDF -> local Tesseract -> durable source -> browser inspection."""
import asyncio
import io
from pathlib import Path
import sys

import uvicorn
from fastapi.responses import HTMLResponse
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader
from scone_memory import HashEmbedder, MemoryEngine
from scone_memory.api import create_app
from scone_memory.backends import SqliteDocumentStore, SqliteVectorIndex
from scone_memory.backends.blobs import FileBlobStore
from scone_memory.ingestion.files import ingest_document
from scone_memory.ingestion.formats.registry import BuiltinDocumentParser
from scone_memory.ingestion.pdf_ocr import OcrPdfOptions, OcrPdfParser
from scone_memory.ocr import TesseractOcr


def scan(path):
    image=Image.new('RGB',(2000,1100),'white')
    draw=ImageDraw.Draw(image)
    font=ImageFont.load_default(size=52)
    draw.text((100,70),'Inventory report',font=font,fill='black')
    rows=[('Item','Units','Price'),('Alpha','12','3.50'),('Bravo','24','7.00'),
          ('Cedar','36','9.50'),('Delta','48','12.00')]
    for row,cells in enumerate(rows):
        for x,text in zip((100,700,1400),cells):
            draw.text((x,300+row*85),text,font=font,fill='black')
    draw.text((100,900),'Recorded from a local test scan',font=font,fill='black')
    image.save(path,format='PDF',resolution=150)
    raw=path.read_bytes()
    assert not PdfReader(io.BytesIO(raw)).pages[0].extract_text().strip(), 'fixture must require OCR'
    return raw


async def main():
    state,html,port=Path(sys.argv[1]),Path(sys.argv[2]),int(sys.argv[3])
    memory=await MemoryEngine(SqliteDocumentStore(state/'memory.db'),SqliteVectorIndex(state/'memory.db'),
                              HashEmbedder(),blobs=FileBlobStore(state/'blobs')).open()
    if not (state/'episode-id').exists():
        raw=scan(state/'table-scan.pdf')
        class CountedOcr(TesseractOcr):
            async def recognize(self,*args,**kwargs):
                with (state/'ocr-calls').open('a') as output:
                    output.write('recognize\n')
                return await super().recognize(*args,**kwargs)
        parser=OcrPdfParser(CountedOcr(page_segmentation=6),options=OcrPdfOptions(mode='all_pages'))
        saved=await ingest_document(memory,'alpha',raw,filename='table-scan.pdf',
                                    parser=BuiltinDocumentParser(pdf_parser=parser))
        (state/'episode-id').write_text(str(saved.added.episode_id))
    app=create_app(memory,{'table-fixture':'alpha','other-fixture':'beta','admin-fixture':'alpha'},
                   roles={'table-fixture':'read'})
    @app.get('/memory/sources/{identity}')
    async def console(identity:int):
        return HTMLResponse(html.read_text().replace('__SCONE_TOKEN__','table-fixture'))
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=port,log_level='warning'))
    async def commands():
        await asyncio.to_thread(sys.stdin.readline)
        server.should_exit=True
    task=asyncio.create_task(commands())
    try:
        await server.serve()
    finally:
        task.cancel()
        await asyncio.gather(task,return_exceptions=True)
        await memory.close()


if __name__=='__main__':
    asyncio.run(main())
