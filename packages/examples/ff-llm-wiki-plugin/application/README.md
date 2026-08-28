# LLM Wiki · 工业知识库

面向企业资料的企业知识库演示项目（LLM Wiki / 编译式知识库 / 知识图谱），已打通一条完整链路：

**128 份演示资料 → 18 份原始资料经确定性编译 → 47 个 Wiki 页（98 来源引用 / 99 互链 / 6 主题）→
本地规则抽取 75 节点 / 291 边知识图谱（G6 聚类图 + 结构视图）→ 可溯源问答（SQLite 证据检索 +
DeepSeek 受约束生成 + SSE 流式 + 引用联动）→ 16 题可复现问答评估（总分 93.4）。**

知识图谱仍采用本地确定性规则；问答采用 **SQLite 检索 + DeepSeek 生成式 RAG**，模型只能消费本次命中的证据，故障时明确标注并回退到可追溯的本地结果。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 工作区 | pnpm workspace（Node.js 24+） |
| 前端 `apps/web` | Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · AntV G6 · react-markdown / remark-gfm |
| 后端 `apps/api` | Fastify 5 · TypeScript · better-sqlite3 |
| 共享契约 `packages/contracts` | 前后端共享类型 + 结构一致的演示数据 |

## 目录结构

```
LLMWikiReproduction/
├── apps/
│   ├── api/                 # Fastify API（health / overview / documents / wiki / graph / qa / evaluation）
│   │   ├── src/
│   │   │   ├── index.ts     # 入口（监听端口）
│   │   │   ├── server.ts    # buildServer()（便于测试注入）
│   │   │   ├── config.ts    # 环境变量配置
│   │   │   ├── routes/      # 路由（health / overview / documents / wiki / graph / qa / evaluation）
│   │   │   ├── wiki/        # 编译式 Wiki（compiler / service / cli / lock / paths）
│   │   │   ├── graph/       # 图谱抽取（extractor / service / cli / paths）
│   │   │   ├── qa/          # 可溯源问答（SQLite 检索 + DeepSeek + 流式 SSE）
│   │   │   ├── eval/        # 可复现评估（题库 + 评估器 + 回归 + 契约/可复现自检）
│   │   │   └── data/        # 数据层（repository 接口 + SQLite）
│   │   └── test/            # node:test 接口测试（49 例）
│   └── web/                 # Next.js 知识工作台
│       └── src/
│           ├── app/         # / 工作台 + documents / wiki / knowledge-graph / ask / evaluation / settings 路由
│           ├── components/  # 侧边栏、顶栏、统计卡、图谱画布、问答面板、评估面板等
│           │   ├── G6KnowledgeGraph.tsx # G6 聚类图（聚类、搜索、筛选、节点联动）
│           │   ├── GraphCanvas.tsx   # 结构视图（原生 SVG，点击/跳转/筛选）
│           │   └── GraphView.tsx     # 双视图容器 + 节点详情面板
│           └── lib/         # API 读取（含演示数据兜底）、导航配置、问答流式客户端
├── packages/
│   └── contracts/           # 共享类型与演示数据（编译为 dist）
├── content/                 # 编译式 Wiki 三层结构
│   ├── CLAUDE.md            # 规则层（页面类型 / 命名 / wikilink 前缀约定）
│   ├── raw/                 # 源层（18 份企业演示资料，只读、不可变）
│   └── wiki/                # 产物层（47 个知识页 + index.md + log.md + manifest.json）
├── output/                  # 图谱 + 评估产物层（kg_*.json + eval/*.json）
├── scripts/                 # eval-qa.mjs（评估编排入口）
├── docs/
│   ├── handoff.md           # 最终交接文档（启动/端口/验证/边界/commit）
│   └── verification/screenshots/final/   # 最终验收截图（28 张系统图 + 1 张 DSH 插件证据）
├── tsconfig.base.json
├── .env.example
└── README.md
```

## 快速开始

> 需要 Node.js 24+ 与 pnpm。

```bash
# 1. 安装依赖（会建立 workspace 软链）
pnpm install

# 2. 启动开发（API:4000 + Web:3000，契约包自动先编译）
pnpm dev
```

