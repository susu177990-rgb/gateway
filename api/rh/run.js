const RH_BASE = "https://www.runninghub.ai/openapi/v2/run/ai-app";
const reply=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export default {async fetch(request){
  if(request.method!=="POST") return reply({error:"Method Not Allowed"},405);
  const apiKey=(request.headers.get("x-rh-key")||"").trim();
  if(!apiKey) return reply({error:"缺少 RunningHub API Key"},401);
  try{
    const body=await request.json();
    const appId=String(body?.appId||"").trim();
    if(!appId) return reply({error:"缺少 AI App ID"},400);
    const nodeInfoList=Array.isArray(body?.nodeInfoList)?body.nodeInfoList.filter(x=>String(x?.nodeId||"").trim()&&String(x?.fieldName||"").trim()).map(x=>({nodeId:String(x.nodeId).trim(),fieldName:String(x.fieldName).trim(),fieldValue:String(x.fieldValue??""),description:x.description??null})):[];
    const instanceType=["default","plus","ultra"].includes(body?.instanceType)?body.instanceType:"default";
    const personal=body?.usePersonalQueue===true||body?.usePersonalQueue==="true";
    const payload={nodeInfoList,instanceType,usePersonalQueue:String(personal)};
    if(typeof body?.webhookUrl==="string"&&body.webhookUrl.trim()) payload.webhookUrl=body.webhookUrl.trim();
    if(Number.isFinite(body?.retainSeconds)) payload.retainSeconds=body.retainSeconds;
    const response=await fetch(`${RH_BASE}/${encodeURIComponent(appId)}`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${apiKey}`},body:JSON.stringify(payload)});
    const result=await response.json().catch(()=>null);
    if(!response.ok) return reply({error:result?.errorMessage||result?.message||`RunningHub 请求失败 (${response.status})`,raw:result},response.status);
    return reply(result);
  }catch(error){return reply({error:error instanceof Error?error.message:"任务提交失败"},500)}
}};