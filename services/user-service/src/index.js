
import express from "express";
import jwt from "jsonwebtoken";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand
} from "@aws-sdk/lib-dynamodb";
import {
  SecretsManagerClient,
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";

const app = express();
app.use(express.json({ limit: "1mb" }));

const region = process.env.AWS_REGION || "ap-southeast-2";
const tableName = process.env.DYNAMODB_TABLE || "app-user-profiles";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

let jwtSecret;

async function getSecret() {
  if (jwtSecret) return jwtSecret;

  if (process.env.JWT_SECRET_ARN) {
    const client = new SecretsManagerClient({ region });
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: process.env.JWT_SECRET_ARN })
    );
    const raw = response.SecretString || "";
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

app.get("/me", authenticate, async (req, res) => {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: { userId: String(req.auth.sub) }
    }));

    res.json({
      profile: result.Item || {
        userId: String(req.auth.sub),
        displayName: "",
        phone: "",
        about: ""
      }
    });
  } catch (error) {
    console.error("Profile read error:", error.message);
    res.status(500).json({ error: "Unable to load profile" });
  }
});

app.put("/me", authenticate, async (req, res) => {
  try {
    const displayName = String(req.body.displayName || "").trim();
    const phone = String(req.body.phone || "").trim();
    const about = String(req.body.about || "").trim();

    if (displayName.length > 100 || phone.length > 30 || about.length > 1000) {
      return res.status(400).json({ error: "Profile fields are too long" });
    }

    const profile = {
      userId: String(req.auth.sub),
      displayName,
      phone,
      about,
      updatedAt: new Date().toISOString()
    };

    await ddb.send(new PutCommand({
      TableName: tableName,
      Item: profile
    }));

    res.json({ message: "Profile saved", profile });
  } catch (error) {
    console.error("Profile save error:", error.message);
    res.status(500).json({ error: "Unable to save profile" });
  }
});

async function ensureTable() {
  try {
    await ddb.send(new DescribeTableCommand({ TableName: tableName }));
  } catch (error) {
    if (error.name !== "ResourceNotFoundException") throw error;

    await ddb.send(new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [{ AttributeName: "userId", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST"
    }));
  }
}

await ensureTable();

const port = Number(process.env.PORT || 3002);
app.listen(port, "0.0.0.0", () => {
  console.log(`User service listening on ${port}`);
});
