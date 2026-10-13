import type * as SentryNative from '../www/sentryNative';

declare global {
  interface Window {
    SentryNative?: typeof SentryNative;
  }
}

export {};
