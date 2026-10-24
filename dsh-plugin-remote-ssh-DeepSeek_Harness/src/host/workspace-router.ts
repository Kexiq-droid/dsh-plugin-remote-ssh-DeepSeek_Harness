import {
  formatRemoteWorkspaceUri,
  parseRemoteWorkspaceUri,
  resolveRemotePath
} from '../shared/posix-path';
import { ExecCommandOptions, ExecCommandResult } from '../shared/types';
import { RemoteSubprocessProvider } from './exec-provider';
import { RemoteFsProvider } from './fs-provider';

export interface WorkspaceBinding {
  workspaceId: string;
  uri: string;
  isRemote: boolean;
  profileId?: string;
  remoteCwd?: string;
}

export interface LocalProvidersFallback {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  editFile?: (path: string, oldText: string, newText: string) => Promise<unknown>;
  listDir: (path: string) => Promise<unknown>;
  execCommand: (cmd: string, opts: { cwd?: string }) => Promise<ExecCommandResult>;
}

const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-rf\s+\/(\s|$)/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\biptables\s+-F\b/i,
  /\bufw\s+(disable|reset)\b/i
];

export class RemoteWorkspaceRouter {
  private readonly bindings = new Map<string, WorkspaceBinding>();
  private activeWorkspaceId: string | null = null;

  constructor(
    private readonly remoteFs: RemoteFsProvider,
    private readonly remoteExec: RemoteSubprocessProvider,
    private readonly localProviders?: LocalProvidersFallback,
    private readonly onConfirmDangerousAction?: (cmd: string, profileId: string) => Promise<boolean>
  ) {}

  public registerRemoteWorkspace(workspaceId: string, profileId: string, remotePosixPath: string): WorkspaceBinding {
    const uri = formatRemoteWorkspaceUri(profileId, remotePosixPath);
    const parsed = parseRemoteWorkspaceUri(uri)!;
    const binding: WorkspaceBinding = {
      workspaceId,
      uri,
      isRemote: true,
      profileId: parsed.profileId,
      remoteCwd: parsed.remotePath
    };
    this.bindings.set(workspaceId, binding);
    this.activeWorkspaceId = workspaceId;
    return binding;
  }

  public registerLocalWorkspace(workspaceId: string, localPath: string): WorkspaceBinding {
    const binding: WorkspaceBinding = {
      workspaceId,
      uri: localPath,
      isRemote: false
    };
    this.bindings.set(workspaceId, binding);
    this.activeWorkspaceId = workspaceId;
    return binding;
  }

  public setActiveWorkspace(workspaceId: string): void {
    if (!this.bindings.has(workspaceId)) {
      throw new Error(`Workspace ${workspaceId} не зарегистрирован в маршрутизаторе`);
    }
    this.activeWorkspaceId = workspaceId;
  }

  public getBinding(workspaceId?: string): WorkspaceBinding {
    const targetId = workspaceId || this.activeWorkspaceId;
    if (!targetId || !this.bindings.has(targetId)) {
      throw new Error('Активное рабочее пространство (Workspace) не выбрано');
    }
    return this.bindings.get(targetId)!;
  }

  public async routeReadFile(targetPath: string, workspaceId?: string): Promise<string> {
    const binding = this.getBinding(workspaceId);
    if (binding.isRemote) {
      const fullRemotePath = resolveRemotePath(binding.remoteCwd!, targetPath);
      return this.remoteFs.readFile(binding.profileId!, fullRemotePath);
    }
    if (!this.localProviders) {
      throw new Error('Локальный провайдер файловой системы не подключён');
    }
    return this.localProviders.readFile(targetPath);
  }

  public async routeWriteFile(targetPath: string, content: string, workspaceId?: string): Promise<void> {
    const binding = this.getBinding(workspaceId);
    if (binding.isRemote) {
      const fullRemotePath = resolveRemotePath(binding.remoteCwd!, targetPath);
      await this.remoteFs.writeFile(binding.profileId!, fullRemotePath, content);
      return;
    }
    if (!this.localProviders) {
      throw new Error('Локальный провайдер файловой системы не подключён');
    }
    await this.localProviders.writeFile(targetPath, content);
  }

  public async routeEditFile(
    targetPath: string,
    oldText: string,
    newText: string,
    workspaceId?: string
  ): Promise<unknown> {
    const binding = this.getBinding(workspaceId);
    if (binding.isRemote) {
      const fullRemotePath = resolveRemotePath(binding.remoteCwd!, targetPath);
      return this.remoteFs.editFile(binding.profileId!, fullRemotePath, oldText, newText);
    }
    if (!this.localProviders?.editFile) {
      throw new Error('Локальный провайдер editFile не подключён');
    }
    return this.localProviders.editFile(targetPath, oldText, newText);
  }

  public async routeListDir(targetPath = '.', workspaceId?: string): Promise<unknown> {
    const binding = this.getBinding(workspaceId);
    if (binding.isRemote) {
      const fullRemotePath = resolveRemotePath(binding.remoteCwd!, targetPath);
      return this.remoteFs.listDirectory(binding.profileId!, fullRemotePath);
    }
    if (!this.localProviders) {
      throw new Error('Локальный провайдер listDir не подключён');
    }
    return this.localProviders.listDir(targetPath);
  }

  public async routeGrep(pattern: string, includeGlob?: string, workspaceId?: string): Promise<string> {
    const binding = this.getBinding(workspaceId);
    if (!binding.isRemote) {
      throw new Error('routeGrep вызван для локального контекста без удалённой привязки');
    }
    return this.remoteExec.remoteGrep(binding.profileId!, binding.remoteCwd!, pattern, includeGlob);
  }

  public async routeGlob(pattern: string, workspaceId?: string): Promise<string[]> {
    const binding = this.getBinding(workspaceId);
    if (!binding.isRemote) {
      throw new Error('routeGlob вызван для локального контекста без удалённой привязки');
    }
    return this.remoteExec.remoteGlob(binding.profileId!, binding.remoteCwd!, pattern);
  }

  public async routeBash(
    command: string,
    options: Partial<ExecCommandOptions> = {},
    workspaceId?: string
  ): Promise<ExecCommandResult> {
    const binding = this.getBinding(workspaceId);
    if (binding.isRemote) {
      for (const regex of DANGEROUS_COMMAND_PATTERNS) {
        if (regex.test(command)) {
          if (this.onConfirmDangerousAction) {
            const approved = await this.onConfirmDangerousAction(command, binding.profileId!);
            if (!approved) {
              throw new Error(`Выполнение потенциально опасной команды заблокировано пользователем: ${command}`);
            }
          } else {
            throw new Error(`Политика безопасности заблокировала опасную команду на VPS: ${command}`);
          }
        }
      }

      const effectiveCwd = options.cwd
        ? resolveRemotePath(binding.remoteCwd!, options.cwd)
        : binding.remoteCwd!;

      return this.remoteExec.execCommand(binding.profileId!, command, {
        ...options,
        cwd: effectiveCwd
      });
    }

    if (!this.localProviders) {
      throw new Error('Локальный провайдер subprocess не подключён');
    }
    return this.localProviders.execCommand(command, { cwd: options.cwd || binding.uri });
  }
}