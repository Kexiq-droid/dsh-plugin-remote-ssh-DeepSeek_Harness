import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { Client, ConnectConfig, SFTPWrapper } from 'ssh2';
import { HostKeyPromptRequest, SshProfile, SshRuntimeState } from '../shared/types';
import { CredentialManager } from './credentials';
import { KnownHostsVerifier } from './known-hosts';

interface ActiveSession {
  profile: SshProfile;
  client: Client;
  jumpClient?: Client;
  sftp?: SFTPWrapper;
  state: SshRuntimeState;
  epoch: number;
  reconnectAttempts: number;
  reconnectTimer?: NodeJS.Timeout;
  manualDisconnect: boolean;
}

export class SshConnectionManager extends EventEmitter {
  private readonly sessions = new Map<string, ActiveSession>();
  private globalEpoch = 0;

  constructor(
    private readonly knownHosts: KnownHostsVerifier,
    private readonly credentials: CredentialManager,
    private readonly onHostKeyPrompt: (req: HostKeyPromptRequest) => Promise<boolean>
  ) {
    super();
  }

  public getState(profileId: string): SshRuntimeState {
    const session = this.sessions.get(profileId);
    if (!session) {
      return { profileId, status: 'disconnected' };
    }
    return { ...session.state };
  }

  public getAllStates(): Record<string, SshRuntimeState> {
    const result: Record<string, SshRuntimeState> = {};
    for (const [id, session] of this.sessions.entries()) {
      result[id] = { ...session.state };
    }
    return result;
  }

  public async connect(
    profile: SshProfile,
    transientAuth?: { password?: string; passphrase?: string }
  ): Promise<SshRuntimeState> {
    if (transientAuth) {
      this.credentials.setSessionCredentials(profile.id, transientAuth);
    }

    const currentEpoch = ++this.globalEpoch;
    await this.disconnect(profile.id, true);

    const client = new Client();
    const state: SshRuntimeState = {
      profileId: profile.id,
      status: 'connecting',
      isRoot: profile.username === 'root'
    };

    const session: ActiveSession = {
      profile,
      client,
      state,
      epoch: currentEpoch,
      reconnectAttempts: 0,
      manualDisconnect: false
    };

    this.sessions.set(profile.id, session);
    this.emitStateChange(profile.id);

    try {
      await this.establishClientConnection(session);
      if (session.epoch !== currentEpoch) {
        client.end();
        return this.getState(profile.id);
      }

      session.sftp = await this.initSftp(client);
      session.state.status = 'connected';
      session.state.errorText = undefined;
      session.state.errorTechnical = undefined;
      session.reconnectAttempts = 0;
      this.emitStateChange(profile.id);
      return { ...session.state };
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      const sanitizedMsg = this.credentials.sanitizeLog(errorObj.message);
      session.state.status = 'error';
      session.state.errorText = this.translateErrorToRussian(sanitizedMsg);
      session.state.errorTechnical = sanitizedMsg;
      this.emitStateChange(profile.id);
      throw new Error(`${session.state.errorText} (${sanitizedMsg})`);
    }
  }

