import { DEFAULT_PORT } from '../../shared/constants';
import type {
  FTreeAPI,
  Person,
  PersonIndex,
  CreatePersonDTO,
  UpdatePersonDTO,
  ListQuery,
  GenerationCharConfig,
  ExportDataResult,
  UserInfo,
  CreateUserDTO,
  UpdateUserDTO,
  AuthCheckResult,
  LoginResult,
  SetupResult,
} from '../types/person';

const BASE_URL = `http://localhost:${DEFAULT_PORT}/api`;

/** HTTP 模式下保存的 token */
let authToken: string | null = null;

/** 保存 token 到 sessionStorage */
function saveToken(token: string): void {
  authToken = token;
  try {
    sessionStorage.setItem('ftree_token', token);
  } catch {
    // ignore
  }
}

/** 从 sessionStorage 恢复 token */
function loadToken(): string | null {
  if (authToken) return authToken;
  try {
    authToken = sessionStorage.getItem('ftree_token');
  } catch {
    // ignore
  }
  return authToken;
}

/** 清除 token */
function clearToken(): void {
  authToken = null;
  try {
    sessionStorage.removeItem('ftree_token');
  } catch {
    // ignore
  }
}

/** 发起 HTTP 请求并自动解包 { success, data, error } 响应格式 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // 附加 token
  const token = loadToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || `请求失败: ${res.status}`);
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const body = await res.json();
    if (body.success === false) {
      throw new Error(body.error || '操作失败');
    }
    return body.data !== undefined ? body.data : body;
  }
  return undefined as unknown as T;
}

function buildQueryString(query?: Record<string, unknown>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const str = params.toString();
  return str ? `?${str}` : '';
}

const httpApi: FTreeAPI = {
  auth: {
    async setup(username: string, password: string, displayName?: string): Promise<SetupResult> {
      const result = await request<SetupResult>('/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ username, password, displayName }),
      });
      if (result.token) {
        saveToken(result.token);
      }
      return result;
    },
    async login(username: string, password: string): Promise<LoginResult> {
      try {
        const result = await request<LoginResult>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        });
        if (result.token) {
          saveToken(result.token);
        }
        return result;
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
    async check(): Promise<AuthCheckResult> {
      const data = await request<AuthCheckResult>('/auth/check');
      return data;
    },
    async me(): Promise<UserInfo> {
      return request('/auth/me');
    },
    async changePassword(oldPassword: string, newPassword: string): Promise<void> {
      await request('/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
    },
    async logout(): Promise<void> {
      try {
        await request('/auth/logout', { method: 'POST' });
      } catch {
        // ignore
      }
      clearToken();
    },
  },

  users: {
    async list(): Promise<UserInfo[]> {
      return request('/users');
    },
    async create(data: CreateUserDTO): Promise<UserInfo> {
      return request('/users', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    async update(id: string, data: UpdateUserDTO): Promise<UserInfo> {
      return request(`/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },
    async delete(id: string): Promise<void> {
      await request(`/users/${id}`, { method: 'DELETE' });
    },
    async resetPassword(id: string, newPassword: string): Promise<void> {
      await request(`/users/${id}/reset-password`, {
        method: 'PUT',
        body: JSON.stringify({ newPassword }),
      });
    },
    async toggle(id: string): Promise<UserInfo> {
      return request(`/users/${id}/toggle`, { method: 'PUT' });
    },
  },

  person: {
    async create(data: CreatePersonDTO): Promise<Person> {
      return request('/person', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    async update(id: string, data: UpdatePersonDTO): Promise<Person> {
      return request(`/person/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },
    async delete(id: string): Promise<void> {
      await request(`/person/${id}`, { method: 'DELETE' });
    },
    async get(id: string): Promise<Person> {
      return request(`/person/${id}`);
    },
    async list(query?: ListQuery): Promise<{ items: PersonIndex[]; total: number }> {
      return request(`/person${buildQueryString(query as Record<string, unknown>)}`);
    },
  },

  tree: {
    async getData(): Promise<PersonIndex[]> {
      return request('/tree');
    },
    async getChildren(parentId: string): Promise<PersonIndex[]> {
      return request(`/tree/children/${parentId}`);
    },
    async reorderChildren(parentId: string, orderedIds: string[]): Promise<void> {
      await request(`/tree/reorder`, {
        method: 'POST',
        body: JSON.stringify({ parentId, orderedIds }),
      });
    },
  },

  data: {
    async export(): Promise<ExportDataResult> {
      return request('/data/export', { method: 'POST' });
    },
    async import(data: Person[] | ExportDataResult): Promise<void> {
      await request('/data/import', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    async backup(): Promise<string> {
      const res = await request<{ path: string }>('/data/backup', {
        method: 'POST',
      });
      return res.path;
    },
    async clear(): Promise<void> {
      await request('/data/clear', { method: 'POST' });
    },
  },

  config: {
    async getGenerationChars(): Promise<GenerationCharConfig> {
      return request('/config/generation-chars');
    },
    async saveGenerationChars(data: GenerationCharConfig): Promise<void> {
      await request('/config/generation-chars', {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },
    async getDataPath(): Promise<{ current: string; default: string }> {
      // HTTP 模式不支持修改数据路径
      return { current: '（浏览器模式不支持）', default: '' };
    },
    async selectDataPath(): Promise<string | null> {
      return null;
    },
    async setDataPath(): Promise<string> {
      throw new Error('浏览器模式不支持修改数据路径');
    },
    async resetDataPath(): Promise<string> {
      throw new Error('浏览器模式不支持修改数据路径');
    },
  },

  export: {
    async saveImage(buffer: ArrayBuffer, filename: string): Promise<string> {
      // 浏览器模式：直接下载
      const blob = new Blob([buffer], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return filename;
    },
  },
};

// Electron IPC 模式包装器
function wrapIpcApi(ipcApi: any): FTreeAPI {
  return {
    auth: {
      async setup(username: string, password: string, displayName?: string) {
        const res = await ipcApi.auth.setup(username, password, displayName);
        if (res?.success === false) throw new Error(res.error);
        return res;
      },
      async login(username: string, password: string) {
        const res = await ipcApi.auth.login(username, password);
        return res;
      },
      async check() {
        const res = await ipcApi.auth.check();
        const data = res?.data || res;
        return data;
      },
      async me() {
        const res = await ipcApi.auth.me();
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async changePassword(oldPassword: string, newPassword: string) {
        const res = await ipcApi.auth.changePassword(oldPassword, newPassword);
        if (res?.success === false) throw new Error(res.error);
      },
      async logout() {
        await ipcApi.auth.logout();
      },
      async resetData() {
        const res = await ipcApi.auth.resetData();
        return res;
      },
    },
    users: {
      async list() {
        const res = await ipcApi.users.list();
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async create(data: CreateUserDTO) {
        const res = await ipcApi.users.create(data);
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async update(id: string, data: UpdateUserDTO) {
        const res = await ipcApi.users.update(id, data);
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async delete(id: string) {
        const res = await ipcApi.users.delete(id);
        if (res?.success === false) throw new Error(res.error);
      },
      async resetPassword(id: string, newPassword: string) {
        const res = await ipcApi.users.resetPassword(id, newPassword);
        if (res?.success === false) throw new Error(res.error);
      },
      async toggle(id: string) {
        const res = await ipcApi.users.toggle(id);
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
    },
    person: {
      async create(data: CreatePersonDTO) {
        const res = await ipcApi.person.create(data);
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async update(id: string, data: UpdatePersonDTO) {
        const res = await ipcApi.person.update(id, data);
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async delete(id: string) {
        const res = await ipcApi.person.delete(id);
        if (res?.success === false) throw new Error(res.error);
      },
      async get(id: string) {
        const res = await ipcApi.person.get(id);
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async list(query?: ListQuery) {
        const res = await ipcApi.person.list(query);
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
    },
    tree: {
      async getData() {
        const res = await ipcApi.tree.getData();
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async getChildren(parentId: string) {
        const res = await ipcApi.tree.getChildren(parentId);
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async reorderChildren(parentId: string, orderedIds: string[]) {
        const res = await ipcApi.tree.reorderChildren(parentId, orderedIds);
        if (res?.success === false) throw new Error(res.error);
      },
    },
    data: {
      async export() {
        const res = await ipcApi.data.export();
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async import(data: Person[] | ExportDataResult) {
        const res = await ipcApi.data.import(data);
        if (res?.success === false) throw new Error(res.error);
      },
      async backup() {
        const res = await ipcApi.data.backup();
        if (res?.success === false) throw new Error(res.error);
        return res?.data?.path || '';
      },
      async clear() {
        const res = await ipcApi.data.clear();
        if (res?.success === false) throw new Error(res.error);
      },
    },
    config: {
      async getGenerationChars() {
        const res = await ipcApi.config.getGenerationChars();
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async saveGenerationChars(data: GenerationCharConfig) {
        const res = await ipcApi.config.saveGenerationChars(data);
        if (res?.success === false) throw new Error(res.error);
      },
      async getDataPath() {
        const res = await ipcApi.config.getDataPath();
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async selectDataPath() {
        const res = await ipcApi.config.selectDataPath();
        if (res?.success === false) throw new Error(res.error);
        return res?.data !== undefined ? res.data : res;
      },
      async setDataPath(newPath: string, migrate: boolean) {
        const res = await ipcApi.config.setDataPath(newPath, migrate);
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
      async resetDataPath() {
        const res = await ipcApi.config.resetDataPath();
        if (res?.success === false) throw new Error(res.error);
        return res?.data || res;
      },
    },
    export: {
      async saveImage(buffer: ArrayBuffer, filename: string) {
        // Electron 模式：将 buffer 转为 base64，通过 IPC 保存
        const arr = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < arr.length; i++) {
          binary += String.fromCharCode(arr[i]);
        }
      const base64 = 'data:image/png;base64,' + btoa(binary);
      const res = await ipcApi.export.saveImage(base64, filename);
      if (res?.success === false) throw new Error(res.error);
      return res?.data?.path || filename;
      },
    },
  };
}

/**
 * 统一 API 对象
 * 优先使用 Electron IPC（window.ftreeAPI），回退到 HTTP fetch
 */
export const api: FTreeAPI = (window as any).ftreeAPI
  ? wrapIpcApi((window as any).ftreeAPI)
  : httpApi;
