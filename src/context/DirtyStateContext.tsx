import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

// =============================================================================
// DirtyStateContext — module-level registry of "I have unsaved work" labels.
// Components register via the `useDirty(label, isDirty)` hook and the registry
// is consulted by the App-level `guardedNavigate` before mode switches.
//
// Why module-level Set + React state mirror: registration happens during
// renders and effect cleanup, sometimes during a navigation attempt that
// fires synchronously from a click. A pure-React useReducer would have
// stale-state race conditions; a Set in module scope is dead simple and
// safe because the only reader is the guard handler at click time.
//
// We mirror the Set's size into React state via a listener so consumers
// that want to subscribe (e.g., debugging banners) can. The guard handler
// itself reads the Set directly for freshness.
// =============================================================================

const labels = new Set<string>();
const listeners = new Set<() => void>();

function register(label: string) {
  labels.add(label);
  listeners.forEach((fn) => fn());
}

function unregister(label: string) {
  labels.delete(label);
  listeners.forEach((fn) => fn());
}

/** Live read at call time — always sees the current registry. */
function isAnyDirtyNow(): boolean {
  return labels.size > 0;
}

/** Snapshot of current labels — used by the confirm-leave modal to tell
 *  the user what'll be lost. Returns a stable array (sorted). */
function getDirtyLabelsNow(): string[] {
  return Array.from(labels).sort();
}

// -----------------------------------------------------------------------------
// React surface
// -----------------------------------------------------------------------------

interface DirtyStateContextValue {
  isAnyDirty: boolean;
  dirtyLabels: string[];
  /** Live, freshness-safe read. Use inside synchronous click handlers
   *  where `isAnyDirty` (a React state mirror) might be one render stale. */
  checkNow: () => boolean;
  getLabelsNow: () => string[];
}

const DirtyStateContext = createContext<DirtyStateContextValue>({
  isAnyDirty: false,
  dirtyLabels: [],
  checkNow: () => false,
  getLabelsNow: () => [],
});

export function DirtyStateProvider({ children }: { children: React.ReactNode }) {
  const [isAnyDirty, setIsAnyDirty] = useState(false);
  const [dirtyLabels, setDirtyLabels] = useState<string[]>([]);

  useEffect(() => {
    const listener = () => {
      setIsAnyDirty(labels.size > 0);
      setDirtyLabels(getDirtyLabelsNow());
    };
    listeners.add(listener);
    // Sync initial state in case labels are already registered (e.g.,
    // strict-mode double-mount or hot reload).
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const checkNow = useCallback(() => isAnyDirtyNow(), []);
  const getLabelsNow = useCallback(() => getDirtyLabelsNow(), []);

  return (
    <DirtyStateContext.Provider value={{ isAnyDirty, dirtyLabels, checkNow, getLabelsNow }}>
      {children}
    </DirtyStateContext.Provider>
  );
}

export function useDirtyState(): DirtyStateContextValue {
  return useContext(DirtyStateContext);
}

/** Opt a surface into the dirty-state registry. When `isDirty` is true the
 *  `label` is added to the global Set; cleanup removes it on unmount or when
 *  `isDirty` flips false.
 *
 *  The `label` is shown to the user in the confirm-leave modal so they know
 *  what they'd lose — keep it short and human ("Chat composer", "Visit note"). */
export function useDirty(label: string, isDirty: boolean) {
  // Use a ref so we always unregister the exact label we registered with,
  // even if the prop changes between mount + unmount.
  const registered = useRef<string | null>(null);

  useEffect(() => {
    if (isDirty) {
      if (registered.current !== label) {
        if (registered.current) unregister(registered.current);
        register(label);
        registered.current = label;
      }
    } else if (registered.current) {
      unregister(registered.current);
      registered.current = null;
    }
  }, [label, isDirty]);

  useEffect(() => {
    return () => {
      if (registered.current) {
        unregister(registered.current);
        registered.current = null;
      }
    };
  }, []);
}
