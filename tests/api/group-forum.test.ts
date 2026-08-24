import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Route-logic tests for the group discussion forum. These pin the AUTHORIZATION and shaping the
// server route owns (it runs under the service role, so RLS is off here and the route must enforce
// everything itself): DB-derived ancestry (no trusting client assignment/group ids), members-only
// writes, own-post edit/delete, sanitize-to-empty rejection, 409 conflicts, and the topic-delete
// guard. True DB-level RLS (a user-scoped anon client) needs a live Postgres and is covered by the
// env-gated integration test alongside this file.

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireUser: vi.fn(),
}));
vi.mock('@/lib/admin-client', () => ({ adminClient: vi.fn() }));

import { requireUser } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { POST } from '@/app/api/assignments/group-forum/route';
import { makeSupabaseStub, type QueryResult } from '../helpers/supabaseStub';

const mockRequireUser = vi.mocked(requireUser);
const mockAdminClient = vi.mocked(adminClient);

// makeSupabaseStub + an rpc() shim (the route calls db.rpc('create_group_thread', ...)).
function client(byTable: Record<string, QueryResult | QueryResult[]>, rpc?: QueryResult) {
  const base: any = makeSupabaseStub(byTable);
  base.rpc = vi.fn(async () => rpc ?? { data: null, error: null });
  return base;
}
function authed(id = 'u1') {
  mockRequireUser.mockResolvedValue({ user: { id }, serviceDb: {}, token: 't' } as any);
}
function post(body: any) {
  return POST(new Request('http://localhost/api/assignments/group-forum', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }) as any);
}

// A published assignment whose group_ids include the given group.
const assignment = (groupIds: string[]) => ({ data: { id: 'a1', group_ids: groupIds, status: 'published' }, error: null });
const memberRow = { data: { is_leader: false }, error: null };
const notMember = { data: null, error: null };
const asStudent = { data: { role: 'student' }, error: null };
const asAdmin = { data: { role: 'admin' }, error: null };

beforeEach(() => { mockRequireUser.mockReset(); mockAdminClient.mockReset(); authed('u1'); });

