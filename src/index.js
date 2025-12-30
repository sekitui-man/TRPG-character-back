import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "node:http";
import { nanoid } from "nanoid";
import { db, now } from "./db.js";
import { createRealtimeServer } from "./realtime.js";
import { requireAuth, signToken } from "./auth.js";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const realtime = createRealtimeServer(server);

const emitChange = (table, action, record) => {
  realtime.broadcast({
    type: "change",
    table,
    action,
    record
  });
};

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/auth/token", (req, res) => {
  const { user_id: userId } = req.body ?? {};
  if (!userId) {
    return res.status(400).json({ error: "user_id is required" });
  }
  return res.json({ token: signToken({ user_id: userId }) });
});

app.post("/sessions", (req, res) => {
  const { name } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }
  const id = nanoid();
  const stmt = db.prepare(
    "INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)"
  );
  const createdAt = now();
  stmt.run(id, name, createdAt);
  const record = { id, name, created_at: createdAt };
  emitChange("sessions", "insert", record);
  return res.status(201).json(record);
});

app.get("/sessions", (_req, res) => {
  const sessions = db
    .prepare("SELECT id, name, created_at FROM sessions ORDER BY created_at DESC")
    .all();
  res.json(sessions);
});

app.get("/sessions/:sessionId", (req, res) => {
  const session = db
    .prepare("SELECT id, name, created_at FROM sessions WHERE id = ?")
    .get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }
  return res.json(session);
});

app.get("/sessions/:sessionId/board", (req, res) => {
  const board = db
    .prepare(
      "SELECT id, session_id, background_url, updated_at FROM boards WHERE session_id = ?"
    )
    .get(req.params.sessionId);
  if (!board) {
    return res.status(404).json({ error: "board not found" });
  }
  return res.json(board);
});

app.post("/sessions/:sessionId/board", (req, res) => {
  const { background_url: backgroundUrl } = req.body ?? {};
  const session = db
    .prepare("SELECT id FROM sessions WHERE id = ?")
    .get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  const existing = db
    .prepare("SELECT id FROM boards WHERE session_id = ?")
    .get(req.params.sessionId);

  const updatedAt = now();
  if (existing) {
    db.prepare(
      "UPDATE boards SET background_url = ?, updated_at = ? WHERE id = ?"
    ).run(backgroundUrl ?? null, updatedAt, existing.id);
    const record = {
      id: existing.id,
      session_id: req.params.sessionId,
      background_url: backgroundUrl ?? null,
      updated_at: updatedAt
    };
    emitChange("boards", "update", record);
    return res.json(record);
  }

  const id = nanoid();
  db.prepare(
    "INSERT INTO boards (id, session_id, background_url, updated_at) VALUES (?, ?, ?, ?)"
  ).run(id, req.params.sessionId, backgroundUrl ?? null, updatedAt);
  const record = {
    id,
    session_id: req.params.sessionId,
    background_url: backgroundUrl ?? null,
    updated_at: updatedAt
  };
  emitChange("boards", "insert", record);
  return res.status(201).json(record);
});

app.get("/sessions/:sessionId/tokens", (req, res) => {
  const tokens = db
    .prepare(
      "SELECT id, session_id, name, x, y, rotation, image_url, updated_at FROM tokens WHERE session_id = ?"
    )
    .all(req.params.sessionId);
  return res.json(tokens);
});

app.post("/sessions/:sessionId/tokens", (req, res) => {
  const { name, x, y, rotation, image_url: imageUrl } = req.body ?? {};
  if (!name || x === undefined || y === undefined) {
    return res
      .status(400)
      .json({ error: "name, x, y are required" });
  }
  const id = nanoid();
  const updatedAt = now();
  db.prepare(
    "INSERT INTO tokens (id, session_id, name, x, y, rotation, image_url, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    req.params.sessionId,
    name,
    x,
    y,
    rotation ?? 0,
    imageUrl ?? null,
    updatedAt
  );
  const record = {
    id,
    session_id: req.params.sessionId,
    name,
    x,
    y,
    rotation: rotation ?? 0,
    image_url: imageUrl ?? null,
    updated_at: updatedAt
  };
  emitChange("tokens", "insert", record);
  return res.status(201).json(record);
});

