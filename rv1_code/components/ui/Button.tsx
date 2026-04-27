// =============================================================================
// Button — single source of truth for button styling.
//
// Variants:
//   primary    — main affirmative action (Save, Create)
//   secondary  — neutral / cancel
//   approve    — explicit approval gate (green)
//   link       — text-styled, low emphasis
//
// Sizes:
//   md (default) — used in forms and primary actions
//   sm           — used in dense rows (questionnaire, table actions)
//
// Renders a native <button>. Pass `as="link"` with `href` to render an <a>
// styled as a button (used by worklist's "+ New audit" call-to-action).
// =============================================================================

import Link from "next/link";
import type { CSSProperties, ButtonHTMLAttributes } from "react";
import { color, radius, space } from "@/lib/ui/tokens";

export type ButtonVariant = "primary" | "secondary" | "approve" | "link";
export type ButtonSize = "md" | "sm";

interface BaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

type ButtonProps = BaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
    style?: CSSProperties;
  };

interface LinkProps extends BaseProps {
  href: string;
  children: React.ReactNode;
  style?: CSSProperties;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  style,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button {...rest} style={{ ...buttonStyle(variant, size, fullWidth), ...style }}>
      {children}
    </button>
  );
}

// Renders a Next.js Link styled as a button.
export function ButtonLink({
  variant = "primary",
  size = "md",
  fullWidth = false,
  href,
  children,
  style,
}: LinkProps) {
  return (
    <Link href={href} style={{ ...buttonStyle(variant, size, fullWidth), ...style, textDecoration: "none" }}>
      {children}
    </Link>
  );
}

function buttonStyle(variant: ButtonVariant, size: ButtonSize, fullWidth: boolean): CSSProperties {
  const padding = size === "sm" ? `${space[1]}px ${space[3]}px` : `${space[2]}px ${space[4]}px`;
  const fontSize = size === "sm" ? 12 : 13;

  const variantStyle = VARIANT_STYLES[variant];

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space[1],
    padding,
    fontSize,
    fontWeight: 500,
    fontFamily: "inherit",
    borderRadius: radius.sm,
    cursor: "pointer",
    width: fullWidth ? "100%" : "auto",
    transition: "background 80ms ease",
    ...variantStyle,
  };
}

const VARIANT_STYLES: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: color.primary,
    color: color.primaryFg,
    border: "1px solid transparent",
  },
  secondary: {
    background: color.bg,
    color: color.fg,
    border: `1px solid ${color.borderStrong}`,
  },
  approve: {
    background: color.success,
    color: color.successFg,
    border: "1px solid transparent",
  },
  link: {
    background: "transparent",
    color: color.primary,
    border: "1px solid transparent",
    padding: 0,
  },
};