  private async establishClientConnection(session: ActiveSession): Promise<void> {
    const { profile, client } = session;
    const creds = this.credentials.getSessionCredentials(profile.id);

    const connectConfig: ConnectConfig = {
      host: profile.host,
      port: profile.port || 22,
      username: profile.username,
      readyTimeout: profile.connectTimeout || 15000,
      keepaliveInterval: (profile.keepAliveInterval || 15) * 1000,
      keepaliveCountMax: 3
    };

    if (profile.useAgent !== false) {
      const winOpenSshPipe = '\\\\.\\pipe\\openssh-ssh-agent';
      connectConfig.agent = process.env.SSH_AUTH_SOCK || winOpenSshPipe;
    }

    if (profile.privateKeyPath && fs.existsSync(profile.privateKeyPath)) {
      connectConfig.privateKey = fs.readFileSync(profile.privateKeyPath);
      if (creds.passphrase) {
        connectConfig.passphrase = creds.passphrase;
      }
    }

    if (profile.allowPassword !== false && creds.password) {
      connectConfig.password = creds.password;
    }

    if (profile.proxyJump) {
      const jumpStream = await this.createJumpStream(profile.proxyJump, profile.host, profile.port, session);
      connectConfig.sock = jumpStream as any;
    }

    await new Promise<void>((resolve, reject) => {
      let hostKeyDecisionPending = false;
      let hostKeyRejectedReason: string | null = null;

      connectConfig.hostVerifier = (keyBuffer: Buffer, verify: (valid: boolean) => void) => {
        hostKeyDecisionPending = true;
        const keyType = this.extractKeyType(keyBuffer);
        const check = this.knownHosts.verifyHostKey(profile.host, profile.port, keyType, keyBuffer);

        if (check.status === 'trusted') {
          hostKeyDecisionPending = false;
          verify(true);
          return;
        }

        if (check.status === 'mismatch') {
          hostKeyDecisionPending = false;
          hostKeyRejectedReason = `КРИТИЧЕСКАЯ ОШИБКА БЕЗОПАСНОСТИ: Ключ сервера ${profile.host}:${profile.port} изменился! Ожидался ${check.expectedFingerprintSha256}, получен ${check.fingerprintSha256}. Подключение заблокировано.`;
          verify(false);
          return;
        }

        this.onHostKeyPrompt({
          profileId: profile.id,
          host: profile.host,
          port: profile.port,
          keyType,
          fingerprintSha256: check.fingerprintSha256,
          reason: 'unknown'
        })
          .then((accepted) => {
            hostKeyDecisionPending = false;
            if (accepted) {
              this.knownHosts.addTrustedHostKey(profile.host, profile.port, keyType, keyBuffer);
              verify(true);
            } else {
              hostKeyRejectedReason = 'Подключение отменено: отпечаток ключа сервера не был подтверждён пользователем.';
              verify(false);
            }
          })
          .catch(() => {
            hostKeyDecisionPending = false;
            verify(false);
          });
      };

      const onReady = () => {
        cleanupListeners();
        this.attachLifecycleListeners(session);
        resolve();
      };

      const onError = (err: Error) => {
        cleanupListeners();
        if (hostKeyRejectedReason) {
          reject(new Error(hostKeyRejectedReason));
        } else {
          reject(err);
        }
      };

      const onClose = () => {
        if (hostKeyDecisionPending || hostKeyRejectedReason) {
          cleanupListeners();
          reject(new Error(hostKeyRejectedReason || 'Соединение закрыто во время проверки ключа хоста'));
        }
      };

      const cleanupListeners = () => {
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
        client.removeListener('close', onClose);
      };

      client.once('ready', onReady);
      client.once('error', onError);
      client.once('close', onClose);

      client.connect(connectConfig);
    });
  }

