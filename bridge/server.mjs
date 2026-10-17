import crypto from "node:crypto";
import { execFile } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const CDP_HTTP = "http://127.0.0.1:9229";
const BRIDGE_PORT = 17321;
const DOUYIN_PROTOCOL = "douyin-pc://";
const DOUYIN_LAUNCH_TIMEOUT_MS = 10000;
const DOUYIN_CONTROL_TIMEOUT_MS = 15000;
const DOUYIN_CONTROL_SCRIPT = fileURLToPath(
  new URL("./douyin-control.ps1", import.meta.url),
);
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const EVALUATION_INTERVAL_MS = 1000;
const RECONNECT_INTERVAL_MS = 1800;
const HEARTBEAT_INTERVAL_MS = 5000;
const execFileAsync = promisify(execFile);

const clients = new Set();
const pendingCommands = new Map();
let douyinControlQueue = Promise.resolve();

let cdpSocket = null;
let targetId = null;
let available = false;
let hasWorkingState = false;
let working = false;
let nextCommandId = 1;
let pollTimer = null;
let reconnectTimer = null;
let stopping = false;

function currentStatus() {
  return {
    type: "codex-status",
    available: available && hasWorkingState,
    working: available && hasWorkingState ? working : false,
    targetId: available && hasWorkingState ? targetId : null,
    timestamp: Date.now(),
  };
}

function statusJson() {
  return JSON.stringify(currentStatus());
}

function encodeFrame(payload, opcode = 0x1) {
  const data = Buffer.from(payload);
  let header;

  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }

  return Buffer.concat([header, data]);
}

function sendClient(client, payload, opcode = 0x1) {
  if (client.socket.destroyed) return;
  client.socket.write(encodeFrame(payload, opcode));
}

function broadcastStatus() {
  const message = statusJson();
  for (const client of clients) {
    try {
      sendClient(client, message);
    } catch (_) {
      clients.delete(client);
    }
  }
}

function handleClientBuffer(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (client.buffer.length < 4) return;
      payloadLength = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (client.buffer.length < 10) return;
      const length = client.buffer.readBigUInt64BE(2);
      if (length > BigInt(Number.MAX_SAFE_INTEGER)) {
        client.socket.destroy();
        return;
      }
      payloadLength = Number(length);
      offset = 10;
    }

    const maskOffset = offset;
    if (masked) offset += 4;
    const totalLength = offset + payloadLength;
    if (client.buffer.length < totalLength) return;

    const payload = Buffer.from(
      client.buffer.subarray(offset, totalLength),
    );
    if (masked) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= client.buffer[maskOffset + (index % 4)];
      }
    }
    client.buffer = client.buffer.subarray(totalLength);

    if (opcode === 0x8) {
      client.socket.end();
      clients.delete(client);
      return;
    }
    if (opcode === 0x9) {
      sendClient(client, payload, 0xa);
    }
  }
}

function removeClient(client) {
  clients.delete(client);
  client.socket.destroy();
}

