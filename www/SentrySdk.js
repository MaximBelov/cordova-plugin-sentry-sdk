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
/** Starts the native SDK. Call once, after `deviceready`; a second call is answered without restarting. */
const start = async (options) => call('start', checkStartOptions(options));
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
