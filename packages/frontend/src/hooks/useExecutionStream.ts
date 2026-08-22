import { useCallback, useEffect, useRef, useState } from 'react';
import { StepEvent } from '@opencode/shared';

export type LogEntry = { timestamp: string; level: string; message: string };
export type StreamState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

const MAX_LOGS = 1000;
const MAX_STEP_EVENTS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;

const parseJson = <T,>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const parseLog = (raw: string): LogEntry | null => {
  const parsed = parseJson<Partial<LogEntry>>(raw);
  if (!parsed || typeof parsed.message !== 'string') return null;
  return {
    timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString(),
    level: typeof parsed.level === 'string' ? parsed.level : 'info',
    message: parsed.message
  };
};

// Connect to the SSE log stream for a selected execution. Reconnects whenever
// the execution id changes, resets the log/step-event buffers and auto-scrolls
// the log console to the bottom as new entries arrive.
export function useExecutionStream(
  executionId: string | undefined,
  onExecutionChange?: () => void
) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stepEvents, setStepEvents] = useState<StepEvent[]>([]);
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onExecutionChangeRef = useRef(onExecutionChange);
  onExecutionChangeRef.current = onExecutionChange;

  // Connect to SSE for Execution log streaming
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const pendingLogs: LogEntry[] = [];
    const pendingStepEvents: StepEvent[] = [];

    const flushPending = () => {
      flushTimer = undefined;
      if (pendingLogs.length > 0) {
        const batch = pendingLogs.splice(0, pendingLogs.length);
        setLogs(prev => {
          const existing = new Set(prev.map(log => `${log.timestamp}\u0000${log.message}`));
          const additions = batch.filter(log => {
            const key = `${log.timestamp}\u0000${log.message}`;
            if (existing.has(key)) return false;
            existing.add(key);
            return true;
          });
          return additions.length === 0 ? prev : [...prev, ...additions].slice(-MAX_LOGS);
        });
      }
      if (pendingStepEvents.length > 0) {
        const batch = pendingStepEvents.splice(0, pendingStepEvents.length);
        setStepEvents(prev => {
          const existing = new Set(prev.map(item => `${item.stepId}\u0000${item.status}\u0000${item.at}`));
          const additions = batch.filter(item => {
            const key = `${item.stepId}\u0000${item.status}\u0000${item.at}`;
            if (existing.has(key)) return false;
            existing.add(key);
            return true;
          });
          return additions.length === 0 ? prev : [...prev, ...additions].slice(-MAX_STEP_EVENTS);
        });
      }
    };

    const scheduleFlush = () => {
      if (flushTimer === undefined) flushTimer = setTimeout(flushPending, 50);
    };

    if (!executionId) {
      setStreamState('idle');
      setReconnectAttempt(0);
      setStreamError(null);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return () => undefined;
    }

    eventSourceRef.current?.close();
    setLogs([]);
    setStepEvents([]);
    setStreamState('connecting');
    setReconnectAttempt(0);
    setStreamError(null);
    onExecutionChangeRef.current?.();

    const addLog = (raw: string) => {
      const logEntry = parseLog(raw);
      if (!logEntry) return;
      pendingLogs.push(logEntry);
      scheduleFlush();
    };

    const connect = () => {
      if (disposed) return;
      setStreamState(attempt === 0 ? 'connecting' : 'reconnecting');
      const source = new EventSource(`/api/executions/${executionId}/logs/stream`);
      eventSourceRef.current = source;

      const onLog = (event: Event) => addLog((event as MessageEvent).data);
      const onStep = (event: Event) => {
        const stepEvent = parseJson<StepEvent>((event as MessageEvent).data);
        if (!stepEvent || typeof stepEvent.stepId !== 'string' || typeof stepEvent.status !== 'string') return;
        pendingStepEvents.push(stepEvent);
        scheduleFlush();
      };

      source.addEventListener('log', onLog);
      source.addEventListener('step', onStep);
      // Older servers may send unnamed log events.
      source.onmessage = onLog;
      source.onopen = () => {
        attempt = 0;
        setReconnectAttempt(0);
        setStreamState('connected');
        setStreamError(null);
      };
      source.onerror = () => {
        if (disposed) return;
        source.close();
        if (eventSourceRef.current === source) eventSourceRef.current = null;
        attempt += 1;
        const base = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * (2 ** Math.min(attempt - 1, 5)));
        const delay = Math.round(base * (0.8 + Math.random() * 0.4));
        setReconnectAttempt(attempt);
        setStreamState('error');
        setStreamError(`Reconectando en ${Math.ceil(delay / 1000)}s`);
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimer) clearTimeout(flushTimer);
      pendingLogs.length = 0;
      pendingStepEvents.length = 0;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [executionId, reconnectKey]);

  // Only follow the stream when the reader is already close to the end.
  // The log view owns the scroll container; the sentinel lets us inspect it
  // without coupling this hook to a particular layout.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const end = logEndRef.current;
      const container = end?.parentElement;
      if (!end || !container) return;
      const distanceFromEnd = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromEnd <= 96) {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        end.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'end' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [logs]);

  const reconnect = useCallback(() => setReconnectKey(key => key + 1), []);
  return { logs, setLogs, stepEvents, setStepEvents, logEndRef, streamState, reconnectAttempt, streamError, reconnect };
}
