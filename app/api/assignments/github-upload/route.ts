import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import path from 'path';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx',
  '.xls', '.xlsx', '.csv', '.tsv',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.zip', '.json', '.txt', '.md', '.py', '.js', '.ts', '.sql', '.html', '.css',
  '.pbix', '.pbip', // Power BI (a full PBIP project is submitted zipped)
]);


function sanitizeFilename(raw: string): string {
  const base = path.basename(raw);
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, 'file');
}

// The only repo directories this endpoint is allowed to write to and delete from. Everything the
// app stores on GitHub lives under one of these roots (see lib/uploadToGithub + create/edit flows).
// Both POST and DELETE are confined to these roots so an instructor can never plant a file at an
// arbitrary repo path, nor delete source/workflow/other-content files by passing a crafted URL.
const MANAGED_ROOTS = new Set(['assignment-resources', 'sql-datasets', 'python-datasets', 've-email-attachments', 've-datasets']);
const DEFAULT_ROOT = 'assignment-resources';

const SAFE_FOLDER = /^[a-zA-Z0-9_\-/]+$/;
function sanitizeFolder(raw: string | null): string {
  const f = (raw ?? DEFAULT_ROOT).replace(/^\/+|\/+$/g, '');
  if (!f || !SAFE_FOLDER.test(f) || f.includes('..')) return DEFAULT_ROOT;
  // The first path segment must be one of the managed roots; otherwise fall back to the default.
  if (!MANAGED_ROOTS.has(f.split('/')[0])) return DEFAULT_ROOT;
  return f;
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File too large (max 50 MB)' }, { status: 413 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: `File type not allowed. Accepted: ${[...ALLOWED_EXTENSIONS].join(', ')}` }, { status: 400 });
  }

  const safeName = sanitizeFilename(file.name);
  const folder   = sanitizeFolder(form.get('folder') as string | null);

  const token  = process.env.GITHUB_TOKEN;
  const owner  = process.env.GITHUB_REPO_OWNER;
  const repo   = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_REPO_BRANCH ?? 'main';

  if (!token || !owner || !repo) {
    return NextResponse.json({ error: 'GitHub integration not configured. Add GITHUB_TOKEN, GITHUB_REPO_OWNER and GITHUB_REPO_NAME to .env' }, { status: 500 });
  }

  const filePath = `${folder}/${Date.now()}_${safeName}`;

  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const ghRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      message: `Upload ${folder.split('/')[0]}: ${safeName}`,
      content: base64,
      branch,
    }),
  });

  if (!ghRes.ok) {
    const err = await ghRes.json().catch(() => ({}));
    return NextResponse.json({ error: err.message ?? `GitHub API error ${ghRes.status}` }, { status: 502 });
  }

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  return NextResponse.json({ url: rawUrl, name: file.name });
}

// DELETE /api/assignments/github-upload
// Body: { url: string } -- a raw.githubusercontent.com URL produced by POST.
// Removes the file from the repo (working tree; git history retains it).
export async function DELETE(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  const body = await req.json().catch(() => null);
  const url: string = body?.url ?? '';
  const m = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!m) return NextResponse.json({ error: 'Invalid GitHub URL' }, { status: 400 });

  // Ignore the owner/repo/branch encoded in the URL for the write: they are attacker-controlled.
  // Only the file path is taken from the URL, and the delete runs against the server-configured repo
  // and branch (the URL's owner/repo must still match, else it is not one of ours).
  const [, mOwner, mRepo, , rawPath] = m;
  const segments = rawPath.split('/').map(decodeURIComponent);
  const filePath = segments.join('/');
  if (segments.some(s => s === '' || s === '.' || s === '..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }
  // Confine deletion to the folders this endpoint manages. Without this, any instructor could
  // delete arbitrary files anywhere in the repo by passing a crafted raw URL.
  if (!MANAGED_ROOTS.has(segments[0])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo  = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_REPO_BRANCH ?? 'main';
  if (!token || !owner || !repo) {
    return NextResponse.json({ error: 'GitHub integration not configured.' }, { status: 500 });
  }
  if (mOwner !== owner || mRepo !== repo) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Look up the file SHA (required to delete via the Contents API)
  const metaRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });
  if (metaRes.status === 404) return NextResponse.json({ ok: true }); // already gone
  if (!metaRes.ok) return NextResponse.json({ error: `GitHub API error ${metaRes.status}` }, { status: 502 });
  const meta = await metaRes.json();
  const sha = Array.isArray(meta) ? null : meta?.sha;
  if (!sha) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const delRes = await fetch(apiUrl, {
    method: 'DELETE',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Delete ${filePath}`, sha, branch }),
  });
  if (!delRes.ok) {
    const err = await delRes.json().catch(() => ({}));
    return NextResponse.json({ error: err.message ?? `GitHub API error ${delRes.status}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
