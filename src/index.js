import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "node:http";
import { createRealtimeServer } from "./realtime.js";
import { verifyAuthToken } from "./auth.js";
import { createUserSupabaseClient } from "./supabase.js";
import { ensureParticipant } from "./services/participants.js";
import { registerBoardTokenRoutes } from "./routes/boardTokens.js";
import { registerCharacterRoutes } from "./routes/characters.js";
import { registerChatTabRoutes } from "./routes/chatTabs.js";
import { registerLogsChatRoutes } from "./routes/logsChat.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerSceneRoutes } from "./routes/scenes.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerUploadRoutes } from "./routes/uploads.js";

const app = express();
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : true;
const corsOriginSetting =
  Array.isArray(corsOrigins) && corsOrigins.length === 0 ? true : corsOrigins;
app.use(
  cors({
    origin: corsOriginSetting,
    credentials: true
  })
);
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);

const realtime = createRealtimeServer(server, {
  verifyToken: verifyAuthToken,
  isParticipant: async (accessToken, sessionId, userId) => {
    const client = createUserSupabaseClient(accessToken);
    const result = await ensureParticipant(client, sessionId, userId);
    return result.ok;
  }
});

const emitChange = (table, action, record) => {
  realtime.broadcast({
    type: "change",
    table,
    action,
    record
  });
};

registerSystemRoutes(app);
registerProfileRoutes(app);
registerSessionRoutes(app, { emitChange });
registerChatTabRoutes(app);
registerBoardTokenRoutes(app, { emitChange });
registerLogsChatRoutes(app, { emitChange });
registerSceneRoutes(app, { emitChange });
registerCharacterRoutes(app);
registerUploadRoutes(app);

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`server listening on ${port}`);
});
