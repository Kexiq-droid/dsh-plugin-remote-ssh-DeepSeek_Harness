import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import SSHConfig from 'ssh-config';
import { SshProfile } from '../shared/types';

export class SshConfigResolver {
  private readonly sshDir: string;
  private readonly mainConfigPath: string;

  constructor(customSshDir?: string) {
    this.sshDir = customSshDir || path.join(os.homedir(), '.ssh');
    this.mainConfigPath = path.join(this.sshDir, 'config');
  }

  public getSshConfigPath(): string {
    return this.mainConfigPath;
  }

  public expandLocalPath(rawPath: string): string {
    let p = rawPath.trim().replace(/^["']|["']$/g, '');
    if (p.startsWith('~/') || p.startsWith('~\\')) {
      p = path.join(os.homedir(), p.slice(2));
    }
    p = p.replace(/%([^%]+)%/g, (_, envVar) => process.env[envVar] || '');
    return path.resolve(p);
  }

  private readConfigWithIncludes(filePath: string, visited = new Set<string>()): string {
    const resolvedPath = path.resolve(filePath);
    if (visited.has(resolvedPath) || !fs.existsSync(resolvedPath)) {
      return '';
    }
    visited.add(resolvedPath);

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const outputLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const includeMatch = trimmed.match(/^Include\s+(.+)$/i);
      if (includeMatch) {
        const includePattern = includeMatch[1].trim();
        const candidatePath = path.isAbsolute(includePattern) || includePattern.startsWith('~')
          ? this.expandLocalPath(includePattern)
          : path.join(path.dirname(resolvedPath), includePattern);

        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
          outputLines.push(this.readConfigWithIncludes(candidatePath, visited));
        }
      } else {
        outputLines.push(line);
      }
    }
    return outputLines.join('\n');
  }

  public loadProfilesFromOpenSshConfig(): SshProfile[] {
    if (!fs.existsSync(this.mainConfigPath)) {
      return [];
    }
    const fullContent = this.readConfigWithIncludes(this.mainConfigPath);
    return this.parseConfigContent(fullContent);
  }

  public parseConfigContent(rawContent: string): SshProfile[] {
    const parsed = SSHConfig.parse(rawContent);
    const profiles: SshProfile[] = [];
    const hostNames = new Set<string>();

    for (const section of parsed) {
      if (section.type === SSHConfig.DIRECTIVE && section.param.toLowerCase() === 'host') {
        const patterns = String(section.value).split(/\s+/);
        for (const pattern of patterns) {
          if (pattern && !pattern.includes('*') && !pattern.includes('?')) {
            hostNames.add(pattern);
          }
        }
      }
    }

    for (const alias of hostNames) {
      const computed = parsed.compute(alias);
      const host = String(computed.HostName || alias);
      const user = String(computed.User || os.userInfo().username || 'root');
      const port = computed.Port ? parseInt(String(computed.Port), 10) : 22;

      let identityFile: string | undefined;
      if (computed.IdentityFile) {
        const rawId = Array.isArray(computed.IdentityFile)
          ? computed.IdentityFile[0]
          : computed.IdentityFile;
        identityFile = this.expandLocalPath(String(rawId));
      } else {
        identityFile = this.detectDefaultIdentityFile();
      }

      const proxyJump = computed.ProxyJump ? String(computed.ProxyJump) : undefined;
      const keepAlive = computed.ServerAliveInterval
        ? parseInt(String(computed.ServerAliveInterval), 10)
        : 15;

      profiles.push({
        id: alias,
        name: alias,
        host,
        port: Number.isNaN(port) ? 22 : port,
        username: user,
        privateKeyPath: identityFile,
        useAgent: computed.IdentityAgent !== 'none',
        allowPassword: computed.PasswordAuthentication !== 'no',
        proxyJump,
        keepAliveInterval: Number.isNaN(keepAlive) ? 15 : keepAlive,
        connectTimeout: computed.ConnectTimeout
          ? parseInt(String(computed.ConnectTimeout), 10) * 1000
          : 15000,
        source: 'ssh-config',
        lastDirectories: []
      });
    }

    return profiles;
  }

  public detectDefaultIdentityFile(): string | undefined {
    const candidates = ['id_ed25519', 'id_rsa', 'id_ecdsa'];
    for (const name of candidates) {
      const full = path.join(this.sshDir, name);
      if (fs.existsSync(full)) {
        return full;
      }
    }
    return undefined;
  }
}