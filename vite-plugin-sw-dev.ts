import type { Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function swDevPlugin(): Plugin {
  return {
    name: "sw-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/sw.js" && !req.url?.startsWith("/sw.js?")) return next();
        try {
          const swPath = path.resolve(__dirname, "src/sw.ts");
          const code = await readFile(swPath, "utf-8");
          const result = await transform(code, {
            loader: "ts",
            target: "esnext",
          });
          res.setHeader("Content-Type", "application/javascript");
          res.end(result.code);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
