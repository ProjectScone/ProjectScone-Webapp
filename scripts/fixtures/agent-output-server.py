"""Real local agent HTTP fixture with persistent journals and scripted models."""
import asyncio
import json
import os
from pathlib import Path
import sys

import uvicorn
from fastapi.responses import HTMLResponse
from scone_memory import HashEmbedder, InMemoryDocumentStore, InMemoryVectorIndex, MemoryEngine
from scone_memory.agents.catalog import AgentCatalog, AgentDefinition, AgentModel
from scone_memory.agents.custom_tools import AgentTool
from scone_memory.agents.evidence_loop import ToolStep
from scone_memory.agents.usage import ModelTokenUsage
from scone_memory.agents.plan_store import AgentPlanStore
from scone_memory.agents.run_service import AgentRunService
from scone_memory.api.app import create_app
from scone_memory.retrieval.recall_scope import RecallScope


async def run():
    state, html, port = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
    memory = await MemoryEngine(InMemoryDocumentStore(), InMemoryVectorIndex(), HashEmbedder()).open()
    class Model:
        def __init__(self, name):
            self.name = name
        async def complete(self, messages, tools):
            with (state / 'calls.jsonl').open('a') as output:
                output.write(json.dumps({'model': self.name, 'messages': messages}) + '\n')
            usage = ModelTokenUsage(prompt_tokens=120, completion_tokens=18, total_tokens=138) if self.name == 'careful' else ModelTokenUsage(prompt_tokens=25)
            if 'Return answer and handoff_to.' in json.dumps(messages):
                writing = any(message.get('content', '').startswith('Write the final answer.') for message in messages)
                value = {'answer': {'name': 'Juniper' if self.name == 'careful' else 2}, 'handoff_to': None} if writing else {'answer': 'Ordinary research notes', 'handoff_to': 'writer'}
                return ToolStep(content=json.dumps(value), usage=usage)
            return ToolStep(content='{"name":"Juniper"}' if self.name == 'careful' else 'Invalid plain-text result', usage=usage)
    application_tools = []
    if os.environ.get('SCONE_TEST_AGENT_TOOLS') == '1':
        def forbidden_tool(arguments, context):
            raise AssertionError('Catalog views must not execute application tools')
        application_tools = [AgentTool('count_records', 'Count local records. <img src=x onerror=alert(1)>',
            'fixture-1', {'type': 'object'}, forbidden_tool)]
    catalog = AgentCatalog(tools=application_tools, models=[AgentModel(name, name.title() + ' local', '1', lambda name=name: Model(name))
                                   for name in ('fast', 'careful')], agents=[AgentDefinition(
        agent_id='worker', instructions='Use the provided direction.', models=('fast', 'careful'),
        default_model='fast', initial_search=False, tools=tuple(tool.name for tool in application_tools)), AgentDefinition(agent_id='writer', instructions='Write the final answer.', models=('fast', 'careful'), default_model='careful', initial_search=False)])
    plans = AgentPlanStore(state / 'plans.sqlite', key=b'k' * 32)
    service = AgentRunService(state / 'runs', key=b'k' * 32, catalog=catalog, plans=plans, memory=memory,
                              scope_for=lambda space: RecallScope.validated())
    app = create_app(memory, {'agent-fixture': 'alpha'}, agent_catalog=catalog,
                     agent_plan_store=plans, agent_run_service=service)
    @app.get('/agents')
    async def console():
        return HTMLResponse(html.read_text().replace('__SCONE_TOKEN__', 'agent-fixture'))
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning'))
    async def commands():
        await asyncio.to_thread(sys.stdin.readline)
        server.should_exit = True
    commands_task = asyncio.create_task(commands())
    try:
        await server.serve()
    finally:
        commands_task.cancel()
        await asyncio.gather(commands_task, return_exceptions=True)
        await service.aclose()
        plans.close()
        await memory.close()


asyncio.run(run())
