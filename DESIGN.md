# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-05-21 (v2 整页重做)
- Primary product surfaces: 本地 Gateway 管理页（`public/index.html`）
- Evidence reviewed: `public/styles.css`, `public/index.html`, `public/app.js`, `README.md`

## Brand
- Personality: 本地基础设施控制台 — 冷静、精确、可信赖，偏开发者工具而非消费级 SaaS
- Trust signals: 清晰层级、对齐网格、可读等宽地址、即时保存反馈
- Avoid: 过度霓虹光晕、卡片大幅上浮、杂乱渐变、过多紫色发光

## Product goals
- Goals: 快速配置上游渠道；复制连接入口；一眼看清运行/保存状态
- Non-goals: 营销落地页、复杂动效、多主题切换
- Success signals: 字段对齐规整；默认可辨识；操作无需手动保存

## Personas and jobs
- Primary personas: 在本机跑 Gateway 的开发者 / Agent 用户
- User jobs: 增删渠道、填 URL/Key、维护模型列表、复制 API 地址给各 AI 工具
- Key contexts of use: 桌面浏览器、窄窗调试、长时间盯屏

## Information architecture
- Primary navigation: 单页 — 概览（连接入口 + 统一 Key）→ 模型渠道列表
- Core routes/screens: `/` 管理页
- Content hierarchy: 全局状态 → 连接信息 → 渠道卡片网格

## Design principles
- 对齐优先：8px 间距基准，标签与控件左对齐
- 克制对比：背景分层用边框与浅填充，不靠强阴影
- 默认可识别：模型列表第一项即默认，紫色描边仅作轻提示
- 状态可见：运行/保存/错误在顶栏持续可读

## Visual language
- Color: 锌灰底 `#09090b`；表面 `#111114` / `#18181c`；边框 `#27272a`；主色 `#4f46e5`；细网格背景
- Typography: UI 用 Inter；URL/模型 ID 用 ui-monospace；标题 20px/600，标签 11px/500 uppercase tracking
- Spacing/layout rhythm: 4/8/12/16/20/24/32；页面 max-width 1200px 居中
- Shape/radius/elevation: 卡片 12px 圆角；输入/按钮 8px；无 hover 位移
- Motion: 仅 focus/切换 150ms ease；背景静态微渐变
- Imagery/iconography: 无图标库；用文字标签与圆点状态

## Components
- Panel: 概览区、渠道卡片
- Entry row: 协议标签 + 等宽 URL + 复制
- Channel card: 顶栏（名称/测试/开关/删）+ 双列输入 + 模型双列网格
- Inputs: 统一高度 36px，focus ring 靛蓝
- Buttons: primary 填充、secondary 描边、ghost 图标
- Toggle: 32×18 紧凑开关

## Accessibility
- Target standard: 键盘可操作表单；对比度 WCAG AA 尽力
- Keyboard/focus: 可见 focus ring
- Contrast/readability: 正文 `#e2e8f0`，次要 `#94a3b8`
- Screen-reader semantics: `aria-label` 保留在 section
- Reduced motion: 无必需动画

## Responsive behavior
- Breakpoints: `<768px` 单列卡片、入口纵向堆叠
- Layout adaptations: 渠道卡片 min-width 100%
- Touch: 按钮最小点击区 32px

## Interaction states
- Loading: 顶栏「正在读取…」
- Empty: 虚线空状态卡片
- Error: 保存失败/测试失败红色文案
- Success: 测试成功绿色；已自动保存靛蓝提示
- Disabled: 渠道关闭时卡片整体降透明度

## Content voice
- Tone: 简短中文技术说明
- Terminology: 渠道、连接入口、统一 API Key、默认模型
- Microcopy: 占位符说明用途，避免感叹号

## Implementation constraints
- Framework/styling system: 纯 HTML/CSS/JS，无构建链
- Design-token constraints: CSS 变量于 `:root`
- Performance: 无外部字体阻塞可选；当前 Inter from Google Fonts
- Compatibility: 现代 Chromium/Safari
- Test/screenshot: 浏览器目测 + 本地 7080

## Open questions
- [ ] 是否需要浅色主题 /  owner: 用户 / impact: 低
