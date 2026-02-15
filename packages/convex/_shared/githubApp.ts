import { env } from "./convex-env";
import { base64urlFromBytes, base64urlToBytes } from "./encoding";

export type InstallationAccountInfo = {
  accountLogin: string;
  accountId?: number;
  accountType?: "Organization" | "User";
};

export type NormalizedInstallationRepo = {
  fullName: string;
  org: string;
  name: string;
  gitRemote: string;
  providerRepoId?: number;
  ownerLogin?: string;
  ownerType?: "Organization" | "User";
  visibility?: "public" | "private";
  defaultBranch?: string;
  lastPushedAt?: number;
};

const textEncoder = new TextEncoder();
const privateKeyCache = new Map<string, CryptoKey>();

function pemToDer(pem: string): Uint8Array {
  const cleaned = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const base64Url = cleaned
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return base64urlToBytes(base64Url);
}

/**
 * Checks if the PEM is in PKCS#1 format (RSA PRIVATE KEY).
 * GitHub generates private keys in PKCS#1 format by default.
 */
function isPkcs1Format(pem: string): boolean {
  return pem.includes("-----BEGIN RSA PRIVATE KEY-----");
}

/**
 * Encodes an ASN.1 length value.
 * - If length < 128: single byte
 * - If length < 256: 0x81 + 1 byte
 * - Otherwise: 0x82 + 2 bytes (big-endian)
 */
function encodeAsn1Length(len: number): Uint8Array {
  if (len < 128) {
    return new Uint8Array([len]);
  } else if (len < 256) {
    return new Uint8Array([0x81, len]);
  } else {
    return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
  }
}

/**
 * Wraps PKCS#1 RSA private key DER bytes in PKCS#8 structure.
 * Web Crypto API's importKey("pkcs8", ...) only accepts PKCS#8 format.
 *
 * PKCS#8 structure:
 * SEQUENCE {
 *   INTEGER 0 (version)
 *   SEQUENCE { OID rsaEncryption, NULL } (AlgorithmIdentifier)
 *   OCTET STRING { <PKCS#1 DER> } (privateKey)
 * }
 */
function wrapPkcs1InPkcs8(pkcs1Der: Uint8Array): Uint8Array {
  // rsaEncryption OID: 1.2.840.113549.1.1.1
  const rsaOid = new Uint8Array([
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  ]);
  const nullBytes = new Uint8Array([0x05, 0x00]);

  // Build AlgorithmIdentifier: SEQUENCE { OID, NULL }
  const algoContent = new Uint8Array(rsaOid.length + nullBytes.length);
  algoContent.set(rsaOid);
  algoContent.set(nullBytes, rsaOid.length);
  const algoLen = encodeAsn1Length(algoContent.length);
  const algorithmIdentifier = new Uint8Array(
    1 + algoLen.length + algoContent.length,
  );
  algorithmIdentifier[0] = 0x30; // SEQUENCE tag
  algorithmIdentifier.set(algoLen, 1);
  algorithmIdentifier.set(algoContent, 1 + algoLen.length);

  // Build version: INTEGER 0
  const version = new Uint8Array([0x02, 0x01, 0x00]);

  // Build privateKey: OCTET STRING { PKCS#1 DER }
  const pkcs1Len = encodeAsn1Length(pkcs1Der.length);
  const privateKeyOctet = new Uint8Array(
    1 + pkcs1Len.length + pkcs1Der.length,
  );
  privateKeyOctet[0] = 0x04; // OCTET STRING tag
  privateKeyOctet.set(pkcs1Len, 1);
  privateKeyOctet.set(pkcs1Der, 1 + pkcs1Len.length);

  // Build outer SEQUENCE
  const contentLength =
    version.length + algorithmIdentifier.length + privateKeyOctet.length;
  const outerLen = encodeAsn1Length(contentLength);
  const pkcs8 = new Uint8Array(1 + outerLen.length + contentLength);
  pkcs8[0] = 0x30; // SEQUENCE tag
  pkcs8.set(outerLen, 1);
  let offset = 1 + outerLen.length;
  pkcs8.set(version, offset);
  offset += version.length;
  pkcs8.set(algorithmIdentifier, offset);
  offset += algorithmIdentifier.length;
  pkcs8.set(privateKeyOctet, offset);

  return pkcs8;
}

