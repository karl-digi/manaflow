import { createPrivateKey } from "node:crypto";
import { env } from "./www-env";

/**
 * Converts a PKCS#1 (RSA PRIVATE KEY) to PKCS#8 (PRIVATE KEY) format if needed.
 * @octokit/auth-app uses universal-github-app-jwt which requires PKCS#8 format.
 */
function convertToPkcs8(pem: string): string {
  const normalized = pem.replace(/\\n/g, "\n");

  // Already in PKCS#8 format
  if (normalized.includes("-----BEGIN PRIVATE KEY-----")) {
    return normalized;
  }

  // Convert PKCS#1 to PKCS#8
  if (normalized.includes("-----BEGIN RSA PRIVATE KEY-----")) {
    const privateKey = createPrivateKey({
      key: normalized,
      format: "pem",
    });
    return privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  }

  // Unknown format, return as-is
  return normalized;
}

export const githubPrivateKey = convertToPkcs8(env.CMUX_GITHUB_APP_PRIVATE_KEY);
