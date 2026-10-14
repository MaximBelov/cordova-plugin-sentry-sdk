"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crash = exports.setContext = exports.setTags = exports.setUser = exports.start = void 0;
const SERVICE = 'SentrySdk';
const call = (action, ...args) => new Promise((resolve, reject) => cordova.exec((r) => resolve(r), reject, SERVICE, action, args));
/** Starts the native SDK. Call once, after `deviceready`; a second call is answered without restarting. */
const start = (options) => call('start', options);
exports.start = start;
/** Sets the user on the native scope, or clears it with `null`. */
const setUser = (user) => call('setUser', user);
exports.setUser = setUser;
/** Sets tags on the native scope; a `null` value removes that tag. */
const setTags = (tags) => call('setTags', tags);
exports.setTags = setTags;
/** Sets a context (a named object) on the native scope, or removes it with `null`. */
const setContext = (key, value) => call('setContext', key, value);
exports.setContext = setContext;
/** Crashes the process natively. For a device probe, never for the app: the promise never resolves. */
const crash = () => call('crash');
exports.crash = crash;
