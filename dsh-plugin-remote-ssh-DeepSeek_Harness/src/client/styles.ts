export const SSH_PLUGIN_STYLES = `
.dsh-ssh-status-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  margin-left: auto;
  border: none;
  border-radius: 3px;
  font-family: var(--dsh-font-sans, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  color: var(--dsh-status-fg, #ffffff);
  background: var(--dsh-accent, #2563eb);
  transition: filter 0.15s ease, background-color 0.15s ease;
  user-select: none;
}
.dsh-ssh-status-btn:hover { filter: brightness(1.1); }
.dsh-ssh-status-btn[data-status="connected"] { background: var(--dsh-success, #16a34a); }
.dsh-ssh-status-btn[data-status="connecting"],
.dsh-ssh-status-btn[data-status="reconnecting"] { background: var(--dsh-warning, #d97706); }
.dsh-ssh-status-btn[data-status="error"] { background: var(--dsh-danger, #dc2626); }

.dsh-ssh-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8vh;
  backdrop-filter: blur(2px);
}

.dsh-ssh-dialog {
  width: min(640px, 94vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  background: var(--dsh-bg-surface, #1e1e24);
  color: var(--dsh-text-primary, #f3f4f6);
  border: 1px solid var(--dsh-border, #333540);
  border-radius: 8px;
  box-shadow: 0 20px 45px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  font-family: var(--dsh-font-sans, system-ui, -apple-system, sans-serif);
}

@media (prefers-color-scheme: light) {
  .dsh-ssh-dialog:not([data-theme="dark"]) {
    background: var(--dsh-bg-surface, #ffffff);
    color: var(--dsh-text-primary, #111827);
    border-color: var(--dsh-border, #e5e7eb);
  }
}

.dsh-ssh-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--dsh-border, #333540);
  font-size: 14px;
  font-weight: 600;
}

.dsh-ssh-dialog-body {
  padding: 12px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dsh-ssh-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: var(--dsh-bg-elevated, rgba(255, 255, 255, 0.04));
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.dsh-ssh-list-item:hover {
  border-color: var(--dsh-accent, #3b82f6);
  background: rgba(59, 130, 246, 0.1);
}

.dsh-ssh-badge {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  font-weight: 500;
}
.dsh-ssh-badge[data-status="disconnected"] { background: rgba(156,163,175,0.2); color: #9ca3af; }
.dsh-ssh-badge[data-status="connecting"],
.dsh-ssh-badge[data-status="reconnecting"] { background: rgba(245,158,11,0.2); color: #fbbf24; }
.dsh-ssh-badge[data-status="connected"] { background: rgba(34,197,94,0.2); color: #4ade80; }
.dsh-ssh-badge[data-status="error"] { background: rgba(239,68,68,0.2); color: #f87171; }

.dsh-ssh-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border-radius: 5px;
  border: 1px solid var(--dsh-border, #3f3f46);
  background: var(--dsh-bg-input, rgba(0, 0, 0, 0.25));
  color: inherit;
  font-size: 13px;
}

.dsh-ssh-btn-row {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}

.dsh-ssh-btn {
  padding: 6px 12px;
  border-radius: 5px;
  border: 1px solid var(--dsh-border, #3f3f46);
  background: var(--dsh-bg-elevated, #27272a);
  color: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.dsh-ssh-btn-primary {
  background: var(--dsh-accent, #2563eb);
  border-color: var(--dsh-accent, #2563eb);
  color: #ffffff;
}

.dsh-ssh-warning-box {
  padding: 8px 12px;
  border-radius: 5px;
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #fcd34d;
  font-size: 12px;
}

.dsh-ssh-error-box {
  padding: 8px 12px;
  border-radius: 5px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  font-size: 12px;
}
`;