function base64urlEncodeJson(value: unknown): string {
  return base64urlFromBytes(textEncoder.encode(JSON.stringify(value)));
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const cached = privateKeyCache.get(pem);
  if (cached) return cached;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SubtleCrypto is not available in this environment");
  }

  let der = pemToDer(pem);

  // Convert PKCS#1 to PKCS#8 if needed.
  // Web Crypto API only supports PKCS#8 format for importKey.
  // GitHub generates private keys in PKCS#1 format by default.
  if (isPkcs1Format(pem)) {
    der = wrapPkcs1InPkcs8(der);
  }

  const keyData =
    der.byteOffset === 0 && der.byteLength === der.buffer.byteLength
      ? der
      : der.slice();
  const key = await subtle.importKey(
    "pkcs8",
    keyData as BufferSource,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  privateKeyCache.set(pem, key);
  return key;
}

export async function createGithubAppJwt(
  appId: string,
  privateKey: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" } as const;
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  } as const;
  const signingInput = `${base64urlEncodeJson(header)}.${base64urlEncodeJson(
    payload,
  )}`;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SubtleCrypto is not available in this environment");
  }
  const key = await importPrivateKey(privateKey);
  const signature = await subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    textEncoder.encode(signingInput),
  );
  const signaturePart = base64urlFromBytes(new Uint8Array(signature));
  return `${signingInput}.${signaturePart}`;
}

function normalizeAccountType(
  input: unknown,
): InstallationAccountInfo["accountType"] {
  return input === "Organization" || input === "User"
    ? input
    : undefined;
}

export async function fetchInstallationAccountInfo(
  installationId: number,
): Promise<InstallationAccountInfo | null> {
  const appId = env.CMUX_GITHUB_APP_ID;
  const privateKey = env.CMUX_GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    return null;
  }

  try {
    const normalizedPrivateKey = privateKey.replace(/\\n/g, "\n");
    const jwt = await createGithubAppJwt(appId, normalizedPrivateKey);
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "cmux-github-setup",
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[github_app] Failed to fetch installation ${installationId} info (status ${response.status}): ${errorText}`,
      );
      return null;
    }

    const data = (await response.json()) as {
      account?: {
        login?: string | null;
        id?: number | null;
        type?: string | null;
      };
    };

    const login = data.account?.login ?? undefined;
    if (!login) {
      return null;
    }

    return {
      accountLogin: login,
      accountId:
        typeof data.account?.id === "number" ? data.account?.id : undefined,
      accountType: normalizeAccountType(data.account?.type ?? undefined),
    };
  } catch (error) {
    console.error(
      `[github_app] Unexpected error fetching installation ${installationId} info`,
      error,
    );
    return null;
  }
}

type InstallationRepository = {
  id?: number;
  name?: string | null;
  full_name?: string | null;
  private?: boolean | null;
  default_branch?: string | null;
  pushed_at?: string | null;
  clone_url?: string | null;
  owner?: {
    login?: string | null;
    type?: string | null;
  } | null;
};

function parseTimestamp(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export async function fetchInstallationAccessToken(
  installationId: number,
): Promise<string | null> {
  const appId = env.CMUX_GITHUB_APP_ID;
  const privateKey = env.CMUX_GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    return null;
  }

  try {
    const normalizedPrivateKey = privateKey.replace(/\\n/g, "\n");
    const jwt = await createGithubAppJwt(appId, normalizedPrivateKey);
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "cmux-github-setup",
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[github_app] Failed to mint access token for installation ${installationId} (status ${response.status}): ${errorText}`,
      );
      return null;
    }

    const data = (await response.json()) as { token?: string | null };
    if (!data.token) {
      console.warn(
        `[github_app] No access token returned for installation ${installationId}`,
      );
      return null;
    }
    return data.token;
  } catch (error) {
    console.error(
      `[github_app] Unexpected error minting access token for installation ${installationId}`,
      error,
    );
    return null;
  }
}

