'use client';

// The in-browser SQL engine for SQL exercises, shared by the course and certification players.
// It loads every table the exercises use (each table once), only when the learner first reaches
// a SQL exercise, and closes when the player unmounts or `release` turns true.

import { useEffect, useMemo, useRef, useState } from 'react';
import { initSQLRuntime, type SQLRuntime } from '@/lib/sql-engine';

export function useSqlRuntime(questions: any[], active: boolean, release = false) {
  const [sqlRuntime, setSqlRuntime] = useState<SQLRuntime | null>(null);
  const [sqlPreparing, setSqlPreparing] = useState(false);
  const [sqlPrepareError, setSqlPrepareError] = useState('');
  const runtimeRef = useRef<SQLRuntime | null>(null);
  const startedRef = useRef(false);

  const sqlTables = useMemo(() => {
    const byKey = new Map<string, any>();
    for (const q of questions) {
      if (q?.type !== 'sql_exercise') continue;
      for (const table of (q.sqlTables ?? [])) {
        const key = `${table.tableName}|${table.fileUrl || table.csvUrl || table.seedSql || ''}`;
        if (table.tableName && !byKey.has(key)) byKey.set(key, table);
      }
    }
    return Array.from(byKey.values());
  }, [questions]);

  useEffect(() => {
    if (!active || runtimeRef.current || startedRef.current || sqlTables.length === 0) return;
    let cancelled = false;
    startedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows "preparing" as the async load starts
    setSqlPreparing(true);
    setSqlPrepareError('');
    initSQLRuntime(sqlTables)
      .then(rt => {
        if (cancelled) { rt.close(); return; }
        runtimeRef.current = rt;
        setSqlRuntime(rt);
      })
      .catch(err => { if (!cancelled) setSqlPrepareError(err?.message || 'Could not prepare the SQL environment.'); })
      .finally(() => {
        if (!cancelled) setSqlPreparing(false);
        if (!runtimeRef.current) startedRef.current = false;
      });
    return () => { cancelled = true; };
  }, [active, sqlTables]);

  // Free the engine once the player is done with it (the course's results screen).
  useEffect(() => {
    if (!release) return;
    runtimeRef.current?.close();
    runtimeRef.current = null;
    startedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drops the closed engine so nothing uses it
    setSqlRuntime(null);
  }, [release]);

  useEffect(() => () => {
    runtimeRef.current?.close();
    runtimeRef.current = null;
    startedRef.current = false;
  }, []);

  return { sqlRuntime, sqlPreparing, sqlPrepareError };
}
