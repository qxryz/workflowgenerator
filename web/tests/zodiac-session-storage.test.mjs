import test from "node:test";
import assert from "node:assert/strict";
import {createZodiacSession,saveZodiacSessionState,archiveZodiacSession,listZodiacSessions,resumeZodiacSession,loadZodiacSession,activateZodiacSessionState} from "../src/services/zodiac-session-storage.ts";
test("one history deduplicates active and saved conversations and resumes without losing the current one", async t=> {
 const original=fetch; t.after(()=>globalThis.fetch=original);
 const stores=new Map();
 globalThis.fetch=async(path,init)=>{
  const body=JSON.parse(init.body); let store=stores.get(body.namespace); if(!store) stores.set(body.namespace,store=new Map());
  if(path.endsWith("/get")) return Response.json(store.get(body.key)??null);
  if(path.endsWith("/list")) return Response.json([...store].map(([key,value])=>({key,value})));
  if(path.endsWith("/set")) store.set(body.key,body.value);
  if(path.endsWith("/remove")) store.delete(body.key);
  return new Response(null,{status:204});
 };
 const old=createZodiacSession("fixture-canvas","旧画布",[{id:"old-user",role:"user",text:"原来的对话"}]);
 await archiveZodiacSession(old);
 const current=createZodiacSession("fixture-canvas","旧画布",[{id:"current-user",role:"user",text:"当前对话"}]);
 activateZodiacSessionState(current); await saveZodiacSessionState(current); await archiveZodiacSession(current);
 const listed=await listZodiacSessions(); assert.equal(listed.length,2); assert.equal(listed.find(s=>s.id===current.id).archived,false);
 await assert.rejects(resumeZodiacSession(old.id), /恢复/);
 assert.equal((await loadZodiacSession("fixture-canvas","旧画布")).id,current.id);
 await resumeZodiacSession(old.id, {restoreArchived:true});
 assert.equal((await loadZodiacSession("fixture-canvas","旧画布")).id,old.id);
 assert.equal(await saveZodiacSessionState({...current,items:[{id:"stale",role:"user",text:"过期写入"}]}),false);
 assert.equal((await loadZodiacSession("fixture-canvas","旧画布")).items[0].text,"原来的对话");
 const after=await listZodiacSessions(); assert.equal(after.length,2); assert.equal(after.find(s=>s.id===current.id).archived,true);
 assert.equal(after.find(s=>s.id===old.id).archived,false);
});
