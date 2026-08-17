#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderLineageBody, STYLE } from "./lineage-render.mjs";

export function readRecords(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return [];
  const out = [];
  for (const line of fs.readFileSync(jsonlPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip partial trailing line */
    }
  }
  return out;
}

export function sseFrame(records) {
  // Send server-rendered HTML (JSON-encoded to a single line) so the renderer stays single-source.
  return `event: lineage\ndata: ${JSON.stringify(renderLineageBody(records))}\n\n`;
}

function page(jsonlPath) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Linhagem de Carry (ao vivo)</title>
<style>${STYLE}</style></head><body>
<h1>🧬 Linhagem de Funding-Carry — ao vivo</h1>
<p class="sub">Atualiza sozinho a cada geração · fonte: <code>${path.basename(jsonlPath)}</code></p>
<div id="root"><p class="empty">Aguardando primeira geração…</p></div>
<script>
  const root = document.getElementById("root");
  const es = new EventSource("/events");
  es.addEventListener("lineage", (ev) => { root.innerHTML = JSON.parse(ev.data); });
</script></body></html>`;
}

export function createLineageServer(jsonlPath) {
  return http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page(jsonlPath));
      return;
    }
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(sseFrame(readRecords(jsonlPath))); // initial state
      const dir = path.dirname(jsonlPath);
      let timer = null;
      const watcher = fs.watch(dir, (_ev, fname) => {
        if (fname && path.basename(jsonlPath) !== String(fname)) return;
        clearTimeout(timer);
        timer = setTimeout(() => res.write(sseFrame(readRecords(jsonlPath))), 120); // debounce append bursts
      });
      req.on("close", () => {
        clearTimeout(timer);
        watcher.close();
      });
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
}

function main() {
  const args = process.argv.slice(2);
  const jsonlPath = args.find((a) => !a.startsWith("--")) || path.join(os.homedir(), ".automaton", "carry-lineage.jsonl");
  const portArg = args.indexOf("--port");
  const port = portArg >= 0 ? Number(args[portArg + 1]) : 7878;
  const open = args.includes("--open");
  fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
  const server = createLineageServer(jsonlPath);
  server.listen(port, () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Lineage server live at ${url} (watching ${jsonlPath})`);
    if (open) {
      const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
      const cmdArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
      import("node:child_process").then(({ spawn }) => spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref());
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
