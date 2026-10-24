import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HostKeyPromptRequest, SshProfile } from '../shared/types';
import { SshConnectionManager } from './connection-mgr';
import { CredentialManager } from './credentials';
import { RemoteSubprocessProvider } from './exec-provider';
import { RemoteFsProvider } from './fs-provider';
import { KnownHostsVerifier } from './known-hosts';
import { SshConfigResolver } from './ssh-config';
import { RemoteWorkspaceRouter } from './workspace-router';

export const name = 'remote-ssh';

interface PersistedPluginState {
  customProfiles: SshProfile[];
  recentWorkspaces: Array<{ profileId: string; remotePath: string; openedAt: number }>;
  lastActiveWorkspace?: { profileId: string; remotePath: string };
}

export class RemoteSshHostService {
  private readonly stateFilePath: string;
  private readonly configResolver = new SshConfigResolver();
  private readonly knownHosts = new KnownHostsVerifier();
  private readonly credentials = new CredentialManager();
  public readonly connMgr: SshConnectionManager;
  public readonly fsProvider: RemoteFsProvider;
  public readonly execProvider: RemoteSubprocessProvider;
  public readonly workspaceRouter: RemoteWorkspaceRouter;

  private pendingHostKeyResolvers = new Map<string, (accepted: boolean) => void>();

  constructor(private readonly ctx?: any, customStateDir?: string) {
    const desktopProfileDir =
      customStateDir || path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
    if (!fs.existsSync(desktopProfileDir)) {
      fs.mkdirSync(desktopProfileDir, { recursive: true });
    }
    this.stateFilePath = path.join(desktopProfileDir, 'remote-ssh-state.json');

    this.connMgr = new SshConnectionManager(
      this.knownHosts,
      this.credentials,
      (req) => this.requestUserHostKeyConfirmation(req)
    );
    this.fsProvider = new RemoteFsProvider(this.connMgr);
    this.execProvider = new RemoteSubprocessProvider(this.connMgr, this.credentials);
    this.workspaceRouter = new RemoteWorkspaceRouter(this.fsProvider, this.execProvider);
  }

  public loadPersistedState(): PersistedPluginState {
    if (!fs.existsSync(this.stateFilePath)) {
      return { customProfiles: [], recentWorkspaces: [] };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf-8')) as PersistedPluginState;
      return {
        customProfiles: Array.isArray(raw.customProfiles) ? raw.customProfiles : [],
        recentWorkspaces: Array.isArray(raw.recentWorkspaces) ? raw.recentWorkspaces : [],
        lastActiveWorkspace: raw.lastActiveWorkspace
      };
    } catch {
      return { customProfiles: [], recentWorkspaces: [] };
    }
  }

  public savePersistedState(state: PersistedPluginState): void {
    const cleanProfiles = state.customProfiles.map((p) => ({
      id: p.id,
      name: p.name,
      host: p.host,
      port: p.port,
      username: p.username,
      privateKeyPath: p.privateKeyPath,
      useAgent: p.useAgent,
      allowPassword: p.allowPassword,
      proxyJump: p.proxyJump,
      keepAliveInterval: p.keepAliveInterval,
      connectTimeout: p.connectTimeout,
      source: 'user' as const,
      lastDirectories: p.lastDirectories || [],
      lastConnectedAt: p.lastConnectedAt
    }));

    const payload: PersistedPluginState = {
      customProfiles: cleanProfiles,
      recentWorkspaces: state.recentWorkspaces.slice(0, 20),
      lastActiveWorkspace: state.lastActiveWorkspace
    };

    fs.writeFileSync(this.stateFilePath, JSON.stringify(payload, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    });
  }

  public getAllProfiles(): SshProfile[] {
    const sshConfigProfiles = this.configResolver.loadProfilesFromOpenSshConfig();
    const persisted = this.loadPersistedState();
    const byId = new Map<string, SshProfile>();

    for (const p of sshConfigProfiles) {
      byId.set(p.id, p);
    }
    for (const p of persisted.customProfiles) {
      const existing = byId.get(p.id);
      byId.set(p.id, {
        ...existing,
        ...p,
        lastDirectories: p.lastDirectories?.length ? p.lastDirectories : existing?.lastDirectories || []
      });
    }

    return Array.from(byId.values());
  }

