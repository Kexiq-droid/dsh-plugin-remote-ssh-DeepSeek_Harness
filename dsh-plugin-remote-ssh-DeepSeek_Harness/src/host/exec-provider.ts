import { ClientChannel } from 'ssh2';
import { ExecCommandOptions, ExecCommandResult } from '../shared/types';
import { normalizePosixPath } from '../shared/posix-path';
import { SshConnectionManager } from './connection-mgr';
import { CredentialManager } from './credentials';

export function escapePosixSingleQuotes(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export class RemoteSubprocessProvider {
  private readonly ptySessions = new Map<string, ClientChannel>();

  constructor(
    private readonly connMgr: SshConnectionManager,
    private readonly credentials: CredentialManager
  ) {}

  public async execCommand(
    profileId: string,
    command: string,
    options: ExecCommandOptions
  ): Promise<ExecCommandResult> {
    const client = this.connMgr.getActiveClient(profileId);
    const normCwd = normalizePosixPath(options.cwd || '/');
    const maxBytes = options.maxOutputBytes ?? 1024 * 1024;
    const timeoutMs = options.timeoutMs ?? 120_000;

    const envPrefix = options.env
      ? Object.entries(options.env)
          .filter(([k]) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k))
          .map(([k, v]) => `export ${k}=${escapePosixSingleQuotes(v)};`)
          .join(' ')
      : '';

    const wrappedScript = `cd -- ${escapePosixSingleQuotes(normCwd)} && ${envPrefix} ${command}`;
    const bashInvocation = `bash -c ${escapePosixSingleQuotes(wrappedScript)}`;

    return new Promise<ExecCommandResult>((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutLen = 0;
      let stderrLen = 0;
      let truncated = false;
      let finished = false;

      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          streamRef?.close();
          reject(new Error(`Превышено время выполнения удалённой команды (${timeoutMs} мс) в ${normCwd}`));
        }
      }, timeoutMs);

      let streamRef: ClientChannel | undefined;

      client.exec(bashInvocation, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return reject(new Error(`Ошибка запуска удалённого процесса: ${err.message}`));
        }
        streamRef = stream;

        if (options.signal) {
          options.signal.addEventListener(
            'abort',
            () => {
              if (!finished) {
                finished = true;
                clearTimeout(timer);
                stream.signal('TERM');
                stream.close();
                reject(new Error('Выполнение удалённой команды отменено пользователем (AbortSignal).'));
              }
            },
            { once: true }
          );
        }

        stream.on('data', (chunk: Buffer) => {
          if (stdoutLen < maxBytes) {
            const slice = chunk.subarray(0, maxBytes - stdoutLen);
            stdoutChunks.push(slice);
            stdoutLen += slice.length;
            if (slice.length < chunk.length) truncated = true;
          } else {
            truncated = true;
          }
        });

        stream.stderr.on('data', (chunk: Buffer) => {
          if (stderrLen < maxBytes) {
            const slice = chunk.subarray(0, maxBytes - stderrLen);
            stderrChunks.push(slice);
            stderrLen += slice.length;
            if (slice.length < chunk.length) truncated = true;
          } else {
            truncated = true;
          }
        });

        stream.on('close', (code: number | null, signalName?: string) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);

          if (code === null && this.connMgr.getState(profileId).status !== 'connected') {
            return reject(
              new Error(
                'ERR_SSH_INTERRUPTED: Соединение оборвалось во время выполнения команды на сервере. Повторный запуск заблокирован из соображений безопасности.'
              )
            );
          }

          const rawOut = Buffer.concat(stdoutChunks).toString('utf-8');
          const rawErr = Buffer.concat(stderrChunks).toString('utf-8');

          resolve({
            stdout: this.credentials.sanitizeLog(rawOut),
            stderr: this.credentials.sanitizeLog(rawErr),
            exitCode: code ?? -1,
            signal: signalName,
            truncated
          });
        });
      });
    });
  }

  public async remoteGrep(
    profileId: string,
    cwd: string,
    pattern: string,
    includeGlob?: string
  ): Promise<string> {
    const safePattern = escapePosixSingleQuotes(pattern);
    const globArg = includeGlob ? `--include=${escapePosixSingleQuotes(includeGlob)}` : '';
    const cmd = `if command -v rg >/dev/null 2>&1; then rg -n --no-heading --max-count 200 ${
      includeGlob ? `-g ${escapePosixSingleQuotes(includeGlob)}` : ''
    } -- ${safePattern} .; else grep -rnI ${globArg} -- ${safePattern} . | head -n 200; fi`;

    const res = await this.execCommand(profileId, cmd, { cwd, idempotent: true });
    return res.stdout || '';
  }

  public async remoteGlob(profileId: string, cwd: string, namePattern: string): Promise<string[]> {
    const safeName = escapePosixSingleQuotes(namePattern);
    const cmd = `find . -maxdepth 6 -name ${safeName} -not -path '*/.*' | head -n 500`;
    const res = await this.execCommand(profileId, cmd, { cwd, idempotent: true });
    return res.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }

  public async openPtySession(
    profileId: string,
    sessionId: string,
    cwd: string,
    cols = 100,
    rows = 30,
    onData: (data: string) => void,
    onExit: (code: number) => void
  ): Promise<void> {
    const client = this.connMgr.getActiveClient(profileId);
    const normCwd = normalizePosixPath(cwd);

    await new Promise<void>((resolve, reject) => {
      client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) return reject(err);
        this.ptySessions.set(sessionId, stream);

        stream.on('data', (d: Buffer) => onData(d.toString('utf-8')));
        stream.on('close', (code: number) => {
          this.ptySessions.delete(sessionId);
          onExit(code ?? 0);
        });

        stream.write(`cd -- ${escapePosixSingleQuotes(normCwd)} && clear\n`);
        resolve();
      });
    });
  }

  public writePty(sessionId: string, input: string): void {
    const stream = this.ptySessions.get(sessionId);
    if (!stream) throw new Error(`PTY-сессия ${sessionId} не найдена или закрыта`);
    stream.write(input);
  }

  public resizePty(sessionId: string, cols: number, rows: number): void {
    const stream = this.ptySessions.get(sessionId);
    stream?.setWindow(rows, cols, 0, 0);
  }

  public closePty(sessionId: string): void {
    const stream = this.ptySessions.get(sessionId);
    if (stream) {
      stream.close();
      this.ptySessions.delete(sessionId);
    }
  }
}