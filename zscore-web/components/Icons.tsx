// components/Icons.tsx — 内联 SVG 图标集
// 背景：此前界面用 emoji（柱状图 / 包裹箱 / 电源插头 / 机器人 / 沙漏 / 灯泡 /
// 警告三角 / 对勾 / 叉号）当功能图标，跨平台字形不一致、字号与基线不可控，
// 且属于设计规则里明确禁止的用法。此处统一改为内联 SVG：
// 单色（stroke: currentColor）、可随 className 控制尺寸、随文字颜色自适应。
// 纯函数组件，无 hooks —— server component 与 client component 均可直接引用。

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
};

/** 柱状图 —— 首页「最近分析」空状态 */
export function IconChart({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <line x1="4" y1="20" x2="20" y2="20" />
      <rect x="6" y="12" width="3" height="8" rx="0.6" />
      <rect x="10.5" y="8" width="3" height="12" rx="0.6" />
      <rect x="15" y="4" width="3" height="16" rx="0.6" />
    </svg>
  );
}

/** 包裹箱 —— 供应商库空状态 */
export function IconPackage({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M21 8.5 12 3.5 3 8.5v7L12 20.5l9-5v-7Z" />
      <path d="M3 8.5 12 13.5l9-5" />
      <path d="M12 13.5v7" />
    </svg>
  );
}

/** 加载中 —— 配合 animate-spin 使用 */
export function IconSpinner({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />
    </svg>
  );
}

/** 机器人 —— AI 分析入口 */
export function IconRobot({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V5.4" />
      <circle cx="12" cy="4.2" r="1.2" />
      <circle cx="9.2" cy="13" r="1.1" />
      <circle cx="14.8" cy="13" r="1.1" />
      <path d="M9.5 16.4h5" />
      <path d="M2.6 12v3M21.4 12v3" />
    </svg>
  );
}

/** 灯泡 —— AI 依据 / 证据 */
export function IconBulb({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9.5 18h5" />
      <path d="M10.5 21h3" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.9 1 1 1.7l.1.5h5l.1-.5c.1-.7.5-1.3 1-1.7A6 6 0 0 0 12 3Z" />
    </svg>
  );
}

/** 警告三角 —— 风险 / 未配置提示 */
export function IconWarn({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10.3 4.3 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <line x1="12" y1="9.5" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 电源插头 —— 测试连接 */
export function IconPlug({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 3.5v5M15 3.5v5" />
      <path d="M6.5 8.5h11v3.2a5.5 5.5 0 0 1-11 0V8.5Z" />
      <path d="M12 17.5V21" />
    </svg>
  );
}

/** 对勾 —— 成功状态 */
export function IconCheck({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 12.5 9.7 17.2 19 6.8" />
    </svg>
  );
}

/** 叉号 —— 失败状态 */
export function IconX({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
    </svg>
  );
}
