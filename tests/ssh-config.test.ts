import { describe, expect, it } from 'vitest';
import { SshConfigResolver } from '../src/host/ssh-config';

describe('OpenSSH Config Parser', () => {
  it('парсит профиль MAIN_BASE и учитывает директивы HostName, User, Port, IdentityFile', () => {
    const sampleConfig = `
Host MAIN_BASE
  HostName 203.0.113.42
  User ubuntu
  Port 2222
  IdentityFile ~/.ssh/id_ed25519
  ServerAliveInterval 20
`;
    const resolver = new SshConfigResolver();
    const profiles = resolver.parseConfigContent(sampleConfig);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe('MAIN_BASE');
    expect(profiles[0].host).toBe('203.0.113.42');
    expect(profiles[0].username).toBe('ubuntu');
    expect(profiles[0].port).toBe(2222);
    expect(profiles[0].keepAliveInterval).toBe(20);
  });
});