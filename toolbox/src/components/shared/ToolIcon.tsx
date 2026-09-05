interface ToolIconProps {
  color: string;
  label: string;
  size?: number;
  radius?: number;
}

export function ToolIcon({ color, label, size = 28, radius = 12 }: ToolIconProps) {
  return (
    <div
      className="flex shrink-0 items-center justify-center font-medium"
      style={{
        width: size,
        height: size,
        background: color,
        borderRadius: radius,
        color: "#1a1a18",
        fontSize: size * 0.42,
      }}
    >
      {label.charAt(0).toUpperCase()}
    </div>
  );
}
