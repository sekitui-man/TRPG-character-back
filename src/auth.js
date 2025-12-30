import jwt from "jsonwebtoken";

const jwtSecret = process.env.JWT_SECRET ?? "dev-secret";

export const signToken = (payload) =>
  jwt.sign(payload, jwtSecret, { expiresIn: "7d" });

export const requireAuth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: "missing authorization header" });
  }

  const [, token] = header.split(" ");
  if (!token) {
    return res.status(401).json({ error: "invalid authorization header" });
  }

  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch (error) {
    return res.status(401).json({ error: "invalid token" });
  }
};
