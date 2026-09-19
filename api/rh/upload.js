const RH_UPLOAD_URL = "https://www.runninghub.ai/openapi/v2/media/upload/binary";
const reply=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export default {async fetch(request){
  if(request.method!=="POST") return reply({error:"Method Not Allowed"},405);
  const apiKey=(request.headers.get("x-rh-key")||"").trim();
  if(!apiKey) return reply({error:"缺少 RunningHub API Key"},401);
  try{
    const incoming=await request.formData();
    const file=incoming.get("file");
    if(!(file instanceof File)) return reply({error:"缺少文件"},400);
    const body=new FormData(); body.append("file",file,file.name);
    const response=await fetch(RH_UPLOAD_URL,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`},body});
    const payload=await response.json().catch(()=>null);
    if(!response.ok) return reply({error:payload?.message||payload?.errorMessage||`RunningHub 上传失败 (${response.status})`,raw:payload},response.status);
    return reply(payload);
  }catch(error){return reply({error:error instanceof Error?error.message:"文件上传失败"},500)}
}};