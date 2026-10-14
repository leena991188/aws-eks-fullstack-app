
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "./db.js";
import { getJwtSecret } from "./security.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Create the required table automatically when the service starts.
await pool.query(`
  CREATE TABLE IF NOT EXISTS app_users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user'
      CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

app.post("/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || name.length > 100 || !email || email.length > 254) {
      return res.status(400).json({ error: "Valid name and email required" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({
        error: "Password must be between 12 and 128 characters"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO app_users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, role`,
      [name, email, passwordHash]
    );

    return res.status(201).json({
      message: "Account created",
      user: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error("Registration error:", error.message);
    return res.status(500).json({ error: "Unable to register user" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const result = await pool.query(
      `SELECT id, name, email, password_hash, role
       FROM app_users WHERE email = $1`,
      [email]
    );

    const account = result.rows[0];
    if (!account || !(await bcrypt.compare(password, account.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const secret = await getJwtSecret();
    const token = jwt.sign(
      { sub: String(account.id), role: account.role },
      secret,
      { expiresIn: "1h", issuer: "aws-eks-fullstack-app" }
    );

    return res.json({
      token,
      user: {
        id: account.id,
        name: account.name,
        email: account.email,
        role: account.role
      }
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ error: "Unable to log in" });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, "0.0.0.0", () => {
  console.log(`Auth service listening on ${port}`);
});
