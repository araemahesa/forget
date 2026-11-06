import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], server: { port: 1420, strictPort: true }, clearScreen: false, test: { environment: "jsdom", globals: true, setupFiles: ["./src/tests/setup.ts"], exclude: ["node_modules/**", "src-tauri/**", "dist/**"], testTimeout: 30000, maxWorkers: "50%" } });
