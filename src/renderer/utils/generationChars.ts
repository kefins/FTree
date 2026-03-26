/**
 * 辈分字（字辈/派语）管理模块
 * - 数据持久化在后端加密文件中（family_meta.enc）
 * - 前端通过 API 读取/保存，并维护内存缓存供组件即时查询
 */

import { api } from '../api/bridge';
import type { GenerationCharConfig } from '../types/person';

/** 内存缓存：避免每次渲染都请求后端 */
let cachedConfig: GenerationCharConfig | null = null;

/** 加载辈分字配置（从后端读取，并缓存到内存） */
export async function loadGenerationChars(): Promise<GenerationCharConfig> {
  try {
    const data = await api.config.getGenerationChars();
    cachedConfig = data;
    return data;
  } catch {
    // 未登录或其他错误，返回空配置
    return { characters: {} };
  }
}

/** 保存辈分字配置到后端 */
export async function saveGenerationChars(config: GenerationCharConfig): Promise<void> {
  await api.config.saveGenerationChars(config);
  cachedConfig = config;
}

/** 获取当前缓存的辈分字配置（同步方法，需先调用 loadGenerationChars） */
export function getCachedGenerationChars(): GenerationCharConfig {
  return cachedConfig || { characters: {} };
}

/** 获取指定世数的辈分字（从缓存中读取），无则返回空字符串 */
export function getCharForGeneration(generation: number): string {
  if (!cachedConfig) return '';
  return cachedConfig.characters[generation] || '';
}

/** 从字辈诗自动解析逐世辈分字（按单字拆分，从第 startGeneration 世开始） */
export function parsePoemToCharacters(
  poem: string,
  startGeneration: number = 1,
): Record<number, string> {
  const chars: Record<number, string> = {};
  // 去除空白和标点符号
  const cleaned = poem.replace(/[\s,，.。、；;！!？?：:""''（）()《》\-—\r\n]/g, '');
  for (let i = 0; i < cleaned.length; i++) {
    chars[startGeneration + i] = cleaned[i];
  }
  return chars;
}

/** 清除内存缓存 */
export function clearGenerationCharsCache(): void {
  cachedConfig = null;
}
