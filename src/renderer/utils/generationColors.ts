/**
 * 世代颜色配置模块
 * - 提供 20 世的默认配色方案
 * - 支持 localStorage 持久化自定义颜色
 */

export interface GenerationColorItem {
  /** 节点背景色 */
  bg: string;
  /** 节点边框色 */
  border: string;
  /** 文字色 */
  text: string;
  /** 标签色（用于 Ant Design Tag） */
  tag: string;
}

// 20 世默认配色 - 选用柔和、有层次感的色彩
const DEFAULT_COLORS: GenerationColorItem[] = [
  { bg: '#e8f5e9', border: '#2e7d32', text: '#1b5e20', tag: '#2e7d32' },  // 1世 - 翠绿
  { bg: '#e3f2fd', border: '#1565c0', text: '#0d47a1', tag: '#1565c0' },  // 2世 - 靛蓝
  { bg: '#fff3e0', border: '#e65100', text: '#bf360c', tag: '#e65100' },  // 3世 - 橙色
  { bg: '#f3e5f5', border: '#7b1fa2', text: '#4a148c', tag: '#7b1fa2' },  // 4世 - 紫色
  { bg: '#e0f2f1', border: '#00695c', text: '#004d40', tag: '#00695c' },  // 5世 - 青色
  { bg: '#fce4ec', border: '#c62828', text: '#b71c1c', tag: '#c62828' },  // 6世 - 红色
  { bg: '#e8eaf6', border: '#283593', text: '#1a237e', tag: '#283593' },  // 7世 - 深蓝
  { bg: '#f1f8e9', border: '#558b2f', text: '#33691e', tag: '#558b2f' },  // 8世 - 草绿
  { bg: '#fff8e1', border: '#f9a825', text: '#f57f17', tag: '#f9a825' },  // 9世 - 金色
  { bg: '#ede7f6', border: '#4527a0', text: '#311b92', tag: '#4527a0' },  // 10世 - 深紫
  { bg: '#e0f7fa', border: '#00838f', text: '#006064', tag: '#00838f' },  // 11世 - 蓝绿
  { bg: '#fbe9e7', border: '#d84315', text: '#bf360c', tag: '#d84315' },  // 12世 - 深橙
  { bg: '#e1f5fe', border: '#0277bd', text: '#01579b', tag: '#0277bd' },  // 13世 - 天蓝
  { bg: '#f9fbe7', border: '#9e9d24', text: '#827717', tag: '#9e9d24' },  // 14世 - 黄绿
  { bg: '#fce4ec', border: '#ad1457', text: '#880e4f', tag: '#ad1457' },  // 15世 - 玫红
  { bg: '#e8f5e9', border: '#388e3c', text: '#2e7d32', tag: '#388e3c' },  // 16世 - 绿色
  { bg: '#e3f2fd', border: '#1976d2', text: '#1565c0', tag: '#1976d2' },  // 17世 - 蓝色
  { bg: '#fff3e0', border: '#ef6c00', text: '#e65100', tag: '#ef6c00' },  // 18世 - 琥珀
  { bg: '#f3e5f5', border: '#8e24aa', text: '#6a1b9a', tag: '#8e24aa' },  // 19世 - 亮紫
  { bg: '#e0f2f1', border: '#00897b', text: '#00695c', tag: '#00897b' },  // 20世 - 碧绿
];

const STORAGE_KEY = 'ftree_generation_colors';

/** 获取所有世代颜色配置（合并默认与自定义） */
export function getGenerationColors(): GenerationColorItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as GenerationColorItem[];
      // 用存储的覆盖默认，不足的用默认补齐
      return DEFAULT_COLORS.map((def, i) => parsed[i] || def);
    }
  } catch {
    // ignore
  }
  return [...DEFAULT_COLORS];
}

/** 保存自定义世代颜色 */
export function saveGenerationColors(colors: GenerationColorItem[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
}

/** 重置为默认颜色 */
export function resetGenerationColors(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** 获取指定世数的颜色，超出范围则循环取色 */
export function getColorForGeneration(generation: number): GenerationColorItem {
  const colors = getGenerationColors();
  const index = ((generation - 1) % colors.length + colors.length) % colors.length;
  return colors[index];
}

/** 获取默认颜色列表（不含自定义修改） */
export function getDefaultColors(): GenerationColorItem[] {
  return [...DEFAULT_COLORS];
}

/**
 * 将 hex 颜色与另一颜色按比例混合
 * ratio=0 返回 color1, ratio=1 返回 color2
 */
function mixHexColor(hex1: string, hex2: string, ratio: number): string {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * ratio);
  const g = Math.round(g1 + (g2 - g1) * ratio);
  const b = Math.round(b1 + (b2 - b1) * ratio);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * 根据性别微调世代颜色
 * - 男性：保持原色不变
 * - 女性：背景偏粉暖色调，边框和文字也做柔和调整
 */
export function getGenderedColor(
  baseColor: GenerationColorItem,
  gender: 'male' | 'female',
): GenerationColorItem {
  if (gender === 'male') return baseColor;
  // 女性：使用明显偏粉/玫红的色调，与男性形成清晰的视觉对比
  return {
    bg: mixHexColor(baseColor.bg, '#ffe0ec', 0.65),          // 背景强烈偏粉
    border: mixHexColor(baseColor.border, '#d4237a', 0.50),   // 边框偏玫红
    text: mixHexColor(baseColor.text, '#9e1068', 0.40),       // 文字偏玫红
    tag: mixHexColor(baseColor.tag, '#d4237a', 0.50),
  };
}
