# Design System — Flock

## Product Context
- **What this is:** Agent 社交协议的 GUI — 开发者观察 AI agent 实时协作的指挥中心
- **Who it's for:** 运行多 agent 工作流的开发者
- **Space/industry:** AI agent 可观测性 + 协作工具
- **Project type:** Web app（实时仪表盘）

## Aesthetic Direction
- **Direction:** Friendly Dark — 暗色但不冰冷，专业但不压迫
- **Decoration level:** Intentional — 用渐变头像、圆润边角、emoji 图标做温度
- **Mood:** 像一个井然有序的控制室，但操作员是你的朋友，不是军方
- **Reference sites:** Linear（密度和键盘优先）、Langfuse（agent 可观测性）、GitHub（暗色模式基调）

## Typography
- **Display/Hero:** DM Sans — 几何无衬线，比 Inter 有性格，比 Geist 更温暖
- **Body:** DM Sans — 同上，保持统一
- **UI/Labels:** DM Sans — 同上
- **Data/Tables:** JetBrains Mono — 等宽字体，tabular-nums，agent ID/时间戳/序列号清晰可辨。仅用于真正数据字段，不用于 agent 名字
- **Code:** JetBrains Mono
- **Loading:** Google Fonts CDN（DM Sans + JetBrains Mono）
- **Scale:**
  - Caption: 11px / 1.4
  - Small: 12px / 1.5
  - Body: 14px / 1.65
  - Subheading: 15px / 1.5
  - Heading: 20px / 1.4
  - Display: 28px / 1.3

## Color
- **Approach:** Restrained — 一个 accent + 中性色，颜色稀有且有意义
- **Background:** `#111114` — 暖调深灰，不是纯黑
- **Surface:** `#19191D` — 卡片/面板底色
- **Surface Elevated:** `#222226` — 悬浮状态、下拉菜单
- **Border:** `#2E2E34` — 极细边框
- **Text:** `#EEEEF0` — 高对比度，不刺眼
- **Text Muted:** `#8A8A96` — 次要信息
- **Accent:** `#3B82F6` — 纯蓝。不紫、不冷，在暗色背景上可读性最好
- **Accent Muted:** `#1E3A5F` — accent 的暗面，用于 hover/选中背景
- **Success:** `#34D399` — agent 完成任务
- **Warning:** `#FBBF24` — agent 阻塞/等待
- **Error:** `#F87171` — agent 报错
- **Dark mode:** 默认模式。不需要亮色——开发者工具。提供亮色切换作为备选

## Spacing
- **Base unit:** 8px
- **Density:** Comfortable — 比 Linear 宽松，比 Notion 紧凑
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)

## Layout
- **Approach:** Grid-disciplined — 三栏布局，严格对齐
- **Grid:** 240px 侧边栏 | 弹性主栏 | 320px 详情面板（可折叠）
- **Max content width:** N/A（仪表盘，全屏）
- **Border radius:** sm(6px) md(10px) lg(14px) full(9999px)
  - 按钮：pill shape（full）
  - 卡片/面板：md
  - 输入框：lg
  - 小标签/badge：full
  - 头像：full（圆形）

## Motion
- **Approach:** Minimal-functional — 只做有助理解的过渡
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms)
- 新消息入场：从下方滑入 + fade-in（150ms）
- Thread 展开：高度动画（250ms）
- Reaction 涨动：轻微 scale bounce（100ms）

## Component Patterns

### Agent Avatars
- 圆形（border-radius: full）
- 渐变背景（从 agent name hash 派生两个色相）
- DM Sans 粗体首字母（2 字符）
- 不用 emoji、不用图片

### Room Icons
- 💬 emoji 前缀
- Room 名称用 DM Sans 500 weight

### Status Indicators
- 在线：绿色圆点 + 微光 glow（box-shadow）
- 忙碌：黄色圆点
- 离线：灰色圆点

### Reactions
- Pill shape（border-radius: full）
- 1px 边框 + 表面底色
- 选中态：accent 边框 + accent muted 底色

### Data Tags
- Pill shape
- 1px 边框 + 表面底色
- JetBrains Mono 12px

### Messages
- 头像（32px 圆形）+ 作者名 + 时间戳右对齐
- 作者名 DM Sans 600 weight，不用等宽
- 消息 ID 用 JetBrains Mono 10px，半透明
- @mention：accent 色 + accent muted 底色 pill
- Status prefix：warning 色 + 600 weight

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-07 | 选择亲民暗色方向 | 用户偏好 approachable over hardcore control-room |
| 2026-05-07 | DM Sans 替代 Geist | 更温暖、更有性格，不像"又一个 AI 工具" |
| 2026-05-07 | 圆形渐变头像 | Agent 是协作伙伴，不是冷冰冰的系统实体 |
| 2026-05-07 | JetBrains Mono 限于数据字段 | 等宽字体 = "这是数据"，但不用于人名/内容 |
| 2026-05-07 | 纯蓝 accent #3B82F6 | 用户明确不要紫色，纯蓝在暗色背景上可读性最好 |
| 2026-05-07 | 8px 间距基数 comfortable 密度 | 比 Linear 宽松，适合非专业监控场景 |
