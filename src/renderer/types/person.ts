export interface Person {
  id: string;
  name: string;
  gender: 'male' | 'female';
  generation: number;
  parentId: string | null;
  /** 亲生父亲ID（过继场景：parentId 为养父，此字段为生父） */
  biologicalParentId?: string | null;
  spouseName?: string;
  /** 配偶出生日期 */
  spouseBirthDate?: string;
  /** 配偶逝世日期 */
  spouseDeathDate?: string;
  /** 配偶籍贯 */
  spouseBirthPlace?: string;
  /** 配偶职业 */
  spouseOccupation?: string;
  /** 配偶联系电话 */
  spousePhone?: string;
  /** 配偶现住址 */
  spouseAddress?: string;
  /** 子女备注（女性成员用，简要标注子女情况） */
  childrenNote?: string;
  courtesy?: string;
  birthDate?: string;
  deathDate?: string;
  birthPlace?: string;
  occupation?: string;
  phone?: string;
  address?: string;
  bio?: string;
  avatar?: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface PersonIndex {
  id: string;
  name: string;
  gender: 'male' | 'female';
  generation: number;
  parentId: string | null;
  /** 亲生父亲ID（过继场景） */
  biologicalParentId?: string | null;
  /** 配偶姓名 */
  spouseName?: string;
  sortOrder: number;
}

export type CreatePersonDTO = Omit<Person, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdatePersonDTO = Partial<CreatePersonDTO>;

export interface ListQuery {
  search?: string;
  generation?: number;
  page?: number;
  pageSize?: number;
}

export interface TreeNode extends PersonIndex {
  children: TreeNode[];
}

/** 过继关系（虚线连接）：从亲生父亲指向过继子女 */
export interface AdoptionLink {
  childId: string;
  biologicalParentId: string;
}

/** 辈分字配置 */
export interface GenerationCharConfig {
  /** 完整字辈诗/派语 */
  poem?: string;
  /** 逐世辈分字映射：世数 → 辈分字 */
  characters: Record<number, string>;
}

/** 导出数据结构（包含人员数据 + 字辈配置） */
export interface ExportDataResult {
  version: string;
  exportedAt: string;
  persons: Person[];
  generationChars?: GenerationCharConfig;
}

// ======================== 用户/权限类型 ========================

/** 用户角色 */
export type UserRole = 'admin' | 'editor' | 'viewer';

/** 用户信息（前端展示用） */
export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  disabled?: boolean;
}

/** 创建用户参数 */
export interface CreateUserDTO {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
}

/** 更新用户参数 */
export interface UpdateUserDTO {
  displayName?: string;
  role?: UserRole;
}

/** 认证检查结果 */
export interface AuthCheckResult {
  initialized: boolean;
  loggedIn: boolean;
  v2: boolean;
  usernames: string[];
  user?: {
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
  };
}

/** 登录结果 */
export interface LoginResult {
  success: boolean;
  error?: string;
  token?: string;
  user?: {
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
  };
  needMigration?: boolean;
}

/** 设置结果 */
export interface SetupResult {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
  };
}

/** 权限定义 */
export interface Permissions {
  canEdit: boolean;
  canDelete: boolean;
  canManageUsers: boolean;
  canManageData: boolean;
  canManageSettings: boolean;
}

/** 根据角色获取权限 */
export function getPermissions(role: UserRole): Permissions {
  return {
    canEdit: role === 'admin' || role === 'editor',
    canDelete: role === 'admin',
    canManageUsers: role === 'admin',
    canManageData: role === 'admin',
    canManageSettings: role === 'admin' || role === 'editor',
  };
}

export interface FTreeAPI {
  auth: {
    setup(username: string, password: string, displayName?: string): Promise<SetupResult>;
    login(username: string, password: string): Promise<LoginResult>;
    check(): Promise<AuthCheckResult>;
    me(): Promise<UserInfo>;
    changePassword(oldPassword: string, newPassword: string): Promise<void>;
    logout(): Promise<void>;
  };
  users: {
    list(): Promise<UserInfo[]>;
    create(data: CreateUserDTO): Promise<UserInfo>;
    update(id: string, data: UpdateUserDTO): Promise<UserInfo>;
    delete(id: string): Promise<void>;
    resetPassword(id: string, newPassword: string): Promise<void>;
    toggle(id: string): Promise<UserInfo>;
  };
  person: {
    create(data: CreatePersonDTO): Promise<Person>;
    update(id: string, data: UpdatePersonDTO): Promise<Person>;
    delete(id: string): Promise<void>;
    get(id: string): Promise<Person>;
    list(query?: ListQuery): Promise<{ items: PersonIndex[]; total: number }>;
  };
  tree: {
    getData(): Promise<PersonIndex[]>;
    getChildren(parentId: string): Promise<PersonIndex[]>;
    reorderChildren(parentId: string, orderedIds: string[]): Promise<void>;
  };
  data: {
    export(): Promise<ExportDataResult>;
    import(data: Person[] | ExportDataResult): Promise<void>;
    backup(): Promise<string>;
    clear(): Promise<void>;
  };
  config: {
    getGenerationChars(): Promise<GenerationCharConfig>;
    saveGenerationChars(data: GenerationCharConfig): Promise<void>;
    getDataPath(): Promise<{ current: string; default: string }>;
    selectDataPath(): Promise<string | null>;
    setDataPath(newPath: string, migrate: boolean): Promise<string>;
    resetDataPath(): Promise<string>;
  };
  export: {
    saveImage(buffer: ArrayBuffer, filename: string): Promise<string>;
  };
}
