// ============================================================
// ClassBoard · 统一错误信封（技术文档 4.1.2）
// ============================================================

export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function badRequest(message, details) {
  return new AppError(400, 'VALIDATION_ERROR', message, details)
}

export function notFound(message = '资源不存在') {
  return new AppError(404, 'NOT_FOUND', message)
}

export function badFile(message) {
  return new AppError(400, 'BAD_FILE', message)
}

export function accessDenied(message = '口令错误') {
  return new AppError(403, 'ACCESS_DENIED', message)
}

export function rateLimited() {
  return new AppError(429, 'RATE_LIMITED', '尝试过于频繁，请稍后再试')
}

export function tooLarge() {
  return new AppError(413, 'FILE_TOO_LARGE', '上传内容超过大小限制')
}

/** 统一错误处理中间件（放在路由之后） */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err)
  if (err instanceof AppError) {
    const body = { code: err.code, message: err.message }
    if (err.details) body.details = err.details
    return res.status(err.status).json(body)
  }
  // better-sqlite3 唯一约束冲突等
  if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '名称已存在' })
  }
  if (err && err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '关联数据不存在' })
  }
  console.error('[error]', err)
  res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务器内部错误' })
}

/** 包装 async 路由处理器，异常交给 errorHandler */
export function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}
