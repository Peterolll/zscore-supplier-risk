import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/audit";
export const runtime="nodejs";
export async function DELETE(req:Request,{params}:{params:Promise<{runId:string}>}) {
  const {runId}=await params;
  const body=await req.json().catch(()=>({}));
  if(typeof body.id!=="string")return NextResponse.json({ok:false,error:"INVALID_SUGGESTION"},{status:400});
  const db=getDb();
  const row=db.prepare("SELECT trace_id,field_key FROM review_suggestion WHERE id=? AND run_id=? AND accepted_at IS NULL AND dismissed_at IS NULL").get(body.id,runId) as {trace_id:string;field_key:string}|undefined;
  if(!row)return NextResponse.json({ok:false,error:"建议已处理或不存在"},{status:409});
  db.prepare("UPDATE review_suggestion SET dismissed_at=datetime('now') WHERE id=? AND run_id=?").run(body.id,runId);
  audit(row.trace_id,"review.cancelled",{run_id:runId,suggestion_id:body.id,field:row.field_key});
  return NextResponse.json({ok:true});
}