启动后访问：

- 前端知识工作台：<http://localhost:3000>
- API 健康检查：<http://localhost:4000/health>
- API 首页总览：<http://localhost:4000/api/overview>

> 首页先以演示数据渲染保证首屏非空白，随后前端会优先读取 API，成功后替换为实时数据；
> API 未启动或不可用时自动回退为同结构的演示数据，并在页面右上角标注「演示数据 · 兜底」。

### 隔离端口启动（避免与其他本机项目冲突）

默认 3000/4000 若被占用，可用 3300/4400 起两终端。**关键：前端的 `NEXT_PUBLIC_API_URL`
必须与 API 的 `PORT` 对齐**（前端 API_BASE 默认 fallback 是 `http://localhost:4000`，不对齐会卡「加载中」）。

```bash
# 终端 1：API 监听 4400，并从凭证中心加载 DeepSeek
PORT=4400 DEEPSEEK_CREDENTIALS_PATH=/absolute/path/to/.credentials.yaml pnpm --filter @llmwiki/api dev

# 终端 2：Web 监听 3300，并让前端走 4400 的 API
cd apps/web && NEXT_PUBLIC_API_URL=http://127.0.0.1:4400 pnpm dev -p 3300
```

然后浏览器打开 <http://127.0.0.1:3300>。dev 资源允许经 `127.0.0.1` 直连（见 `apps/web/next.config.ts` 的 `allowedDevOrigins`）。

## 统一脚本（在根目录执行）

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 并行启动 API 与 Web 开发服务 |
| `pnpm build` | 依次构建 contracts → api → web（产出可部署产物） |
| `pnpm typecheck` | 全工作区类型检查 |
| `pnpm test` | 运行接口测试（API 的 node:test，49 例） |
| `pnpm wiki:compile` | 确定性编译：18 份 raw 源 → 47 个 wiki 知识页（不改 raw） |
| `pnpm graph:extract` | 图谱抽取：从真实编译产物确定性生成 output/ 节点与边（本地规则，无模型） |
| `pnpm eval:qa` | 可复现问答评估：基线与优化两轮 + 回归对比 + 契约/可复现自检 |

也可以进入单个包执行（如 `pnpm --filter @llmwiki/api dev`）。

## 知识图谱（本地规则抽取演示模式）

> ⚠️ 本阶段为**本地规则抽取演示模式**：不调用大模型、不联网、不引入任何网络依赖。
> 节点与边全部由本地确定性规则从编译产物（`content/wiki/manifest.json`、Wiki 页面 frontmatter / 正文标题 /
> 来源证据 / `[[wiki/...]]` 内链）抽取而来。

- 产物：`output/kg_nodes.json`（75 节点）＋ `output/kg_edges.json`（291 边）＋ `output/kg_meta.json`（抽取元信息）
- 节点四类：`PAGE` 知识页（47）· `SOURCE` 来源文档（18）· `TOPIC` 主题（6）· `PAGE_TYPE` 页面类型（4）
- 边四类语义：`LINKS_TO` 内链（99）· `HAS_SOURCE` 来源（98）· `HAS_TOPIC` 主题（47）· `HAS_TYPE` 类型（47）
- 数据契约：节点必含 `id/name/type/source_doc/char_start/char_end/confidence/page`；边必含 `source/target/relation/doc_id/page`。
  基础字段 `relation` 恒为 `CO_OCCURS_IN`（兼容 Skill 检查器），更具体语义存到可选扩展字段 `semantic`。
  无孤儿边、无自环、按 `(name.lower(), type)` 去重，低质量对齐不会进入结果。
- API：`GET /api/graph`（概览）· `GET /api/graph/nodes`（节点列表，可按 `type` 筛选）·
  `GET /api/graph/edges`（边列表，可按 `semantic` 筛选）· `POST /api/graph/extract`（重新抽取，真实重跑并更新生成时间）。
  所有统计均从真实输出文件实时计算，不散落硬编码数字。
