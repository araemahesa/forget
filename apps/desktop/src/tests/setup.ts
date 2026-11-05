import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(cleanup);

if (typeof window !== 'undefined') Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({
  matches: /max-width:\s*(\d+)px/.test(query) && window.innerWidth <= Number(query.match(/max-width:\s*(\d+)px/)?.[1]),
  media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
}) });