  private async createJumpStream(
    proxyJumpSpec: string,
    targetHost: string,
    targetPort: number,
    session: ActiveSession
  ): Promise<NodeJS.ReadableWritableStream> {
    const match = proxyJumpSpec.trim().match(/^(?:([^@]+)@)?([^:]+)(?::(\d+))?$/);
    if (!match) {
      throw new Error(`Некорректный формат ProxyJump: ${proxyJumpSpec}`);
    }
    const jumpUser = match[1] || session.profile.username;
    const jumpHost = match[2];
    const jumpPort = match[3] ? parseInt(match[3], 10) : 22;

    const jumpClient = new Client();
    session.jumpClient = jumpClient;

    const jumpConfig: ConnectConfig = {
      host: jumpHost,
      port: jumpPort,
      username: jumpUser,
      agent: process.env.SSH_AUTH_SOCK || '\\\\.\\pipe\\openssh-ssh-agent'
    };

    if (session.profile.privateKeyPath && fs.existsSync(session.profile.privateKeyPath)) {
      jumpConfig.privateKey = fs.readFileSync(session.profile.privateKeyPath);
    }

    await new Promise<void>((resolve, reject) => {
      jumpClient.once('ready', () => resolve());
      jumpClient.once('error', (err) => reject(err));
      jumpClient.connect(jumpConfig);
    });

    return new Promise((resolve, reject) => {
      jumpClient.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, stream) => {
        if (err) return reject(err);
        resolve(stream);
      });
    });
  }

  private attachLifecycleListeners(session: ActiveSession): void {
    const { client, profile } = session;

    client.on('close', () => {
      if (session.manualDisconnect) return;
      this.handleUnexpectedDrop(session);
    });

    client.on('end', () => {
      if (session.manualDisconnect) return;
      this.handleUnexpectedDrop(session);
    });

    client.on('error', (err) => {
      const sanitized = this.credentials.sanitizeLog(err.message);
      session.state.errorTechnical = sanitized;
      session.state.errorText = this.translateErrorToRussian(sanitized);
      this.emitStateChange(profile.id);
    });
  }

  private handleUnexpectedDrop(session: ActiveSession): void {
    if (session.state.status === 'reconnecting' || session.manualDisconnect) return;

    session.sftp = undefined;
    session.state.status = 'reconnecting';
    session.state.errorText = 'Соединение потеряно. Попытка переподключения...';
    this.emitStateChange(session.profile.id);

    this.scheduleReconnect(session);
  }

  private scheduleReconnect(session: ActiveSession): void {
    const maxAttempts = 5;
    if (session.reconnectAttempts >= maxAttempts) {
      session.state.status = 'error';
      session.state.errorText = 'Обрыв связи с сервером. Превышено число попыток переподключения.';
      this.emitStateChange(session.profile.id);
      return;
    }

    session.reconnectAttempts += 1;
    const delayMs = Math.min(1000 * Math.pow(2, session.reconnectAttempts - 1), 15000);

    session.reconnectTimer = setTimeout(async () => {
      if (session.manualDisconnect) return;
      try {
        const newClient = new Client();
        session.client = newClient;
        await this.establishClientConnection(session);
        session.sftp = await this.initSftp(newClient);
        session.state.status = 'connected';
        session.state.errorText = undefined;
        session.reconnectAttempts = 0;
        this.emitStateChange(session.profile.id);
        this.emit('reconnected', session.profile.id);
      } catch {
        this.scheduleReconnect(session);
      }
    }, delayMs);
  }

  private initSftp(client: Client): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        resolve(sftp);
      });
    });
  }

  public getActiveClient(profileId: string): Client {
    const session = this.sessions.get(profileId);
    if (!session || session.state.status !== 'connected') {
      throw new Error(
        `ERR_SSH_DISCONNECTED: Отсутствует активное SSH-соединение с профилем "${profileId}". Операция заблокирована (локальный fallback запрещён).`
      );
    }
    return session.client;
  }

  public getActiveSftp(profileId: string): SFTPWrapper {
    const session = this.sessions.get(profileId);
    if (!session || session.state.status !== 'connected' || !session.sftp) {
      throw new Error(
        `ERR_SSH_DISCONNECTED: Канал SFTP для профиля "${profileId}" недоступен (статус: ${session?.state.status || 'disconnected'}). Выполнение на локальном ПК заблокировано.`
      );
    }
    return session.sftp;
  }

  public async disconnect(profileId: string, silent = false): Promise<void> {
    const session = this.sessions.get(profileId);
    if (!session) return;

    session.manualDisconnect = true;
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
    }
    try {
      session.sftp?.end();
    } catch {}
    try {
      session.client.end();
      session.client.destroy();
    } catch {}
    try {
      session.jumpClient?.end();
      session.jumpClient?.destroy();
    } catch {}

    session.state.status = 'disconnected';
    session.state.errorText = undefined;
    this.sessions.delete(profileId);

    if (!silent) {
      this.emitStateChange(profileId);
    }
  }

  private extractKeyType(rawKey: Buffer): string {
    try {
      if (rawKey.length > 4) {
        const len = rawKey.readUInt32BE(0);
        if (len > 0 && len < 64 && rawKey.length >= 4 + len) {
          return rawKey.subarray(4, 4 + len).toString('ascii');
        }
      }
    } catch {}
    return 'ssh-ed25519';
  }

  private translateErrorToRussian(technicalMessage: string): string {
    const lower = technicalMessage.toLowerCase();
    if (lower.includes('all configured authentication methods failed')) {
      return 'Ошибка аутентификации SSH: сервер отклонил ключ или пароль.';
    }
    if (lower.includes('econnrefused')) {
      return 'Соединение отклонено сервером (ECONNREFUSED). Проверьте IP и порт SSH.';
    }
    if (lower.includes('etimedout') || lower.includes('timed out')) {
      return 'Превышено время ожидания ответа от сервера (Timeout).';
    }
    if (lower.includes('enotfound') || lower.includes('getaddrinfo')) {
      return 'Не удалось разрешить DNS-имя хоста.';
    }
    if (lower.includes('passphrase') || lower.includes('encrypted private key')) {
      return 'Приватный ключ защищён паролем (Passphrase). Введите корректную парольную фразу.';
    }
    if (lower.includes('критическая ошибка безопасности')) {
      return technicalMessage;
    }
    return `Ошибка SSH-соединения: ${technicalMessage}`;
  }

  private emitStateChange(profileId: string): void {
    this.emit('state-changed', this.getState(profileId));
  }
}