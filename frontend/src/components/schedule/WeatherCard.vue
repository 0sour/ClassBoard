<script setup lang="ts">
// ============================================================
// ClassBoard · 天气卡片组件
// 桌面形态：毛玻璃渐变卡（Canvas 雨/雪动态 + 展开详情）
// 移动形态：简约信息条（白底卡片 + 地区 + 展开详情）
// 数据：store.weatherData（/api/weather，服务端缓存）
// ============================================================
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useScheduleStore } from '@/stores/schedule'

const props = withDefaults(
  defineProps<{
    /** 形态：glass=毛玻璃（桌面侧栏）/ slim=简约条（移动端今日页） */
    variant?: 'glass' | 'slim'
  }>(),
  { variant: 'glass' },
)

const store = useScheduleStore()
const expanded = ref(false)

// ============ 天气 → 视觉映射 ============
/** 天气文本 → 渐变 key（QWeather textDay/text 中文描述） */
function wxKeyOf(text: string): string {
  const t = text ?? ''
  if (t.includes('晴')) return 'sunny'
  if (t.includes('雷')) return 'thunder'
  if (t.includes('雪') || t.includes('冰')) return 'snow'
  if (t.includes('雨')) return 'lightrain'
  if (t.includes('雾') || t.includes('霾') || t.includes('沙')) return 'fog'
  if (t.includes('阴')) return 'overcast'
  if (t.includes('云')) return 'cloudy'
  return 'sunny'
}

const wxKey = computed(() => wxKeyOf(store.weatherData?.now?.text ?? ''))

/** 渐变背景（纯色垂直渐变，随天气映射） */
const gradientBg = computed(() => {
  const map: Record<string, string> = {
    sunny: 'linear-gradient(180deg, #5b8df5 0%, #2f66d0 100%)',
    cloudy: 'linear-gradient(180deg, #8fa3b5 0%, #64798e 100%)',
    overcast: 'linear-gradient(180deg, #97a1ad 0%, #6f7a88 100%)',
    lightrain: 'linear-gradient(180deg, #5d7f9c 0%, #3c5c78 100%)',
    thunder: 'linear-gradient(180deg, #4d5568 0%, #30364a 100%)',
    snow: 'linear-gradient(180deg, #a5bfd6 0%, #7d99b4 100%)',
    fog: 'linear-gradient(180deg, #aeb7c0 0%, #8d98a3 100%)',
  }
  return map[wxKey.value] ?? map.sunny
})

/** 天气图标（feather 风格，stroke=currentColor） */
const wxIcon = computed(() => {
  const map: Record<string, string> = {
    sunny: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />',
    cloudy: '<path d="M17.5 19a4.5 4.5 0 1 0-1.07-8.88 5.5 5.5 0 0 0-10.55 1.13A3.5 3.5 0 0 0 7 19h10.5Z" /><path d="M8 12a4 4 0 0 1 4-4 4.5 4.5 0 0 1 4.5 4.5" />',
    overcast: '<path d="M3 12h3M6 7.5 4 6M6 16.5 4 18M9 5l-1-2M9 19l-1 2M14 6.5a3.5 3.5 0 0 1 3 5.5h.5a3 3 0 0 1 0 6H6a4 4 0 0 1-.4-7.97" />',
    lightrain: '<path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" /><path d="M16 13v6M12 13v6M8 13v6" />',
    thunder: '<path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" /><path d="m13 11-4 6h5l-3 6" />',
    snow: '<path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" /><path d="M12 13v.01M12 17v.01M9 15v.01M15 15v.01" />',
    fog: '<path d="M8 5h8M8 9h10M4 13h16M4 17h10" /><circle cx="6" cy="6" r="1.5" fill="currentColor" /><circle cx="18" cy="10" r="1.5" fill="currentColor" />',
  }
  return map[wxKey.value] ?? map.sunny
})

