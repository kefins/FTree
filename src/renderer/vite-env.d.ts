/// <reference types="vite/client" />

import type { FTreeAPI } from './types/person';

declare global {
  interface Window {
    ftreeAPI?: FTreeAPI;
  }
}
