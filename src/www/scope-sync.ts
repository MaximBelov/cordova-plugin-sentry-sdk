/**
 * cordova-plugin-sentry-sdk / scope-sync
 *
 * Keeps the native scope in step with a scope of the JavaScript SDK: what the page sets on it (the user, tags, extras, contexts,
 * breadcrumbs) is forwarded to the plugin, so a native crash carries what the page knew. It depends on nothing: the scope is taken by its
 * shape, so it fits `@sentry/core`'s `Scope` of any version that has these methods, and a scope that lacks one is left without it.
 *
 *     import { bindScope } from 'cordova-plugin-sentry-sdk/www/scope-sync';
 *     bindScope(Sentry.getGlobalScope());
 *     bindScope(Sentry.getIsolationScope());
 *     bindScope(Sentry.getCurrentScope());
 *
 * The scope keeps working as it did: the original method runs first and its answer is the one returned, and what goes to native never
 * throws into the page. A failure on the way, a refusal by the plugin included, goes to `onError`.
 */

/** The calls of the plugin that the helper forwards to, each one optional: a plugin that does not have one is not sent it. */
export interface SentrySdkLike {
  setUser?(user: Record<string, unknown> | null): unknown;
  setTags?(tags: Record<string, string | number | boolean | null>): unknown;
  setExtras?(extras: Record<string, unknown>): unknown;
  setContext?(key: string, value: Record<string, unknown> | null): unknown;
  addBreadcrumb?(breadcrumb: Record<string, unknown>): unknown;
  clearBreadcrumbs?(): unknown;
}

export interface BindScopeOptions {
  /**
   * The plugin to forward to. Unset, it is `window.SentrySdk`, looked up at every call: that object exists only after `deviceready`, and
   * not at all in a browser, where the scope then works as it always did and nothing is sent.
   */
  sdk?: SentrySdkLike;
  /** Called with the failure and the name of the plugin call it came from. It must not be needed: nothing is thrown into the page. */
  onError?: (error: unknown, method: string) => void;
}

type Method = (...args: unknown[]) => unknown;

const BOUND = new WeakMap<object, () => void>();

const methodOf = (target: object, name: string): Method | undefined => {
  const value = (target as Record<string, unknown>)[name];
  return typeof value === 'function' ? (value as Method) : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A copy that is plain JSON, or `undefined` when there is none (a cycle, a BigInt): what native is sent has to survive the bridge. */
const plain = (value: unknown): unknown => {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};

// The plugin takes a tag as a string, a finite number, a boolean or null (a removal), and refuses the rest, so everything else the JS SDK
// accepts becomes what it would print as.
const tagValue = (value: unknown): string | number | boolean | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  try {
    return String(value);
  } catch {
    return null;
  }
};

/** What the plugin reads of a breadcrumb: the fields it knows, of the types it takes, so one odd field does not cost the whole crumb. */
const breadcrumbOf = (crumb: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(crumb)) {
    return undefined;
  }
  const sent: Record<string, unknown> = {};
  for (const field of ['type', 'category', 'message', 'level']) {
    if (typeof crumb[field] === 'string') {
      sent[field] = crumb[field];
    }
  }
  if (typeof crumb.timestamp === 'number' && Number.isFinite(crumb.timestamp)) {
    sent.timestamp = crumb.timestamp;
  }
  if (isRecord(crumb.data)) {
    const data = plain(crumb.data);
    if (isRecord(data)) {
      sent.data = data;
    }
  }
  return sent;
};

/**
 * Wraps the setters of `scope` so that what is set is also sent to the plugin. Binding the same scope again does nothing, and the
 * function it returns takes the wrapping off again. Bind the global, the isolation and the current scope: a scope made later by
 * `withScope` is a copy that does not carry the wrapping.
 */
