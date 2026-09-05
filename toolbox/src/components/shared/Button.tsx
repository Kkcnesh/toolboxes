import { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabledReason?: string;
}

export function Button({
  variant = "secondary",
  disabledReason,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" && "toolbox-btn-primary",
        variant === "secondary" && "toolbox-btn-secondary",
        variant === "ghost" && "toolbox-btn-ghost",
        variant === "danger" && "toolbox-btn-danger",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
