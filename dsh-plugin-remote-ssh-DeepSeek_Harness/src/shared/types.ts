export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface SshProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  useAgent?: boolean;
  allowPassword?: boolean;
  proxyJump?: string;
  keepAliveInterval?: number;
  connectTimeout?: number;
  source: 'ssh-config' | 'user';
  lastDirectories?: string[];
  lastConnectedAt?: number;
}

export interface SshRuntimeState {
  profileId: string;
  status: ConnectionStatus;
  errorText?: string;
  errorTechnical?: string;
  serverBanner?: string;
  isRoot?: boolean;
  activeWorkspacePath?: string;
  latencyMs?: number;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  isHidden: boolean;
  size: number;
  mtime: number;
  permissions: string;
}

export interface DirectoryListingResult {
  currentPath: string;
  parentPath: string | null;
  entries: RemoteFileEntry[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number;
}

export interface HostKeyPromptRequest {
  profileId: string;
  host: string;
  port: number;
  keyType: string;
  fingerprintSha256: string;
  reason: 'unknown' | 'mismatch';
  knownFingerprint?: string;
}

export interface ExecCommandOptions {
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  idempotent?: boolean;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface ExecCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
  truncated: boolean;
}