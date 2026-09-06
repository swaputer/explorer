import { shallowReactive } from "vue";

/** Server cursors belong to this table, not to a realtime refresh cycle. */
export function useCursorTable<T>(fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>, onError: (error: unknown) => void) {
  const state = shallowReactive({ items: [] as T[], page: 1, nextCursor: undefined as string | undefined, loading: false });
  let cursors: Array<string | undefined> = [undefined];
  let version = 0;

  async function load(page = state.page) {
    if (state.loading) return;
    const request = ++version;
    state.loading = true;
    try {
      const result = await fetchPage(cursors[page - 1]);
      if (request !== version) return;
      state.items = result.items;
      state.nextCursor = result.nextCursor;
      state.page = page;
    } catch (error) {
      if (request === version) onError(error);
    } finally {
      if (request === version) state.loading = false;
    }
  }

  function reset() {
    ++version;
    cursors = [undefined];
    state.items = [];
    state.page = 1;
    state.nextCursor = undefined;
    state.loading = false;
  }

  return Object.assign(state, {
    load, reset,
    next() {
      if (state.loading || !state.nextCursor) return;
      cursors = cursors.slice(0, state.page);
      cursors.push(state.nextCursor);
      return load(state.page + 1);
    },
    previous() {
      if (state.loading || state.page <= 1) return;
      return load(state.page - 1);
    }
  });
}
