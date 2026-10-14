"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crash = exports.setContext = exports.setTags = exports.setUser = exports.start = void 0;
const SERVICE = 'SentrySdk';
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
const checkContext = (key, value) => {
    if (typeof key !== 'string' || key === '') {
        return refuse('setContext needs a key');
    }
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
        return refuse('setContext needs an object or null');
    }
    return [key, value];
};
/** Starts the native SDK. Call once, after `deviceready`; a second call is answered without restarting. */
const start = (options) => call('start', options);
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
/** Crashes the process natively, when `start` was given `allowCrash: true`. For a device probe, never for the app: the promise never settles, the app is gone. */
const crash = () => call('crash');
exports.crash = crash;
