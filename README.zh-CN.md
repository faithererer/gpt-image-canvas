# GPT Image Canvas

[English](README.md) | [简体中文](README.zh-CN.md)

GPT Image Canvas 是一个本地优先的 AI 图像画布，支持文生图、参考图生成和多步骤 Agent 规划。项目基于 tldraw、Hono、SQLite 和 GPT Image 2 构建，适合在本机完成创作、管理历史和保存生成资产。

## 效果图

![GPT Image Canvas 效果图](docs/assets/app-preview.png)

## 能做什么

- 在 tldraw 画布上生成、摆放和管理 AI 图像。
- 支持文本提示词生成，也支持选中画布图片作为参考图生成。
- 默认将项目快照、生成历史和生成资产保存在本地。
- 支持从 `.env`、应用内配置弹窗或 Codex 登录中选择生成服务。
- 右侧 Agent Tab 可以把多图需求规划成计划节点，再按依赖关系执行生图任务。
- 可选启用腾讯云 COS 或 Cloudflare R2 / S3-compatible，将新生成图备份到云端。
- Gallery 支持查看本地作品，并提供定位、重跑、下载和上传状态。

## 环境要求

- Node.js `24.15.0`。仓库包含 `.nvmrc` 和 `.node-version`。
- pnpm `9.14.2`。版本已固定在 `package.json`。
- 可访问 `gpt-image-2` 的 OpenAI API key、OpenAI 兼容图像端点，或在应用内完成的 Codex 登录。
- Docker Desktop 或兼容 Docker Engine，仅 Docker 工作流需要。

如果需要启用固定 pnpm 版本：

```sh
corepack prepare pnpm@9.14.2 --activate
```

## 快速开始

Windows PowerShell：

```powershell
pnpm install
Copy-Item .env.example .env
pnpm dev
```

macOS/Linux：

```sh
pnpm install
cp .env.example .env
pnpm dev
```

