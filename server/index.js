// ============================================================
// ClassBoard · 服务入口
// Express + SQLite，单容器同时承载 REST API 与前端静态产物
// ============================================================
import express from 'express'
import cookieParser from 'cookie-parser'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { errorHandler } from './lib/errors.js'
import { attachSession, requireActive, requireSession } from './lib/access.js'
import { ensureDefaultSettings } from './lib/settings.js'
import { accessRouter } from './routes/access.js'
import { usersRouter } from './routes/users.js'
import { approvalsRouter } from './routes/approvals.js'
import { classesRouter } from './routes/classes.js'
import { publicRouter } from './routes/public.js'
import { contextRouter, scheduleRouter } from './routes/schedule.js'
import { semestersRouter } from './routes/semesters.js'
import { periodsRouter } from './routes/periods.js'
import { coursesRouter } from './routes/courses.js'
import { calendarRouter } from './routes/calendar.js'
import { adjustmentsRouter } from './routes/adjustments.js'
import { examsRouter } from './routes/exams.js'
import { homeworkRouter } from './routes/homework.js'
import { noticesRouter } from './routes/notices.js'
import { importRouter } from './routes/import.js'
import { backupRouter } from './routes/backup.js'
import { settingsRouter } from './routes/settings.js'
import { weatherRouter } from './routes/weather.js'

const here = dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIST = process.env.CLASSBOARD_DIST_DIR
  ? resolve(process.env.CLASSBOARD_DIST_DIR)
  : resolve(here, '../frontend/dist')

ensureDefaultSettings()

export const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())
app.use(attachSession)

// 公开面（无需登录，只读）：班级列表 / 班级课表数据 / 通知 / 天气
app.use('/api/public', publicRouter)
// 认证与用户管理：login/register/me/sessions 公开（会话中间件内部处理），users 与 approvals 需管理员
app.use('/api/access', accessRouter)
app.use('/api/users', usersRouter)
app.use('/api/approvals', approvalsRouter)
app.use('/api/context', contextRouter)
// 负责人侧（需已通过审核）：班级与全部班级业务数据
app.use('/api/classes', requireSession, requireActive, classesRouter)
app.use('/api/schedule', requireSession, requireActive, scheduleRouter)
app.use('/api/semesters', requireSession, requireActive, semestersRouter)
app.use('/api/periods', requireSession, requireActive, periodsRouter)
app.use('/api/courses', requireSession, requireActive, coursesRouter)
app.use('/api/calendar', requireSession, requireActive, calendarRouter)
app.use('/api/adjustments', requireSession, requireActive, adjustmentsRouter)
app.use('/api/exams', requireSession, requireActive, examsRouter)
app.use('/api/homework', requireSession, requireActive, homeworkRouter)
app.use('/api/notices', requireSession, requireActive, noticesRouter)
app.use('/api/import', requireSession, requireActive, importRouter)
app.use('/api/backup', requireSession, requireActive, backupRouter)
app.use('/api/settings', requireSession, settingsRouter)
app.use('/api/weather', requireSession, weatherRouter)

// /api 下未匹配 → 404
app.use('/api', (req, res) => {
  res.status(404).json({ code: 'NOT_FOUND', message: '接口不存在' })
})

// 前端静态托管 + SPA fallback（带缓存头，见技术文档 6 性能）
if (existsSync(FRONTEND_DIST)) {
  app.use(
    express.static(FRONTEND_DIST, {
      maxAge: '1y',
      immutable: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
      },
    }),
  )
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(resolve(FRONTEND_DIST, 'index.html'))
  })
}

app.use(errorHandler)

const PORT = Number(process.env.PORT ?? 3000)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`ClassBoard listening on http://localhost:${PORT}`)
    console.log(`Static: ${FRONTEND_DIST}${existsSync(FRONTEND_DIST) ? '' : '（未构建，请先 npm run build）'}`)
  })
}
