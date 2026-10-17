import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(repoRoot, "extension");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

async function main() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "work-video-link-cdp-"));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: edgePath,
      headless: false,
      viewport: { width: 420, height: 620 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--disable-default-apps",
      ],
    });
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 15000 }));
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const result = await page.evaluate(async () => {
      const response = await fetch("http://127.0.0.1:9229/json/list");
      const targets = await response.json();
      const target = targets.find(
        (item) => item.type === "page" && item.url.startsWith("app://-/"),
      );
      if (!target) return { fetchOk: true, target: null };

      const socketResult = await new Promise((resolve) => {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        const timer = setTimeout(() => {
          socket.close();
          resolve({ opened: false, error: "timeout" });
        }, 5000);

        socket.addEventListener("open", () => {
          clearTimeout(timer);
          socket.send(
            JSON.stringify({
              id: 1,
              method: "Runtime.evaluate",
              params: {
                expression:
                  "({working: Boolean(document.querySelector('[role=status][aria-label=Working]')), stop: Boolean([...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Stop')), title: document.title})",
                returnByValue: true,
              },
            }),
          );
        });
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(event.data);
          if (message.id === 1) {
            clearTimeout(timer);
            socket.close();
            resolve({ opened: true, value: message.result?.result?.value });
          }
        });
        socket.addEventListener("error", () => {
          clearTimeout(timer);
          resolve({ opened: false, error: "error-event" });
        });
      });

      const bridgeResult = await new Promise((resolve) => {
        const socket = new WebSocket("ws://127.0.0.1:17321/ws");
        const timer = setTimeout(() => {
          socket.close();
          resolve({ opened: false, error: "timeout" });
        }, 5000);
        socket.addEventListener("message", (event) => {
          clearTimeout(timer);
          const status = JSON.parse(event.data);
          socket.close();
          resolve({ opened: true, status });
        });
        socket.addEventListener("error", () => {
          clearTimeout(timer);
          resolve({ opened: false, error: "error-event" });
        });
      });

      const douyinStatus = await fetch(
        "http://127.0.0.1:17321/douyin/status",
      ).then((item) => item.json());

      return {
        fetchOk: response.ok,
        douyinStatus,
        target: {
          id: target.id,
          title: target.title,
          url: target.url,
        },
        socketResult,
        bridgeResult,
      };
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (context) await context.close();
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(userDataDir);
    if (resolvedProfile.startsWith(tempRoot + path.sep)) {
      await fs.rm(resolvedProfile, { recursive: true, force: true });
    }
  }
}

await main();
