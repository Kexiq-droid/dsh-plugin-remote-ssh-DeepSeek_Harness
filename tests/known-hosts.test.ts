import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KnownHostsVerifier } from '../src/host/known-hosts';

describe('KnownHostsVerifier Security Checks', () => {
  it('определяет новый ключ как unknown, сохраняет его как trusted и блокирует при подмене (mismatch)', () => {
    const tmpFile = path.join(os.tmpdir(), `known_hosts_test_${Date.now()}`);
    const verifier = new KnownHostsVerifier(tmpFile);
    const key1 = Buffer.from('ssh-ed25519-public-key-bytes-1');
    const key2 = Buffer.from('ssh-ed25519-public-key-bytes-2-attacker');

    const res1 = verifier.verifyHostKey('203.0.113.42', 22, 'ssh-ed25519', key1);
    expect(res1.status).toBe('unknown');

    verifier.addTrustedHostKey('203.0.113.42', 22, 'ssh-ed25519', key1);
    const res2 = verifier.verifyHostKey('203.0.113.42', 22, 'ssh-ed25519', key1);
    expect(res2.status).toBe('trusted');

    const res3 = verifier.verifyHostKey('203.0.113.42', 22, 'ssh-ed25519', key2);
    expect(res3.status).toBe('mismatch');

    fs.rmSync(tmpFile, { force: true });
  });
});