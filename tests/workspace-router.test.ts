import { describe, expect, it, vi } from 'vitest';
import { RemoteWorkspaceRouter } from '../src/host/workspace-router';

describe('RemoteWorkspaceRouter Isolation & Zero-Fallback Guarantee', () => {
  it('строго разделяет локальный и удалённый Workspace и запрещает локальный fallback при обрыве SSH', async () => {
    const remoteConnected = { value: true };

    const mockRemoteFs: any = {
      readFile: vi.fn(async (profileId: string, remotePath: string) => {
        if (!remoteConnected.value) {
          throw new Error('ERR_SSH_DISCONNECTED: Канал SFTP недоступен');
        }
        return `REMOTE_CONTENT:${profileId}:${remotePath}`;
      })
    };

    const mockRemoteExec: any = {
      execCommand: vi.fn(async (profileId: string, cmd: string, opts: any) => {
        if (!remoteConnected.value) {
          throw new Error('ERR_SSH_DISCONNECTED: Отсутствует активное SSH-соединение');
        }
        return { stdout: `REMOTE_EXEC:${profileId}:${opts.cwd}:${cmd}`, stderr: '', exitCode: 0, truncated: false };
      })
    };

    const mockLocalProviders: any = {
      readFile: vi.fn(async (p: string) => `LOCAL_CONTENT:${p}`),
      writeFile: vi.fn(),
      listDir: vi.fn(),
      execCommand: vi.fn(async (cmd: string) => ({ stdout: `LOCAL_EXEC:${cmd}`, stderr: '', exitCode: 0, truncated: false }))
    };

    const router = new RemoteWorkspaceRouter(mockRemoteFs, mockRemoteExec, mockLocalProviders);

    router.registerLocalWorkspace('ws-local', 'C:\\Projects\\MyLocalApp');
    router.registerRemoteWorkspace('ws-remote', 'MAIN_BASE', '/var/Del_Arte');

    const remoteRead = await router.routeReadFile('README.md', 'ws-remote');
    expect(remoteRead).toBe('REMOTE_CONTENT:MAIN_BASE:/var/Del_Arte/README.md');
    expect(mockLocalProviders.readFile).not.toHaveBeenCalled();

    remoteConnected.value = false;
    await expect(router.routeReadFile('README.md', 'ws-remote')).rejects.toThrow(/ERR_SSH_DISCONNECTED/);
    expect(mockLocalProviders.readFile).not.toHaveBeenCalled();

    const localRead = await router.routeReadFile('C:\\Projects\\MyLocalApp\\README.md', 'ws-local');
    expect(localRead).toBe('LOCAL_CONTENT:C:\\Projects\\MyLocalApp\\README.md');
  });
});