function attachWebSocket(request, socket) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}${WS_GUID}`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "Access-Control-Allow-Origin: *",
      "",
      "",
    ].join("\r\n"),
  );

  const client = { socket, buffer: Buffer.alloc(0) };
  clients.add(client);
  socket.on("data", (chunk) => handleClientBuffer(client, chunk));
  socket.on("close", () => clients.delete(client));
  socket.on("error", () => removeClient(client));
  sendClient(client, statusJson());
}

async function findCodexTarget() {
  const response = await fetch(`${CDP_HTTP}/json/list`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) {
    throw new Error(`CDP target list returned ${response.status}`);
  }
  const targets = await response.json();
  return targets.find(
    (target) => target.type === "page" && target.url.startsWith("app://-/"),
  );
}

function sendCdpCommand(method, params = {}) {
  if (!cdpSocket || cdpSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Codex CDP socket is not open"));
  }

  const id = nextCommandId;
  nextCommandId += 1;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`CDP command timed out: ${method}`));
    }, 2500);

    pendingCommands.set(id, { resolve, reject, timer });
    cdpSocket.send(JSON.stringify({ id, method, params }));
  });
}

function schedulePoll(delayMs = EVALUATION_INTERVAL_MS) {
  clearTimeout(pollTimer);
  if (stopping || !cdpSocket || cdpSocket.readyState !== WebSocket.OPEN) return;
  pollTimer = setTimeout(() => {
    void pollWorkingState();
  }, delayMs);
}

async function pollWorkingState() {
  if (stopping || !cdpSocket || cdpSocket.readyState !== WebSocket.OPEN) return;

  try {
    const response = await sendCdpCommand("Runtime.evaluate", {
      expression: `(() => {
        const visible = (element) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 3 && rect.height > 3 && style.display !== "none" && style.visibility !== "hidden";
        };
        const statusVisible = [...document.querySelectorAll('[role="status"][aria-label="Working"]')].some(visible);
        const stopVisible = [...document.querySelectorAll('button[aria-label="Stop"]')].some(visible);
        return { working: statusVisible || stopVisible };
      })()`,
      returnByValue: true,
    });

    const nextWorking = Boolean(response?.result?.result?.value?.working);
    const firstState = !hasWorkingState;
    hasWorkingState = true;
    if (firstState || nextWorking !== working) {
      working = nextWorking;
      console.log(`[bridge] Codex ${working ? "started" : "finished"} working`);
      broadcastStatus();
    }
    schedulePoll();
  } catch (error) {
    console.warn(`[bridge] CDP evaluation failed: ${error.message}`);
    disconnectCdp();
    scheduleReconnect();
  }
}

function disconnectCdp() {
  clearTimeout(pollTimer);
  pollTimer = null;
  available = false;
  hasWorkingState = false;
  working = false;

  for (const pending of pendingCommands.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Codex CDP disconnected"));
  }
  pendingCommands.clear();

  if (cdpSocket) {
    try {
      cdpSocket.close();
    } catch (_) {
      // Ignore already-closed sockets.
    }
  }
  cdpSocket = null;
  targetId = null;
  broadcastStatus();
}

function scheduleReconnect() {
  if (stopping || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectCdp();
  }, RECONNECT_INTERVAL_MS);
}

async function connectCdp() {
  if (stopping || cdpSocket) return;

  try {
    const target = await findCodexTarget();
    if (!target) throw new Error("Codex page target not found");
    targetId = target.id;

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    cdpSocket = socket;

    socket.addEventListener("open", () => {
      available = true;
      working = false;
      hasWorkingState = false;
      console.log("[bridge] Connected to Codex desktop");
      broadcastStatus();
      schedulePoll(150);
    });

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (!message.id) return;
      const pending = pendingCommands.get(message.id);
      if (!pending) return;
      pendingCommands.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || "CDP error"));
      } else {
        pending.resolve(message);
      }
    });

    socket.addEventListener("close", () => {
      if (cdpSocket === socket) {
        console.log("[bridge] Codex desktop connection closed");
        disconnectCdp();
        scheduleReconnect();
      }
    });
    socket.addEventListener("error", () => {
      if (cdpSocket === socket) {
        disconnectCdp();
        scheduleReconnect();
      }
    });
  } catch (_) {
    available = false;
    hasWorkingState = false;
    cdpSocket = null;
    targetId = null;
    broadcastStatus();
    scheduleReconnect();
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function queueDouyinControl(task) {
  const queued = douyinControlQueue.then(task, task);
  douyinControlQueue = queued.catch(() => {});
  return queued;
}

async function runPowerShell(script, timeout = 12000) {
  const { stdout, stderr } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n${script}`,
    ],
    { windowsHide: true, timeout, maxBuffer: 1024 * 1024 },
  );
  if (stderr.trim()) console.warn(`[bridge] PowerShell: ${stderr.trim()}`);
  return stdout.trim();
}

