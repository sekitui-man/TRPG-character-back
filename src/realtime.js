import { WebSocketServer } from "ws";

export const createRealtimeServer = (server) => {
  const wss = new WebSocketServer({ server, path: "/realtime" });

  const broadcast = (payload) => {
    const message = JSON.stringify(payload);
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    });
  };

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "welcome" }));
  });

  return { broadcast };
};
