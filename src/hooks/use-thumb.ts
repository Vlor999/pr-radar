import { useLayoutEffect, useRef, useState } from "react"

type Rect = { left: number; top: number; width: number; height: number }

/**
 * Position de l'élément actif d'un groupe (`selector`), pour un indicateur qui glisse en CSS
 * d'une option à l'autre. Mesurée : les options n'ont pas la même largeur.
 */
export function useThumb<T extends HTMLElement>(
  selector: string,
  value: unknown,
) {
  const ref = useRef<T>(null)
  const [rect, setRect] = useState<Rect>()
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const place = () => {
      const on = box.querySelector<HTMLElement>(selector)
      if (!on) return
      const next = {
        left: on.offsetLeft,
        top: on.offsetTop,
        width: on.offsetWidth,
        height: on.offsetHeight,
      }
      // même position : garder l'objet, sinon chaque frame de resize re-rend le parent
      setRect((r) =>
        r &&
        r.left === next.left &&
        r.top === next.top &&
        r.width === next.width &&
        r.height === next.height
          ? r
          : next,
      )
    }
    place()
    const obs = new ResizeObserver(place) // changement de langue, retour à la ligne
    obs.observe(box)
    // les options aussi : un groupe pleine largeur ne bouge pas quand la police charge
    for (const c of box.children) obs.observe(c)
    return () => obs.disconnect()
  }, [selector, value])
  return [ref, rect] as const
}