function normalizeInstallationRepo(
  repo: InstallationRepository,
): NormalizedInstallationRepo | null {
  const fullName = repo.full_name ?? undefined;
  const name = repo.name ?? undefined;
  if (!fullName || !name) {
    return null;
  }

  const ownerLogin = repo.owner?.login ?? undefined;
  const ownerTypeRaw = repo.owner?.type ?? undefined;
  const ownerType =
    ownerTypeRaw === "Organization" || ownerTypeRaw === "User"
      ? ownerTypeRaw
      : undefined;
  const org = ownerLogin ?? fullName.split("/")[0] ?? fullName;
  const visibility = repo.private === undefined || repo.private === null
    ? undefined
    : repo.private
      ? "private"
      : "public";

  return {
    fullName,
    name,
    org,
    gitRemote: repo.clone_url ?? `https://github.com/${fullName}.git`,
    providerRepoId: typeof repo.id === "number" ? repo.id : undefined,
    ownerLogin,
    ownerType,
    visibility,
    defaultBranch: repo.default_branch ?? undefined,
    lastPushedAt: parseTimestamp(repo.pushed_at ?? undefined),
  };
}

export async function* iterateInstallationRepositories(
  installationId: number,
  options?: { perPage?: number },
): AsyncGenerator<NormalizedInstallationRepo[], void, void> {
  const accessToken = await fetchInstallationAccessToken(installationId);
  if (!accessToken) {
    return;
  }

  const perPage = Math.max(1, Math.min(options?.perPage ?? 100, 100));
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "cmux-github-setup",
  } as const;

  let page = 1;
  for (;;) {
    try {
      const response = await fetch(
        `https://api.github.com/installation/repositories?per_page=${perPage}&page=${page}`,
        { headers },
      );
      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[github_app] Failed to list repositories for installation ${installationId} (status ${response.status}): ${errorText}`,
        );
        break;
      }

      const data = (await response.json()) as {
        repositories?: InstallationRepository[];
      };
      const repos = data.repositories ?? [];
      const normalized = repos
        .map(normalizeInstallationRepo)
        .filter((repo): repo is NormalizedInstallationRepo => repo !== null);
      if (normalized.length > 0) {
        yield normalized;
      }

      if (repos.length < perPage) {
        break;
      }
      page += 1;
    } catch (error) {
      console.error(
        `[github_app] Unexpected error listing repositories for installation ${installationId}`,
        error,
      );
      break;
    }
  }
}

export async function fetchAllInstallationRepositories(
  installationId: number,
  options?: { perPage?: number },
): Promise<NormalizedInstallationRepo[]> {
  const results: NormalizedInstallationRepo[] = [];
  for await (const page of iterateInstallationRepositories(
    installationId,
    options,
  )) {
    results.push(...page);
  }
  return results;
}

export type InstallationRepoPageHandler = (
  repos: NormalizedInstallationRepo[],
  pageIndex: number,
) => Promise<void> | void;

export async function streamInstallationRepositories(
  installationId: number,
  onPage: InstallationRepoPageHandler,
  options?: { perPage?: number; awaitAll?: boolean },
): Promise<void> {
  const { perPage, awaitAll } = options ?? {};
  const backgroundTasks: Promise<void>[] = [];
  let pageIndex = 0;
  for await (const repos of iterateInstallationRepositories(
    installationId,
    { perPage },
  )) {
    if (repos.length === 0) {
      pageIndex += 1;
      continue;
    }

    try {
      const task = Promise.resolve(onPage(repos, pageIndex)).catch((error) => {
        console.error(
          "[github_app] Failed to process installation repository page",
          {
            installationId,
            pageIndex,
            repoCount: repos.length,
            error,
          },
        );
      });

      if (awaitAll) {
        backgroundTasks.push(task);
      } else {
        void task;
      }
    } catch (error) {
      console.error(
        "[github_app] Unexpected error while streaming installation repositories",
        {
          installationId,
          pageIndex,
          repoCount: repos.length,
          error,
        },
      );
    }

    pageIndex += 1;
  }

  if (awaitAll && backgroundTasks.length > 0) {
    await Promise.allSettled(backgroundTasks);
  }
}
