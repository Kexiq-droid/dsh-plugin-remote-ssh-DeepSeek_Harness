import { Attributes, SFTPWrapper } from 'ssh2';
import { DirectoryListingResult, RemoteFileEntry } from '../shared/types';
import { getParentPosixPath, joinPosixPath, normalizePosixPath } from '../shared/posix-path';
import { SshConnectionManager } from './connection-mgr';

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

export class RemoteFsProvider {
  constructor(private readonly connMgr: SshConnectionManager) {}

  private sftp(profileId: string): SFTPWrapper {
    return this.connMgr.getActiveSftp(profileId);
  }

  public async readFile(profileId: string, remotePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    const sftp = this.sftp(profileId);
    const normPath = normalizePosixPath(remotePath);

    return new Promise((resolve, reject) => {
      sftp.readFile(normPath, (err, buf) => {
        if (err) {
          return reject(new Error(`Не удалось прочитать удалённый файл ${normPath}: ${err.message}`));
        }
        resolve(buf.toString(encoding));
      });
    });
  }

  public async writeFile(profileId: string, remotePath: string, content: string | Buffer): Promise<void> {
    const sftp = this.sftp(profileId);
    const normPath = normalizePosixPath(remotePath);
    const data = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;

    return new Promise((resolve, reject) => {
      sftp.writeFile(normPath, data, (err) => {
        if (err) {
          return reject(new Error(`Не удалось записать удалённый файл ${normPath}: ${err.message}`));
        }
        resolve();
      });
    });
  }

  public async editFile(
    profileId: string,
    remotePath: string,
    oldText: string,
    newText: string,
    replaceAll = false
  ): Promise<{ updatedPath: string; replacements: number }> {
    const normPath = normalizePosixPath(remotePath);
    const currentContent = await this.readFile(profileId, normPath, 'utf-8');

    if (!currentContent.includes(oldText)) {
      throw new Error(`Фрагмент для замены не найден в удалённом файле ${normPath}`);
    }

    let updated: string;
    let replacements = 0;

    if (replaceAll) {
      const parts = currentContent.split(oldText);
      replacements = parts.length - 1;
      updated = parts.join(newText);
    } else {
      replacements = 1;
      updated = currentContent.replace(oldText, () => newText);
    }

    await this.writeFile(profileId, normPath, updated);
    return { updatedPath: normPath, replacements };
  }

  public async stat(profileId: string, remotePath: string): Promise<RemoteFileEntry> {
    const sftp = this.sftp(profileId);
    const normPath = normalizePosixPath(remotePath);

    return new Promise((resolve, reject) => {
      sftp.stat(normPath, (err, stats) => {
        if (err) {
          return reject(new Error(`Путь не найден на сервере (${normPath}): ${err.message}`));
        }
        const name = normPath === '/' ? '/' : normPath.split('/').pop() || normPath;
        resolve(this.attrsToEntry(name, normPath, stats));
      });
    });
  }

  public async mkdir(profileId: string, remotePath: string): Promise<void> {
    const sftp = this.sftp(profileId);
    const normPath = normalizePosixPath(remotePath);

    return new Promise((resolve, reject) => {
      sftp.mkdir(normPath, (err) => {
        if (err) return reject(new Error(`Ошибка создания каталога ${normPath}: ${err.message}`));
        resolve();
      });
    });
  }

  public async removeFile(profileId: string, remotePath: string): Promise<void> {
    const sftp = this.sftp(profileId);
    const normPath = normalizePosixPath(remotePath);

    return new Promise((resolve, reject) => {
      sftp.unlink(normPath, (err) => {
        if (err) return reject(new Error(`Ошибка удаления удалённого файла ${normPath}: ${err.message}`));
        resolve();
      });
    });
  }

  public async listDirectory(
    profileId: string,
    remotePath: string,
    options: { showHidden?: boolean; offset?: number; limit?: number } = {}
  ): Promise<DirectoryListingResult> {
    const sftp = this.sftp(profileId);
    const normPath = normalizePosixPath(remotePath);
    const showHidden = options.showHidden ?? true;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 200;

    const rawList = await new Promise<Array<{ filename: string; longname: string; attrs: Attributes }>>(
      (resolve, reject) => {
        sftp.readdir(normPath, (err, list) => {
          if (err) {
            return reject(new Error(`Ошибка чтения директории ${normPath}: ${err.message}`));
          }
          resolve(list || []);
        });
      }
    );

    const mapped: RemoteFileEntry[] = [];
    for (const item of rawList) {
      if (item.filename === '.' || item.filename === '..') continue;
      const isHidden = item.filename.startsWith('.');
      if (!showHidden && isHidden) continue;

      const fullEntryPath = joinPosixPath(normPath, item.filename);
      mapped.push(this.attrsToEntry(item.filename, fullEntryPath, item.attrs, item.longname));
    }

    mapped.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'en', { numeric: true });
    });

    const slice = mapped.slice(offset, offset + limit);
    return {
      currentPath: normPath,
      parentPath: getParentPosixPath(normPath),
      entries: slice,
      totalCount: mapped.length,
      hasMore: offset + limit < mapped.length,
      nextOffset: offset + slice.length
    };
  }

  private attrsToEntry(
    name: string,
    fullPath: string,
    attrs: Attributes,
    longname?: string
  ): RemoteFileEntry {
    const mode = attrs.mode || 0;
    const typeBits = mode & S_IFMT;
    const isDirectory = typeBits === S_IFDIR;
    const isSymlink = typeBits === S_IFLNK;

    return {
      name,
      path: fullPath,
      isDirectory,
      isSymlink,
      isHidden: name.startsWith('.'),
      size: attrs.size || 0,
      mtime: (attrs.mtime || 0) * 1000,
      permissions: longname ? longname.split(/\s+/)[0] : mode.toString(8)
    };
  }
}