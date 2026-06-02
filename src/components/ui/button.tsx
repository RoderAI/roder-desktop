import * as React from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-w-0 items-center justify-center gap-2 rounded-full text-base font-medium whitespace-nowrap transition-colors outline-none disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        default: "bg-muted/50 text-foreground hover:bg-muted/80",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        accent: "bg-blue-600 text-white hover:bg-blue-500",
        success: "bg-emerald-600 text-white hover:bg-emerald-500",
        warning: "bg-amber-100/70 text-amber-500 hover:bg-amber-100",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        outline: "border border-border bg-card hover:bg-accent",
        subtle: "bg-card/70 text-foreground shadow-sm ring-1 ring-border hover:bg-card",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3",
        icon: "size-8",
        "icon-xs": "size-5",
        compact: "h-8 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ComponentPropsWithoutRef<typeof BaseButton> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export const Button = React.forwardRef<React.ElementRef<typeof BaseButton>, ButtonProps>(
  ({ asChild = false, children, className, variant, size, ...props }, ref) => {
    const hasIconWithText = buttonHasIconWithText(children);
    const iconBalanceClass = hasIconWithText && size !== "icon" ? "pl-3 pr-4 [&_svg]:size-3.5" : undefined;

    if (asChild && React.isValidElement(children)) {
      return (
        <BaseButton
          className={cn(buttonVariants({ variant, size }), iconBalanceClass, className)}
          ref={ref}
          render={children}
          {...props}
        />
      );
    }

    return (
      <BaseButton className={cn(buttonVariants({ variant, size }), iconBalanceClass, className)} ref={ref} {...props}>
        {children}
      </BaseButton>
    );
  },
);

Button.displayName = "Button";

function buttonHasIconWithText(children: React.ReactNode): boolean {
  const childArray = React.Children.toArray(children).filter((child) => child !== null && child !== undefined);
  if (childArray.length < 2) {
    return false;
  }
  return childArray.some((child) => React.isValidElement(child));
}

export { buttonVariants };
