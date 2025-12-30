import { WebSocketServer } from "ws";

const parseMessage = (payload) => {
  try {
    const text = typeof payload === "string" ? payload : payload.toString();
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
};

const getSessionIdFromPayload = (payload) => {
  if (!payload?.record) return "";
  if (payload.table === "sessions") {
    return payload.record.id ?? "";
  }
  return payload.record.session_id ?? "";
};

export const createRealtimeServer = (server, { verifyToken, isParticipant }) => {
  const wss = new WebSocketServer({ server, path: "/realtime" });

  const broadcast = (payload) => {
    const sessionId = getSessionIdFromPayload(payload);
    if (!sessionId) return;
    const message = JSON.stringify(payload);
    wss.clients.forEach((client) => {
      if (client.readyState !== client.OPEN) return;
      if (client.sessionId !== sessionId) return;
      client.send(message);
    });
  };

  wss.on("connection", (socket, _request) => {
    socket.sessionId = "";
    socket.userId = "";
    socket.send(JSON.stringify({ type: "welcome" }));

    socket.on("message", async (data) => {
      const message = parseMessage(data);
      if (!message || message.type !== "subscribe") {
        return;
      }

      const sessionId = message.session_id ?? "";
      const token = message.token ?? "";
      if (!sessionId || !token) {
        socket.send(JSON.stringify({ type: "error", message: "invalid payload" }));
        return;
      }

      const user = await verifyToken(token);
      if (!user) {
        socket.send(JSON.stringify({ type: "error", message: "unauthorized" }));
        return;
      }

      const allowed = await isParticipant(token, sessionId, user.id);
      if (!allowed) {
        socket.send(JSON.stringify({ type: "error", message: "forbidden" }));
        return;
      }

      socket.sessionId = sessionId;
      socket.userId = user.id;
      socket.send(JSON.stringify({ type: "subscribed", session_id: sessionId }));
    });
  });

  return { broadcast };
};