- `/knowledge-graph` 双视图：
  - **G6 聚类图**（`@antv/g6`）：按业务主题形成六组聚类，节点大小体现连接度、颜色体现类型，支持拖拽、缩放、
    聚类复位、适配全图、搜索、类型/关系筛选和点击聚焦一跳邻居；
  - **结构视图**（原生 SVG）：确定性分层布局，支持搜索定位、按类型显隐、拖拽缩放、点击节点看详情、跳转 `/wiki?slug=…`。

产物自检（随包 Skill 的验收器）：

```bash
python3 .agents/skills/rag-graphrag-pack/scripts/check_kg_output.py --dir output/
```

## 环境变量

复制根目录 `.env.example` 为 `.env` 后按需修改，本地开发可全部留空（程序内置安全默认值）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4000` | API 监听端口 |
| `HOST` | `0.0.0.0` | API 监听地址 |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | 前端访问 API 的地址（隔离端口启动时务必对齐 `PORT`） |
| `DATABASE_PATH` | `./data/llmwiki.db` | SQLite 数据库路径（文档、知识页与证据片段持久化） |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek API Key；只在 API 服务端读取 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek OpenAI 兼容 API 地址 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | 默认模型，可设为 `deepseek-v4-pro` |
| `DEEPSEEK_CREDENTIALS_PATH` | 空 | 可选凭证中心 YAML；读取 `api_keys.deepseek` |

## 已完成与边界

**已完成（本轮验收通过）**

- pnpm workspace 工程底座 + 统一 dev / build / typecheck / test / wiki:compile / graph:extract / eval:qa 脚本
- Fastify API：`/health`、`/api/overview`、`/api/documents*`、`/api/wiki*`、`/api/graph*`、`/api/qa*`、`/api/evaluation*`，CORS 已开启
- 资料导入与处理队列：128 份演示资料、PDF / DOCX / Markdown / TXT 真实解析、分段、sha256 去重、阶段进度、状态筛选、更新、删除与重新处理（SQLite 持久化）
- 编译式 Wiki 闭环：`content/` 三层结构 + 确定性编译器 + `/api/wiki*` API + `/wiki` 阅读器（47 页 / 98 引用 / 99 互链 / 6 主题）
- 知识图谱：本地规则抽取 75 节点 / 291 边，G6 聚类图与结构视图双视图，满足 Skill 数据契约
- 可溯源问答（`/ask`）：SQLite 持久化 47 个知识页与 486 个证据片段，DeepSeek V4 Flash / Pro 可配置、真实 Token/耗时、SSE Token 流、Markdown + GFM 渲染、引用联动与故障透明降级
- 系统设置（`/settings`）：前端选择 DeepSeek V4 Flash / Pro 与生成参数，API 服务端托管凭证，并提供真实最小推理验证
- 可复现评估（`/evaluation` + `pnpm eval:qa`）：16 题 7 维评估、固定 EVAL_NOW + 串行 + 每例独立状态、
  检索命中 38%→62%、regressionFree=true、总分 93.4
- 深色知识工作台首页：四张统计卡、最近文档列表、处理进度
- 前端优先读 API、失败回退同结构演示数据的兜底逻辑
- 编译与抽取的跨进程锁：防止并行测试 / CLI / API 同时重建 `content/wiki/` 引发竞态

**边界（明确未实现，不做夸大）**

- 当前检索仍是可复现的字段加权算法，尚未接入 Embedding 向量索引；知识图谱仍是本地规则抽取，并非模型实体抽取
- 无生产级多租户权限、鉴权、容灾与高可用
- 前端无单元测试框架（本轮覆盖 API 接口测试 + 浏览器真机走查）

## 最终验收数字

| 项 | 结果 |
| --- | --- |
| `pnpm eval:qa` | 16 题 · 总分 93.4 · 检索命中 38%→62% · regressionFree=true |
| `pnpm test` | 49 / 49 通过（0 失败） |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过（Next.js 16.3.1 编译成功，8 路由静态生成） |
| 浏览器真机验收 | 工作台 → 文档 → Wiki → 知识图谱 → 智能问答 → 评估 → 设置全链路通过，真实 DeepSeek 问答与模型验证成功 |

验收截图见 `docs/verification/screenshots/final/`（28 张系统图 + 1 张 DSH 插件证据）；交接文档见 `docs/handoff.md`。
