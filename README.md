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
- **课程管理** — 手动录入（固定课表 / 每节课调整两种模式）、空白格快捷新增、颜色自动轮询、单双周课程（支持周数范围如"8-14 周单周"）、实验课标签、无固定时间实践课程
- **模板市场** — 班级共享课程模板：课程模板（单门课，可勾选批量导入）+ 组合模板（引用课程模板一键导入）+ 学期模板（一键创建学期与节次时间）；管理员维护（新建/编辑/从学期勾选另存），同学一键导入到自己的课表
- **考试与作业** — 事项页三分类（考试/实验/作业）、截止提醒、完成勾选、桌面双栏详情
- **提醒引擎** — 课程上课前、实验课、作业截止前浏览器通知 + 站内铃铛
- **多学期管理** — 独立节次模板（默认 12 节含晚自习）、学期切换、数据相互隔离
- **多用户** — 管理员 + 普通用户账号体系（数据完全隔离）、记住我自动登录、已登录设备管理、注册开关
- **数据安全** — 一键 JSON 备份/恢复（含模板）、SQLite WAL 持久化；覆盖导入/恢复/删学期前自动生成一致性快照（`data/snapshots/`，保留 10 份），恢复仅管理员可执行且只影响自己的数据
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

## 🗂 课程数据模型

课程数据采用「课程组 + 上课时间组 + 逐格子」三层结构，节次与周次**一律逐项展开存储**（`[3,4,5,6]`、`[1,2,...,16]`），不写区间、不写单双周简写；「第 3–6 节」「第 1–7 周（单周）」等文案由程序读取时派生，不写回数据库。

```
course            一门课一行（课程名/教师/颜色/类型/备注）
└─ course_session 一个上课时间一组（星期 + 地点）
   └─ course_slot 一个「第几节 × 第几周」一行
```

例：数字信号处理实验（周四 9、10 节，第 11–14 周）

```
course          id=12  lab  数字信号处理  陈俊如  course-2
course_session  id=31  course_id=12  weekday=4  location=实验楼B103
course_slot     session_id=31  (period=9,  week=11) (period=9,  week=12) (period=9,  week=13) (period=9,  week=14)
                session_id=31  (period=10, week=11) (period=10, week=12) (period=10, week=13) (period=10, week=14)
```

「本周上不上这门课」= `course_slot.week` 是否等于本周周号（索引命中），因此不再有 all/odd/even 语义差异，也不存在前后端周号算法不一致导致课程时有时无的问题。旧的 `week_type/week_list/start_period/end_period` 已在启动时自动迁移（幂等，迁移前自动快照）。

## 🛠 本地开发

```bash
# 后端（端口 3000）
cd server && npm install && npm run dev

# 前端（端口 5173，/api 代理到 3000）
cd frontend && npm install && npm run dev
```

## 🧪 测试

```bash
# 后端集成测试（26 项）
cd server && npm test

# 前端单元测试（111 项）
cd frontend && npm test

# 代码检查（前后端各自）
cd server && npm run lint
cd frontend && npm run lint
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