describe('POST /api/assignments/group-forum', () => {
  it('401 for an unauthenticated caller', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as any);
    mockAdminClient.mockReturnValue(client({}));
    expect((await post({ action: 'listThreads', assignmentId: 'a1', groupId: 'g1' })).status).toBe(401);
  });

  it('400 for an unknown action', async () => {
    mockAdminClient.mockReturnValue(client({}));
    expect((await post({ action: 'nope' })).status).toBe(400);
  });

  it('listThreads: 403 for a non-member student', async () => {
    mockAdminClient.mockReturnValue(client({ assignments: assignment(['g1']), group_members: notMember, students: asStudent }));
    expect((await post({ action: 'listThreads', assignmentId: 'a1', groupId: 'g1' })).status).toBe(403);
  });

  it('listThreads: 403 when the group is not one of the assignment groups', async () => {
    mockAdminClient.mockReturnValue(client({ assignments: assignment(['gOTHER']), group_members: memberRow, students: asStudent }));
    const res = await post({ action: 'listThreads', assignmentId: 'a1', groupId: 'g1' });
    expect(res.status).toBe(403);
  });

  it('listThreads: member sees threads with reply counts (posts - opening)', async () => {
    mockAdminClient.mockReturnValue(client({
      assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
      assignment_group_threads: { data: [{ id: 't1', title: 'Task 1', author_id: 'u2', created_at: '2026-07-27T10:00:00Z', last_post_at: '2026-07-27T11:00:00Z', author: { full_name: 'Ada' } }], error: null },
      // the count query filters is_opening=false server-side; the stub returns these 2 as the replies
      assignment_group_posts: { data: [{ thread_id: 't1' }, { thread_id: 't1' }], error: null },
    }));
    const res = await post({ action: 'listThreads', assignmentId: 'a1', groupId: 'g1' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.threads[0]).toMatchObject({ id: 't1', title: 'Task 1', authorName: 'Ada', replyCount: 2 });
  });

  it('admin (non-member) may read, instructor-style access is not granted here', async () => {
    mockAdminClient.mockReturnValue(client({
      assignments: assignment(['g1']), group_members: notMember, students: asAdmin,
      assignment_group_forum_access_log: { data: null, error: null },
      assignment_group_threads: { data: [], error: null },
      assignment_group_posts: { data: [], error: null },
    }));
    expect((await post({ action: 'listThreads', assignmentId: 'a1', groupId: 'g1' })).status).toBe(200);
  });

  it('createThread: rejects content that sanitizes to empty', async () => {
    mockAdminClient.mockReturnValue(client({ assignments: assignment(['g1']), group_members: memberRow, students: asStudent }));
    const res = await post({ action: 'createThread', assignmentId: 'a1', groupId: 'g1', title: 'Q', body: '<b>  </b>' });
    expect(res.status).toBe(400);
  });

  it('createThread: member creates a topic (thread + opening post) atomically via RPC', async () => {
    mockAdminClient.mockReturnValue(client(
      { assignments: assignment(['g1']), group_members: memberRow, students: asStudent },
      { data: { thread: { id: 't9', title: 'Q', author_id: 'u1', created_at: 'x', last_post_at: 'x' }, post: { id: 'p9', thread_id: 't9', author_id: 'u1', body: 'hi', created_at: 'x', updated_at: 'x', deleted_at: null } }, error: null },
    ));
    const res = await post({ action: 'createThread', assignmentId: 'a1', groupId: 'g1', title: 'Q', body: 'hi' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.thread.id).toBe('t9');
    expect(json.post.id).toBe('p9');
  });

  it('createPost IDOR: a foreign thread id resolves to ITS group, which the caller cannot reach', async () => {
    // Caller is a member of g1, but posts to a thread that belongs to g2. Ancestry is derived from
    // the thread row, so membership is checked against g2 -> denied.
    mockAdminClient.mockReturnValue(client({
      assignment_group_threads: { data: { id: 't2', assignment_id: 'a1', group_id: 'g2', author_id: 'x', deleted_at: null }, error: null },
      assignments: assignment(['g1', 'g2']),
      group_members: notMember, // caller is not in g2
      students: asStudent,
    }));
    const res = await post({ action: 'createPost', threadId: 't2', body: 'sneaky' });
    expect(res.status).toBe(403);
  });

  it('editPost: 403 when the caller is not the author', async () => {
    mockAdminClient.mockReturnValue(client({
      assignment_group_posts: { data: { id: 'p1', thread_id: 't1', author_id: 'someone-else', deleted_at: null, thread: { assignment_id: 'a1', group_id: 'g1' } }, error: null },
      assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
    }));
    const res = await post({ action: 'editPost', postId: 'p1', body: 'edit' });
    expect(res.status).toBe(403);
  });

  it('editPost: 409 when the row changed since the client loaded it', async () => {
    mockAdminClient.mockReturnValue(client({
      assignment_group_posts: [
        { data: { id: 'p1', thread_id: 't1', author_id: 'u1', deleted_at: null, thread: { assignment_id: 'a1', group_id: 'g1' } }, error: null }, // loadPost
        { data: null, error: null }, // update matched nothing -> conflict
      ],
      assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
    }));
    const res = await post({ action: 'editPost', postId: 'p1', body: 'edit', expectedUpdatedAt: 'stale' });
    expect(res.status).toBe(409);
  });

  it('deleteThread: 409 when the delete RPC reports the topic already has replies', async () => {
    mockAdminClient.mockReturnValue(client(
      {
        assignment_group_threads: { data: { id: 't1', assignment_id: 'a1', group_id: 'g1', author_id: 'u1', deleted_at: null }, error: null }, // loadThread
        assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
      },
      { data: null, error: { message: 'thread_has_replies' } }, // delete_group_thread RPC result
    ));
    const res = await post({ action: 'deleteThread', threadId: 't1' });
    expect(res.status).toBe(409);
  });

  it('deletePost: 403 when not the author', async () => {
    mockAdminClient.mockReturnValue(client({
      assignment_group_posts: { data: { id: 'p1', thread_id: 't1', author_id: 'other', deleted_at: null, thread: { assignment_id: 'a1', group_id: 'g1' } }, error: null },
      assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
    }));
    expect((await post({ action: 'deletePost', postId: 'p1' })).status).toBe(403);
  });

  it('listThreads: admin read fails CLOSED (503) when the audit-log write fails', async () => {
    mockAdminClient.mockReturnValue(client({
      assignments: assignment(['g1']), group_members: notMember, students: asAdmin,
      assignment_group_forum_access_log: { data: null, error: { message: 'audit down' } },
    }));
    const res = await post({ action: 'listThreads', assignmentId: 'a1', groupId: 'g1' });
    expect(res.status).toBe(503);
  });

  it('listPosts: 404 when the thread is soft-deleted', async () => {
    mockAdminClient.mockReturnValue(client({
      assignment_group_threads: { data: { id: 't1', assignment_id: 'a1', group_id: 'g1', author_id: 'u1', deleted_at: '2026-07-27T00:00:00Z' }, error: null },
    }));
    expect((await post({ action: 'listPosts', threadId: 't1' })).status).toBe(404);
  });

  it('listPosts poll: pollCursor keeps microsecond timestamp precision', async () => {
    const micro = '2026-07-27T10:00:00.123456+00:00';
    mockAdminClient.mockReturnValue(client({
      assignment_group_threads: { data: { id: 't1', assignment_id: 'a1', group_id: 'g1', author_id: 'u1', deleted_at: null }, error: null },
      assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
      assignment_group_posts: { data: [{ id: 'p1', thread_id: 't1', author_id: 'u1', body: 'hi', created_at: micro, updated_at: micro, deleted_at: null, author: { full_name: 'A' } }], error: null },
    }));
    const res = await post({ action: 'listPosts', threadId: 't1', mode: 'poll' });
    expect(res.status).toBe(200);
    expect((await res.json()).pollCursor).toBe(`${micro}|p1`);
  });

  it('deleteThread: 200 via the atomic RPC when the author deletes with no other replies', async () => {
    mockAdminClient.mockReturnValue(client(
      {
        assignment_group_threads: { data: { id: 't1', assignment_id: 'a1', group_id: 'g1', author_id: 'u1', deleted_at: null }, error: null },
        assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
      },
      { data: null, error: null }, // delete_group_thread RPC succeeds
    ));
    const res = await post({ action: 'deleteThread', threadId: 't1' });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  // ---------------------------------------------------------------- polls
  it('createPoll: member adds a poll to the conversation with zeroed tallies', async () => {
    mockAdminClient.mockReturnValue(client({
      assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
      assignment_group_threads: { data: { id: 't1' }, error: null }, // the group's existing conversation
      assignment_group_posts: { data: { id: 'p1', thread_id: 't1', author_id: 'u1', body: 'Lunch?', kind: 'poll', poll: { options: ['Pizza', 'Sushi'] }, created_at: 'x', updated_at: 'x', deleted_at: null, author: { full_name: 'Me' } }, error: null },
    }));
    const res = await post({ action: 'createPoll', assignmentId: 'a1', groupId: 'g1', question: 'Lunch?', options: ['Pizza', 'Sushi'] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.post.kind).toBe('poll');
    expect(json.post.poll).toMatchObject({ question: 'Lunch?', options: ['Pizza', 'Sushi'], counts: [0, 0], totalVotes: 0, myVote: null });
  });

  it('createPoll: opens the conversation via the RPC when none exists yet', async () => {
    mockAdminClient.mockReturnValue(client(
      {
        assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
        assignment_group_threads: { data: null, error: null }, // no conversation yet
      },
      { data: { thread: { id: 't9', title: 'Group discussion', author_id: 'u1', created_at: 'x', last_post_at: 'x' }, post: { id: 'p9', thread_id: 't9', author_id: 'u1', body: 'Lunch?', kind: 'poll', poll: { options: ['A', 'B'] }, created_at: 'x', updated_at: 'x', deleted_at: null } }, error: null },
    ));
    const res = await post({ action: 'createPoll', assignmentId: 'a1', groupId: 'g1', question: 'Lunch?', options: ['A', 'B'] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.thread.id).toBe('t9');
    expect(json.post.poll.options).toEqual(['A', 'B']);
  });

  it('createPoll: 400 when fewer than 2 distinct options survive (blanks + dupes dropped)', async () => {
    mockAdminClient.mockReturnValue(client({ assignments: assignment(['g1']), group_members: memberRow, students: asStudent }));
    const res = await post({ action: 'createPoll', assignmentId: 'a1', groupId: 'g1', question: 'Q', options: ['Same', 'Same', '  '] });
    expect(res.status).toBe(400);
  });

  it('vote: records a member vote (upsert) and returns ok', async () => {
    mockAdminClient.mockReturnValue(client({
      assignment_group_posts: { data: { id: 'p1', thread_id: 't1', author_id: 'u2', kind: 'poll', poll: { options: ['A', 'B'] }, deleted_at: null, thread: { assignment_id: 'a1', group_id: 'g1' } }, error: null },
      assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
      assignment_group_poll_votes: { data: null, error: null },
    }));
    const res = await post({ action: 'vote', postId: 'p1', optionIdx: 1 });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('vote: 400 for an out-of-range option index', async () => {
    mockAdminClient.mockReturnValue(client({
      assignment_group_posts: { data: { id: 'p1', thread_id: 't1', author_id: 'u2', kind: 'poll', poll: { options: ['A', 'B'] }, deleted_at: null, thread: { assignment_id: 'a1', group_id: 'g1' } }, error: null },
      assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
    }));
    expect((await post({ action: 'vote', postId: 'p1', optionIdx: 5 })).status).toBe(400);
  });

  it('vote: 404 on a non-poll (text) post', async () => {
    mockAdminClient.mockReturnValue(client({
      assignment_group_posts: { data: { id: 'p1', thread_id: 't1', author_id: 'u2', kind: 'text', poll: null, deleted_at: null, thread: { assignment_id: 'a1', group_id: 'g1' } }, error: null },
    }));
    expect((await post({ action: 'vote', postId: 'p1', optionIdx: 0 })).status).toBe(404);
  });

  it('vote IDOR: 403 voting on a poll in a group the caller cannot reach', async () => {
    mockAdminClient.mockReturnValue(client({
      assignment_group_posts: { data: { id: 'p1', thread_id: 't2', author_id: 'x', kind: 'poll', poll: { options: ['A', 'B'] }, deleted_at: null, thread: { assignment_id: 'a1', group_id: 'g2' } }, error: null },
      assignments: assignment(['g1', 'g2']), group_members: notMember, students: asStudent,
    }));
    expect((await post({ action: 'vote', postId: 'p1', optionIdx: 0 })).status).toBe(403);
  });

  it('editPost: 400 rejecting an edit to a poll', async () => {
    mockAdminClient.mockReturnValue(client({
      assignment_group_posts: { data: { id: 'p1', thread_id: 't1', author_id: 'u1', kind: 'poll', poll: { options: ['A', 'B'] }, deleted_at: null, thread: { assignment_id: 'a1', group_id: 'g1' } }, error: null },
      assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
    }));
    expect((await post({ action: 'editPost', postId: 'p1', body: 'nope' })).status).toBe(400);
  });

  it('listPosts: attaches poll counts, total, and the callers own vote', async () => {
    const poll = { id: 'p1', thread_id: 't1', author_id: 'u2', body: 'Pizza?', kind: 'poll', poll: { options: ['Yes', 'No'] }, created_at: '2026-07-27T10:00:00Z', updated_at: '2026-07-27T10:00:00Z', deleted_at: null, author: { full_name: 'Ada' } };
    mockAdminClient.mockReturnValue(client({
      assignment_group_threads: { data: { id: 't1', assignment_id: 'a1', group_id: 'g1', author_id: 'u2', deleted_at: null }, error: null },
      assignments: assignment(['g1']), group_members: memberRow, students: asStudent,
      assignment_group_posts: { data: [poll], error: null },
      assignment_group_poll_votes: { data: [
        { post_id: 'p1', option_idx: 0, voter_id: 'u1' }, // the caller
        { post_id: 'p1', option_idx: 0, voter_id: 'u2' },
        { post_id: 'p1', option_idx: 1, voter_id: 'u3' },
      ], error: null },
    }));
    const res = await post({ action: 'listPosts', threadId: 't1', mode: 'initial' });
    expect(res.status).toBe(200);
    expect((await res.json()).posts[0].poll).toMatchObject({ counts: [2, 1], totalVotes: 3, myVote: 0 });
  });
});
