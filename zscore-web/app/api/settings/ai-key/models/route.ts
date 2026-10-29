import { NextResponse } from "next/server";
import { getAiConfig, listAvailableModels } from "@/lib/ai-config";
export const runtime="nodejs";
export async function POST(req: Request) {
  const body=await req.json().catch(()=>({}));
  const current=getAiConfig();
  const cfg={base_url:body.base_url?.trim() || current.base_url,api_key:body.api_key?.trim() || current.api_key};
  if(!cfg.api_key)return NextResponse.json({ok:false,error:"请先配置 API Key"},{status:400});
  try {return NextResponse.json({ok:true,models:await listAvailableModels(cfg)});}
  catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"模型列表获取失败"},{status:502});}
}
