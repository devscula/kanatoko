import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react'
import type { IconKey } from '../../icons/iconKeys.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import type { UiIconSize } from '../../icons/sizes.ts'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly variant?: ButtonVariant
  readonly icon?: IconKey
  readonly block?: boolean
  /** Like disabled, but the button stays focusable so that screen readers still reach it and its description. */
  readonly softDisabled?: boolean
  readonly children?: ReactNode
  readonly ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'secondary',
  icon,
  block = false,
  softDisabled = false,
  className,
  children,
  onClick,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], block ? styles.block : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (softDisabled) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      aria-disabled={softDisabled || undefined}
      onClick={handleClick}
      {...rest}
    >
      {icon !== undefined && <PixelIcon name={icon} size={16} />}
      {children !== undefined && <span className={styles.label}>{children}</span>}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  readonly icon: IconKey
  readonly label: string
  /** inverse is for dark backgrounds such as toasts. */
  readonly variant?: 'secondary' | 'ghost' | 'inverse'
  readonly iconSize?: Extract<UiIconSize, 16 | 24>
  readonly ref?: Ref<HTMLButtonElement>
}

export function IconButton({ icon, label, variant = 'secondary', iconSize = 24, className, type = 'button', ref, ...rest }: IconButtonProps) {
  const classes = [styles.button, styles.iconButton, styles[variant], className ?? ''].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={classes} aria-label={label} title={label} {...rest}>
      <PixelIcon name={icon} size={iconSize} />
    </button>
  )
}
