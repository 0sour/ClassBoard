<script setup lang="ts">
// ============================================================
// ClassBoard · 站点页脚（公开面 / 登录页）
//   页脚文案、备案号、访问统计都由「设置 → 站点」配置（存数据库，不进仓库）。
//   访问统计为可选：关闭时不请求、不写库；开启后同一浏览器同一天只计一次。
// ============================================================
import { computed, onMounted, ref } from 'vue'
import { api, type SiteSettings, type VisitStats } from '@/api/client'

const props = withDefaults(
  defineProps<{
    /** 紧凑模式（登录页） */
    compact?: boolean
    /** 移动端需要给固定底部 Tab 栏留出高度 */
    aboveTabbar?: boolean
  }>(),
  { compact: false, aboveTabbar: false },
)

const GITHUB_URL = 'https://github.com/0sour/ClassBoard'
const ICP_URL = 'https://beian.miit.gov.cn/'
const POLICE_URL = 'https://beian.mps.gov.cn/'
const VISIT_DAY_KEY = 'classboard.visit.day'

const site = ref<SiteSettings | null>(null)
const stats = ref<VisitStats | null>(null)
const year = new Date().getFullYear()

const hasMeta = computed(() => Boolean(stats.value || site.value?.icp || site.value?.policeIcp))
const showStats = computed(() => Boolean(site.value?.showVisits && stats.value))

function todayKey(): string {
  return new Date().toLocaleDateString('sv-SE')
}

function fmt(n: number): string {
  return n.toLocaleString('zh-CN')
}

async function loadStats(): Promise<void> {
  if (!site.value?.showVisits) return
  try {
    if (window.localStorage.getItem(VISIT_DAY_KEY) === todayKey()) {
      stats.value = await api.getPublicStats()
    } else {
      stats.value = await api.recordVisit()
      window.localStorage.setItem(VISIT_DAY_KEY, todayKey())
    }
  } catch {
    // 统计失败不影响页脚其余信息
    stats.value = null
  }
}

onMounted(async () => {
  try {
    site.value = await api.getPublicSite()
  } catch {
    site.value = null
  }
  await loadStats()
})
</script>

<template>
  <footer
    class="site-footer"
    :class="{ compact: props.compact, 'above-tabbar': props.aboveTabbar }"
  >
    <p class="line line--main">
      <span>© {{ year }} ClassBoard</span>
      <template v-if="site?.footerText">
        <span class="dot" aria-hidden="true">·</span>
        <span>{{ site.footerText }}</span>
      </template>
      <span class="dot" aria-hidden="true">·</span>
      <a class="link" :href="GITHUB_URL" target="_blank" rel="noopener noreferrer">Powered by ClassBoard</a>
    </p>
    <p v-if="hasMeta" class="line line--meta">
      <span v-if="showStats">今日访问 {{ fmt(stats!.today) }} 次 · 累计 {{ fmt(stats!.total) }} 次</span>
      <a v-if="site?.icp" class="link" :href="ICP_URL" target="_blank" rel="noopener noreferrer">{{ site.icp }}</a>
      <a v-if="site?.policeIcp" class="link" :href="POLICE_URL" target="_blank" rel="noopener noreferrer">{{ site.policeIcp }}</a>
    </p>
  </footer>
</template>

<style scoped>
.site-footer {
  margin-top: var(--spacing-2xl);
  padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-2xl);
  border-top: 1px solid var(--color-border-default);
  background: var(--color-bg-page);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  text-align: center;
}

.site-footer.compact {
  width: 100%;
  max-width: 380px;
  margin-top: 0;
  padding: var(--spacing-md) 0 0;
  border-top: 0;
  background: transparent;
}

.site-footer.above-tabbar {
  padding-bottom: calc(var(--spacing-2xl) + 64px + env(safe-area-inset-bottom));
}

.line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  line-height: 1.7;
}

.line + .line {
  margin-top: 2px;
}

.dot {
  color: var(--color-border-strong, var(--color-text-tertiary));
}

.link {
  color: var(--color-text-tertiary);
  text-decoration: none;
  transition: color var(--motion-duration-fast) var(--motion-easing-standard);
}

.link:hover {
  color: var(--color-brand);
  text-decoration: underline;
}

@media (min-width: 768px) {
  .site-footer {
    padding: var(--spacing-lg) var(--spacing-xl) var(--spacing-xl);
  }

  .site-footer.above-tabbar {
    padding-bottom: var(--spacing-xl);
  }
}
</style>
