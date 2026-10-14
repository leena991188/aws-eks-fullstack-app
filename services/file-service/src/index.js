
import express from "express";
import jwt from "jsonwebtoken";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  SecretsManagerClient,
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "node:crypto";
import path from "node:path";

const app = express();
app.use(express.json({ limit: "1mb" }));

const region = process.env.AWS_REGION || "ap-southeast-2";
const bucket = process.env.UPLOAD_BUCKET;
const s3 = new S3Client({ region });
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
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/upload-url", authenticate, async (req, res) => {
  try {
    if (!bucket) {
      return res.status(500).json({ error: "UPLOAD_BUCKET is not configured" });
    }

    const fileName = path.basename(String(req.body.fileName || "upload"));
    const contentType = String(
      req.body.contentType || "application/octet-stream"
    );
    const size = Number(req.body.size || 0);

    if (!fileName || fileName.length > 200) {
      return res.status(400).json({ error: "Invalid file name" });
    }

    if (!Number.isFinite(size) || size < 1 || size > 10 * 1024 * 1024) {
      return res.status(400).json({
        error: "Files must be between 1 byte and 10 MB"
      });
    }

    const allowedTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "text/plain"
    ]);

    if (!allowedTypes.has(contentType)) {
      return res.status(400).json({ error: "File type is not allowed" });
    }

    const key = `users/${req.auth.sub}/${randomUUID()}-${fileName}`;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    res.json({ uploadUrl, key, expiresInSeconds: 300 });
  } catch (error) {
    console.error("Upload URL error:", error.message);
    res.status(500).json({ error: "Unable to create upload URL" });
  }
});

app.get("/download-url", authenticate, async (req, res) => {
  try {
    if (!bucket) {
      return res.status(500).json({ error: "UPLOAD_BUCKET is not configured" });
    }

    const key = String(req.query.key || "");
    const prefix = `users/${req.auth.sub}/`;

    // Users can download only their own files.
    if (!key.startsWith(prefix) || key.includes("..")) {
      return res.status(403).json({ error: "Access denied" });
    }

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 300 }
    );

    res.json({ downloadUrl: url, expiresInSeconds: 300 });
  } catch (error) {
    console.error("Download URL error:", error.message);
    res.status(500).json({ error: "Unable to create download URL" });
  }
});

const port = Number(process.env.PORT || 3003);
app.listen(port, "0.0.0.0", () => {
  console.log(`File service listening on ${port}`);
});