async function inspectDouyinDesktop() {
  const script = `
$protocolKey = 'Registry::HKEY_CLASSES_ROOT\\douyin-pc\\shell\\open\\command'
$protocolRegistered = Test-Path -LiteralPath $protocolKey
$command = $null
$executablePath = ""
if ($protocolRegistered) {
  try { $command = (Get-Item -LiteralPath $protocolKey).GetValue('') } catch { $command = $null }
}
if ($command) {
  if ($command -match '^\s*"([^"]+\.exe)"') {
    $executablePath = $matches[1]
  } elseif ($command -match '^\s*(.+?\.exe)(?:\s|$)') {
    $executablePath = $matches[1]
  }
}
$executableExists = [bool]($executablePath -and (Test-Path -LiteralPath $executablePath -PathType Leaf))
$processes = @(Get-Process -Name douyin -ErrorAction SilentlyContinue)
$appRunning = $processes.Count -gt 0
$window = $processes |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Sort-Object StartTime -Descending |
  Select-Object -First 1
$windowFound = $null -ne $window
$available = $protocolRegistered -and $executableExists
if (-not $protocolRegistered) {
  $reason = '未注册 douyin-pc:// 协议，请重新安装抖音客户端'
} elseif (-not $executablePath) {
  $reason = '协议命令中未找到抖音客户端路径'
} elseif (-not $executableExists) {
  $reason = "抖音客户端文件不存在：$executablePath"
} elseif ($windowFound) {
  $reason = '已检测，正在运行'
} elseif ($appRunning) {
  $reason = '已检测，客户端正在启动'
} else {
  $reason = '已检测，启动时自动打开'
}
$processId = if ($windowFound) {
  $window.Id
} elseif ($appRunning) {
  $processes[0].Id
} else {
  $null
}
$windowHandle = if ($windowFound) { $window.MainWindowHandle.ToInt64() } else { $null }
$windowTitle = if ($windowFound) { $window.MainWindowTitle } else { "" }
@{
  ok = $true
  available = [bool]$available
  protocolRegistered = [bool]$protocolRegistered
  executablePath = $executablePath
  executableExists = $executableExists
  appRunning = $appRunning
  windowFound = [bool]$windowFound
  found = [bool]$windowFound
  processId = $processId
  windowHandle = $windowHandle
  title = $windowTitle
  reason = $reason
} | ConvertTo-Json -Compress
`;
  try {
    return JSON.parse(await runPowerShell(script, 6000));
  } catch (error) {
    return {
      ok: true,
      available: false,
      protocolRegistered: false,
      executablePath: "",
      executableExists: false,
      appRunning: false,
      windowFound: false,
      found: false,
      processId: null,
      windowHandle: null,
      title: "",
      reason: `无法检测电脑端抖音：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function findDouyinWindow() {
  const status = await inspectDouyinDesktop();
  return {
    found: status.windowFound,
    processId: status.processId,
    windowHandle: status.windowHandle,
    title: status.title,
  };
}

function douyinWindowScript(windowHandle) {
  const handle = Number(windowHandle);
  if (!Number.isSafeInteger(handle) || handle <= 0) {
    throw new Error("电脑端抖音窗口句柄无效");
  }
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DouyinWindowControl {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
}
"@
$handle = [IntPtr]${handle}
[void][DouyinWindowControl]::ShowWindowAsync($handle, 9)
$foreground = [DouyinWindowControl]::GetForegroundWindow()
[uint32]$foregroundProcess = 0
$foregroundThread = [DouyinWindowControl]::GetWindowThreadProcessId($foreground, [ref]$foregroundProcess)
$currentThread = [DouyinWindowControl]::GetCurrentThreadId()
$attached = [DouyinWindowControl]::AttachThreadInput($foregroundThread, $currentThread, $true)
[void][DouyinWindowControl]::BringWindowToTop($handle)
[void][DouyinWindowControl]::SetForegroundWindow($handle)
if ($attached) { [void][DouyinWindowControl]::AttachThreadInput($foregroundThread, $currentThread, $false) }
Start-Sleep -Milliseconds 180
if ([DouyinWindowControl]::GetForegroundWindow() -ne $handle) { Write-Output 'focused=false'; exit 2 }
Write-Output 'focused=true'
`;
}

async function focusDouyinWindow(window) {
  const output = await runPowerShell(douyinWindowScript(window.windowHandle), 7000);
  if (!output.includes("focused=true")) {
    throw new Error("无法将电脑端抖音切到前台");
  }
}

function parsePlaybackPayload(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  const lastLine = text.split(/\r?\n/).filter(Boolean).at(-1);
  try {
    return JSON.parse(lastLine);
  } catch (_) {
    return null;
  }
}

async function runDouyinPlaybackControl(windowHandle, action) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        DOUYIN_CONTROL_SCRIPT,
        "-Action",
        action,
        "-WindowHandle",
        String(windowHandle),
      ],
      {
        windowsHide: true,
        timeout: DOUYIN_CONTROL_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      },
    );
    if (stderr.trim()) {
      console.warn(`[bridge] Douyin control: ${stderr.trim()}`);
    }
    const payload = parsePlaybackPayload(stdout);
    if (!payload?.ok) {
      throw new Error(payload?.error || "电脑端抖音播放控制失败");
    }
    return payload;
  } catch (error) {
    const payload = parsePlaybackPayload(error?.stdout);
    if (payload?.error) throw new Error(payload.error);
    if (error?.killed) {
      throw new Error("电脑端抖音播放复核超时");
    }
    throw error;
  }
}

