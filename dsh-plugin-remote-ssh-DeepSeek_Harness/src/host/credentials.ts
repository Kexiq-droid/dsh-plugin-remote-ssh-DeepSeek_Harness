export class CredentialManager {
  private readonly sessionSecrets = new Map<string, { password?: Buffer; passphrase?: Buffer }>();
  private readonly sensitivePatterns: Set<string> = new Set();

  private encryptSecret(plain: string): Buffer {
    this.sensitivePatterns.add(plain);
    try {
      const electron = require('electron');
      if (electron?.safeStorage?.isEncryptionAvailable?.()) {
        return electron.safeStorage.encryptString(plain);
      }
    } catch {
      // Fallback in-memory
    }
    return Buffer.from(plain, 'utf-8');
  }

  private decryptSecret(buf: Buffer): string {
    try {
      const electron = require('electron');
      if (electron?.safeStorage?.isEncryptionAvailable?.()) {
        return electron.safeStorage.decryptString(buf);
      }
    } catch {
      // ignore
    }
    return buf.toString('utf-8');
  }

  public setSessionCredentials(profileId: string, creds: { password?: string; passphrase?: string }): void {
    const entry: { password?: Buffer; passphrase?: Buffer } = {};
    if (creds.password) entry.password = this.encryptSecret(creds.password);
    if (creds.passphrase) entry.passphrase = this.encryptSecret(creds.passphrase);
    this.sessionSecrets.set(profileId, entry);
  }

  public getSessionCredentials(profileId: string): { password?: string; passphrase?: string } {
    const entry = this.sessionSecrets.get(profileId);
    if (!entry) return {};
    return {
      password: entry.password ? this.decryptSecret(entry.password) : undefined,
      passphrase: entry.passphrase ? this.decryptSecret(entry.passphrase) : undefined
    };
  }

  public clearSessionCredentials(profileId: string): void {
    const entry = this.sessionSecrets.get(profileId);
    if (entry?.password) entry.password.fill(0);
    if (entry?.passphrase) entry.passphrase.fill(0);
    this.sessionSecrets.delete(profileId);
  }

  public sanitizeLog(message: string): string {
    let sanitized = message;
    for (const secret of this.sensitivePatterns) {
      if (secret && secret.length >= 3 && sanitized.includes(secret)) {
        sanitized = sanitized.split(secret).join('***REDACTED***');
      }
    }
    sanitized = sanitized.replace(
      /(password|passphrase|secret|token|authorization)\s*[:=]\s*([^\s"'`]+)/gi,
      '$1=***REDACTED***'
    );
    sanitized = sanitized.replace(
      /-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]+ PRIVATE KEY-----/g,
      '[PRIVATE_KEY_REDACTED]'
    );
    return sanitized;
  }
}