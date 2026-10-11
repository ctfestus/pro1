/**
 * GET /api/mcp-config -- the public Supabase connection values for the student MCP server.
 *
 * Deliberately unauthenticated: the URL and anon key are already shipped to every browser in the
 * client bundle, and access is enforced by RLS on the student's own sign-in. Exposing them here
 * means a student installing the MCP only enters the platform URL, email, and password.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Platform is not configured' }, { status: 500 });
  }
  return NextResponse.json({ supabaseUrl, supabaseAnonKey });
}
