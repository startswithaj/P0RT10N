import { ark } from '@ark-ui/solid/factory'
import type { ComponentProps } from 'solid-js'
import { styled } from 'styled-system/jsx'
import { icon } from 'styled-system/recipes'

export type IconProps = ComponentProps<typeof Icon>
// A span, NOT ark.svg: icons passed as children are themselves <svg> elements,
// and an <svg> nested inside an <svg> gets clipped to the outer viewport. A
// span is a normal HTML box, so the child svg sizes to it (see the icon recipe).
export const Icon = styled(ark.span, icon)
