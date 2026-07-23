import * as React from "react";

import { cn } from "@/lib/utils";

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "success" | "destructive";
};

export function Alert({
  className,
  variant = "default",
  ...props
}: AlertProps) {
  return (
    <div
      className={cn(
        "grid gap-1 rounded-lg border p-4 text-sm",
        variant === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
        variant === "destructive" &&
          "border-red-200 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
        variant === "default" && "bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}
