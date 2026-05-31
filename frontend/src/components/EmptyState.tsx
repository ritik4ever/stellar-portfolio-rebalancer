import React from "react";
import { Plus, ExternalLink, BookOpen } from "lucide-react";

interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: React.ReactNode;
  variant?: "primary" | "secondary";
}

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: EmptyStateAction[];
}

export function EmptyState({ title, description, icon, actions }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      {icon && (
        <div className="mb-6 text-gray-300 dark:text-gray-600">
          {icon}
        </div>
      )}
      <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
        {title}
      </h3>
      {description && (
        <p className="text-gray-500 dark:text-gray-400 max-w-md mb-8 leading-relaxed">
          {description}
        </p>
      )}
      {actions && actions.length > 0 && (
        <div className="flex flex-wrap gap-3 justify-center">
          {actions.map((action, index) => {
            const baseClasses =
              "inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors";
            const variantClasses =
              action.variant === "secondary"
                ? "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-sm";

            if (action.href) {
              return (
                <a
                  key={index}
                  href={action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${baseClasses} ${variantClasses}`}
                >
                  {action.icon || <ExternalLink size={16} />}
                  {action.label}
                </a>
              );
            }
            return (
              <button
                key={index}
                onClick={action.onClick}
                className={`${baseClasses} ${variantClasses}`}
              >
                {action.icon || (action.variant === "secondary" ? <BookOpen size={16} /> : <Plus size={16} />)}
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
