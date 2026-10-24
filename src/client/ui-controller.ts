import {
  ConnectionStatus,
  DirectoryListingResult,
  SshProfile,
  SshRuntimeState
} from '../shared/types';
import { SSH_PLUGIN_STYLES } from './styles';

const STATUS_LABELS_RU: Record<ConnectionStatus, string> = {
  disconnected: 'Не подключён',
  connecting: 'Подключение...',
  connected: 'Подключён',
  reconnecting: 'Переподключение...',
  error: 'Ошибка'
};

export interface RpcInvoker {
  invoke: (channel: string, payload?: any) => Promise<any>;
}

export class RemoteSshUiController {
  private profiles: SshProfile[] = [];
  private states: Record<string, SshRuntimeState> = {};
  private activeProfileId: string | null = null;
  private activeRemotePath: string | null = null;
  private sshConfigPath = '%USERPROFILE%\\.ssh\\config';

  private statusButtonEl: HTMLButtonElement | null = null;
  private modalBackdropEl: HTMLDivElement | null = null;

  constructor(private readonly rpc: RpcInvoker) {
    this.injectStyles();
  }

  private injectStyles(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById('dsh-remote-ssh-styles')) return;
    const style = document.createElement('style');
    style.id = 'dsh-remote-ssh-styles';
    style.textContent = SSH_PLUGIN_STYLES;
    document.head.appendChild(style);
  }

  public mountStatusBarButton(container: HTMLElement): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'dsh-ssh-status-btn';
    btn.type = 'button';
    btn.title = 'Управление удалённым подключением Remote SSH';
    btn.addEventListener('click', () => this.openMainMenuModal());

    this.statusButtonEl = btn;
    this.renderStatusButtonText();
    container.appendChild(btn);

    this.refreshDataFromHost().catch(() => {});
    return btn;
  }

  public async refreshDataFromHost(): Promise<void> {
    const data = await this.rpc.invoke('remote-ssh:get-init-data');
    if (!data) return;
    this.profiles = data.profiles || [];
    this.states = data.states || {};
    this.sshConfigPath = data.sshConfigPath || this.sshConfigPath;

    if (data.persisted?.lastActiveWorkspace && !this.activeProfileId) {
      const last = data.persisted.lastActiveWorkspace;
      if (this.states[last.profileId]?.status === 'connected') {
        this.activeProfileId = last.profileId;
        this.activeRemotePath = last.remotePath;
      }
    }
    this.renderStatusButtonText();
  }

  public updateRuntimeState(state: SshRuntimeState): void {
    this.states[state.profileId] = state;
    if (state.status === 'connected') {
      this.activeProfileId = state.profileId;
    } else if (this.activeProfileId === state.profileId && state.status === 'disconnected') {
      this.activeProfileId = null;
      this.activeRemotePath = null;
    }
    this.renderStatusButtonText();
  }

  private renderStatusButtonText(): void {
    if (!this.statusButtonEl) return;
    const activeState = this.activeProfileId ? this.states[this.activeProfileId] : undefined;
    const status: ConnectionStatus = activeState?.status || 'disconnected';
    this.statusButtonEl.setAttribute('data-status', status);

    const iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 17l6-6-6-6M12 19h8"/></svg>`;

    if (this.activeProfileId && status === 'connected') {
      this.statusButtonEl.innerHTML = `${iconSvg}<span>SSH: ${this.escapeHtml(this.activeProfileId)}</span>`;
    } else if (this.activeProfileId && (status === 'connecting' || status === 'reconnecting')) {
      this.statusButtonEl.innerHTML = `${iconSvg}<span>SSH: ${this.escapeHtml(this.activeProfileId)} (${STATUS_LABELS_RU[status]})</span>`;
    } else {
      this.statusButtonEl.innerHTML = `${iconSvg}<span>Подключиться по SSH</span>`;
    }
  }

  public async openMainMenuModal(): Promise<void> {
    await this.refreshDataFromHost();
    const dialog = this.createModalShell('Удалённое подключение по SSH');
    const body = dialog.querySelector('.dsh-ssh-dialog-body') as HTMLElement;

    if (this.activeProfileId && this.states[this.activeProfileId]?.status === 'connected') {
      const currentProfile = this.profiles.find((p) => p.id === this.activeProfileId);
      const activeBox = document.createElement('div');
      activeBox.className = 'dsh-ssh-warning-box';
      activeBox.style.background = 'rgba(34, 197, 94, 0.12)';
      activeBox.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      activeBox.style.color = 'inherit';
      activeBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>Активное соединение: SSH: ${this.escapeHtml(this.activeProfileId)}</strong>
            <div style="font-size:11px;opacity:0.8;">
              ${this.escapeHtml(currentProfile?.username || '')}@${this.escapeHtml(currentProfile?.host || '')}
              ${this.activeRemotePath ? ` • Папка: <code>${this.escapeHtml(this.activeRemotePath)}</code>` : ''}
            </div>
          </div>
          <span class="dsh-ssh-badge" data-status="connected">Подключён</span>
        </div>
        <div class="dsh-ssh-btn-row" style="justify-content:flex-start;margin-top:10px;">
          <button class="dsh-ssh-btn dsh-ssh-btn-primary" data-action="browse-current">Открыть другую папку на текущем сервере</button>
          <button class="dsh-ssh-btn" data-action="reconnect-current">Переподключиться</button>
          <button class="dsh-ssh-btn" data-action="disconnect-current">Отключиться</button>
        </div>
      `;

      activeBox.querySelector('[data-action="browse-current"]')?.addEventListener('click', () => {
        this.openDirectoryBrowserModal(this.activeProfileId!, this.activeRemotePath || '/var');
      });
      activeBox.querySelector('[data-action="reconnect-current"]')?.addEventListener('click', async () => {
        await this.connectToProfileFlow(this.activeProfileId!);
      });
      activeBox.querySelector('[data-action="disconnect-current"]')?.addEventListener('click', async () => {
        await this.rpc.invoke('remote-ssh:disconnect', { profileId: this.activeProfileId });
        this.activeProfileId = null;
        this.activeRemotePath = null;
        this.renderStatusButtonText();
        this.closeModal();
      });

      body.appendChild(activeBox);
    }

    const sectionTitle = document.createElement('div');
    sectionTitle.style.cssText = 'font-size:12px;font-weight:600;opacity:0.75;margin-top:4px;';
    sectionTitle.textContent = 'Сохранённые SSH-серверы (включая импорт из ~/.ssh/config)';
    body.appendChild(sectionTitle);

    if (this.profiles.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:12px;opacity:0.7;padding:8px 0;';
      empty.textContent = 'Сохранённые серверы не найдены. Добавьте новый сервер ниже.';
      body.appendChild(empty);
    }

    for (const profile of this.profiles) {
      const st = this.states[profile.id]?.status || 'disconnected';
      const item = document.createElement('div');
      item.className = 'dsh-ssh-list-item';
      item.innerHTML = `
        <div>
          <div style="font-weight:600;font-size:13px;">
            ${this.escapeHtml(profile.name)}
            ${profile.username === 'root' ? '<span style="color:#fbbf24;font-size:11px;margin-left:6px;">[root]</span>' : ''}
          </div>
          <div style="font-size:11px;opacity:0.75;">
            ${this.escapeHtml(profile.username)}@${this.escapeHtml(profile.host)}:${profile.port}
            • ${profile.source === 'ssh-config' ? 'OpenSSH Config' : 'Профиль Harness'}
            ${profile.lastDirectories?.length ? ` • Недавняя: ${this.escapeHtml(profile.lastDirectories[0])}` : ''}
          </div>
        </div>
        <span class="dsh-ssh-badge" data-status="${st}">${STATUS_LABELS_RU[st]}</span>
      `;
      item.addEventListener('click', () => this.connectToProfileFlow(profile.id));
      body.appendChild(item);
    }

    const footerActions = document.createElement('div');
    footerActions.className = 'dsh-ssh-btn-row';
    footerActions.style.cssText = 'justify-content:space-between;border-top:1px solid var(--dsh-border,#333);padding-top:10px;';
    footerActions.innerHTML = `
      <span style="font-size:11px;opacity:0.7;align-self:center;">Конфиг: ${this.escapeHtml(this.sshConfigPath)}</span>
      <div style="display:flex;gap:8px;">
        <button class="dsh-ssh-btn dsh-ssh-btn-primary" data-action="add-host">+ Добавить новый SSH-сервер</button>
      </div>
    `;
    footerActions.querySelector('[data-action="add-host"]')?.addEventListener('click', () => {
      this.openAddServerFormModal();
    });
    body.appendChild(footerActions);
  }

  private async connectToProfileFlow(profileId: string, password?: string, passphrase?: string): Promise<void> {
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile) return;

    this.updateRuntimeState({ profileId, status: 'connecting' });
    const dialog = this.createModalShell(`Подключение к ${profile.name}...`);
    const body = dialog.querySelector('.dsh-ssh-dialog-body') as HTMLElement;

    if (profile.username === 'root') {
      const rootWarn = document.createElement('div');
      rootWarn.className = 'dsh-ssh-warning-box';
      rootWarn.textContent =
        'Внимание: подключение выполняется под суперпользователем root. ИИ-агент будет иметь права суперпользователя на удалённом сервере.';
      body.appendChild(rootWarn);
    }

    const statusInfo = document.createElement('div');
    statusInfo.style.fontSize = '13px';
    statusInfo.textContent = `Устанавливается SSH-соединение с ${profile.username}@${profile.host}:${profile.port}...`;
    body.appendChild(statusInfo);

    try {
      const state: SshRuntimeState = await this.rpc.invoke('remote-ssh:connect', {
        profileId,
        password,
        passphrase
      });
      this.updateRuntimeState(state);
      const initialDir = profile.lastDirectories?.[0] || '/var';
      await this.openDirectoryBrowserModal(profileId, initialDir);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      this.updateRuntimeState({
        profileId,
        status: 'error',
        errorText: errMsg
      });

      statusInfo.remove();
      const errBox = document.createElement('div');
      errBox.className = 'dsh-ssh-error-box';
      errBox.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px;">Не удалось подключиться к серверу ${this.escapeHtml(profile.name)}</div>
        <div>${this.escapeHtml(errMsg)}</div>
        <details style="margin-top:6px;cursor:pointer;">
          <summary style="font-size:11px;opacity:0.85;">Технические детали ошибки</summary>
          <pre style="white-space:pre-wrap;font-size:11px;margin-top:4px;">${this.escapeHtml(err?.stack || errMsg)}</pre>
        </details>
      `;
      body.appendChild(errBox);

      const authForm = document.createElement('div');
      authForm.innerHTML = `
        <div style="font-size:12px;margin-top:8px;">Если ключ защищён парольной фразой (Passphrase) или сервер ожидает пароль, введите его для текущей сессии:</div>
        <input class="dsh-ssh-input" type="password" placeholder="Passphrase для приватного ключа (не сохраняется на диск)" data-field="passphrase" style="margin-top:6px;" />
        <input class="dsh-ssh-input" type="password" placeholder="Пароль пользователя SSH (опционально)" data-field="password" style="margin-top:6px;" />
        <div class="dsh-ssh-btn-row">
          <button class="dsh-ssh-btn" data-action="back">Назад к списку</button>
          <button class="dsh-ssh-btn dsh-ssh-btn-primary" data-action="retry">Повторить подключение</button>
        </div>
      `;
      authForm.querySelector('[data-action="back"]')?.addEventListener('click', () => this.openMainMenuModal());
      authForm.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
        const pp = (authForm.querySelector('[data-field="passphrase"]') as HTMLInputElement).value;
        const pw = (authForm.querySelector('[data-field="password"]') as HTMLInputElement).value;
        this.connectToProfileFlow(profileId, pw || undefined, pp || undefined);
      });
      body.appendChild(authForm);
    }
  }

  public async openAddServerFormModal(existing?: SshProfile): Promise<void> {
    const dialog = this.createModalShell(existing ? 'Настроить SSH-сервер' : 'Добавить новый SSH-сервер');
    const body = dialog.querySelector('.dsh-ssh-dialog-body') as HTMLElement;

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label style="font-size:11px;opacity:0.8;">Имя подключения (профиль)</label>
          <input class="dsh-ssh-input" data-f="name" placeholder="MAIN_BASE" value="${this.escapeHtml(existing?.name || '')}" />
        </div>
        <div>
          <label style="font-size:11px;opacity:0.8;">Host / IP</label>
          <input class="dsh-ssh-input" data-f="host" placeholder="192.168.1.10" value="${this.escapeHtml(existing?.host || '')}" />
        </div>
        <div>
          <label style="font-size:11px;opacity:0.8;">Username</label>
          <input class="dsh-ssh-input" data-f="username" placeholder="ubuntu или root" value="${this.escapeHtml(existing?.username || 'root')}" />
        </div>
        <div>
          <label style="font-size:11px;opacity:0.8;">SSH Port</label>
          <input class="dsh-ssh-input" data-f="port" type="number" value="${existing?.port || 22}" />
        </div>
      </div>
      <div>
        <label style="font-size:11px;opacity:0.8;">Путь к приватному ключу (оставьте пустым для автопоиска в ~/.ssh)</label>
        <input class="dsh-ssh-input" data-f="privateKeyPath" placeholder="C:\\Users\\User\\.ssh\\id_ed25519" value="${this.escapeHtml(existing?.privateKeyPath || '')}" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label style="font-size:11px;opacity:0.8;">Passphrase ключа (только в памяти)</label>
          <input class="dsh-ssh-input" data-f="passphrase" type="password" placeholder="Опционально" />
        </div>
        <div>
          <label style="font-size:11px;opacity:0.8;">Пароль SSH (только в памяти)</label>
          <input class="dsh-ssh-input" data-f="password" type="password" placeholder="Опционально" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label style="font-size:11px;opacity:0.8;">ProxyJump (опционально)</label>
          <input class="dsh-ssh-input" data-f="proxyJump" placeholder="user@bastion:22" value="${this.escapeHtml(existing?.proxyJump || '')}" />
        </div>
        <div>
          <label style="font-size:11px;opacity:0.8;">KeepAlive интервал (сек)</label>
          <input class="dsh-ssh-input" data-f="keepAlive" type="number" value="${existing?.keepAliveInterval || 15}" />
        </div>
      </div>
      <div class="dsh-ssh-btn-row">
        <button class="dsh-ssh-btn" data-action="cancel">Отмена</button>
        <button class="dsh-ssh-btn" data-action="save">Сохранить профиль</button>
        <button class="dsh-ssh-btn dsh-ssh-btn-primary" data-action="save-connect">Проверить и подключиться</button>
      </div>
    `;

    const collectProfile = (): { profile: SshProfile; password?: string; passphrase?: string } => {
      const getVal = (f: string) => (body.querySelector(`[data-f="${f}"]`) as HTMLInputElement).value.trim();
      const name = getVal('name') || getVal('host');
      return {
        profile: {
          id: name,
          name,
          host: getVal('host'),
          port: parseInt(getVal('port') || '22', 10),
          username: getVal('username') || 'root',
          privateKeyPath: getVal('privateKeyPath') || undefined,
          proxyJump: getVal('proxyJump') || undefined,
          keepAliveInterval: parseInt(getVal('keepAlive') || '15', 10),
          useAgent: true,
          allowPassword: true,
          source: 'user'
        },
        password: (body.querySelector('[data-f="password"]') as HTMLInputElement).value || undefined,
        passphrase: (body.querySelector('[data-f="passphrase"]') as HTMLInputElement).value || undefined
      };
    };

    body.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.openMainMenuModal());
    body.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
      const { profile } = collectProfile();
      if (!profile.host) return;
      this.profiles = await this.rpc.invoke('remote-ssh:save-profile', profile);
      await this.openMainMenuModal();
    });
    body.querySelector('[data-action="save-connect"]')?.addEventListener('click', async () => {
      const { profile, password, passphrase } = collectProfile();
      if (!profile.host) return;
      this.profiles = await this.rpc.invoke('remote-ssh:save-profile', profile);
      await this.connectToProfileFlow(profile.id, password, passphrase);
    });
  }

  public async openDirectoryBrowserModal(profileId: string, initialPosixPath = '/var/Del_Arte'): Promise<void> {
    const dialog = this.createModalShell(`Выбор удалённой папки проекта — SSH: ${profileId}`);
    const body = dialog.querySelector('.dsh-ssh-dialog-body') as HTMLElement;

    let currentPath = initialPosixPath || '/';
    let showHidden = true;

    body.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="dsh-ssh-input" data-f="posix-path" value="${this.escapeHtml(currentPath)}" placeholder="/var/Del_Arte" />
        <button class="dsh-ssh-btn" data-action="go-path">Перейти</button>
        <button class="dsh-ssh-btn dsh-ssh-btn-primary" data-action="open-workspace" style="white-space:nowrap;">Открыть папку</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" data-f="show-hidden" checked /> Показывать скрытые файлы (.git, .env)
        </label>
        <span data-region="count-info" style="opacity:0.7;"></span>
      </div>
      <div data-region="recent-dirs" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
      <div data-region="dir-entries" style="display:flex;flex-direction:column;gap:4px;max-height:46vh;overflow-y:auto;"></div>
    `;

    const pathInput = body.querySelector('[data-f="posix-path"]') as HTMLInputElement;
    const entriesContainer = body.querySelector('[data-region="dir-entries"]') as HTMLElement;
    const countInfo = body.querySelector('[data-region="count-info"]') as HTMLElement;
    const recentContainer = body.querySelector('[data-region="recent-dirs"]') as HTMLElement;

    const profile = this.profiles.find((p) => p.id === profileId);
    if (profile?.lastDirectories?.length) {
      for (const recentDir of profile.lastDirectories.slice(0, 4)) {
        const chip = document.createElement('button');
        chip.className = 'dsh-ssh-btn';
        chip.style.fontSize = '11px';
        chip.textContent = `Недавняя: ${recentDir}`;
        chip.addEventListener('click', () => loadDirectory(recentDir, 0));
        recentContainer.appendChild(chip);
      }
    }

    const loadDirectory = async (targetPath: string, offset = 0) => {
      if (offset === 0) {
        entriesContainer.innerHTML = `<div style="font-size:12px;opacity:0.7;padding:8px;">Чтение каталога ${this.escapeHtml(targetPath)}...</div>`;
      }
      try {
        const listing: DirectoryListingResult = await this.rpc.invoke('remote-ssh:list-dir', {
          profileId,
          path: targetPath,
          showHidden,
          offset
        });
        currentPath = listing.currentPath;
        pathInput.value = currentPath;
        countInfo.textContent = `Элементов: ${listing.totalCount}`;

        if (offset === 0) {
          entriesContainer.innerHTML = '';
          if (listing.parentPath) {
            const upRow = document.createElement('div');
            upRow.className = 'dsh-ssh-list-item';
            upRow.innerHTML = `<strong>📁 .. (На уровень выше: ${this.escapeHtml(listing.parentPath)})</strong>`;
            upRow.addEventListener('click', () => loadDirectory(listing.parentPath!, 0));
            entriesContainer.appendChild(upRow);
          }
        }

        for (const entry of listing.entries) {
          const row = document.createElement('div');
          row.className = 'dsh-ssh-list-item';
          const icon = entry.isDirectory ? '📁' : '📄';
          row.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;">
              <span>${icon}</span>
              <span style="font-weight:${entry.isDirectory ? '600' : '400'};">${this.escapeHtml(entry.name)}</span>
            </div>
            <span style="font-size:11px;opacity:0.65;font-family:monospace;">${this.escapeHtml(entry.permissions)}</span>
          `;
          if (entry.isDirectory) {
            row.addEventListener('click', () => loadDirectory(entry.path, 0));
          }
          entriesContainer.appendChild(row);
        }

        if (listing.hasMore) {
          const moreBtn = document.createElement('button');
          moreBtn.className = 'dsh-ssh-btn';
          moreBtn.textContent = `Загрузить ещё (${listing.nextOffset} из ${listing.totalCount})`;
          moreBtn.addEventListener('click', () => {
            moreBtn.remove();
            loadDirectory(currentPath, listing.nextOffset);
          });
          entriesContainer.appendChild(moreBtn);
        }
      } catch (err: any) {
        entriesContainer.innerHTML = `<div class="dsh-ssh-error-box">${this.escapeHtml(err?.message || String(err))}</div>`;
      }
    };

    body.querySelector('[data-action="go-path"]')?.addEventListener('click', () => {
      loadDirectory(pathInput.value.trim() || '/', 0);
    });
    pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadDirectory(pathInput.value.trim() || '/', 0);
    });
    body.querySelector('[data-f="show-hidden"]')?.addEventListener('change', (e) => {
      showHidden = (e.target as HTMLInputElement).checked;
      loadDirectory(currentPath, 0);
    });
    body.querySelector('[data-action="open-workspace"]')?.addEventListener('click', async () => {
      const targetWorkspacePath = pathInput.value.trim() || currentPath;
      await this.rpc.invoke('remote-ssh:open-workspace', {
        workspaceId: `ssh-${profileId}-${targetWorkspacePath}`,
        profileId,
        remotePath: targetWorkspacePath
      });
      this.activeProfileId = profileId;
      this.activeRemotePath = targetWorkspacePath;
      this.renderStatusButtonText();
      this.closeModal();
    });

    await loadDirectory(currentPath, 0);
  }

  private createModalShell(title: string): HTMLElement {
    this.closeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'dsh-ssh-modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.closeModal();
    });

    const dialog = document.createElement('div');
    dialog.className = 'dsh-ssh-dialog';
    dialog.innerHTML = `
      <div class="dsh-ssh-dialog-header">
        <span>${this.escapeHtml(title)}</span>
        <button class="dsh-ssh-btn" data-action="close-modal" style="padding:2px 8px;">✕</button>
      </div>
      <div class="dsh-ssh-dialog-body"></div>
    `;
    dialog.querySelector('[data-action="close-modal"]')?.addEventListener('click', () => this.closeModal());

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    this.modalBackdropEl = backdrop;
    return dialog;
  }

  public closeModal(): void {
    if (this.modalBackdropEl) {
      this.modalBackdropEl.remove();
      this.modalBackdropEl = null;
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}