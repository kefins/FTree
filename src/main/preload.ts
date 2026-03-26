import { contextBridge, ipcRenderer } from 'electron';

const ftreeAPI = {
  auth: {
    check: (): Promise<{ initialized: boolean; loggedIn: boolean }> =>
      ipcRenderer.invoke('auth:check'),
    setup: (password: string): Promise<void> =>
      ipcRenderer.invoke('auth:setup', password),
    login: (password: string): Promise<boolean> =>
      ipcRenderer.invoke('auth:login', password),
  },
  person: {
    create: (data: unknown): Promise<unknown> =>
      ipcRenderer.invoke('person:create', data),
    update: (id: string, data: unknown): Promise<unknown> =>
      ipcRenderer.invoke('person:update', id, data),
    delete: (id: string): Promise<void> =>
      ipcRenderer.invoke('person:delete', id),
    get: (id: string): Promise<unknown> =>
      ipcRenderer.invoke('person:get', id),
    list: (query?: unknown): Promise<unknown> =>
      ipcRenderer.invoke('person:list', query),
  },
  tree: {
    getData: (): Promise<unknown[]> => ipcRenderer.invoke('tree:getData'),
    getChildren: (parentId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('tree:getChildren', parentId),
    reorderChildren: (parentId: string, orderedIds: string[]): Promise<void> =>
      ipcRenderer.invoke('tree:reorderChildren', parentId, orderedIds),
  },
  data: {
    export: (): Promise<unknown[]> => ipcRenderer.invoke('data:export'),
    import: (data: unknown[]): Promise<void> =>
      ipcRenderer.invoke('data:import', data),
    backup: (): Promise<string> => ipcRenderer.invoke('data:backup'),
    clear: (): Promise<void> => ipcRenderer.invoke('data:clear'),
  },
  config: {
    getGenerationChars: (): Promise<unknown> =>
      ipcRenderer.invoke('config:getGenerationChars'),
    saveGenerationChars: (data: unknown): Promise<void> =>
      ipcRenderer.invoke('config:saveGenerationChars', data),
    getDataPath: (): Promise<{ current: string; default: string }> =>
      ipcRenderer.invoke('config:getDataPath'),
    selectDataPath: (): Promise<string | null> =>
      ipcRenderer.invoke('config:selectDataPath'),
    setDataPath: (newPath: string, migrate: boolean): Promise<string> =>
      ipcRenderer.invoke('config:setDataPath', newPath, migrate),
    resetDataPath: (): Promise<string> =>
      ipcRenderer.invoke('config:resetDataPath'),
  },
  export: {
    saveImage: (buffer: ArrayBuffer, filename: string): Promise<string> =>
      ipcRenderer.invoke('export:saveImage', buffer, filename),
  },
};

contextBridge.exposeInMainWorld('ftreeAPI', ftreeAPI);

export type FTreeAPI = typeof ftreeAPI;
