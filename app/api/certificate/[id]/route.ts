import { NextRequest, NextResponse } from 'next/server';
import { loadCertificate } from '@/lib/certificate';

// Returns public display data for a certificate. Logic lives in lib/certificate
// so the /certificate/[id] page can server-render with the same data.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await loadCertificate(id);

  if (result.status === 'notfound') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (result.status === 'revoked')  return NextResponse.json({ revoked: true }, { status: 200 });
  if (result.status === 'unavailable') return NextResponse.json({ error: 'unavailable' }, { status: 503 });

  return NextResponse.json({ ...result.data, revoked: false });
}
