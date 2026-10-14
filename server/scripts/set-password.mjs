// ============================================================
// ClassBoard · 本地/运维辅助：直接重置某个账号的密码
//   仅在忘记密码且邮件/自助找回都不可用时使用（NAS 上先停容器再执行，
//   否则运行中的服务不会看到这次改动——见部署备忘第 5 条）。
//   用法：node scripts/set-password.mjs <username> <newPassword>
//   （本地副本演练：CLASSBOARD_DATA_DIR=/path/to/copy node scripts/set-password.mjs sour test123456）
// ============================================================
import { db } from '../lib/db.js'
import { hashPassword, revokeAllSessions } from '../lib/access.js'

const [username, password] = process.argv.slice(2)
if (!username || !password) {
  console.error('用法：node scripts/set-password.mjs <username> <newPassword>')
  process.exit(1)
}
if (password.length < 6 || password.length > 64) {
  console.error('[中止] 密码长度须为 6–64 位')
  process.exit(1)
}

const user = db.prepare('SELECT * FROM user WHERE username = ?').get(username)
if (!user) {
  console.error(`[中止] 找不到账号「${username}」`)
  process.exit(1)
}

db.prepare('UPDATE user SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id)
revokeAllSessions(user.id)
console.log(`[完成] 已重置「${username}」（id=${user.id}）的密码，并撤销其全部登录会话。`)
if (process.env.CLASSBOARD_DATA_DIR) console.log(`[提示] 数据目录：${process.env.CLASSBOARD_DATA_DIR}`)
