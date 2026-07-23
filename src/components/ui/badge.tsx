import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold uppercase",
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground",
        success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
        warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
        destructive:
          "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
        info: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
