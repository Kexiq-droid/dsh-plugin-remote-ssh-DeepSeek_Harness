import { describe, expect, it } from 'vitest';
import {
  formatRemoteWorkspaceUri,
  joinPosixPath,
  normalizePosixPath,
  parseRemoteWorkspaceUri,
  resolveRemotePath
} from '../src/shared/posix-path';

describe('POSIX Path Handling on Windows Host', () => {
  it('не преобразует Linux-пути в Windows-пути с обратными слэшами или диском C:', () => {
    expect(normalizePosixPath('/var/Del_Arte')).toBe('/var/Del_Arte');
    expect(normalizePosixPath('C:\\var\\Del_Arte\\src')).toBe('/var/Del_Arte/src');
    expect(joinPosixPath('/var/Del_Arte', 'src\\index.ts')).toBe('/var/Del_Arte/src/index.ts');
  });

  it('корректно разрешает относительные пути внутри удалённого cwd', () => {
    expect(resolveRemotePath('/var/Del_Arte', 'README.md')).toBe('/var/Del_Arte/README.md');
    expect(resolveRemotePath('/var/Del_Arte/sub', '../package.json')).toBe('/var/Del_Arte/package.json');
  });

  it('формирует и разбирает URI удалённого Workspace', () => {
    const uri = formatRemoteWorkspaceUri('MAIN_BASE', '/var/Del_Arte');
    expect(uri).toBe('ssh://MAIN_BASE/var/Del_Arte');
    expect(parseRemoteWorkspaceUri(uri)).toEqual({
      profileId: 'MAIN_BASE',
      remotePath: '/var/Del_Arte'
    });
  });
});