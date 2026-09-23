#!/usr/bin/env python3
"""Real OpenCode integration test against a deterministic, local model.

Requires a built Rust server and the pinned OpenCode binary. No provider account,
network model, user data or paid API is used. All outputs live in a temporary dir.
"""
import json
import base64
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WEB = Path(__file__).resolve().parent.parent


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def request(origin, path, data):
    req = urllib.request.Request(origin + path, data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raise AssertionError(error.read().decode()) from error


def main():
    with tempfile.TemporaryDirectory(prefix='wg-runtime-e2e-') as directory:
        root = Path(directory)
        work = root / 'workspace/workflows/project-a/sessions/session-a'
        seen_mcp = []
        approvals = []

        class Model(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if self.path.endswith('/messages'):
                    assert self.headers.get('Authorization') == 'Bearer not-a-real-key'
                    self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                    events = [
                        {'type': 'message_start', 'message': {'id': 'msg_fixture', 'type': 'message', 'role': 'assistant', 'content': [], 'model': 'fixture', 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 1, 'output_tokens': 0}}},
                        {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}},
                        {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': 'Anthropic transport verified.'}},
                        {'type': 'content_block_stop', 'index': 0},
                        {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': 4}},
                        {'type': 'message_stop'},
                    ]
                    for event in events: self.wfile.write(('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n').encode())
                    self.wfile.flush(); return
                if '/models/' in self.path:
                    assert self.headers.get('x-goog-api-key') == 'not-a-real-key'
                    assert 'alt=sse' in self.path
                    self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                    payload = {'candidates': [{'content': {'role': 'model', 'parts': [{'text': 'Gemini transport verified.'}]}, 'finishReason': 'STOP', 'index': 0}], 'usageMetadata': {'promptTokenCount': 1, 'candidatesTokenCount': 4, 'totalTokenCount': 5}, 'modelVersion': 'fixture'}
                    self.wfile.write(('data: ' + json.dumps(payload) + '\n\n').encode()); self.wfile.flush(); return
                messages = body['messages']
                latest = next((m['content'] for m in reversed(messages) if m['role'] == 'user'), '')
                latest = latest if isinstance(latest, str) else json.dumps(latest)
                tool_calls = sum(len(m.get('tool_calls', [])) for m in messages[messages.index(next(m for m in reversed(messages) if m['role'] == 'user')) + 1:] if m['role'] == 'assistant')
                if 'CHILD_PROMPT' in latest:
                    assert any('只读 Router' in str(m.get('content')) and '共享工作区索引' in str(m.get('content')) for m in messages if m['role'] == 'system')
                    steps = [('wg_hub_plan_get', {'planId': 'fixture', 'role': 'orchestrator', '_wg_ticket': 'model-forgery'}),
                             ('wg_hub_canvas_write_node', {'content': 'FORBIDDEN_CHILD_WRITE'})]
                    final = '{"route":"direct","reason":"read-only test"}'
                elif 'RUN_CHILD' in latest:
                    steps = [('task', {'subagent_type': 'router', 'description': 'Read-only child', 'prompt': 'CHILD_PROMPT: return a direct route'})]
                    final = 'Child completed.'
                elif 'DENY_PROBE' in latest:
                    steps = [('bash', {'command': 'touch denied.txt', 'description': 'Denial test'})]
                    final = 'Denied operation was not executed.'
                elif 'STOP_PROBE' in latest:
                    steps = [('bash', {'command': 'sleep 10; touch should-not-exist.txt', 'description': 'Cancellation test'})]
                    final = 'Stopped.'
                else:
                    steps = [
                        ('read', {'filePath': str(work / 'skills/test-skill/SKILL.md')}),
                        ('write', {'filePath': str(work / 'scripts/build.py'), 'content': 'from pathlib import Path\nPath("outputs").mkdir(exist_ok=True)\nPath("outputs/result.txt").write_text("native-runtime-ok: 42")\nprint("native-runtime-ok: 42")\n'}),
                        ('bash', {'command': 'python3 scripts/build.py', 'description': 'Run generated script'}),
                        ('read', {'filePath': str(work / 'outputs/result.txt')}),
                        ('wg_hub_canvas_write_node', {'content': 'native-runtime-ok: 42', 'name': 'Runtime output'}),
                    ]
                    final = 'Script and canvas completed.'
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.end_headers()
                def emit(delta, finish=None):
                    value = {'id': 'chatcmpl-fixture', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': 'fixture', 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
                    self.wfile.write(('data: ' + json.dumps(value) + '\n\n').encode())
                    self.wfile.flush()
                try:
                    emit({'role': 'assistant'})
                    if tool_calls < len(steps):
                        name, args = steps[tool_calls]
                        emit({'tool_calls': [{'index': 0, 'id': f'call_{tool_calls}', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]})
                        emit({}, 'tool_calls')
                    else:
                        for word in final.split(' '):
                            emit({'content': word + ' '})
                            time.sleep(.01)
                        emit({}, 'stop')
                    self.wfile.write(b'data: [DONE]\n\n')
                except (BrokenPipeError, ConnectionResetError): pass

        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        port = free_port()
        origin = f'http://127.0.0.1:{port}'
        environment = {**os.environ, 'WG_PORT': str(port), 'WG_DATA_DIR': str(root), 'WG_STATIC_DIR': str(WEB / 'dist')}
        log = open(root / 'server.log', 'w')
        def boot():
            process = subprocess.Popen([str(WEB / 'server/target/debug/workflowgenerator-server')], env=environment, stdout=log, stderr=log)
            for _ in range(100):
                try:
                    request(origin, '/api/store/get', {'namespace': 'qa', 'key': 'ready'})
                    return process
                except (OSError, AssertionError): time.sleep(.1)
            raise AssertionError('Backend did not start')
        server = boot()
        identity = {'projectId': 'project-a', 'sessionId': 'session-a'}
        tools = [{'name': 'hub_canvas_write_node', 'description': 'Write a canvas text node', 'parameters': {'type': 'object', 'properties': {'name': {'type': 'string'}, 'content': {'type': 'string'}}, 'required': ['content']}}]
        tools.append({'name': 'hub_plan_get', 'description': 'Read a plan', 'parameters': {'type': 'object', 'properties': {'planId': {'type': 'string'}}}})
        def start(turn, text, scope=identity, **extra):
            return request(origin, '/api/agent/start', {**scope, 'turnId': turn, 'text': text, 'system': 'Use the actual tools; do not invent results.', 'tools': tools, 'skills': [{'id': 'test-skill', 'description': 'Test skill', 'body': 'Read files and run the provided script.'}], **extra})
        def drive(mode='allow', scope=identity):
            handled = set()
            for _ in range(400):
                state = request(origin, '/api/agent/state', scope)
                for permission in state['permissions']:
                    if permission['id'] in handled: continue
                    handled.add(permission['id'])
                    approvals.append(permission['permission'])
                    if permission['permission'] == 'edit':
                        assert not (work / 'scripts/build.py').exists(), 'Write happened before approval'
                    request(origin, '/api/agent/permission', {**scope, 'id': permission['id'], 'result': mode != 'deny'})
                    if mode == 'stop':
                        time.sleep(.3)
                        request(origin, '/api/agent/abort', scope)
                        return state
                for tool in state['tools']:
                    if tool['callId'] in handled: continue
                    handled.add(tool['callId']); seen_mcp.append(tool['name'])
                    actor = tool['context']
                    assert actor['rootSessionId'] == scope['sessionId'] and actor['turnId']
                    assert actor['nativeCallId'] and actor['taskId'].startswith('ses_')
                    assert '_wg_ticket' not in tool['args']
                    if tool['name'] == 'hub_plan_get':
                        assert actor['role'] == 'router' and actor['taskId'] != native
                        request(origin, '/api/agent/tool-result', {**scope, 'id': tool['callId'], 'result': {'ok': True, 'result': {'planId': 'fixture'}}})
                        continue
                    assert actor['role'] == 'orchestrator'
                    # The production UI executes this same durable canvas API.
                    value = json.dumps({'id': 'project-a', 'nodes': [{'id': 'output', 'type': 'text', 'metadata': {'content': tool['args']['content']}}]})
                    request(origin, '/api/canvas/commit', {'changes': [{'id': 'project-a', 'expected': None, 'value': value}]})
                    request(origin, '/api/agent/tool-result', {**scope, 'id': tool['callId'], 'result': {'ok': True, 'result': {'nodeId': 'output'}}})
                messages = [m for m in state['messages'] if m['info']['role'] == 'assistant']
                for message in messages:
                    assert not message['info'].get('error'), message['info'].get('error')
                if messages and messages[-1]['info'].get('time', {}).get('completed') and (not state['status'] or state['status']['type'] == 'idle'):
                    return state
                time.sleep(.15)
            raise AssertionError('Runtime timed out: ' + json.dumps({'status':state['status'],'pendingTools':state['tools'],'permissions':state['permissions'],'last':state['messages'][-1:]}, ensure_ascii=False)[:6000])
        try:
            config = {'state': {'config': {'textModel': 'qa::fixture', 'channels': [{'id': 'qa', 'baseUrl': f'http://127.0.0.1:{model.server_port}/v1', 'apiFormat': 'openai', 'apiKey': 'not-a-real-key', 'models': [{'name': 'fixture', 'capability': 'text'}]}]}}, 'version': 3}
            request(origin, '/api/store/set', {'namespace': 'zustand-v1', 'key': 'workflowgenerator:ai_config_store', 'value': json.dumps(config)})
            native = start('turn-1', 'Run the skill, script and canvas test.')['sessionId']
            drive()
            monitor = request(origin, '/api/agent/monitor', {})
            assert monitor['name'] == 'Zodiac Runtime'
            assert Path(monitor['workspace']) / monitor['sessions'][0]['directory'] == work
            assert monitor['sessions'][0]['pid'] > 0
            assert monitor['sessions'][0]['approvals'] == 0
            assert (work / 'outputs/result.txt').read_text() == 'native-runtime-ok: 42'
            assert {'edit', 'bash'} <= set(approvals)
            assert seen_mcp == ['hub_canvas_write_node']
            stored = request(origin, '/api/store/get', {'namespace': 'canvas-project-v1', 'key': 'project-a'})
            assert 'native-runtime-ok: 42' in stored
            imported = request(origin, '/api/agent/import', {**identity, 'path': 'outputs/result.txt', 'callId': 'import-qa'})
            assert imported['content'] == 'native-runtime-ok: 42'
            png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=')
            upload=urllib.request.Request(origin+'/api/media/put-raw',data=png,headers={'Content-Type':'image/png','x-wg-bucket':'images','x-wg-key':'image%3Afixture'})
            with urllib.request.urlopen(upload) as response: assert response.status==200
            request(origin,'/api/agent/assets',{**identity,'assets':[{'id':'reference','name':'reference.png','type':'image','storageKey':'image:fixture','resultVersionId':'v1'}, {'id':'script','name':'script','type':'text','content':'完整剧本'*10000}, {'id':'missing','type':'image','storageKey':'image:missing'}]})
            index=json.loads((work/'.hilo/assets.json').read_text())
            assert (work/'.hilo/.blobs'/index[0]['blobRef']).read_bytes()==png
            manifest=json.loads((work/'.zodiac/assets.json').read_text())
            assert manifest['version']==2 and manifest['assets'][0]['resultVersionId']=='v1'
            assert (work/manifest['assets'][1]['path']).read_text()=='完整剧本'*10000
            assert manifest['assets'][2]['ready'] is False and 'path' not in manifest['assets'][2]
            old_path=work/manifest['assets'][1]['path']
            request(origin,'/api/agent/assets',{**identity,'assets':[{'id':'script','name':'script','type':'text','content':'新版剧本'}]})
            newer=json.loads((work/'.zodiac/assets.json').read_text())
            assert newer['revision']!=manifest['revision'] and (work/newer['assets'][0]['path']).read_text()=='新版剧本'
            assert old_path.read_text()=='完整剧本'*10000
            assert (work/'.zodiac/manifests'/f"{manifest['revision']}.json").exists()
            request(origin,'/api/agent/file',{**identity,'path':'references/reference.png','storageKey':'image:fixture'})
            media=request(origin,'/api/agent/import',{**identity,'path':'references/reference.png','callId':'image-import'})
            assert media['kind']=='image' and media['storageKey'].startswith('image:agent-')
            start('turn-attachments', 'DENY_PROBE', attachments=[{'type':'file','mime':'image/png','url':'data:image/png;base64,'+base64.b64encode(png).decode()}])
            drive('deny')
            attachment=json.loads((work/'.zodiac/assets.json').read_text())['assets'][0]
            assert attachment['origin']=='message_attachment' and attachment['nodeId'] is None
            assert (work/attachment['path']).read_bytes()==png
            request(origin,'/api/agent/assets',{**identity,'assets':[]})
            assert json.loads((work/'.zodiac/assets.json').read_text())['assets'][0]['path']==attachment['path']
            start('turn-2', 'RUN_CHILD')
            state = drive()
            assert len(state['children']) == 1, 'Native child session missing'
            assert seen_mcp == ['hub_canvas_write_node', 'hub_plan_get'], 'Child escalated its role'
            child_id = state['children'][0]['id']
            start('turn-3', 'DENY_PROBE'); drive('deny')
            assert not (work / 'denied.txt').exists()
            start('turn-4', 'STOP_PROBE'); drive('stop')
            # Stop closes native command execution; waiting past the write would expose a leak.
            time.sleep(10.5)
            assert not (work / 'should-not-exist.txt').exists(), 'Cancellation left a command running'
            server.send_signal(signal.SIGINT); server.wait(timeout=15)
            server = boot()
            assert start('turn-5', 'DENY_PROBE')['sessionId'] == native, 'Restart replaced the native session'
            state = drive('deny')
            assert state['children'][0]['id'] == child_id, 'Child history was lost'
            other = {'projectId': 'project-b', 'sessionId': 'session-a'}
            assert start('turn-isolation', 'DENY_PROBE', other)['sessionId'] != native
            drive('deny', other)
            assert (root / 'workspace/workflows/project-b/sessions/session-a').is_dir()
            for protocol in ['minimax', 'gemini']:
                config['state']['config']['channels'][0]['apiFormat'] = protocol
                config['state']['config']['channels'][0]['baseUrl'] = f'http://127.0.0.1:{model.server_port}'
                request(origin, '/api/store/set', {'namespace': 'zustand-v1', 'key': 'workflowgenerator:ai_config_store', 'value': json.dumps(config)})
                assert start('turn-' + protocol, 'Verify transport.')['sessionId'] == native
                state = drive()
                assert any('transport verified' in part.get('text', '') for message in state['messages'] for part in message['parts'])
            print('PASS: files/scripts + approvals + authenticated child roles + denied role forgery + versioned document/media handoff + attachments + import/export + cancellation + restart + workflow isolation + MiniMax/Gemini transports')
        except Exception:
            for diagnostic in root.rglob('opencode.log'):
                lines = [line for line in diagnostic.read_text(errors='replace').splitlines() if 'level=ERROR' in line or 'level=WARN' in line]
                if lines: print('\n'.join(lines[-6:])[:5000], flush=True)
            raise
        finally:
            if server.poll() is None:
                server.send_signal(signal.SIGINT)
                try: server.wait(timeout=15)
                except subprocess.TimeoutExpired: server.kill(); server.wait()
            model.shutdown(); log.close()

if __name__ == '__main__': main()
