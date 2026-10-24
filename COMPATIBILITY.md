# Документ совместимости версий (Compatibility Matrix)

| Компонент | Поддерживаемые версии | Примечание |
|---|---|---|
| **DeepSeek Harness Desktop** | 0.2.0-rc.2 (>=0.2.0-rc.0 <0.3.0) | Полная поддержка Cordis Host/Client и слотов shell.bottom / status-bar.right |
| **ОС клиента** | Windows 11 x64 | Интеграция с %USERPROFILE%\.ssh\config, Windows OpenSSH Agent pipe и DPAPI |
| **ОС удалённого сервера** | Ubuntu 22.04+, Debian 11+, любой POSIX Linux | Требуются только стандартные sshd, sftp-server и bash |
| **VS Code Agent Host (AHP)** | Не требуется | Исключена ошибка AHP protocol mismatch за счёт прямого SFTP/SSH2 транспорта |