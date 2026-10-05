import { NextRequest,NextResponse } from 'next/server';
import { safeEqual } from '@/lib/security';
import { prepareReminders,dispatchReminders } from '@/lib/reminders';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:NextRequest) {
  const secret=process.env.CRON_SECRET;
  if(!secret||secret.length<32||!safeEqual(request.headers.get('authorization')||'',`Bearer ${secret}`))return NextResponse.json({error:'No autorizado'},{status:401});
  await prepareReminders();return NextResponse.json(await dispatchReminders());
}
