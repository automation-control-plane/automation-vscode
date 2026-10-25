"""Optional real MCP 2.3 transport smoke; synthetic tools, NOT Runtime/RCC QA.

Run with the pinned MCP 2.3.0 SDK in a task-owned environment. No endpoint,
credentials, Runtime database or Work Items are provisioned by this smoke.
"""
import importlib.metadata
import json
import socket
import subprocess
import threading
import time
from pathlib import Path


def main():
    import uvicorn
    from mcp.server import Server
    from mcp.types import Tool, CallToolResult, ListToolsResult
    from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter
    from typing import Literal

    assert importlib.metadata.version("mcp") == "2.3.0"
    assert importlib.metadata.version("mcp-types") == "2.3.0"
    root = Path(__file__).resolve().parents[1]
    schemas = json.loads((root / "resources/work-items/managed-mcp-schemas.json").read_text())
    # Independently check the source-derived wrapper schema against Pydantic's
    # real generation. Reference definitions are separately pinned by managed-v1.
    class ExecutionSnapshot(BaseModel): pass
    class ClaimRef(BaseModel): pass
    class ReviewProposal(BaseModel): pass
    class ReviewedDispatch(BaseModel):
        model_config = ConfigDict(frozen=True, extra="forbid", strict=True)
        binding_id: str = Field(alias="bindingId", pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
        proposal: ReviewProposal
    class _GenericRequest(BaseModel):
        model_config = ConfigDict(frozen=True, extra="forbid", strict=True)
        mode: Literal["generic"]
        snapshot: ExecutionSnapshot
    class GenericClaimInvocation(_GenericRequest):
        claim: ClaimRef
    class GenericStandaloneInvocation(_GenericRequest):
        inputs: dict[str, JsonValue]
        idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=128)
    generated = TypeAdapter(ReviewedDispatch | GenericClaimInvocation | GenericStandaloneInvocation).json_schema()
    for name in ("ReviewedDispatch", "GenericClaimInvocation", "GenericStandaloneInvocation"):
        assert generated["$defs"][name] == schemas["capability_invoke"]["$defs"][name], name
    fixture = json.loads(subprocess.check_output(["node", "-e", "console.log(JSON.stringify(require('./tests/fixtures/managed_execution').fixture()))"], cwd=root))
    seen = []
    async def list_tools(ctx, params):
        return ListToolsResult(tools=[Tool(name=name, inputSchema=schema, _meta={"ui": {"visibility": ["model"]}}) for name, schema in schemas.items()])
    async def call_tool(ctx, params):
        seen.append(params.name)
        if params.name == "canvas_open":
            result = {"applications": [{"applicationId": fixture["inspection"]["applicationId"], "title": "SDK transport fixture", "activeRevisionId": fixture["inspection"]["activeRevisionId"]}]}
        elif params.name == "canvas_inspect": result = fixture["inspection"]
        elif params.name == "capability_invoke":
            assert params.arguments == {"mode": "generic", "snapshot": fixture["descriptor"]["snapshot"], "claim": fixture["item"]["claim"]}
            result = {"execution": {"state": "completed", "runStatus": 2, "attemptState": "succeeded", "workItemState": "COMPLETED", "runId": fixture["item"]["id"], "attemptId": fixture["inspection"]["applicationId"], "attemptEpoch": 1, "workItemId": fixture["item"]["id"], "workItemEpoch": 3}}
        else: raise AssertionError(params.name)
        return CallToolResult(content=[], structuredContent=result)
    server = Server("Action Server", on_list_tools=list_tools, on_call_tool=call_tool)
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    runner = uvicorn.Server(uvicorn.Config(server.streamable_http_app(json_response=True, stateless_http=True), log_level="error"))
    thread = threading.Thread(target=lambda: runner.run(sockets=[sock]), daemon=True); thread.start()
    try:
        deadline = time.monotonic() + 10
        while not runner.started:
            if time.monotonic() > deadline: raise RuntimeError("MCP smoke server did not start")
            time.sleep(.02)
        script = """
        (async()=>{
          const {ManagedExecutionClient}=require('./vscode-client/out/managedExecutionClient');
          const {buildManagedClaimInvocation}=require('./vscode-client/out/managedExecutionSelection');
          const {fixture}=require('./tests/fixtures/managed_execution');const f=fixture();
          const client=new ManagedExecutionClient(process.argv[1],'synthetic-token',f.descriptor.inputQueue.workspace_id);
          await client.negotiate();const [app]=await client.applications();const [descriptor]=await client.descriptors(app.applicationId);
          const result=await client.invokeClaim(buildManagedClaimInvocation(descriptor,f.item),f.item.id);
          console.log(JSON.stringify({classification:'real MCP 2.3 transport; synthetic execution',result}));
        })().catch(e=>{console.error(e.message);process.exitCode=1;});
        """
        subprocess.run(["node", "-e", script, f"http://127.0.0.1:{port}"], cwd=root, timeout=30, check=True)
        assert seen == ["canvas_open", "canvas_inspect", "capability_invoke"]
    finally:
        runner.should_exit = True; thread.join(5); sock.close()


if __name__ == "__main__": main()
