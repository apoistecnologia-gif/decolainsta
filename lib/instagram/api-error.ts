import { InstagramApiError } from '@/lib/instagram/meta';
import { NextResponse } from 'next/server';

export function instagramErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Erro ao comunicar com Instagram';
  return NextResponse.json({ error: message }, { status: error instanceof InstagramApiError ? error.status : 502 });
}
