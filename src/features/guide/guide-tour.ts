import { driver } from 'driver.js'
import { flushSync } from 'react-dom'
import { guideSteps, nextGuideIndex } from './guide-state'
import { messages } from '@/i18n/vi'

export function createGuideTour(render: (index: number | null) => void) {
  let index = 0
  let generation = 0
  let active = true
  const tour = driver({
    animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    allowKeyboardControl: false, smoothScroll: false, disableActiveInteraction: true, overlayClickBehavior: 'none',
    popoverClass: 'referee-guide-popover', showProgress: true, progressText: messages.guide.progress,
    nextBtnText: messages.guide.next, prevBtnText: messages.guide.back, doneBtnText: messages.guide.done,
    showButtons: ['previous', 'next', 'close'],
    onPopoverRender: (popover) => {
      popover.closeButton.textContent = messages.guide.close
      popover.closeButton.setAttribute('aria-label', messages.guide.close)
      popover.nextButton.focus()
    },
    onNextClick: () => { if (index === guideSteps.length - 1) tour.destroy(); else show(nextGuideIndex(index, 1)) },
    onPrevClick: () => show(nextGuideIndex(index, -1)),
    onDestroyed: () => { active = false; generation++; document.removeEventListener('keydown', handleKey, true); render(null) },
    steps: guideSteps.map((step) => ({
      element: `[data-guide="${step.target}"]`,
      popover: { title: step.title, description: step.description, side: 'bottom', align: 'center' },
    })),
  })
  function show(next: number) {
    if (!active) return
    index = next
    const request = ++generation
    flushSync(() => render(index))
    requestAnimationFrame(() => {
      if (active && request === generation) tour.drive(index)
    })
  }
  function handleKey(event: KeyboardEvent) {
    if (!active || !['ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') tour.destroy()
    else if (event.key === 'ArrowRight' && index === guideSteps.length - 1) tour.destroy()
    else show(nextGuideIndex(index, event.key === 'ArrowLeft' ? -1 : 1))
  }
  return {
    start: () => { document.addEventListener('keydown', handleKey, true); show(0) },
    destroy: () => { document.removeEventListener('keydown', handleKey, true); active = false; generation++; tour.destroy() },
  }
}
