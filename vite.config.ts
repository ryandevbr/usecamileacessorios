import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

const INITIAL_SHELL_ENV_KEYS = new Set(Object.keys(process.env));

export default defineConfig(({ command, mode, isPreview }) => {
  if (command === "serve") {
    const serverEnv = loadEnv(mode, process.cwd(), "");
    for (const [key, value] of Object.entries(serverEnv)) {
      if (!INITIAL_SHELL_ENV_KEYS.has(key)) {
        process.env[key] = value;
      }
    }
  }

  return {
    server: {
      host: "::",
      port: 8080,
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        server: { entry: "server" },
      }),
      ...(command === "build" || isPreview ? [nitro()] : []),
      viteReact(),
    ],
  };
});
