'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface Point3D {
  x: number; y: number; z: number
  oldX: number; oldY: number; oldZ: number
  pinned: boolean
  baseX: number; baseY: number; baseZ: number
  projX: number; projY: number; projScale: number
}

interface Constraint3D {
  p1: Point3D
  p2: Point3D
  length: number
}

export interface NeonMeshProps {
  title?: string
  subtitle?: string
  description?: string
  className?: string
  /** Dim, non-interactive variant for use behind real content. */
  variant?: 'hero' | 'ambient'
  children?: React.ReactNode
}

export function NeonMesh({
  title = 'KINETIC',
  subtitle = '',
  description = 'Interactive 3D Verlet physics cloth reacting to spatial vector force, perspective rotators, and kinetic drag.',
  className = '',
  variant = 'hero',
  children,
}: NeonMeshProps) {          // was `NeonMagneticMeshProps` — an undeclared type that fails to compile
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Both are readable synchronously, so derive the initial value rather than setting
  // state inside an effect and paying an extra render.
  const [isDarkMode, setIsDarkMode] = useState<boolean>(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  // A permanent requestAnimationFrame loop is exactly what this setting exists to stop —
  // it's a vestibular-trigger risk, and it drains a laptop battery for decoration.
  const [reducedMotion, setReducedMotion] = useState<boolean>(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const dark = window.matchMedia('(prefers-color-scheme: dark)')
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onDark = (e: MediaQueryListEvent) => setIsDarkMode(e.matches)
    const onMotion = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    dark.addEventListener('change', onDark)
    motion.addEventListener('change', onMotion)
    return () => {
      dark.removeEventListener('change', onDark)
      motion.removeEventListener('change', onMotion)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const ambient = variant === 'ambient'
    let animationFrameId = 0
    let width = 0
    let height = 0
    let visible = true

    const mouse = {
      x: -1000, y: -1000,
      targetAngleX: 0.2, targetAngleY: -0.3,
      angleX: 0.2, angleY: -0.3,
      radius: 180,
    }

    let points: Point3D[] = []
    let constraints: Constraint3D[] = []

    // Coarser grid in ambient mode: fewer springs to solve four times per frame, behind
    // content nobody is looking at.
    const spacing = ambient ? 64 : 42

    const initMesh = () => {
      points = []
      constraints = []

      const cols = Math.ceil((width * 1.1) / spacing) + 1
      const rows = Math.ceil((height * 1.1) / spacing) + 1
      const grid: Point3D[][] = []
      const startX = -(cols * spacing) / 2
      const startY = -(rows * spacing) / 2

      for (let j = 0; j < rows; j++) {
        grid[j] = []
        for (let i = 0; i < cols; i++) {
          const bx = startX + i * spacing
          const by = startY + j * spacing
          const isEdge = i === 0 || i === cols - 1 || j === 0 || j === rows - 1
          const p: Point3D = {
            x: bx, y: by, z: 0,
            oldX: bx, oldY: by, oldZ: 0,
            pinned: isEdge,
            baseX: bx, baseY: by, baseZ: 0,
            projX: 0, projY: 0, projScale: 1,
          }
          points.push(p)
          grid[j][i] = p
        }
      }

      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (i < cols - 1) constraints.push({ p1: grid[j][i], p2: grid[j][i + 1], length: spacing })
          if (j < rows - 1) constraints.push({ p1: grid[j][i], p2: grid[j + 1][i], length: spacing })
        }
      }
    }

    const handleResize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      // setTransform, not scale: the original scale() compounds on every resize, so the
      // mesh shrank each time the window changed.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      initMesh()
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const rawX = e.clientX - rect.left
      const rawY = e.clientY - rect.top
      mouse.x = rawX
      mouse.y = rawY
      const normX = (rawX / width - 0.5) * 2
      const normY = (rawY / height - 0.5) * 2
      mouse.targetAngleY = normX * 0.45
      mouse.targetAngleX = -normY * 0.35 + 0.2
    }

    const handleMouseLeave = () => {
      mouse.x = -1000
      mouse.y = -1000
      mouse.targetAngleX = 0.2
      mouse.targetAngleY = 0
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    if (!ambient) {
      container.addEventListener('mousemove', handleMouseMove)
      container.addEventListener('mouseleave', handleMouseLeave)
    }

    // Stop burning frames when scrolled offscreen or on a hidden tab.
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting }, { threshold: 0 })
    io.observe(container)
    const onVisibility = () => { visible = !document.hidden }
    document.addEventListener('visibilitychange', onVisibility)

    let time = 0

    const drawFrame = () => {
      time += 0.025
      mouse.angleX += (mouse.targetAngleX - mouse.angleX) * 0.05
      mouse.angleY += (mouse.targetAngleY - mouse.angleY) * 0.05

      const cosX = Math.cos(mouse.angleX)
      const sinX = Math.sin(mouse.angleX)
      const cosY = Math.cos(mouse.angleY)
      const sinY = Math.sin(mouse.angleY)

      const bgColor = isDarkMode ? '#050702' : '#fbfdf5'
      const baseMeshColor = isDarkMode ? '15, 148, 89' : '0, 154, 82'
      const neon = isDarkMode ? '#00E676' : '#00713e'
      const dim = ambient ? 0.45 : 1

      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, width, height)

      for (const p of points) {
        if (p.pinned) continue
        const vx = (p.x - p.oldX) * 0.93
        const vy = (p.y - p.oldY) * 0.93
        const vz = (p.z - p.oldZ) * 0.93
        p.oldX = p.x; p.oldY = p.y; p.oldZ = p.z
        p.x += vx; p.y += vy; p.z += vz
        const ambientZ = Math.sin(p.baseX * 0.015 + p.baseY * 0.015 + time) * 18
        p.x += (p.baseX - p.x) * 0.04
        p.y += (p.baseY - p.y) * 0.04
        p.z += (p.baseZ + ambientZ - p.z) * 0.04
      }

      const perspective = 600
      const centerX = width / 2
      const centerY = height / 2

      for (const p of points) {
        const rx1 = p.x * cosY + p.z * sinY
        const ry1 = p.y
        const rz1 = -p.x * sinY + p.z * cosY
        const rx2 = rx1
        const ry2 = ry1 * cosX - rz1 * sinX
        const rz2 = ry1 * sinX + rz1 * cosX + 400
        const scale = perspective / Math.max(1, rz2)
        p.projScale = scale
        p.projX = centerX + rx2 * scale
        p.projY = centerY + ry2 * scale

        if (!p.pinned && !ambient) {
          const dx = p.projX - mouse.x
          const dy = p.projY - mouse.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < mouse.radius && dist > 0) {
            const force = (1 - dist / mouse.radius) * 22
            const angle = Math.atan2(dy, dx)
            p.x += (Math.cos(angle) * force) / p.projScale
            p.y += (Math.sin(angle) * force) / p.projScale
            p.z -= (force * 1.5) / p.projScale
          }
        }
      }

      for (let iter = 0; iter < 4; iter++) {
        for (const c of constraints) {
          const dx = c.p2.x - c.p1.x
          const dy = c.p2.y - c.p1.y
          const dz = c.p2.z - c.p1.z
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
          const delta = (dist - c.length) / (dist || 1)
          if (!c.p1.pinned) { c.p1.x += dx * 0.5 * delta; c.p1.y += dy * 0.5 * delta; c.p1.z += dz * 0.5 * delta }
          if (!c.p2.pinned) { c.p2.x -= dx * 0.5 * delta; c.p2.y -= dy * 0.5 * delta; c.p2.z -= dz * 0.5 * delta }
        }
      }

      for (const c of constraints) {
        const midX = (c.p1.projX + c.p2.projX) / 2
        const midY = (c.p1.projY + c.p2.projY) / 2
        const dx = mouse.x - midX
        const dy = mouse.y - midY
        const isHot = !ambient && Math.sqrt(dx * dx + dy * dy) < mouse.radius
        const avgScale = (c.p1.projScale + c.p2.projScale) / 2

        ctx.strokeStyle = isHot
          ? neon
          : `rgba(${baseMeshColor}, ${Math.min(1, Math.max(0.1, (isDarkMode ? 0.25 : 0.4) * avgScale)) * dim})`
        ctx.lineWidth = isHot ? 2 * avgScale : 0.8 * avgScale
        ctx.beginPath()
        ctx.moveTo(c.p1.projX, c.p1.projY)
        ctx.lineTo(c.p2.projX, c.p2.projY)
        ctx.stroke()
      }

      if (!ambient) {
        for (const p of points) {
          const dx = mouse.x - p.projX
          const dy = mouse.y - p.projY
          if (Math.sqrt(dx * dx + dy * dy) < 100) {
            ctx.fillStyle = neon
            ctx.beginPath()
            ctx.arc(p.projX, p.projY, 2.5 * p.projScale, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
    }

    if (reducedMotion) {
      // One static frame: the mesh is still there, it just doesn't move.
      drawFrame()
    } else {
      const render = () => {
        if (visible) drawFrame()
        animationFrameId = requestAnimationFrame(render)
      }
      animationFrameId = requestAnimationFrame(render)
    }

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mouseleave', handleMouseLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      io.disconnect()
    }
  }, [isDarkMode, reducedMotion, variant])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-hidden select-none',
        variant === 'hero' ? 'w-full h-screen' : 'w-full h-full',
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={cn('absolute inset-0 block', variant === 'hero' ? 'cursor-crosshair' : 'pointer-events-none')}
      />

      {children ?? (
        <div className="relative z-10 flex h-full flex-col items-center justify-center text-center px-4 pointer-events-none">
          {subtitle && (
            <span className="font-mono text-xs tracking-widest uppercase mb-3 text-[#00E676]">{subtitle}</span>
          )}
          {title && (
            <h1 className="font-mono text-6xl md:text-9xl font-black tracking-tighter uppercase leading-none text-[#eaf5d8]">
              {title}
            </h1>
          )}
          {description && (
            <p className="mt-4 font-mono text-xs md:text-sm max-w-lg text-[#9aab86]">{description}</p>
          )}
        </div>
      )}
    </div>
  )
}

export default NeonMesh
