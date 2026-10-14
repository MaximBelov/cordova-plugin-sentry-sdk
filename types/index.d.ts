import type * as SentrySdk from '../www/SentrySdk';

declare global {
  interface Window {
    SentrySdk?: typeof SentrySdk;
  }
}

export {};
