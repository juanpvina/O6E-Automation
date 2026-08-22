import { useCallback, useEffect, useRef, useState } from 'react';
import { Connection, CronSchedule, Execution, Project, Workflow } from '@opencode/shared';

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

// Fetch all dashboard data (projects, connections, workflows, schedules,
// executions, orchestrator health) on mount and poll every 4 seconds.
// Also refreshes the currently selected execution when its data changes.
export function useDashboardData(
  selectedExecution: Execution | null,
  onUpdateSelectedExecution: (execution: Execution) => void
) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [schedules, setSchedules] = useState<CronSchedule[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [healthInfo, setHealthInfo] = useState<any>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const selectedExecutionRef = useRef(selectedExecution);
  selectedExecutionRef.current = selectedExecution;
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRefreshing(true);
    try {
      const [resProj, resConn, resWork, resSched, resExec] = await Promise.all([
        fetch('/api/projects', { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject(new Error(`projects: ${r.status}`))),
        fetch('/api/connections', { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject(new Error(`connections: ${r.status}`))),
        fetch('/api/workflows', { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject(new Error(`workflows: ${r.status}`))),
        fetch('/api/schedules', { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject(new Error(`schedules: ${r.status}`))),
        fetch('/api/executions', { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject(new Error(`executions: ${r.status}`)))
      ]);
      setProjects(prev => sameJson(prev, resProj) ? prev : resProj);
      setConnections(prev => sameJson(prev, resConn) ? prev : resConn);
      setWorkflows(prev => sameJson(prev, resWork) ? prev : resWork);
      setSchedules(prev => sameJson(prev, resSched) ? prev : resSched);
      setExecutions(prev => sameJson(prev, resExec) ? prev : resExec);

      // Fase 4 — Fetch orchestrator health (scheduler + per-project queue).
      const resHealth = await fetch('/api/health', { signal: controller.signal })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);
      setHealthInfo((prev: any) => sameJson(prev, resHealth) ? prev : resHealth);

      // Refresh selected execution if open
      const current = selectedExecutionRef.current;
      if (current) {
        const updated = resExec.find((e: Execution) => e.id === current.id);
        if (updated) {
          // Only update if something actually changed to avoid needless re-renders/flashing
          const prev = current;
          const changed =
            prev.status !== updated.status ||
            (prev.pendingApprovals?.length ?? 0) !== (updated.pendingApprovals?.length ?? 0) ||
            JSON.stringify(prev.logs ?? []) !== JSON.stringify(updated.logs ?? []) ||
            JSON.stringify(prev.artifacts ?? []) !== JSON.stringify(updated.artifacts ?? []) ||
            JSON.stringify(prev.stepOutputs ?? {}) !== JSON.stringify(updated.stepOutputs ?? {}) ||
            JSON.stringify(prev.stepTimings ?? []) !== JSON.stringify(updated.stepTimings ?? []) ||
            JSON.stringify(prev.variables ?? {}) !== JSON.stringify(updated.variables ?? {}) ||
            JSON.stringify(prev.agentMetrics ?? {}) !== JSON.stringify(updated.agentMetrics ?? {});
          if (changed) onUpdateSelectedExecution(updated);
        }
      }
      setDataError(null);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setDataError(err instanceof Error ? err.message : 'No se pudo actualizar el dashboard');
        console.error('Failed to fetch data:', err);
      }
    } finally {
      if (abortRef.current === controller) setIsRefreshing(false);
    }
  }, [onUpdateSelectedExecution]);

  useEffect(() => {
    fetchData();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (document.visibilityState !== 'visible') return;
      const active = selectedExecutionRef.current && ['queued', 'running', 'waiting_approval'].includes(selectedExecutionRef.current.status);
      timer = setTimeout(() => { fetchData(); schedule(); }, active ? 2500 : 10000);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') { fetchData(); schedule(); }
      else if (timer) clearTimeout(timer);
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      abortRef.current?.abort();
    };
  }, [fetchData]);

  return {
    projects,
    setProjects,
    connections,
    setConnections,
    workflows,
    setWorkflows,
    schedules,
    setSchedules,
    executions,
    setExecutions,
    healthInfo,
    setHealthInfo,
    fetchData,
    dataError,
    isRefreshing
  };
}