  public upsertProfile(profile: SshProfile): SshProfile[] {
    const state = this.loadPersistedState();
    const idx = state.customProfiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) {
      state.customProfiles[idx] = { ...profile, source: 'user' };
    } else {
      state.customProfiles.push({ ...profile, source: 'user' });
    }
    this.savePersistedState(state);
    return this.getAllProfiles();
  }

  public recordOpenedDirectory(profileId: string, remotePath: string): void {
    const state = this.loadPersistedState();
    let prof = state.customProfiles.find((p) => p.id === profileId);
    if (!prof) {
      const all = this.getAllProfiles();
      const base = all.find((p) => p.id === profileId);
      if (base) {
        prof = { ...base, source: 'user', lastDirectories: [] };
        state.customProfiles.push(prof);
      }
    }
    if (prof) {
      prof.lastConnectedAt = Date.now();
      prof.lastDirectories = [
        remotePath,
        ...(prof.lastDirectories || []).filter((d) => d !== remotePath)
      ].slice(0, 10);
    }

    state.recentWorkspaces = [
      { profileId, remotePath, openedAt: Date.now() },
      ...state.recentWorkspaces.filter(
        (w) => !(w.profileId === profileId && w.remotePath === remotePath)
      )
    ].slice(0, 15);
    state.lastActiveWorkspace = { profileId, remotePath };
    this.savePersistedState(state);
  }

  private requestUserHostKeyConfirmation(req: HostKeyPromptRequest): Promise<boolean> {
    if (!this.ctx?.events) {
      return Promise.resolve(false);
    }
    const requestId = `${req.profileId}:${Date.now()}`;
    return new Promise<boolean>((resolve) => {
      this.pendingHostKeyResolvers.set(requestId, resolve);
      this.ctx.events.emit('remote-ssh:host-key-prompt', { requestId, ...req });
    });
  }

  public resolveHostKeyPrompt(requestId: string, accepted: boolean): void {
    const resolver = this.pendingHostKeyResolvers.get(requestId);
    if (resolver) {
      this.pendingHostKeyResolvers.delete(requestId);
      resolver(accepted);
    }
  }
}

export function apply(ctx: any): void {
  const service = new RemoteSshHostService(ctx);

  const registerRpc = (channel: string, handler: (...args: any[]) => any) => {
    if (ctx.rpc?.register) {
      ctx.rpc.register(channel, handler);
    } else if (ctx.server?.handle) {
      ctx.server.handle(channel, handler);
    }
  };

  registerRpc('remote-ssh:get-init-data', async () => ({
    profiles: service.getAllProfiles(),
    states: service.connMgr.getAllStates(),
    persisted: service.loadPersistedState(),
    sshConfigPath: new SshConfigResolver().getSshConfigPath()
  }));

  registerRpc('remote-ssh:save-profile', async (profile: SshProfile) => {
    return service.upsertProfile(profile);
  });

  registerRpc(
    'remote-ssh:connect',
    async (payload: { profileId: string; password?: string; passphrase?: string }) => {
      const profile = service.getAllProfiles().find((p) => p.id === payload.profileId);
      if (!profile) throw new Error(`SSH-профиль "${payload.profileId}" не найден`);
      return service.connMgr.connect(profile, {
        password: payload.password,
        passphrase: payload.passphrase
      });
    }
  );

  registerRpc('remote-ssh:disconnect', async (payload: { profileId: string }) => {
    await service.connMgr.disconnect(payload.profileId);
    return service.connMgr.getState(payload.profileId);
  });

  registerRpc(
    'remote-ssh:list-dir',
    async (payload: { profileId: string; path: string; showHidden?: boolean; offset?: number }) => {
      return service.fsProvider.listDirectory(payload.profileId, payload.path, {
        showHidden: payload.showHidden,
        offset: payload.offset
      });
    }
  );

  registerRpc(
    'remote-ssh:open-workspace',
    async (payload: { workspaceId: string; profileId: string; remotePath: string }) => {
      service.recordOpenedDirectory(payload.profileId, payload.remotePath);
      const binding = service.workspaceRouter.registerRemoteWorkspace(
        payload.workspaceId || `ws-${payload.profileId}`,
        payload.profileId,
        payload.remotePath
      );
      if (ctx.workspace?.open) {
        await ctx.workspace.open({
          uri: binding.uri,
          name: `${payload.remotePath.split('/').pop() || '/'} [SSH: ${payload.profileId}]`,
          remoteProfileId: payload.profileId,
          cwd: binding.remoteCwd
        });
      }
      return binding;
    }
  );

  registerRpc(
    'remote-ssh:host-key-response',
    async (payload: { requestId: string; accepted: boolean }) => {
      service.resolveHostKeyPrompt(payload.requestId, payload.accepted);
    }
  );

  if (ctx.fs && typeof ctx.fs.registerProvider === 'function') {
    ctx.fs.registerProvider('ssh', {
      readFile: (uri: string) => service.workspaceRouter.routeReadFile(uri),
      writeFile: (uri: string, content: string) => service.workspaceRouter.routeWriteFile(uri, content),
      edit: (uri: string, oldStr: string, newStr: string) =>
        service.workspaceRouter.routeEditFile(uri, oldStr, newStr),
      readdir: (uri: string) => service.workspaceRouter.routeListDir(uri)
    });
  }

  if (ctx.subprocess && typeof ctx.subprocess.registerProvider === 'function') {
    ctx.subprocess.registerProvider('ssh', {
      exec: (cmd: string, opts: any) => service.workspaceRouter.routeBash(cmd, opts)
    });
  }
}

export default { name, apply, RemoteSshHostService };