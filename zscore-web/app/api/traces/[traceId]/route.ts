import { NextResponse } from 'next/server';
import { readTrace } from '@/lib/audit';
export const runtime='nodejs';
export async function GET(_req:Request,{params}:{params:Promise<{traceId:string}>}) {
  const {traceId}=await params;
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(traceId))return NextResponse.json({ok:false,error:'BAD_TRACE_ID'},{status:400});
  const events=readTrace(traceId);
  return NextResponse.json({ok:events.length>0,trace_id:traceId,events},{status:events.length?200:404});
}