app.patch("/tokens/:tokenId", (req, res) => {
  const existing = db
    .prepare(
      "SELECT id, session_id, name, x, y, rotation, image_url, updated_at FROM tokens WHERE id = ?"
    )
    .get(req.params.tokenId);
  if (!existing) {
    return res.status(404).json({ error: "token not found" });
  }

  const updated = {
    ...existing,
    ...req.body,
    updated_at: now()
  };

  db.prepare(
    "UPDATE tokens SET name = ?, x = ?, y = ?, rotation = ?, image_url = ?, updated_at = ? WHERE id = ?"
  ).run(
    updated.name,
    updated.x,
    updated.y,
    updated.rotation ?? 0,
    updated.image_url ?? null,
    updated.updated_at,
    existing.id
  );

  emitChange("tokens", "update", updated);
  return res.json(updated);
});

app.delete("/tokens/:tokenId", (req, res) => {
  const existing = db
    .prepare(
      "SELECT id, session_id, name, x, y, rotation, image_url, updated_at FROM tokens WHERE id = ?"
    )
    .get(req.params.tokenId);
  if (!existing) {
    return res.status(404).json({ error: "token not found" });
  }

  db.prepare("DELETE FROM tokens WHERE id = ?").run(req.params.tokenId);
  emitChange("tokens", "delete", existing);
  return res.status(204).end();
});

app.get("/characters", requireAuth, (req, res) => {
  const characters = db
    .prepare(
      "SELECT id, name, system, level, background, notes, user_id, created_at FROM characters WHERE user_id = ? ORDER BY created_at DESC"
    )
    .all(req.user.user_id);
  return res.json(characters);
});

app.post("/characters", requireAuth, (req, res) => {
  const { name, system, level, background, notes } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }
  const id = nanoid();
  const createdAt = now();
  db.prepare(
    "INSERT INTO characters (id, name, system, level, background, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    name,
    system ?? null,
    level ?? null,
    background ?? null,
    notes ?? null,
    req.user.user_id,
    createdAt
  );
  const record = {
    id,
    name,
    system: system ?? null,
    level: level ?? null,
    background: background ?? null,
    notes: notes ?? null,
    user_id: req.user.user_id,
    created_at: createdAt
  };
  return res.status(201).json(record);
});

app.patch("/characters/:characterId", requireAuth, (req, res) => {
  const existing = db
    .prepare(
      "SELECT id, name, system, level, background, notes, user_id, created_at FROM characters WHERE id = ?"
    )
    .get(req.params.characterId);
  if (!existing) {
    return res.status(404).json({ error: "character not found" });
  }
  if (existing.user_id !== req.user.user_id) {
    return res.status(403).json({ error: "forbidden" });
  }

  const updated = {
    ...existing,
    ...req.body
  };

  db.prepare(
    "UPDATE characters SET name = ?, system = ?, level = ?, background = ?, notes = ? WHERE id = ?"
  ).run(
    updated.name,
    updated.system ?? null,
    updated.level ?? null,
    updated.background ?? null,
    updated.notes ?? null,
    existing.id
  );

  return res.json(updated);
});

app.delete("/characters/:characterId", requireAuth, (req, res) => {
  const existing = db
    .prepare("SELECT id, user_id FROM characters WHERE id = ?")
    .get(req.params.characterId);
  if (!existing) {
    return res.status(404).json({ error: "character not found" });
  }
  if (existing.user_id !== req.user.user_id) {
    return res.status(403).json({ error: "forbidden" });
  }
  db.prepare("DELETE FROM characters WHERE id = ?").run(req.params.characterId);
  return res.status(204).end();
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`server listening on ${port}`);
});
