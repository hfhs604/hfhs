import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages project sites are served from https://<user>.github.io/<repo>/,
// so the app needs to know that subpath at build time. The deploy workflow
// sets VITE_BASE_PATH="/<repo-name>/" automatically — you don't need to
// edit this file. Local `npm run dev` / `npm run build` without that env
// var falls back to "/", which is correct for local testing.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "/",
});
