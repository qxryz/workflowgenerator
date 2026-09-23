import test from "node:test";
import assert from "node:assert/strict";
import {createZodiacSession,saveZodiacSessionState,archiveZodiacSession,listZodiacSessions,resumeZodiacSession,loadZodiacSession,activateZodiacSessionState,retainZodiacSession,archiveZodiacSessionById} from "../src/services/zodiac-session-storage.ts";
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
 const after=await listZodiacSessions(); assert.equal(after.length,2); assert.equal(after.find(s=>s.id===current.id).archived,false);
 assert.equal(after.find(s=>s.id===old.id).archived,false);
 // Switching keeps both conversations in workflow history; only Archive removes one.
 await resumeZodiacSession(current.id);
 assert.equal((await listZodiacSessions()).filter(s=>!s.archived).length,2);
 await archiveZodiacSessionById(old.id);
 assert.equal((await listZodiacSessions()).find(s=>s.id===old.id).archived,true);
 assert.equal((await loadZodiacSession("fixture-canvas","旧画布")).id,current.id);
 // Explicitly archiving the current session creates a fresh active identity.
 await archiveZodiacSessionById(current.id);
 assert.notEqual((await loadZodiacSession("fixture-canvas","旧画布")).id,current.id);
 assert.equal(await saveZodiacSessionState(current),false);
 assert.equal((await listZodiacSessions()).filter(s=>s.archived).length,2);
 const empty=createZodiacSession("empty-approval","新画布"); empty.autoApprove=true;
 activateZodiacSessionState(empty); await saveZodiacSessionState(empty);
 assert.equal((await loadZodiacSession("empty-approval","新画布")).autoApprove,true);
 assert.ok(!(await listZodiacSessions()).some(session=>session.id===empty.id));
});