打开 [http://localhost:5173](http://localhost:5173) 使用 Web 应用。

`pnpm dev` 会同时启动两个本地服务：

- API：[http://127.0.0.1:8787](http://127.0.0.1:8787)
- Web：[http://localhost:5173](http://localhost:5173)，并将 `/api` 代理到 API 服务

应用可以在没有凭证的情况下启动。没有可用 provider 时，`/` 会显示凭据感知首页，生图请求会返回 `missing_provider`，直到你配置好生成服务。

## 配置生成服务

默认 provider 优先级是：

1. `.env` 或运行时环境变量中的 OpenAI 兼容配置。
2. 应用内保存的本地 OpenAI 兼容配置。
3. Codex 登录兜底。

最简单的 API Key 配置方式是编辑 `.env`：

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_TIMEOUT_MS=1200000
CODEX_RESPONSES_MODEL=gpt-5.5
```

使用官方 OpenAI API 时留空 `OPENAI_BASE_URL`。如果使用其他 OpenAI 兼容服务，将它设置为兼容的 `/v1` 端点；如果该端点需要不同的图像模型名，修改 `OPENAI_IMAGE_MODEL`。
使用 Codex 登录时，`CODEX_RESPONSES_MODEL` 控制 ChatGPT OAuth 桥接使用的主 Responses 模型；`OPENAI_IMAGE_MODEL` 仍然是传给图像生成工具的图像模型。

`VITE_TLDRAW_LICENSE_KEY` 留空时，画布会在 localhost/HTTP 上使用 tldraw 官方支持的开发模式。需要 tldraw hobby 或 commercial 授权的部署，请在执行 `pnpm build` 前设置 `VITE_TLDRAW_LICENSE_KEY`（Docker 部署时作为构建参数传入）。该值会嵌入公开的 Web bundle，修改后必须重新构建。GHCR 发布工作流会读取可选的仓库 secret `TLDRAW_LICENSE_KEY`。

也可以打开右上角 `配置` 弹窗，保存一个本地 OpenAI 兼容 provider。本地 key 会存储在 `DATA_DIR` 下的 SQLite 数据库中，读取时只返回掩码，并会一直保留到你输入新 key 替换它。

## 路由说明

- `/` 是凭据感知首页。没有 provider 时会提供 `Codex 登录` 和 `接入 API`。
- `/canvas` 是画布工作区。没有 provider 时会返回 `/`。
- `/pool` 是内置提示池，用于浏览、搜索、收藏、复制和复用精选提示词。
- `/gallery` 始终可访问，方便在没有凭证时查看本地作品。

Provider 弹窗中的环境变量是只读的。修改 `.env` 后，需要重启 API 或 Docker 容器。

## 使用画布

右侧面板有两个主要流程：

- `Manual`：输入提示词，选择尺寸、质量和格式后生成。选中一张图片形状时，会切换到参考图生成。
- `Agent`：描述一个多图任务，可选中最多 3 张画布图片作为参考；确认生成的计划节点后执行。

Agent 规划使用独立于图像 provider 的 OpenAI 兼容聊天配置。请在 Agent LLM 设置中保存 API Key、Base URL、模型、超时和 `supportsVision`。

开启 `supportsVision` 时，选中的图片会作为多模态输入传给规划模型。关闭时，选中图片只作为后续生图的 reference handle，Agent 不应声称自己看过图片内容。当前版本不持久化 Agent 对话消息；刷新页面会清空对话，但已经落在画布上的计划节点会随普通 canvas snapshot 保存。

计划执行按 DAG 调度。互不依赖的 job 可以并发运行；引用上游生成图的 job 会等待依赖完成；`Retry failed` 会只重跑失败或被阻塞的 job，并保留已成功的上游输出。单个计划最多生成 16 张图，包含中间锚点图。

## 云端备份

生成图始终先保存到本地。启用应用内腾讯云 COS 或 Cloudflare R2 / S3-compatible 配置后，新生成图还会上传到：

```text
<key-prefix>/YYYY/MM/<assetId>.<ext>
```

COS 字段默认值来自：

- `COS_DEFAULT_BUCKET`
- `COS_DEFAULT_REGION`
- `COS_DEFAULT_KEY_PREFIX`

R2 / S3 字段默认值来自：

- `S3_DEFAULT_BUCKET`
- `S3_DEFAULT_REGION`
- `S3_DEFAULT_KEY_PREFIX`
- `R2_DEFAULT_ACCOUNT_ID`
- `S3_DEFAULT_ENDPOINT`

保存云存储配置前会执行一次测试上传和删除。provider secret 会存储在本地 SQLite 中，读取配置时只返回掩码。云端上传失败不会导致生图失败；图片仍可从本地读取，历史记录会显示上传失败状态。

## 项目结构

```text
apps/api         Hono API、SQLite 存储、provider 选择、Agent 规划与执行
apps/web         Vite + React + tldraw Web 应用
packages/shared  共享契约和常量
docs             项目文档和预览素材
data             本地运行时数据，已被 Git 忽略
```

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 同时启动 API 和 Web 开发服务。 |
| `pnpm api:dev` | 启动 API 开发流程。 |
| `pnpm web:dev` | 启动 Vite Web 开发流程。 |
| `pnpm typecheck` | 检查 shared、web 和 API 的 TypeScript。 |
| `pnpm build` | 构建 shared、web 和 API 包。 |
| `pnpm start` | 启动构建后的 API 包。 |
| `pnpm --filter @gpt-image-canvas/api smoke:planner` | 检查 Agent plan 校验 fixture。 |
| `pnpm --filter @gpt-image-canvas/api smoke:agent` | 检查 Agent 配置和 WebSocket 基础行为。 |
| `pnpm --filter @gpt-image-canvas/api smoke:executor` | 用 fake image provider 检查 Agent DAG 执行器。 |

完成代码改动前请运行：

```sh
pnpm typecheck
pnpm build
```

涉及 UI 改动时，请运行 `pnpm dev`，并在浏览器中验证 [http://localhost:5173](http://localhost:5173)。

如果切换 Node 版本后 `better-sqlite3` 报 `NODE_MODULE_VERSION` 不匹配，重新构建原生依赖：

```sh
pnpm --filter @gpt-image-canvas/api rebuild better-sqlite3 --stream
```

## Docker

Docker Compose 会把共享契约、Web 应用和 API 构建到同一个镜像中。API 在同一个本地端口同时提供 `/api` 和构建后的 Web bundle。SQLite 数据和生成资产会持久化到宿主机 `./data`。

Windows PowerShell：

```powershell
Copy-Item .env.example .env
docker compose config --quiet --no-env-resolution
docker compose up --build
```

macOS/Linux：

```sh
cp .env.example .env
docker compose config --quiet --no-env-resolution
docker compose up --build
```

默认打开 [http://localhost:8787](http://localhost:8787)。如需使用其他本地端口，请在启动 Compose 前设置 `.env` 中的 `PORT`。

真实凭证存在时，请使用 `docker compose config --quiet --no-env-resolution` 做校验。普通 `docker compose config` 会展开 env 文件，可能打印密钥。

Compose 默认设置 `SQLITE_JOURNAL_MODE=DELETE` 和 `SQLITE_LOCKING_MODE=EXCLUSIVE`，用于避开 Docker Desktop 绑定挂载目录时常见的 SQLite shared-memory 错误。不要让 `pnpm dev` 和 Docker 同时使用同一个 `data/` 目录。

### 预构建 GHCR 镜像

发版 workflow 会把多架构镜像推送到 GHCR，升级时可以直接拉仓库镜像，不需要本地重新构建：

```sh
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

默认镜像是 `ghcr.io/mrslimslim/gpt-image-canvas:latest`。如需固定某个版本，请在运行 Compose 前设置 `IMAGE`，例如 `ghcr.io/mrslimslim/gpt-image-canvas:v0.4.0`。

发布标签会生成 `vX.Y.Z`、`X.Y.Z` 和 `X.Y` 镜像标签；非 prerelease 的 GitHub Release 还会更新 `latest`。公开 GHCR package 可以匿名拉取；如果 GitHub 显示 package 是私有的，请先运行 `docker login ghcr.io`，或在仓库 package 设置里改为公开。

Compose 构建支持这些网络相关 build args：

- `NODE_IMAGE`
- `NPM_CONFIG_REGISTRY`
- `APT_MIRROR`
- `APT_SECURITY_MIRROR`

默认 `NODE_IMAGE` 是 `node:24.15.0-bookworm-slim`。

## 本地数据与密钥

`DATA_DIR` 本地默认是 `./data`，Docker 中默认是 `/app/data`。其中包含：

- `gpt-image-canvas.sqlite`：项目状态、生成历史、资产元数据、provider 配置、Agent LLM 配置、可选云存储配置，以及 Codex OAuth token 记录。
- `assets/`：生成的图像文件。

不要提交 `.env`、`.ralph/`、`.codex-temp/`、`data/`、生成图像、SQLite 数据库或构建输出。

保存本地 provider key、Agent LLM key、云存储 secret 或 Codex token 后，请把 `data/gpt-image-canvas.sqlite` 视为敏感文件。当前应用面向本地工作站使用；如果没有自行增加认证和网络隔离，不要把它公开暴露。

如果真实 API key 曾经被提交过，请先轮换该 key。Git ignore 只能防止之后继续泄露，不能从已有 Git 历史中删除密钥。

## 故障排查

- 缺少 provider：在 `.env` 添加 `OPENAI_API_KEY` 并重启，或从 `配置` 保存本地 provider，或完成 `Codex 登录`。
- Codex 登录失败：确认机器可以访问 `https://auth.openai.com`，保持登录弹窗打开；用户码过期后重新开始流程。
- 自定义端点失败：确认 `OPENAI_BASE_URL` 指向 OpenAI 兼容 `/v1` 端点，并支持当前图像模型。
- Agent 无法规划：Agent LLM 配置需要独立于图像 provider 保存。如果开启 `supportsVision` 后失败，减少选中图片数量或尺寸。
- Agent 计划无法执行：确认普通图像 provider 已配置；Agent 规划和实际生图使用的是两套配置。
- 端口冲突：为 API/Docker 设置 `PORT`。Web 开发端口冲突时，停止占用 `5173` 的进程，或运行 `pnpm web:dev -- --port 5174`。
- Docker 无法拉取基础镜像：恢复 Docker Hub 访问，或将 `NODE_IMAGE` 设置为本地缓存的等价 Node `24.15.0` 镜像。
- Docker 中出现 SQLite `SQLITE_IOERR_SHMOPEN`：保留 Compose 的 SQLite 默认值，重新构建，并确认没有本地 API 进程同时占用同一个数据库。
- SQLite `SQLITE_CORRUPT`：停止所有应用进程，备份 `data/`，再从备份恢复，或删除 SQLite 文件让应用创建新数据库。`data/assets/` 下的图片文件可以保留。
- 本地状态过期或不需要：停止应用并删除 `data/` 下的文件。这会删除本地项目状态、历史记录和生成资产。

## 升级

升级旧版本本地安装前，先备份运行时数据：

Windows PowerShell：

```powershell
Copy-Item -Recurse data data-backup-before-upgrade
docker compose up --build
```

macOS/Linux：

```sh
cp -R data data-backup-before-upgrade
docker compose up --build
```

升级后请一起重建 Web 应用和 API。

## Codex 使用说明

Codex 可以直接在本仓库工作。先让它读取 `AGENTS.md`，再使用固定包管理器：

```sh
pnpm install
pnpm typecheck
pnpm build
```

不要把凭证写进提示词或日志。Ralph 驱动的工作请先阅读 `docs/ralph-execution.md`；PRD 放在 `.agents/tasks/`，运行状态放在 `.ralph/`，临时文件放在 `.codex-temp/`。

## 许可证

MIT

## 友情链接

- [LINUX DO - 新的理想型社区](https://linux.do/)
