import assert from "node:assert/strict";
import test from "node:test";
import { requestZodicReply } from "../src/services/api/zodic.ts";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store.ts";
const config = { ...defaultConfig, channels: [], apiFormat: "openai", baseUrl: "https://provider.example/v1", apiKey: "fixture", model: "fixture", textModel: "fixture" };
const encode = value => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
test("text and reasoning arrive before stream completion; terminal marker cancels keepalive", async t => {
 const original = fetch; t.after(() => globalThis.fetch = original);
 let stream, cancelled = false;
 globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { stream = c; }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } });
 const text = [], reasoning = [];
 const pending = requestZodicReply(config, [{role:"user",content:"hello"}], value => text.push(value), {onReasoning: value => reasoning.push(value)});
 await new Promise(resolve => setImmediate(resolve));
 stream.enqueue(encode({choices:[{delta:{reasoning_content:"检查内容",content:"你"}}]}));
 await new Promise(resolve => setImmediate(resolve));
 assert.deepEqual(text,["你"]); assert.deepEqual(reasoning,["检查内容"]);
 stream.enqueue(encode({choices:[{delta:{content:"好"}}]}));
 stream.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
 assert.equal(await pending,"你好"); assert.equal(cancelled,true);
});
test("MiniMax preserves streamed thinking and fragmented tool arguments across approval", async t => {
 const original = fetch; t.after(() => globalThis.fetch = original);
 let requests = 0, approve, toolStarted = false; const reasoning=[];
 globalThis.fetch = async (_path, init) => {
  const body=JSON.parse(init.body).body; assert.equal(body.stream,true);
  if (++requests===2) { assert.equal(body.messages.at(-2).content[0].signature,"signed"); return Response.json({content:[{type:"text",text:"已完成"}]}); }
  const events=[{type:"content_block_start",index:0,content_block:{type:"thinking",thinking:""}}, {type:"content_block_delta",index:0,delta:{thinking:"检查参数",signature:"signed"}}, {type:"content_block_start",index:1,content_block:{type:"tool_use",id:"write-1",name:"write",input:{}}}, {type:"content_block_delta",index:1,delta:{partial_json:'{"text":'}}, {type:"content_block_delta",index:1,delta:{partial_json:'"记录"}'}}, {type:"message_stop"}];
  return new Response(new ReadableStream({start(c){events.forEach(e=>c.enqueue(encode(e)));}}),{headers:{"content-type":"text/event-stream"}});
 };
 const pending=requestZodicReply({...config, channels:[createModelChannel({id:"fixture",vendor:"minimax-api",apiFormat:"minimax",baseUrl:"https://api.minimaxi.com",apiKey:"fixture",models:[{name:"fixture",capability:"text"}]})]},[{role:"user",content:"write"}],()=>{}, {tools:[{name:"write",description:"write",parameters:{type:"object"}}],responseTimeoutMs:1000,onReasoning:v=>reasoning.push(v),onToolRequest:async request=> { toolStarted=true; assert.deepEqual(request.args,{text:"记录"}); await new Promise(resolve=>approve=resolve); return {ok:true}; }});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(toolStarted,true); assert.equal(requests,1); assert.deepEqual(reasoning,["检查参数"]);
 approve(); assert.equal(await pending,"已完成"); assert.equal(requests,2);
});
test("provider timeout terminates a stalled request and exposes an actionable error", async t => {
 const original=fetch; t.after(()=>globalThis.fetch=original);
 globalThis.fetch=async (_path,init)=>new Promise((_,reject)=>init.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError"))));
 const status=[];
 await assert.rejects(requestZodicReply(config,[{role:"user",content:"hello"}],()=>{}, {responseTimeoutMs:15,onStatus:s=>status.push(s)}),/响应超时/);
 assert.deepEqual(status,["running","error"]);
});
