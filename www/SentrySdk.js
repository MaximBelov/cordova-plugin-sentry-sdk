"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crash = exports.captureMessage = exports.getDeviceInfo = exports.isEnabled = exports.close = exports.setExtras = exports.clearBreadcrumbs = exports.addBreadcrumb = exports.setContext = exports.setTags = exports.setUser = exports.start = void 0;
const SERVICE = 'SentrySdk';
const LEVELS = ['debug', 'info', 'warning', 'error', 'fatal'];
const call = (action, ...args) => new Promise((resolve, reject) => cordova.exec((r) => resolve(r), reject, SERVICE, action, args));
/** A refusal reaches the page the way native's do: the promise rejects, with the reason as a string. */
const refuse = (reason) => {
    throw reason;
};
const USER_FIELDS = ['id', 'email', 'username'];
// What native makes of a value it did not expect is not the same on the two platforms (a number is its text on Android and dropped
// on iOS, a JSON null is the text "null" on one and nothing on the other, an array is a removal on both), so what is settled here is
// settled once: a number becomes its text, an empty string and null are left out, and anything else is refused.
const checkUser = (user) => {
    if (user === null) {
        return null;
    }
    if (typeof user !== 'object' || Array.isArray(user)) {
        return refuse('setUser needs an object or null');
    }
    const checked = {};
    for (const field of USER_FIELDS) {
        const value = user[field];
        if (value === undefined || value === null || value === '') {
            continue;
        }
        if (typeof value === 'string') {
            checked[field] = value;
        }
        else if (typeof value === 'number' && Number.isFinite(value)) {
            checked[field] = String(value);
        }
        else {
            return refuse(`setUser: ${field} has to be a string or a number`);
        }
    }
    return checked;
};
const checkTags = (tags) => {
    if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) {
        return refuse('setTags needs an object');
    }
    for (const [key, value] of Object.entries(tags)) {
        const fine = value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
        if (!fine) {
            return refuse(`setTags: the value of ${key} has to be a string, a number, a boolean or null`);
        }
    }
    return tags;
};
const checkCapture = (message, level) => {
    if (typeof message !== 'string' || message === '') {
        return refuse('captureMessage needs a message');
    }
    if (!LEVELS.includes(level)) {
        return refuse('captureMessage: the level has to be debug, info, warning, error or fatal');
    }
    return [message, level];
};
const checkContext = (key, value) => {
    if (typeof key !== 'string' || key === '') {
        return refuse('setContext needs a key');
    }
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
        return refuse('setContext needs an object or null');
    }
    return [key, value];
};
// The two platforms read a value of the wrong type differently (Android's JSON reader makes the text "true" a boolean, Swift's cast
// drops it), so a start option that is not what it says is refused here, once. An option that is not given is left to the SDK's default.
const BOOLEAN_OPTIONS = [
    'debug',
    'enableNativeCrashHandling',
    'enableWatchdogTerminationTracking',
    'sendDefaultPii',
    'attachStacktrace',
    'attachThreads',
    'enableNdkScopeSync',
    'recordPluginErrors',
];
const COUNT_OPTIONS = ['maxBreadcrumbs', 'sessionTrackingIntervalMillis'];
const checkStartOptions = (options) => {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
        return options;
    }
    for (const name of BOOLEAN_OPTIONS) {
        const value = options[name];
        if (value !== undefined && typeof value !== 'boolean') {
            return refuse(`start: ${name} has to be true or false`);
        }
    }
    for (const name of COUNT_OPTIONS) {
        const value = options[name];
        if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
            return refuse(`start: ${name} has to be a whole number, 0 or more`);
        }
    }
    const rate = options.sampleRate;
    if (rate !== undefined && (typeof rate !== 'number' || !(rate >= 0 && rate <= 1))) {
        return refuse('start: sampleRate has to be a number from 0 to 1');
    }
    return options;
};
const BREADCRUMB_TEXT_FIELDS = ['type', 'category', 'message'];
const BREADCRUMB_LEVELS = {
    fatal: 'fatal',
    critical: 'fatal',
    error: 'error',
    warning: 'warning',
    log: 'debug',
    info: 'info',
    debug: 'debug',
};
// The levels `log` and `critical` do not exist natively, so they are mapped here, once, for both platforms. Data is sent as the JSON it
// is, so a value JSON cannot carry (a cycle, a BigInt) is refused here and not dropped by one platform and kept by the other.
const checkBreadcrumb = (breadcrumb) => {
    if (typeof breadcrumb !== 'object' || breadcrumb === null || Array.isArray(breadcrumb)) {
        return refuse('addBreadcrumb needs an object');
    }
    const checked = {};
    for (const field of BREADCRUMB_TEXT_FIELDS) {
        const value = breadcrumb[field];
        if (value === undefined || value === null) {
            continue;
        }
        if (typeof value !== 'string') {
            return refuse(`addBreadcrumb: ${field} has to be a string`);
        }
        checked[field] = value;
    }
    if (breadcrumb.level !== undefined && breadcrumb.level !== null) {
        if (typeof breadcrumb.level !== 'string' || !Object.prototype.hasOwnProperty.call(BREADCRUMB_LEVELS, breadcrumb.level)) {
            return refuse(`addBreadcrumb: level has to be one of ${Object.keys(BREADCRUMB_LEVELS).join(', ')}`);
        }
        checked.level = BREADCRUMB_LEVELS[breadcrumb.level];
    }
    if (breadcrumb.timestamp !== undefined && breadcrumb.timestamp !== null) {
        if (typeof breadcrumb.timestamp !== 'number' || !Number.isFinite(breadcrumb.timestamp)) {
            return refuse('addBreadcrumb: timestamp has to be a number of seconds');
        }
        checked.timestamp = breadcrumb.timestamp;
    }
    if (breadcrumb.data !== undefined && breadcrumb.data !== null) {
        if (typeof breadcrumb.data !== 'object' || Array.isArray(breadcrumb.data)) {
            return refuse('addBreadcrumb: data has to be an object');
        }
        try {
            checked.data = JSON.parse(JSON.stringify(breadcrumb.data));
        }
        catch (_a) {
            return refuse('addBreadcrumb: data cannot be sent as JSON');
        }
    }
    return checked;
};
// An extra is text on Android (sentry-android's scope takes a string), so what is settled here, once, is that it is text on both: a string
// stays as it is, `null` and `undefined` remove the extra (an undefined value would be dropped by the JSON the bridge sends, and the key
// with it), and anything else is its JSON.
const checkExtras = (extras) => {
    if (typeof extras !== 'object' || extras === null || Array.isArray(extras)) {
        return refuse('setExtras needs an object');
    }
    const checked = {};
    for (const [key, value] of Object.entries(extras)) {
        if (value === undefined || value === null) {
            checked[key] = null;
        }
        else if (typeof value === 'string') {
            checked[key] = value;
        }
        else {
            let text;
            try {
                text = JSON.stringify(value);
            }
            catch (_a) {
                return refuse(`setExtras: the value of ${key} cannot be sent as JSON`);
            }
            if (text === undefined) {
                return refuse(`setExtras: the value of ${key} cannot be sent as JSON`);
            }
            checked[key] = text;
        }
    }
    return checked;
};
const PLUGIN_ERRORS = Symbol.for('cordova-plugin-sentry-sdk.pluginErrors');
const WRAPPED = Symbol.for('cordova-plugin-sentry-sdk.callbackFromNative');
const KEPT = 100;
const ERROR_LENGTH = 200;
const pluginErrors = () => {
    var _a;
    const global = globalThis;
    return ((_a = global[PLUGIN_ERRORS]) !== null && _a !== void 0 ? _a : (global[PLUGIN_ERRORS] = { mode: 'waiting', waiting: [], pending: [], scopes: [] }));
};
const keep = (list, crumb) => {
    list.push(crumb);
    if (list.length > KEPT) {
        list.shift();
    }
};
/** The first argument of a failed result as text: a string as it is, anything else as its JSON or what it prints as. */
const errorText = (value) => {
    if (value === undefined) {
        return undefined;
    }
    let text;
    if (typeof value === 'string') {
        text = value;
    }
    else {
        try {
            text = JSON.stringify(value);
        }
        catch (_a) {
            text = undefined;
        }
        if (text === undefined) {
            try {
                text = String(value);
            }
            catch (_b) {
                return undefined;
            }
        }
    }
    return text.slice(0, ERROR_LENGTH);
};
// Native gets its copy through the bridge directly, not through `call`: nobody waits for the answer, and a refusal is not the page's.
const recordPluginError = (crumb) => {
    try {
        cordova.exec(() => undefined, () => undefined, SERVICE, 'addBreadcrumb', [crumb]);
    }
    catch (_a) {
        // a recording that fails is not allowed to be the page's problem
    }
    const errors = pluginErrors();
    const scope = errors.scopes[0];
    if (!scope) {
        keep(errors.pending, crumb);
        return;
    }
    try {
        scope(crumb);
    }
    catch (_b) {
        // as above
    }
};
// A callback id is the plugin's service name and a counter (`Camera1234`), on both platforms. What the call was sent is not in a result,
// and is never looked for: only the service, the status and the first argument of the answer are kept.
const notePluginError = (callbackId, status, args) => {
    const errors = pluginErrors();
    const service = String(callbackId).replace(/\d+$/, '');
    if (errors.mode === 'off' || service === SERVICE) {
        return;
    }
    const data = { service, status };
    const error = errorText(Array.isArray(args) ? args[0] : undefined);
    if (error !== undefined) {
        data.error = error;
    }
    const crumb = {
        category: 'cordova.plugin',
        level: 'error',
        message: `${service} answered with an error`,
        timestamp: Date.now() / 1000,
        data,
    };
    if (errors.mode === 'waiting') {
        keep(errors.waiting, crumb);
    }
    else {
        recordPluginError(crumb);
    }
};
// Both platforms' cordova.js hand every native result to `cordova.callbackFromNative`, looked up on the object at each call, so wrapping
// the property sees every plugin, one that kept `cordova/exec` from before this loaded included. It is wrapped as this module loads, which
// is before the app can call `start`, and once: a wrapper that is already there is left alone.
const watchPluginResults = () => {
    if (typeof cordova === 'undefined' || cordova === null) {
        return;
    }
    const original = cordova.callbackFromNative;
    if (typeof original !== 'function' || original[WRAPPED]) {
        return;
    }
    const wrapped = function (...args) {
        if (args[1] === false) {
            try {
                notePluginError(args[0], args[2], args[3]);
            }
            catch (_a) {
                // the bridge has to deliver the result whatever happens here
            }
        }
        return original.apply(this, args);
    };
    wrapped[WRAPPED] = true;
    cordova.callbackFromNative = wrapped;
};
watchPluginResults();
/** The last accepted `start` decides: what was kept before it is recorded when the option is on, and dropped with the recording when not. */
const decidePluginErrors = (options) => {
    const errors = pluginErrors();
    const on = typeof options === 'object' && options !== null && options.recordPluginErrors === true;
    errors.mode = on ? 'on' : 'off';
    const waiting = errors.waiting.splice(0);
    if (on) {
        waiting.forEach(recordPluginError);
    }
};
/** Starts the native SDK. Call once, after `deviceready`; a second call is answered without restarting. */
const start = async (options) => call('start', checkStartOptions(options)).then((answer) => {
    decidePluginErrors(options);
    return answer;
});
exports.start = start;
/** Sets the user on the native scope, or clears it with `null`. */
const setUser = async (user) => call('setUser', checkUser(user));
exports.setUser = setUser;
/** Sets tags on the native scope; a `null` value removes that tag. */
const setTags = async (tags) => call('setTags', checkTags(tags));
exports.setTags = setTags;
/** Sets a context (a named object) on the native scope, or removes it with `null`. */
const setContext = async (key, value) => call('setContext', ...checkContext(key, value));
exports.setContext = setContext;
/**
 * Adds a breadcrumb to the native scope, so a native crash carries what the page did before it. While the SDK is not running it is
 * kept, in order and up to the last hundred, and `start` adds them.
 */