const tempText = computed(() => store.weatherData?.now?.temp ?? '--')
const descText = computed(() => {
  const now = store.weatherData?.now
  if (!now) return '天气数据未获取'
  return `体感 ${now.feelsLike}° · ${now.windDir}${now.windScale} 级`
})
const hlText = computed(() => {
  const d = store.weatherData?.daily?.[0]
  return d ? `${d.tempMax}° / ${d.tempMin}°` : '-- / --'
})
const cityText = computed(() => store.weatherData?.city ?? '')
const humidity = computed(() => (store.weatherData?.now?.humidity ? `${store.weatherData.now.humidity}%` : '--'))
const precip = computed(() => (store.weatherData?.now?.precip ? `${store.weatherData.now.precip}mm` : '--'))
const wind = computed(() => {
  const now = store.weatherData?.now
  return now ? `${now.windDir} ${now.windScale} 级` : '--'
})
const aqi = computed(() => {
  const air = store.weatherData?.air
  return air ? `${air.category} ${air.aqi}` : '--'
})
const sunText = computed(() => '--') // QWeather 免费版无日出日落，占位

/** 预警：取最高级别（QWeather severity 1=红/2=橙/3=黄/4=蓝） */
const activeWarning = computed(() => {
  const list = store.weatherData?.warning ?? []
  if (!list.length) return null
  const severityMap: Record<string, 'red' | 'orange' | 'yellow' | 'blue'> = {
    '1': 'red', '2': 'orange', '3': 'yellow', '4': 'blue',
  }
  const top = [...list].sort((a, b) => (a.severity ?? '4').localeCompare(b.severity ?? '4'))[0]
  return { level: severityMap[top.severity] ?? 'yellow', title: top.title, text: top.text }
})

const forecast = computed(() => store.weatherData?.daily?.slice(1, 4) ?? [])
const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return Number.isNaN(d.getTime()) ? dateStr : DAY_LABELS[d.getDay()]
}

// ============ Canvas 雨雪粒子（B 方案） ============
const canvasRef = ref<HTMLCanvasElement | null>(null)
let raf = 0
let raindrops: { x: number; y: number; len: number; spd: number; a: number }[] = []
let snowflakes: { x: number; y: number; r: number; spd: number; sway: number; ph: number; a: number }[] = []
let last = 0
let canvasW = 0
let canvasH = 0

function resizeCanvas(): void {
  const canvas = canvasRef.value
  const host = canvas?.parentElement
  if (!canvas || !host) return
  const rect = host.getBoundingClientRect()
  canvasW = rect.width
  canvasH = rect.height
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, canvasW * dpr)
  canvas.height = Math.max(1, canvasH * dpr)
  const ctx = canvas.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  raindrops = Array.from({ length: 30 }, () => ({
    x: Math.random() * canvasW, y: Math.random() * canvasH,
    len: 7 + Math.random() * 9, spd: 110 + Math.random() * 90,
    a: 0.3 + Math.random() * 0.5,
  }))
  snowflakes = Array.from({ length: 24 }, () => ({
    x: Math.random() * canvasW, y: Math.random() * canvasH,
    r: 1 + Math.random() * 1.8, spd: 28 + Math.random() * 45,
    sway: 0.6 + Math.random() * 1.2, ph: Math.random() * Math.PI * 2,
    a: 0.45 + Math.random() * 0.45,
  }))
}

