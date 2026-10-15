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
/**
 * Wraps the setters of `scope` so that what is set is also sent to the plugin. Binding the same scope again does nothing, and the
 * function it returns takes the wrapping off again. Bind the global, the isolation and the current scope: a scope made later by
 * `withScope` is a copy that does not carry the wrapping.
 */
export declare function bindScope(scope: object, options?: BindScopeOptions): () => void;
