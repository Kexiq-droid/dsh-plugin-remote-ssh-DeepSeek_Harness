import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const desktopProfileDir = path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
if (!fs.existsSync(desktopProfileDir)) {
  fs.mkdirSync(desktopProfileDir, { recursive: true });
}
console.log('[OK] Профиль DeepSeek Harness Desktop проверен:', desktopProfileDir);