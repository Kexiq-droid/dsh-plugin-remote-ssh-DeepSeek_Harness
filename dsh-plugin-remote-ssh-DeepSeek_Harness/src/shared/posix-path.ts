import path from 'node:path';

const posix = path.posix;

export function normalizePosixPath(inputPath: string): string {
  if (!inputPath || inputPath.trim() === '') {
    return '/';
  }
  const replaced = inputPath.replace(/\\/g, '/').trim();
  const strippedDrive = replaced.replace(/^[a-zA-Z]:(?=\/)/, '');
  const normalized = posix.normalize(strippedDrive);
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function joinPosixPath(basePath: string, ...segments: string[]): string {
  const cleanBase = normalizePosixPath(basePath);
  const cleanSegments = segments.map((s) => s.replace(/\\/g, '/'));
  return posix.join(cleanBase, ...cleanSegments);
}

export function resolveRemotePath(cwd: string, targetPath: string): string {
  const cleanCwd = normalizePosixPath(cwd);
  const cleanTarget = targetPath.replace(/\\/g, '/').trim();
  if (cleanTarget.startsWith('/')) {
    return posix.normalize(cleanTarget);
  }
  return posix.resolve(cleanCwd, cleanTarget);
}

export function getParentPosixPath(currentPath: string): string | null {
  const norm = normalizePosixPath(currentPath);
  if (norm === '/') return null;
  return posix.dirname(norm);
}

export function formatRemoteWorkspaceUri(profileId: string, remotePosixPath: string): string {
  const norm = normalizePosixPath(remotePosixPath);
  return `ssh://${encodeURIComponent(profileId)}${norm}`;
}

export function parseRemoteWorkspaceUri(uri: string): { profileId: string; remotePath: string } | null {
  if (!uri || !uri.startsWith('ssh://')) {
    return null;
  }
  const withoutScheme = uri.slice('ssh://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex === -1) {
    return {
      profileId: decodeURIComponent(withoutScheme),
      remotePath: '/'
    };
  }
  const profileId = decodeURIComponent(withoutScheme.slice(0, slashIndex));
  const remotePath = normalizePosixPath(withoutScheme.slice(slashIndex));
  return { profileId, remotePath };
}