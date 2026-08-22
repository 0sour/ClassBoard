# 📚 ClassBoard · 课程表 Web 应用

> 自托管的家庭课程表应用：PDF 课表一键导入、周/日双视图、课程提醒、考试作业管理，跑在 NAS Docker 上，电脑手机都能用。

![Vue 3](https://img.shields.io/badge/Vue-3.5-42b883?logo=vue.js&logoColor=white)
![Node](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003b57?logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-单容器-2496ed?logo=docker&logoColor=white)

## ✨ 功能特性

- **PDF 课表一键导入** — 上传正方教务系统导出的课表 PDF，前端自动解析（mupdf WASM）、预览校验、确认导入，全程无需服务端处理
- **周课表双视图** — 桌面端 7 天完整视图（长按拖拽调课、冲突课程 1/3⇄2/3 动态分栏）；移动端单日视图（日期轮盘选日 + 当天课程卡片列表，松手自动回正）
- **课程管理** — 手动录入（保存并继续）、空白格快捷新增、颜色自动轮询、单双周课程、实验课标签、无固定时间实践课程
- **考试与作业** — 事项页三分类（考试/实验/作业）、截止提醒、完成勾选、桌面双栏详情
- **提醒引擎** — 课程上课前、实验课、作业截止前浏览器通知 + 站内铃铛
- **多学期管理** — 独立节次模板（默认 12 节含晚自习）、学期切换、数据相互隔离
- **数据安全** — 一键 JSON 备份/恢复、可选访问口令（scrypt 哈希 + 会话）、SQLite WAL 持久化
- **自研 UI 体系** — 设计 Token 驱动（清新浅色极简），自研 TimePicker / DatePicker / AppSelect，无重型组件库

## 🚀 快速开始（Docker）

```bash
# 1. 克隆仓库
git clone https://github.com/<your-name>/classboard.git
cd classboard

# 2. 构建并启动（默认端口 3000，被占用时改 CLASSBOARD_PORT）
CLASSBOARD_PORT=3000 docker compose up -d --build

# 3. 打开浏览器
# http://<你的NAS地址>:3000
```

数据持久化在 `./data/classboard.db`（挂载到容器 `/app/data`），升级容器不丢数据。

> **NAS 构建提示**：若 NAS 直连外网不稳定（node-gyp 下载超时），Dockerfile 已内置构建阶段走宿主机代理的方案（`build.network: host` + `HTTP(S)_PROXY=http://127.0.0.1:7890`），按需调整代理地址即可。

## 🛠 本地开发

```bash
# 后端（端口 3000）
cd server && npm install && npm run dev

# 前端（端口 5173，/api 代理到 3000）
cd frontend && npm install && npm run dev
```

## 🧪 测试

```bash
# 后端集成测试（8 项）
cd server && npm test

# 前端单元测试（62 项）
cd frontend && npm test
```

## 📖 文档

| 文档 | 内容 |
|------|------|
| [01-PRD-产品需求文档](docs/01-PRD-产品需求文档.md) | 产品定位、功能模块、交互逻辑、验收标准 |
| [02-技术设计文档](docs/02-技术设计文档.md) | 系统架构、REST 接口契约、数据库设计、Docker 部署 |
| [03-设计语言文档](docs/03-设计语言文档.md) | 设计 Token（颜色/字体/间距/圆角/阴影/断点） |
| [04-UI设计文档](docs/04-UI设计文档.md) | 页面布局线框、响应式规则、交互设计 |
| [05-UI组件参考.html](docs/05-UI组件参考.html) | 可交互组件规范参考页（浏览器直接打开） |

## 🏗 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 + Vite + Pinia + Vue Router，mupdf（WASM PDF 解析） |
| 后端 | Node.js 22 + Express 5 + better-sqlite3（SQLite WAL） |
| 部署 | 单容器 Docker（node:22-alpine 多阶段构建，非 root 运行，HEALTHCHECK） |

## 📄 许可证

本项目未指定开源许可证，保留所有权利。如需开源使用，请先联系作者。
