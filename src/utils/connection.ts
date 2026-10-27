// Whether this installation has ever had a successful upstream answer. Kept in the extension's
// global state, so the setup guide stays until the first real connection, not just until the
// first request (a failed request is not a connection).

interface StateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): unknown;
}

const KEY = 'tpt.connected';
let store: StateStore | undefined;
let connected = false;

export function initConnectionState(state: StateStore): void {
  store = state;
  connected = state.get<boolean>(KEY) === true;
}

export function markConnected(): void {
  if (connected) return;
  connected = true;
  // Persisting is best-effort: the flag still holds for this session if the write fails
  void store?.update(KEY, true);
}

export function hasConnected(): boolean {
  return connected;
}
