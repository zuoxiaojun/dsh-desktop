# DSH Desktop 设计文档

> 基于 DeepSeek Harness Studio（赋范空间）的 Fork 改造项目

## 1. 项目定位

### 1.1 项目名称

- **项目名**: `dsh-desktop`
- **产品名**: DSH Desktop
- **npm scope**: `@dsh-desktop/*`（待定）
- **appId**: `com.dsh.desktop`（待定）

### 1.2 与上游的关系

```
deepseek-ai/deepseek-harness  ← 官方 Harness 核心
         ↓ fork
fufankeji/deepseek-harness-studio  ← 赋范空间 Studio（Electron 桌面壳 + 插件中心 + Preset 广场）
         ↓ fork
dsh-desktop  ← 我们自己的桌面版
```

**同步策略**（沿用 Studio 的策略）：

- 上游核心（`packages/*` + `vendor/*`）保持官方原样
- 只合并上游的 **release tag**（不追 master）
- 自有功能集中在 `apps/desktop/` 层
- 通过 `apps/desktop/package.json` 独立管理桌面版本号

### 1.3 品牌合规

依据 DeepSeek Harness 的品牌使用规范（`BRAND_GUIDELINES.md`）：

- 可以使用"基于 DeepSeek Harness 构建"等描述性文字
- 建议使用缩写 **"DSH"** 命名
- 避免直接使用完整 **"DeepSeek Harness"** 商标做项目名
- 避免使用官方品牌素材造成官方背书的误导

## 2. 架构概览

```
dsh-desktop/
├── apps/
│   ├── cli/             # dsh CLI（保持官方原样，仅做必要适配）
│   ├── desktop/         # ★ 我们的核心：Electron 桌面应用
│   └── web/             # Web 前端（保持官方原样，仅做必要适配）
├── packages/            # ~58 个 @deepseek-ai/dsh-* 包（保持官方原样）
│   ├── core/            # 产品 API 脊柱
│   ├── client/          # 客户端 UI 组件
│   ├── host/            # Host 服务端
│   ├── plugin-center/   # 插件中心合约
│   └── ...
├── vendor/              # Cordis 框架（vendored，保持官方原样）
├── scripts/             # 构建/检查脚本
├── native/              # 原生模块
└── python/              # Python SDK 运行时
```

### 2.1 改造范围分层

| 层 | 内容 | 策略 |
| --- | --- | --- |
| **L0 - 核心** | `packages/*`, `vendor/*`, `apps/cli/`, `apps/web/` | **保持原样**，不做任何修改 |
| **L1 - 桌面壳** | `apps/desktop/` | **品牌替换** + 配置调整 |
| **L2 - 自有功能** | 插件中心源、Preset 广场源、发布渠道 | **替换为目标环境** |
| **L3 - 增删改** | 默认 Presets、图标、品牌 UI 组件 | **按需定制** |

## 3. 需要修改的文件清单

### 3.1 品牌标识替换（L1）

| 文件 | 当前值 | 目标值 | 说明 |
| --- | --- | --- | --- |
| `apps/desktop/package.json` | `@deepseek-ai/dsh-desktop` | `@dsh-desktop/desktop` | npm 包名 |
| `apps/desktop/package.json` | `"DeepSeek Harness desktop application..."` | `"DSH Desktop application..."` | 描述 |
| `apps/desktop/package.json` | `appId: "ai.deepseek.harness.desktop"` | `com.dsh.desktop` | 系统 appId |
| `apps/desktop/package.json` | `productName: "DeepSeek Harness"` | `DSH Desktop` | 产品名 |
| `apps/desktop/package.json` | `shortcutName: "DeepSeek Harness"` | `DSH Desktop` | 快捷方式名 |
| `apps/desktop/package.json` | `artifactName: "DeepSeek-Harness-Desktop-..."` | `DSH-Desktop-...` | 构建产物名 |
| `apps/desktop/package.json` | `publish.url` | 你自己的 OSS 地址 | 更新渠道 |
| `apps/desktop/src/main.ts` | `APP_NAME = 'DeepSeek Harness'` | `'DSH Desktop'` | 窗口标题 |
| `apps/desktop/src/main.ts` | 文件头注释 | 更新 | 文件头注释 |
| `package.json` (根) | `@deepseek-ai/dsh-root` | `@dsh-desktop/root` | 根包名 |
| `apps/web/package.json` | `@deepseek-ai/dsh-web-frontend` | `@dsh-desktop/web-frontend` | Web 前端包名 |
| `apps/cli/package.json` | `@deepseek-ai/dsh` | `@dsh-desktop/dsh` | CLI 包名 |

