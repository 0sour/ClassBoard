// ============================================================
// 一次性修复：为已有课程重新分配颜色（修复 PDF 导入未分配颜色、
// 全部课程落为 course-1 的问题，见开发日志会话 23）
// 规则与前端 pickCourseColor 一致：同学期内同名复用、按 id（录入顺序）轮询 8 色
// 运行：node scripts/reassign-course-colors.mjs
// ============================================================
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// better-sqlite3 安装在 server/node_modules，用相对路径定位
const require = createRequire(path.join(__dirname, '..', 'server', 'package.json'))
const Database = require('better-sqlite3')

const dbPath = process.env.CLASSBOARD_DATA_DIR
  ? path.join(process.env.CLASSBOARD_DATA_DIR, 'classboard.db')
  : path.join(__dirname, '..', 'server', 'lib', 'data', 'classboard.db')

const COLORS = ['course-1', 'course-2', 'course-3', 'course-4', 'course-5', 'course-6', 'course-7', 'course-8']

const db = new Database(dbPath)
const semesters = db.prepare('SELECT id FROM semester ORDER BY id').all()

let updated = 0
const update = db.prepare('UPDATE course SET color = ? WHERE id = ?')

for (const sem of semesters) {
  const courses = db.prepare('SELECT id, name FROM course WHERE semester_id = ? ORDER BY id').all(sem.id)
  const colorOf = new Map()
  let counter = 0
  for (const c of courses) {
    if (!colorOf.has(c.name)) {
      colorOf.set(c.name, COLORS[counter % COLORS.length])
      counter++
    }
    update.run(colorOf.get(c.name), c.id)
    updated++
  }
}

console.log(`reassigned ${updated} courses across ${semesters.length} semesters`)
db.close()