export function bindScope(scope: object, options: BindScopeOptions = {}): () => void {
  const bound = BOUND.get(scope);
  if (bound) {
    return bound;
  }

  const report = (error: unknown, method: string): void => {
    try {
      options.onError?.(error, method);
    } catch {
      // the handler of an error is not allowed to be one more
    }
  };

  const forward = (method: keyof SentrySdkLike, ...args: unknown[]): void => {
    try {
      const sdk: SentrySdkLike | undefined = options.sdk ?? (globalThis as { SentrySdk?: SentrySdkLike }).SentrySdk;
      const call = sdk && methodOf(sdk, method);
      if (!sdk || !call) {
        return;
      }
      const result = call.apply(sdk, args);
      if (isRecord(result) && typeof result.catch === 'function') {
        (result as unknown as Promise<unknown>).catch((error) => report(error, method));
      }
    } catch (error) {
      report(error, method);
    }
  };

  const restores: Array<() => void> = [];

  const wrap = (name: string, make: (original: Method) => Method): void => {
    const original = methodOf(scope, name);
    if (!original) {
      return;
    }
    const wrapped = make(original);
    const owned = Object.prototype.hasOwnProperty.call(scope, name);
    (scope as Record<string, unknown>)[name] = wrapped;
    restores.push(() => {
      // Only what is still ours is taken off: another wrapper put on after this one is not this one's to undo.
      if ((scope as Record<string, unknown>)[name] !== wrapped) {
        return;
      }
      if (owned) {
        (scope as Record<string, unknown>)[name] = original;
      } else {
        delete (scope as Record<string, unknown>)[name];
      }
    });
  };

  wrap('setUser', (original) => (user) => {
    const answer = original.call(scope, user);
    forward('setUser', isRecord(user) ? user : null);
    return answer;
  });

  wrap('setTag', (original) => (key, value) => {
    const answer = original.call(scope, key, value);
    forward('setTags', { [String(key)]: tagValue(value) });
    return answer;
  });

  wrap('setTags', (original) => (tags) => {
    const answer = original.call(scope, tags);
    if (isRecord(tags)) {
      const sent: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(tags)) {
        sent[key] = tagValue(value);
      }
      forward('setTags', sent);
    }
    return answer;
  });

  const extrasOf = (extras: Record<string, unknown>): Record<string, unknown> => {
    const sent: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(extras)) {
      if (plain(value) === undefined && value !== undefined && value !== null) {
        report(new Error(`the extra ${key} cannot be sent as JSON`), 'setExtras');
        continue;
      }
      sent[key] = value;
    }
    return sent;
  };

  wrap('setExtra', (original) => (key, value) => {
    const answer = original.call(scope, key, value);
    forward('setExtras', extrasOf({ [String(key)]: value }));
    return answer;
  });

  wrap('setExtras', (original) => (extras) => {
    const answer = original.call(scope, extras);
    if (isRecord(extras)) {
      forward('setExtras', extrasOf(extras));
    }
    return answer;
  });

  wrap('setContext', (original) => (key, context) => {
    const answer = original.call(scope, key, context);
    if (context === null || context === undefined) {
      forward('setContext', String(key), null);
    } else if (isRecord(plain(context))) {
      forward('setContext', String(key), plain(context));
    } else {
      report(new Error(`the context ${String(key)} cannot be sent as JSON`), 'setContext');
    }
    return answer;
  });

  // Whether the scope took the crumb is its own to say (a limit of 0 takes none), so the crumb that is sent is the one the scope now ends
  // with, and only when that is a new one. That is also the crumb as the scope completed it, with its timestamp.
  const lastCrumb = methodOf(scope, 'getLastBreadcrumb');
  wrap('addBreadcrumb', (original) => (crumb, max) => {
    const before = lastCrumb?.call(scope);
    const answer = original.call(scope, crumb, max);
    const after = lastCrumb ? lastCrumb.call(scope) : crumb;
    if (after !== before) {
      const sent = breadcrumbOf(after);
      if (sent) {
        forward('addBreadcrumb', sent);
      }
    }
    return answer;
  });

  wrap('clearBreadcrumbs', (original) => () => {
    const answer = original.call(scope);
    forward('clearBreadcrumbs');
    return answer;
  });

  const unbind = (): void => {
    BOUND.delete(scope);
    restores.splice(0).forEach((restore) => restore());
  };
  BOUND.set(scope, unbind);
  return unbind;
}