const addBreadcrumb = async (breadcrumb) => call('addBreadcrumb', checkBreadcrumb(breadcrumb));
exports.addBreadcrumb = addBreadcrumb;
/** Clears the native scope's breadcrumbs, and the ones kept for `start`. */
const clearBreadcrumbs = () => call('clearBreadcrumbs');
exports.clearBreadcrumbs = clearBreadcrumbs;
/**
 * Sets extras on the native scope: each value is its text on both platforms (a string as it is, anything else as JSON), and `null` or
 * `undefined` removes the extra. Extras are the older, flatter relative of a context; prefer `setContext`.
 */
const setExtras = async (extras) => call('setExtras', checkExtras(extras));
exports.setExtras = setExtras;
/**
 * Stops the native SDK, flushing what it holds. A later `start` starts it again, and what the page set while it was down is kept for that
 * start. `allowCrash` is taken back: the next `start` has to give it again.
 */
const close = () => call('close');
exports.close = close;
/** Whether the native SDK is running, whoever started it. */
const isEnabled = () => call('isEnabled');
exports.isEnabled = isEnabled;
/** Reads the OS, the device and the app from the system. Needs no running SDK, and changes nothing. */
const getDeviceInfo = () => call('getDeviceInfo');
exports.getDeviceInfo = getDeviceInfo;
/**
 * Sends a message event at the given level (default `info`). Unlike a scope change it is not queued: a message needs the SDK running,
 * and while it is not, the promise rejects with the reason, so the caller knows it was not sent.
 */
const captureMessage = async (message, level = 'info') => call('captureMessage', ...checkCapture(message, level));
exports.captureMessage = captureMessage;
/** Crashes the process natively, when `start` was given `allowCrash: true`. For a device probe, never for the app: the promise never settles, the app is gone. */
const crash = () => call('crash');
exports.crash = crash;
