import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type HostKeyCheckStatus =
  | { status: 'trusted'; fingerprintSha256: string }
  | { status: 'unknown'; fingerprintSha256: string; keyBase64: string }
  | { status: 'mismatch'; fingerprintSha256: string; expectedFingerprintSha256: string };

export class KnownHostsVerifier {
  private readonly knownHostsPath: string;

  constructor(customPath?: string) {
    this.knownHostsPath = customPath || path.join(os.homedir(), '.ssh', 'known_hosts');
  }

  public static computeSha256Fingerprint(rawKey: Buffer): string {
    const hash = crypto.createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '');
    return `SHA256:${hash}`;
  }

  private formatHostEntry(host: string, port: number): string {
    return port === 22 ? host.toLowerCase() : `[${host.toLowerCase()}]:${port}`;
  }

  public verifyHostKey(host: string, port: number, keyType: string, rawKey: Buffer): HostKeyCheckStatus {
    const fingerprintSha256 = KnownHostsVerifier.computeSha256Fingerprint(rawKey);
    const keyBase64 = rawKey.toString('base64');

    if (!fs.existsSync(this.knownHostsPath)) {
      return { status: 'unknown', fingerprintSha256, keyBase64 };
    }

    const targetHostToken = this.formatHostEntry(host, port);
    const lines = fs.readFileSync(this.knownHostsPath, 'utf-8').split(/\r?\n/);

    let foundSameHostDiffKey: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('@')) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) continue;

      const [hostsField, recordedType, recordedBase64] = parts;
      const hostList = hostsField.split(',').map((h) => h.toLowerCase());

      let hostMatched = hostList.includes(targetHostToken);
      if (!hostMatched && hostsField.startsWith('|1|')) {
        hostMatched = this.verifyHashedHost(hostsField, targetHostToken);
      }

      if (hostMatched) {
        const recordedBuffer = Buffer.from(recordedBase64, 'base64');
        const recordedFp = KnownHostsVerifier.computeSha256Fingerprint(recordedBuffer);

        if (recordedBuffer.equals(rawKey)) {
          return { status: 'trusted', fingerprintSha256 };
        }
        if (recordedType === keyType) {
          return {
            status: 'mismatch',
            fingerprintSha256,
            expectedFingerprintSha256: recordedFp
          };
        }
        foundSameHostDiffKey = recordedFp;
      }
    }

    if (foundSameHostDiffKey) {
      return {
        status: 'mismatch',
        fingerprintSha256,
        expectedFingerprintSha256: foundSameHostDiffKey
      };
    }

    return { status: 'unknown', fingerprintSha256, keyBase64 };
  }

  private verifyHashedHost(hashedToken: string, hostToMatch: string): boolean {
    const segments = hashedToken.split('|');
    if (segments.length !== 4 || segments[1] !== '1') return false;
    const salt = Buffer.from(segments[2], 'base64');
    const expectedHash = Buffer.from(segments[3], 'base64');
    const hmac = crypto.createHmac('sha1', salt).update(hostToMatch).digest();
    return hmac.equals(expectedHash);
  }

  public addTrustedHostKey(host: string, port: number, keyType: string, rawKey: Buffer): void {
    const dir = path.dirname(this.knownHostsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const hostToken = this.formatHostEntry(host, port);
    const entry = `${hostToken} ${keyType} ${rawKey.toString('base64')}\n`;
    fs.appendFileSync(this.knownHostsPath, entry, { encoding: 'utf-8', mode: 0o600 });
  }
}