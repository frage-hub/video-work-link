(function attachCodexBridge(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.CodexBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCodexBridgeApi() {
  "use strict";

  function createCodexBridge({
    url = "ws://127.0.0.1:17321/ws",
    onMessage = () => {},
    onConnectionChange = () => {},
    reconnectMs = 2500,
  } = {}) {
    let socket = null;
    let reconnectTimer = null;
    let stopped = true;
    let connected = false;

    function setConnected(nextConnected) {
      if (connected === nextConnected) return;
      connected = nextConnected;
      try {
        onConnectionChange(connected);
      } catch (_) {
        // Listener errors must not break reconnect behavior.
      }
    }

    function scheduleReconnect() {
      if (stopped || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectMs);
    }

    function connect() {
      if (stopped) return;
      if (typeof WebSocket !== "function") {
        scheduleReconnect();
        return;
      }

      let currentSocket = null;
      try {
        currentSocket = new WebSocket(url);
        socket = currentSocket;
      } catch (_) {
        socket = null;
        setConnected(false);
        scheduleReconnect();
        return;
      }

      currentSocket.addEventListener("open", () => {
        if (socket !== currentSocket) return;
        setConnected(true);
      });

      currentSocket.addEventListener("message", (event) => {
        if (socket !== currentSocket) return;
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (_) {
          return;
        }
        try {
          onMessage(message);
        } catch (_) {
          // Keep the transport alive if a consumer throws.
        }
      });

      const handleDisconnect = () => {
        if (socket !== currentSocket) return;
        setConnected(false);
        socket = null;
        scheduleReconnect();
      };
      currentSocket.addEventListener("close", handleDisconnect);
      currentSocket.addEventListener("error", handleDisconnect);
    }

    function start() {
      if (!stopped) return;
      stopped = false;
      connect();
    }

    function stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      setConnected(false);
      const currentSocket = socket;
      socket = null;
      if (currentSocket) {
        try {
          currentSocket.close();
        } catch (_) {
          // Ignore an already-closed socket.
        }
      }
    }

    function isConnected() {
      return connected;
    }

    return { isConnected, start, stop };
  }

  return { createCodexBridge };
});