function tick(now: number): void {
  raf = requestAnimationFrame(tick)
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  ctx.clearRect(0, 0, canvasW, canvasH)
  if (wxKey.value === 'lightrain' || wxKey.value === 'thunder') {
    const speed = wxKey.value === 'thunder' ? 1.3 : 1
    for (const d of raindrops) {
      d.y += d.spd * speed * dt
      d.x -= d.spd * 0.08 * dt
      if (d.y > canvasH + 10) { d.y = -10; d.x = Math.random() * canvasW }
      ctx.strokeStyle = `rgba(255,255,255,${d.a})`
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.moveTo(d.x, d.y)
      ctx.lineTo(d.x + 2, d.y - d.len)
      ctx.stroke()
    }
  } else if (wxKey.value === 'snow') {
    for (const f of snowflakes) {
      f.x += Math.sin(now * 0.001 * f.sway + f.ph) * 0.5 * dt * 60
      f.y += f.spd * dt
      if (f.y > canvasH + 5) { f.y = -5; f.x = Math.random() * canvasW }
      if (f.x < -5) f.x = canvasW + 5
      else if (f.x > canvasW + 5) f.x = -5
      ctx.fillStyle = `rgba(255,255,255,${f.a})`
      ctx.beginPath()
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

onMounted(() => {
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  last = performance.now()
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCanvas)
  cancelAnimationFrame(raf)
})

watch(wxKey, () => {
  // 天气切换时重设粒子（尺寸不变则直接复用）
  resizeCanvas()
})

/** 展开/收起 */
function toggleExpand(): void {
  expanded.value = !expanded.value
}

/** 未启用/无数据时组件不渲染内容 */
const visible = computed(() => store.weatherData !== null)
</script>

<template>
  <!-- ============ 桌面形态：毛玻璃渐变卡 ============ -->
  <div v-if="visible && variant === 'glass'" class="weather glass-card" :class="{ expanded }" @click="toggleExpand">
    <div class="wx-bg" :style="{ background: gradientBg }"></div>
    <canvas ref="canvasRef" class="fx-canvas"></canvas>

    <div class="glass-inner">
      <div class="wx-head">
        <span class="wx-loc">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
          {{ cityText }}
        </span>
        <span class="wx-ic" v-html="`<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'>${wxIcon}</svg>`"></span>
      </div>

      <div class="wx-main">
        <div class="wx-temp">{{ tempText }}<small>{{ store.weatherData?.now?.text ?? '' }}</small></div>
        <div class="wx-right">
          <div class="wx-desc">{{ descText }}</div>
          <div class="wx-hl" v-html="hlText"></div>
        </div>
      </div>

      <!-- 预警横幅（折叠区常驻） -->
      <div v-if="activeWarning" class="wx-alert" :class="'level-' + activeWarning.level">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4M12 17h.01" /></svg>
        <span class="wa-level">{{ activeWarning.title }}</span>
        <span class="wa-msg">{{ activeWarning.text }}</span>
      </div>

      <!-- 展开详情 -->
      <div class="wx-more">
        <div>
          <div class="wx-more-inner">
            <div class="sep"></div>
            <div class="wx-metrics">
              <div class="wx-metric">
                <span class="m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.5 4.5-3 6.5S13.5 20 12 21c-1.5-1-2.5-3-4-5.5S5 11.5 5 9a7 7 0 0 1 7-7Z" /></svg></span>
                <span class="m-info"><span class="m-label">体感温度</span><span class="m-value">{{ store.weatherData?.now?.feelsLike ?? '--' }}°</span></span>
              </div>
              <div class="wx-metric">
                <span class="m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69 5.64 9.05a5.5 5.5 0 0 0 7.78 7.78 5.5 5.5 0 0 0 7.78-7.78Z" /></svg></span>
                <span class="m-info"><span class="m-label">湿度</span><span class="m-value">{{ humidity }}</span></span>
              </div>
              <div class="wx-metric">
                <span class="m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M5 8h14M5 12h14M5 16h14" /></svg></span>
                <span class="m-info"><span class="m-label">降水量</span><span class="m-value">{{ precip }}</span></span>
              </div>
              <div class="wx-metric">
                <span class="m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0-1.07-8.88 5.5 5.5 0 0 0-10.55 1.13A3.5 3.5 0 0 0 7 19h10.5Z" /></svg></span>
                <span class="m-info"><span class="m-label">风力风向</span><span class="m-value">{{ wind }}</span></span>
              </div>
              <div class="wx-metric">
                <span class="m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0-1.07-8.88 5.5 5.5 0 0 0-10.55 1.13A3.5 3.5 0 0 0 7 19h10.5Z" /><path d="M8 12a4 4 0 0 1 4-4 4.5 4.5 0 0 1 4.5 4.5" /></svg></span>
                <span class="m-info"><span class="m-label">空气质量</span><span class="m-value">{{ aqi }}</span></span>
              </div>
              <div class="wx-metric">
                <span class="m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg></span>
                <span class="m-info"><span class="m-label">日出 / 日落</span><span class="m-value">{{ sunText }}</span></span>
              </div>
            </div>

            <!-- 未来 3 天预报 -->
            <div class="wx-forecast">
              <div class="f-title">未来 3 天</div>
              <div v-for="d in forecast" :key="d.fxDate" class="f-row">
                <span class="f-day">{{ dayLabel(d.fxDate) }}</span>
                <span class="f-ic" v-html="`<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'>${wxIcon}</svg>`"></span>
                <span class="f-desc">{{ d.textDay }}</span>
                <span class="f-temp"><b>{{ d.tempMax }}°</b> / {{ d.tempMin }}°</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="wx-toggle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </div>
    </div>
  </div>

  <!-- ============ 移动形态：简约信息条 ============ -->
  <div v-else-if="visible && variant === 'slim'" class="weather slim-card" :class="{ expanded }" @click="toggleExpand">
    <div v-if="activeWarning" class="wa-alert-flag" :class="'level-' + activeWarning.level">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4M12 17h.01" /></svg>
      {{ activeWarning.title }}
    </div>

    <span class="wa-icon" v-html="`<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'>${wxIcon}</svg>`"></span>
    <div class="wa-main">
      <div class="wa-loc">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
        <span>{{ cityText }}</span>
      </div>
      <div class="wa-temp">{{ tempText }}<small>{{ store.weatherData?.now?.text ?? '' }}</small></div>
      <div class="wa-desc">{{ descText }}</div>
    </div>
    <div class="wa-side">
      <div class="wa-hl" v-html="hlText"></div>
      <svg class="wa-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </div>

    <!-- 展开详情（白卡内） -->
    <div class="wa-more">
      <div>
        <div class="wa-more-inner">
          <div class="wx-metrics wa-metrics">
            <div class="wx-metric">
              <span class="m-ic wa-m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.5 4.5-3 6.5S13.5 20 12 21c-1.5-1-2.5-3-4-5.5S5 11.5 5 9a7 7 0 0 1 7-7Z" /></svg></span>
              <span class="m-info"><span class="m-label wa-m-label">体感温度</span><span class="m-value wa-m-value">{{ store.weatherData?.now?.feelsLike ?? '--' }}°</span></span>
            </div>
            <div class="wx-metric">
              <span class="m-ic wa-m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69 5.64 9.05a5.5 5.5 0 0 0 7.78 7.78 5.5 5.5 0 0 0 7.78-7.78Z" /></svg></span>
              <span class="m-info"><span class="m-label wa-m-label">湿度</span><span class="m-value wa-m-value">{{ humidity }}</span></span>
            </div>
            <div class="wx-metric">
              <span class="m-ic wa-m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M5 8h14M5 12h14M5 16h14" /></svg></span>
              <span class="m-info"><span class="m-label wa-m-label">降水量</span><span class="m-value wa-m-value">{{ precip }}</span></span>
            </div>
            <div class="wx-metric">
              <span class="m-ic wa-m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0-1.07-8.88 5.5 5.5 0 0 0-10.55 1.13A3.5 3.5 0 0 0 7 19h10.5Z" /></svg></span>
              <span class="m-info"><span class="m-label wa-m-label">风力风向</span><span class="m-value wa-m-value">{{ wind }}</span></span>
            </div>
            <div class="wx-metric">
              <span class="m-ic wa-m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0-1.07-8.88 5.5 5.5 0 0 0-10.55 1.13A3.5 3.5 0 0 0 7 19h10.5Z" /><path d="M8 12a4 4 0 0 1 4-4 4.5 4.5 0 0 1 4.5 4.5" /></svg></span>
              <span class="m-info"><span class="m-label wa-m-label">空气质量</span><span class="m-value wa-m-value">{{ aqi }}</span></span>
            </div>
            <div class="wx-metric">
              <span class="m-ic wa-m-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg></span>
              <span class="m-info"><span class="m-label wa-m-label">日出 / 日落</span><span class="m-value wa-m-value">{{ sunText }}</span></span>
            </div>
          </div>

          <div class="wx-forecast wa-forecast">
            <div class="f-title wa-f-title">未来 3 天</div>
            <div v-for="d in forecast" :key="d.fxDate" class="f-row wa-f-row">
              <span class="f-day wa-f-day">{{ dayLabel(d.fxDate) }}</span>
              <span class="f-ic wa-f-ic" v-html="`<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'>${wxIcon}</svg>`"></span>
              <span class="f-desc wa-f-desc">{{ d.textDay }}</span>
              <span class="f-temp wa-f-temp"><b>{{ d.tempMax }}°</b> / {{ d.tempMin }}°</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ============ 通用 ============ */
.weather {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  isolation: isolate;
  cursor: pointer;
  color: var(--color-white);
  transition: transform var(--motion-duration-normal) var(--motion-easing-standard),
    box-shadow var(--motion-duration-normal) var(--motion-easing-standard);
}
.weather:hover { transform: translateY(-1px); box-shadow: var(--shadow-hover); }
.weather:active { transform: translateY(0); }

/* ============ 毛玻璃形态（桌面） ============ */
.glass-card { min-height: 132px; }
.wx-bg { position: absolute; inset: 0; z-index: -2; transition: background 0.6s var(--motion-easing-standard); }
.fx-canvas { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; pointer-events: none; }

.glass-inner {
  position: relative;
  z-index: 1;
  margin: 10px;
  background: rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: var(--radius-lg);
}

.wx-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 0; }
.wx-loc { font-size: var(--font-size-sm); opacity: 0.9; display: flex; align-items: center; gap: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wx-loc svg { width: 13px; height: 13px; flex: none; }
.wx-ic { width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(255,255,255,0.28), rgba(255,255,255,0.14)); border-radius: var(--radius-full); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.28); flex: none; }
.wx-ic :deep(svg) { width: 23px; height: 23px; display: block; }

