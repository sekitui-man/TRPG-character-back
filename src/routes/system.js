export const registerSystemRoutes = (app) => {
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
};
