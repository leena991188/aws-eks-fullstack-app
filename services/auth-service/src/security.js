
import {
  SecretsManagerClient,
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";

let cachedSecret;

export async function getJwtSecret() {
  if (cachedSecret) return cachedSecret;

  if (process.env.JWT_SECRET_ARN) {
    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION || "ap-southeast-2"
    });

    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: process.env.JWT_SECRET_ARN
      })
    );

    if (!response.SecretString) {
      throw new Error("JWT secret is empty");
    }

    try {
      const parsed = JSON.parse(response.SecretString);
      cachedSecret = parsed.JWT_SECRET || parsed.jwtSecret;
    } catch {
      cachedSecret = response.SecretString;
    }
  } else {
    cachedSecret = process.env.JWT_SECRET;
  }

  if (!cachedSecret || cachedSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }

  return cachedSecret;
}
