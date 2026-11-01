import { NextResponse } from 'next/server';
import { merchantConfig } from '@/lib/server-near';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(merchantConfig());
}