### 3.2 外部服务地址替换（L2）

| 文件 | 当前值 | 说明 |
| --- | --- | --- |
| `apps/desktop/package.json` | `publish.url: https://ml2022.oss-cn-hangzhou.aliyuncs.com/...` | 更新频道 → 替换为你的发布地址 |
| `packages/plugin-center/contracts/src/index.ts` | `cdn.deepseek.com`, `static.deepseek.com` | 插件下载 CDN |
| `packages/plugin-center/contracts/src/index.ts` | `PRESET_SQUARE_ORIGIN = 'https://www.dshdesktop.com'` | Preset 广场地址 |
| `apps/desktop/src/plugin-center/catalog-fixture.ts` | `cdn.deepseek.com`, `DeepSeek Harness Fixture` | 测试 fixture |

### 3.3 品牌 UI 组件替换（L1）

| 文件 | 当前内容 | 操作 |
| --- | --- | --- |
| `packages/client/ui-desktop-customization/src/client/BrandBadge.tsx` | "赋范空间出品" + beyondata.com | 替换为你的品牌 |
| `apps/desktop/build/icon.png` | DeepSeek Harness 图标 | 替换为你的图标 |
| `apps/web/src/main.ts` | 可能含 DeepSeek 品牌引用 | 审查后调整 |

### 3.4 预设内容审查（L3）

| 文件 | 说明 |
| --- | --- |
| `apps/desktop/resources/preset-square/presets/fufan-*` | 7 套赋范空间官方 Preset（保留或替换） |
| `apps/desktop/resources/plugin-center/fixtures/` | 测试 fixture |
| `apps/desktop/resources/recovery.*` | 恢复页面资源 |

### 3.5 文档和配置文件审查（L3）

| 文件 | 说明 |
| --- | --- |
| `README.md`, `README.en.md` | 替换为你的项目描述 |
| `BRAND_GUIDELINES.md` | 保留（约束品牌使用规范） |
| `CLAUDE.md`, `AGENTS.md` | 适配你的开发规范 |
| `CONTRIBUTING.md` | 替换为你的贡献指南 |
| `LICENSE` | 保持 MIT（可保留） |
| `.github/` | 替换为你的 CI/CD 配置 |
| `.gitlab-ci.yml` | 替换为你的 CI 配置 |

## 4. 版本策略

| 组件 | 版本方案 |
| --- | --- |
| 核心 Harness | 跟随上游 release tag（当前 `0.1.1-rc.2`） |
| 桌面应用 | 独立版本，从 `0.1.0` 开始 |
| 发布渠道 | 自有 OSS/服务器，不使用 Studio 的阿里云 OSS |

## 5. 开发计划

### Phase 1: 品牌换肤（最小改动）

1. 替换 `apps/desktop/package.json` 中的品牌标识
2. 修改 `main.ts` 中的 `APP_NAME`
3. 替换 `BrandBadge.tsx` 中的品牌信息
4. 替换图标
5. 更新根 `package.json` 的描述

### Phase 2: 配置调整

1. 替换发布渠道 URL
2. 审查并替换外部服务地址
3. 更新文档

### Phase 3: 功能裁剪与增强

1. 审查 Preset 广场内容
2. 调整默认配置
3. 按需增删功能

### Phase 4: 构建验证

1. `pnpm install` 验证依赖安装
2. 构建验证
3. 桌面应用启动验证

## 6. 风险与注意事项

- **npm scope**: 当前所有包使用 `@deepseek-ai/dsh-*` 命名空间。如果改包名，需要同步修改数百个 `package.json` 文件中的引用。建议 **第一阶段不改包名**，只改产品标识层。
- **外部服务依赖**: Preset 广场依赖 `dshdesktop.com`，插件中心依赖 `cdn.deepseek.com`。在自己搭建对应服务前，这些功能会不可用（但桌面核心功能不依赖它们）。
- **上游合并**: 每次合并上游 release tag 后，需要重新验证品牌替换部分没有被上游覆盖。
- **Electron 版本**: 当前 `electron@43.4.0`，需要确认兼容性。