.wx-main { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 8px 14px 0; }
.wx-temp { font-size: 36px; font-weight: var(--font-weight-heavy); line-height: 1; white-space: nowrap; }
.wx-temp small { font-size: var(--font-size-lg); font-weight: var(--font-weight-regular); opacity: 0.85; margin-left: 5px; }
.wx-right { text-align: right; padding-bottom: 3px; min-width: 0; max-width: 58%; }
.wx-desc { font-size: var(--font-size-sm); opacity: 0.92; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wx-hl { font-size: var(--font-size-sm); opacity: 0.75; margin-top: 3px; white-space: nowrap; }

/* 预警横幅（折叠区常驻） */
.wx-alert {
  display: flex; align-items: center; gap: 6px;
  margin: 10px 12px 0;
  padding: 6px 9px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  animation: alert-in 0.4s var(--motion-easing-standard);
}
@keyframes alert-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.wx-alert svg { width: 13px; height: 13px; flex: none; }
.wx-alert .wa-level { flex: none; font-weight: var(--font-weight-bold); }
.wx-alert .wa-msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wx-alert.level-blue { background: rgba(234, 245, 255, 0.92); color: #075985; border: 1px solid #bae3ff; }
.wx-alert.level-yellow { background: rgba(255, 251, 235, 0.92); color: var(--color-warning-text); border: 1px solid var(--color-warning-line); }
.wx-alert.level-orange { background: rgba(255, 247, 237, 0.92); color: #c2410c; border: 1px solid #fed7aa; }
.wx-alert.level-red { background: rgba(254, 242, 242, 0.92); color: #b91c1c; border: 1px solid var(--color-danger-line); }

/* 展开 */
.wx-toggle { display: flex; align-items: center; justify-content: center; width: 100%; padding: 5px 0 9px; color: rgba(255,255,255,0.85); transition: transform var(--motion-duration-slow) var(--motion-easing-standard); }
.wx-toggle svg { width: 15px; height: 15px; }
.glass-card.expanded .wx-toggle { transform: rotate(180deg); }

.wx-more { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.28s var(--motion-easing-standard); }
.wx-more > div { overflow: hidden; }
.weather.expanded .wx-more { grid-template-rows: 1fr; }

.wx-more-inner { padding: 2px 14px 12px; }
.wx-more-inner .sep { height: 1px; background: rgba(255,255,255,0.22); margin-bottom: 12px; }

.wx-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 14px; }
.wx-metric { display: flex; align-items: center; gap: 9px; min-width: 0; }
.m-ic { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.18); border-radius: var(--radius-md); flex: none; }
.m-ic svg { width: 14px; height: 14px; }
.m-info { min-width: 0; }
.m-label { display: block; font-size: var(--font-size-xs); opacity: 0.65; white-space: nowrap; }
.m-value { display: block; font-size: var(--font-size-md); font-weight: var(--font-weight-bold); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.wx-forecast { margin-top: 12px; }
.f-title { font-size: var(--font-size-xs); opacity: 0.65; margin-bottom: 8px; letter-spacing: 0.8px; }
.f-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid rgba(255,255,255,0.16); }
.f-row:first-of-type { border-top: none; }
.f-day { width: 48px; font-size: var(--font-size-sm); opacity: 0.85; flex: none; }
.f-ic { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.16); border-radius: var(--radius-full); flex: none; }
.f-ic :deep(svg) { width: 14px; height: 14px; display: block; }
.f-desc { flex: 1; font-size: var(--font-size-sm); opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.f-temp { font-size: var(--font-size-sm); opacity: 0.85; white-space: nowrap; }
.f-temp b { font-weight: var(--font-weight-bold); opacity: 1; }

/* ============ 简约形态（移动端） ============ */
.slim-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  box-shadow: var(--shadow-card);
  padding: 12px 16px;
  color: var(--color-text-body);
}
.wa-icon { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); background: linear-gradient(135deg, var(--color-brand-subtle), #e3edff); color: var(--color-brand); flex: none; }
.wa-icon :deep(svg) { width: 22px; height: 22px; display: block; }
.wa-main { flex: 1; min-width: 0; }
.wa-loc { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wa-loc svg { width: 11px; height: 11px; flex: none; color: var(--color-brand); }
.wa-temp { font-size: var(--font-size-2xl); font-weight: var(--font-weight-heavy); color: var(--color-text-primary); line-height: 1.1; white-space: nowrap; }
.wa-temp small { font-size: var(--font-size-sm); font-weight: var(--font-weight-regular); color: var(--color-text-tertiary); margin-left: 4px; }
.wa-desc { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wa-side { text-align: right; flex: none; white-space: nowrap; }
.wa-hl { font-size: var(--font-size-sm); color: var(--color-text-tertiary); white-space: nowrap; }
.wa-hl b { color: var(--color-text-body); font-weight: var(--font-weight-medium); }
.wa-arrow { width: 15px; height: 15px; color: var(--color-text-tertiary); margin-top: 2px; transition: transform var(--motion-duration-slow) var(--motion-easing-standard); }
.slim-card.expanded .wa-arrow { transform: rotate(180deg); }

/* 简约卡预警角标 */
.wa-alert-flag {
  position: absolute;
  top: -6px; right: 10px;
  display: flex; align-items: center; gap: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  box-shadow: var(--shadow-pop);
  animation: alert-in 0.4s var(--motion-easing-standard);
  z-index: 2;
}
.wa-alert-flag.level-yellow { background: #f59e0b; color: var(--color-white); }
.wa-alert-flag.level-orange { background: #f97316; color: var(--color-white); }
.wa-alert-flag.level-red { background: #ef4444; color: var(--color-white); }
.wa-alert-flag.level-blue { background: #06b6d4; color: var(--color-white); }
.wa-alert-flag svg { width: 11px; height: 11px; }

/* 简约卡展开 */
.wa-more { flex-basis: 100%; display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.28s var(--motion-easing-standard); }
.wa-more > div { overflow: hidden; }
.slim-card.expanded .wa-more { grid-template-rows: 1fr; }
.wa-more-inner { padding: 14px 0 4px; margin-top: 12px; border-top: 1px solid var(--color-border-default); }
.wa-m-ic { background: var(--color-brand-subtle); color: var(--color-brand); }
.wa-m-label { color: var(--color-text-tertiary); }
.wa-m-value { color: var(--color-text-body); }
.wa-forecast { margin-top: 12px; }
.wa-f-title { color: var(--color-text-tertiary); }
.wa-f-row { border-top-color: var(--color-border-default); }
.wa-f-day { color: var(--color-text-secondary); }
.wa-f-ic { background: var(--color-bg-subtle); color: var(--color-text-secondary); }
.wa-f-desc { color: var(--color-text-body); }
.wa-f-temp { color: var(--color-text-secondary); }
.wa-f-temp b { color: var(--color-text-primary); }
</style>
