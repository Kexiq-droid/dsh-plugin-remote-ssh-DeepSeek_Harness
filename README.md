# dsh-plugin-remote-ssh

Полнофункциональный плагин **Remote SSH** (в стиле Cursor Remote SSH) для **DeepSeek Harness Desktop (0.2.0-rc.2)** под Windows 11 x64.

## Возможности
- **Кнопка в правом нижнем углу (shell.bottom)**: Подключиться по SSH -> меняется на SSH: MAIN_BASE после подключения.
- **Автоимпорт OpenSSH**: автоматическое чтение %USERPROFILE%\.ssh\config (Host, HostName, User, Port, IdentityFile, ProxyJump, Include).
- **Удалённый файловый браузер**: навигация по POSIX-путям (/var/Del_Arte), показ скрытых файлов, пагинация больших директорий.
- **Прозрачная работа ИИ-агента**: маршрутизация read_file, write_file, edit, list, glob, grep, bash и интерактивного PTY на удалённый сервер без локального fallback при разрыве связи.
- **Безопасность**: верификация known_hosts по SHA-256, блокировка при подмене ключа, хранение паролей/passphrase только в памяти/DPAPI, очистка секретов в логах.

## Сборка и установка
    npm install --ignore-scripts
    npm test
    npm run pack:plugin

Готовый архив dsh-plugin-remote-ssh-1.0.0.tgz устанавливается через DeepSeek Harness Desktop -> Plugins или распаковкой в %USERPROFILE%\.dsh\profiles\desktop\plugins\remote-ssh.