async function controlDouyinPlayback(window, action) {
  const result = await runDouyinPlaybackControl(window.windowHandle, action);
  return {
    ...window,
    playbackState: result.state,
    playbackVerified: result.verified === true,
    playbackControlAttempts: result.attempts,
    playbackControlMethod: result.method,
    playbackMetrics: result.metrics,
  };
}

async function openDouyinDesktop() {
  let status = await inspectDouyinDesktop();
  if (!status.available) {
    throw new Error(status.reason || "电脑端抖音不可用");
  }

  const alreadyRunning = status.appRunning;
  if (!status.windowFound) {
    await runPowerShell(`Start-Process -FilePath '${DOUYIN_PROTOCOL}'`, 10000);
    const deadline = Date.now() + DOUYIN_LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await delay(250);
      status = await inspectDouyinDesktop();
      if (status.windowFound) break;
    }
  }
  if (!status.windowFound) {
    throw new Error("电脑端抖音正在启动，但暂未找到可聚焦窗口");
  }
  await focusDouyinWindow(status);
  const control = await controlDouyinPlayback(status, "play");
  return { ...control, alreadyRunning };
}

async function pauseDouyinDesktop() {
  const window = await findDouyinWindow();
  if (!window.found) throw new Error("电脑端抖音窗口不存在");
  return controlDouyinPlayback(window, "pause");
}

function writeJson(response, status, payload) {
  response.writeHead(status);
  response.end(JSON.stringify(payload));
}

const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  const pathname = new URL(
    request.url || "/",
    `http://${request.headers.host || "127.0.0.1"}`,
  ).pathname;

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === "/health" || request.url === "/status") {
    response.writeHead(200);
    response.end(statusJson());
    return;
  }

  if (pathname === "/douyin/status" && request.method === "GET") {
    const status = await inspectDouyinDesktop();
    writeJson(response, 200, status);
    return;
  }

  if (pathname === "/douyin/open" && request.method === "POST") {
    try {
      const window = await queueDouyinControl(openDouyinDesktop);
      writeJson(response, 200, { ok: true, ...window });
    } catch (error) {
      writeJson(response, 503, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (pathname === "/douyin/pause" && request.method === "POST") {
    try {
      const window = await queueDouyinControl(pauseDouyinDesktop);
      writeJson(response, 200, { ok: true, ...window });
    } catch (error) {
      writeJson(response, 503, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  response.writeHead(404);
  response.end(JSON.stringify({ error: "not-found" }));
});

server.on("upgrade", attachWebSocket);
server.listen(BRIDGE_PORT, "127.0.0.1", () => {
  console.log(`[bridge] Listening on http://127.0.0.1:${BRIDGE_PORT}`);
  void connectCdp();
});

const heartbeat = setInterval(broadcastStatus, HEARTBEAT_INTERVAL_MS);
heartbeat.unref();

async function shutdown() {
  stopping = true;
  clearTimeout(pollTimer);
  clearTimeout(reconnectTimer);
  clearInterval(heartbeat);
  disconnectCdp();
  for (const client of clients) client.socket.destroy();
  await new Promise((resolve) => server.close(resolve));
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
