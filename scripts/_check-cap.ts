import { runDue, type Env } from '../worker/src/index';
function fakeKv(){const s=new Map<string,string>();return{store:s,get:async(k:string)=>s.get(k)??null,put:async(k:string,v:string)=>{s.set(k,v);},delete:async(k:string)=>{s.delete(k);}};}
const MIN=60*1000;
async function cenario(N:number){
  const kv=fakeKv(); const now=Date.parse('2026-09-23T11:00:00Z'); const iso=new Date(now).toISOString();
  const targets=Array.from({length:N},(_,i)=>`u${i}@s.whatsapp.net`);
  kv.store.set('broadcast:job:m1',JSON.stringify({messageId:'m1',text:'D',targets}));
  const size=Math.ceil(N/3);
  for(let l=0;l<3;l++){const a=l*size; if(a>=N)break; const b=Math.min(a+size,N);
    kv.store.set(`broadcast:lane:m1:${l}`,JSON.stringify({messageId:'m1',lane:l,start:a,end:b,cursor:a,total:b-a,dispatched:0,failed:0,lastChatid:null,startedAtISO:iso,updatedAtISO:iso,finishedAtISO:null}));}
  kv.store.set('broadcast:queue',JSON.stringify({messageId:'m1',groups:3,nextGroupAtISO:iso,createdAtISO:iso}));
  const env={KV:kv,AI_UAZAPI_BASE:'https://f',AI_UAZAPI_TOKEN:'t'} as unknown as Env;
  const env_:string[]=[]; let max=0,at=0;
  globalThis.fetch=(async(_u:unknown,init?:RequestInit)=>{at++;const b=JSON.parse(String(init?.body??'{}')) as {number?:string};if(b.number)env_.push(b.number);return new Response('{}',{status:200});}) as typeof fetch;
  const log:string[]=[];
  for(let t=0;t<25;t++){at=0;const r=await runDue(env,now+t*5*MIN);if(at>max)max=at;
    if(r.startsWith('grupo')) log.push(`t+${t*5}min: ${r}`);}
  const u=new Set(env_);
  const ok = u.size===N && env_.length===N;
  console.log(`\n=== ${N} contatos ===`);
  for(const l of log) console.log('  '+l);
  console.log(`  entregues ${env_.length}, unicos ${u.size}, max chamadas/invocacao ${max} -> ${ok?'ok':'PROBLEMA'}`);
  return ok;
}
let ok=true;
ok = await cenario(235) && ok;
ok = await cenario(600) && ok;
console.log(ok?'\nOK':'\nFALHOU');
process.exit(ok?0:1);
