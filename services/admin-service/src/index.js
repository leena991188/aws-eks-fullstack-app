
import express from "express";
import jwt from "jsonwebtoken";
import pg from "pg";
import {
  SecretsManagerClient,
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";

const { Pool } = pg;
const app = express();
app.use(express.json({ limit: "1mb" }));

const region = process.env.AWS_REGION || "ap-southeast-2";
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "fullstackapp",
  user: process.env.DB_USER || "appuser",
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true"
    ? { rejectUnauthorized: true }
    : false
});

let jwtSecret;

async function getSecret() {
  if (jwtSecret) return jwtSecret;

  if (process.env.JWT_SECRET_ARN) {
    const client = new SecretsManagerClient({ region });
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: process.env.JWT_SECRET_ARN })
    );
    const raw = result.SecretString || "";
    try {
      const parsed = JSON.parse(raw);
      jwtSecret = parsed.JWT_SECRET || parsed.jwtSecret;
    } catch {
      jwtSecret = raw;
    }
  } else {
    jwtSecret = process.env.JWT_SECRET;
  }

  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT secret is not configured");
  }
  return jwtSecret;
}

async function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    req.auth = jwt.verify(token, await getSecret(), {
      issuer: "aws-eks-fullstack-app"
    });

    if (req.auth.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/users", authenticate, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, created_at
       FROM app_users ORDER BY id`
    );
    res.json({ users: result.rows });
  } catch (error) {
    console.error("List users error:", error.message);
    res.status(500).json({ error: "Unable to list users" });
  }
});

app.put("/users/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const role = String(req.body.role || "");

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    if (!["user", "admin"].includes(role)) {
      return res.status(400).json({ error: "Role must be user or admin" });
    }

    if (String(req.auth.sub) === String(id)) {
      return res.status(400).json({
        error: "You cannot change your own role"
      });
    }

    const result = await pool.query(
      `UPDATE app_users SET role = $1
       WHERE id = $2
       RETURNING id, name, email, role`,
      [role, id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error("Update user error:", error.message);
    res.status(500).json({ error: "Unable to update user" });
  }
});

app.delete("/users/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    if (String(req.auth.sub) === String(id)) {
      return res.status(400).json({
        error: "You cannot delete your own account"
      });
    }

    const result = await pool.query(
      "DELETE FROM app_users WHERE id = $1 RETURNING id",
      [id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: "User deleted" });
  } catch (error) {
    console.error("Delete user error:", error.message);
    res.status(500).json({ error: "Unable to delete user" });
  }
});

const port = Number(process.env.PORT || 3004);
app.listen(port, "0.0.0.0", () => {
  console.log(`Admin service listening on ${port}`);
});
